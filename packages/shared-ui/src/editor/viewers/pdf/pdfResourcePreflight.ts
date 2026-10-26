/** Transport admission, NOT PDF parsing. Desktop also checks the header and
 * byte budget on every protocol request using the open file descriptor. */
export async function preflightPdfResource(url: string, maxBytes: number, signal: AbortSignal): Promise<void> {
  const resource = new URL(url);
  const loopback = resource.protocol === "http:" && !resource.username && !resource.password
    && ["localhost", "127.0.0.1", "[::1]"].includes(resource.hostname);
  if (!loopback && !["puppyone-local:", "https:", "blob:"].includes(resource.protocol)) throw new Error("resource");
  const options = { signal, cache: "no-store", credentials: "omit", redirect: "error" } as const;
  // Blob resources support GET only; HEAD fails before returning an HTTP status.
  let response = await fetch(url, { ...options, method: resource.protocol === "blob:" ? "GET" : "HEAD" });
  if (response.status === 405) {
    await response.body?.cancel();
    // Cloud's inline endpoint supports GET only. Inspect its full-response
    // headers, then cancel without buffering the PDF. A Range probe would
    // require Content-Range CORS exposure and could mistake one byte for the
    // total size. Do not weaken MIME, size or redirect admission.
    response = await fetch(url, { ...options, method: "GET" });
  }
  try {
    if (!response.ok) throw new Error(response.status === 413 ? "limit" : "resource");
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const length = response.headers.get("content-length");
    const size = length === null ? NaN : Number(length);
    if (type !== "application/pdf" || !Number.isSafeInteger(size) || size <= 0) throw new Error("resource");
    if (size > maxBytes) throw new Error("limit");
  } finally { await response.body?.cancel(); }
}
