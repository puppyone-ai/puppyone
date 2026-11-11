// Real Electron networking; only Cloud and the identity provider are fixtures.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, net, session } from "electron";
import { createCloudAuthService } from "../../../../electron/cloud-auth-service.mjs";
import { createCloudNetwork, requestCloudApi } from "../../../../electron/main/cloud-api-client.mjs";

const directory = process.env.PUPPYONE_AUTH_PROXY_QA_DIR;
assert.ok(directory, "Run through the isolated Node smoke launcher.");
app.setPath("userData", directory);
const checkpoint = name => process.stderr.write(`[cloud-auth-proxy] ${name}\n`);
checkpoint("module loaded");
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const publicKey = "sb_publishable_local_fixture";
const requests = [], services = [];
let authOrigin, apiOrigin, login;
let exchanges = 0, refreshes = 0, profiles = 0, logouts = 0;

function issueSession(number) {
  return {
    access_token: `header.${Buffer.from(JSON.stringify({ sub: "user-1", session_id: `session-${number}` })).toString("base64url")}.signature`,
    refresh_token: `fixture-refresh-${number}`, expires_in: 3600,
    user: { id: "user-1", email: "qa@example.test" },
  };
}

async function respond(request, response, viaProxy) {
  const url = new URL(request.url, apiOrigin);
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const send = (status, value) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (url.origin !== apiOrigin && url.origin !== authOrigin) return send(403, {});
  checkpoint(`${request.method} ${url.pathname}`);
  requests.push({ viaProxy, method: request.method, path: url.pathname, cookie: request.headers.cookie });
  if (url.pathname === "/api/v1/auth/config") return send(200, { data: { supabase_url: authOrigin, supabase_anon_key: publicKey } });
  if (url.origin === authOrigin) {
    assert.equal(request.headers.apikey, publicKey);
    if (url.pathname === "/auth/v1/settings") return send(200, { external: { email: true, google: true } });
    if (url.searchParams.get("grant_type") === "pkce") {
      exchanges += 1;
      assert.equal(exchanges, 1);
      assert.equal(body.auth_code, "fixture-code");
      assert.equal(crypto.createHash("sha256").update(body.code_verifier).digest("base64url"), login.searchParams.get("code_challenge"));
      return send(200, issueSession(1));
    }
    if (url.searchParams.get("grant_type") === "refresh_token") {
      refreshes += 1;
      assert.equal(body.refresh_token, "fixture-refresh-1");
      return send(200, issueSession(2));
    }
    if (url.pathname === "/auth/v1/logout") {
      logouts += 1;
      assert.equal(request.headers.authorization, `Bearer ${issueSession(2).access_token}`);
      return send(200, {});
    }
  }
  if (url.pathname === "/api/v1/auth/initialize") {
    assert.equal(request.headers.authorization, `Bearer ${issueSession(1).access_token}`);
    return send(200, { data: { initialized: true } });
  }
  if (url.pathname === "/api/v1/profile") {
    profiles += 1;
    if (profiles === 1) return send(401, { message: "fixture expired access token" });
    assert.equal(request.headers.authorization, `Bearer ${issueSession(2).access_token}`);
    return send(200, { data: { id: "user-1" } });
  }
  return send(404, {});
}

