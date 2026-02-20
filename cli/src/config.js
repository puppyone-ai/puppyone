import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".puppyone");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULTS = {
  api_url: "http://localhost:9090",
  api_key: null,
  default_project: null,
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

/**
 * Resolve effective api_url and api_key from CLI flags → config file.
 * Returns { api_url, api_key } or throws with a helpful message.
 */
export function resolveAuth(cmdOrOpts) {
  const root = cmdOrOpts?.parent ?? cmdOrOpts;
  const opts = root.opts?.() ?? root;
  const config = loadConfig();

  const apiUrl = opts.apiUrl ?? config.api_url ?? DEFAULTS.api_url;
  const apiKey = opts.apiKey ?? config.api_key;

  return { apiUrl, apiKey };
}
