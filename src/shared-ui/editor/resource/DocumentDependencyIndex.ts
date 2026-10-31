import type { WorkspaceContentChange } from "../../core/types";
import { createWorkspaceResourceUri } from "../../core/resourceUri";
import { canonicalizeDocumentResourcePath } from "../document-session/documentIdentity";
import { workspaceContentChangeMatchesResource } from "../../core/workspaceContentChange";

export type EditorDependency = Readonly<{ kind: "resource" | "directory"; resource: string }>;
const indexes = new Map<string, DocumentDependencyIndex>();

export function getDocumentDependencyIndex(storageIdentity: string, resource: string): DocumentDependencyIndex {
  const key = JSON.stringify([storageIdentity, canonicalizeDocumentResourcePath(resource)]);
  let index = indexes.get(key);
  if (!index) { index = new DocumentDependencyIndex(storageIdentity); indexes.set(key, index); }
  return index;
}

export function invalidateDocumentDependencies(storageIdentity: string, change: WorkspaceContentChange, origin = "view"): void {
  for (const index of indexes.values()) if (index.storageIdentity === storageIdentity) index.invalidate(change, origin);
}

export function retireDocumentDependencies(storageIdentity: string, resource?: string): void {
  for (const [key] of indexes) {
    const [identity, path] = JSON.parse(key) as [string, string];
    if (identity === storageIdentity && (!resource || path === resource || path.startsWith(`${resource}/`))) indexes.delete(key);
  }
}

/** Accepted dependencies stay subscribed until their replacement has finished preparing. */
export class DocumentDependencyIndex {
  private accepted: readonly EditorDependency[] = [];
  private preparing = new Set<Set<EditorDependency>>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private sequences = new Map<string, number>();
  constructor(readonly storageIdentity: string) {}
  getSnapshot = (): number => this.revision;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.accepted = []; this.preparing.clear(); }
    };
  };
  begin() {
    const dependencies = new Set<EditorDependency>();
    const revision = this.revision;
    this.preparing.add(dependencies);
    let finished = false;
    return {
      track: (kind: EditorDependency["kind"], resource: string) => {
        if (finished) return;
        if (dependencies.size >= 512) throw new RangeError("Editor dependency limit reached.");
        dependencies.add({ kind, resource: kind === "directory" && resource === "" ? "" : canonicalizeDocumentResourcePath(resource) });
      },
      commit: () => {
        if (finished) return false;
        finished = true; this.preparing.delete(dependencies);
        if (revision !== this.revision) return false;
        this.accepted = [...dependencies];
        return true;
      },
      abort: () => { finished = true; this.preparing.delete(dependencies); },
    };
  }
  invalidate(change: WorkspaceContentChange, origin = "view"): void {
    const previous = this.sequences.get(origin) ?? -1;
    if (change.sequence <= previous) return;
    this.sequences.set(origin, change.sequence);
    const dependencies = [...this.accepted, ...[...this.preparing].flatMap((set) => [...set])];
    if (!dependencies.some((dependency) => dependencyMatches(change, dependency, previous))) return;
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }
}

export function dependencyMatches(change: WorkspaceContentChange, dependency: EditorDependency, afterSequence = Number.NEGATIVE_INFINITY): boolean {
  if (dependency.kind === "resource") return workspaceContentChangeMatchesResource(change, dependency.resource, afterSequence);
  return change.entries.some((entry) => {
    if (entry.sequence <= afterSequence) return false;
    if (entry.paths === null) {
      return !entry.rootUri || dependency.resource === entry.rootUri || dependency.resource.startsWith(`${entry.rootUri.replace(/\/$/, "")}/`);
    }
    return entry.paths.some((path) => {
      try {
        const resource = entry.rootUri ? createWorkspaceResourceUri(entry.rootUri, path) : canonicalizeDocumentResourcePath(path);
        const query = dependency.resource.replace(/\/$/, "");
        return resource === query || resource.startsWith(`${query}/`) || (!query && !entry.rootUri);
      } catch { return false; }
    });
  });
}
