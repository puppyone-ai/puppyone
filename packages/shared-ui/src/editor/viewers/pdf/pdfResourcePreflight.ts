/** Transport admission, NOT PDF parsing. Desktop also checks the header and
 * byte budget on every protocol request using the open file descriptor. */
export async function preflightPdfResource(url: string, maxBytes: number, signal: AbortSignal): Promise<void> {
  const resource = new URL(url);
  if (!["puppyone-local:", "https:", "blob:"].includes(resource.protocol)) throw new Error("resource");
  const response = await fetch(url, { method: "HEAD", signal, cache: "no-store", credentials: "omit", redirect: "error" });
  if (!response.ok) throw new Error(response.status === 413 ? "limit" : "resource");
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const length = response.headers.get("content-length");
  const size = length === null ? NaN : Number(length);
  if (type !== "application/pdf" || !Number.isSafeInteger(size) || size <= 0) throw new Error("resource");
  if (size > maxBytes) throw new Error("limit");
}
