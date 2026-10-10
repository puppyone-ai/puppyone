import http from "node:http";
import crypto from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createCloudAuthService } from "../../../../electron/cloud-auth-service.mjs";
import { createSupabaseAuthClient } from "../../../../electron/main/auth/supabase-auth-client.mjs";

// Actual Main/loopback/fetch transport. Only the external identity provider is
// simulated, including PKCE enforcement, one-use codes and separate sessions.
const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const publicKey = `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`;
async function fixture({ beforeWrite = async () => {} } = {}) {
  const calls = [];
  const codes = new Map();
  let sequence = 0;
  const issued = id => ({ access_token: `header.${Buffer.from(JSON.stringify({ sub: "user-1", session_id: id })).toString("base64url")}.signature`, refresh_token: `refresh-${id}`, expires_in: 3600, user: { id: "user-1", email: "qa@example.test" } });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ path: url.pathname + url.search, body, authorization: req.headers.authorization });
    const send = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (url.pathname === "/auth/v1/settings") return send(200, { external: { email: true, google: true, github: true } });
    if (url.pathname === "/auth/v1/authorize") {
      if (url.searchParams.get("code_challenge_method") !== "s256") return send(400, {});
      const code = `code-${++sequence}`; codes.set(code, url.searchParams.get("code_challenge"));
      const target = new URL(url.searchParams.get("redirect_to")); target.searchParams.set("code", code);
      res.writeHead(302, { Location: target.toString() }); res.end(); return;
    }
    if (url.searchParams.get("grant_type") === "pkce") {
      const expected = codes.get(body.auth_code);
      const actual = crypto.createHash("sha256").update(body.code_verifier ?? "").digest("base64url");
      if (!expected || expected !== actual) return send(400, { error_code: "bad_code_verifier" });
      codes.delete(body.auth_code); return send(200, issued(`desktop-${sequence}`));
    }
    if (url.searchParams.get("grant_type") === "password") return body.password === "correct-password" ? send(200, issued(`email-${++sequence}`)) : send(400, {});
    if (url.searchParams.get("grant_type") === "refresh_token") return send(200, issued(body.refresh_token.replace("refresh-", "")));
    if (url.pathname === "/auth/v1/signup") return send(200, { id: "user-1" });
    if (url.pathname === "/auth/v1/verify") return body.token === "123456" ? send(200, issued(`verified-${++sequence}`)) : send(400, {});
    if (url.pathname === "/auth/v1/resend" || url.pathname === "/auth/v1/logout") return send(200, {});
    send(404, {});
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cloudCalls = [];
  const requestCloudApi = vi.fn(async (_base, path) => {
    cloudCalls.push(path);
    if (path === "/auth/config") return { supabase_url: origin, supabase_anon_key: publicKey };
    if (path === "/auth/initialize") return { initialized: true };
    throw new Error(`Forbidden cloud authentication broker call: ${path}`);
  });
  let saved = null; let opened = null;
  const service = createCloudAuthService({
    app: { getPath: () => "/unused" }, requestCloudApi, getWindows: () => [], revealWindow() {},
    credentialStore: { read: async () => saved, write: async value => { await beforeWrite(); saved = value; }, clear: async () => { saved = null; } },
    externalNavigation: { open: async url => { opened = url; } }, localCloudWebUrl: "https://web.example.test",
    logger: { error() {}, warn() {} },
  });
  cleanup.push(() => service.dispose());
  return { service, calls, cloudCalls, origin, requestCloudApi, saved: () => saved, opened: () => opened };
}
async function submit(f, action, fields = {}, headers = {}) {
  const page = new URL(f.opened());
  return fetch(new URL("/auth/login", page), {
    method: "POST", redirect: "manual",
    headers: { Origin: page.origin, "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ state: page.searchParams.get("state"), action, ...fields }),
  });
}
async function callbackForAuthorize(authorize) {
  const response = await fetch(authorize, { redirect: "manual" });
  const relay = new URL(response.headers.get("location"));
  const callback = new URL(relay.searchParams.get("desktop_callback"));
  callback.search = new URLSearchParams({ state: relay.searchParams.get("desktop_state"), code: relay.searchParams.get("code") }).toString();
  return callback;
}

it("completes actual HTTP OAuth code exchange with zero cloud handoff requests", async () => {
  const f = await fixture();
  await f.service.startOAuth({ apiBase: "https://api.puppyone.ai/api/v1" });
  const page = await fetch(f.opened());
  expect(page.headers.get("referrer-policy")).toBe("same-origin");
  expect(await page.text()).toContain("Continue with Google");
  const providerUrl = new URL(f.opened()); providerUrl.searchParams.set("provider", "google");
  const provider = await fetch(providerUrl, { redirect: "manual" });
  expect(provider.status).toBe(303);
  const callback = await callbackForAuthorize(provider.headers.get("location"));
  const wrong = new URL(callback); wrong.searchParams.set("state", "wrong");
  expect((await fetch(wrong)).status).toBe(400);
  const result = await fetch(callback);
  expect(result.status).toBe(200);
  expect(await result.text()).not.toContain("refresh-desktop");
  expect((await f.service.readSession()).status).toBe("authenticated");
  expect(f.saved().refresh_token).toBe("refresh-desktop-1");
  expect(f.saved()).not.toHaveProperty("access_token");
  expect(f.cloudCalls).toEqual(["/auth/config", "/auth/initialize"]);
  expect(f.calls.filter(call => call.path.includes("grant_type=pkce"))).toHaveLength(1);
  await f.service.clearSession();
  expect(f.calls.at(-1).path).toBe("/auth/v1/logout?scope=local");
  expect(f.saved()).toBeNull();
});

it("email password retries use Supabase directly and reject cross-origin submissions", async () => {
  const f = await fixture(); await f.service.startOAuth({ apiBase: "https://api.puppyone.ai/api/v1" });
  expect((await submit(f, "password", { email: "qa@example.test", password: "correct-password" }, { Origin: "https://evil.test" })).status).toBe(400);
  expect(f.calls.filter(call => call.path.includes("grant_type=password"))).toHaveLength(0);
  const failed = await submit(f, "password", { email: "qa@example.test", password: "wrong" });
  expect(await failed.text()).toContain("Unable to sign in");
  expect(await f.service.readSession()).toBeNull();
  const success = await submit(f, "password", { email: "qa@example.test", password: "correct-password" });
  expect(success.status).toBe(200);
  expect((await f.service.readSession()).user_id).toBe("user-1");
  expect(f.cloudCalls).toEqual(["/auth/config", "/auth/initialize"]);
});

it("signup confirmation and OTP produce only a Main-owned session", async () => {
  const f = await fixture(); await f.service.startOAuth({ apiBase: "https://api.puppyone.ai/api/v1" });
  const signup = await submit(f, "signup", { email: "qa@example.test", password: "correct-password" });
  expect(await signup.text()).toContain("Verification code");
  expect(await f.service.readSession()).toBeNull();
  const verified = await submit(f, "verify", { email: "qa@example.test", token: "123456" });
  expect(verified.status).toBe(200);
  expect((await f.service.readSession()).status).toBe("authenticated");
  expect(f.calls.map(c => c.path)).toContain("/auth/v1/verify");
});

it("Supabase rejects a code with the wrong verifier or a replay", async () => {
  const f = await fixture();
  const client = createSupabaseAuthClient({ requestCloudApi: f.requestCloudApi });
  const verifier = "a".repeat(43); const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const redirect = "https://web.example.test/auth/callback?desktop_state=state&desktop_callback=http%3A%2F%2F127.0.0.1%3A1234%2Fauth%2Fcallback";
  const authorize = await client.authorize("api", "google", redirect, challenge);
  const callback = await callbackForAuthorize(authorize); const code = callback.searchParams.get("code");
  await expect(client.exchange("api", code, "wrong-verifier")).rejects.toMatchObject({ status: 400 });
  const session = await client.exchange("api", code, verifier);
  expect(session.user.id).toBe("user-1");
  await expect(client.exchange("api", code, verifier)).rejects.toMatchObject({ status: 400 });
});

it("rejects privileged configuration keys before contacting a provider", async () => {
  const fetchImpl = vi.fn();
  const client = createSupabaseAuthClient({ requestCloudApi: async () => ({ supabase_url: "https://auth.example.test", supabase_anon_key: `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature` }), fetchImpl });
  await expect(client.providers("api")).rejects.toThrow("public authentication key");
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("logout wins over a credential write already in progress", async () => {
  let entered; let release;
  const writing = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture({ beforeWrite: async () => { entered(); await gate; } });
  await f.service.startOAuth({ apiBase: "https://api.puppyone.ai/api/v1", provider: "google" });
  const callback = await callbackForAuthorize(f.opened());
  const response = fetch(callback);
  await writing;
  const logout = f.service.clearSession();
  await vi.waitFor(async () => expect((await f.service.readState()).status).toBe("signing-out"));
  release();
  await logout;
  expect((await response).status).toBe(400);
  expect(await f.service.readSession()).toBeNull();
  expect(f.saved()).toBeNull();
});

it("rejects oversized forms and wrong Host before contacting Supabase", async () => {
  const f = await fixture();
  await f.service.startOAuth({ apiBase: "https://api.puppyone.ai/api/v1" });
  expect((await submit(f, "password", { password: "x".repeat(9000) })).status).toBe(413);
  const url = new URL(f.opened());
  const status = await new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { Host: "evil.test" } }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
  });
  expect(status).toBe(400);
  expect(f.calls.map(call => call.path)).toEqual(["/auth/v1/settings"]);
});
