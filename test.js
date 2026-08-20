import assert from "node:assert/strict";
import test from "node:test";
import { __testing } from "./index.js";
import { parseCodeBuddySession, refreshCodeBuddySession, serializeCodeBuddySession, sessionNeedsRefresh } from "./codebuddy-auth.js";
import { authenticationMode } from "./codebuddy-web.js";

test("忽略由其他插件负责的 Provider", () => {
  const builtins = new Map([["deepseek", {}]]);

  assert.equal(__testing.ownsProvider("codebuddy-cn", builtins), true);
  assert.equal(__testing.ownsProvider("deepseek", builtins), true);
  assert.equal(__testing.ownsProvider("opencode-go-live", builtins), false);
});

test("API Key 和登录令牌使用各自的认证头", () => {
  assert.deepEqual(__testing.authenticationHeaders({ value: "api-key", kind: "api-key" }), { "x-api-key": "api-key" });
  assert.deepEqual(__testing.authenticationHeaders({ value: "login-token", kind: "bearer" }), { authorization: "Bearer login-token" });
});

test("登录请求头不修改 DSH 冻结的配置对象", () => {
  const headers = __testing.runtimeHeaders(Object.freeze({ existing: "value" }));
  headers["X-User-Id"] = "user";
  assert.deepEqual(headers, { existing: "value", "X-User-Id": "user" });
});

test("模型请求恢复 CodeBuddy 官方 User-Agent", () => {
  const options = Object.freeze({ headers: Object.freeze({ "user-agent": "deepseek-harness", existing: "value" }) });
  const resolved = __testing.codeBuddyRequestOptions(options);

  assert.equal(resolved.headers["user-agent"], "CLI/unknown CodeBuddy/2.137.1");
  assert.equal(resolved.headers.existing, "value");
  assert.equal(options.headers["user-agent"], "deepseek-harness");
});

test("显式空配置启用令牌模式，未配置时仍使用 API Key", () => {
  assert.equal(__testing.codeBuddySource({}, {}).apiKeyEnv, "CODEBUDDY_API_KEY");
  assert.equal(__testing.codeBuddySource({ providers: { "codebuddy-cn": {} } }, {}).apiKeyEnv, undefined);
});

test("WebUI 可以区分 API Key 与令牌认证模式", () => {
  assert.equal(authenticationMode({ providers: {} }), "api-key");
  assert.equal(authenticationMode({ providers: { "codebuddy-cn": { apiKeyEnv: "CODEBUDDY_API_KEY" } } }), "api-key");
  assert.equal(authenticationMode({ providers: { "codebuddy-cn": {} } }), "token");
});

test("登录会话可以安全序列化并按过期时间刷新", () => {
  const session = {
    auth: { accessToken: "access", refreshToken: "refresh", expiresAt: 2_000_000 },
    account: { userId: "user", enterpriseId: "enterprise", ignored: "not-stored" },
  };
  const restored = parseCodeBuddySession(serializeCodeBuddySession(session));
  assert.deepEqual(restored.account, { userId: "user", enterpriseId: "enterprise" });
  assert.equal(sessionNeedsRefresh(restored, 1_000_000), false);
  assert.equal(sessionNeedsRefresh(restored, 1_900_000), true);
});

test("插件直接调用官方刷新接口且不复用旧过期时间", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ code: 0, data: { accessToken: "new-access", expiresIn: 3600 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const refreshed = await refreshCodeBuddySession({
      auth: { accessToken: "old-access", refreshToken: "refresh", expiresAt: 1 },
      account: { uid: "user", enterpriseId: "enterprise" },
    });
    assert.equal(request.url, "https://copilot.tencent.com/v2/plugin/auth/token/refresh");
    assert.equal(request.options.headers["X-Refresh-Token"], "refresh");
    assert.equal(request.options.headers["X-Enterprise-Id"], "enterprise");
    assert.equal(refreshed.auth.accessToken, "new-access");
    assert.ok(refreshed.auth.expiresAt > Date.now() + 3_500_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("模型目录保留逐模型思考能力和默认档位", () => {
  const models = __testing.modelsFromConfig({
    agents: [{ name: "cli", models: ["reasoning", "plain"] }],
    models: [
      { id: "reasoning", name: "Reasoning", maxInputTokens: 1000, maxOutputTokens: 100, supportsReasoning: true, onlyReasoning: true, reasoning: { effort: "high" } },
      { id: "plain", name: "Plain", maxInputTokens: 1000, maxOutputTokens: 100, supportsReasoning: false },
    ],
  });

  assert.deepEqual(models.map((model) => model.id), ["reasoning", "plain"]);
  assert.equal(models[0].reasoning, true);
  assert.equal(models[0].thinkingLevelMap.off, null);
  assert.equal(models[0].thinkingLevelMap.xhigh, undefined);
  assert.equal(models[0].defaultReasoningEffort, "high");
  assert.equal(models[1].reasoning, false);
});

test("自定义模型可覆盖自己的思考档位", () => {
  const [model] = __testing.selectCodeBuddyModels([], [{
    id: "custom",
    contextWindow: 1000,
    maxTokens: 100,
    reasoningEfforts: { off: null, medium: "balanced" },
  }]);

  assert.equal(model.reasoning, true);
  assert.equal(Object.hasOwn(model.thinkingLevelMap, "off"), false);
  assert.equal(model.thinkingLevelMap.medium, "balanced");
  assert.equal(model.thinkingLevelMap.high, null);
});
