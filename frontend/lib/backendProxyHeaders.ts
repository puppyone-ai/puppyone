/**
 * Explicit request-header allowlist for the same-origin backend proxy.
 * Keep protocol/version headers here so browser API-client upgrades reach
 * the backend rather than being silently stripped at the BFF boundary.
 */
export const BACKEND_REQUEST_HEADERS_TO_FORWARD = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'range',
  'x-puppyone-repository-contract',
] as const;

export function forwardBackendRequestHeaders(requestHeaders: Headers): Headers {
  const headers = new Headers();
  for (const headerName of BACKEND_REQUEST_HEADERS_TO_FORWARD) {
    const value = requestHeaders.get(headerName);
    if (value) headers.set(headerName, value);
  }
  return headers;
}
