import { randomUUID } from "node:crypto";
import { assertConnectionSnapshot, connectionError, isLoopbackHost, MODEL_CONNECTION_LIMITS, parseConnectionCommand, parseModelRoute } from "../../../shared/model-connections/schema.mjs";
import { emptyModelCatalog, projectModelCatalog } from "./model-catalog.mjs";
import { createModelDiscoveryService } from "./discovery-service.mjs";
import { managedComputeAvailability } from "./drivers/puppyone.mjs";

/** Application authority. Drivers and consumers are injected; no Agent/SDK dependency. */
export function createModelConnectionService({ store, credentials, drivers, request, verifyModel, now = () => new Date().toISOString() }) {
  const definitions = new Map(drivers.map((driver) => [driver.id, driver]));
  const records = new Map();
  const catalogs = new Map();
  const pending = new Map();
  const leases = new Map();
  const verifying = new Set();
  const subscribers = new Set();
  const discovery = createModelDiscoveryService({ drivers, request });
  let revision = 0;
  let disposed = false;
  let initialization = null;
  let mutations = Promise.resolve();
  const active = () => { if (disposed) throw connectionError("SERVICE_CLOSED"); };
  const initialize = () => initialization ??= (async () => {
    const saved = await store.read();
    if (saved.length > MODEL_CONNECTION_LIMITS.connections) throw connectionError("STORE_INVALID");
    for (const entry of saved) {
      const parsed = parseConnectionCommand("save", { ...entry, expectedGeneration: entry.configGeneration });
      if (records.has(parsed.id) || !parsed.id || !Number.isSafeInteger(entry.securityGeneration) || entry.securityGeneration < 1) throw connectionError("STORE_INVALID");
      if (entry.credentialRef && !/^[a-f0-9-]{36}$/u.test(entry.credentialRef)) throw connectionError("STORE_INVALID");
      const { apiKey: _secret, expectedGeneration: _generation, ...configuration } = parsed;
      records.set(parsed.id, { ...configuration, configGeneration: entry.configGeneration, securityGeneration: entry.securityGeneration,
        credentialRef: entry.credentialRef ?? null, verifications: entry.verifications ?? {} });
    }
    await credentials.reconcile([...records.values()].map((entry) => entry.credentialRef).filter(Boolean));
  })();
  const publicConnection = (entry) => {
    const { credentialRef, securityGeneration: _security, verifications: _verifications, ...configuration } = entry;
    return { ...configuration, credentialConfigured: Boolean(credentialRef), transport: isLoopbackHost(new URL(entry.baseUrl).hostname) ? "loopback" : "remote", executionLocation: "unknown" };
  };
  const snapshot = () => assertConnectionSnapshot({ schemaVersion: 1, revision,
    connections: [...records.values()].map(publicConnection),
    catalogs: [...records.values()].map((record) => catalogs.get(record.id) ?? emptyModelCatalog(record)),
    managed: managedComputeAvailability });
  const publish = () => {
    revision++;
    for (const listener of subscribers) { try { listener(structuredClone(snapshot())); } catch { /* An observer cannot roll back an authoritative commit. */ } }
  };
  const mutate = (operation) => {
    const task = mutations.then(async () => { active(); await initialize(); return operation(); });
    mutations = task.catch(() => {});
    return task;
  };
  const current = (id, generation) => {
    active();
    const entry = records.get(id);
    if (!entry) throw connectionError("CONNECTION_NOT_FOUND");
    if (generation != null && entry.configGeneration !== generation) throw connectionError("CONFIGURATION_CONFLICT");
    return entry;
  };
  const persist = async (next) => store.write([...next.values()]);
  const revoke = async (id) => {
    pending.get(id)?.controller.abort();
    const matches = [...leases.values()].filter((lease) => lease.connectionId === id);
    matches.forEach((lease) => leases.delete(lease.id));
    const outcomes = await Promise.allSettled(matches.map((lease) => lease.onRevoke?.()));
    if (outcomes.some((outcome) => outcome.status === "rejected")) throw connectionError("RUNTIME_CLEANUP_FAILED");
  };
  const getKey = async (entry) => {
    if (entry.auth === "none") return null;
    if (!entry.credentialRef) throw connectionError("CREDENTIAL_REQUIRED");
    return credentials.read(entry.credentialRef);
  };
  async function refresh(raw) {
    await initialize(); active();
    const { id } = parseConnectionCommand("refresh", raw);
    const entry = current(id);
    const existing = pending.get(id);
    if (existing?.generation === entry.configGeneration) return existing.promise;
    existing?.controller.abort();
    const controller = new AbortController();
    const job = { controller, generation: entry.configGeneration, promise: null };
    pending.set(id, job);
    const previous = catalogs.get(id) ?? emptyModelCatalog(entry);
    catalogs.set(id, { ...previous, status: "refreshing" }); publish();
    job.promise = (async () => {
      const timer = setTimeout(() => controller.abort(), 15_000);
      timer.unref?.();
      try {
        const apiKey = await getKey(entry);
        const result = await definitions.get(entry.driver).list(entry, request, { apiKey, signal: controller.signal });
        if (controller.signal.aborted) throw connectionError("CANCELLED");
        if (records.get(id) !== entry || disposed) return;
        catalogs.set(id, projectModelCatalog(entry, result, now()));
      } catch (error) {
        if (records.get(id) !== entry || disposed) return;
        const code = knownErrorCode(error);
        catalogs.set(id, { ...previous, status: previous.models.length ? "stale" : "failed", errorCode: code,
          endpoint: ["AUTHENTICATION_FAILED", "ENDPOINT_NOT_FOUND", "ENDPOINT_ERROR", "REDIRECT_REJECTED"].includes(code) ? "reachable" : ["NETWORK_ERROR", "TIMEOUT", "CANCELLED"].includes(code) ? "unreachable" : "unknown",
          authentication: code === "AUTHENTICATION_FAILED" ? "invalid" : code === "CREDENTIAL_REQUIRED" ? "missing" : "unknown" });
      } finally {
        clearTimeout(timer);
        if (pending.get(id) === job) pending.delete(id);
        if (!disposed && records.get(id) === entry) publish();
      }
    })();
    await job.promise;
  }
  const findModel = (entry, modelId, { verification = false } = {}) => {
    const catalog = catalogs.get(entry.id);
    if (catalog?.status !== "ready" || catalog.configGeneration !== entry.configGeneration) throw connectionError("CATALOG_UNAVAILABLE");
    const model = catalog.models.find((candidate) => candidate.id === modelId);
    if (!model?.available) throw connectionError("MODEL_UNAVAILABLE");
    if (!model.contextWindow) throw connectionError("CONTEXT_REQUIRED");
    if (entry.driver === "unsloth" && !entry.serverToolsDisabled) throw connectionError("SERVER_TOOLS_MUST_BE_DISABLED");
    if (!verification && (model.capabilities.text !== "supported" || model.capabilities.tools !== "supported")) throw connectionError("MODEL_VERIFICATION_REQUIRED");
    return model;
  };
  const privateConfiguration = async (entry, model) => ({ schemaVersion: 1,
    connectionId: entry.id, configGeneration: entry.configGeneration, securityGeneration: entry.securityGeneration,
    baseUrl: entry.baseUrl, apiKey: await getKey(entry), auth: entry.auth, selectedModelId: model.id,
    models: structuredClone((catalogs.get(entry.id)?.models ?? []).filter((candidate) => candidate.id === model.id || (
      candidate.available && candidate.contextWindow && candidate.capabilities.text === "supported" && candidate.capabilities.tools === "supported"
    ))),
  });
  const service = {
    async read() { await initialize(); await mutations; active(); return structuredClone(snapshot()); },
    async catalog() {
      await initialize(); await mutations; active();
      await Promise.all([...records.values()].filter((entry) => !catalogs.has(entry.id)).map((entry) => refresh({ id: entry.id })));
      return service.read();
    },
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    discover: () => { active(); return discovery.discover(); },
    refresh: async (raw) => { await refresh(raw); return service.read(); },
    save(raw) {
      const parsed = parseConnectionCommand("save", raw);
      return mutate(async () => {
        const previous = parsed.id ? current(parsed.id, parsed.expectedGeneration) : null;
        if (!previous && records.size >= MODEL_CONNECTION_LIMITS.connections) throw connectionError("CONNECTION_LIMIT");
        if (parsed.auth === "bearer" && previous?.credentialRef && previous.baseUrl !== parsed.baseUrl && !parsed.apiKey) throw connectionError("KEY_CONFIRMATION_REQUIRED");
        const { apiKey, expectedGeneration: _generation, ...configuration } = parsed;
        const securityChanged = !previous || ["baseUrl", "driver", "auth", "serverToolsDisabled", "manualModelId", "manualContextWindow"].some((key) => previous[key] !== configuration[key]) || apiKey !== undefined;
        let newRef = null;
        try {
          if (parsed.auth === "bearer" && apiKey) newRef = await credentials.create(apiKey);
          const nextRecord = { ...configuration, id: previous?.id ?? `mc_${randomUUID()}`, configGeneration: (previous?.configGeneration ?? 0) + 1,
            securityGeneration: (previous?.securityGeneration ?? 0) + (securityChanged ? 1 : 0),
            credentialRef: parsed.auth === "none" ? null : newRef ?? previous?.credentialRef ?? null,
            verifications: securityChanged ? {} : previous.verifications };
          const next = new Map(records); next.set(nextRecord.id, nextRecord);
          await persist(next);
          records.set(nextRecord.id, nextRecord);
          catalogs.delete(nextRecord.id);
          pending.get(nextRecord.id)?.controller.abort();
          newRef = null; // From here the persisted configuration owns this credential.
          publish();
          if (securityChanged) await revoke(nextRecord.id);
          if (previous?.credentialRef && previous.credentialRef !== nextRecord.credentialRef) await credentials.remove(previous.credentialRef);
          return nextRecord.id;
        } finally { if (newRef) await credentials.remove(newRef); }
      }).then(async (id) => { await refresh({ id }); return service.read(); });
    },
    remove(raw) {
      const parsed = parseConnectionCommand("remove", raw);
      return mutate(async () => {
        const entry = current(parsed.id, parsed.expectedGeneration);
        const next = new Map(records); next.delete(entry.id);
        await persist(next);
        records.delete(entry.id); catalogs.delete(entry.id); publish();
        await revoke(entry.id);
        await credentials.remove(entry.credentialRef);
      }).then(() => service.read());
    },
    async verify(raw) {
      const parsed = parseConnectionCommand("verify", raw);
      await initialize(); active();
      if (!verifyModel) throw connectionError("VERIFICATION_UNAVAILABLE");
      const entry = current(parsed.id, parsed.expectedGeneration);
      const model = findModel(entry, parsed.modelId, { verification: true });
      if (verifying.has(entry.id) || verifying.size >= 2) throw connectionError("BUSY");
      verifying.add(entry.id);
      const controller = new AbortController();
      const leaseId = randomUUID();
      leases.set(leaseId, { id: leaseId, connectionId: entry.id, onRevoke: () => controller.abort() });
      try {
        const config = await privateConfiguration(entry, model);
        if (controller.signal.aborted) throw connectionError("CONFIGURATION_CONFLICT");
        await verifyModel(config, { signal: controller.signal });
        await mutate(async () => {
          if (controller.signal.aborted || records.get(entry.id) !== entry) throw connectionError("CONFIGURATION_CONFLICT");
          const nextRecord = { ...entry, verifications: { ...entry.verifications, [model.id]: { at: now(), securityGeneration: entry.securityGeneration } } };
          const next = new Map(records); next.set(entry.id, nextRecord);
          await persist(next); records.set(entry.id, nextRecord);
          const catalog = catalogs.get(entry.id);
          catalogs.set(entry.id, projectModelCatalog(nextRecord, { models: structuredClone(catalog.models), complete: catalog.complete }, now()));
          publish();
        });
        return service.read();
      } finally { leases.delete(leaseId); verifying.delete(entry.id); }
    },
    async acquire({ route, scope, onRevoke }) {
      await initialize(); await mutations; active();
      if (typeof scope !== "string" || !scope) throw connectionError("AUTHORITY_REQUIRED");
      const selection = parseModelRoute(route);
      let entry = current(selection.connectionId);
      if (!catalogs.has(entry.id)) await refresh({ id: entry.id });
      entry = current(selection.connectionId);
      const model = findModel(entry, selection.modelId);
      const configuration = await privateConfiguration(entry, model);
      if (records.get(entry.id) !== entry || disposed) throw connectionError("CONFIGURATION_CONFLICT");
      const leaseId = randomUUID();
      leases.set(leaseId, { id: leaseId, scope, connectionId: entry.id, securityGeneration: entry.securityGeneration, onRevoke });
      return { leaseId, configuration };
    },
    validate({ leaseId, scope, route }) {
      active();
      const lease = leases.get(leaseId);
      const selection = parseModelRoute(route);
      if (!lease || lease.scope !== scope || lease.connectionId !== selection.connectionId) throw connectionError("LEASE_REVOKED");
      const entry = current(lease.connectionId);
      if (entry.securityGeneration !== lease.securityGeneration) throw connectionError("LEASE_REVOKED");
      findModel(entry, selection.modelId);
    },
    release({ leaseId, scope }) { if (leases.get(leaseId)?.scope === scope) leases.delete(leaseId); },
    releaseScope(scope) { for (const lease of leases.values()) if (lease.scope === scope) leases.delete(lease.id); },
    async dispose() {
      disposed = true; discovery.dispose();
      for (const job of pending.values()) job.controller.abort();
      subscribers.clear();
      await Promise.allSettled([...records.keys()].map(revoke));
    },
  };
  return service;
}

