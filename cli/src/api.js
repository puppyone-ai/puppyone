import { resolveAuth } from "./config.js";

export class ApiError extends Error {
  constructor(status, code, message, hint) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

/**
 * Create a pre-configured API client bound to the current CLI context.
 */
export function createClient(cmd) {
  const { apiUrl, apiKey } = resolveAuth(cmd);

  if (!apiKey) {
    throw new ApiError(0, "NOT_AUTHENTICATED", "Not logged in.", 'Run `puppyone login` first.');
  }

  const baseUrl = apiUrl.replace(/\/+$/, "");

  async function request(method, path, body) {
    const url = `${baseUrl}/api/v1${path}`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
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
        ? "Your token may be expired. Run `puppyone login` again."
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
