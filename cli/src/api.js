import { resolveAuth, loadConfig, saveConfig } from "./config.js";

export class ApiError extends Error {
  constructor(status, code, message, hint) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

export function createClient(cmd) {
  const { apiUrl, apiKey } = resolveAuth(cmd);

  if (!apiKey) {
    throw new ApiError(0, "NOT_AUTHENTICATED", "Not logged in.", 'Run `puppyone auth login` first.');
  }

  return _makeClient(apiUrl, { Authorization: `Bearer ${apiKey}` }, { autoRefresh: true });
}

export function createOpenClawClient(accessKey, cmd, apiUrlOverride) {
  const opts = collectOpts(cmd);
  const config = loadConfig();
  const apiUrl = apiUrlOverride ?? opts.apiUrl ?? config.api_url ?? "http://localhost:9090";

  if (!accessKey) {
    throw new ApiError(0, "MISSING_KEY", "Access key is required.", "Provide --key <access-key>.");
  }

  return _makeClient(apiUrl, { "X-Access-Key": accessKey }, { autoRefresh: false });
}

export function collectOpts(cmd) {
  let cur = cmd;
  let merged = {};
  while (cur) {
    const o = cur.opts?.() ?? {};
    merged = { ...o, ...merged };
    cur = cur.parent;
  }
  return merged;
}

const REFRESH_BUFFER_SECONDS = 300;

async function _tryRefreshToken(baseUrl) {
  const config = loadConfig();
  const refreshToken = config.refresh_token;
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) return null;

    const json = await res.json();
    if (json.code !== 0 || !json.data) return null;

    const { access_token, refresh_token: newRefresh, expires_in } = json.data;
    const tokenExpiresAt = Math.floor(Date.now() / 1000) + (expires_in || 3600);

    saveConfig({
      api_key: access_token,
      refresh_token: newRefresh || refreshToken,
      token_expires_at: tokenExpiresAt,
    });

    return access_token;
  } catch {
    return null;
  }
}

function _buildUrl(baseUrl, path, query) {
  let url = `${baseUrl}/api/v1${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

function _makeClient(apiUrl, authHeaders, { autoRefresh = false } = {}) {
  const baseUrl = apiUrl.replace(/\/+$/, "");

  async function getAuthHeaders() {
    if (!autoRefresh) return authHeaders;

    const config = loadConfig();
    const expiresAt = config.token_expires_at;

    if (expiresAt && (Date.now() / 1000) > (expiresAt - REFRESH_BUFFER_SECONDS)) {
      const newToken = await _tryRefreshToken(baseUrl);
      if (newToken) {
        return { Authorization: `Bearer ${newToken}` };
      }
    }

    return authHeaders;
  }

  async function request(method, path, body, query) {
    const url = _buildUrl(baseUrl, path, query);
    const currentAuthHeaders = await getAuthHeaders();
    const headers = {
      ...currentAuthHeaders,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && autoRefresh) {
      const newToken = await _tryRefreshToken(baseUrl);
      if (newToken) {
        const retryRes = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${newToken}` },
          body: body != null ? JSON.stringify(body) : undefined,
        });
        if (retryRes.ok) {
          const json = await retryRes.json();
          if (json.code !== 0) {
            throw new ApiError(0, "API_BIZ_ERROR", json.message ?? "Unknown error");
          }
          return json.data;
        }
      }
      throw new ApiError(401, "SESSION_EXPIRED", "Session expired.", "Run `puppyone auth login` to re-authenticate.");
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.detail ?? parsed.message ?? text;
      } catch {}

      const hint = res.status === 401
        ? "Invalid or expired token. Run `puppyone auth login`."
        : res.status === 404
        ? "Check the resource ID or path."
        : undefined;

      throw new ApiError(res.status, "API_ERROR", detail, hint);
    }

    const json = await res.json();
    if (json.code !== 0) {
      throw new ApiError(0, "API_BIZ_ERROR", json.message ?? "Unknown error");
    }

    return json.data;
  }

  async function rawRequest(method, path, body, query) {
    const url = _buildUrl(baseUrl, path, query);
    const currentAuthHeaders = await getAuthHeaders();
    return fetch(url, {
      method,
      headers: { ...currentAuthHeaders, "Content-Type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  async function upload(path, filePath, query) {
    const { createReadStream, statSync } = await import("node:fs");
    const { basename } = await import("node:path");
    const url = _buildUrl(baseUrl, path, query);
    const currentAuthHeaders = await getAuthHeaders();
    const stat = statSync(filePath);
    const stream = createReadStream(filePath);

    return fetch(url, {
      method: "POST",
      headers: {
        ...currentAuthHeaders,
        "Content-Type": "application/octet-stream",
        "X-Filename": basename(filePath),
        "Content-Length": String(stat.size),
      },
      body: stream,
      duplex: "half",
    });
  }

  return {
    baseUrl,
    get: (path, query) => request("GET", path, null, query),
    post: (path, body, query) => request("POST", path, body, query),
    put: (path, body, query) => request("PUT", path, body, query),
    patch: (path, body, query) => request("PATCH", path, body, query),
    del: (path, body, query) => request("DELETE", path, body, query),
    raw: rawRequest,
    upload,
    getAuthHeaders,
  };
}
