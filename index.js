import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { LlmError, assertUsableApiKey, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { Config, PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { createProvider } from "@earendil-works/pi-ai";
import * as openAICompletionsApi from "@earendil-works/pi-ai/api/openai-completions";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

export { Config };

export const name = "llm-codebuddy";
export const inject = ["llm"];

const NS = settingsNamespace("llm-pi-ai");
const PROVIDER = "codebuddy-cn";
const DISPLAY_NAME = "CodeBuddy 中国区";
const API_KEY_ENV = "CODEBUDDY_API_KEY";
const BASE_URL = "https://copilot.tencent.com/v2";
const CONFIG_URL = "https://copilot.tencent.com/v3/config";
const USER_AGENT = "CLI/unknown CodeBuddy/2.136.0";
const STREAM_IDLE_TIMEOUT_MS = 300_000;
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const THINKING_LEVEL_MAP = Object.fromEntries([
  ["off", null],
  ...EFFORTS.map((effort) => [effort, effort]),
]);
const COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  maxTokensField: "max_tokens",
  thinkingFormat: "openai",
};

const FALLBACK_MODELS = [
  ["hy3", "Hy3", 192000, 64000, true],
  ["glm-5.2", "GLM-5.2", 1000000, 48000, false],
  ["glm-5.1", "GLM-5.1", 200000, 48000, false],
  ["glm-5v-turbo", "GLM-5v-Turbo", 200000, 64000, true],
  ["minimax-m3-pay", "MiniMax-M3", 512000, 128000, true],
  ["minimax-m2.7", "MiniMax-M2.7", 200000, 48000, true],
  ["kimi-k3-2", "Kimi-K3", 1000000, 32000, true],
  ["kimi-k2.7", "Kimi-K2.7-Code", 256000, 32000, true],
  ["kimi-k2.6", "Kimi-K2.6", 256000, 32000, true],
  ["deepseek-v4-pro", "DeepSeek V4 Pro", 1000000, 50000, true],
  ["deepseek-v4-flash", "DeepSeek V4 Flash", 1000000, 50000, true],
].map(([id, modelName, contextWindow, maxTokens, images]) =>
  codeBuddyModel({ id, name: modelName, contextWindow, maxTokens, images }),
);

function codeBuddyModel({ id, name: modelName, contextWindow, maxTokens, images }) {
  return {
    id,
    name: modelName,
    api: "openai-completions",
    provider: PROVIDER,
    baseUrl: BASE_URL,
    reasoning: true,
    thinkingLevelMap: { ...THINKING_LEVEL_MAP },
    input: images ? ["text", "image"] : ["text"],
    cost: { ...NO_COST },
    contextWindow,
    maxTokens,
    compat: { ...COMPAT },
  };
}

function positiveInteger(...values) {
  return values.find((value) => Number.isSafeInteger(value) && value > 0);
}

function text(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function modelsFromConfig(data) {
  const agents = Array.isArray(data?.agents) ? data.agents : data?.agent?.agents;
  const cli = Array.isArray(agents) ? agents.find((agent) => agent?.name === "cli") : undefined;
  const allowed = Array.isArray(cli?.models) ? cli.models : [];
  const source = Array.isArray(data?.models) ? data.models : [];
  const byId = new Map(source.map((model) => [model?.id, model]));
  return allowed.flatMap((id) => {
    const raw = byId.get(id);
    if (!raw) return [];
    const fallback = FALLBACK_MODELS.find((model) => model.id === id);
    const contextWindow = positiveInteger(raw.maxInputTokens, raw.maxAllowedSize, fallback?.contextWindow);
    const maxTokens = positiveInteger(raw.maxOutputTokens, fallback?.maxTokens);
    if (!contextWindow || !maxTokens) return [];
    return [codeBuddyModel({
      id,
      name: text(raw.name, fallback?.name, id),
      contextWindow,
      maxTokens,
      images: raw.supportsImages === true || fallback?.input.includes("image") === true,
    })];
  });
}

async function fetchCodeBuddyModels(apiKey, signal) {
  let response;
  try {
    response = await fetch(CONFIG_URL, {
      headers: {
        accept: "application/json",
        "x-api-key": assertUsableApiKey(apiKey, name, API_KEY_ENV),
        "user-agent": USER_AGENT,
        "x-product": "SaaS",
      },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new LlmError("CodeBuddy 模型列表获取已取消", "ABORTED", { cause: error });
    throw new LlmError("无法连接 CodeBuddy 模型配置接口", "DISCOVERY_FAILED", { cause: error });
  }
  if (!response.ok) throw new LlmError(`CodeBuddy 模型配置接口返回 ${response.status}`, "DISCOVERY_FAILED");
  const body = await response.json();
  if (body?.code !== 0) throw new LlmError(`CodeBuddy 模型配置接口错误：${body?.msg ?? body?.code}`, "DISCOVERY_FAILED");
  const models = modelsFromConfig(body.data);
  if (models.length === 0) throw new LlmError("CodeBuddy 没有返回 CLI 可用模型", "DISCOVERY_FAILED");
  return models;
}

function codeBuddyProvider(models, auth) {
  return createProvider({
    id: PROVIDER,
    name: DISPLAY_NAME,
    baseUrl: BASE_URL,
    auth,
    models,
    api: openAICompletionsApi,
  });
}

function resolvedProfile(provider, source, piProvider, configuredMaxTokens = new Map()) {
  const apiKeyEnv = source.apiKeyEnv === undefined ? undefined : credentialRef(source.apiKeyEnv);
  return {
    ...source,
    provider,
    displayName: source.displayName ?? piProvider.name ?? provider,
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    streamIdleTimeoutMs: source.streamIdleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(source.retryPolicy, `${name}: provider "${provider}" retryPolicy`),
    configuredMaxTokens,
    piProvider,
  };
}

function selectBuiltinModels(base, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return base;
  const byId = new Map(base.getModels().map((model) => [model.id, model]));
  const selected = entries.flatMap((entry) => {
    const model = byId.get(entry.id);
    if (!model) return [];
    return [{
      ...model,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {}),
      ...(entry.maxTokens ? { maxTokens: entry.maxTokens } : {}),
      ...(Array.isArray(entry.input) && entry.input.length ? { input: [...entry.input] } : {}),
    }];
  });
  return { ...base, getModels: () => selected };
}

function selectCodeBuddyModels(base, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return base;
  const byId = new Map(base.map((model) => [model.id, model]));
  return entries.map((entry) => {
    const model = byId.get(entry.id);
    return codeBuddyModel({
      id: entry.id,
      name: entry.name ?? model?.name ?? entry.id,
      contextWindow: entry.contextWindow ?? model?.contextWindow ?? 262144,
      maxTokens: entry.maxTokens ?? model?.maxTokens ?? 32768,
      images: entry.input?.includes("image") ?? model?.input.includes("image") ?? false,
    });
  });
}

export function apply(ctx, config) {
  let current = () => config;
  let remoteModels;
  let generation = 0;
  let memoRaw;
  let memoGeneration = -1;
  let memoized;
  const builtins = new Map(builtinProviders().map((provider) => [provider.id, provider]));
  const apiKeyAuth = builtins.get("deepseek")?.auth;
  if (!apiKeyAuth) throw new Error(`${name}: pi-ai DeepSeek auth helper is unavailable`);

  const effectiveConfig = () => {
    const raw = current() ?? {};
    return {
      ...raw,
      providers: {
        [PROVIDER]: { apiKeyEnv: API_KEY_ENV },
        ...(raw.providers ?? {}),
      },
    };
  };

  const profiles = () => {
    const raw = effectiveConfig();
    if (memoRaw === current() && memoGeneration === generation && memoized) return memoized;
    const result = new Map();
    for (const [provider, source] of Object.entries(raw.providers)) {
      if (provider === PROVIDER) {
        const models = selectCodeBuddyModels(remoteModels ?? FALLBACK_MODELS, source.models);
        const configured = new Map((source.models ?? []).flatMap((model) =>
          Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 ? [[model.id, model.maxTokens]] : [],
        ));
        result.set(provider, resolvedProfile(provider, {
          ...source,
          apiKeyEnv: source.apiKeyEnv ?? API_KEY_ENV,
          displayName: DISPLAY_NAME,
        }, codeBuddyProvider(models, apiKeyAuth), configured));
        continue;
      }
      const base = builtins.get(provider);
      if (!base) throw new Error(`${name}: 不支持非内置 Provider "${provider}"`);
      const selected = selectBuiltinModels(base, source.models);
      const configured = new Map((source.models ?? []).flatMap((model) =>
        Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 ? [[model.id, model.maxTokens]] : [],
      ));
      result.set(provider, resolvedProfile(provider, source, selected, configured));
    }
    memoRaw = current();
    memoGeneration = generation;
    memoized = result;
    return result;
  };

  const resolveApiKey = async (provider, profile) => {
    const ref = profile.apiKeyEnv;
    if (!ref) return undefined;
    const stored = await ctx.get("credentials")?.resolve(ref);
    const value = stored?.value ?? launchEnvironmentOf(ctx).get(ref)?.value;
    if (value) return assertUsableApiKey(value, name, ref);
    throw new LlmError(`${name}: Provider "${provider}" 缺少 API Key，请在 WebUI 的模型设置中填写`, "MISSING_CREDENTIAL");
  };

  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    resolveAttachments: () => ctx.get("attachments"),
  });
  const listModels = adapter.listModels.bind(adapter);
  let refreshPromise;
  adapter.listModels = async (provider) => {
    if (provider === PROVIDER && !remoteModels) {
      refreshPromise ??= (async () => {
        try {
          const profile = profiles().get(PROVIDER);
          const apiKey = await resolveApiKey(PROVIDER, profile);
          remoteModels = await fetchCodeBuddyModels(apiKey);
          generation += 1;
        } catch {
          // Keep the built-in catalog available while the key or network is absent.
        }
      })();
      await refreshPromise;
    }
    return listModels(provider);
  };

  const directoryEntries = () => [{
    provider: PROVIDER,
    displayName: DISPLAY_NAME,
    settingsNs: NS,
    settingsPath: ["providers", PROVIDER],
    declared: false,
  }, ...[...builtins.values()].flatMap((provider) => provider.auth?.apiKey ? [{
    provider: provider.id,
    displayName: provider.name,
    settingsNs: NS,
    settingsPath: ["providers", provider.id],
    declared: false,
  }] : [])];

  let directory = ctx.llm.registerConfigurableProviders(directoryEntries());
  let registration = ctx.llm.registerAdapter([...profiles().keys()], adapter);

  ctx.llm.registerModelDiscovery(NS, async (request) => {
    if (request.provider === PROVIDER) {
      const profile = profiles().get(PROVIDER);
      const apiKey = request.apiKey ?? await resolveApiKey(PROVIDER, profile);
      remoteModels = await fetchCodeBuddyModels(apiKey, request.signal);
      generation += 1;
      return remoteModels.map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      }));
    }
    const provider = builtins.get(request.provider);
    if (!provider) throw new LlmError(`没有 Provider "${request.provider ?? ""}" 的模型目录`, "DISCOVERY_FAILED");
    return provider.getModels().map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }));
  });

  // Keep CodeBuddy out of the settings base layer so it appears in WebUI's
  // "Add provider" dropdown. The runtime profile above still exists as the
  // built-in implementation; selecting it only persists the credential ref.
  installSettingsSection(ctx, NS, Config, config ?? { providers: {} }, {
    setSource(source) {
      current = source;
    },
    onChange() {
      memoRaw = undefined;
      const providers = profiles();
      registration.replace([...providers.keys()]);
      directory.replace(directoryEntries());
    },
  });
}
