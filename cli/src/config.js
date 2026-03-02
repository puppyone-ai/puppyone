import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const CONFIG_DIR = join(homedir(), ".puppyone");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULTS = {
  api_url: "http://localhost:9090",
  api_key: null,
  refresh_token: null,
  user_email: null,
  token_expires_at: null,
  active_org: null,
  active_project: null,
};

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(patch) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const current = loadConfig();
  const merged = { ...current, ...patch };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return merged;
}

export function clearConfig() {
  if (existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2) + "\n", "utf-8");
  }
}

export function resolveAuth(cmdOrOpts) {
  let cur = cmdOrOpts;
  let merged = {};
  while (cur) {
    const o = cur.opts?.() ?? {};
    merged = { ...o, ...merged };
    cur = cur.parent;
  }
  const config = loadConfig();

  const apiUrl = merged.apiUrl ?? config.api_url ?? DEFAULTS.api_url;
  const apiKey = merged.apiKey ?? config.api_key;

  return { apiUrl, apiKey };
}
