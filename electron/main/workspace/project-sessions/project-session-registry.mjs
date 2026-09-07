import { randomUUID } from "node:crypto";
import { parseProjectSessionContext, projectSessionError } from "../../../../shared/project-session-contract/schema.mjs";

/** Authority is held by a window, independently of its displayed composition. */
export class ProjectSessionRegistry {
  windows = new Map();
  closed = new Map();

  window(ownerId) {
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw projectSessionError("PROJECT_UNAUTHORIZED", "Invalid project owner.");
    let window = this.windows.get(ownerId);
    if (!window) {
      window = { streamId: randomUUID(), revision: 0, projects: new Map(), closing: false };
      this.windows.set(ownerId, window);
    }
    return window;
  }

  open(ownerId, folder) {
    const window = this.window(ownerId);
    if (window.closing) throw projectSessionError("PROJECT_CLOSED", "The window is closing.");
    const projectId = folder.workspace.workspaceInstanceId || folder.workspace.id;
    const existing = window.projects.get(folder.path);
    if (existing) {
      if (existing.state !== "open") throw projectSessionError("PROJECT_CLOSING", "This project is still closing. Retry closing it before reopening.", true);
      if (existing.projectId !== projectId) throw projectSessionError("PROJECT_STALE", "The local project identity changed.");
      return existing;
    }
    for (const [otherOwner, other] of this.windows) {
      for (const project of other.projects.values()) {
        if (project.projectId === projectId || project.rootPath === folder.path) {
          if (otherOwner !== ownerId || project.rootPath !== folder.path) throw projectSessionError("PROJECT_UNAUTHORIZED", "This project is already owned by another context.");
        }
      }
    }
    const record = {
      ...parseProjectSessionContext({ projectId, rootPath: folder.path, generation: randomUUID() }),
      ownerId, folder, state: "open", failures: [], closePromise: null,
    };
    window.projects.set(record.rootPath, record);
    return record;
  }

  require(ownerId, context, { allowClosing = false, allowClosed = false } = {}) {
    const expected = parseProjectSessionContext(context);
    let record = this.windows.get(ownerId)?.projects.get(expected.rootPath);
    if ((!record || record.generation !== expected.generation) && allowClosed) record = this.closed.get(`${ownerId}:${expected.generation}`);
    if (!record || record.projectId !== expected.projectId || record.generation !== expected.generation || record.rootPath !== expected.rootPath) {
      throw projectSessionError("PROJECT_STALE", "This project instance is no longer open.");
    }
    if (record.state !== "open" && !allowClosing && !(allowClosed && record.state === "closed")) {
      throw projectSessionError("PROJECT_CLOSING", "This project is closing.", true);
    }
    return record;
  }

  finish(record) {
    record.state = "closed";
    const window = this.windows.get(record.ownerId);
    if (window?.projects.get(record.rootPath) === record) window.projects.delete(record.rootPath);
    this.closed.set(`${record.ownerId}:${record.generation}`, record);
    while (this.closed.size > 256) this.closed.delete(this.closed.keys().next().value);
  }

  snapshot(ownerId) {
    const window = this.window(ownerId);
    return Object.freeze({ streamId: window.streamId, revision: window.revision,
      projects: Object.freeze([...window.projects.values()].map(({ projectId, generation, rootPath, state, failures }) => (
        Object.freeze({ projectId, generation, rootPath, state, failures: Object.freeze([...failures]) })
      ))),
    });
  }
}
