import { hostError } from "../../../shared/item-host-contract/rpc.mjs";

const COMMON = new Set(["system:open-external-url", "localization:get-bootstrap", "resource-transfer:preview-drag", "resource-transfer:claim-drop", "resource-transfer:resolve"]);
const AGENT = new Set(["agent:providers-discover", "agent:local-connections-discover", "agent:models-list", "agent:account-read",
  "agent:session-create", "agent:session-resume", "agent:session-open", "agent:session-fork", "agent:session-archive",
  "agent:session-delete", "agent:session-close", "agent:reference-stage", "agent:reference-revoke",
  "agent:reference-resolve-workspace", "agent:reference-pick-workspace", "agent:command-dispatch", "agent:session-compact"]);
const TERMINAL = new Set(["terminal:input", "terminal:resize", "terminal:appearance"]);

/** Registration is authoritative; a child cannot gain Shell privileges by URL. */
export function createItemRendererAuthority() {
  const children = new Map();
  const registeredIds = new Set();
  return {
    register(entry) { children.set(entry.view.webContents.id, entry); registeredIds.add(entry.view.webContents.id); },
    unregister(entry) { children.delete(entry.view.webContents.id); },
    require(event) {
      const entry = children.get(event.sender.id);
      if (!entry || entry.closed || entry.closeRequested || event.senderFrame !== entry.view.webContents.mainFrame
        || new URL(event.senderFrame.url).href !== new URL(entry.url).href) {
        throw hostError("HOST_AUTHORITY", "The item display is not authorized.");
      }
      return entry;
    },
    route(event, channel) {
      if (!registeredIds.has(event.sender.id)) return null;
      const entry = this.require(event);
      const allowed = COMMON.has(channel) || (entry.kind === "agent" ? AGENT : TERMINAL).has(channel);
      if (!allowed) throw hostError("HOST_AUTHORITY", "The item display cannot access this application operation.");
      const owner = entry.owner;
      const sender = {
        id: owner.id,
        hostItemId: entry.itemId,
        isDestroyed: () => owner.isDestroyed(),
        send: (...args) => { if (!entry.view.webContents.isDestroyed()) entry.view.webContents.send(...args); },
        once: (...args) => owner.once(...args),
        on: (...args) => owner.on(...args),
        removeListener: (...args) => owner.removeListener(...args),
      };
      return { ...event, sender, itemHost: entry };
    },
    async invoke(event, channel, args, listener) {
      const entry = event.itemHost;
      if (entry.operations.size >= 16) throw hostError("HOST_BUSY", "This item's application control queue is full.");
      const operation = Promise.resolve().then(() => listener(event, ...this.scopeRequest(event, channel, args)));
      entry.operations.add(operation);
      try {
        const result = await operation;
        if (channel === "agent:reference-stage" && Array.isArray(result)) {
          for (const reference of result) if (reference.token) entry.referenceTokens.add(reference.token);
        }
        return result;
      } finally { entry.operations.delete(operation); }
    },
    scopeRequest(event, channel, args) {
      const entry = event.itemHost;
      if (!entry || (!channel.startsWith("agent:") && !channel.startsWith("terminal:"))) return args;
      const request = args[0] ?? {};
      if (typeof request !== "object" || Array.isArray(request)) throw hostError("HOST_PAYLOAD", "Invalid item request.");
      if (request.rootPath && request.rootPath !== entry.projectContext.rootPath) throw hostError("HOST_AUTHORITY", "Cross-project item request.");
      if (channel.startsWith("terminal:") && request.id !== entry.itemId) throw hostError("HOST_AUTHORITY", "Cross-terminal item request.");
      return [{ ...request, rootPath: entry.projectContext.rootPath, projectContext: entry.projectContext }, ...args.slice(1)];
    },
  };
}
