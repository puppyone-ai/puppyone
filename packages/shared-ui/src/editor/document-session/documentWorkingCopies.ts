import { publishDocumentRetirement } from "./documentRetirementEvents";
import { reconcilePendingDocumentOperations } from "./documentResourceOperations";
import { assertEditorRuntimeAdmission, holdEditorRuntimeAdmission } from "../runtime/editorRuntimeAdmission";
import { settleFileResourceReleases } from "../resource/FileResourcePool";
import { retireEditorTasks } from "../runtime/retireEditorTasks";
import type { DocumentPersistencePort } from "../../core/types";
import { DocumentEditingSession } from "./DocumentEditingSession";
import { DocumentModelOwner } from "./DocumentModelOwner";
import { retireAllDocumentInputs, retireDocumentInputs } from "../resource/DocumentInputRuntime";
import { registerActiveDocumentSession } from "./activeDocumentSessions";
import { documentOperationQueue } from "./ResourceOperationQueue";
import type {
  DocumentPersistedCommit,
  DocumentSessionDrainReason,
  DocumentSessionStatus,
} from "./types";
import type { EditorSaveMode } from "../registry/viewerTypes";
import {
  createDocumentIdentity,
  getDocumentIdentityKey,
  type DocumentIdentity,
} from "./documentIdentity";

export type WorkingCopyBinding = {
  models: DocumentModelOwner;
  session: DocumentEditingSession;
  identity: DocumentIdentity;
  onPersistedRef: { current: ((commit: DocumentPersistedCommit) => void) | undefined };
  owner: Map<string, WorkingCopyBinding>;
  unsubscribeState: () => void;
  unregister: () => void;
};

const bindingsByStorageIdentity = new Map<string, Map<string, WorkingCopyBinding>>();
const allBindings = new Set<WorkingCopyBinding>();
const registryListeners = new Set<() => void>();
let statusSnapshot: ReadonlyMap<string, DocumentSessionStatus> = new Map();

export function getDocumentWorkingCopyStatuses(): ReadonlyMap<string, DocumentSessionStatus> {
  return statusSnapshot;
}

export function acceptDocumentWorkingCopyBaseline(storageIdentity: string, resource: string, content: string, version: string | null): void {
  const path = createDocumentIdentity({ storageIdentity }, resource).resourcePath;
  bindingsByStorageIdentity.get(storageIdentity)?.get(path)?.session.reconcileExternalBaseline(content, version);
}

export function markDocumentWorkingCopyUnavailable(storageIdentity: string, resource: string, detail: string): void {
  for (const binding of getDocumentWorkingCopiesUnderResource(storageIdentity, resource)) binding.session.markStorageUnavailable(detail);
}

export function getDocumentWorkingCopiesUnderResource(storageIdentity: string, resource?: string): WorkingCopyBinding[] {
  const path = resource ? createDocumentIdentity({ storageIdentity }, resource).resourcePath : null;
  return [...allBindings].filter((binding) => binding.identity.storageIdentity === storageIdentity
    && (!path || binding.identity.resourcePath === path || binding.identity.resourcePath.startsWith(`${path}/`)));
}

export function rebindDocumentWorkingCopies(storageIdentity: string, from: string, to: string): void {
  const source = createDocumentIdentity({ storageIdentity }, from).resourcePath;
  const target = createDocumentIdentity({ storageIdentity }, to).resourcePath;
  const bindings = getDocumentWorkingCopiesUnderResource(storageIdentity, source);
  for (const binding of bindings) {
    const next = `${target}${binding.identity.resourcePath.slice(source.length)}`;
    const collision = binding.owner.get(next);
    if (collision && collision !== binding) throw new Error(`An editor is already open at ${next}.`);
  }
  for (const binding of bindings) {
    const previous = binding.identity.resourcePath;
    const next = createDocumentIdentity({ storageIdentity }, `${target}${previous.slice(source.length)}`);
    binding.session.rebindDocument(next.resourcePath);
    binding.owner.delete(previous);
    binding.identity = next;
    binding.owner.set(next.resourcePath, binding);
  }
  retireDocumentInputs(storageIdentity, source);
  publishStatuses();
}

export function releaseDocumentWorkingCopies(bindings: readonly WorkingCopyBinding[]): void {
  bindings.forEach(releaseBinding);
}

