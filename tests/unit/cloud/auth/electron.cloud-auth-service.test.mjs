import { describe, expect, it, vi } from "vitest";
import {
  createCloudAuthService,
  createPkceChallenge,
} from "../../../../electron/cloud-auth-service.mjs";

const API = "https://api.puppyone.ai/api/v1";

describe("main-owned Cloud Auth Broker", () => {
  it("adds auth without overriding the multipart boundary for managed Office uploads", async () => {
    const fixture = createFixture();
    fixture.requestCloudApi.mockImplementation(async (_apiBase, apiPath, init) => {
      if (apiPath === "/auth/refresh") {
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
      if (apiPath === "/auth/refresh") {
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
      if (apiPath === "/auth/refresh") {
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
      if (path === "/auth/refresh") {
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

  it("generates Desktop PKCE, binds the loopback redirect, exchanges the verifier once, and persists v2", async () => {
    const fixture = createFixture({ credential: null });
    let onCallback = null;
    let isExpectedCallback = null;
    fixture.startCallbackServer.mockImplementation(async ({
      onCallback: callback,
      isExpectedCallback: expectedCallback,
    }) => {
      onCallback = callback;
      isExpectedCallback = expectedCallback;
      return {
        redirectUri: "http://127.0.0.1:43123/auth/callback",
        close: vi.fn(async () => {}),
      };
    });
    fixture.requestCloudApi.mockImplementation(async (_base, path, init) => {
      const body = init.body ? JSON.parse(init.body) : {};
      if (path === "/auth/desktop/start") {
        expect(body).toMatchObject({
          callback_url: "http://127.0.0.1:43123/auth/callback",
          code_challenge_method: "S256",
        });
        expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
        return { state: "oauth-state-1", login_url: "https://app.puppyone.ai/login" };
      }
      if (path === "/auth/desktop/exchange") {
        expect(body).toMatchObject({
          code: "exchange-code",
          state: "oauth-state-1",
          redirect_uri: "http://127.0.0.1:43123/auth/callback",
        });
        expect(createPkceChallenge(body.code_verifier)).toHaveLength(43);
        return authResponse({ accessToken: jwtFor("oauth-user"), refreshToken: "oauth-refresh" });
      }
      if (path === "/auth/initialize") return { ok: true };
      throw new Error(`unexpected path ${path}`);
    });

    await fixture.service.startOAuth({ apiBase: API, provider: "github" });
    expect(fixture.openExternal).toHaveBeenCalledWith("https://app.puppyone.ai/login");
    expect(isExpectedCallback(
      "http://127.0.0.1:43123/auth/callback?state=oauth-state-1&code=exchange-code",
    )).toBe(true);
    expect(isExpectedCallback(
      "http://127.0.0.1:43123/auth/callback?state=wrong&code=exchange-code",
    )).toBe(false);

    await expect(fixture.service.startOAuth({ apiBase: API, provider: "github" }))
      .resolves.toEqual({ ok: true, pending: true });
    expect(fixture.openExternal).toHaveBeenCalledTimes(1);
    const signedIn = await onCallback(
      "http://127.0.0.1:43123/auth/callback?state=oauth-state-1&code=exchange-code",
    );

    expect(signedIn).toMatchObject({ user_id: "oauth-user", status: "authenticated" });
    expect(fixture.credentialStore.write).toHaveBeenCalledWith(expect.objectContaining({
      version: 2,
      user_id: "oauth-user",
      refresh_token: "oauth-refresh",
    }));
    await expect(fixture.service.handleCallback(
      "http://127.0.0.1:43123/auth/callback?state=oauth-state-1&code=exchange-code",
    )).resolves.toBeNull();
    expect(fixture.requestCloudApi.mock.calls.filter((call) => call[1] === "/auth/desktop/exchange"))
      .toHaveLength(1);
  });

  it("broadcasts an actionable error when browser sign-in expires", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ credential: null });
    const close = vi.fn(async () => {});
    fixture.startCallbackServer.mockResolvedValue({
      redirectUri: "http://127.0.0.1:43123/auth/callback",
      close,
    });
    fixture.requestCloudApi.mockResolvedValue({
      state: "oauth-state-timeout",
      login_url: "https://app.puppyone.ai/login",
    });

    try {
      await fixture.service.startOAuth({ apiBase: API, provider: "github" });
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

      expect(fixture.messages).toContainEqual([
        "cloud-auth:error",
        { message: "Cloud sign-in expired. Please try again." },
      ]);
      expect(close).toHaveBeenCalledOnce();
      await expect(fixture.service.readState()).resolves.toMatchObject({
        status: "signed-out",
        session: null,
      });
    } finally {
      fixture.service.dispose();
      vi.useRealTimers();
    }
  });

  it("does not open a blank browser when the local login page is unavailable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connection refused"));
    const fixture = createFixture({ credential: null, fetchImpl });
    fixture.startCallbackServer.mockResolvedValue({
      redirectUri: "http://127.0.0.1:43123/auth/callback",
      close: vi.fn(async () => {}),
    });
    fixture.requestCloudApi.mockResolvedValue({
      state: "oauth-state-local",
      login_url: "http://localhost:3000/login?client=desktop",
    });

    await expect(fixture.service.startOAuth({ apiBase: API }))
      .rejects.toThrow("Local Cloud login page is unavailable at http://localhost:3000");
    expect(fixture.openExternal).not.toHaveBeenCalled();
  });

  it("preflights the expected local Puppyone login page before opening it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("<h1>Sign in to Puppyone</h1>"),
    });
    const fixture = createFixture({ credential: null, fetchImpl });
    fixture.startCallbackServer.mockResolvedValue({
      redirectUri: "http://127.0.0.1:43123/auth/callback",
      close: vi.fn(async () => {}),
    });
    const loginUrl = "http://localhost:3000/login?client=desktop";
    fixture.requestCloudApi.mockResolvedValue({
      state: "oauth-state-local",
      login_url: loginUrl,
    });

    await expect(fixture.service.startOAuth({ apiBase: API })).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(loginUrl),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fixture.openExternal).toHaveBeenCalledWith(loginUrl);
  });

  it("always completes local logout and rejects an old-generation late result when remote revoke is unavailable", async () => {
    const fixture = createFixture({ windowCount: 2 });
    let resolveRequest;
    fixture.requestCloudApi.mockImplementation(async (_base, path) => {
      if (path === "/auth/refresh") return authResponse({ accessToken: jwtFor("user-123") });
      if (path === "/auth/logout") throw Object.assign(new Error("Not found"), { status: 404 });
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
      if (path === "/auth/refresh") {
        return authResponse({ accessToken: jwtFor("user-123", "initial") });
      }
      if (path === "/auth/initialize") return { ok: true };
      if (path === "/auth/desktop/start") {
        return { state: "replacement-state", login_url: "https://app.puppyone.ai/login" };
      }
      if (path === "/auth/desktop/exchange") {
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
      "http://127.0.0.1:43123/auth/callback?state=replacement-state&code=replacement-code",
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
    if (path === "/auth/refresh") {
      return authResponse({ accessToken: jwtFor("user-123", "initial") });
    }
    if (path === "/auth/initialize") return { ok: true };
    if (path === "/auth/desktop/start") {
      return { state: "replacement-state", login_url: "https://app.puppyone.ai/login" };
    }
    if (path === "/auth/desktop/exchange") {
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
    "http://127.0.0.1:43123/auth/callback?state=replacement-state&code=replacement-code",
  );
  resolveFirstProject({ stale: true });
  return {
    operationId,
    pending,
    projectRequests: () => projectCalls.length,
    projectHeaders: () => projectCalls.map((call) => call.headers),
  };
}

function createFixture({
  credential = createCredential(),
  fetchImpl = globalThis.fetch,
  localCloudWebUrl = "http://localhost:3000",
  windowCount = 1,
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
  const startCallbackServer = vi.fn();
  const service = createCloudAuthService({
    app: {
      getPath: () => "/unused",
      setAsDefaultProtocolClient: vi.fn(),
    },
    projectRoot: "/project",
    requestCloudApi,
    getWindows: () => windows,
    revealWindow: vi.fn(),
    credentialStore,
    fetchImpl,
    localCloudWebUrl,
    externalNavigation: { open: openExternal },
    startCallbackServer,
    logger: { warn: vi.fn(), error: vi.fn() },
  });
  return {
    service,
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
