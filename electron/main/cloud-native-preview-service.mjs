import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeCloudApiBaseUrl } from "../../shared/cloudEndpoint.js";
import { normalizeRelativePath } from "../../local-api/files/path-policy.mjs";
import { DATABASE_BUDGET, databaseError, publicDatabaseFailure } from "../../shared/database-preview/contract.mjs";
import { REPOSITORY_TARGET_CONTRACT_HEADER, REPOSITORY_TARGET_CONTRACT_VERSION } from "../../shared/repositoryContract.js";

/** Selected Cloud bytes are disposable, read-only decoder inputs, never a
 * checkout or a fallback to a Local project. Native engines and their existing
 * isolation/exit barriers are shared with Local; Cloud owns authorization. */
export function createCloudNativePreviewService({ auth, database, convertOffice, fetchResource = fetch, temporaryRoot = os.tmpdir() }) {
  const entries = new Map();
  const key = (owner, id) => `${owner}:${id}`;
  function requireInput(input) {
    if (!input || !/^[a-zA-Z0-9-]{1,100}$/.test(input.id ?? "") || typeof input.projectId !== "string"
      || !input.projectId || input.projectId.length > 200 || typeof input.path !== "string" || input.path.length > 4096
      || typeof input.expectedSession?.userId !== "string" || !input.expectedSession.userId || input.expectedSession.userId.length > 200
      || typeof input.expectedSession?.generation !== "string" || !input.expectedSession.generation || input.expectedSession.generation.length > 200) throw databaseError("invalid-request");
    const apiBaseUrl = normalizeCloudApiBaseUrl(input.apiBaseUrl);
    const relative = normalizeRelativePath(input.path);
    if (!apiBaseUrl || !relative) throw databaseError("invalid-request");
    return { ...input, apiBaseUrl, path: relative };
  }
  async function assertSession(entry) {
    if (entry.closing) throw databaseError("cancelled");
    const session = await auth.readSession();
    if (!session || session.user_id !== entry.input.expectedSession.userId
      || session.session_generation !== entry.input.expectedSession.generation
      || normalizeCloudApiBaseUrl(session.api_base_url) !== entry.input.apiBaseUrl) throw databaseError("permission-denied");
    entry.abort.signal.throwIfAborted();
  }
  async function request(entry, endpoint, body) {
    await assertSession(entry);
    const value = await auth.requestSessionApi(entry.input.apiBaseUrl,
      `/content/${encodeURIComponent(entry.input.projectId)}/${endpoint}`, {
        method: body ? "POST" : "GET", signal: entry.abort.signal,
        headers: { "Content-Type": "application/json", [REPOSITORY_TARGET_CONTRACT_HEADER]: REPOSITORY_TARGET_CONTRACT_VERSION },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }, entry.input.expectedSession);
    await assertSession(entry); return value;
  }
  async function head(entry) {
    const directory = await request(entry, "ls");
    if (typeof directory.head_commit_id !== "string" || !directory.head_commit_id) throw databaseError("stale-input");
    return directory.head_commit_id;
  }
  function validateSignedUrl(entry, signed) {
    const base = new URL(entry.input.apiBaseUrl), url = new URL(signed.url, `${base.href}/`);
    if (url.origin !== base.origin || url.username || url.password || url.hash
      || url.pathname !== `${base.pathname.replace(/\/$/, "")}/content/${encodeURIComponent(entry.input.projectId)}/inline`
      || url.searchParams.get("path") !== entry.input.path || !url.searchParams.get("token")) throw databaseError("permission-denied");
    return url;
  }
  async function download(entry, maximum) {
    const baseline = await head(entry);
    const signed = await request(entry, "inline/sign", { path: entry.input.path });
    const url = validateSignedUrl(entry, signed);
    entry.root = await fs.mkdtemp(path.join(temporaryRoot, "puppyone-cloud-preview-"));
    entry.filename = `source${path.extname(entry.input.path).toLowerCase()}`;
    entry.abort.signal.throwIfAborted();
    const response = await fetchResource(url.href, { signal: entry.abort.signal, credentials: "omit", redirect: "error" });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw databaseError("missing-member"); }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) <= 0 || Number(declared) > maximum)) {
      await response.body.cancel(); throw databaseError("budget-exceeded");
    }
    const file = await fs.open(path.join(entry.root, entry.filename), "wx", 0o600);
    const reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        entry.abort.signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) throw databaseError("budget-exceeded");
        let offset = 0;
        while (offset < value.byteLength) offset += (await file.write(value, offset, value.byteLength - offset)).bytesWritten;
      }
      if (!size || (declared !== null && size !== Number(declared))) throw databaseError("missing-member");
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); await file.close(); }
    await fs.chmod(path.join(entry.root, entry.filename), 0o400);
    if (baseline !== await head(entry)) throw databaseError("stale-input");
    entry.head = baseline;
  }
  function allocate(owner, input) {
    input = requireInput(input);
    const identity = key(owner, input.id);
    if (!Number.isSafeInteger(owner) || owner <= 0 || entries.has(identity)
      || entries.size >= DATABASE_BUDGET.maxSessions
      || [...entries.values()].filter((entry) => entry.owner === owner).length >= DATABASE_BUDGET.maxSessionsPerOwner) throw databaseError("budget-exceeded");
    const entry = { identity, owner, input, abort: new AbortController(), closing: false };
    entries.set(identity, entry);
    entry.deadline = setTimeout(() => { void close(entry).catch(() => {}); }, DATABASE_BUDGET.sessionMs);
    return entry;
  }
  async function cleanup(entry) {
    if (entry.cleaned) return;
    if (entry.database) await database.close(entry.owner, entry.input.id);
    clearTimeout(entry.deadline);
    if (entry.root) await fs.rm(entry.root, { recursive: true, force: true });
    entry.cleaned = true; entries.delete(entry.identity);
  }
  function close(entry) {
    return entry.closePromise ??= (async () => {
      entry.closing = true; entry.abort.abort();
      if (entry.database) await database.close(entry.owner, entry.input.id);
      await entry.work?.catch(() => {});
      await cleanup(entry);
    })().catch((error) => { entry.closePromise = null; throw error; });
  }
  const service = {
    async openDatabase(owner, input) {
      const entry = allocate(owner, input);
      entry.database = true;
      entry.work = (async () => {
        await download(entry, DATABASE_BUDGET.maxSourceBytes);
        // A remote main file with recovery sidecars cannot be presented as a
        // complete snapshot merely because its private decoder directory is empty.
        for (const suffix of ["-wal", "-shm", "-journal", ".wal"]) {
          try {
            const stat = await request(entry, `stat?path=${encodeURIComponent(entry.input.path + suffix)}`);
            if (stat.exists !== false) throw databaseError("recovery-required");
          } catch (error) { if (error.status !== 404) throw error; }
        }
        if (entry.head !== await head(entry)) throw databaseError("stale-input");
        return await database.open(owner, { version: 1, id: entry.input.id, rootPath: entry.root, path: entry.filename }, async () => {
          await assertSession(entry); return entry.root;
        });
      })().catch(async (error) => { await cleanup(entry); throw error; });
      return entry.work;
    },
    async readDatabase(owner, input) {
      const entry = entries.get(key(owner, input?.id));
      if (!entry?.database) throw databaseError("session-expired");
      try {
        return await database.page(owner, { ...input, version: 1 }, async () => { await assertSession(entry); return entry.root; });
      } catch (error) { await close(entry); throw error; }
    },
    async convertOffice(owner, input) {
      input = requireInput(input);
      if (!/\.(?:doc|rtf)$/i.test(input.path)) throw new Error("Unsupported Office conversion.");
      const entry = allocate(owner, input);
      entry.work = (async () => {
        await download(entry, 25 * 1024 * 1024);
        const result = await convertOffice(entry.root, entry.filename, { signal: entry.abort.signal });
        await assertSession(entry); return result;
      })().finally(() => cleanup(entry));
      return entry.work;
    },
    async close(owner, id) { const entry = entries.get(key(owner, id)); if (entry) await close(entry); },
    async closeOwner(owner) { await Promise.all([...entries.values()].filter((entry) => entry.owner === owner).map(close)); },
    async closeAll() { await Promise.all([...entries.values()].map(close)); },
    async reconcileSession() {
      await Promise.all([...entries.values()].map(async (entry) => {
        try { await assertSession(entry); } catch { await close(entry); }
      }));
    },
  };
  return service;
}

export function registerCloudNativePreviewIpc(ipcMain, service) {
  const reply = async (operation) => {
    try { return { ok: true, value: await operation() }; }
    catch (error) { return { ok: false, error: publicDatabaseFailure(error) }; }
  };
  ipcMain.handle("cloud-preview:database-open", (event, input) => reply(() => service.openDatabase(event.sender.id, input)));
  ipcMain.handle("cloud-preview:database-page", (event, input) => reply(() => service.readDatabase(event.sender.id, input)));
  ipcMain.handle("cloud-preview:office-convert", (event, input) => reply(() => service.convertOffice(event.sender.id, input)));
  ipcMain.handle("cloud-preview:close", (event, input) => service.close(event.sender.id, input?.id));
}
