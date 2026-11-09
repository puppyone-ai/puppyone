import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const MAX_FOLDERS_PER_APP = 50;
const execFileAsync = promisify(execFile);

/**
 * Folders other apps already know about. Each app is asked only through the
 * file where it records its own vaults or recent folders; nothing is scanned.
 * A folder is offered only while it still exists.
 */
export function createAppFolderDiscovery({
  io = fs,
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  readSqliteValue = readSqliteItem,
  readPlistValue = readMacPlistKey,
} = {}) {
  const appData = platform === "darwin"
    ? path.join(home, "Library", "Application Support")
    : platform === "win32"
      ? env.APPDATA ?? path.join(home, "AppData", "Roaming")
      : env.XDG_CONFIG_HOME ?? path.join(home, ".config");

  const vsCodeHistory = (product) => async () => {
    const value = await readSqliteValue(
      path.join(appData, product, "User", "globalStorage", "state.vscdb"),
      "history.recentlyOpenedPathsList",
    );
    const entries = JSON.parse(value ?? "{}")?.entries;
    if (!Array.isArray(entries)) return [];
    // Newest first. Remote folders and single files are not local projects.
    return entries
      .filter((entry) => typeof entry?.folderUri === "string" && entry.folderUri.startsWith("file:") && !entry.remoteAuthority)
      .map((entry) => ({ path: fileURLToPath(entry.folderUri), lastUsedAt: null }));
  };

  const readers = {
    async obsidian() {
      const registry = JSON.parse(await io.readFile(path.join(appData, "obsidian", "obsidian.json"), "utf8"));
      return Object.values(registry?.vaults ?? {})
        .map((vault) => ({ path: vault?.path, lastUsedAt: Number.isFinite(vault?.ts) ? vault.ts : null }))
        .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
    },
    vscode: vsCodeHistory("Code"),
    cursor: vsCodeHistory("Cursor"),
    async typora() {
      // Typora records recent folders only in its macOS preferences.
      if (platform !== "darwin") return [];
      const folders = await readPlistValue(path.join(home, "Library", "Preferences", "abnerworks.Typora.plist"), "recentFolder");
      return Array.isArray(folders) ? folders.map((folder) => ({ path: folder, lastUsedAt: null })) : [];
    },
  };

  return Object.freeze({
    apps: Object.freeze(Object.keys(readers)),
    async list(app) {
      const read = Object.hasOwn(readers, app) ? readers[app] : null;
      if (!read) throw new Error("This app is not a known folder source.");
      // An app that is not installed, or has never opened a folder, has nothing to offer.
      const candidates = await read().catch(() => []);
      const folders = [];
      const seen = new Set();
      for (const candidate of candidates) {
        if (folders.length >= MAX_FOLDERS_PER_APP) break;
        if (typeof candidate.path !== "string" || !path.isAbsolute(candidate.path)) continue;
        const folderPath = path.resolve(candidate.path);
        if (seen.has(folderPath)) continue;
        seen.add(folderPath);
        const metadata = await io.stat(folderPath).catch(() => null);
        if (!metadata?.isDirectory()) continue;
        folders.push({ path: folderPath, name: path.basename(folderPath) || folderPath, lastUsedAt: candidate.lastUsedAt });
      }
      return folders;
    },
  });
}

async function readSqliteItem(databasePath, key) {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const value = database.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key)?.value ?? null;
    return value instanceof Uint8Array ? new TextDecoder().decode(value) : value;
  } finally {
    database.close();
  }
}

async function readMacPlistKey(plistPath, key) {
  const { stdout } = await execFileAsync("/usr/bin/plutil", ["-extract", key, "json", "-o", "-", plistPath], { timeout: 5000 });
  return JSON.parse(stdout);
}
