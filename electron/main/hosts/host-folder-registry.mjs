import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Local-only mapping; the backend never receives the host filesystem path. */
export function createHostFolderRegistry({ filePath, auth, apiBase }) {
  const deployment = resolveCloudApiBaseUrl(apiBase);
  let pending = Promise.resolve();

  async function load() {
    try {
      const rows = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (!Array.isArray(rows) || rows.length > 1024) throw new Error("Invalid host folder registry.");
      return rows;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function save(rows) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(rows), { mode: 0o600, flag: "wx" });
      await fs.rename(temp, filePath);
      await fs.chmod(filePath, 0o600);
    } finally { await fs.unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  }

  async function session() {
    const current = await auth.readSession();
    if (!current || !UUID.test(current.user_id) || current.api_base_url !== deployment) {
      throw new Error("Sign in to the current Cloud deployment first.");
    }
    return current;
  }

  async function registerUnserialized({ deviceId, rootPath, name, writable = false, expectedSession = null }) {
    if (!UUID.test(deviceId) || typeof name !== "string" || !name.trim()) throw new Error("Invalid host folder.");
    const current = await session();
    if (expectedSession && (expectedSession.userId !== current.user_id ||
        expectedSession.generation !== current.session_generation)) throw new Error("Account changed before registration.");
    const info = await fs.lstat(rootPath);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Select a real directory.");
    const canonicalRoot = await fs.realpath(rootPath);
    if (canonicalRoot.split(path.sep).some((part) => part.toLowerCase() === ".git")) {
      throw new Error("Git metadata cannot be shared as a folder.");
    }
    const rows = await load();
    let row = rows.find((item) => item.deployment === deployment && item.accountId === current.user_id &&
      item.deviceId === deviceId && item.rootPath === canonicalRoot && item.state !== "removed");
    if (row && (row.name !== name.trim() || row.writable !== writable)) {
      throw new Error("This folder is already registered with different settings.");
    }
    if (!row) {
      row = { deployment, accountId: current.user_id, deviceId, folderId: crypto.randomUUID(),
        rootPath: canonicalRoot, name: name.trim(), writable, state: "pending" };
      rows.push(row);
      await save(rows); // Preserve the ID even if the response is lost.
    }
    if (row.state === "active") return { folderId: row.folderId, rootPath: canonicalRoot };
    const result = await auth.requestSessionApi(deployment, `/hosts/devices/${deviceId}/folders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: row.folderId, name: row.name, writable: row.writable }),
    }, { userId: current.user_id, generation: current.session_generation });
    if (result?.folder_id !== row.folderId) throw new Error("Folder registration returned a different identity.");
    const latest = await session();
    if (latest.user_id !== current.user_id || latest.session_generation !== current.session_generation) {
      throw new Error("Account changed during folder registration.");
    }
    row.state = "active";
    await save(rows);
    return { folderId: row.folderId, rootPath: canonicalRoot };
  }

  return Object.freeze({
    async hasActive(accountId, deviceId) {
      return (await load()).some((row) => row.deployment === deployment && row.accountId === accountId &&
        row.deviceId === deviceId && row.state === "active");
    },
    register(request) {
      const result = pending.catch(() => {}).then(() => registerUnserialized(request));
      pending = result;
      return result;
    },
    async resolve(folderId, accountId, deviceId) {
      if (!UUID.test(folderId) || !UUID.test(deviceId) || !UUID.test(accountId)) return null;
      const row = (await load()).find((item) => item.folderId === folderId && item.deviceId === deviceId &&
        item.accountId === accountId && item.deployment === deployment && item.state === "active");
      if (!row) return null;
      return { rootPath: row.rootPath, state: row.state,
        capabilities: row.writable ? ["folder.read", "folder.write"] : ["folder.read"] };
    },
    async remove(deviceId, folderId) {
      const current = await session();
      const rows = await load();
      const row = rows.find((item) => item.deployment === deployment && item.accountId === current.user_id &&
        item.deviceId === deviceId && item.folderId === folderId);
      if (!row) return false;
      if (row.state !== "removed") {
        row.state = "removed";
        await save(rows); // Deny locally before asking the backend to revoke.
      }
      // A lost DELETE reply must remain retryable even after local denial.
      await auth.requestSessionApi(deployment, `/hosts/devices/${deviceId}/folders/${folderId}`, { method: "DELETE" },
        { userId: current.user_id, generation: current.session_generation });
      return true;
    },
  });
}
