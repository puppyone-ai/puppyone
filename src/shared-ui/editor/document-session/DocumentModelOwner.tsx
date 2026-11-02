import { createContext, useContext, type ReactNode } from "react";
import type { EditorSourceSnapshotPort } from "../sourceSnapshot";

export interface RetainedDocumentModel extends EditorSourceSnapshotPort {
  dispose?: () => void;
}

/** Owns format state, never another copy of the document's text. */
export class DocumentModelOwner {
  private models = new Map<string, RetainedDocumentModel>();
  private viewStates = new Map<string, unknown>();
  private disposed = false;

  readViewState<T>(role: string): T | undefined { return this.viewStates.get(role) as T | undefined; }
  writeViewState<T>(role: string, state: T): void {
    if (!this.disposed) this.viewStates.set(role, state);
  }

  getOrCreate<T extends RetainedDocumentModel>(kind: string, create: () => T): T {
    if (this.disposed) throw new Error("The document has been retired.");
    const existing = this.models.get(kind);
    if (existing) return existing as T;
    const model = create();
    this.models.set(kind, model);
    return model;
  }

  /** Incompatible representations cannot retain an obsolete undo branch. */
  activate(model: EditorSourceSnapshotPort): void {
    for (const [kind, candidate] of this.models) {
      if (candidate === model) continue;
      candidate.dispose?.();
      this.models.delete(kind);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.models.values()) model.dispose?.();
    this.models.clear();
    this.viewStates.clear();
  }
}

const ModelOwnerContext = createContext<DocumentModelOwner | null>(null);

export function DocumentModelProvider({ owner, children }: {
  owner: DocumentModelOwner;
  children: ReactNode;
}) {
  return <ModelOwnerContext.Provider value={owner}>{children}</ModelOwnerContext.Provider>;
}

export function useDocumentModelOwner(): DocumentModelOwner | null {
  return useContext(ModelOwnerContext);
}
