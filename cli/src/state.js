/**
 * .puppyone/state.json — local workspace state management
 *
 * Tracks which local files map to which cloud nodes, their versions, and hashes.
 * Lives inside the workspace at <workspace>/.puppyone/state.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";

const STATE_DIR = ".puppyone";
const STATE_FILE = "state.json";
const BACKUPS_DIR = "backups";

function statePath(folder) {
  return join(folder, STATE_DIR, STATE_FILE);
}

function backupsPath(folder) {
  return join(folder, STATE_DIR, BACKUPS_DIR);
}

export function loadState(folder) {
  const path = statePath(folder);
  if (!existsSync(path)) {
    return { files: {}, connection: {} };
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { files: {}, connection: {} };
  }
}

export function saveState(folder, state) {
  const dir = join(folder, STATE_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(folder), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function backupFile(folder, relPath) {
  const srcPath = join(folder, relPath);
  if (!existsSync(srcPath)) return null;

  const dir = backupsPath(folder);
  mkdirSync(dir, { recursive: true });

  const timestamp = Math.floor(Date.now() / 1000);
  const backupName = `${relPath.replace(/[/\\]/g, "_")}.${timestamp}`;
  const destPath = join(dir, backupName);

  copyFileSync(srcPath, destPath);
  return destPath;
}

export function ensurePuppyOneDir(folder) {
  mkdirSync(join(folder, STATE_DIR), { recursive: true });
  mkdirSync(backupsPath(folder), { recursive: true });
}
