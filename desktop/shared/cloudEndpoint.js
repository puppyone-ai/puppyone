export const CLOUD_API_BASE_URL_STORAGE_KEY = "puppyone.desktop.cloudApiBaseUrl";
export const PUPPYONE_CLOUD_API_HOST = "api.puppyone.ai";
export const PUPPYONE_CLOUD_WEB_HOST = "app.puppyone.ai";
export const DEFAULT_CLOUD_API_BASE_URL = `https://${PUPPYONE_CLOUD_API_HOST}/api/v1`;

export function normalizeCloudApiBaseUrl(apiBaseUrl) {
  if (typeof apiBaseUrl !== "string" || !apiBaseUrl.trim()) return null;

  try {
    const url = new URL(apiBaseUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    if (url.hostname === PUPPYONE_CLOUD_API_HOST) {
      url.protocol = "https:";
      if (!url.pathname || url.pathname === "/") {
        url.pathname = "/api/v1";
      }
    }

    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function resolveCloudApiBaseUrl(apiBaseUrl, fallback = DEFAULT_CLOUD_API_BASE_URL) {
  return normalizeCloudApiBaseUrl(apiBaseUrl) ?? normalizeCloudApiBaseUrl(fallback) ?? DEFAULT_CLOUD_API_BASE_URL;
}

export function cloudApiBaseUrlFromRemote(remoteUrl) {
  if (typeof remoteUrl !== "string" || !remoteUrl.trim()) return null;

  try {
    const url = new URL(remoteUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalizeCloudApiBaseUrl(`${url.origin}/api/v1`);
  } catch {
    return null;
  }
}

export function buildCloudApiUrl(path, apiBaseUrl) {
  return `${resolveCloudApiBaseUrl(apiBaseUrl)}${normalizeCloudApiPath(path)}`;
}

export function normalizeCloudApiPath(path) {
  if (typeof path !== "string" || !path.trim()) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

export function sameCloudApiBaseUrl(left, right) {
  return resolveCloudApiBaseUrl(left) === resolveCloudApiBaseUrl(right);
}

export function formatCloudApiHost(apiBaseUrl) {
  try {
    return new URL(resolveCloudApiBaseUrl(apiBaseUrl)).host;
  } catch {
    return "Cloud";
  }
}
