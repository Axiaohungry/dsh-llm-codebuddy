import { randomBytes } from "node:crypto";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  CODEBUDDY_API_KEYS_REF,
  CODEBUDDY_SESSION_REF,
  CODEBUDDY_SESSIONS_REF,
  activeCodeBuddySession,
  codeBuddyApiKeyEntries,
  codeBuddySessionAccounts,
  createCodeBuddyApiKeyStore,
  createCodeBuddySessionStore,
  parseCodeBuddyApiKeys,
  loginCodeBuddy,
  parseCodeBuddySession,
  parseCodeBuddySessions,
  refreshCodeBuddySession,
  serializeCodeBuddyApiKeys,
  serializeCodeBuddySession,
  serializeCodeBuddySessions,
  sessionNeedsRefresh,
  upsertCodeBuddyApiKey,
  upsertCodeBuddySession,
} from "./codebuddy-auth.js";
import { fetchCodeBuddyCredits } from "./codebuddy-credits.js";

const PROVIDER = "codebuddy-cn";
const API_KEY_ENV = "CODEBUDDY_API_KEY";
const ROUTE = "/dsh-llm-codebuddy/auth";
const ENV_SOURCES = new Set(["env", "user-env", "project-env"]);

export function authenticationMode(config) {
  const profile = config?.providers?.[PROVIDER];
  return profile && profile.apiKeyEnv === undefined ? "token" : "api-key";
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function localPost(req) {
  const address = req.socket.remoteAddress;
  const loopback = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  if (!loopback) return false;
  const origin = req.headers.origin;
  if (!origin) return req.headers["sec-fetch-site"] === "same-origin";
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

async function requestBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 64 * 1024) throw new Error("请求体过大");
  }
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    throw new Error("请求参数格式无效");
  }
}

async function setMode(settings, mode, apiKeyRef = API_KEY_ENV) {
  const config = settings.get("llm-pi-ai");
  const exists = Object.hasOwn(config?.providers ?? {}, PROVIDER);
  const path = ["providers", PROVIDER];
  if (!exists) {
    await settings.mutate("llm-pi-ai", [{ op: "set", path, value: mode === "token" ? {} : { apiKeyEnv: apiKeyRef } }]);
    return;
  }
  await settings.mutate("llm-pi-ai", [{
    op: mode === "token" ? "unset" : "set",
    path: [...path, "apiKeyEnv"],
    ...(mode === "api-key" ? { value: apiKeyRef } : {}),
  }]);
}

function configuredApiKeyRef(settings) {
  return settings.get("llm-pi-ai")?.providers?.[PROVIDER]?.apiKeyEnv ?? API_KEY_ENV;
}

function maskApiKey(value) {
  const text = typeof value === "string" ? value : "";
  return text.length > 4 ? `••••${text.slice(-4)}` : text ? "••••" : "";
}

