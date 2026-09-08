import type {
  DocumentPersistencePort,
  DocumentPersistenceReason,
} from "../../core/types";
import type {
  EditorSourceRevision,
  EditorSourceSnapshotPort,
} from "../sourceSnapshot";
import type { EditorSaveMode } from "../registry/viewerTypes";

export type DocumentSessionStatus = "clean" | "dirty" | "saving" | "saved" | "error";

export type DocumentSessionErrorCode = "persistence-failed";

export type DocumentSessionError = Readonly<{
  code: DocumentSessionErrorCode;
  /** Untrusted adapter detail. Presentation layers must wrap and bidi-isolate it. */
  detail: string | null;
}>;

export type DocumentSessionState = Readonly<{
  documentId: string;
  status: DocumentSessionStatus;
  error: DocumentSessionError | null;
  currentRevision: string | null;
  persistedRevision: string | null;
  storageVersion: string | null;
}>;

export type DocumentPersistedCommit = Readonly<{
  documentId: string;
  content: string;
  revision: string;
  reason: DocumentPersistenceReason;
  version: string | null;
}>;

export type DocumentEditingSessionOptions = {
  documentId: string;
  initialContent: string;
  initialVersion?: string | null;
  saveMode: EditorSaveMode;
  persistence: DocumentPersistencePort;
  onPersisted?: (commit: DocumentPersistedCommit) => void;
};

export type ExternalBaselineResult = "acknowledged" | "applied";

export type DocumentSessionDrainReason = Extract<
  DocumentPersistenceReason,
  "document-close" | "document-switch" | "workspace-switch" | "git-auto-commit" | "app-close" | "destroy"
>;

/**
 * The only Document Session surface visible to a format editor. A contribution
 * owns its model and serialization; the host owns every save decision.
 */
export type EditableDocumentSource = {
  attachSource: (source: EditorSourceSnapshotPort) => () => void;
  reportRevision: (revision: EditorSourceRevision) => void;
};

/** Host-only lifecycle handle used by the boundary and close registry. */
export type DocumentEditingSessionHandle = EditableDocumentSource & {
  readonly documentId: string;
  reconcileExternalBaseline: (content: string, version?: string | null) => ExternalBaselineResult;
  requestSave: () => Promise<void>;
  /** Read and durably drain the current source before navigation or host close. */
  flushCurrent: (reason?: DocumentSessionDrainReason) => Promise<void>;
  hasUnpersistedChanges: () => boolean;
  getState: () => DocumentSessionState;
  subscribe: (listener: () => void) => () => void;
  /** Permanently freeze editor input after the registry confirms real retirement. */
  dispose: () => void;
};
