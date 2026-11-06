import { fetchOfficeArrayBuffer } from "../viewers/office/officeResourceLoader";
import { DocumentConversionError, MAX_CONVERSION_SOURCE_BYTES, type ConversionResult } from "./types";
import { acquireEditorWorker, getEditorTaskSignalOwner, type EditorWorkerLease } from "../runtime/BrowserEditorWorkerHost";

export async function fingerprintConversionSource(url: string, signal?: AbortSignal) {
  // Web Crypto and transferable ownership require a fixed snapshot of the bounded fetch buffer.
  const bytes = (await fetchOfficeArrayBuffer(url, { signal, maxBytes: MAX_CONVERSION_SOURCE_BYTES })).slice(0);
  return { bytes, fingerprint: await fingerprint(bytes) };
}

async function fingerprint(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
}

export async function convertDocument(url: string, format: "docx" | "pdf", signal: AbortSignal, onProgress: (page: number, total: number) => void): Promise<ConversionResult> {
  const timeout = new AbortController();
  const abort = () => timeout.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => timeout.abort(new DocumentConversionError("timeout")), 60_000);
  let lease: EditorWorkerLease | undefined;
  try {
    const source = await fingerprintConversionSource(url, timeout.signal);
    timeout.signal.throwIfAborted();
    lease = await acquireEditorWorker("document-conversion", { signal: timeout.signal, owner: getEditorTaskSignalOwner(signal), inputBytes: source.bytes.byteLength });
    return await new Promise((resolve, reject) => {
      const cancel = () => reject(timeout.signal.reason);
      timeout.signal.addEventListener("abort", cancel, { once: true });
      lease!.closed.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
      lease!.port.onerror = () => reject(new DocumentConversionError("failed"));
      lease!.port.onmessageerror = () => reject(new DocumentConversionError("failed"));
      lease!.port.onmessage = event => {
        if (timeout.signal.aborted) return;
        if (event.data.type === "progress") onProgress(event.data.page, event.data.total);
        if (event.data.type === "result") resolve({ ...event.data.result, fingerprint: source.fingerprint });
        if (event.data.type === "error") reject(new DocumentConversionError(event.data.code));
      };
      if (timeout.signal.aborted || lease!.closed.aborted) { reject(timeout.signal.reason ?? new DOMException("Cancelled", "AbortError")); return; }
      lease!.port.postMessage({ bytes: source.bytes, format }, [source.bytes]);
    });
  } catch (error) {
    if (timeout.signal.aborted) throw timeout.signal.reason;
    if (error instanceof Error && error.name === "OfficeResourceLimitError") throw new DocumentConversionError("limit");
    throw error;
  } finally {
    try { await lease?.close(); }
    finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  }
}
