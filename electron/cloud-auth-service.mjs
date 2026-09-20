import crypto from "node:crypto";
import path from "node:path";
import {
  formatCloudApiHost,
  normalizeCloudApiBaseUrl,
} from "../shared/cloudEndpoint.js";
import { createCredentialStore } from "./main/auth/credential-store.mjs";
import { startLoopbackCallbackServer } from "./main/auth/loopback-callback-server.mjs";

const DEFAULT_SESSION_STATE_FILENAME = "desktop-cloud-session.json";
const SESSION_REFRESH_SKEW_MS = 60_000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const LOGOUT_TIMEOUT_MS = 4_000;

export function createCloudAuthService({
  app,
  requestCloudApi,
  getWindows,
  revealWindow,
  secureStorage,
  externalNavigation,
  startCallbackServer = startLoopbackCallbackServer,
  fetchImpl = globalThis.fetch,
  localCloudWebUrl = null,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  logger = console,
  credentialStore: providedCredentialStore = null,
}) {
  if (!providedCredentialStore && !secureStorage) {
    throw new TypeError("Cloud authentication secureStorage is required.");
  }
  if (!externalNavigation || typeof externalNavigation.open !== "function") {
    throw new TypeError("Cloud authentication requires the external navigation service.");
  }
  const credentialStore = providedCredentialStore ?? createCredentialStore({
    filePath: path.join(app.getPath("userData"), DEFAULT_SESSION_STATE_FILENAME),
    secureStorage,
    now,
    logger,
  });
  const pendingOAuthStates = new Map();
  const pendingOAuthStarts = new Map();
  const refreshPromises = new Map();
  const activeRequestControllers = new Set();
  const stateSubscribers = new Set();
  const initializedSessionGenerations = new Set();
  const initializationPromises = new Map();

  let credentialLoaded = false;
  let credential = null;
  let runtimeSession = null;
  let authStatus = "signed-out";
  let sessionGeneration = createSessionGeneration(randomBytes);
  let disposed = false;

  async function readSession() {
    await ensureCredentialLoaded();
    return toPublicSession(getSessionSource(), authStatus, sessionGeneration);
  }

  async function readState() {
    await ensureCredentialLoaded();
    return toPublicState();
  }

  async function restoreSession(apiBase) {
    const normalizedApiBase = normalizeCloudApiBaseUrl(apiBase);
    await ensureCredentialLoaded();
    if (!credential || !isSessionForApiBase(credential, normalizedApiBase)) return null;

    if (runtimeSession && isFreshSession(runtimeSession, now())) {
      setAuthStatus("authenticated", { broadcast: false });
      return toPublicSession(runtimeSession, authStatus, sessionGeneration);
    }

    try {
      const session = await refreshSessionSingleflight(normalizedApiBase ?? credential.api_origin);
      return toPublicSession(session, authStatus, sessionGeneration);
    } catch (error) {
      if (isRefreshCredentialInvalid(error)) return null;
      if (error?.code === "SESSION_CHANGED") {
        // A concurrent refresh/sign-in adopted a newer generation. This is
        // internal coordination, not an offline signal.
        return toPublicSession(getSessionSource(), authStatus, sessionGeneration);
      }
      // Network and server availability failures do not destroy a valid refresh
      // credential. The renderer can keep local work available and show offline.
      setAuthStatus("offline-authenticated");
      return toPublicSession(credential, authStatus, sessionGeneration);
    }
  }

  async function startOAuth({ apiBase, provider }) {
    assertNotDisposed();
    const normalizedApiBase = normalizeCloudApiBaseUrl(apiBase);
    if (!normalizedApiBase) throw new Error("Cloud API base URL is invalid.");
    await ensureCredentialLoaded();
    const normalizedProvider = normalizeOAuthProvider(provider);
    const startKey = getOAuthStartKey(normalizedApiBase);
    const pendingState = findPendingOAuthState(startKey);
    if (pendingState) return { ok: true, pending: true };
    const existing = pendingOAuthStarts.get(startKey);
    if (existing) return existing;

    const previousStatus = authStatus;
    const request = (async () => {
      setAuthStatus("signing-in");
      const verifier = createPkceVerifier(randomBytes);
      const challenge = createPkceChallenge(verifier);
      let callbackServer = null;
      try {
        callbackServer = await startCallbackServer({
          logger,
          onCallback: (callbackUrl) => handleCallback(callbackUrl),
          isExpectedCallback: (callbackUrl) => isExpectedPendingCallback(callbackUrl),
        });
        const callbackUrl = requireLoopbackRedirectUri(callbackServer?.redirectUri);
        const start = await requestCloudApi(normalizedApiBase, "/auth/desktop/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: normalizedProvider,
            callback_url: callbackUrl,
            code_challenge: challenge,
            code_challenge_method: "S256",
          }),
        });
        const state = requireNonEmptyString(start?.state, "Cloud sign-in start did not return state.");
        const loginUrl = requireSecureBrowserUrl(
          start?.login_url,
          "Cloud sign-in start did not return a secure browser URL.",
        );
        await assertLocalLoginPageReachable(loginUrl, fetchImpl, localCloudWebUrl);
        const timeout = setTimeout(() => {
          clearPendingOAuthState(state);
          restoreStatusAfterOAuth(previousStatus);
          broadcastAuthError("Cloud sign-in expired. Please try again.");
          broadcastPublicState();
        }, OAUTH_STATE_TTL_MS);
        timeout.unref?.();

        pendingOAuthStates.set(state, {
          startKey,
          apiBase: normalizedApiBase,
          provider: normalizedProvider,
          callbackUrl,
          verifier,
          challenge,
          callbackServer,
          timeout,
          createdAt: now(),
          previousStatus,
        });
        callbackServer = null;

        await externalNavigation.open(loginUrl);
        return { ok: true };
      } catch (error) {
        await callbackServer?.close?.().catch(() => undefined);
        restoreStatusAfterOAuth(previousStatus);
        broadcastPublicState();
        throw error;
      }
    })();

    pendingOAuthStarts.set(startKey, request);
    try {
      return await request;
    } finally {
      if (pendingOAuthStarts.get(startKey) === request) pendingOAuthStarts.delete(startKey);
    }
  }

  async function handleCallback(callbackUrl) {
    try {
      const url = new URL(callbackUrl);
      const state = url.searchParams.get("state");
      const pending = state ? pendingOAuthStates.get(state) : null;
      if (!pending) throw new Error("Cloud sign-in callback expired. Please sign in again.");
      if (!isExactCallbackRedirect(url, pending.callbackUrl)) {
        throw new Error("Cloud sign-in callback redirect did not match the pending request.");
      }
      if (now() - pending.createdAt > OAUTH_STATE_TTL_MS) {
        clearPendingOAuthState(state);
        throw new Error("Cloud sign-in callback expired. Please sign in again.");
      }

      const errorDescription = url.searchParams.get("error_description") || url.searchParams.get("error");
      if (errorDescription) {
        clearPendingOAuthState(state);
        throw new Error(errorDescription);
      }
      const code = requireNonEmptyString(url.searchParams.get("code"), "Cloud sign-in callback is missing a code.");

      // Consume the local flow before exchange. Replayed callbacks can no longer
      // obtain the verifier, even if the backend code has not yet been consumed.
      clearPendingOAuthState(state);
      const data = await requestCloudApi(pending.apiBase, "/auth/desktop/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          state,
          code_verifier: pending.verifier,
          redirect_uri: pending.callbackUrl,
        }),
      });
      const session = buildSessionFromAuth(data, {
        fallbackEmail: data?.user?.email,
        fallbackRefreshToken: "",
        fallbackUserId: null,
        apiOrigin: pending.apiBase,
        now,
      });
      await adoptAuthenticatedSession(session, { rotateGeneration: true });
      // Account initialization is idempotent application setup, not part of
      // proving identity. Keep the securely persisted session and retry setup
      // on later Cloud requests if this first attempt is temporarily down.
      await initializeCurrentSessionBestEffort(pending.apiBase, session);
      revealWindow();
      return toPublicSession(runtimeSession, authStatus, sessionGeneration);
    } catch (error) {
      logger.error?.("Cloud OAuth callback failed:", safeErrorMessage(error));
      if (!runtimeSession) setAuthStatus(credential ? "offline-authenticated" : "signed-out", { broadcast: false });
      broadcastAuthError(safeErrorMessage(error, "Cloud sign-in failed."));
      broadcastPublicState();
      revealWindow();
      return null;
    }
  }

  // Main-only streaming boundary. The general renderer JSON bridge cannot ask
  // for this response or receive the bearer credential.
  async function openAgentStream(apiBase, body, { signal, requestId } = {}) {
    await requestSessionApi(apiBase, "/ai/balance", { method: "GET" });
    const normalized = normalizeCloudApiBaseUrl(apiBase);
    const captured = runtimeSession;
    const generation = sessionGeneration;
    if (!captured || !isSessionForApiBase(captured, normalized)) throw createSignedOutError(normalized);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    activeRequestControllers.add(controller);
    const close = () => {
      controller.abort();
      signal?.removeEventListener("abort", abort);
      activeRequestControllers.delete(controller);
    };
    try {
      const response = await fetchImpl(`${normalized}/ai/chat/completions`, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${captured.access_token}`,
          "Idempotency-Key": requestId }, body,
      });
      if (generation !== sessionGeneration) throw createSessionChangedError();
      return { response, close };
    } catch (error) { close(); throw error; }
  }

  async function requestSessionApi(apiBase, apiPath, init = {}) {
    assertNotDisposed();
    if (authStatus === "signing-out") {
      const error = new Error("Cloud sign-out is in progress.");
      error.code = "SESSION_SIGNING_OUT";
      throw error;
    }
    const normalizedApiBase = normalizeCloudApiBaseUrl(apiBase);
    if (!normalizedApiBase) throw new Error("Cloud API base URL is invalid.");
    await ensureCredentialLoaded();
    if (!credential || !isSessionForApiBase(credential, normalizedApiBase)) {
      throw createSignedOutError(normalizedApiBase);
    }

    let session = runtimeSession;
    if (!session || !isFreshSession(session, now())) {
      session = await refreshSessionSingleflight(normalizedApiBase);
    }
    const requestActorId = session.user_id;

    await initializeCurrentSessionBestEffort(normalizedApiBase, session);

    const requestGeneration = sessionGeneration;
    try {
      const result = await performAuthenticatedRequest(
        normalizedApiBase,
        apiPath,
        init,
        session,
        requestGeneration,
      );
      setAuthStatus("authenticated");
      return result;
    } catch (error) {
      if (error?.code === "SESSION_CHANGED" && isSafeSessionRetry(apiPath, init)) {
        return retrySessionApiWithCurrentGeneration(
          normalizedApiBase,
          apiPath,
          init,
          requestActorId,
        );
      }
      if (!isAccessTokenFailure(error)) {
        if (isNetworkFailure(error)) setAuthStatus("offline-authenticated");
        throw error;
      }

      // Another request may already have rotated the access token while this
      // request's 401 was in flight. Reuse that newer runtime session instead
      // of starting a second refresh after the first singleflight completed.
      const refreshed = runtimeSession?.access_token
        && runtimeSession.access_token !== session.access_token
        && isFreshSession(runtimeSession, now())
        ? runtimeSession
        : await refreshSessionSingleflight(normalizedApiBase);
      try {
        return await performAuthenticatedRequest(
          normalizedApiBase,
          apiPath,
          init,
          refreshed,
          requestGeneration,
        );
      } catch (retryError) {
        if (retryError?.code === "SESSION_CHANGED" && isSafeSessionRetry(apiPath, init)) {
          return retrySessionApiWithCurrentGeneration(
            normalizedApiBase,
            apiPath,
            init,
            requestActorId,
          );
        }
        throw retryError;
      }
    }
  }

  async function retrySessionApiWithCurrentGeneration(apiBase, apiPath, init, expectedUserId) {
    if (authStatus === "signing-out") throw createSessionChangedError();
    await ensureCredentialLoaded();
    if (!credential || !isSessionForApiBase(credential, apiBase)) {
      throw createSessionChangedError();
    }
    const session = runtimeSession && isFreshSession(runtimeSession, now())
      ? runtimeSession
      : await refreshSessionSingleflight(apiBase);
    if (session.user_id !== expectedUserId || credential.user_id !== expectedUserId) {
      throw createSessionChangedError();
    }
    const retryGeneration = sessionGeneration;
    await initializeCurrentSessionBestEffort(apiBase, session);
    return performAuthenticatedRequest(apiBase, apiPath, init, session, retryGeneration);
  }

  async function clearSession() {
    await ensureCredentialLoaded();
    const capturedCredential = credential;
    const capturedSession = runtimeSession;
    sessionGeneration = createSessionGeneration(randomBytes);
    for (const controller of activeRequestControllers) controller.abort();
    activeRequestControllers.clear();
    setAuthStatus("signing-out");
    await revokeRemoteSessionBestEffort(capturedCredential, capturedSession);
    await clearLocalSession({ rotateGeneration: false });
  }

  async function clearLocalSession({ rotateGeneration = true } = {}) {
    if (rotateGeneration) sessionGeneration = createSessionGeneration(randomBytes);
    for (const controller of activeRequestControllers) controller.abort();
    activeRequestControllers.clear();
    runtimeSession = null;
    credential = null;
    initializedSessionGenerations.clear();
    initializationPromises.clear();
    credentialLoaded = true;
    setAuthStatus("signed-out", { broadcast: false });
    let clearError = null;
    try {
      await credentialStore.clear();
    } catch (error) {
      clearError = error;
      logger.error?.("Unable to clear PuppyOne credential store:", safeErrorMessage(error));
    }
    broadcastPublicState();
    if (clearError) throw clearError;
  }

  function dispose() {
    disposed = true;
    stateSubscribers.clear();
    for (const state of pendingOAuthStates.keys()) clearPendingOAuthState(state);
    pendingOAuthStarts.clear();
    initializationPromises.clear();
    initializedSessionGenerations.clear();
    for (const controller of activeRequestControllers) controller.abort();
    activeRequestControllers.clear();
  }

  async function ensureCredentialLoaded() {
    if (credentialLoaded) return credential;
    credential = await credentialStore.read();
    credentialLoaded = true;
    authStatus = credential ? "restoring" : "signed-out";
    return credential;
  }

  async function refreshSessionSingleflight(apiBase) {
    await ensureCredentialLoaded();
    const normalizedApiBase = normalizeCloudApiBaseUrl(apiBase ?? credential?.api_origin);
    if (!credential || !normalizedApiBase || !isSessionForApiBase(credential, normalizedApiBase)) {
      throw createSignedOutError(normalizedApiBase);
    }
    const key = `${normalizedApiBase}\n${credential.user_id ?? credential.user_email}`;
    const existing = refreshPromises.get(key);
    if (existing) return existing;

    const operationGeneration = sessionGeneration;
    const operationCredential = credential;
    const refresh = (async () => {
      setAuthStatus("refreshing");
      try {
        const data = await requestCloudApi(normalizedApiBase, "/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: operationCredential.refresh_token }),
        });
        if (operationGeneration !== sessionGeneration || credential !== operationCredential) {
          throw createSessionChangedError();
        }
        const refreshed = buildSessionFromAuth(data, {
          fallbackEmail: operationCredential.user_email,
          fallbackRefreshToken: operationCredential.refresh_token,
          fallbackUserId: operationCredential.user_id,
          apiOrigin: normalizedApiBase,
          now,
        });
        await adoptAuthenticatedSession(refreshed, {
          rotateGeneration: Boolean(
            operationCredential.user_id
            && operationCredential.user_id !== refreshed.user_id,
          ),
        });
        return runtimeSession;
      } catch (error) {
        if (isRefreshCredentialInvalid(error)) {
          await clearLocalSession();
        } else if (error?.code !== "SESSION_CHANGED") {
          setAuthStatus("offline-authenticated");
        }
        throw error;
      }
    })();

    refreshPromises.set(key, refresh);
    try {
      return await refresh;
    } finally {
      if (refreshPromises.get(key) === refresh) refreshPromises.delete(key);
    }
  }

  async function adoptAuthenticatedSession(session, { rotateGeneration }) {
    const nextCredential = {
      version: 2,
      user_id: session.user_id,
      user_email: session.user_email,
      api_origin: session.api_origin,
      refresh_token: session.refresh_token,
      updated_at: new Date(now()).toISOString(),
    };
    await credentialStore.write(nextCredential);
    if (rotateGeneration) sessionGeneration = createSessionGeneration(randomBytes);
    credential = nextCredential;
    credentialLoaded = true;
    runtimeSession = session;
    setAuthStatus("authenticated");
  }

  async function performAuthenticatedRequest(apiBase, apiPath, init, session, requestGeneration) {
    if (requestGeneration !== sessionGeneration) throw createSessionChangedError();
    const controller = new AbortController();
    activeRequestControllers.add(controller);
    try {
      const result = await requestCloudApi(
        apiBase,
        apiPath,
        withSessionHeaders(init, session, controller.signal),
      );
      if (requestGeneration !== sessionGeneration) throw createSessionChangedError();
      return result;
    } finally {
      activeRequestControllers.delete(controller);
    }
  }

  async function revokeRemoteSessionBestEffort(capturedCredential, capturedSession) {
    if (!capturedCredential) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);
    timeout.unref?.();
    try {
      await requestCloudApi(capturedCredential.api_origin, "/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(capturedSession?.access_token
            ? { Authorization: `Bearer ${capturedSession.access_token}` }
            : {}),
        },
        body: JSON.stringify({ refresh_token: capturedCredential.refresh_token }),
        signal: controller.signal,
      });
    } catch (error) {
      logger.warn?.("PuppyOne remote logout was unavailable; local logout will continue.", {
        status: Number.isFinite(error?.status) ? error.status : undefined,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function initializeUser(apiBase, accessToken) {
    await requestCloudApi(apiBase, "/auth/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  async function initializeCurrentSessionBestEffort(apiBase, session) {
    if (initializedSessionGenerations.has(sessionGeneration)) return;
    const generation = sessionGeneration;
    const existing = initializationPromises.get(generation);
    if (existing) return existing;
    const initialization = (async () => {
      try {
        await initializeUser(apiBase, session.access_token);
        if (generation === sessionGeneration) initializedSessionGenerations.add(generation);
      } catch (error) {
        logger.warn?.("PuppyOne account initialization is still unavailable.", {
          error: safeErrorMessage(error),
        });
      }
    })();
    initializationPromises.set(generation, initialization);
    try {
      return await initialization;
    } finally {
      if (initializationPromises.get(generation) === initialization) {
        initializationPromises.delete(generation);
      }
    }
  }

  function setAuthStatus(nextStatus, { broadcast = true } = {}) {
    const changed = authStatus !== nextStatus;
    authStatus = nextStatus;
    if (broadcast && changed) broadcastPublicState();
  }

  function restoreStatusAfterOAuth(previousStatus) {
    if (runtimeSession) authStatus = "authenticated";
    else if (credential) authStatus = previousStatus === "offline-authenticated"
      ? previousStatus
      : "restoring";
    else authStatus = "signed-out";
  }

  function clearPendingOAuthState(state) {
    const pending = pendingOAuthStates.get(state);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingOAuthStates.delete(state);
    void pending.callbackServer?.close?.().catch(() => undefined);
  }

  function findPendingOAuthState(startKey) {
    for (const pending of pendingOAuthStates.values()) {
      if (pending.startKey === startKey && now() - pending.createdAt <= OAUTH_STATE_TTL_MS) {
        return pending;
      }
    }
    return null;
  }

  function isExpectedPendingCallback(callbackUrl) {
    try {
      const url = new URL(callbackUrl);
      const state = url.searchParams.get("state");
      const pending = state ? pendingOAuthStates.get(state) : null;
      return Boolean(
        pending
        && now() - pending.createdAt <= OAUTH_STATE_TTL_MS
        && isExactCallbackRedirect(url, pending.callbackUrl),
      );
    } catch {
      return false;
    }
  }

  function getOAuthStartKey(apiBase) {
    return apiBase;
  }

  function getSessionSource() {
    return runtimeSession ?? credential;
  }

  function toPublicState() {
    return {
      status: authStatus,
      session: toPublicSession(getSessionSource(), authStatus, sessionGeneration),
    };
  }

  function broadcastPublicState() {
    const state = toPublicState();
    for (const listener of stateSubscribers) {
      try { listener(state); } catch { /* Observers cannot change authentication. */ }
    }
    for (const window of getWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send("cloud-auth:state", state);
      window.webContents.send("cloud-session:changed", state.session);
    }
  }

  function broadcastAuthError(message) {
    for (const window of getWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send("cloud-auth:error", { message });
    }
  }

  function assertNotDisposed() {
    if (disposed) throw new Error("Cloud authentication service is shutting down.");
  }

  return {
    handleCallback,
    readSession,
    readState,
    restoreSession,
    startOAuth,
    requestSessionApi,
    openAgentStream,
    subscribe(listener) { stateSubscribers.add(listener); return () => stateSubscribers.delete(listener); },
    clearSession,
    dispose,
  };
}

export function createPkceVerifier(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString("base64url");
}

export function createPkceChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function buildSessionFromAuth(data, {
  fallbackEmail,
  fallbackRefreshToken,
  fallbackUserId,
  apiOrigin,
  now,
}) {
  if (!data || typeof data !== "object") throw new Error("Cloud auth response is invalid.");
  const accessToken = normalizeNonEmptyString(data.access_token);
  if (!accessToken) throw new Error("Login succeeded but no access token was returned.");
  const refreshToken = normalizeNonEmptyString(data.refresh_token) ?? fallbackRefreshToken;
  if (!refreshToken) throw new Error("Login succeeded but no refresh token was returned.");
  const userEmail = normalizeEmail(data.user_email)
    ?? normalizeEmail(data.user?.email)
    ?? normalizeEmail(fallbackEmail);
  if (!userEmail) throw new Error("Login succeeded but no account email was returned.");
  const userId = normalizeNonEmptyString(data.user_id)
    ?? normalizeNonEmptyString(data.user?.id)
    ?? decodeJwtSubject(accessToken)
    ?? normalizeNonEmptyString(fallbackUserId)
    ?? createLegacyUserId(apiOrigin, userEmail);
  const expiresIn = Number.isFinite(data.expires_in) ? Math.max(0, Number(data.expires_in)) : 0;

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    expires_at: expiresIn > 0 ? now() + expiresIn * 1000 : 0,
    user_id: userId,
    user_email: userEmail,
    api_origin: apiOrigin,
  };
}

function toPublicSession(session, status, generation) {
  if (!session) return null;
  const userId = normalizeNonEmptyString(session.user_id)
    ?? createLegacyUserId(session.api_origin, session.user_email);
  return {
    expires_in: Number.isFinite(session.expires_in) ? Number(session.expires_in) : 0,
    expires_at: Number.isFinite(session.expires_at) ? Number(session.expires_at) : 0,
    user_id: userId,
    user_email: session.user_email,
    api_base_url: session.api_origin,
    session_generation: generation,
    status,
  };
}

function isFreshSession(session, currentTime) {
  return Boolean(
    session?.access_token
    && (!session.expires_at || currentTime < session.expires_at - SESSION_REFRESH_SKEW_MS),
  );
}

function isSessionForApiBase(session, apiBase) {
  if (!apiBase) return true;
  const sessionApiBase = normalizeCloudApiBaseUrl(session.api_origin ?? session.api_base_url);
  return sessionApiBase === apiBase;
}

function withSessionHeaders(init, session, signal) {
  const requestHeaders = normalizeRequestHeaders(init?.headers);
  const formDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  return {
    ...init,
    signal,
    headers: {
      ...(formDataBody ? {} : { "Content-Type": "application/json" }),
      ...requestHeaders,
      Authorization: `Bearer ${session.access_token}`,
    },
  };
}

function isAccessTokenFailure(error) {
  return Number(error?.status) === 401;
}

function isRefreshCredentialInvalid(error) {
  if (Number(error?.status) !== 401) return false;
  const message = safeErrorMessage(error).toLowerCase();
  return /invalid|expired|revoked|refresh|session|grant/.test(message) || message.length > 0;
}

function isNetworkFailure(error) {
  return !Number.isFinite(error?.status) && error?.code !== "SESSION_CHANGED";
}

function isSafeSessionRetry(apiPath, init) {
  const method = String(init?.method ?? "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  // Repository-context POST is a read-only ProjectGrant lookup. Replaying it
  // cannot create, rotate, or revoke Cloud state.
  if (method === "POST" && /^\/projects\/[^/]+\/repository-context$/.test(apiPath)) return true;

  // These main-owned mutations use a canonical UUIDv4 idempotency key and an
  // immutable request body persisted before the first attempt. They are safe
  // to replay once when a newer authenticated session generation wins.
  const idempotencyKey = Object.entries(normalizeRequestHeaders(init?.headers))
    .find(([key]) => key.toLowerCase() === "idempotency-key")?.[1]
    ?.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey ?? "")) {
    return false;
  }
  if (method === "POST") {
    return apiPath === "/projects/"
      || /^\/projects\/[^/]+\/git-credentials$/.test(apiPath)
      || /^\/projects\/[^/]+\/initialization\/abandon$/.test(apiPath);
  }
  return method === "DELETE"
    && /^\/projects\/[^/]+\/git-credentials\/[^/]+$/.test(apiPath);
}

function createSignedOutError(apiBase) {
  const error = new Error(`Sign in to ${formatCloudApiHost(apiBase)} to load this Cloud workspace.`);
  error.status = 401;
  error.code = "SIGNED_OUT";
  return error;
}

function createSessionChangedError() {
  const error = new Error("Cloud session changed while the request was in flight.");
  error.code = "SESSION_CHANGED";
  return error;
}

function createSessionGeneration(randomBytes) {
  return randomBytes(18).toString("base64url");
}

function createLegacyUserId(apiOrigin, email) {
  return `legacy:${crypto.createHash("sha256").update(`${apiOrigin ?? ""}\n${email ?? ""}`).digest("hex").slice(0, 32)}`;
}

function decodeJwtSubject(token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return normalizeNonEmptyString(payload?.sub);
  } catch {
    return null;
  }
}

function requireLoopbackRedirectUri(value) {
  const raw = requireHttpUrl(value, "Desktop sign-in could not start a loopback callback listener.");
  const url = new URL(raw);
  if (
    url.protocol !== "http:"
    || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || url.pathname !== "/auth/callback"
    || !url.port
    || Number(url.port) <= 0
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("Desktop sign-in loopback callback is invalid.");
  }
  return url.toString();
}

function isExactCallbackRedirect(callbackUrl, expectedRedirect) {
  try {
    const expected = new URL(expectedRedirect);
    return callbackUrl.protocol === expected.protocol
      && callbackUrl.hostname === expected.hostname
      && callbackUrl.port === expected.port
      && callbackUrl.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function requireNonEmptyString(value, message) {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) throw new Error(message);
  return normalized;
}

function requireHttpUrl(value, message) {
  const raw = requireNonEmptyString(value, message);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(message);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(message);
  return url.toString();
}

function requireSecureBrowserUrl(value, message) {
  const raw = requireHttpUrl(value, message);
  const url = new URL(raw);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback))
    || url.username
    || url.password
  ) {
    throw new Error(message);
  }
  return url.toString();
}

async function assertLocalLoginPageReachable(loginUrl, fetchImpl, localCloudWebUrl) {
  const url = new URL(loginUrl);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (!loopback) return;

  let configuredUrl;
  try {
    configuredUrl = new URL(localCloudWebUrl);
  } catch {
    throw new Error("VITE_DESKTOP_CLOUD_WEB_URL must configure the local Cloud login origin.");
  }
  if (
    configuredUrl.protocol !== "http:"
    || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(configuredUrl.hostname)
    || configuredUrl.username
    || configuredUrl.password
    || configuredUrl.origin !== url.origin
  ) {
    throw new Error("Local Cloud login URL does not match VITE_DESKTOP_CLOUD_WEB_URL.");
  }

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (!body.includes("Puppyone") || !body.includes("Sign in")) {
      throw new Error("Puppyone login page marker is missing");
    }
    return;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Local Cloud login page is unavailable at ${url.origin}. ${detail}`);
  }
}

function normalizeOAuthProvider(value) {
  if (value == null || value === "") return undefined;
  if (value === "google" || value === "github") return value;
  throw new Error("Unsupported Cloud sign-in provider.");
}

function normalizeRequestHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== "string" || !key.trim() || value == null) continue;
    normalized[key] = String(value);
  }
  return normalized;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEmail(value) {
  const normalized = normalizeNonEmptyString(value);
  return normalized && normalized.includes("@") ? normalized : null;
}

function safeErrorMessage(error, fallback = "Cloud authentication failed.") {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  if (!message) return fallback;
  // Avoid accidentally forwarding JWTs or callback credentials into renderer
  // diagnostics. The replacement is intentionally broad.
  return message
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-token]")
    .replace(/(refresh_token|code_verifier|access_token)=?[^\s&]*/gi, "$1=[redacted]");
}
