import http from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { assertConnectionSnapshot, connectionError, parseModelRoute } from "../../../shared/model-connections/schema.mjs";
import { normalizeCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";
import { managedPrices, parseManagedUsage } from "./managed-usage.mjs";

/** Personal managed inference is a Main-owned, read-only connection. Only a
 * random per-lease loopback capability is bootstrapped into the Agent worker. */
export function withManagedConnection({ connections, getAuth, apiBase, requestPublic, openExternal,
  refreshTimeoutMs = 30_000, catalogTtlMs = 60_000 }) {
  const origin = normalizeCloudApiBaseUrl(apiBase);
  const listeners = new Set();
  const leases = new Map();
  let local = null;
  let session = null;
  let catalog = null;
  let catalogRefreshedAt = 0;
  let balance = null;
  let trialClaimedFor = null;
  let lastReservationId = null;
  let lastUsage = null;
  let error = null;
  let revision = 0;
  let generation = 1;
  let lastRefresh = 0;
  let pending = null;
  let refreshController = null;
  let receiptPending = null;
  let disposed = false;
  let unsubscribeAuth = null;
  let server = null;
  let serverReady = null;

  const id = () => {
    const hash = createHash("sha256").update(`${origin}:${session?.user_id}`).digest("hex").slice(0, 32);
    return `mc_${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
  };
  const models = () => (catalog?.models ?? []).map((model) => ({ id: model.id, name: model.name,
    available: true, loaded: null, capabilities: { text: "supported", tools: "supported", images: "unsupported" },
    contextWindow: model.context_window, maxContextWindow: model.context_window, evidence: "managed-catalog" }));
  const snapshot = () => {
    const connectionId = id();
    const ready = Boolean(session && catalog && balance && !error);
    return assertConnectionSnapshot({ ...local, revision,
      connections: [...(local?.connections ?? []), ...(ready ? [{ id: connectionId, sourceKind: "managed",
        driver: "openai-compatible", name: "PuppyOne", baseUrl: `${origin}/ai`, auth: "bearer",
        credentialConfigured: true, configGeneration: generation, defaultModelId: catalog.models[0]?.id ?? null,
        manualModelId: null, manualContextWindow: null, serverToolsDisabled: true,
        transport: "remote", executionLocation: "unknown", readOnly: true }] : [])],
      catalogs: [...(local?.catalogs ?? []), ...(ready ? [{ connectionId, configGeneration: generation,
        status: "ready", endpoint: "reachable", authentication: "valid", observedAt: new Date().toISOString(),
        complete: true, models: models(), errorCode: null }] : [])],
      managed: { available: ready && balance.available_micro_usd > 0,
        reason: !session ? "sign-in-required" : !ready ? (pending || !error ? "loading" : "gateway-unavailable")
          : balance.available_micro_usd > 0 ? "ready" : "insufficient-credit",
        signedIn: Boolean(session), sandbox: catalog?.sandbox ?? false,
        balanceMicroUsd: balance?.balance_micro_usd ?? 0, reservedMicroUsd: balance?.reserved_micro_usd ?? 0,
        availableMicroUsd: balance?.available_micro_usd ?? 0, packs: catalog?.packs ?? [],
        trialGrantedMicroUsd: balance?.trial_granted_micro_usd ?? 0,
        trialCreditMicroUsd: catalog?.trial_credit_micro_usd ?? 0,
        lastUsage, modelPrices: managedPrices(catalog),
        errorCode: pending ? null : error, apiOrigin: origin },
    });
  };
  const publish = () => {
    revision++;
    if (!local || disposed) return;
    for (const listener of listeners) { try { listener(structuredClone(snapshot())); } catch { /* Observer only. */ } }
  };
  const revoke = (record) => {
    leases.delete(record.leaseId);
    record.controller.abort();
    Promise.resolve(record.onRevoke?.()).catch(() => {});
  };
  const adopt = (state) => {
    const next = state.session?.api_base_url === origin && !["signed-out", "signing-out"].includes(state.status)
      ? state.session : null;
    if (next?.session_generation !== session?.session_generation || next?.user_id !== session?.user_id) {
      refreshController?.abort();
      for (const record of [...leases.values()]) revoke(record);
      generation++;
      session = next;
      balance = null;
      trialClaimedFor = null;
      lastReservationId = null;
      lastUsage = null;
      error = null;
      lastRefresh = 0;
      publish();
    }
  };
  const initialize = async () => {
    if (disposed) throw connectionError("SERVICE_CLOSED");
    if (!unsubscribeAuth) {
      unsubscribeAuth = getAuth().subscribe((state) => {
        adopt(state);
        void refresh().catch(() => {});
      });
    }
    if (!local) local = await connections.read();
    adopt(await getAuth().readState());
  };
  async function refresh(force = false) {
    await initialize();
    if (pending) return pending;
    if (!force && Date.now() - lastRefresh < 15_000) return;
    const capturedGeneration = generation;
    const controller = new AbortController();
    refreshController = controller;
    const current = () => {
      controller.signal.throwIfAborted();
      if (capturedGeneration !== generation || disposed) throw connectionError("SESSION_CHANGED");
    };
    let timer;
    const cancelled = new Promise((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
      timer = setTimeout(() => controller.abort(connectionError("TIMEOUT")), refreshTimeoutMs);
      timer.unref?.();
    });
    pending = Promise.resolve().then(async () => {
      try {
        await Promise.race([cancelled, (async () => {
          current();
          if (!origin) throw connectionError("GATEWAY_UNAVAILABLE");
          const claimUser = session?.user_id;
          // Public prices and this user's wallet are independent reads. Reuse the
          // short-lived directory; a wallet refresh must not fetch it every time.
          const catalogRequest = catalog && Date.now() - catalogRefreshedAt < catalogTtlMs
            ? Promise.resolve(catalog)
            : Promise.resolve().then(async () => {
              const result = await requestPublic(origin, "/ai/catalog", { method: "GET", redirect: "error", signal: controller.signal });
              current();
              if (!Array.isArray(result?.models) || !Array.isArray(result?.packs) || !result.models.length) throw connectionError("INVALID_RESPONSE");
              catalog = result;
              catalogRefreshedAt = Date.now();
              return result;
            });
          const [nextCatalog, wallet] = await Promise.all([catalogRequest,
            claimUser ? getAuth().requestSessionApi(origin, "/ai/balance", { method: "GET", signal: controller.signal }) : null]);
          current();
          let nextBalance = wallet;
          if (claimUser && nextCatalog.trial_credit_micro_usd > 0 && trialClaimedFor !== claimUser) {
            // A returning account has already received its lifetime grant. For
            // a new account, the idempotent claim itself returns the new wallet.
            if (!(wallet?.trial_granted_micro_usd > 0)) {
              nextBalance = await getAuth().requestSessionApi(origin, "/ai/trial", { method: "POST", body: "{}", signal: controller.signal });
              current();
            }
            trialClaimedFor = claimUser;
          }
          if (claimUser && !validBalance(nextBalance)) throw connectionError("INVALID_RESPONSE");
          catalog = nextCatalog;
          balance = nextBalance;
          error = null;
        })()]);
      } catch (failure) {
        controller.abort();
        if (capturedGeneration === generation) {
          error = failure?.code === "TIMEOUT" ? "TIMEOUT" : "GATEWAY_UNAVAILABLE";
          balance = null;
        }
      } finally {
        clearTimeout(timer);
        const sessionChanged = capturedGeneration !== generation;
        lastRefresh = sessionChanged ? 0 : Date.now();
        pending = null;
        if (refreshController === controller) refreshController = null;
        publish();
        if (sessionChanged && !disposed) void refresh(true).catch(() => {});
        else if (!error && !disposed) refreshReceipt();
      }
    });
    publish();
    return pending;
  }

  function refreshReceipt() {
    const receiptId = lastReservationId;
    if (!session || !receiptId || receiptPending) return;
    const capturedGeneration = generation;
    const signal = AbortSignal.timeout(refreshTimeoutMs);
    // Settlement history is not a prerequisite for preparing the next message.
    receiptPending = Promise.resolve().then(() => getAuth().requestSessionApi(origin,
      `/ai/usage/${receiptId}`, { method: "GET", signal }))
      .then((receipt) => {
        if (disposed || signal.aborted || capturedGeneration !== generation || receiptId !== lastReservationId) return;
        lastUsage = parseManagedUsage(receipt, receiptId) ?? lastUsage;
        publish();
      }).catch(() => {}).finally(() => { receiptPending = null; });
  }

  async function startProxy() {
    if (serverReady) return serverReady;
    serverReady = (async () => {
      server = http.createServer(async (request, response) => {
        const requestId = randomUUID();
        const reject = (status, code, message) => {
          response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Request-Id": requestId });
          response.end(JSON.stringify({ error: { code, message: `${message} Reference: ${requestId}`, request_id: requestId } }));
        };
        let stream = null;
        let record = null;
        try {
          if (request.method !== "POST" || request.url !== "/v1/chat/completions" || request.headers.origin
            || request.headers.host !== `127.0.0.1:${server.address().port}`) {
            reject(403, "ai_access_denied", "This Agent connection is not authorized."); return;
          }
          const capability = request.headers.authorization?.replace(/^Bearer /u, "");
          record = [...leases.values()].find((candidate) => candidate.capability === capability);
          if (!record || record.generation !== generation || record.controller.signal.aborted) {
            reject(401, "ai_session_expired", "The Agent connection has expired. Reopen the conversation."); return;
          }
          if (record.busy) { reject(429, "ai_request_in_progress", "An Agent request is already in progress."); return; }
          record.busy = true;
          const controller = new AbortController();
          const abort = () => controller.abort();
          record.controller.signal.addEventListener("abort", abort, { once: true });
          response.once("close", abort);
          const timeout = setTimeout(abort, 210_000);
          timeout.unref?.();
          try {
            const chunks = [];
            let bytes = 0;
            for await (const chunk of request) {
              bytes += chunk.length;
              if (bytes > 512 * 1024) { reject(413, "ai_request_too_large", "This conversation is too large. Start a new conversation."); return; }
              chunks.push(chunk);
            }
            const body = Buffer.concat(chunks).toString("utf8");
            let value;
            try { value = JSON.parse(body); }
            catch { reject(400, "ai_request_invalid", "The Agent request is not valid JSON."); return; }
            if (!record.models.has(value?.model)) { reject(400, "ai_model_unavailable", "Select an available Agent model."); return; }
            stream = await getAuth().openAgentStream(origin, body, { signal: controller.signal, requestId });
            const reservationId = stream.response.headers.get("x-puppyone-reservation-id");
            if (record.generation === generation && /^[a-f0-9-]{36}$/u.test(reservationId ?? "")) {
              lastReservationId = reservationId;
              lastUsage = { reservationId, modelId: value.model, status: "pending", chargedMicroUsd: null,
                priceBookId: null, inputTokens: null, cachedTokens: null, outputTokens: null };
              publish();
            }
            response.writeHead(stream.response.status, { "Content-Type": stream.response.headers.get("content-type") || "application/json",
              "Cache-Control": "no-store", "X-Request-Id": stream.response.headers.get("x-request-id") || requestId });
            for await (const chunk of stream.response.body ?? []) {
              if (!response.write(chunk)) await once(response, "drain", { signal: controller.signal });
            }
            response.end();
          } finally {
            clearTimeout(timeout);
            record.controller.signal.removeEventListener("abort", abort);
            response.removeListener("close", abort);
            record.busy = false;
          }
        } catch {
          if (!response.headersSent) reject(503, "ai_connection_interrupted", "The Agent connection was interrupted. Try again.");
          else response.destroy();
        } finally {
          stream?.close();
          if (record) void refresh(true).catch(() => {});
        }
      });
      server.requestTimeout = 220_000;
      server.headersTimeout = 10_000;
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      server.unref();
      return `http://127.0.0.1:${server.address().port}/v1`;
    })();
    return serverReady;
  }

  const unsubscribeLocal = connections.subscribe((value) => { local = value; publish(); });
  const service = {
    ...connections,
    async read() { await refresh(); return structuredClone(snapshot()); },
    async catalog({ waitForManaged = true } = {}) {
      await initialize();
      const refreshing = refresh();
      const localCatalog = connections.catalog().then((value) => { local = value; });
      if (waitForManaged) await Promise.all([refreshing, localCatalog]);
      else {
        // UI inspection can expose setup/loading immediately. Published updates
        // invalidate its readiness cache; session acquisition still awaits refresh.
        void refreshing.catch(() => {});
        await localCatalog;
      }
      return structuredClone(snapshot());
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async managed({ action, packId } = {}) {
      await initialize();
      if (action === "sign-in") {
        try { await getAuth().startOAuth({ apiBase: origin }); }
        catch { throw connectionError("AUTHENTICATION_FAILED"); }
      }
      else if (action === "checkout") {
        await refresh(true);
        if (!session || !catalog?.packs.some((pack) => pack.id === packId)) throw connectionError("INVALID_CONFIGURATION");
        const purchase = await getAuth().requestSessionApi(origin, "/ai/checkouts", { method: "POST",
          headers: { "Idempotency-Key": randomUUID() }, body: JSON.stringify({ pack_id: packId }) });
        const url = new URL(purchase.checkout_url);
        const host = catalog.sandbox ? "sandbox.polar.sh" : "polar.sh";
        if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password) throw connectionError("INVALID_RESPONSE");
        await openExternal(url.href);
      } else if (action !== "refresh") throw connectionError("INVALID_COMMAND");
      await refresh(true);
      return structuredClone(snapshot());
    },
    async refresh(raw) {
      if (raw.id === id()) await refresh(true);
      else local = await connections.refresh(raw);
      return structuredClone(snapshot());
    },
    async acquire(options) {
      const selection = parseModelRoute(options.route);
      await refresh();
      if (selection.connectionId !== id()) return connections.acquire(options);
      if (!options.scope || !snapshot().managed.available) throw connectionError("CREDENTIAL_REQUIRED");
      if (options.expectedBindingRevision !== undefined && options.expectedBindingRevision !== `${id()}:${generation}`) throw connectionError("MODEL_BINDING_CHANGED");
      if (!models().some((model) => model.id === selection.modelId)) throw connectionError("MODEL_UNAVAILABLE");
      const capturedGeneration = generation;
      const baseUrl = await startProxy();
      if (capturedGeneration !== generation || disposed) throw connectionError("LEASE_REVOKED");
      const record = { leaseId: randomUUID(), capability: randomBytes(32).toString("base64url"),
        controller: new AbortController(), scope: options.scope, generation, connectionId: id(),
        models: new Set(models().map((model) => model.id)), onRevoke: options.onRevoke, busy: false };
      leases.set(record.leaseId, record);
      return { leaseId: record.leaseId, configuration: { schemaVersion: 1, connectionId: id(),
        configGeneration: generation, securityGeneration: generation, baseUrl, apiKey: record.capability,
        auth: "bearer", selectedModelId: selection.modelId, models: models() } };
    },
    validate(options) {
      const record = leases.get(options.leaseId);
      if (!record) return connections.validate(options);
      const selection = parseModelRoute(options.route);
      if (record.scope !== options.scope || record.generation !== generation || selection.connectionId !== id()
        || !record.models.has(selection.modelId)) throw connectionError("LEASE_REVOKED");
    },
    release(options) {
      const record = leases.get(options.leaseId);
      if (record?.scope === options.scope) { leases.delete(record.leaseId); record.controller.abort(); }
      else connections.release(options);
    },
    releaseScope(scope) {
      for (const record of leases.values()) if (record.scope === scope) { leases.delete(record.leaseId); record.controller.abort(); }
      connections.releaseScope(scope);
    },
    async dispose() {
      disposed = true;
      refreshController?.abort();
      unsubscribeAuth?.(); unsubscribeLocal(); listeners.clear();
      for (const record of [...leases.values()]) revoke(record);
      server?.closeAllConnections(); server?.close();
      await connections.dispose();
    },
  };
  for (const action of ["save", "remove", "verify"]) service[action] = async (raw) => {
    if (raw.id === id() || raw.sourceKind === "managed") throw connectionError("INVALID_CONFIGURATION");
    local = await connections[action](raw);
    return structuredClone(snapshot());
  };
  return service;
}

function validBalance(value) {
  return value && ["balance_micro_usd", "reserved_micro_usd", "available_micro_usd"]
    .every((key) => Number.isSafeInteger(value[key]));
}
