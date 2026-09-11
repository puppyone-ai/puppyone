import { settleFileResourceReleases } from "../resource/FileResourcePool";
import { canonicalizeDocumentResourcePath } from "./documentIdentity";
import { retireEditorTasks } from "../runtime/retireEditorTasks";
import type { DataPort } from "../../core/types";
import { getDataResourceParent, joinDataResourcePath } from "../../core/dataResourcePath";
import { getEditorStorageIdentity, retireDocumentInputs } from "../resource/DocumentInputRuntime";
import { shareEditorStorageIdentity } from "../resource/editorStorageIdentity";
import { documentOperationQueue } from "./ResourceOperationQueue";
import {
  getDocumentWorkingCopiesUnderResource, rebindDocumentWorkingCopies,
  releaseDocumentWorkingCopies, type WorkingCopyBinding,
} from "./documentWorkingCopies";

export type DocumentResourceOperationResult = Readonly<{
  id: string;
  kind: "move" | "delete";
  storageIdentity: string;
  from: string;
  to: string | null;
  status: "preparing" | "committing" | "reconciling" | "completed" | "failed" | "indeterminate";
  error: string | null;
}>;

export class DocumentResourceOperationError extends Error {
  constructor(readonly result: DocumentResourceOperationResult) { super(result.error ?? "Document operation failed."); }
}

const wrapped = new WeakMap<DataPort, DataPort>();
const decorated = new WeakSet<DataPort>();
const results = new Map<string, DocumentResourceOperationResult>();
const uncertain = new Map<string, { port: DataPort; result: DocumentResourceOperationResult; releases: Array<() => void>; bindings: WorkingCopyBinding[]; committed: boolean; releaseScope: () => void }>();
let operationSequence = 0;

export function getDocumentResourceOperations(): readonly DocumentResourceOperationResult[] {
  return [...results.values()];
}

/** Closing the new address must also recover a lost acknowledgement at the
 * old address. Reconciliation queries state and never resends the mutation. */
export async function reconcilePendingDocumentOperations(storageIdentity?: string, resource?: string): Promise<void> {
  const path = resource ? canonicalizeDocumentResourcePath(resource) : null;
  for (const pending of [...uncertain.values()]) {
    const result = pending.result;
    if (storageIdentity && result.storageIdentity !== storageIdentity) continue;
    if (path && ![result.from, result.to].some((entry) => entry && (entry === path || entry.startsWith(`${path}/`) || path.startsWith(`${entry}/`)))) continue;
    await runResourceOperation(pending.port, result.kind, result.from, result.to, async () => {
      throw new Error("The prior operation is no longer available for reconciliation.");
    });
  }
}

/** Every Explorer/menu/clipboard mutation passes the same scoped barrier. */
export function withEditorDocumentOperations(port: DataPort): DataPort {
  if (decorated.has(port)) return port;
  const previous = wrapped.get(port);
  if (previous) return previous;
  const result: DataPort = {
    ...port,
    ...(port.copyNode ? { copyNode: async (from, folder, options) => {
      const storageIdentity = getEditorStorageIdentity(port);
      return documentOperationQueue.run([{ storageIdentity, resource: from }, { storageIdentity, resource: folder }], async () => {
        const bindings = getDocumentWorkingCopiesUnderResource(storageIdentity, from);
        const releases: Array<() => void> = [];
        try {
          for (const { session } of bindings) releases.push(await session.prepareOperation());
          const saved = await Promise.allSettled(bindings.map(({ session }) => session.flushCurrent("document-switch")));
          const failures = saved.flatMap((entry) => entry.status === "rejected" ? [entry.reason] : []);
          if (failures.length) throw new AggregateError(failures, "Unable to save the source before copying it.");
          return await port.copyNode!(from, folder, options);
        } finally { releases.forEach((release) => release()); }
      });
    } } satisfies Pick<DataPort, "copyNode"> : {}),
    ...(port.renameNode ? { renameNode: async (from: string, name: string) => {
      await runResourceOperation(port, "move", from, joinDataResourcePath(getDataResourceParent(from), name), () => port.renameNode!(from, name));
    } } : {}),
    ...(port.moveNode ? { moveNode: async (from: string, to: string) => {
      await runResourceOperation(port, "move", from, to, () => port.moveNode!(from, to));
    } } : {}),
    ...(port.deleteNode ? { deleteNode: async (from: string) => {
      await runResourceOperation(port, "delete", from, null, () => port.deleteNode!(from));
    } } : {}),
  };
  shareEditorStorageIdentity(result, port);
  wrapped.set(port, result); decorated.add(result);
  return result;
}

