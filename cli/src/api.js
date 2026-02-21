import { resolveAuth, loadConfig } from "./config.js";

export class ApiError extends Error {
  constructor(status, code, message, hint) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

/**
 * Create a pre-configured API client using JWT Bearer auth (sync mode).
 */
export function createClient(cmd) {
  const { apiUrl, apiKey } = resolveAuth(cmd);

  if (!apiKey) {
    throw new ApiError(0, "NOT_AUTHENTICATED", "Not logged in.", 'Run `puppyone login` first.');
  }

  return _makeClient(apiUrl, { Authorization: `Bearer ${apiKey}` });
}

/**
 * Create a pre-configured API client using X-Access-Key auth (OpenClaw mode).
 *
 * API URL resolution order:
 *   1. Explicit `apiUrlOverride` (from saved connection config)
 *   2. CLI global flag `-u / --api-url`
 *   3. Config file `api_url`
 *   4. Default `http://localhost:9090`
 */
export function createOpenClawClient(accessKey, cmd, apiUrlOverride) {
  const root = cmd?.parent ?? cmd;
  const opts = root?.opts?.() ?? root ?? {};
  const config = loadConfig();
  const apiUrl = apiUrlOverride ?? opts.apiUrl ?? config.api_url ?? "http://localhost:9090";

  if (!accessKey) {
    throw new ApiError(0, "MISSING_KEY", "Access key is required.", "Provide --key <access-key>.");
  }

  return _makeClient(apiUrl, { "X-Access-Key": accessKey });
}

function _makeClient(apiUrl, authHeaders) {
  const baseUrl = apiUrl.replace(/\/+$/, "");

  async function request(method, path, body) {
    const url = `${baseUrl}/api/v1${path}`;
    const headers = {
      ...authHeaders,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.detail ?? parsed.message ?? text;
      } catch {}

      const hint = res.status === 401
        ? "Invalid or expired access key."
        : res.status === 404
        ? "Check the resource ID exists."
        : undefined;

      throw new ApiError(res.status, "API_ERROR", detail, hint);
    }

    const json = await res.json();
    if (json.code !== 0) {
      throw new ApiError(0, "API_BIZ_ERROR", json.message ?? "Unknown error");
    }

    return json.data;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    del: (path) => request("DELETE", path),
  };
}
