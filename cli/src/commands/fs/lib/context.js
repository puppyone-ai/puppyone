import { ApiError, createAccessKeyClient, collectOpts } from "../../../api.js";
import {
  getAccessPointCredential,
  loadConfig,
  LOCAL_API_URL,
} from "../../../config.js";

export function detectNodeType(path) {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "markdown";
  return "file";
}

export function resolveAccessPointContext(cmd) {
  const opts = collectOpts(cmd);
  const config = loadConfig();
  const profiles = config.access_points || {};
  const profile = opts.profile || config.current_access_point || null;
  const profileMeta = profile ? profiles[profile] : null;
  const legacy = config.active_access_point || null;
  const key = (
    opts.accessKey ||
    process.env.PUPPYONE_ACCESS_KEY ||
    process.env.PUPPYONE_AP_KEY ||
    (profile ? getAccessPointCredential(profile) : null) ||
    legacy?.access_key
  );
  const apiUrl = opts.apiUrl || profileMeta?.api_url || legacy?.api_url || config.api_url || LOCAL_API_URL;
  if (!key) {
    throw new ApiError(
      0,
      "MISSING_ACCESS_KEY",
      "No active Access Point is configured.",
      "Run `puppyone ap login <profile> --api-url <url>` once, or pass --access-key.",
    );
  }
  return { accessKey: key, apiUrl, profile, profileMeta, legacy };
}

export function createApClient(cmd) {
  const { accessKey, apiUrl } = resolveAccessPointContext(cmd);
  return createAccessKeyClient(accessKey, cmd, apiUrl);
}

export async function extraHeaders(cmd) {
  const opts = collectOpts(cmd);
  const actor = opts.actor;
  return actor ? { "X-Mut-User": actor } : {};
}
