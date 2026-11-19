export const DEFAULT_MAX_OFFICE_RESOURCE_BYTES = 25 * 1024 * 1024;

export class OfficeResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficeResourceLimitError";
  }
}

export type OfficeResourceFetchOptions = {
  signal?: AbortSignal;
  maxBytes?: number;
};

/**
 * Fetches an Office resource without ever buffering more than the configured
 * limit in the renderer. Local resources are range-probed first so the Electron
 * protocol does not read an oversized file into the main process merely to
 * discover its Content-Length.
 */
export async function fetchOfficeArrayBuffer(
  fileUrl: string,
  options: OfficeResourceFetchOptions = {},
): Promise<ArrayBuffer> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_OFFICE_RESOURCE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("Office resource maxBytes must be a positive safe integer.");
  }

  if (isLocalOfficeResourceUrl(fileUrl)) {
    await probeLocalResourceSize(fileUrl, maxBytes, options.signal);
  }

  const response = await fetch(fileUrl, { signal: options.signal });
  if (!response.ok) throw new Error(`Office resource request failed with HTTP ${response.status}.`);
  rejectOversizedDeclaredResponse(response, maxBytes);
  return readResponseBodyWithLimit(response, maxBytes, options.signal);
}

function isLocalOfficeResourceUrl(fileUrl: string): boolean {
  try {
    return new URL(fileUrl).protocol === "puppyone-local:";
  } catch {
    return false;
  }
}

async function probeLocalResourceSize(
  fileUrl: string,
  maxBytes: number,
  signal?: AbortSignal,
) {
  const response = await fetch(fileUrl, {
    headers: { Range: "bytes=0-0" },
    signal,
  });
  if (!response.ok) throw new Error(`Office resource probe failed with HTTP ${response.status}.`);

  const totalBytes = getRangeTotalBytes(response.headers.get("content-range"))
    ?? getDeclaredContentLength(response);
  await response.body?.cancel().catch(() => undefined);
  if (totalBytes !== null && totalBytes > maxBytes) {
    throw createOfficeResourceLimitError(maxBytes);
  }
}

async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!response.body) {
    return new ArrayBuffer(0);
  }

  const reader = response.body.getReader();
  const declaredBytes = getDeclaredContentLength(response);
  const initialBytes = Math.min(maxBytes, declaredBytes ?? Math.min(64 * 1024, maxBytes));
  const buffer = createResizableArrayBuffer(initialBytes, maxBytes);
  let bytes = new Uint8Array(buffer);
  let totalBytes = 0;

  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Office preview byte limit exceeded").catch(() => undefined);
        throw createOfficeResourceLimitError(maxBytes);
      }
      if (totalBytes > buffer.byteLength) {
        const nextCapacity = Math.min(
          maxBytes,
          Math.max(totalBytes, Math.max(64 * 1024, buffer.byteLength * 2)),
        );
        buffer.resize(nextCapacity);
        bytes = new Uint8Array(buffer);
      }
      bytes.set(value, totalBytes - value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }

  buffer.resize(totalBytes);
  return buffer;
}

type ResizableArrayBuffer = ArrayBuffer & {
  resize(nextByteLength: number): void;
};

function createResizableArrayBuffer(initialBytes: number, maxBytes: number): ResizableArrayBuffer {
  const Constructor = ArrayBuffer as typeof ArrayBuffer & {
    new(byteLength: number, options: { maxByteLength: number }): ResizableArrayBuffer;
  };
  const buffer = new Constructor(initialBytes, { maxByteLength: maxBytes });
  if (typeof buffer.resize !== "function") {
    throw new Error("This desktop runtime does not support bounded Office resource buffers.");
  }
  return buffer;
}

function rejectOversizedDeclaredResponse(response: Response, maxBytes: number) {
  const contentLength = getDeclaredContentLength(response);
  if (contentLength !== null && contentLength > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw createOfficeResourceLimitError(maxBytes);
  }
}

function getDeclaredContentLength(response: Response): number | null {
  const rawValue = response.headers.get("content-length");
  if (!rawValue) return null;
  const value = Number(rawValue);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function getRangeTotalBytes(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const match = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(contentRange.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function createOfficeResourceLimitError(maxBytes: number): OfficeResourceLimitError {
  return new OfficeResourceLimitError(
    `This file is larger than the ${formatBytes(maxBytes)} Office preview limit. Open it in a desktop app for full fidelity.`,
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
