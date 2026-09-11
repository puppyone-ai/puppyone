import { getDataResourceParent } from "../../core/dataResourcePath";
import { assertEditorRuntimeAdmission } from "../runtime/editorRuntimeAdmission";
import { dependencyMatches } from "./DocumentDependencyIndex";
import { invalidateDocumentDependencies, retireDocumentDependencies } from "./DocumentDependencyIndex";
import type { DataPort, DocumentDataNode, FileContent, WorkspaceContentChange } from "../../core/types";
import { workspaceContentChangeMatchesResource } from "../../core/workspaceContentChange";
import { readDocumentStorageSnapshot } from "../document-session/documentStorageReads";
import { canonicalizeDocumentResourcePath } from "../document-session/documentIdentity";
import { acceptDocumentWorkingCopyBaseline } from "../document-session/documentWorkingCopies";
import { getEditorStorageIdentity } from "./editorStorageIdentity";
import { acquireFileResource, invalidateFileResources, type FileResourceHandle } from "./FileResourcePool";
import { documentOperationQueue } from "../document-session/ResourceOperationQueue";
import { markDocumentWorkingCopyUnavailable } from "../document-session/documentWorkingCopies";
import type { DocumentPersistedCommit } from "../document-session/types";
import { getEditorSourceRequirement, getEditorProviderPolicy, shouldReadEditorContent } from "../registry/viewerRegistry";

export type DocumentInputState = Readonly<{
  content: FileContent | null;
  loading: boolean;
  error: string | null;
  fileUrl: string | null;
  fileUrlLoading: boolean;
  fileUrlError: string | null;
  generation: number;
}>;
const scopes = new Map<string, Map<string, DocumentInputRuntime>>();
export { getEditorStorageIdentity } from "./editorStorageIdentity";

export function getDocumentInputRuntime(port: DataPort, node: DocumentDataNode): DocumentInputRuntime {
  const identity = getEditorStorageIdentity(port);
  let documents = scopes.get(identity);
  if (!documents) { documents = new Map(); scopes.set(identity, documents); }
  const path = canonicalizeDocumentResourcePath(node.path);
  let runtime = documents.get(path);
  if (!runtime) {
    assertEditorRuntimeAdmission();
    if (documentOperationQueue.isBlocked(identity, path)) throw new Error("This document is being moved or closed.");
    runtime = new DocumentInputRuntime(identity, path, port, node); documents.set(path, runtime);
  }
  return runtime;
}

export function invalidateDocumentInputs(identity: string, change: WorkspaceContentChange, origin = "view"): void {
  invalidateFileResources(identity, change, origin);
  invalidateDocumentDependencies(identity, change, origin);
  for (const runtime of scopes.get(identity)?.values() ?? []) runtime.invalidate(change, origin);
}

export function retireDocumentInputs(identity: string, resource?: string): void {
  retireDocumentDependencies(identity, resource);
  const documents = scopes.get(identity);
  if (!documents) return;
  const path = resource ? canonicalizeDocumentResourcePath(resource) : null;
  for (const [key, runtime] of documents) {
    if (path && key !== path && !key.startsWith(`${path}/`)) continue;
    runtime.dispose(); documents.delete(key);
  }
  if (documents.size === 0) scopes.delete(identity);
}

export function retireAllDocumentInputs(): void {
  for (const identity of scopes.keys()) retireDocumentInputs(identity);
}

/** One versioned storage input per open resource. Views only subscribe. */
export class DocumentInputRuntime {
  private resource: FileResourceHandle | null = null;
  private resourceUnsubscribe: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private read: AbortController | null = null;
  private disposed = false;
  private started = false;
  private refreshQueued = false;
  private sequences = new Map<string, number>();
  private generation = 0;
  private dependencyGeneration = 0;
  private readonly resourceDirectory: string | null;
  private readonly needsContent: boolean;
  private readonly needsResource: boolean;
  private state: DocumentInputState;

  constructor(readonly storageIdentity: string, readonly path: string, private readonly port: DataPort, node: DocumentDataNode) {
    const requirement = getEditorSourceRequirement(node);
    this.resourceDirectory = getEditorProviderPolicy(node).resourceDependencies === "document-directory" ? getDataResourceParent(path) ?? "" : null;
    this.needsContent = Boolean(port.readFile && shouldReadEditorContent(node));
    this.needsResource = Boolean(port.getFileUrl && (requirement === "resource" || requirement === "content-and-resource"));
    this.state = Object.freeze({ content: null, loading: this.needsContent, error: null,
      fileUrl: null, fileUrlLoading: this.needsResource, fileUrlError: null, generation: 0 });
  }

