import { randomUUID } from "node:crypto";
import { DATABASE_PREVIEW_VERSION as version, DATABASE_BUDGET as budget, databaseError, publicDatabaseFailure } from "../../../shared/database-preview/contract.mjs";

/** A host per session: a stuck native query can be killed without another
 * document losing its cursor. No database engine runs in Electron main. */
export function createDatabasePreviewService({ spawnHost, getMemoryBytes = () => 0 }) {
  const sessions = new Map();
  const keyFor = (owner, id) => `${owner}:${id}`;
  function requireId(id) { if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw databaseError("invalid-request"); }
  function request(entry, method, payload, timeoutMs) {
    if (entry.closing || entry.pending) return Promise.reject(databaseError(entry.closing ? "cancelled" : "busy"));
    clearTimeout(entry.idle);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timeout = setTimeout(() => { entry.pending?.reject(databaseError("timeout")); void close(entry).catch(() => {}); }, timeoutMs);
      entry.pending = { id, resolve: (value) => { clearTimeout(timeout); entry.pending = null; armIdle(entry); resolve(value); },
        reject: (error) => { clearTimeout(timeout); entry.pending = null; reject(error); } };
      try { entry.host.postMessage({ version, id, method, ...payload }); }
      catch { entry.pending.reject(databaseError("host-failed")); }
    });
  }
  function armIdle(entry) { clearTimeout(entry.idle); entry.idle = setTimeout(() => { void close(entry).catch(() => {}); }, budget.idleMs); }
  async function close(entry) {
    entry.closing = true;
    entry.pending?.reject(databaseError("cancelled"));
    clearTimeout(entry.idle); clearTimeout(entry.expiry);
    await entry.created;
    if (!entry.host || entry.exited) { sessions.delete(entry.key); return; }
    // Cooperative close releases transactions immediately when responsive.
    // A native call may block the port; the external watchdog remains final.
    try { entry.host.postMessage({ version, id: randomUUID(), method: "close" }); } catch { /* Already exiting. */ }
    const force = setTimeout(() => { if (!entry.exited) entry.host.kill(); }, 100);
    await new Promise((resolve, reject) => {
      if (entry.exited) { resolve(); return; }
      const timeout = setTimeout(() => reject(databaseError("exit-unconfirmed")), budget.exitMs);
      entry.exit.then(() => { clearTimeout(timeout); resolve(); });
    }).finally(() => clearTimeout(force));
    sessions.delete(entry.key);
  }
  return {
    async open(owner, requestInput, authorize) {
      requireId(requestInput.id);
      const key = keyFor(owner, requestInput.id);
      if (sessions.has(key)) throw databaseError("invalid-request");
      if (sessions.size >= budget.maxSessions || [...sessions.values()].filter((s) => s.owner === owner).length >= budget.maxSessionsPerOwner) throw databaseError("budget-exceeded");
      let created;
      const entry = { key, owner, root: requestInput.rootPath, deadline: Date.now() + budget.sessionMs,
        closing: false, created: new Promise((resolve) => { created = resolve; }) };
      sessions.set(key, entry);
      try {
        entry.root = await authorize();
        if (entry.closing) throw databaseError("cancelled");
        const host = spawnHost(); entry.host = host;
        entry.exit = new Promise((resolve) => host.once("exit", () => {
          entry.exited = true; entry.pending?.reject(databaseError("host-failed"));
          clearTimeout(entry.idle); clearTimeout(entry.expiry); clearInterval(entry.memory); sessions.delete(key); resolve();
        }));
        host.on("message", (message) => {
          if (message?.id !== entry.pending?.id) return;
          try {
            if (message.error) entry.pending.reject(databaseError(publicDatabaseFailure(message.error).code));
            else if (!message.result || Buffer.byteLength(JSON.stringify(message.result)) > budget.maxMessageBytes) entry.pending.reject(databaseError("budget-exceeded"));
            else entry.pending.resolve({ ...message.result, expiresAt: Math.min(entry.deadline, Date.now() + budget.idleMs) });
          } catch { entry.pending?.reject(databaseError("host-failed")); }
        });
        host.on("error", () => {
          // V8/native failures are private diagnostics, never IPC error payloads.
          entry.pending?.reject(databaseError("host-failed"));
          void close(entry).catch(() => {});
        });
        created();
        entry.memory = setInterval(() => {
          if (!entry.closing && getMemoryBytes(host) > budget.maxHostRssBytes) {
            entry.pending?.reject(databaseError("budget-exceeded"));
            void close(entry).catch(() => {});
          }
        }, 500);
        entry.expiry = setTimeout(() => { void close(entry).catch(() => {}); }, budget.sessionMs);
        // Probing is supervised too: slow filesystem reads must not escape the
        // open deadline or make cancellation depend on an unresolved main I/O.
        const result = await request(entry, "open", { rootPath: entry.root, path: requestInput.path }, budget.openMs);
        await authorize();
        if (entry.closing) throw databaseError("cancelled");
        return result;
      } catch (error) { created(); await close(entry); throw error; }
    },
    async page(owner, input, authorize) {
      requireId(input.id);
      const entry = sessions.get(keyFor(owner, input.id));
      if (!entry) throw databaseError("stale-input");
      try {
        if (entry.root !== await authorize()) throw databaseError("stale-input");
        const result = await request(entry, "page", { objectId: input.objectId, columnOffset: input.columnOffset, cursor: input.cursor }, budget.queryMs);
        await authorize();
        if (entry.closing) throw databaseError("cancelled");
        return result;
      } catch (error) { await close(entry); throw error; }
    },
    async close(owner, id) { requireId(id); const entry = sessions.get(keyFor(owner, id)); if (entry) await close(entry); },
    async closeRoot(owner, root) { await Promise.all([...sessions.values()].filter((e) => e.owner === owner && e.root === root).map(close)); },
    async closeOwner(owner) { await Promise.all([...sessions.values()].filter((e) => e.owner === owner).map(close)); },
    async closeAll() { await Promise.all([...sessions.values()].map(close)); },
    sessionCount: () => sessions.size,
  };
}

export function registerDatabasePreviewIpc({ ipcMain, service, authorizeWorkspaceRoot }) {
  const reply = async (operation) => { try { return { ok: true, value: await operation() }; } catch (error) { return { ok: false, error: publicDatabaseFailure(error) }; } };
  for (const method of ["open", "page"]) ipcMain.handle(`database-preview:${method}`, (event, input) => reply(() => {
    if (!input || input.version !== version || typeof input.rootPath !== "string") throw databaseError("invalid-request");
    return service[method](event.sender.id, input, () => authorizeWorkspaceRoot(event, input.rootPath));
  }));
  ipcMain.handle("database-preview:close", (event, input) => reply(() => service.close(event.sender.id, input?.id)));
}
