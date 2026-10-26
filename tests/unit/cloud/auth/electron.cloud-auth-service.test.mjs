import { describe, expect, it, vi } from "vitest";
import {
  createCloudAuthService,
  createPkceChallenge,
} from "../../../../electron/cloud-auth-service.mjs";

const API = "https://api.puppyone.ai/api/v1";

describe("main-owned Cloud Auth Broker", () => {
  it("rejects a renderer mutation for a different account before dispatch or refresh", async () => {
    const fixture = createFixture();
    const state = await fixture.service.readSession();
    await expect(fixture.service.requestSessionApi(API, "/content/project/write", {
      method: "POST", body: JSON.stringify({ path: "a.md", content: "stale" }),
    }, { userId: "previous-account", generation: state.session_generation })).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(fixture.requestCloudApi).not.toHaveBeenCalled();
    fixture.service.dispose();
  });

  it("rejects an obsolete renderer generation even for the same account", async () => {
    const fixture = createFixture();
    await expect(fixture.service.requestSessionApi(API, "/projects/", { method: "GET" },
      { userId: "user-123", generation: "expired-generation" })).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(fixture.requestCloudApi).not.toHaveBeenCalled();
    fixture.service.dispose();
  });

  it("permits a matching renderer lease across a same-account token refresh", async () => {
    const fixture = createFixture();
    fixture.requestCloudApi.mockImplementation(async (_base, path) => path === "/token?grant_type=refresh_token"
      ? authResponse() : { ok: true });
    const session = await fixture.service.readSession();
    await expect(fixture.service.requestSessionApi(API, "/content/project/write", { method: "POST" },
      { userId: session.user_id, generation: session.session_generation })).resolves.toEqual({ ok: true });
    fixture.service.dispose();
  });

  it("preserves the caller's cancellation signal on an authenticated wallet request", async () => {
    const fixture = createFixture();
    let receivedSignal;
    fixture.requestCloudApi.mockImplementation(async (_base, path, init) => {
      if (path === "/token?grant_type=refresh_token") return authResponse({ accessToken: jwtFor("user-123") });
      if (path === "/auth/initialize") return { ok: true };
      receivedSignal = init.signal;
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    });
    const controller = new AbortController();
    const request = fixture.service.requestSessionApi(API, "/ai/balance", { method: "GET", signal: controller.signal });
    const rejected = expect(request).rejects.toThrow("Compute deadline");
    await vi.waitFor(() => expect(receivedSignal).toBeDefined());
    controller.abort(new Error("Compute deadline"));
    await rejected;
    expect(receivedSignal.aborted).toBe(true);
    fixture.service.dispose();
  });

  it("keeps Agent bearer auth in Main and aborts the open stream on sign-out", async () => {
    const fetchImpl = vi.fn(async () => new Response("data: started\n\n", { headers: { "content-type": "text/event-stream" } }));
    const fixture = createFixture({ fetchImpl });
    fixture.requestCloudApi.mockImplementation(async (_base, path) => path === "/token?grant_type=refresh_token"
      ? authResponse({ accessToken: jwtFor("user-123") }) : { ok: true });
    const observed = [];
    fixture.service.subscribe((state) => observed.push(state));
    const opened = await fixture.service.openAgentStream(API, JSON.stringify({ model: "test/model" }), { requestId: "test-inference-001" });
    expect(opened.response.status).toBe(200);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${API}/ai/chat/completions`);
    const init = fetchImpl.mock.calls[0][1];
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(init.headers["Idempotency-Key"]).toBe("test-inference-001");
    expect(init.headers["X-Request-Id"]).toBe("test-inference-001");
    expect(init.redirect).toBe("error");
    expect(init.signal.aborted).toBe(false);
    await fixture.service.clearSession();
    expect(init.signal.aborted).toBe(true);
    expect(JSON.stringify(observed)).not.toMatch(/access_token|refresh_token|Bearer/);
    opened.close();
    fixture.service.dispose();
  });

  it("adds auth without overriding the multipart boundary for managed Office uploads", async () => {
    const fixture = createFixture();
    fixture.requestCloudApi.mockImplementation(async (_apiBase, apiPath, init) => {
      if (apiPath === "/token?grant_type=refresh_token") {
        return authResponse({ accessToken: jwtFor("user-123") });
      }
      if (apiPath === "/auth/initialize") return { ok: true };
      expect(apiPath).toBe("/office/sessions");
      expect(init.body).toBeInstanceOf(FormData);
      expect(init.headers.Authorization).toMatch(/^Bearer /);
      expect(init.headers).not.toHaveProperty("Content-Type");
      return { session_id: "session-1" };
    });
    const body = new FormData();
    body.append("file", new Blob(["office"]), "report.docx");

    await expect(fixture.service.requestSessionApi(API, "/office/sessions", {
      method: "POST",
      body,
    })).resolves.toEqual({ session_id: "session-1" });
  });

  it("coalesces twenty concurrent restore/API requests into one refresh and never exposes tokens", async () => {
    const fixture = createFixture();
    let refreshCount = 0;
    fixture.requestCloudApi.mockImplementation(async (_apiBase, apiPath, init) => {
      if (apiPath === "/token?grant_type=refresh_token") {
        refreshCount += 1;
        await Promise.resolve();
        return authResponse({ accessToken: jwtFor("user-123"), refreshToken: "rotated-refresh" });
      }
      expect(init.headers.Authorization).toMatch(/^Bearer /);
      return { ok: true, path: apiPath };
    });

    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (
      fixture.service.requestSessionApi(API, `/projects/${index}`, { method: "GET" })
    )));

    expect(refreshCount).toBe(1);
    expect(results).toHaveLength(20);
    expect(fixture.credentialStore.write).toHaveBeenCalledTimes(1);
    expect(fixture.credentialStore.write.mock.calls[0][0]).not.toHaveProperty("access_token");
    const publicSession = await fixture.service.readSession();
    expect(publicSession).toMatchObject({
      user_id: "user-123",
      user_email: "user@example.com",
      status: "authenticated",
    });
    expect(publicSession).not.toHaveProperty("access_token");
    expect(publicSession).not.toHaveProperty("refresh_token");
  });

  it("coalesces twenty concurrent late 401 responses into one access-token refresh", async () => {
    const fixture = createFixture();
    const initialAccessToken = jwtFor("user-123", "initial");
    const rotatedAccessToken = jwtFor("user-123", "rotated");
    let refreshCount = 0;
    let initialRequests = 0;
    let releaseInitialRequests;
    const allInitialRequestsStarted = new Promise((resolve) => {
      releaseInitialRequests = resolve;
    });

    fixture.requestCloudApi.mockImplementation(async (_apiBase, apiPath, init) => {
      if (apiPath === "/token?grant_type=refresh_token") {
        refreshCount += 1;
        return authResponse({
          accessToken: refreshCount === 1 ? initialAccessToken : rotatedAccessToken,
          refreshToken: `rotated-refresh-${refreshCount}`,
        });
      }
      if (apiPath === "/auth/initialize") return { ok: true };

      if (init.headers.Authorization === `Bearer ${initialAccessToken}`) {
        initialRequests += 1;
        if (initialRequests === 20) releaseInitialRequests();
        await allInitialRequestsStarted;
        throw Object.assign(new Error("Access token expired"), { status: 401 });
      }

      expect(init.headers.Authorization).toBe(`Bearer ${rotatedAccessToken}`);
      return { ok: true, path: apiPath };
    });

    await fixture.service.restoreSession(API);
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (
      fixture.service.requestSessionApi(API, `/projects/late-${index}`, { method: "GET" })
    )));

    expect(initialRequests).toBe(20);
    expect(refreshCount).toBe(2);
    expect(results).toHaveLength(20);
    expect(fixture.credentialStore.write).toHaveBeenCalledTimes(2);
  });

  it("keeps the credential and returns offline-authenticated on a network refresh failure", async () => {
    const fixture = createFixture();
    fixture.requestCloudApi.mockRejectedValue(new Error("Unable to reach Cloud API"));

    const restored = await fixture.service.restoreSession(API);

    expect(restored).toMatchObject({
      user_id: "user-123",
      status: "offline-authenticated",
    });
    expect(fixture.credentialStore.clear).not.toHaveBeenCalled();
  });

  it("clears a revoked refresh credential but does not refresh or clear on a 403 API response", async () => {
    const revoked = createFixture();
    const invalid = Object.assign(new Error("Refresh failed: invalid session"), { status: 401 });
    revoked.requestCloudApi.mockRejectedValue(invalid);
    await expect(revoked.service.restoreSession(API)).resolves.toBeNull();
    expect(revoked.credentialStore.clear).toHaveBeenCalledTimes(1);

    const forbidden = createFixture();
    let refreshCount = 0;
    forbidden.requestCloudApi.mockImplementation(async (_base, path) => {
      if (path === "/token?grant_type=refresh_token") {
        refreshCount += 1;
        return authResponse({ accessToken: jwtFor("user-123") });
      }
      throw Object.assign(new Error("Admin role required"), { status: 403 });
    });
    await forbidden.service.restoreSession(API);
    await expect(forbidden.service.requestSessionApi(API, "/projects/p1/scopes", {}))
      .rejects.toMatchObject({ status: 403 });
    expect(refreshCount).toBe(1);
    expect(forbidden.credentialStore.clear).not.toHaveBeenCalled();
  });

  it("owns Supabase PKCE, consumes callbacks once and never calls a cloud handoff", async () => {
    const fixture = createFixture({ credential: null });
    fixture.requestCloudApi.mockImplementation(async (_base, path, init) => {
      if (path === "/token?grant_type=pkce") {
        const body = JSON.parse(init.body);
        const url = new URL(fixture.openExternal.mock.calls[0][0]);
        expect(createPkceChallenge(body.code_verifier)).toBe(url.searchParams.get("code_challenge"));
        return authResponse();
      }
      return { ok: true };
    });
    await fixture.service.startOAuth({ apiBase: API, provider: "google" });
    expect(new URL(fixture.openExternal.mock.calls[0][0]).pathname).toBe("/login");
    expect(new URL(fixture.openExternal.mock.calls[0][0]).origin).toBe("http://localhost:3000");
    const callback = nativeCallback(fixture, "provider-code");
    expect(await fixture.service.handleCallback(callback)).toMatchObject({ status: "authenticated" });
    expect(await fixture.service.handleCallback(callback)).toBeNull();
    expect(fixture.requestCloudApi.mock.calls.filter(call => call[1] === "/token?grant_type=pkce")).toHaveLength(1);
    expect(fixture.requestCloudApi.mock.calls.some(call => call[1].startsWith("/auth/desktop"))).toBe(false);
    fixture.service.dispose();
  });

  it("expires pending native login and closes the listener", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ credential: null });
    try {
      await fixture.service.startOAuth({ apiBase: API });
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(fixture.messages).toContainEqual(["cloud-auth:error", { message: "Cloud sign-in expired. Please try again." }]);
      expect((await fixture.service.readState()).status).toBe("signed-out");
      expect(fixture.closeCallback).toHaveBeenCalledOnce();
    } finally { fixture.service.dispose(); vi.useRealTimers(); }
  });

  it("rejects a mismatched port or state without consuming the valid attempt", async () => {
    const fixture = createFixture({ credential: null });
    fixture.requestCloudApi.mockImplementation(async () => authResponse());
    await fixture.service.startOAuth({ apiBase: API, provider: "github" });
    const callback = nativeCallback(fixture, "provider-code");
    expect(await fixture.service.handleCallback(callback.replace(":43123/", ":43124/"))).toBeNull();
    expect(await fixture.service.handleCallback(callback.replace("state=", "state=wrong"))).toBeNull();
    expect(await fixture.service.handleCallback(callback)).toMatchObject({ status: "authenticated" });
    fixture.service.dispose();
  });

  it("cannot adopt a delayed OAuth response after sign-out", async () => {
    const fixture = createFixture({ credential: null });
    let finish;
    fixture.requestCloudApi.mockImplementation(async (_base, path) => path === "/token?grant_type=pkce"
      ? new Promise(resolve => { finish = resolve; }) : { ok: true });
    await fixture.service.startOAuth({ apiBase: API, provider: "google" });
    const pending = fixture.service.handleCallback(nativeCallback(fixture, "code"));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await fixture.service.clearSession();
    finish(authResponse());
    expect(await pending).toBeNull();
    expect(await fixture.service.readSession()).toBeNull();
    fixture.service.dispose();
  });

  it("always completes local logout and rejects an old-generation late result when remote revoke is unavailable", async () => {
    const fixture = createFixture({ windowCount: 2 });
    let resolveRequest;
    fixture.requestCloudApi.mockImplementation(async (_base, path) => {
      if (path === "/token?grant_type=refresh_token") return authResponse({ accessToken: jwtFor("user-123") });
      if (path === "/logout?scope=local") throw Object.assign(new Error("Not found"), { status: 404 });
      if (path === "/auth/initialize") return { ok: true };
      return new Promise((resolve) => { resolveRequest = resolve; });
    });
    await fixture.service.restoreSession(API);
    const pending = fixture.service.requestSessionApi(API, "/projects", {});
    await vi.waitFor(() => expect(resolveRequest).toBeTypeOf("function"));

    await fixture.service.clearSession();
    resolveRequest({ stale: true });

    await expect(pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(fixture.credentialStore.clear).toHaveBeenCalledTimes(1);
    expect(await fixture.service.readSession()).toBeNull();
    expect(fixture.messages).toContainEqual(["cloud-session:changed", null]);
    for (const messages of fixture.windowMessages) {
      expect(messages.at(-1)).toEqual(["cloud-session:changed", null]);
    }
  });

  it("replays a read-only repository-context POST once after a newer session generation wins", async () => {
    const fixture = createFixture();
    let onCallback = null;
    let resolveFirstContext;
    let contextRequests = 0;
    fixture.startCallbackServer.mockImplementation(async ({ onCallback: callback }) => {
      onCallback = callback;
      return {
        redirectUri: "http://127.0.0.1:43123/auth/callback",
        close: vi.fn(async () => {}),
      };
    });
    fixture.requestCloudApi.mockImplementation(async (_base, path, init) => {
      if (path === "/token?grant_type=refresh_token") {
        return authResponse({ accessToken: jwtFor("user-123", "initial") });
      }
      if (path === "/auth/initialize") return { ok: true };
      if (path === "/token?grant_type=pkce") {
        return authResponse({
          accessToken: jwtFor("user-123", "replacement"),
          refreshToken: "replacement-refresh",
        });
      }
      if (path === "/projects/project-1/repository-context") {
        contextRequests += 1;
        expect(init.method).toBe("POST");
        if (contextRequests === 1) {
          return new Promise((resolve) => { resolveFirstContext = resolve; });
        }
        expect(init.headers.Authorization).toBe(`Bearer ${jwtFor("user-123", "replacement")}`);
        return { project: { id: "project-1" } };
      }
      throw new Error(`unexpected path ${path}`);
    });

    await fixture.service.restoreSession(API);
    const pending = fixture.service.requestSessionApi(
      API,
      "/projects/project-1/repository-context",
      { method: "POST", body: JSON.stringify({ target: { kind: "project_root", project_id: "project-1" } }) },
    );
    await vi.waitFor(() => expect(resolveFirstContext).toBeTypeOf("function"));

    await fixture.service.startOAuth({ apiBase: API, provider: "github" });
    await onCallback(
      nativeCallback(fixture, "replacement-code"),
    );
    resolveFirstContext({ stale: true });

    await expect(pending).resolves.toEqual({ project: { id: "project-1" } });
    expect(contextRequests).toBe(2);
  });

  it("replays a keyed main-owned mutation once when only the same user's generation changes", async () => {
    const operation = await projectMutationAcrossOAuth({ replacementUserId: "user-123" });

    await expect(operation.pending).resolves.toEqual({ id: "project-1" });
    expect(operation.projectRequests()).toBe(2);
    expect(operation.projectHeaders()).toEqual([
      expect.objectContaining({ "Idempotency-Key": operation.operationId }),
      expect.objectContaining({ "Idempotency-Key": operation.operationId }),
    ]);
  });

  it("never replays an idempotent mutation under a different Cloud actor", async () => {
    const operation = await projectMutationAcrossOAuth({ replacementUserId: "user-other" });

    await expect(operation.pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(operation.projectRequests()).toBe(1);
  });

  it("does not replay a main-owned mutation without a canonical idempotency key", async () => {
    const operation = await projectMutationAcrossOAuth({
      replacementUserId: "user-123",
      includeIdempotencyKey: false,
    });

    await expect(operation.pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(operation.projectRequests()).toBe(1);
  });
});

async function projectMutationAcrossOAuth({ replacementUserId, includeIdempotencyKey = true }) {
  const fixture = createFixture();
  const operationId = "11111111-1111-4111-8111-111111111111";
  let onCallback = null;
  let resolveFirstProject;
  const projectCalls = [];
  fixture.startCallbackServer.mockImplementation(async ({ onCallback: callback }) => {
    onCallback = callback;
    return {
      redirectUri: "http://127.0.0.1:43123/auth/callback",
      close: vi.fn(async () => {}),
    };
  });
  fixture.requestCloudApi.mockImplementation(async (_base, path, init) => {
    if (path === "/token?grant_type=refresh_token") {
      return authResponse({ accessToken: jwtFor("user-123", "initial") });
    }
    if (path === "/auth/initialize") return { ok: true };
    if (path === "/token?grant_type=pkce") {
      return authResponse({
        accessToken: jwtFor(replacementUserId, "replacement"),
        refreshToken: "replacement-refresh",
      });
    }
    if (path === "/projects/") {
      projectCalls.push(init);
      if (projectCalls.length === 1) {
        return new Promise((resolve) => { resolveFirstProject = resolve; });
      }
      return { id: "project-1" };
    }
    throw new Error(`unexpected path ${path}`);
  });

  await fixture.service.restoreSession(API);
  const pending = fixture.service.requestSessionApi(API, "/projects/", {
    method: "POST",
    headers: includeIdempotencyKey ? { "Idempotency-Key": operationId } : {},
    body: JSON.stringify({ org_id: "org-1", name: "Project", description: null }),
  });
  await vi.waitFor(() => expect(resolveFirstProject).toBeTypeOf("function"));
  await fixture.service.startOAuth({ apiBase: API, provider: "github" });
  await onCallback(
    nativeCallback(fixture, "replacement-code"),
  );
  resolveFirstProject({ stale: true });
  return {
    operationId,
    pending,
    projectRequests: () => projectCalls.length,
    projectHeaders: () => projectCalls.map((call) => call.headers),
  };
}

describe("Main-only template authorization", () => {
  const request = { id: "b91aaade-bc9e-4dfd-8f23-11f06ec00301", releaseId: "b91aaade-bc9e-4dfd-8f23-11f06ec00101" };
  const config = { origin: "https://www.puppyone.ai", apiBase: API };
  it("refreshes an expired session and sends tokens only to the fixed website origin", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ schema_version: 1 }));
    const fixture = createFixture({ fetchImpl, templateMarketplace: config });
    fixture.requestCloudApi.mockImplementation(async () => authResponse());
    expect(await fixture.service.requestTemplateDownload(request)).toEqual({ schema_version: 1 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${config.origin}/api/templates/${request.id}/download`);
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe(`Bearer ${jwtFor("user-123")}`);
    expect(JSON.parse(init.body)).toEqual({ release_id: request.releaseId });
    expect(JSON.stringify(fixture.messages)).not.toContain(jwtFor("user-123"));
    fixture.service.dispose();
  });
  it("refreshes once on a 401 and preserves the same account lease", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("expired", { status: 401 })).mockResolvedValueOnce(Response.json({ ok: true }));
    const fixture = createFixture({ fetchImpl, templateMarketplace: config });
    fixture.requestCloudApi.mockImplementation(async () => authResponse());
    const before = await fixture.service.readSession();
    expect(await fixture.service.requestTemplateDownload(request)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await fixture.service.readSession()).session_generation).toBe(before.session_generation);
    fixture.service.dispose();
  });
  it("rejects signed-out, foreign-tenant and malformed requests without dispatch", async () => {
    for (const credential of [null, { ...createCredential(), api_origin: "https://another.example/api/v1" }]) {
      const fetchImpl = vi.fn(); const fixture = createFixture({ credential, fetchImpl, templateMarketplace: config });
      await expect(fixture.service.requestTemplateDownload(request)).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
      fixture.service.dispose();
    }
    const fixture = createFixture({ fetchImpl: vi.fn(), templateMarketplace: config });
    await expect(fixture.service.requestTemplateDownload({ ...request, id: "../../private" })).rejects.toThrow();
    expect(fixture.requestCloudApi).not.toHaveBeenCalled();
    fixture.service.dispose();
  });
});

