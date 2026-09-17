import { randomUUID } from "node:crypto";
import { createUtilityHost } from "./utility-host.mjs";
import { hostError } from "../../../shared/item-host-contract/rpc.mjs";

const SESSION_METHODS = ["startTurn", "steerTurn", "interruptTurn", "resolveApproval", "resolveQuestion", "replay",
  "attachSession", "acknowledgeSession", "readSessionWatermark", "detachSession", "compactSession"];

/** Main retains authority and routing metadata, never a running Agent actor. */
export function createAgentProcessService({ utilityProcess, modulePath, budget, appVersion,
  runtimeEnvironment = {}, catalogService, conversationCatalog, attachmentStore,
  onHostEvent = () => {}, createHost = createUtilityHost }) {
  const records = new Set();
  const bySession = new Map();
  const closed = new Map();
  const pendingSessions = new Set();
  const requireOwned = (sender, request, root, { allowClosed = false } = {}) => {
    const record = bySession.get(request?.sessionId) ?? (allowClosed ? closed.get(request?.instanceId) : null);
    if (!record || record.ownerId !== sender.id || (root && record.root !== root)
      || (request?.instanceId && record.instanceId !== request.instanceId)
      || (sender.hostItemId && sender.hostItemId !== record.itemId)) {
      throw hostError("SESSION_STALE", "This Agent instance is no longer owned by this project.");
    }
    return record;
  };
  const shutdown = async (record) => {
    await record.host.close();
    records.delete(record);
    if (bySession.get(record.sessionId) === record) bySession.delete(record.sessionId);
    if (record.instanceId) {
      closed.set(record.instanceId, record);
      while (closed.size > 128) closed.delete(closed.keys().next().value);
    }
  };
  const closeMatching = async (predicate) => {
    const matches = [...records].filter(predicate);
    const results = await Promise.allSettled(matches.map(shutdown));
    const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, "Agent process cleanup is incomplete.");
    return matches.length;
  };
  async function create(method, sender, request, root, operation) {
    operation?.assertCurrent();
    if (method !== "createSession" && request.sessionId && bySession.has(request.sessionId)) {
      const record = requireOwned(sender, request, root);
      const result = await record.host.call(method, [request, root]);
      // Resume may replace a retired native runtime while keeping its conversation
      // ID. Publish the new instance fence before the renderer attaches its feed.
      if (!records.has(record) || bySession.get(request.sessionId) !== record) {
        throw hostError("SESSION_STALE", "This Agent instance is no longer owned by this project.");
      }
      try { operation?.assertCurrent(); }
      catch (error) { await shutdown(record).catch(() => {}); throw error; }
      const snapshot = method === "openSession" ? result?.snapshot : result;
      if (!snapshot?.session) {
        if (method === "resumeSession") await shutdown(record);
        return result;
      }
      if (snapshot.session.id !== record.sessionId) throw hostError("SESSION_STALE", "Recovery returned a different Agent conversation.");
      record.instanceId = snapshot.session.instanceId;
      record.runtimeId = snapshot.session.runtimeId;
      return result;
    }
    if (sender.hostItemId && [...records].some((record) => record.ownerId === sender.id && record.itemId === sender.hostItemId)) {
      throw hostError("SESSION_DUPLICATE", "This item already owns a starting or live Agent session.");
    }
    const locator = method !== "createSession" && request.sessionId ? `${root}:${request.sessionId}` : null;
    if (locator && pendingSessions.has(locator)) throw hostError("SESSION_DUPLICATE", "This Agent history is already opening.");
    const key = randomUUID();
    const record = { key, ownerId: sender.id, itemId: sender.hostItemId ?? key, root,
      sessionId: null, instanceId: null, host: null };
    record.host = createHost({ utilityProcess, modulePath, budget,
      identity: { key, ownerId: sender.id, projectId: request.projectContext?.projectId ?? root, kind: "agent" },
      initialize: { ownerId: sender.id, root, appVersion, runtimeEnvironment },
      handle: async (name, args) => {
        const [scope, methodName] = name.split(":");
        if (scope === "attachments" && ["releaseLease", "revokeLeased", "revoke"].includes(methodName)) {
          if (args[0]?.ownerId !== sender.id || args[0]?.workspaceRoot !== root) throw hostError("HOST_AUTHORITY", "Attachment owner does not match this host.");
          return attachmentStore[methodName](...args);
        }
        if (scope === "catalog") {
          if (["save", "bindNative", "upsertNative"].includes(methodName)) {
            if (args[0]?.workspaceRoot !== root || args[0]?.events) throw hostError("HOST_AUTHORITY", "The host may only publish its own conversation metadata.");
          } else if (methodName === "findById") {
            if (args[1] !== root) throw hostError("HOST_AUTHORITY", "The conversation belongs to another project.");
          } else if (methodName === "findLatest") {
            if (args[0] !== root) throw hostError("HOST_AUTHORITY", "The conversation belongs to another project.");
          } else if (["remove", "archive", "markUnavailable"].includes(methodName)) {
            if (!await conversationCatalog.findById(args[0], root)) return null;
          } else throw hostError("HOST_METHOD", "The session host does not own catalog scanning.");
          return conversationCatalog[methodName](...args);
        }
        throw hostError("HOST_METHOD", "Unauthorized Agent host operation.");
      },
      onEvent: (event) => onHostEvent(record, event),
      onExit: (event) => onHostEvent(record, { type: "host-exited", ...event }),
    });
    records.add(record);
    if (locator) pendingSessions.add(locator);
    try {
      const result = await record.host.call(method, [request, root]);
      const snapshot = method === "openSession" ? result?.snapshot : result;
      if (!snapshot?.session) { await shutdown(record); return result; }
      record.sessionId = snapshot.session.id;
      record.instanceId = snapshot.session.instanceId;
      record.runtimeId = snapshot.session.runtimeId;
      if (bySession.has(record.sessionId)) throw hostError("SESSION_DUPLICATE", "This Agent session is already connected.");
      bySession.set(record.sessionId, record);
      operation?.assertCurrent();
      return result;
    } catch (error) { await shutdown(record).catch(() => {}); throw error; }
    finally { if (locator) pendingSessions.delete(locator); }
  }
  const service = {
    ...Object.fromEntries(["discoverProviders", "listModels", "readAccount", "listSessions"]
      .map((method) => [method, (...args) => catalogService[method](...args)])),
    ...Object.fromEntries(SESSION_METHODS.map((method) => [method, (sender, request, root) =>
      requireOwned(sender, request, root).host.call(method, [request, root])])),
    createSession: (...args) => create("createSession", ...args),
    resumeSession: (...args) => create("resumeSession", ...args),
    openSession: (...args) => create("openSession", ...args),
    async forkSession(sender, request, root) {
      const record = requireOwned(sender, request, root);
      const snapshot = await record.host.call("forkSession", [request, root]);
      bySession.delete(record.sessionId);
      record.sessionId = snapshot.session.id;
      record.instanceId = snapshot.session.instanceId;
      record.runtimeId = snapshot.session.runtimeId;
      bySession.set(record.sessionId, record);
      return snapshot;
    },
    ...Object.fromEntries(["archiveSession", "deleteSession"].map((method) => [method, async (sender, request, root) => {
      if (!bySession.has(request.sessionId)) return catalogService[method](sender, request, root);
      const record = requireOwned(sender, request, root);
      const result = await record.host.call(method, [request, root]);
      await shutdown(record);
      return result;
    }])),
    assertSessionInstance: requireOwned,
    getReferenceInputCapabilities(sender, sessionId, root) {
      return requireOwned(sender, { sessionId }, root).host.call("getReferenceInputCapabilities", [sessionId, root]);
    },
    async closeSession(sender, request, root) {
      const record = requireOwned(sender, request, root, { allowClosed: true });
      if (!record.host.exited) await record.host.call("closeSession", [request, root]);
      await shutdown(record);
      return { sessionId: request.sessionId, closed: true };
    },
    attachDisplay(sender, request, port, binding) {
      const record = requireOwned(sender, request, binding.root);
      record.host.attachPort(port, { ...binding, sessionId: record.sessionId, instanceId: record.instanceId });
      return { hostGeneration: record.host.generation, hostPid: record.host.pid };
    },
    findItemSession(ownerId, itemId) {
      const record = [...records].find((entry) => entry.ownerId === ownerId && entry.itemId === itemId && entry.sessionId);
      return record ? { sessionId: record.sessionId, instanceId: record.instanceId, runtimeId: record.runtimeId, root: record.root } : null;
    },
    closeItem: (ownerId, itemId) => closeMatching((record) => record.ownerId === ownerId && record.itemId === itemId),
    async closeSessionsForWindow(id) {
      await closeMatching((record) => record.ownerId === id);
      await catalogService.closeSessionsForWindow(id);
      await attachmentStore.revokeOwner(id);
    },
    async closeSessionsForWorkspaceRoot(id, root) {
      const count = await closeMatching((record) => record.ownerId === id && record.root === root);
      await catalogService.closeSessionsForWorkspaceRoot(id, root);
      await attachmentStore.revokeWorkspace(id, root);
      return count;
    },
    async closeAll() { await closeMatching(() => true); await catalogService.closeAll(); },
    getSessionCount: () => records.size,
    getRetainedSessionCount: () => records.size,
    hasRuntimeResources: () => records.size > 0 || catalogService.hasRuntimeResources(),
    diagnostics: () => [...records].map((record) => ({ sessionId: record.sessionId, itemId: record.itemId, ...record.host.diagnostics() })),
  };
  return service;
}
