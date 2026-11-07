import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECENTS = 32;

function normalizeEntry(value) {
  if (!value || typeof value !== "object") return null;
  const deployment = normalizeCloudApiBaseUrl(value.deployment);
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 120) : "";
  const hostName = typeof value.hostName === "string" ? value.hostName.trim().slice(0, 120) : "";
  if (!deployment || !name || !["accountId", "deviceId", "folderId"].every((key) => UUID.test(value[key]))) return null;
  const opened = new Date(value.lastOpenedAt ?? 0);
  return { deployment, accountId: value.accountId.toLowerCase(), deviceId: value.deviceId.toLowerCase(),
    folderId: value.folderId.toLowerCase(), name, hostName, writable: value.writable === true,
    lastOpenedAt: Number.isNaN(opened.getTime()) ? new Date(0).toISOString() : opened.toISOString() };
}

/**
 * Folders on the owner's other computers that this computer opened recently,
 * and the one each account last had open (window restore). Public IDs and
 * display names only; access is decided again by the Cloud on every request.
 */
export function createHostRecents({ filePath, now = () => Date.now() }) {
  let queue = Promise.resolve();

  async function load() {
    try {
      const value = JSON.parse(await fs.readFile(filePath, "utf8"));
      return {
        recents: (Array.isArray(value?.recents) ? value.recents : []).map(normalizeEntry).filter(Boolean),
        lastActive: value?.lastActive && typeof value.lastActive === "object" ? value.lastActive : {},
      };
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return { recents: [], lastActive: {} };
      throw error;
    }
  }

  async function save(state) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      await fs.rename(temp, filePath);
    } finally { await fs.unlink(temp).catch(() => {}); }
  }

  function mutate(operation) {
    const next = queue.catch(() => {}).then(async () => {
      const state = await load();
      const result = await operation(state);
      await save(state);
      return result;
    });
    queue = next;
    return next;
  }

  const accountKey = (deployment, accountId) => `${normalizeCloudApiBaseUrl(deployment)}|${String(accountId).toLowerCase()}`;
  const same = (left, right) => left.deployment === right.deployment && left.accountId === right.accountId &&
    left.folderId === right.folderId;

  return Object.freeze({
    async list(deployment, accountId) {
      const base = normalizeCloudApiBaseUrl(deployment);
      return (await load()).recents.filter((entry) => entry.deployment === base &&
        entry.accountId === String(accountId).toLowerCase());
    },
    record(value) {
      const entry = normalizeEntry({ ...value, lastOpenedAt: new Date(now()).toISOString() });
      if (!entry) return Promise.reject(new Error("Invalid recent folder."));
      return mutate((state) => {
        state.recents = [entry, ...state.recents.filter((item) => !same(item, entry))].slice(0, MAX_RECENTS);
        state.lastActive[accountKey(entry.deployment, entry.accountId)] = entry.folderId;
        return entry;
      });
    },
    /** The account's last open remote folder, or null after it closed the folder. */
    async lastActive(deployment, accountId) {
      const state = await load();
      const folderId = state.lastActive[accountKey(deployment, accountId)];
      return state.recents.find((entry) => entry.folderId === folderId &&
        entry.deployment === normalizeCloudApiBaseUrl(deployment) &&
        entry.accountId === String(accountId).toLowerCase()) ?? null;
    },
    clearLastActive(deployment, accountId) {
      return mutate((state) => { delete state.lastActive[accountKey(deployment, accountId)]; return true; });
    },
    forget(deployment, accountId, folderId) {
      return mutate((state) => {
        const base = normalizeCloudApiBaseUrl(deployment);
        const before = state.recents.length;
        state.recents = state.recents.filter((entry) => !(entry.deployment === base &&
          entry.accountId === String(accountId).toLowerCase() && entry.folderId === String(folderId).toLowerCase()));
        if (state.lastActive[accountKey(deployment, accountId)] === String(folderId).toLowerCase()) {
          delete state.lastActive[accountKey(deployment, accountId)];
        }
        return state.recents.length !== before;
      });
    },
  });
}