  getSnapshot = (): DocumentInputState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    const reattaching = this.started && this.listeners.size === 0 && this.state.generation > 0 && !this.read;
    this.listeners.add(listener); this.start();
    // Retain model/history while checking for changes missed while detached.
    if (reattaching) this.refresh();
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true; this.refresh();
  }

  invalidate(change: WorkspaceContentChange, origin = "view"): void {
    const previous = this.sequences.get(origin) ?? Number.NEGATIVE_INFINITY;
    if (this.disposed || change.sequence <= previous) return;
    const matches = workspaceContentChangeMatchesResource(change, this.path, previous);
    this.sequences.set(origin, change.sequence);
    const dependencyChanged = this.resourceDirectory !== null && dependencyMatches(change, { kind: "directory", resource: this.resourceDirectory }, previous);
    if (dependencyChanged && !matches) this.dependencyGeneration++;
    if (matches || dependencyChanged) this.refresh();
  }

  refresh = (): void => {
    if (this.disposed) return;
    this.generation++; this.read?.abort();
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      if (!this.disposed) void this.load(this.generation);
    });
  };

  applyPersistedCommit = (commit: DocumentPersistedCommit): void => {
    if (this.disposed || commit.documentId !== this.path) return;
    const current = this.state.content;
    if (current) this.publish({ content: { ...current, content: commit.content, version: commit.version } });
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.read?.abort();
    this.resourceUnsubscribe?.();
    this.resource?.revoke();
    this.resource = null;
    this.publish({ content: null, fileUrl: null, loading: false, fileUrlLoading: false });
    this.listeners.clear();
  }

  private async load(generation: number): Promise<void> {
    const controller = new AbortController();
    this.read = controller;
    const current = () => !this.disposed && generation === this.generation && !controller.signal.aborted;
    this.publish({ loading: this.needsContent, error: null, fileUrlLoading: this.needsResource, fileUrlError: null });
    // Staging happens inside the read fence: an own-save receipt cannot slip
    // between validating text and publishing its matching resource capability.
    try {
      let staged: FileResourceHandle | null = null;
      const commit = (content: FileContent | null) => {
        if (!current()) { staged?.revoke(); return; }
        if (typeof content?.content === "string") acceptDocumentWorkingCopyBaseline(this.storageIdentity, this.path, content.content, content.version ?? null);
        const previous = this.resource;
        this.resourceUnsubscribe?.();
        this.resource = staged;
        const accepted = staged;
        this.resourceUnsubscribe = accepted?.subscribe((url) => {
          if (!this.disposed && this.resource === accepted) this.publish({ fileUrl: url, fileUrlError: url ? null : "The resource is no longer available." });
        }) ?? null;
        this.publish({ content, loading: false, fileUrl: accepted?.url ?? null, fileUrlLoading: false, generation });
        previous?.revoke();
      };
      if (this.needsContent && this.port.readFile) {
        await readDocumentStorageSnapshot(this.port, this.path, {
          signal: controller.signal,
          ...(this.needsResource ? { prepare: async (content: FileContent) => {
            if (!content.version) throw new Error("A version is required to combine text and resource inputs.");
            const resource = await acquireFileResource(this.port, this.path, { expectedVersion: content.version, inputGeneration: this.dependencyGeneration }, controller.signal);
            staged = resource;
            return () => resource.revoke();
          } } : {}),
          accept: commit,
        });
      } else {
        if (this.needsResource) staged = await acquireFileResource(this.port, this.path, {}, controller.signal);
        commit(null);
      }
    } catch (error) {
      if (!current()) return;
      let missing = false;
      if (this.port.resolveNode && !documentOperationQueue.isBlocked(this.storageIdentity, this.path)) {
        try { missing = !await this.port.resolveNode(this.path); } catch { /* transient */ }
      }
      if (!current()) return;
      if (missing) {
        markDocumentWorkingCopyUnavailable(this.storageIdentity, this.path, errorMessage(error));
        this.resource?.revoke(); this.resource = null;
      }
      this.publish({ loading: false, fileUrlLoading: false,
        ...(this.needsContent ? { error: errorMessage(error) } : { fileUrlError: errorMessage(error) }),
        ...(missing ? { content: null, fileUrl: null } : {}) });
    } finally {
      if (this.read === controller) this.read = null;
    }
  }

  private publish(patch: Partial<DocumentInputState>): void {
    this.state = Object.freeze({ ...this.state, ...patch });
    this.listeners.forEach((listener) => listener());
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
