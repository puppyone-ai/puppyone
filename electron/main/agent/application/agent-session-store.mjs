import { normalizeRequiredId, requireSenderId } from "./agent-input-policy.mjs";
import { projectSessionError } from "../../../../shared/project-session-contract/schema.mjs";

/** Main-owned application-session identity, window ownership, and retirement store. */
export class AgentSessionStore {
  constructor({ onOwnerDestroyed }) {
    this.onOwnerDestroyed = onOwnerDestroyed;
    this.sessions = new Map();
    this.ownerCleanups = new Map();
    this.closedInstances = new Map();
  }

  add(session) {
    if (this.sessions.has(session.id)) throw new Error(`Duplicate Agent session: ${session.id}`);
    this.sessions.set(session.id, session);
    this.#attachOwner(session);
    return session;
  }

  adoptIdentity(session, id) {
    if (session.id === id) return;
    if (!this.isCurrent(session) || session.sequence > 0 || this.sessions.has(id)) throw new Error("Native conversation is already owned by another Agent session.");
    this.remove(session);
    session.id = id;
    this.add(session);
  }

  get(id) { return this.sessions.get(id) ?? null; }
  isCurrent(session) { return this.sessions.get(session.id) === session; }
  values() { return Array.from(this.sessions.values()); }

  remove(session) {
    if (!this.isCurrent(session)) return false;
    this.sessions.delete(session.id);
    this.#detachOwner(session);
    return true;
  }

  retire(session) {
    if (this.isCurrent(session)) this.#detachOwner(session);
  }

  requireOwned(sender, id) {
    const normalizedId = normalizeRequiredId(id, "Agent session id");
    const session = this.sessions.get(normalizedId);
    if (!session) throw projectSessionError("SESSION_NOT_FOUND", "Agent session was not found or has already closed.");
    if (session.ownerId !== requireSenderId(sender)) throw projectSessionError("SESSION_UNAUTHORIZED", "Agent session is owned by another window.");
    return session;
  }

  assertInstance(sender, request, workspaceRoot, { allowClosed = false } = {}) {
    if (allowClosed && this.wasClosed(sender, request, workspaceRoot)) return null;
    const session = this.requireOwned(sender, request?.sessionId);
    if (!request.instanceId || session.instanceId !== request.instanceId) throw projectSessionError("SESSION_STALE", "This running conversation instance has ended.");
    if (session.workspaceRoot !== workspaceRoot) throw projectSessionError("SESSION_UNAUTHORIZED", "The conversation belongs to another project.");
    return session;
  }

  rememberClosed(session) {
    this.closedInstances.set(`${session.ownerId}:${session.instanceId}`, { id: session.id, root: session.workspaceRoot });
    while (this.closedInstances.size > 512) this.closedInstances.delete(this.closedInstances.keys().next().value);
  }

  wasClosed(sender, request, workspaceRoot) {
    if (!request?.instanceId) return false;
    const previous = this.closedInstances.get(`${requireSenderId(sender)}:${request.instanceId}`);
    return previous?.id === request.sessionId && previous.root === workspaceRoot;
  }

  findOwned(ownerId, workspaceRoot, { connectedOnly = false } = {}) {
    return this.values()
      .filter((session) => session.ownerId === ownerId
        && session.workspaceRoot === workspaceRoot
        && (!connectedOnly || !session.providerExited))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] ?? null;
  }

  takeRetired(ownerId, workspaceRoot, requestedSessionId = null) {
    const retired = this.values()
      .filter((session) => session.ownerId === ownerId
        && session.workspaceRoot === workspaceRoot
        && session.providerExited
        && session.providerSessionId
        && (!requestedSessionId || session.id === requestedSessionId))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] ?? null;
    if (!retired) return null;
    clearTimeout(retired.persistTimer);
    retired.persistTimer = null;
    this.remove(retired);
    return retired;
  }

  discardRetired(ownerId, workspaceRoot) {
    for (const session of this.values()) {
      if (session.ownerId !== ownerId || session.workspaceRoot !== workspaceRoot || !session.providerExited) continue;
      clearTimeout(session.persistTimer);
      session.persistTimer = null;
      this.remove(session);
    }
  }

  activeCount() { return this.values().filter((session) => !session.providerExited).length; }
  get size() { return this.sessions.size; }

  #attachOwner(session) {
    let cleanup = this.ownerCleanups.get(session.ownerId);
    if (!cleanup) {
      const onDestroyed = () => {
        this.ownerCleanups.delete(session.ownerId);
        Promise.resolve().then(() => this.onOwnerDestroyed(session.ownerId)).catch((error) => {
          console.error("Unable to stop Agent resources after window destruction:", error);
        });
      };
      cleanup = { sender: session.sender, onDestroyed, sessionIds: new Set() };
      this.ownerCleanups.set(session.ownerId, cleanup);
      session.sender.once?.("destroyed", onDestroyed);
    }
    cleanup.sessionIds.add(session.id);
  }

  #detachOwner(session) {
    const cleanup = this.ownerCleanups.get(session.ownerId);
    if (!cleanup) return;
    cleanup.sessionIds.delete(session.id);
    if (cleanup.sessionIds.size > 0) return;
    cleanup.sender.removeListener?.("destroyed", cleanup.onDestroyed);
    this.ownerCleanups.delete(session.ownerId);
  }
}
