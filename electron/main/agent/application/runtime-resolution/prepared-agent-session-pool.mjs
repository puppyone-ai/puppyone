import { isDeepStrictEqual } from "node:util";

/** Main-owned empty native sessions, bounded until a new Chat claims one. */
export class PreparedAgentSessionPool {
  constructor({ ttlMs = 30_000, maxEntries = 4 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  put(runtimeId, workspaceRoot, readiness, adapter) {
    const key = `${runtimeId}\0${workspaceRoot}`;
    this.discard(key);
    while (this.entries.size >= this.maxEntries) this.discard(this.entries.keys().next().value);
    const timer = setTimeout(() => this.discard(key), this.ttlMs);
    timer.unref?.();
    this.entries.set(key, { adapter, launch: launchConfiguration(readiness), timer });
  }

  take(runtimeId, workspaceRoot, readiness, callbacks) {
    const key = `${runtimeId}\0${workspaceRoot}`;
    const entry = this.entries.get(key);
    if (!entry) return null;
    // Remove ownership synchronously: concurrent Chats cannot claim the same session.
    this.entries.delete(key);
    clearTimeout(entry.timer);
    if (isDeepStrictEqual(entry.launch, launchConfiguration(readiness))
      && entry.adapter.adoptPreparedSession(callbacks)) return entry.adapter;
    dispose(entry.adapter);
    return null;
  }

  discard(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    clearTimeout(entry.timer);
    dispose(entry.adapter);
  }

  clear() {
    for (const key of this.entries.keys()) this.discard(key);
  }
}

function launchConfiguration(readiness) {
  return structuredClone({ executablePath: readiness.executablePath, version: readiness.version,
    argsPrefix: readiness.argsPrefix ?? [], environment: readiness.environment ?? {} });
}

function dispose(adapter) {
  // The runtime registry retains failed disposals for host shutdown retry.
  try { void Promise.resolve(adapter.dispose()).catch(() => {}); } catch { /* Registry owns retry. */ }
}
