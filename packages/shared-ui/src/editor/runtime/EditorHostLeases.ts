import { documentOperationQueue } from "../document-session/ResourceOperationQueue";
import { assertEditorRuntimeAdmission } from "./editorRuntimeAdmission";
import type { EditorTaskOwner } from "./EditorTaskScheduler";

type HostResource<T> = { value: T; release: () => Promise<void> };
type Entry = { owner: EditorTaskOwner; closing: boolean; close: () => Promise<void> };
const entries = new Set<Entry>();

/** Native hosts enforce their own execution budgets. This bounded directory
 * owns their creation/exit acknowledgements, including late IPC replies. */
export function acquireEditorHostLease<T>(owner: EditorTaskOwner,
  create: (signal: AbortSignal) => Promise<HostResource<T>>,
  signal?: AbortSignal,
): { ready: Promise<T>; close: () => Promise<void> } {
  assertEditorRuntimeAdmission();
  signal?.throwIfAborted();
  if (documentOperationQueue.isBlocked(owner.scope, owner.instance)) throw new DOMException("The document is being moved or closed.", "AbortError");
  if (entries.size >= 128) throw new Error("Too many editor host resources are awaiting release.");
  const controller = new AbortController();
  const retiring = [...entries].filter((entry) => entry.closing && entry.owner.scope === owner.scope && entry.owner.instance === owner.instance);
  let exited = false;
  let stopping: Promise<void> | null = null;
  let releaseAttempt: Promise<void> | null = null;
  const allocation = Promise.resolve().then(async () => {
    await Promise.all(retiring.map((entry) => entry.close()));
    controller.signal.throwIfAborted();
    return create(controller.signal);
  });
  const entry: Entry = { owner, closing: false, close: () => {
    if (exited) return Promise.resolve();
    entry.closing = true; controller.abort();
    if (stopping) return stopping;
    releaseAttempt ??= allocation.then((resource) => resource.release(), () => undefined).then(() => {
      exited = true; entries.delete(entry); signal?.removeEventListener("abort", abort);
    }).catch((error) => { releaseAttempt = null; throw error; });
    stopping = withExitDeadline(releaseAttempt).catch((error) => { stopping = null; throw error; });
    return stopping;
  } };
  const abort = () => { void entry.close().catch(() => undefined); };
  entries.add(entry);
  signal?.addEventListener("abort", abort, { once: true });
  const ready = allocation.then(async (resource) => {
    if (entry.closing) { await entry.close(); throw new DOMException("Editor host creation was cancelled.", "AbortError"); }
    return resource.value;
  }, (error) => {
    exited = true; entries.delete(entry); signal?.removeEventListener("abort", abort); throw error;
  });
  return { ready, close: entry.close };
}

export async function retireEditorHostLeases(storageIdentity?: string, resource?: string): Promise<void> {
  const matching = [...entries].filter(({ owner }) => (!storageIdentity || storageIdentity === owner.scope)
    && (!resource || owner.instance === resource || owner.instance.startsWith(`${resource}/`)));
  const results = await Promise.allSettled(matching.map((entry) => entry.close()));
  const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (failures.length) throw new AggregateError(failures, "Native editor resources have not confirmed release.");
}

function withExitDeadline(promise: Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Native editor host exit could not be confirmed.")), 5_000);
    promise.then(() => { clearTimeout(timeout); resolve(); }, (error) => { clearTimeout(timeout); reject(error); });
  });
}
