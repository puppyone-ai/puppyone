import { hostError } from "../../../shared/item-host-contract/rpc.mjs";
import { parseModelRoute } from "../../../shared/model-connections/schema.mjs";

/** Main's capability boundary for a single owned Agent host. */
export function createAgentHostAuthority({ record, sender, root, modelConnections,
  conversationCatalog, attachmentStore, records, shutdown }) {
  const scopeKey = record.key;
  const current = () => records.has(record) && record.key === scopeKey;
  return async (name, args) => {
    if (!current()) throw hostError("HOST_AUTHORITY", "The execution host generation has expired.");
    const [scope, methodName] = name.split(":");
    if (scope === "model-connections") return modelOperation(methodName, args);
    if (scope === "attachments" && ["releaseLease", "revokeLeased", "revoke"].includes(methodName)) {
      if (args[0]?.ownerId !== sender.id || args[0]?.workspaceRoot !== root) throw hostError("HOST_AUTHORITY", "Attachment owner does not match this host.");
      return attachmentStore[methodName](...args);
    }
    if (scope === "catalog") return catalogOperation(methodName, args);
    throw hostError("HOST_METHOD", "Unauthorized Agent host operation.");
  };
  async function modelOperation(methodName, args) {
    if (!modelConnections || record.runtimeId !== "puppyone-agent" || !records.has(record)) throw hostError("HOST_AUTHORITY", "Model connection authority is unavailable.");
    if (methodName === "release") return modelConnections.release({ leaseId: args[0], scope: scopeKey });
    if (record.closing || record.host.exited) throw hostError("HOST_AUTHORITY", "Model connection authority has expired.");
    if (methodName === "read") return modelConnections.catalog();
    if (methodName === "acquire") {
      if (parseModelRoute(args[0]).connectionId !== parseModelRoute(record.allowedModelRoute).connectionId) throw hostError("HOST_AUTHORITY", "The session cannot acquire another model connection.");
      const lease = await modelConnections.acquire({ route: args[0], scope: scopeKey,
        expectedBindingRevision: record.expectedBindingRevision, onRevoke: () => { if (current()) return shutdown(record); } });
      if (record.closing || !current()) {
        modelConnections.releaseScope(scopeKey);
        throw hostError("HOST_AUTHORITY", "The execution closed while acquiring its model lease.");
      }
      return lease;
    }
    if (methodName === "validate") return modelConnections.validate({ leaseId: args[0], route: args[1], scope: scopeKey });
    throw hostError("HOST_METHOD", "Unknown model connection operation.");
  }
  async function catalogOperation(methodName, args) {
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
}
