export { DocumentEditingSession } from "./DocumentEditingSession";
export { DocumentSessionBoundary } from "./DocumentSessionBoundary";
export { useEditableDocumentSource } from "./EditableDocumentSourceContext";
export {
  discardActiveDocumentSessions,
  flushActiveDocumentSessions,
  hasUnsavedDocumentSessions,
  subscribeUnsavedDocumentSessions,
  registerActiveDocumentSession,
} from "./activeDocumentSessions";
export { useDocumentSessionState } from "./useDocumentSessionState";
export { formatDocumentSessionError } from "./formatDocumentSessionError";
export {
  canonicalizeDocumentResourcePath,
  createDocumentIdentity,
  getDocumentIdentityKey,
} from "./documentIdentity";
export {
  closeAllDocumentWorkingCopies,
  closeDocumentWorkingCopy,
  closeDocumentWorkingCopiesUnderResource,
  getDocumentWorkingCopyStatuses,
  subscribeDocumentWorkingCopyStatuses,
} from "./documentWorkingCopies";
export type { DocumentSessionBoundaryProps } from "./DocumentSessionBoundary";
export type {
  CanonicalDocumentResourcePath,
  DocumentIdentity,
} from "./documentIdentity";
export type {
  DocumentEditingSessionOptions,
  DocumentSessionDrainReason,
  DocumentSessionError,
  DocumentSessionErrorCode,
  DocumentPersistedCommit,
  DocumentSessionState,
  DocumentSessionStatus,
  DocumentEditingSessionHandle,
  EditableDocumentSource,
  ExternalBaselineResult,
} from "./types";
