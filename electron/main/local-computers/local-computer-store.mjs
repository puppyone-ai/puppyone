import fs from "node:fs/promises";
import path from "node:path";

const STORE_VERSION = 1;
const VALID_STATUSES = new Set(["running", "asleep", "provisioning", "stopped", "error"]);
const VALID_ENGINES = new Set(["lima", "managed"]);

function normalizeStatus(status) {
  if (typeof status === "string" && VALID_STATUSES.has(status)) {
    return status;
  }
  return "asleep";
}

function normalizeEngine(engine) {
  if (typeof engine === "string" && VALID_ENGINES.has(engine)) {
    return engine;
  }
  return "managed";
}

function normalizePort(value) {
  if (Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }
  return null;
}

function normalizeRecord(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const workspacePath = typeof entry.workspacePath === "string" ? entry.workspacePath.trim() : "";
  if (!id || !workspacePath) return null;
  const fallbackName = path.basename(workspacePath) || id;
  const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
  const name = rawName || fallbackName;
  const rawInstance = typeof entry.instanceName === "string" ? entry.instanceName.trim() : "";
  const instanceName = rawInstance || `p1-${id.slice(0, 12)}`;
  const now = new Date().toISOString();
  return Object.freeze({
    id,
    name,
    workspacePath,
    instanceName,
    engine: normalizeEngine(entry.engine),
    status: normalizeStatus(entry.status),
    desktopReady: entry.desktopReady === true,
    vncPort: normalizePort(entry.vncPort),
    statusDetail: typeof entry.statusDetail === "string" && entry.statusDetail.trim()
      ? entry.statusDetail.trim()
      : null,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : now,
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : now,
  });
}

function createEmptyData() {
  return {
    version: STORE_VERSION,
    experimentalEnabled: false,
    computers: [],
  };
}

export function createLocalComputerStore({ filePath }) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("A filePath is required for createLocalComputerStore.");
  }
  let state = null;
  let writeChain = Promise.resolve();

  async function ensureLoaded() {
    if (state) return state;
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed?.computers) ? parsed.computers : [];
      const seenPaths = new Set();
      const computers = [];
      for (const item of list) {
        const record = normalizeRecord(item);
        if (!record || seenPaths.has(record.workspacePath)) continue;
        seenPaths.add(record.workspacePath);
        computers.push(record);
      }
      state = {
        version: STORE_VERSION,
        experimentalEnabled: parsed?.experimentalEnabled === true,
        computers,
      };
    } catch {
      state = createEmptyData();
    }
    return state;
  }

  function enqueueSave() {
    const snapshot = {
      version: STORE_VERSION,
      experimentalEnabled: Boolean(state?.experimentalEnabled),
      computers: [...(state?.computers ?? [])],
    };
    const nextWrite = writeChain.then(async () => {
      const directory = path.dirname(filePath);
      await fs.mkdir(directory, { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, filePath);
    });
    writeChain = nextWrite.catch(() => {});
    return nextWrite;
  }

  return Object.freeze({
    async read() {
      const loaded = await ensureLoaded();
      return {
        experimentalEnabled: loaded.experimentalEnabled,
        computers: [...loaded.computers],
      };
    },

    async setExperimentalEnabled(enabled) {
      const loaded = await ensureLoaded();
      loaded.experimentalEnabled = enabled === true;
      await enqueueSave();
      return loaded.experimentalEnabled;
    },

    async upsert(recordInput) {
      const loaded = await ensureLoaded();
      const normalized = normalizeRecord(recordInput);
      if (!normalized) {
        throw new Error("Invalid computer record.");
      }
      const next = loaded.computers.filter(
        (item) => item.id !== normalized.id && item.workspacePath !== normalized.workspacePath,
      );
      next.unshift(normalized);
      loaded.computers = next;
      await enqueueSave();
      return normalized;
    },

    async update(id, patch) {
      const loaded = await ensureLoaded();
      const index = loaded.computers.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const existing = loaded.computers[index];
      const updated = normalizeRecord({
        ...existing,
        ...patch,
        id: existing.id,
        updatedAt: new Date().toISOString(),
      });
      if (!updated) return null;
      loaded.computers[index] = updated;
      await enqueueSave();
      return updated;
    },

    async remove(id) {
      const loaded = await ensureLoaded();
      const target = loaded.computers.find((item) => item.id === id) ?? null;
      if (!target) return null;
      loaded.computers = loaded.computers.filter((item) => item.id !== id);
      await enqueueSave();
      return target;
    },
  });
}