const ERROR_CODES = new Set(["INVALID_CONNECTION", "INVALID_CONFIGURATION", "INVALID_URL", "INVALID_CONTEXT", "INVALID_KEY", "INVALID_COMMAND",
  "HTTPS_REQUIRED", "KEY_CONFIRMATION_REQUIRED", "CONNECTION_NOT_FOUND", "CONFIGURATION_CONFLICT", "CONNECTION_LIMIT", "CATALOG_UNAVAILABLE",
  "MODEL_REQUIRED", "MODEL_UNAVAILABLE", "MODEL_VERIFICATION_REQUIRED", "CONTEXT_REQUIRED", "SERVER_TOOLS_MUST_BE_DISABLED", "VERIFICATION_UNAVAILABLE",
  "VERIFICATION_FAILED", "CREDENTIAL_REQUIRED", "CREDENTIAL_UNAVAILABLE", "SECURE_STORAGE_UNAVAILABLE", "RUNTIME_CLEANUP_FAILED", "STORE_INVALID",
  "NETWORK_ERROR", "TIMEOUT", "CANCELLED", "INVALID_RESPONSE", "RESPONSE_TOO_LARGE", "AUTHENTICATION_FAILED", "ENDPOINT_NOT_FOUND", "ENDPOINT_ERROR",
  "REDIRECT_REJECTED", "SERVICE_CLOSED", "LEASE_REVOKED", "AUTHORITY_REQUIRED", "BUSY"]);
export function knownErrorCode(error) { return ERROR_CODES.has(error?.code) ? error.code : "OPERATION_FAILED"; }
