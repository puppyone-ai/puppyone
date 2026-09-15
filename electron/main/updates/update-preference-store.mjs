import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DESKTOP_UPDATE_PREFERENCE_SCHEMA_VERSION = 1;

const DEFAULT_PREFERENCES = Object.freeze({
  schemaVersion: DESKTOP_UPDATE_PREFERENCE_SCHEMA_VERSION,
  automaticallyDownloadUpdates: true,
});

export function createDesktopUpdatePreferenceStore({
  filePath,
  fsApi = fs.promises,
  logger = console,
  now = () => Date.now(),
} = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new TypeError("A Desktop update preference path is required.");
  }

  const resolvedFilePath = path.resolve(filePath);
  let mutationQueue = Promise.resolve();

  async function read() {
    try {
      const metadata = await fsApi.lstat(resolvedFilePath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64 * 1024) {
        throw new Error("Desktop update preferences are unsafe or oversized.");
      }
      return normalizePreferences(JSON.parse(await fsApi.readFile(resolvedFilePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return { ...DEFAULT_PREFERENCES };
      logger.warn?.("Unable to read Desktop update preferences; using automatic downloads.", error);
      return { ...DEFAULT_PREFERENCES };
    }
  }

  function write(value) {
    const result = mutationQueue.then(() => writeImmediately(value));
    mutationQueue = result.catch(() => undefined);
    return result;
  }

  async function writeImmediately(value) {
    const preferences = {
      schemaVersion: DESKTOP_UPDATE_PREFERENCE_SCHEMA_VERSION,
      automaticallyDownloadUpdates: value?.automaticallyDownloadUpdates !== false,
    };
    const directory = path.dirname(resolvedFilePath);
    await fsApi.mkdir(directory, { recursive: true, mode: 0o700 });
    await fsApi.chmod(directory, 0o700).catch(() => undefined);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(resolvedFilePath)}.${process.pid}.${now()}.${crypto.randomBytes(6).toString("hex")}.tmp`,
    );
    let handle = null;
    try {
      handle = await fsApi.open(temporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(preferences, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fsApi.rename(temporaryPath, resolvedFilePath);
      await fsApi.chmod(resolvedFilePath, 0o600).catch(() => undefined);
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await fsApi.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    return preferences;
  }

  return Object.freeze({ read, write });
}

function normalizePreferences(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== DESKTOP_UPDATE_PREFERENCE_SCHEMA_VERSION) {
    return { ...DEFAULT_PREFERENCES };
  }
  return {
    schemaVersion: DESKTOP_UPDATE_PREFERENCE_SCHEMA_VERSION,
    automaticallyDownloadUpdates: value.automaticallyDownloadUpdates !== false,
  };
}
