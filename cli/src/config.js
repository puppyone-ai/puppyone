import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const CONFIG_DIR = join(homedir(), ".puppyone");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const CLOUD_API_URL = "https://api.puppyone.ai";
export const LOCAL_API_URL = "http://localhost:9090";

const AUTH_KEYS = new Set([
  "api_key",
  "refresh_token",
  "user_email",
  "token_expires_at",
]);

const DEFAULTS = {
  api_url: null,
  api_key: null,
  refresh_token: null,
  user_email: null,
  token_expires_at: null,
  active_org: null,
  active_project: null,
};

// ── Internal helpers ─────────────────────────────────────────

function _normalizeUrl(url) {
  return url?.replace(/\/+$/, "") ?? null;
}

function _readRaw() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function _writeRaw(raw) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2) + "\n", "utf-8");
}

/**
 * Migrate flat v1 config → targets-based v2 structure.
 * If already v2 (has `targets` key), return as-is.
 */
function _migrate(raw) {
  if (raw.targets) return raw;

  const apiUrl = raw.api_url || null;
  const targetAuth = {};
  for (const k of AUTH_KEYS) {
    if (raw[k] != null) targetAuth[k] = raw[k];
  }

  const migrated = {
    current_target: apiUrl,
    targets: {},
  };

  if (apiUrl && Object.keys(targetAuth).length > 0) {
    migrated.targets[apiUrl] = targetAuth;
  }

  for (const [k, v] of Object.entries(raw)) {
    if (k === "api_url" || AUTH_KEYS.has(k)) continue;
    migrated[k] = v;
  }

  return migrated;
}

// ── Public API (backward-compatible flat interface) ──────────

/**
 * Load config as a flat object with api_url, api_key, etc.
 * Auth fields are resolved from the current target's stored credentials.
 */
export function loadConfig() {
  const raw = _migrate(_readRaw());
  const currentUrl = raw.current_target ?? null;
  const targetAuth = (currentUrl && raw.targets?.[currentUrl]) ?? {};

  const flat = { ...DEFAULTS };
  flat.api_url = currentUrl;

  for (const k of AUTH_KEYS) {
    if (targetAuth[k] != null) flat[k] = targetAuth[k];
  }

  for (const [k, v] of Object.entries(raw)) {
    if (k === "current_target" || k === "targets") continue;
    if (k === "api_url" || AUTH_KEYS.has(k)) continue;
    flat[k] = v;
  }

  return flat;
}

/**
 * Patch config. Auth-related keys are stored under the current target.
 * Setting `api_url` switches the active target.
 */
export function saveConfig(patch) {
  const raw = _migrate(_readRaw());

  if (patch.api_url != null) {
    const newUrl = _normalizeUrl(patch.api_url);
    if (newUrl !== raw.current_target) {
      raw.active_org = null;
      raw.active_project = null;
    }
    raw.current_target = newUrl;
  }

  const currentUrl = raw.current_target;
  if (!raw.targets) raw.targets = {};

  for (const [k, v] of Object.entries(patch)) {
    if (k === "api_url") continue;
    if (AUTH_KEYS.has(k)) {
      if (currentUrl) {
        if (!raw.targets[currentUrl]) raw.targets[currentUrl] = {};
        raw.targets[currentUrl][k] = v;
      }
    } else {
      raw[k] = v;
    }
  }

  _writeRaw(raw);
  return loadConfig();
}

/** Reset config to empty state (wipes all targets). */
export function clearConfig() {
  if (existsSync(CONFIG_FILE)) {
    _writeRaw({ current_target: null, targets: {} });
  }
}

/**
 * Resolve api_url and api_key from CLI option chain + config.
 * When --api-url points to a saved target, uses that target's cached token.
 */
export function resolveAuth(cmdOrOpts) {
  let cur = cmdOrOpts;
  let merged = {};
  while (cur) {
    const o = cur.opts?.() ?? {};
    merged = { ...o, ...merged };
    cur = cur.parent;
  }
  const config = loadConfig();
  const requestedUrl = merged.apiUrl ?? config.api_url ?? LOCAL_API_URL;

  let apiKey = merged.apiKey;
  if (!apiKey && requestedUrl && requestedUrl !== config.api_url) {
    const cached = getTargetAuth(requestedUrl);
    if (cached?.api_key) apiKey = cached.api_key;
  }
  if (!apiKey) apiKey = config.api_key;

  return { apiUrl: requestedUrl, apiKey };
}

// ── Target management ────────────────────────────────────────

/** Get cached auth for a specific API URL (or null). */
export function getTargetAuth(apiUrl) {
  apiUrl = _normalizeUrl(apiUrl);
  const raw = _migrate(_readRaw());
  return raw.targets?.[apiUrl] ?? null;
}

/**
 * Save auth fields to a specific target WITHOUT changing current_target.
 * Used by token refresh so --api-url overrides write to the correct target.
 */
export function saveTargetAuth(apiUrl, authPatch) {
  apiUrl = _normalizeUrl(apiUrl);
  const raw = _migrate(_readRaw());
  if (!raw.targets) raw.targets = {};
  if (!raw.targets[apiUrl]) raw.targets[apiUrl] = {};
  for (const [k, v] of Object.entries(authPatch)) {
    if (AUTH_KEYS.has(k)) {
      raw.targets[apiUrl][k] = v;
    }
  }
  _writeRaw(raw);
}

/** Switch active target. Clears org/project context when target changes. Returns cached auth or null. */
export function switchTarget(apiUrl) {
  apiUrl = _normalizeUrl(apiUrl);
  const raw = _migrate(_readRaw());
  if (apiUrl !== raw.current_target) {
    raw.active_org = null;
    raw.active_project = null;
  }
  raw.current_target = apiUrl;
  _writeRaw(raw);
  return raw.targets?.[apiUrl] ?? null;
}

/** List all saved targets with their login state. */
export function listTargets() {
  const raw = _migrate(_readRaw());
  const current = raw.current_target;
  return Object.entries(raw.targets ?? {}).map(([url, auth]) => ({
    url,
    user_email: auth.user_email ?? null,
    active: url === current,
  }));
}

/** Remove a saved target and its credentials. */
export function removeTarget(apiUrl) {
  apiUrl = _normalizeUrl(apiUrl);
  const raw = _migrate(_readRaw());
  if (raw.targets) delete raw.targets[apiUrl];
  if (raw.current_target === apiUrl) raw.current_target = null;
  _writeRaw(raw);
}
