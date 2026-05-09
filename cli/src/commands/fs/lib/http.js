import { ApiError } from "../../../api.js";

export async function get(client, path, query, headers = {}) {
  if (!Object.keys(headers).length) return client.get(path, query);
  return requestWithExtraHeaders(client, "GET", path, null, query, headers);
}

export async function post(client, path, body, headers = {}) {
  if (!Object.keys(headers).length) return client.post(path, body);
  return requestWithExtraHeaders(client, "POST", path, body, null, headers);
}

export async function rawGet(client, path, query, headers = {}) {
  const res = !Object.keys(headers).length
    ? await client.raw("GET", path, null, query)
    : await rawRequestWithExtraHeaders(client, "GET", path, null, query, headers);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail ?? parsed.message ?? text;
    } catch {}
    throw new ApiError(res.status, "API_ERROR", detail);
  }
  return res;
}

export async function rawPostBytes(client, path, content, query = {}, headers = {}) {
  const res = await rawRequestWithExtraHeaders(
    client,
    "POST",
    path,
    content,
    query,
    headers,
    "application/octet-stream",
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail ?? parsed.message ?? text;
    } catch {}
    throw new ApiError(res.status, "API_ERROR", detail);
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new ApiError(0, "API_BIZ_ERROR", json.message ?? "Unknown error");
  }
  return json.data;
}

export async function getScopeBaseCommit(client, path, headers = {}) {
  const stat = await get(client, "/ap-fs/stat", { path }, headers);
  return stat.scope_head_commit_id ?? stat.head_commit_id ?? "";
}

export async function requestWithExtraHeaders(client, method, path, body, query, extraHeaders) {
  const url = new URL(`${client.baseUrl}/api/v1${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
  }
  const authHeaders = await client.getAuthHeaders();
  const channelHeaders = client.getChannelHeaders?.() ?? {};
  const res = await fetch(url, {
    method,
    headers: { ...authHeaders, ...channelHeaders, ...extraHeaders, "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail ?? parsed.message ?? text;
    } catch {}
    const hint = res.status === 409
      ? "The remote scope changed before this write landed. Pull the latest state or use `mut pull`, resolve, `mut commit`, and `mut push`."
      : undefined;
    throw new ApiError(res.status, "API_ERROR", detail, hint);
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new ApiError(0, "API_BIZ_ERROR", json.message ?? "Unknown error");
  }
  return json.data;
}

export async function rawRequestWithExtraHeaders(
  client,
  method,
  path,
  body,
  query,
  extraHeaders,
  contentType = null,
) {
  const url = new URL(`${client.baseUrl}/api/v1${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
  }
  const authHeaders = await client.getAuthHeaders();
  const channelHeaders = client.getChannelHeaders?.() ?? {};
  const bodyHeaders = contentType ? { "Content-Type": contentType } : {};
  return fetch(url, {
    method,
    headers: { ...authHeaders, ...channelHeaders, ...bodyHeaders, ...extraHeaders },
    body: body != null && contentType === "application/octet-stream"
      ? body
      : body != null
        ? JSON.stringify(body)
        : undefined,
  });
}
