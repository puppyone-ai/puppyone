import { normalizeRequiredId, requireSenderId } from "./agent-input-policy.mjs";

/** Main-owned application-session identity, window ownership, and retirement store. */
export class AgentSessionStore {
  constructor({ onOwnerDestroyed }) {
    this.onOwnerDestroyed = onOwnerDestroyed;
    this.sessions = new Map();
    this.ownerCleanups = new Map();
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
    if (!session) throw new Error("Agent session was not found or has already closed.");
    if (session.ownerId !== requireSenderId(sender)) throw new Error("Agent session is owned by another window.");
    return session;
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
        void this.onOwnerDestroyed(session.ownerId);
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
