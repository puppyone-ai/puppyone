/**
 * Global workspace registry — ~/.puppyone/registry.json
 *
 * Tracks all workspaces the user has registered, their connection info,
 * and provides helpers to read per-workspace stats + pid liveness.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const GLOBAL_DIR = join(homedir(), ".puppyone");
const REGISTRY_FILE = join(GLOBAL_DIR, "registry.json");

function ensureDir() {
  mkdirSync(GLOBAL_DIR, { recursive: true });
}

export function loadRegistry() {
  if (!existsSync(REGISTRY_FILE)) return { workspaces: {} };
  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"));
  } catch {
    return { workspaces: {} };
  }
}

export function saveRegistry(reg) {
  ensureDir();
  writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2) + "\n", "utf-8");
}

export function registerWorkspace(absPath, info) {
  const reg = loadRegistry();
  reg.workspaces[absPath] = {
    ...reg.workspaces[absPath],
    ...info,
    registered_at: reg.workspaces[absPath]?.registered_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  saveRegistry(reg);
}

export function unregisterWorkspace(absPath) {
  const reg = loadRegistry();
  delete reg.workspaces[absPath];
  saveRegistry(reg);
}

export function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Read per-workspace daemon stats from <workspace>/.puppyone/stats.json.
 * Returns null if file doesn't exist or is invalid.
 */
export function readStats(workspacePath) {
  const statsFile = join(workspacePath, ".puppyone", "stats.json");
  if (!existsSync(statsFile)) return null;
  try {
    return JSON.parse(readFileSync(statsFile, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Read PID from <workspace>/.puppyone/daemon.pid.
 */
export function readPid(workspacePath) {
  const pidFile = join(workspacePath, ".puppyone", "daemon.pid");
  if (!existsSync(pidFile)) return null;
  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  return isNaN(pid) ? null : pid;
}

/**
 * Build a unified snapshot of all workspaces with their live status.
 */
export function getAllWorkspaces() {
  const reg = loadRegistry();
  const results = [];

  for (const [path, info] of Object.entries(reg.workspaces)) {
    const pid = readPid(path);
    const alive = pid ? isProcessAlive(pid) : false;
    const stats = readStats(path);
    const stateFile = join(path, ".puppyone", "state.json");
    let state = null;
    try {
      if (existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, "utf-8"));
    } catch { /* ignore */ }

    results.push({
      path,
      name: info.name ?? null,
      agent_id: info.agent_id ?? state?.connection?.agent_id ?? null,
      project_id: info.project_id ?? state?.connection?.project_id ?? null,
      api_url: info.api_url ?? state?.connection?.api_url ?? null,
      pid: alive ? pid : null,
      running: alive,
      stats,
      files_tracked: state ? Object.keys(state.files ?? {}).length : 0,
      cursor: state?.cursor ?? 0,
      last_sync: stats?.last_sync_at ?? null,
      conflicts: stats?.conflicts ?? [],
      transfers: stats?.transfers ?? { active: [], completed_count: 0, error_count: 0 },
      registered_at: info.registered_at,
    });
  }

  return results;
}

/**
 * Get a single workspace snapshot.
 */
export function getWorkspace(absPath) {
  return getAllWorkspaces().find(w => w.path === absPath) ?? null;
}