export function subscribeDocumentWorkingCopyStatuses(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

export function getOrCreateDocumentWorkingCopy(options: Readonly<{
  documentId: string;
  initialContent: string;
  initialVersion?: string | null;
  saveMode: EditorSaveMode;
  persistence: DocumentPersistencePort;
  onPersisted?: (commit: DocumentPersistedCommit) => void;
}>): WorkingCopyBinding {
  const identity = createDocumentIdentity(options.persistence, options.documentId);
  let bindings = bindingsByStorageIdentity.get(identity.storageIdentity);
  if (!bindings) {
    bindings = new Map();
    bindingsByStorageIdentity.set(identity.storageIdentity, bindings);
  }
  const existing = bindings.get(identity.resourcePath);
  if (existing) {
    existing.onPersistedRef.current = options.onPersisted;
    existing.session.setSaveMode(options.saveMode);
    return existing;
  }
  if (documentOperationQueue.isBlocked(identity.storageIdentity, identity.resourcePath)) {
    throw new Error("This document is being moved or closed. Try opening it again after the operation finishes.");
  }
  assertEditorRuntimeAdmission();

  const onPersistedRef = { current: options.onPersisted };
  const session = new DocumentEditingSession({
    documentId: identity.resourcePath,
    initialContent: options.initialContent,
    initialVersion: options.initialVersion,
    saveMode: options.saveMode,
    persistence: options.persistence,
    onPersisted: (commit) => onPersistedRef.current?.(commit),
  });
  const binding: WorkingCopyBinding = {
    models: new DocumentModelOwner(),
    session,
    identity,
    onPersistedRef,
    owner: bindings,
    unsubscribeState: () => undefined,
    unregister: () => undefined,
  };
  binding.unregister = registerActiveDocumentSession(session);
  binding.unsubscribeState = session.subscribe(publishStatuses);
  bindings.set(identity.resourcePath, binding);
  allBindings.add(binding);
  publishStatuses();
  return binding;
}

export async function closeDocumentWorkingCopy(input: Readonly<{
  storageIdentity: DocumentIdentity["storageIdentity"];
  resourcePath: string;
}>): Promise<void> {
  const identity = createDocumentIdentity(
    { storageIdentity: input.storageIdentity },
    input.resourcePath,
  );
  const key = getDocumentIdentityKey(identity);
  await reconcilePendingDocumentOperations(identity.storageIdentity, identity.resourcePath);
  const matches = [...allBindings].filter((binding) => getDocumentIdentityKey(binding.identity) === key);
  await documentOperationQueue.run([{ storageIdentity: identity.storageIdentity, resource: identity.resourcePath }], async () => {
    assertBindingsRemainInScope(matches, identity.resourcePath);
    await flushAndRelease(matches, "document-close", async () => {
      await retireEditorTasks(identity.storageIdentity, identity.resourcePath);
      retireDocumentInputs(identity.storageIdentity, identity.resourcePath);
      await settleFileResourceReleases(identity.storageIdentity, identity.resourcePath);
    });
  }, `close:${key}`);
}

export async function closeDocumentWorkingCopiesUnderResource(
  storageIdentity: string,
  resource: string,
): Promise<void> {
  const canonicalResource = createDocumentIdentity({ storageIdentity }, resource).resourcePath;
  await reconcilePendingDocumentOperations(storageIdentity, canonicalResource);
  const matches = [...allBindings].filter(({ session }) => (
    session.documentId === canonicalResource || session.documentId.startsWith(`${canonicalResource}/`)
  )).filter(({ identity }) => (
    identity.storageIdentity === storageIdentity
  ));
  await documentOperationQueue.run([{ storageIdentity, resource: canonicalResource }], async () => {
    assertBindingsRemainInScope(matches, canonicalResource);
    await flushAndRelease(matches, "document-close", async () => {
      await retireEditorTasks(storageIdentity, canonicalResource);
      retireDocumentInputs(storageIdentity, canonicalResource);
      await settleFileResourceReleases(storageIdentity, canonicalResource);
    });
  }, `close:${storageIdentity}:${canonicalResource}`);
  publishDocumentRetirement({ storageIdentity, resource: canonicalResource });
}

export async function closeAllDocumentWorkingCopies(
  reason: Extract<DocumentSessionDrainReason, "workspace-switch" | "app-close">,
): Promise<void> {
  const releaseAdmission = holdEditorRuntimeAdmission();
  try {
    await reconcilePendingDocumentOperations();
    const bindings = [...allBindings];
    await documentOperationQueue.run([...new Set(bindings.map((binding) => binding.identity.storageIdentity))]
      .map((storageIdentity) => ({ storageIdentity, resource: null })), async () => {
      await flushAndRelease(bindings, reason, async () => {
        await retireEditorTasks();
        retireAllDocumentInputs();
        await settleFileResourceReleases();
      });
    }, `close-all:${reason}`);
  } finally { releaseAdmission(); }
}

async function flushAndRelease(
  bindings: readonly WorkingCopyBinding[],
  reason: DocumentSessionDrainReason,
  retireTasks: () => Promise<void>,
): Promise<void> {
  bindings = bindings.filter((binding) => allBindings.has(binding));
  const releaseInput: Array<() => void> = [];
  try {
    for (const binding of bindings) {
      if (allBindings.has(binding)) releaseInput.push(await binding.session.prepareOperation());
    }
    const results = await Promise.allSettled(bindings.map((binding) => binding.session.flushCurrent(reason)));
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length > 0) {
      throw new AggregateError(failures, `Unable to close ${failures.length} document working cop${failures.length === 1 ? "y" : "ies"}.`);
    }
    await retireTasks();
    bindings.forEach(releaseBinding);
  } finally {
    for (const release of releaseInput) release();
  }
}

function assertBindingsRemainInScope(bindings: readonly WorkingCopyBinding[], resource: string): void {
  if (bindings.some((binding) => allBindings.has(binding)
    && binding.identity.resourcePath !== resource && !binding.identity.resourcePath.startsWith(`${resource}/`))) {
    throw new Error("The document moved while waiting to close. Close it again at its new location.");
  }
}

function releaseBinding(binding: WorkingCopyBinding): void {
  if (!allBindings.delete(binding)) return;
  binding.owner.delete(binding.session.documentId);
  if (binding.owner.size === 0) {
    bindingsByStorageIdentity.delete(binding.identity.storageIdentity);
  }
  binding.unsubscribeState();
  binding.session.dispose();
  binding.models.dispose();
  binding.unregister();
  publishStatuses();
}

function publishStatuses(): void {
  statusSnapshot = new Map(
    [...allBindings].map(({ identity, session }) => [
      getDocumentIdentityKey(identity),
      session.getState().status,
    ]),
  );
  registryListeners.forEach((listener) => listener());
}