function fixture(options) {
  let saved = null;
  const opened = [];
  const service = createCloudAuthService({
    app: { getPath: () => directory, getAppPath: () => repositoryRoot },
    requestCloudApi, ...options, getWindows: () => [], revealWindow() {},
    localCloudWebUrl: "https://web.example.test", logger: { warn() {}, error() {} },
    externalNavigation: { open: async url => { opened.push(url); } },
    credentialStore: {
      read: async () => saved, write: async value => { saved = value; }, clear: async () => { saved = null; },
    },
  });
  services.push(service);
  return { service, opened, saved: () => saved };
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

function handler(viaProxy) {
  return (request, response) => {
    void respond(request, response, viaProxy).catch(error => {
      response.destroy();
      process.stderr.write(`${error.stack}\n`, () => app.exit(1));
    });
  };
}

async function run() {
  checkpoint("waiting for Electron");
  await app.whenReady();
  checkpoint("Electron ready");
  app.dock?.hide();
  // Keep the port reserved while rejecting direct requests. Releasing it here
  // could let another fixture accidentally reuse the identity provider's port.
  const direct = http.createServer(request => request.socket.destroy());
  authOrigin = await listen(direct);
  const api = http.createServer(handler(false));
  const proxy = http.createServer(handler(true));
  apiOrigin = await listen(api);
  const proxyOrigin = await listen(proxy);
  const apiBase = `${apiOrigin}/api/v1`;
  checkpoint("fixtures ready");
  try {
    await session.defaultSession.setProxy({ mode: "fixed_servers", proxyRules: new URL(proxyOrigin).host, proxyBypassRules: "<-loopback>" });
    await session.defaultSession.cookies.set({ url: authOrigin, name: "browser-session", value: "fixture-cookie" });
    checkpoint("proxy configured");
    const broken = fixture();
    await assert.rejects(broken.service.startOAuth({ apiBase }), { message: "fetch failed" });
    assert.deepEqual(broken.opened, []);
    assert.equal((await broken.service.readState()).status, "signed-out");
    assert.equal(requests.filter(item => item.viaProxy).length, 0);
    checkpoint("original failure reproduced");

    const network = createCloudNetwork({ fetchImpl: (input, init) => net.fetch(input, init) });
    const fixed = fixture({ requestCloudApi: network.requestCloudApi, fetchImpl: network.fetch });
    await fixed.service.startOAuth({ apiBase });
    checkpoint("browser sign-in started");
    assert.equal(fixed.opened.length, 1);
    login = new URL(fixed.opened[0]);
    const callback = new URL(login.searchParams.get("desktop_callback"));
    callback.search = new URLSearchParams({ state: login.searchParams.get("desktop_state"), code: "fixture-code" }).toString();
    const returned = await globalThis.fetch(callback);
    assert.equal(returned.status, 200);
    await returned.text();
    checkpoint("PKCE callback accepted");
    assert.equal((await fixed.service.readSession()).status, "authenticated");
    checkpoint("session read");
    assert.equal(fixed.saved().refresh_token, "fixture-refresh-1");
    assert.equal(Object.hasOwn(fixed.saved(), "access_token"), false);
    checkpoint("requesting profile");
    assert.deepEqual(await fixed.service.requestSessionApi(apiBase, "/profile", { method: "GET" }), { id: "user-1" });
    assert.equal(refreshes, 1);
    assert.equal(profiles, 2);
    assert.equal(fixed.saved().refresh_token, "fixture-refresh-2");
    checkpoint("token refreshed");
    await fixed.service.clearSession();
    assert.equal(logouts, 1);
    assert.equal(fixed.saved(), null);
    checkpoint("signed out");
    const proxied = requests.filter(item => item.viaProxy);
    for (const route of ["/api/v1/auth/config", "/auth/v1/settings", "/api/v1/auth/initialize"]) assert.ok(proxied.some(item => item.path === route));
    assert.ok(proxied.every(item => !item.cookie));
    const report = { result: "passed", platform: process.platform, electron: process.versions.electron,
      reproduced_before_fix: "fetch failed", browser_opened: true, pkce_exchange: exchanges,
      token_refresh: refreshes, logout: logouts, proxy_requests: proxied.length, browser_cookies_sent: false };
    await fs.writeFile(path.join(directory, "report.json"), JSON.stringify(report));
  } finally {
    checkpoint("cleaning fixtures");
    for (const service of services.reverse()) await service.dispose();
    await close(api);
    await close(proxy);
    await close(direct);
    checkpoint("fixtures closed");
  }
}

void run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
