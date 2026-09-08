import { ProjectSessionRegistry } from "./project-session-registry.mjs";
import { ProjectOperationRegistry } from "./project-operation-registry.mjs";
import { createProjectCloseCoordinator } from "./project-close-coordinator.mjs";
import { PROJECT_SESSION_CHANGED, projectSessionError } from "../../../../shared/project-session-contract/schema.mjs";

export function createProjectSessionService({ participants = [], getSender = () => null, closeTimeoutMs } = {}) {
  const registry = new ProjectSessionRegistry();
  const operations = new ProjectOperationRegistry();
  const publish = (ownerId) => {
    registry.window(ownerId).revision += 1;
    const sender = getSender(ownerId);
    if (sender && !sender.isDestroyed?.()) {
      try { sender.send(PROJECT_SESSION_CHANGED, registry.snapshot(ownerId)); }
      catch { /* A disconnected view recovers from the versioned read endpoint. */ }
    }
  };
  const close = createProjectCloseCoordinator({ registry, operations, participants, publish, closeTimeoutMs });
  const closeWindow = async (ownerId) => {
    const window = registry.window(ownerId);
    window.closing = true;
    const results = await Promise.all([...window.projects.values()].map(close));
    const closed = results.every((result) => result.closed);
    if (!closed) window.closing = false;
    return { closed };
  };
  return Object.freeze({
    open(ownerId, folder) {
      const record = registry.open(ownerId, folder);
      publish(ownerId);
      return record;
    },
    retainForPresentation(ownerId, folder) {
      const existing = registry.windows.get(ownerId)?.projects.get(folder.path);
      if (!existing) { const record = registry.open(ownerId, folder); publish(ownerId); return record; }
      if (existing.projectId !== (folder.workspace.workspaceInstanceId || folder.workspace.id)) throw projectSessionError("PROJECT_STALE", "The local project identity changed.");
      return existing;
    },
    snapshot: (ownerId) => registry.snapshot(ownerId),
    assertWindowOpen(ownerId) {
      if (registry.window(ownerId).closing) throw projectSessionError("PROJECT_CLOSED", "The window is closing.");
    },
    roots: (ownerId) => [...(registry.windows.get(ownerId)?.projects.values() ?? [])].filter((record) => record.state === "open").map((record) => record.rootPath),
    folders: (ownerId) => [...(registry.windows.get(ownerId)?.projects.values() ?? [])].filter((record) => record.state === "open").map((record) => record.folder),
    require: (ownerId, context, options) => registry.require(ownerId, context, options),
    run(ownerId, context, action) { return operations.run(registry.require(ownerId, context), action); },
    close(ownerId, context) { return close(registry.require(ownerId, context, { allowClosing: true, allowClosed: true })); },
    async closeRoot(ownerId, rootPath) {
      const record = registry.windows.get(ownerId)?.projects.get(rootPath);
      if (!record) return { closed: true };
      const result = await close(record);
      if (!result.closed) throw projectSessionError("PROJECT_CLOSE_FAILED", "Some project resources could not be closed. Retry closing the project.", true);
      return result;
    },
    closeWindow,
    async closeAllWindows() {
      const results = await Promise.all([...registry.windows.keys()].map(closeWindow));
      if (results.some((result) => !result.closed)) throw projectSessionError("PROJECT_CLOSE_FAILED", "Some project resources could not be stopped.", true);
    },
    releaseWindow(ownerId) {
      if (registry.windows.get(ownerId)?.projects.size) return false;
      if ([...operations.operations.keys()].some((record) => record.ownerId === ownerId)) return false;
      registry.windows.delete(ownerId);
      for (const [key, record] of registry.closed) if (record.ownerId === ownerId) registry.closed.delete(key);
      return true;
    },
  });
}
