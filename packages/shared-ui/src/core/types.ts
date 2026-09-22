import type { FileSemanticKind } from "./fileFormats";
import type { ResourceUri } from "./resourceUri";

export type DataNodeKind = FileSemanticKind;

/** Semantic kinds that can be admitted into the document workbench. */
export type DocumentDataNodeKind = Exclude<DataNodeKind, "folder">;

export type DataNodeStatus = "clean" | "modified" | "created" | "deleted" | "moved";

export type DataSourceKind =
  | "local"
  | "cloud"
  | "github"
  | "notion"
  | "google_drive"
  | "connector";

export type Workspace = {
  id: string;
  name: string;
  path: string;
  status: "protected" | "recording" | "paused";
  commitCount?: number;
  cloudState?: "local" | "syncing" | "synced";
  /** Secret-free canonical PuppyOne Git locator cached for recent-workspace UI. */
  puppyoneGitRemote?: {
    origin: string;
    projectId: string;
    scopeId?: string | null;
  } | null;
  projectId?: string | null;
  workspaceInstanceId?: string;
  fsIdentity?: string;
  hydrationState?: "metadata" | "loading" | "ready" | "error";
  configError?: string;
  /** Host-resolved Markdown grammar; never inferred from document contents. */
  markdownDialect?: "puppy-gfm" | "openknowledge-mdx";
};

export type WorkspaceContentChangeEntry = Readonly<{
  sequence: number;
  rootUri: ResourceUri | null;
  /** null means the mutation source could not enumerate the affected resources. */
  paths: readonly string[] | null;
}>;

/**
 * Bounded mutation journal consumed by renderers since their last observed
 * sequence. Keeping entries, rather than only the latest event, prevents React
 * batching from dropping near-simultaneous changes from different Folders.
 */
export type WorkspaceContentChange = Readonly<{
  sequence: number;
  entries: readonly WorkspaceContentChangeEntry[];
}>;

export type DataNode = {
  id: string;
  name: string;
  path: string;
  type: DataNodeKind;
  mimeType?: string | null;
  size?: string | null;
  modified?: string | null;
  status?: DataNodeStatus;
  preview?: string | null;
  content?: string | null;
  hasChildren?: boolean;
  children?: DataNode[] | null;
  source?: DataSourceKind;
  /** Global provider/root-aware identity used by multi-root Workspaces. */
  resourceUri?: ResourceUri;
  /** Owning Workspace Folder; absent only on legacy single-provider nodes. */
  workspaceFolderId?: string;
  /** True only for the synthetic Explorer row representing an attached root. */
  workspaceFolderRoot?: boolean;
};

/**
 * A tree node whose identity has been resolved as a document, not a container.
 * Editor APIs accept this narrowed descriptor instead of an unclassified path.
 */
export type DocumentDataNode = DataNode & {
  type: DocumentDataNodeKind;
};

export function isDocumentDataNode(node: DataNode | null | undefined): node is DocumentDataNode {
  return Boolean(node && node.type !== "folder");
}

export type FileContent = {
  path: string;
  name: string;
  type: DocumentDataNodeKind;
  content?: string | null;
  mimeType?: string | null;
  size?: string | null;
  url?: string | null;
  /** Storage revision/fingerprint used as the next conditional-write base. */
  version?: string | null;
};

export type AppPreviewStatus = "starting" | "running" | "stopped" | "error";

export type AppPreviewPackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type AppPreviewProjectCandidate = Readonly<{
  id: string;
  cwd: string;
  directoryLabel: string;
  script: string;
  packageManager: AppPreviewPackageManager;
  framework: string;
  command: readonly string[];
  commandLabel: string;
  score: number;
}>;

export type AppPreviewHtmlCandidate = Readonly<{
  path: string;
  label: string;
}>;

export type AppPreviewDetectionResult = Readonly<{
  projects: readonly AppPreviewProjectCandidate[];
  htmlFiles: readonly AppPreviewHtmlCandidate[];
}>;

export type AppPreviewSetup =
  | Readonly<{
      kind: "local-server";
      cwd: string;
      command: readonly string[];
      url?: string;
    }>
  | Readonly<{ kind: "static-file"; path: string }>
  | Readonly<{ kind: "existing-url"; url: string }>;

export type AppPreviewConfigureRequest = Readonly<{
  path: string;
  name: string;
  setup: AppPreviewSetup;
  expectedContent: string;
}>;

export type AppPreviewConfigureResult = Readonly<{
  content: string;
  version?: string | null;
}>;

export type AppPreviewResult = {
  runtimeId?: string | null;
  appId: string;
  name: string;
  status: AppPreviewStatus;
  path: string;
  url?: string | null;
  port?: number | null;
  command?: string[] | null;
  cwd?: string | null;
  message?: string | null;
  logs?: string | null;
  generation?: number;
  sequence?: number;
  reason?: "cancelled" | "preflight" | "process-exit" | "health-timeout" | "unknown" | null;
  exitCode?: number | null;
};

export type AppPreviewController = {
  detect?: (path: string) => Promise<AppPreviewDetectionResult>;
  configure?: (request: AppPreviewConfigureRequest) => Promise<AppPreviewConfigureResult>;
  start: (path: string) => Promise<AppPreviewResult>;
  restart?: (path: string) => Promise<AppPreviewResult>;
  stop?: (path: string) => Promise<AppPreviewResult>;
  getLogs?: (path: string) => Promise<string>;
  openExternal?: (path: string) => Promise<void>;
  subscribeRuntime?: (listener: (state: AppPreviewResult) => void) => () => void;
};

