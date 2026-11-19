import { getPresetViewerDefinition } from "../registry/presetViewerManifest";
import { assertEditorRuntimeAdmission } from "./editorRuntimeAdmission";
import { documentOperationQueue } from "../document-session/ResourceOperationQueue";
import { editorTaskScheduler, type EditorTaskOwner } from "./EditorTaskScheduler";

export type EditorWorkerKind = "office-validation" | "spreadsheet" | "office-text" | "markdown-index";
export type EditorWorkerPort = Pick<Worker, "postMessage" | "onmessage" | "onerror" | "onmessageerror">;
export type EditorWorkerLease = { port: EditorWorkerPort; closed: AbortSignal; close: () => Promise<void> };
const signalOwners = new WeakMap<AbortSignal, EditorTaskOwner>();
let anonymousSequence = 0;

export function bindEditorTaskSignal(signal: AbortSignal, owner: EditorTaskOwner): void { signalOwners.set(signal, owner); }
export function getEditorTaskSignalOwner(signal?: AbortSignal): EditorTaskOwner | undefined { return signal ? signalOwners.get(signal) : undefined; }

/** Actual Worker constructors live only in the browser platform adapter. */
export async function acquireEditorWorker(kind: EditorWorkerKind, options: {
  signal?: AbortSignal; owner?: EditorTaskOwner; inputBytes: number;
}): Promise<EditorWorkerLease> {
  assertEditorRuntimeAdmission();
  const owner = options.owner ?? (options.signal ? signalOwners.get(options.signal) : null)
    ?? { scope: "renderer", instance: `${kind}:${++anonymousSequence}`, generation: 0 };
  if (documentOperationQueue.isBlocked(owner.scope, owner.instance)) throw new DOMException("The document is being moved or closed.", "AbortError");
  const provider = getPresetViewerDefinition(kind === "markdown-index" ? "markdown" : "office-preview");
  if (provider.resourcePolicy.maxWorkers < 1) throw new Error("This provider cannot allocate a worker.");
  const lifetime = new AbortController();
  const lease = await editorTaskScheduler.acquire({ owner, kind, inputBytes: options.inputBytes,
    maxInputBytes: Math.min(provider.resourcePolicy.maxSourceBytes, kind === "markdown-index" ? 32 * 1024 * 1024 : 26 * 1024 * 1024),
    priority: kind === "markdown-index" ? "background" : "interactive", signal: options.signal }, () => {
    const worker = createWorker(kind);
    const port: EditorWorkerPort = {
      postMessage: (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => {
        if (Array.isArray(transfer)) worker.postMessage(message, transfer);
        else worker.postMessage(message, transfer);
      },
      get onmessage() { return worker.onmessage; }, set onmessage(value) { worker.onmessage = value; },
      get onerror() { return worker.onerror; }, set onerror(value) { worker.onerror = value; },
      get onmessageerror() { return worker.onmessageerror; }, set onmessageerror(value) { worker.onmessageerror = value; },
    };
    return { value: port, stop: () => {
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate(); lifetime.abort();
    } };
  });
  return { port: lease.value, closed: lifetime.signal, close: lease.close };
}

export async function runEditorWorker<T>(kind: EditorWorkerKind, options: {
  signal?: AbortSignal; owner?: EditorTaskOwner; inputBytes: number; timeoutMs: number;
  message: unknown; transfer?: Transferable[];
  decode: (message: unknown) => T;
}): Promise<T> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new RangeError("Editor worker timeout must be a positive finite number.");
  const lease = await acquireEditorWorker(kind, options);
  try {
    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (result: () => void) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); options.signal?.removeEventListener("abort", abort);
        lease.closed.removeEventListener("abort", abort); result();
      };
      const abort = () => finish(() => reject(new DOMException("Editor task cancelled.", "AbortError")));
      const timeout = setTimeout(() => finish(() => reject(new DOMException(`Editor worker exceeded the ${options.timeoutMs} ms limit.`, "TimeoutError"))), options.timeoutMs);
      lease.port.onmessage = (event) => finish(() => { try { resolve(options.decode(event.data)); } catch (error) { reject(error); } });
      lease.port.onerror = (event) => finish(() => reject(new Error(event.message || "Editor worker failed.")));
      lease.port.onmessageerror = () => finish(() => reject(new Error("Editor worker returned an unreadable response.")));
      options.signal?.addEventListener("abort", abort, { once: true });
      lease.closed.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted || lease.closed.aborted) { abort(); return; }
      try { lease.port.postMessage(options.message, options.transfer ?? []); } catch (error) { finish(() => reject(error)); }
    });
  } finally { await lease.close(); }
}

function createWorker(kind: EditorWorkerKind): Worker {
  switch (kind) {
    case "office-validation": return new Worker(new URL("../security/officePackageValidation.worker.ts", import.meta.url), { type: "module", name: "puppyone-office-package-validation" });
    case "spreadsheet": return new Worker(new URL("../viewers/office/spreadsheetPreview.worker.ts", import.meta.url), { type: "module", name: "puppyone-spreadsheet-preview" });
    case "office-text": return new Worker(new URL("../viewers/office/officeTextFallback.worker.ts", import.meta.url), { type: "module", name: "puppyone-office-text-fallback" });
    case "markdown-index": return new Worker(new URL("../markdown/platform/indexing/markdownLinkIndex.worker.ts", import.meta.url), { type: "module", name: "puppyone-markdown-link-index" });
  }
}