function textLabel(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function storedApiKeyRef() {
  return `CODEBUDDY_API_KEY_DSH_${Date.now().toString(36).toUpperCase()}_${randomBytes(6).toString("hex").toUpperCase()}`;
}

async function readApiKeyStore(credentials) {
  const stored = await credentials.resolve(credentialRef(CODEBUDDY_API_KEYS_REF));
  if (!stored?.value) return createCodeBuddyApiKeyStore();
  return parseCodeBuddyApiKeys(stored.value);
}

async function writeApiKeyStore(credentials, store) {
  const normalized = createCodeBuddyApiKeyStore(store?.entries ?? [], store?.activeId);
  if (normalized.entries.length === 0) {
    await credentials.unset(credentialRef(CODEBUDDY_API_KEYS_REF));
    return;
  }
  await credentials.set(credentialRef(CODEBUDDY_API_KEYS_REF), serializeCodeBuddyApiKeys(normalized));
}

async function currentApiKeyState(webCtx) {
  const store = await readApiKeyStore(webCtx.credentials);
  const apiMode = authenticationMode(webCtx.settings.get("llm-pi-ai")) === "api-key";
  const ref = apiMode ? configuredApiKeyRef(webCtx.settings) : undefined;
  const items = [];
  const seenRefs = new Set();
  const environment = await webCtx.credentials.resolve(credentialRef(API_KEY_ENV));
  if (environment?.value) {
    items.push({
      id: `env:${API_KEY_ENV}`,
      kind: "environment",
      label: `环境变量 ${API_KEY_ENV}`,
      ref: API_KEY_ENV,
      configured: true,
      masked: maskApiKey(environment.value),
      source: environment.source,
    });
    seenRefs.add(API_KEY_ENV);
  }
  for (const entry of codeBuddyApiKeyEntries(store)) {
    if (seenRefs.has(entry.ref)) continue;
    const resolved = await webCtx.credentials.resolve(credentialRef(entry.ref));
    items.push({
      ...entry,
      kind: "dsh",
      configured: Boolean(resolved?.value),
      ...(resolved?.value ? { masked: maskApiKey(resolved.value), source: resolved.source } : {}),
    });
    seenRefs.add(entry.ref);
  }
  if (ref && !seenRefs.has(ref)) {
    const resolved = await webCtx.credentials.resolve(credentialRef(ref));
    if (resolved?.value) {
      items.push({
        id: `dsh:${ref}`,
        kind: ENV_SOURCES.has(resolved.source) ? "environment" : "dsh",
        label: ENV_SOURCES.has(resolved.source) ? `环境变量 ${ref}` : "DSH 默认 API Key",
        ref,
        configured: true,
        masked: maskApiKey(resolved.value),
        source: resolved.source,
      });
    }
  }
  const configured = apiMode ? items.find((item) => item.ref === ref) : undefined;
  const active = configured ?? items.find((item) => item.id === store.activeId) ?? items[0];
  return {
    apiKeys: items,
    activeApiKeyId: active?.id ?? null,
    apiKeyConfigured: Boolean(configured?.configured),
  };
}

async function readSessionStore(credentials) {
  const stored = await credentials.resolve(credentialRef(CODEBUDDY_SESSIONS_REF));
  if (stored?.value) return parseCodeBuddySessions(stored.value);
  const legacy = await credentials.resolve(credentialRef(CODEBUDDY_SESSION_REF));
  if (!legacy?.value) return createCodeBuddySessionStore();
  const session = parseCodeBuddySession(legacy.value);
  return createCodeBuddySessionStore([session]);
}

async function writeSessionStore(credentials, store) {
  const active = activeCodeBuddySession(store);
  if (!active) {
    await credentials.unset(credentialRef(CODEBUDDY_SESSIONS_REF));
    await credentials.unset(credentialRef(CODEBUDDY_SESSION_REF));
    return;
  }
  await credentials.set(credentialRef(CODEBUDDY_SESSIONS_REF), serializeCodeBuddySessions(store));
  // Keep the old single-session reference as a compatibility pointer for older plugin versions.
  await credentials.set(credentialRef(CODEBUDDY_SESSION_REF), serializeCodeBuddySession(active));
}

async function resolveSession(webCtx, accountId) {
  const store = await readSessionStore(webCtx.credentials);
  const requestedId = typeof accountId === "string" && accountId ? accountId : store.activeId;
  let session = store.sessions.find((entry) => entry.id === requestedId) ?? activeCodeBuddySession(store);
  if (!session) throw new Error("没有找到该 CodeBuddy 登录账号");
  if (sessionNeedsRefresh(session)) {
    session = { ...session, ...(await refreshCodeBuddySession(session)), updatedAt: Date.now() };
    const nextStore = upsertCodeBuddySession({ ...store, activeId: session.id }, session);
    await writeSessionStore(webCtx.credentials, nextStore);
    session = activeCodeBuddySession(nextStore);
  }
  return session;
}

export function installCodeBuddyWeb(ctx) {
  ctx.inject(["webServer", "settings", "credentials"], (webCtx) => {
    let loginPromise;
    const currentState = async () => {
      const store = await readSessionStore(webCtx.credentials);
      const active = activeCodeBuddySession(store);
      const apiKeys = await currentApiKeyState(webCtx);
      return {
        ok: true,
        mode: authenticationMode(webCtx.settings.get("llm-pi-ai")),
        authenticated: active !== undefined,
        activeAccountId: active?.id ?? null,
        accounts: codeBuddySessionAccounts(store),
        ...apiKeys,
      };
    };
    const status = async (_req, res) => {
      try {
        json(res, 200, await currentState());
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "读取 CodeBuddy 认证状态失败" });
      }
    };
    const apiKey = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面切换认证方式" });
      try {
        const body = await requestBody(req);
        let ref = API_KEY_ENV;
        if (typeof body.keyId === "string" && body.keyId) {
          const state = await currentApiKeyState(webCtx);
          const selected = state.apiKeys.find((entry) => entry.id === body.keyId);
          if (!selected) return json(res, 404, { ok: false, message: "没有找到该 CodeBuddy API Key" });
          if (!selected.configured) return json(res, 409, { ok: false, message: "该 API Key 已不可用，请删除后重新添加" });
          ref = selected.ref;
          const store = await readApiKeyStore(webCtx.credentials);
          await writeApiKeyStore(webCtx.credentials, { ...store, activeId: selected.kind === "dsh" ? selected.id : null });
        }
        credentialRef(ref);
        await setMode(webCtx.settings, "api-key", ref);
        json(res, 200, await currentState());
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "切换 API Key 失败" });
      }
    };
    const addApiKey = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面保存 API Key" });
      try {
        const body = await requestBody(req);
        const value = typeof body.key === "string" ? body.key.trim() : "";
        if (!value) return json(res, 400, { ok: false, message: "请输入 API Key" });
        if (value.length > 16 * 1024) return json(res, 413, { ok: false, message: "API Key 长度超出限制" });
        const store = await readApiKeyStore(webCtx.credentials);
        const ref = storedApiKeyRef();
        const entry = {
          id: `dsh:${ref}`,
          ref,
          label: textLabel(body.label) ?? `DSH API Key ${store.entries.length + 1}`,
        };
        await webCtx.credentials.set(credentialRef(ref), value);
        try {
          const next = upsertCodeBuddyApiKey(store, entry);
          await writeApiKeyStore(webCtx.credentials, next);
          await setMode(webCtx.settings, "api-key", ref);
        } catch (error) {
          await webCtx.credentials.unset(credentialRef(ref));
          throw error;
        }
        json(res, 200, await currentState());
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "保存 API Key 失败" });
      }
    };
    const removeApiKey = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面删除 API Key" });
      try {
        const body = await requestBody(req);
        const store = await readApiKeyStore(webCtx.credentials);
        const entry = store.entries.find((item) => item.id === body.keyId);
        if (!entry) return json(res, 404, { ok: false, message: "没有找到该 CodeBuddy API Key" });
        const activeRef = configuredApiKeyRef(webCtx.settings);
        await webCtx.credentials.unset(credentialRef(entry.ref));
        const remaining = store.entries.filter((item) => item.id !== entry.id);
        await writeApiKeyStore(webCtx.credentials, { version: 1, activeId: remaining[0]?.id, entries: remaining });
        if (authenticationMode(webCtx.settings.get("llm-pi-ai")) === "api-key" && activeRef === entry.ref) {
          const environment = await webCtx.credentials.resolve(credentialRef(API_KEY_ENV));
          let fallback = API_KEY_ENV;
          if (!environment?.value) {
            for (const candidate of remaining) {
              if ((await webCtx.credentials.resolve(credentialRef(candidate.ref)))?.value) {
                fallback = candidate.ref;
                break;
              }
            }
          }
          await setMode(webCtx.settings, "api-key", fallback);
        }
        json(res, 200, await currentState());
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "删除 API Key 失败" });
      }
    };
    const token = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面切换认证方式" });
      try {
        const body = await requestBody(req);
        const store = await readSessionStore(webCtx.credentials);
        const accountId = typeof body.accountId === "string" ? body.accountId : store.activeId;
        const active = store.sessions.find((entry) => entry.id === accountId);
        if (!active) return json(res, 409, { ok: false, message: "没有找到该 CodeBuddy 登录账号" });
        await writeSessionStore(webCtx.credentials, { ...store, activeId: active.id });
        await setMode(webCtx.settings, "token");
        json(res, 200, await currentState());
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "切换令牌账号失败" });
      }
    };
    const credits = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面查询 CodeBuddy 积分" });
      try {
        if (authenticationMode(webCtx.settings.get("llm-pi-ai")) !== "token") {
          return json(res, 200, {
            ok: true,
            accountId: null,
            credits: null,
            totalDosage: null,
            segments: [],
            unlimited: false,
            cycleResetTime: null,
            creditError: "积分查询仅支持 CodeBuddy 令牌登录",
            todayUsage: null,
            todayUsageError: "今日请求量查询仅支持 CodeBuddy 令牌登录",
          });
        }
        const body = await requestBody(req);
        const session = await resolveSession(webCtx, body.accountId);
        const result = await fetchCodeBuddyCredits(session);
        json(res, 200, {
          ok: true,
          accountId: session.id,
          credits: result.credits,
          totalDosage: result.totalDosage,
          segments: result.segments,
          unlimited: !!result.unlimited,
          cycleResetTime: result.cycleResetTime ?? null,
          creditError: result.creditError ?? null,
          todayUsage: result.todayUsage ?? null,
          todayUsageError: result.todayUsageError ?? null,
        });
      } catch (error) {
        json(res, 200, {
          ok: true,
          accountId: null,
          credits: null,
          totalDosage: null,
          segments: [],
          unlimited: false,
          cycleResetTime: null,
          creditError: error instanceof Error ? error.message : "查询 CodeBuddy 积分失败",
          todayUsage: null,
          todayUsageError: error instanceof Error ? error.message : "查询 CodeBuddy 今日请求量失败",
        });
      }
    };
    const login = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面登录" });
      try {
        loginPromise ??= (async () => {
          const session = await loginCodeBuddy();
          const store = await readSessionStore(webCtx.credentials);
          await writeSessionStore(webCtx.credentials, upsertCodeBuddySession(store, session));
          await setMode(webCtx.settings, "token");
        })().finally(() => {
          loginPromise = undefined;
        });
        await loginPromise;
        json(res, 200, await currentState());
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "CodeBuddy 登录失败" });
      }
    };
    const remove = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面管理登录账号" });
      try {
        const body = await requestBody(req);
        const store = await readSessionStore(webCtx.credentials);
        const accountId = typeof body.accountId === "string" ? body.accountId : store.activeId;
        const sessions = store.sessions.filter((entry) => entry.id !== accountId);
        if (sessions.length === store.sessions.length) return json(res, 404, { ok: false, message: "没有找到该 CodeBuddy 登录账号" });
        const activeId = accountId === store.activeId ? sessions[0]?.id : store.activeId;
        await writeSessionStore(webCtx.credentials, { version: 1, activeId, sessions });
        json(res, 200, await currentState());
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "删除令牌账号失败" });
      }
    };
    webCtx.effect(() => {
      const dispose = [
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/status`, handler: status }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/api-key`, handler: apiKey }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/api-key/add`, handler: addApiKey }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/api-key/remove`, handler: removeApiKey }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/token`, handler: token }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/credits`, handler: credits }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/login`, handler: login }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/remove`, handler: remove }),
      ];
      return () => dispose.forEach((fn) => fn());
    }, "llm-codebuddy: web login routes");
  });
}