export type OfficeDocumentConversionResult = {
  arrayBuffer: ArrayBuffer;
  warnings?: string[];
};

export type OfficeDocumentConversionOptions = {
  signal?: AbortSignal;
};

export type OfficeDocumentConverter = (
  path: string,
  options?: OfficeDocumentConversionOptions,
) => Promise<OfficeDocumentConversionResult>;

export type DataImportResult = {
  paths: string[];
};

export type DataCopyOptions = {
  preferredName?: string;
  forceDuplicateName?: boolean;
};

export type DataCopyResult = {
  path: string;
};

export type DataFileUrlPurpose = "file-preview" | "markdown-asset";

export type DataFileUrlOptions = {
  purpose?: DataFileUrlPurpose;
  /** Request an immutable copy of this source version (used for dual inputs). */
  expectedVersion?: string;
};

export type DataReadOptions = {
  signal?: AbortSignal;
};

export type DocumentPersistenceKind = "local-fs" | "cloud";

/**
 * Stable identity for one storage namespace. It must survive adapter and React
 * object recreation; callback/object identity is never a document identity.
 */
export type DocumentStorageIdentity = string;

export type DocumentPersistenceReason =
  | "edit"
  | "manual"
  | "document-close"
  | "document-switch"
  | "workspace-switch"
  | "git-auto-commit"
  | "app-close"
  | "destroy";

export type DocumentPersistenceRequest = {
  path: string;
  content: string;
  revision: string;
  baseVersion?: string | null;
  reason: DocumentPersistenceReason;
};

export type DocumentPersistenceSuccess = Readonly<{
  ok: true;
  version: string | null;
}>;

export type DocumentPersistenceConflict = Readonly<{
  ok: false;
  kind: "conflict";
  /** Latest storage bytes, read after the failed compare-and-swap. */
  content: string;
  version: string | null;
}>;

export type DocumentPersistenceFailure = Readonly<{
  ok: false;
  kind: "not-found" | "permission-denied" | "io";
  /** Untrusted adapter detail; presentation code must isolate it. */
  message: string;
}>;

/** Expected storage outcomes cross process boundaries as data, never Error metadata. */
export type DocumentPersistenceResult =
  | DocumentPersistenceSuccess
  | DocumentPersistenceConflict
  | DocumentPersistenceFailure;

/**
 * Host-owned storage strategy. Editors never receive this port directly;
 * Document Sessions serialize and version every call.
 */
export type DocumentPersistencePort = {
  kind: DocumentPersistenceKind;
  storageIdentity: DocumentStorageIdentity;
  persist: (request: DocumentPersistenceRequest) => Promise<DocumentPersistenceResult>;
};

export type DataCapabilities = {
  create?: boolean;
  rename?: boolean;
  delete?: boolean;
  move?: boolean;
  copy?: boolean;
  write?: boolean;
  history?: boolean;
  accessPoints?: boolean;
  cloudSync?: boolean;
  localGit?: boolean;
  connectors?: boolean;
};

export type DataPort = {
  previewServices?: import("../editor/preview-services/types").EditorPreviewServices;
  editorAssets?: import("../editor/resource/DocumentAssetImport").DocumentAssetImportPort;
  listChildren: (folderPath: string | null) => Promise<DataNode[]>;
  /** Resolve one workspace-relative entry without enumerating or previewing its siblings. */
  resolveNode?: (path: string) => Promise<DataNode | null>;
  readFile?: (path: string, options?: DataReadOptions) => Promise<FileContent>;
  getFileUrl?: (path: string, options?: DataFileUrlOptions) => string | Promise<string>;
  revokeFileUrl?: (url: string) => void | Promise<void>;
  openExternalFile?: (path: string) => Promise<void>;
  revealInFileManager?: (path: string) => Promise<void>;
  convertOfficeDocumentToDocx?: OfficeDocumentConverter;
  appPreview?: AppPreviewController;
  documentPersistence?: DocumentPersistencePort;
  createFolder?: (path: string) => Promise<void>;
  createFile?: (path: string, content?: string) => Promise<void>;
  instantiateTemplate?: (request: DataTemplateInstantiationRequest) => Promise<DataTemplateInstantiationResult>;
  importFiles?: (files: File[], targetFolderPath: string | null, options?: { preferredName?: string }) => Promise<DataImportResult>;
  renameNode?: (path: string, nextName: string) => Promise<void>;
  deleteNode?: (path: string) => Promise<void>;
  moveNode?: (from: string, to: string) => Promise<void>;
  copyNode?: (
    fromPath: string,
    targetFolderPath: string | null,
    options?: DataCopyOptions,
  ) => Promise<DataCopyResult>;
};

export type DataTemplateInstantiationRequest = {
  templateId: "slides.default";
  parentPath: string | null;
  name: string;
};

export type DataTemplateInstantiationResult = {
  rootPath: string;
  openPath: string;
  createdPaths: string[];
  template: {
    id: "slides.default";
    version: number;
  };
};

export const defaultDataCapabilities: DataCapabilities = {
  create: false,
  rename: false,
  delete: false,
  move: false,
  copy: false,
  write: false,
  history: false,
  accessPoints: false,
  cloudSync: false,
  localGit: false,
  connectors: false,
};
