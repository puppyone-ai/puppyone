export type AgentFileReference = {
  path: string;
  name?: string | null;
};

export type AgentReferenceStatus = "resolving" | "ready" | "error";

export type AgentReferenceError = {
  code: string;
  message: string;
};

export type AgentWorkspaceEntryReference = {
  id: string;
  kind: "workspace-entry";
  entryType: "file" | "directory";
  /** Owning-root identity; legacy references without a URI remain session-relative. */
  resourceUri?: string;
  workspaceFolderId?: string;
  /** Disambiguating safe label for a reference from another root. */
  workspaceName?: string;
  /** Provider-relative display path, never relative to the currently focused project. */
  relativePath: string;
  displayName: string;
  mime?: string;
  size?: number;
  status: AgentReferenceStatus;
  error?: AgentReferenceError;
};

export type AgentStagedAttachmentReference = {
  id: string;
  kind: "staged-attachment";
  token?: string;
  displayName: string;
  mime: string;
  size: number;
  status: AgentReferenceStatus;
  error?: AgentReferenceError;
};

/** Renderer draft/request representation. It never contains external paths or bytes. */
export type AgentDraftReference = AgentWorkspaceEntryReference | AgentStagedAttachmentReference;

/** A renderer-safe atomic file mention embedded in the user's prompt text. */
export type AgentPromptReferenceMention = {
  referenceId: string;
  /** UTF-16 offsets into the associated prompt string. */
  start: number;
  end: number;
};

/** Renderer-safe transcript representation. */
export type AgentReferenceDisplay = {
  id: string;
  kind: "workspace-file" | "workspace-directory" | "attachment";
  displayName: string;
  relativePath?: string;
  workspaceName?: string;
  mime?: string;
  size?: number;
};

export type AgentSubmissionIntent = {
  id: string;
  recoveryOfTurnId?: string;
  referenceEpoch: string;
  prompt: string;
  model: string | null;
  effort: string | null;
  mode: string | null;
  references: AgentDraftReference[];
  promptMentions: AgentPromptReferenceMention[];
};
