import { runItemHost } from "../item-host-runtime.mjs";
import { createAgentService } from "../../main/agent/application/agent-service.mjs";
import { createDefaultAgentRuntimeHost } from "../../main/agent/bootstrap/create-agent-runtime-host.mjs";
import { createEphemeralAgentSessionCache } from "../../main/agent/cache/ephemeral-agent-session-cache.mjs";
import { createAgentSessionRepository } from "../../main/agent/persistence/agent-session-repository.mjs";
import { createHostRpc } from "../../../shared/item-host-contract/rpc.mjs";

const methods = new Set(["createSession", "resumeSession", "openSession", "startTurn", "steerTurn", "interruptTurn",
  "resolveApproval", "resolveQuestion", "replay", "attachSession", "acknowledgeSession", "readSessionWatermark",
  "detachSession", "compactSession", "closeSession", "getReferenceInputCapabilities", "forkSession", "archiveSession", "deleteSession"]);
const displayMethods = new Set(["attachSession", "acknowledgeSession", "readSessionWatermark", "detachSession", "replay"]);

export function startAgentItemHost({ createRuntimeRegistry = createDefaultAgentRuntimeHost } = {}) {
runItemHost({
  methods,
  createService({ identity, callMain }) {
    const catalog = Object.fromEntries(["save", "findById", "findLatest", "list", "archive", "remove", "bindNative",
      "upsertNative", "reconcileNative", "markUnavailable", "listPage", "getRevision", "getCoverage", "applyNativePage"]
      .map((method) => [method, (...args) => {
        // Transcript/replay retention stays in this utility. Main is the sole
        // durable metadata catalog writer and never receives the event stream.
        if (["save", "bindNative", "upsertNative"].includes(method) && args[0]) {
          const { events: _events, ...metadata } = args[0];
          args[0] = metadata;
        }
        return callMain(`catalog:${method}`, args);
      }]));
    const attachmentStore = Object.fromEntries(["releaseLease", "revokeLeased", "revoke"]
      .map((method) => [method, (...args) => callMain(`attachments:${method}`, args)]));
    return createAgentService({
      runtimeRegistry: createRuntimeRegistry({
        appVersion: identity.appVersion,
        ...identity.runtimeEnvironment,
        ...(identity.modelConnectionsEnabled ? { puppyOneAgent: { modelConnectionPort: {
          read: () => callMain("model-connections:read", []),
          acquire: (route) => callMain("model-connections:acquire", [route]),
          validate: (leaseId, route) => callMain("model-connections:validate", [leaseId, route]),
          release: (leaseId) => callMain("model-connections:release", [leaseId]),
        } } } : {}),
      }),
      sessionCache: createAgentSessionRepository({ eventCache: createEphemeralAgentSessionCache(), conversationCatalog: catalog }),
      conversationCatalog: catalog,
      attachmentStore,
    });
  },
  onDisplay({ service, owner, port, binding }) {
    const subscriptions = new Set();
    let closed = false;
    const rpc = createHostRpc({ generation: binding.connection, send: (message) => port.postMessage(message),
      handle: async (method, args) => {
        if (!displayMethods.has(method)) throw new Error("This display connection does not authorize Agent commands.");
        const request = args[0];
        if (request?.sessionId !== binding.sessionId || request?.instanceId !== binding.instanceId) throw new Error("Stale Agent display instance.");
        const result = await service[method](owner, request, binding.root);
        if (method === "attachSession") {
          if (closed) {
            service.detachSession(owner, { ...request, subscriptionId: result.subscriptionId }, binding.root);
            throw new Error("Agent display detached during subscription setup.");
          }
          subscriptions.add(result.subscriptionId);
        }
        if (method === "detachSession") subscriptions.delete(request.subscriptionId);
        return result;
      },
    });
    port.on("message", ({ data }) => { void rpc.receive(data).catch(() => port.close()); });
    port.on("close", () => {
      closed = true;
      rpc.close();
      for (const subscriptionId of subscriptions) {
        try { service.detachSession(owner, { sessionId: binding.sessionId, instanceId: binding.instanceId, subscriptionId }, binding.root); }
        catch { /* The session may have already closed. */ }
      }
    });
  },
});
}
