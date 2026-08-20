import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { CODEBUDDY_SESSION_REF, loginCodeBuddy, serializeCodeBuddySession } from "./codebuddy-auth.js";

const PROVIDER = "codebuddy-cn";
const API_KEY_ENV = "CODEBUDDY_API_KEY";
const ROUTE = "/dsh-llm-codebuddy/auth";

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

async function setMode(settings, mode) {
  const config = settings.get("llm-pi-ai");
  const exists = Object.hasOwn(config?.providers ?? {}, PROVIDER);
  const path = ["providers", PROVIDER];
  if (!exists) {
    await settings.mutate("llm-pi-ai", [{ op: "set", path, value: mode === "token" ? {} : { apiKeyEnv: API_KEY_ENV } }]);
    return;
  }
  await settings.mutate("llm-pi-ai", [{
    op: mode === "token" ? "unset" : "set",
    path: [...path, "apiKeyEnv"],
    ...(mode === "api-key" ? { value: API_KEY_ENV } : {}),
  }]);
}

export function installCodeBuddyWeb(ctx) {
  ctx.inject(["webServer", "settings", "credentials"], (webCtx) => {
    let loginPromise;
    const currentState = async () => ({
      ok: true,
      mode: authenticationMode(webCtx.settings.get("llm-pi-ai")),
      authenticated: (await webCtx.credentials.describe(credentialRef(CODEBUDDY_SESSION_REF))).configured,
    });
    const status = async (_req, res) => {
      json(res, 200, await currentState());
    };
    const apiKey = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面切换认证方式" });
      await setMode(webCtx.settings, "api-key");
      json(res, 200, await currentState());
    };
    const token = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面切换认证方式" });
      const state = await currentState();
      if (!state.authenticated) return json(res, 409, { ok: false, message: "尚未保存 CodeBuddy 登录令牌" });
      await setMode(webCtx.settings, "token");
      json(res, 200, await currentState());
    };
    const login = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面登录" });
      try {
        loginPromise ??= (async () => {
          const session = await loginCodeBuddy();
          await webCtx.credentials.set(credentialRef(CODEBUDDY_SESSION_REF), serializeCodeBuddySession(session));
          await setMode(webCtx.settings, "token");
        })().finally(() => {
          loginPromise = undefined;
        });
        await loginPromise;
        json(res, 200, { ok: true, mode: "token", authenticated: true });
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "CodeBuddy 登录失败" });
      }
    };
    webCtx.effect(() => {
      const dispose = [
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/status`, handler: status }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/api-key`, handler: apiKey }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/token`, handler: token }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/login`, handler: login }),
      ];
      return () => dispose.forEach((fn) => fn());
    }, "llm-codebuddy: web login routes");
  });
}