function createFixture({
  credential = createCredential(),
  fetchImpl = globalThis.fetch,
  localCloudWebUrl = "http://localhost:3000",
  returnAppUrl = null,
  windowCount = 1,
  templateMarketplace = null,
} = {}) {
  let storedCredential = credential;
  const credentialStore = {
    read: vi.fn(async () => storedCredential),
    write: vi.fn(async (next) => {
      storedCredential = next;
      return next;
    }),
    clear: vi.fn(async () => {
      storedCredential = null;
    }),
  };
  const windowMessages = Array.from({ length: windowCount }, () => []);
  const windows = windowMessages.map((messages) => ({
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => messages.push([channel, payload]) },
  }));
  const messages = windowMessages[0];
  const requestCloudApi = vi.fn();
  const openExternal = vi.fn(async () => ({ ok: true }));
  const closeCallback = vi.fn(async () => {});
  const startCallbackServer = vi.fn(async () => ({ redirectUri: "http://127.0.0.1:43123/auth/callback", close: closeCallback }));
  // A shared fake dispatcher lets the session-owner tests coordinate delayed
  // business and identity responses; adapter tests verify the actual origins.
  const supabaseAuth = {
    providers: vi.fn(async () => ["email", "google", "github"]),
    authorize: vi.fn(async (_base, provider, redirect, challenge) => {
      const url = new URL("https://auth.example.test/auth/v1/authorize");
      url.search = new URLSearchParams({ provider, redirect_to: redirect, code_challenge: challenge }).toString();
      return url.toString();
    }),
    exchange: (base, code, verifier) => requestCloudApi(base, "/token?grant_type=pkce", { method: "POST", body: JSON.stringify({ auth_code: code, code_verifier: verifier }) }),
    refresh: (base, token) => requestCloudApi(base, "/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: token }) }),
    logout: (base, token) => requestCloudApi(base, "/logout?scope=local", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
  };
  const service = createCloudAuthService({
    app: {
      getPath: () => "/unused",
      setAsDefaultProtocolClient: vi.fn(),
    },
    projectRoot: "/project",
    supabaseAuth,
    requestCloudApi,
    getWindows: () => windows,
    revealWindow: vi.fn(),
    credentialStore,
    fetchImpl,
    localCloudWebUrl,
    returnAppUrl,
    templateMarketplace,
    externalNavigation: { open: openExternal },
    startCallbackServer,
    logger: { warn: vi.fn(), error: vi.fn() },
  });
  return {
    service,
    closeCallback,
    supabaseAuth,
    requestCloudApi,
    credentialStore,
    openExternal,
    startCallbackServer,
    messages,
    windowMessages,
  };
}

function createCredential() {
  return {
    version: 2,
    user_id: "user-123",
    user_email: "user@example.com",
    api_origin: API,
    refresh_token: "refresh-token",
    updated_at: "2026-07-11T00:00:00.000Z",
  };
}

function authResponse({
  accessToken = jwtFor("user-123"),
  refreshToken = "refresh-token",
} = {}) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600,
    user_email: "user@example.com",
  };
}

function jwtFor(subject, signature = "signature") {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: subject })).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function nativeCallback(fixture, code) {
  const relay = new URL(fixture.openExternal.mock.calls.at(-1)[0]);
  const callback = new URL(relay.searchParams.get("desktop_callback"));
  callback.search = new URLSearchParams({ state: relay.searchParams.get("desktop_state"), code }).toString();
  return callback.toString();
}