async function runResourceOperation(port: DataPort, kind: "move" | "delete", from: string, to: string | null, mutate: () => Promise<void>): Promise<void> {
  from = canonicalizeDocumentResourcePath(from);
  to = to === null ? null : canonicalizeDocumentResourcePath(to);
  const storageIdentity = getEditorStorageIdentity(port);
  const key = JSON.stringify([storageIdentity, kind, from, to]);
  await documentOperationQueue.run([
    { storageIdentity, resource: from }, ...(to ? [{ storageIdentity, resource: to }] : []),
  ], async () => {
    const pending = uncertain.get(key);
    if (pending) {
      // Retry reconciles the existing operation. It never repeats an unknown
      // filesystem side effect, even when the caller presses the same command.
      if (!pending.committed && port.resolveNode) {
        try {
          const source = await port.resolveNode(from);
          const target = to ? await port.resolveNode(to) : null;
          // Absence after delete is definitive. For moves, destination bytes
          // must match every retained baseline before migrating their models.
          let matches = !source && (kind === "delete" || Boolean(target));
          if (matches && kind === "move" && to) {
            if (pending.bindings.length && !port.readFile) matches = false;
            for (const binding of port.readFile ? pending.bindings : []) {
              const path = `${to}${binding.identity.resourcePath.slice(from.length)}`;
              const content = await port.readFile!(path);
              if (content.content !== binding.session.getPersistedBaseline().content) matches = false;
            }
          }
          pending.committed = matches;
          if (source && (!to || !target)) {
            pending.releases.forEach((release) => release()); pending.releaseScope();
            uncertain.delete(key);
            const failed = { ...pending.result, status: "failed" as const, error: "The previous operation did not change the resource. You can retry it." };
            publish(failed);
            throw new DocumentResourceOperationError(failed);
          }
        } catch (error) {
          if (error instanceof DocumentResourceOperationError) throw error;
        }
      }
      if (!pending.committed) throw new DocumentResourceOperationError(pending.result);
      try {
        await reconcile(pending.result, pending.bindings);
        pending.releases.forEach((release) => release());
        uncertain.delete(key); pending.releaseScope();
        publish({ ...pending.result, status: "completed", error: null });
        return;
      } catch (error) { throw new DocumentResourceOperationError({ ...pending.result, error: detail(error) }); }
    }
    if (uncertain.size >= 128) throw new Error("Resolve pending file operations before starting more.");
    let result: DocumentResourceOperationResult = {
      id: `document-operation:${++operationSequence}`, kind, storageIdentity, from, to, status: "preparing", error: null,
    };
    const bindings = getDocumentWorkingCopiesUnderResource(storageIdentity, from);
    const releases: Array<() => void> = [];
    let committed = false;
    let dispatched = false;
    let keepLocked = false;
    publish(result);
    try {
      if (to && getDocumentWorkingCopiesUnderResource(storageIdentity, to).some((binding) => !bindings.includes(binding))) {
        throw new Error("The destination already has an open document.");
      }
      for (const binding of bindings) releases.push(await binding.session.prepareOperation());
      const saved = await Promise.allSettled(bindings.map(({ session }) => session.flushCurrent("document-switch")));
      const failures = saved.flatMap((entry) => entry.status === "rejected" ? [entry.reason] : []);
      if (failures.length) throw new AggregateError(failures, `Unable to save the affected document: ${detail(failures[0])}`);
      await retireEditorTasks(storageIdentity, from);
      result = { ...result, status: "committing" }; publish(result);
      dispatched = true;
      await mutate();
      committed = true;
      result = { ...result, status: "reconciling" }; publish(result);
      await reconcile(result, bindings);
      publish({ ...result, status: "completed" });
    } catch (error) {
      // A rejected transport can follow an actual disk mutation. Confirm the
      // old address still exists before allowing further writes to that address.
      let confirmedUnchanged = !dispatched;
      if (dispatched && !committed && port.resolveNode) {
        try {
          const source = await port.resolveNode(from);
          const target = to ? await port.resolveNode(to) : null;
          confirmedUnchanged = Boolean(source && (!to || !target));
        } catch { /* Keep the result unknown when the verification also fails. */ }
      }
      keepLocked = committed || !confirmedUnchanged;
      result = { ...result, status: keepLocked ? "indeterminate" : "failed", error: detail(error) };
      publish(result);
      if (keepLocked) {
        const releaseScope = documentOperationQueue.hold([{ storageIdentity, resource: from }, ...(to ? [{ storageIdentity, resource: to }] : [])], `mutation:${key}`);
        uncertain.set(key, { port, result, releases, bindings, committed, releaseScope });
      }
      throw new DocumentResourceOperationError(result);
    } finally {
      if (!keepLocked) releases.forEach((release) => release());
    }
  }, `mutation:${key}`);
}

async function reconcile(result: DocumentResourceOperationResult, bindings: readonly WorkingCopyBinding[]): Promise<void> {
  await retireEditorTasks(result.storageIdentity, result.from);
  if (result.kind === "move" && result.to) rebindDocumentWorkingCopies(result.storageIdentity, result.from, result.to);
  else {
    retireDocumentInputs(result.storageIdentity, result.from);
    await settleFileResourceReleases(result.storageIdentity, result.from);
    releaseDocumentWorkingCopies(bindings);
  }
  await settleFileResourceReleases(result.storageIdentity, result.from);
}

function publish(result: DocumentResourceOperationResult): void {
  results.set(result.id, Object.freeze(result));
  if (results.size <= 128) return;
  for (const [id, entry] of results) {
    if (entry.status === "completed" || entry.status === "failed") results.delete(id);
    if (results.size <= 128) break;
  }
}
function detail(error: unknown): string { return error instanceof Error ? error.message : String(error); }
