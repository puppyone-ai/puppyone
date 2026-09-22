import fs from "node:fs";
import path from "node:path";
import { normalizeCloudApiBaseUrl } from "../../shared/cloudEndpoint.js";

// This public configuration is shared with the Renderer build. Never add keys,
// tokens, or a production fallback: a missing environment must fail closed.
export function parseDesktopCloudConfiguration(environment) {
  const apiValue = environment.VITE_DESKTOP_CLOUD_API_URL;
  const webValue = environment.VITE_DESKTOP_CLOUD_WEB_URL;
  const apiBase = normalizeCloudApiBaseUrl(apiValue);
  const webOrigin = normalizeCloudApiBaseUrl(webValue);
  if (!apiBase || !webOrigin) throw new Error("Desktop Cloud endpoints are not configured.");
  for (const value of [apiValue, webValue]) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) throw new Error("Invalid Desktop Cloud endpoint.");
  }
  if (!apiBase.endsWith("/api/v1") || new URL(webOrigin).pathname !== "/") throw new Error("Invalid Desktop Cloud endpoint path.");
  return { schemaVersion: 1, apiBase, webOrigin };
}

export function loadDesktopCloudConfiguration({ appPath, development, environment = process.env, readFile = fs.readFileSync }) {
  if (development) return parseDesktopCloudConfiguration(environment);
  try {
    const value = JSON.parse(readFile(path.join(appPath, "dist", "desktop-cloud.json"), "utf8"));
    if (value.schemaVersion !== 1) return null;
    return parseDesktopCloudConfiguration({ VITE_DESKTOP_CLOUD_API_URL: value.apiBase, VITE_DESKTOP_CLOUD_WEB_URL: value.webOrigin });
  } catch { return null; }
}
