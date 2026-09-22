import { createUtilityHost } from "./utility-host.mjs";
import { hostError } from "../../../shared/item-host-contract/rpc.mjs";
import { randomUUID } from "node:crypto";
import { createItemLifecycleSupervisor } from "./item-lifecycle-supervisor.mjs";

export function createTerminalProcessService({ utilityProcess, modulePath, budget, appVersion,
  initializeWorkspaceEditReview, terminalAgentActivityHost, onHostEvent = () => {},
  lifecycle = createItemLifecycleSupervisor(), createHost = createUtilityHost }) {
  const sessions = new Map();
  const closed = new Map();
  const requireOwned = (sender, request, root, { allowClosed = false } = {}) => {
    const record = sessions.get(request?.id) ?? (allowClosed ? closed.get(request?.instanceId) : null);
    if (!record || record.ownerId !== sender.id || (root && record.root !== root)
      || (request?.instanceId && record.instanceId !== request.instanceId)) {
      throw hostError("SESSION_STALE", "This terminal instance is no longer owned by this project.");
    }
    if (!allowClosed) lifecycle.assertActive(record.lifecycle);
    return record;
  };
  const release = (record) => {
    sessions.delete(record.id);
    if (record.instanceId) {
      closed.set(record.instanceId, record);
      while (closed.size > 128) closed.delete(closed.keys().next().value);
    }
  };
  const shutdown = (record) => lifecycle.close(record.lifecycle);
  const closeMatching = async (predicate) => {
    const matches = [...sessions.values()].filter(predicate);
    const results = await Promise.allSettled(matches.map(shutdown));
    const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, "Terminal process cleanup is incomplete.");
    return matches.length;
  };
  const control = (method, sender, request) => {
    const record = requireOwned(sender, request);
    void record.host.call(method, [request]).catch((error) => onHostEvent(record, { type: "control-failed", code: error.code, message: error.message }));
    return true;
  };
  return {
    async create(sender, request, root, operation) {
      operation?.assertCurrent();
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(request.id ?? "")) throw hostError("HOST_PAYLOAD", "Invalid terminal item identity.");
      if (sessions.has(request.id)) throw hostError("SESSION_DUPLICATE", "This terminal is already starting or running.");
      const managed = lifecycle.reserve({ ownerId: sender.id, root, projectContext: request.projectContext,
        kind: "terminal", itemId: request.id, creationId: request.creationId ?? randomUUID() });
      const record = { id: request.id, ownerId: sender.id, root, instanceId: null, receipt: null, host: null, lifecycle: managed };
      sessions.set(record.id, record);
      lifecycle.attach(managed, { host: null, release: () => release(record) });
      try {
      record.host = createHost({ utilityProcess, modulePath, budget,
        identity: { key: request.id, ownerId: sender.id, projectId: request.projectContext?.projectId ?? root, kind: "terminal" },
        initialize: { ownerId: sender.id, root, appVersion },
        handle: async (method, args) => {
          if (method !== "closeTerminalSession") lifecycle.assertActive(managed);
          if (method === "initializeWorkspaceEditReview" && args[0] === root) return initializeWorkspaceEditReview(root);
          if (method === "prepareTerminalSession" && args[0]?.terminalSessionId === request.id && args[0]?.workspaceRoot === root) {
            const result = await terminalAgentActivityHost?.prepareTerminalSession({ ...args[0], webContentsId: sender.id });
            if (managed.desiredLifecycle !== "active") {
              terminalAgentActivityHost?.closeTerminalSession(request.id);
              lifecycle.assertActive(managed);
            }
            return result;
          }
          if (method === "closeTerminalSession" && args[0] === request.id) return terminalAgentActivityHost?.closeTerminalSession(request.id);
          throw hostError("HOST_METHOD", "Unauthorized terminal host operation.");
        },
        onEvent: (event) => onHostEvent(record, event),
        onExit: (event) => {
          lifecycle.observeExit(managed);
          terminalAgentActivityHost?.closeTerminalSession(request.id);
          onHostEvent(record, { type: "host-exited", ...event });
        },
      });
      lifecycle.attach(managed, { host: record.host, release: () => release(record) });
        const result = await record.host.call("create", [request, root]);
        lifecycle.assertActive(managed);
        if (result.id !== record.id) throw hostError("HOST_IDENTITY", "Terminal startup returned a different item identity.");
        record.instanceId = result.instanceId;
        record.receipt = result;
        operation?.assertCurrent();
        lifecycle.markLive(managed);
        return result;
      } catch (error) {
        await shutdown(record).catch(() => {});
        throw error;
      }
    },
    assertSessionInstance: requireOwned,
    async cancelCreation(sender, id) {
      const record = sessions.get(id);
      if (record && record.ownerId === sender.id) await shutdown(record);
    },
    input: (sender, request) => control("input", sender, request),
    resize: (sender, request) => control("resize", sender, request),
    appearance: (sender, request) => control("appearance", sender, request),
    async close(sender, request) { await shutdown(requireOwned(sender, request, null, { allowClosed: true })); return true; },
    async attachDisplay(sender, request, port, binding) {
      const record = requireOwned(sender, request);
      await record.host.ready;
      lifecycle.assertActive(record.lifecycle);
      record.host.attachPort(port, { ...binding, id: record.id, instanceId: record.instanceId });
      return { ...record.receipt, hostGeneration: record.host.generation, hostPid: record.host.pid };
    },
    getDisplayReceipt: (sender, request) => requireOwned(sender, request).receipt,
    closeSessionsForWindow: (id) => closeMatching((record) => record.ownerId === id),
    closeSessionsForWorkspaceRoot: (id, root) => closeMatching((record) => record.ownerId === id && record.root === root),
    closeAll: () => closeMatching(() => true),
    getSessionCount: () => sessions.size,
    diagnostics: () => [...sessions.values()].map((record) => ({ id: record.id, ownerId: record.ownerId,
      lifecycle: lifecycle.summary(record.lifecycle), ...record.host?.diagnostics() })),
  };
}
