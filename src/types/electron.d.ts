import type {
  AiEditRequest,
  AppPreviewResult,
  DataNode,
  FileContent,
  Workspace,
} from "@puppyone/shared-ui";
import type { AppLanguagePreference, LocaleState } from "@puppyone/localization/core";
import type { DesktopTerminalLauncherId } from "../features/desktop-terminal/model/terminalLaunchers";
import type {
  AgentAccountReadRequest,
  AgentAccountState,
  AgentApprovalResolution,
  AgentEvent,
  AgentLocalConnectionsRequest,
  AgentLocalConnectionsSnapshot,
  AgentModel,
  AgentModelsListRequest,
  AgentProviderInspection,
  AgentQuestionResolution,
  AgentReplayRequest,
  AgentRuntimeRequest,
  AgentSessionCloseRequest,
  AgentSessionCreateRequest,
  AgentSessionMutationRequest,
  AgentSessionOpenRequest,
  AgentSessionOpenResult,
  AgentSessionResumeRequest,
  AgentSessionSnapshot,
  AgentSessionAttachRequest,
  AgentSessionFeedAckRequest,
  AgentSessionFeedReceipt,
  AgentSessionDetachRequest,
  AgentSessionFrame,
  AgentSessionsListRequest,
  AgentSessionsListResponse,
  AgentTurnInterruptRequest,
  AgentTurnStartRequest,
  AgentTurnSteerRequest,
} from "../../shared/agent-contract/types";
import type {
  AgentActivityEnrollmentSnapshot,
  AgentActivityEvent,
  AgentActivitySnapshot,
} from "../../shared/agent-activity-contract/types";
import type {
  CloudInitializationCleanupRequest,
  CloudInitializationErrorCode,
  CloudInitializationIdentityRequest,
  CloudInitializationProgress,
  CloudInitializationProgressStage,
  CloudInitializationResult,
  CloudInitializationStartRequest,
  CloudInitializationState,
} from "./cloudInitialization";

export type {
  CloudInitializationAction,
  CloudInitializationCleanupRequest,
  CloudInitializationCleanupState,
  CloudInitializationErrorCode,
  CloudInitializationIdentityRequest,
  CloudInitializationLocalState,
  CloudInitializationProgress,
  CloudInitializationProgressStage,
  CloudInitializationProjectState,
  CloudInitializationPushState,
  CloudInitializationResult,
  CloudInitializationStartRequest,
  CloudInitializationState,
} from "./cloudInitialization";

export type GitStatusEntry = {
  path: string;
  oldPath: string | null;
  staged: string | null;
  unstaged: string | null;
  status: string;
  conflict?: boolean;
};

export type GitSourceControlResourceStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflict"
  | "changed";

export type GitSourceControlResourceGroupId = "merge" | "index" | "workingTree" | "untracked";

export type GitSourceControlResource = {
  id: string;
  group: GitSourceControlResourceGroupId;
  path: string;
  oldPath: string | null;
  status: GitSourceControlResourceStatus;
  staged: boolean;
  conflict: boolean;
  letter: string;
};

export type GitSourceControlResourceGroup = {
  id: GitSourceControlResourceGroupId;
  label: string;
  resources: GitSourceControlResource[];
};

export type GitCommitChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "changed";

export type GitCommitChange = {
  path: string;
  oldPath: string | null;
  status: GitCommitChangeStatus;
  additions: number | null;
  deletions: number | null;
};

export type GitCommitSummary = {
  commit_id: string;
  parent_ids: string[];
  author_name: string;
  author_email: string;
  created_at: string | null;
  message: string;
  graph_prefix?: string;
  graph_continuation_prefixes?: string[];
  changes: GitCommitChange[];
};

export type GitDiffLine = {
  kind: "hunk" | "add" | "remove" | "context";
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type GitRevisionMissingSide = {
  kind: "missing";
  identity: string;
  size: 0;
  mimeType: null;
  reason: string;
};

export type GitRevisionTextSide = {
  kind: "text";
  identity: string;
  size: number;
  mimeType: string | null;
  content: string;
};

export type GitRevisionResourceSide = {
  kind: "resource";
  identity: string;
  size: number;
  mimeType: string | null;
  handle: string;
};

export type GitRevisionUnavailableSide = {
  kind: "unavailable";
  identity: string;
  size: number | null;
  mimeType: string | null;
  reason: string;
  message: string;
};

export type GitRevisionSide =
  | GitRevisionMissingSide
  | GitRevisionTextSide
  | GitRevisionResourceSide
  | GitRevisionUnavailableSide;

export type GitRevisionPair = {
  repositoryIdentity: string;
  selectionIdentity: string;
  sessionId: string;
  scope: GitWorkingDiffScope;
  path: string;
  oldPath: string | null;
  status: GitCommitChangeStatus | "untracked";
  before: GitRevisionSide;
  after: GitRevisionSide;
};

export type GitFileDiff = GitCommitChange & {
  binary: boolean;
  mimeType?: string | null;
  revisionPair?: GitRevisionPair;
  lines: GitDiffLine[];
  truncated?: boolean;
  omittedLines?: number;
};

export type GitCommitDetail = {
  commit_id: string;
  files: GitFileDiff[];
};

export type GitBranchSummary = {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommitId: string | null;
  lastCommitMessage: string | null;
  lastCommitDate: string | null;
  lastCommitAuthorName?: string | null;
};

export type GitRemoteSummary = {
  name: string;
  fetchUrl: string | null;
  pushUrl: string | null;
  branches: string[];
};

export type GitFileChangeSummary = {
  total: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  copied: number;
  changed: number;
};

export type GitSyncTargetSummary = {
  remote: string | null;
  branch: string | null;
  ref: string | null;
  exists: boolean;
  ahead: number;
  behind: number;
  incomingFileSummary?: GitFileChangeSummary;
  incomingPreview: GitSourceControlResource[];
  outgoingPreview: GitSourceControlResource[];
};

export type GitSourceControlRemoteSummary = {
  target: GitSyncTargetSummary | null;
  currentBranch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  incomingFileSummary?: GitFileChangeSummary;
  incomingPreview: GitSourceControlResource[];
  outgoingPreview: GitSourceControlResource[];
  canPull: boolean;
  canPush: boolean;
  canSync: boolean;
  canPublish: boolean;
  state:
    | "no-repository"
    | "no-remote"
    | "no-branch"
    | "publish"
    | "incoming"
    | "outgoing"
    | "diverged"
    | "synced";
};

export type GitRepositoryOperationKind = "merge" | "rebase" | "cherry-pick" | "revert";

export type GitRepositoryOperationState = {
  kind: GitRepositoryOperationKind;
  canContinue: boolean;
  canAbort: boolean;
};

export type GitSourceControlSnapshot = {
  input: {
    placeholder: string;
    defaultMessage: string;
  };
  groups: GitSourceControlResourceGroup[];
  operation?: GitRepositoryOperationState | null;
  remote: GitSourceControlRemoteSummary;
  actions: {
    canStageAll: boolean;
    canUnstageAll: boolean;
    canDiscardAll: boolean;
    canCommit: boolean;
    canContinue?: boolean;
    canAbort?: boolean;
  };
};

export type GitWorkingDiffScope = "staged" | "unstaged" | "untracked" | "remote" | "committed";

export type GitEffectiveHostingKind = "github" | "puppyone-cloud" | "generic-git" | "local-only";

export type GitEffectiveHostingReason =
  | "configured"
  | "remote-detected"
  | "upstream-detected"
  | "missing-remote"
  | "local-only"
  | "no-repository";

export type GitEffectiveHostingIdentity = {
  provider: Extract<GitEffectiveHostingKind, "github" | "puppyone-cloud">;
  label: string;
  href: string | null;
};

export type GitEffectiveHosting = {
  kind: GitEffectiveHostingKind;
  remoteName: string | null;
  branchName: string | null;
  ref: string | null;
  ready: boolean;
  reason: GitEffectiveHostingReason;
  identity: GitEffectiveHostingIdentity | null;
};

export type GitStatusSnapshot = {
  isRepo: boolean;
  branch: string | null;
  headCommitId: string | null;
  totalCommits: number;
  entries: GitStatusEntry[];
  stagedEntries: GitStatusEntry[];
  unstagedEntries: GitStatusEntry[];
  untrackedEntries: GitStatusEntry[];
  branches: GitBranchSummary[];
  remotes: GitRemoteSummary[];
  syncTarget: GitSyncTargetSummary | null;
  effectiveHosting: GitEffectiveHosting;
  sourceControl: GitSourceControlSnapshot;
  commits: GitCommitSummary[];
  allCommits: GitCommitSummary[];
  statusLimit: number;
  didHitStatusLimit: boolean;
};

// Transitional type aliases for the rest of the Cloud surface. They point to
// the independent v2 contract and do not retain v1 phase/boolean semantics.
export type CloudPublishErrorCode = CloudInitializationErrorCode;
export type CloudPublishProgressStage = CloudInitializationProgressStage;
export type CloudPublishState = CloudInitializationState;
export type CloudPublishProgress = CloudInitializationProgress;
export type CloudPublishResult = CloudInitializationResult;
export type CloudPublishIdentityRequest = CloudInitializationIdentityRequest;
export type CloudPublishStartRequest = CloudInitializationStartRequest;
export type CloudPublishAbandonRequest = CloudInitializationCleanupRequest;

export type CloudGitConnectRequest = CloudPublishIdentityRequest & {
  projectId: string;
};

export type CloudGitConnectAbandonRequest = CloudGitConnectRequest & {
  operationId: string;
};

export type CloudGitConnectResult =
  | {
    ok: true;
    gitStatus: GitStatusSnapshot;
    projectId: string;
    target: { kind: "project_root"; project_id: string };
  }
  | {
    ok: false;
    operationId: string | null;
    state: null;
    error: { code: CloudPublishErrorCode; retryable: boolean; message?: string };
  };

export type GitBranchGraphSnapshot = {
  isRepo: boolean;
  branch: string | null;
  headCommitId: string | null;
  branches: GitBranchSummary[];
  commits: GitCommitSummary[];
  allCommits: GitCommitSummary[];
};

export type TerminalCreateRequest = {
  projectContext?: import("../../shared/project-session-contract/types").ProjectSessionContext;
  id: string;
  /** Explicit Folder capability required when a window has multiple roots. */
  rootPath: string;
  cwd: string;
  cols: number;
  rows: number;
  launcherId?: DesktopTerminalLauncherId;
  defaultColors?: {
    foreground: [number, number, number];
    background: [number, number, number];
  };
};

export type TerminalAppearanceRequest = {
  projectContext?: import("../../shared/project-session-contract/types").ProjectSessionContext;
  instanceId?: string;
  id: string;
  defaultColors: {
    foreground: [number, number, number];
    background: [number, number, number];
  };
};

export type TerminalAgentId = Exclude<DesktopTerminalLauncherId, "shell">;

export type TerminalAgentLocationSnapshot = {
  availableAgentIds: TerminalAgentId[];
  scannedAt: string;
  source: "scan" | "memory-cache";
};

export type TerminalAgentLocationProgressEvent = {
  availableAgentIds: TerminalAgentId[];
  completedAgentCount: number;
  requestId: string;
  totalAgentCount: number;
};

export type TerminalCreateResult = {
  instanceId?: string;
  id: string;
  pid: number | null;
  shell: string;
  inputShell: string;
  cwd: string;
};

export type TerminalInputRequest = {
  projectContext?: import("../../shared/project-session-contract/types").ProjectSessionContext;
  instanceId?: string;
  id: string;
  data: string;
};

export type TerminalResizeRequest = {
  projectContext?: import("../../shared/project-session-contract/types").ProjectSessionContext;
  instanceId?: string;
  id: string;
  cols: number;
  rows: number;
};

export type TerminalDataEvent = {
  id: string;
  instanceId?: string;
  data: string;
};

export type TerminalExitEvent = {
  id: string;
  instanceId?: string;
  code: number | null;
  signal: string | null;
};

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "not-available"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "blocked"
  | "error";

export type DesktopBuildChannel = "dev" | "internal" | "stable";

export type DesktopPlatform = "macos" | "windows" | "linux";
export type DesktopArchitecture = "x64" | "arm64";

export type DesktopPlatformCapabilities = {
  readonly schemaVersion: 1;
  readonly platform: DesktopPlatform;
  readonly arch: DesktopArchitecture;
  readonly primaryModifier: "meta" | "control";
  readonly windowChrome: {
    readonly mode: "native" | "overlay" | "custom";
  };
  readonly credentialStorage: {
    readonly available: boolean;
    readonly locked: boolean;
    readonly strength: "os-backed" | "unavailable";
    readonly backend: string | null;
  };
  readonly documentConversion: {
    readonly supportedInputs: ReadonlyArray<string>;
  };
  readonly updater: {
    readonly supported: boolean;
    readonly installMode: "squirrel" | "nsis" | "appimage" | "manual";
  };
};

export type DesktopTelemetryLevel = "off" | "basic";

export type DesktopTelemetryState = {
  readonly schemaVersion: 2;
  readonly defaultLevel: DesktopTelemetryLevel;
  readonly level: DesktopTelemetryLevel;
  readonly effectiveLevel: DesktopTelemetryLevel;
  readonly enabled: boolean;
  readonly eligible: boolean;
  readonly disabledReason: string | null;
  readonly noticeVersion: number;
  readonly noticeSeenVersion: number;
  readonly noticeRequired: boolean;
  readonly transportConfigured: boolean;
  readonly queuedEventCount: number;
};

export type DesktopTelemetryDisclosure = {
  readonly schemaVersion: 2;
  readonly noticeVersion: number;
  readonly levels: ReadonlyArray<{
    readonly id: DesktopTelemetryLevel;
    readonly sendsData: boolean;
    readonly description: string;
  }>;
  readonly events: ReadonlyArray<{
    readonly name: string;
    readonly purpose: string;
    readonly maximumFrequency: string;
    readonly identifierRotation: string;
    readonly fields: ReadonlyArray<string>;
  }>;
  readonly neverCollected: ReadonlyArray<string>;
};

export type DesktopBuildInfo = {
  readonly schemaVersion: 1;
  readonly product: "puppyone-desktop";
  readonly channel: DesktopBuildChannel;
  readonly baseVersion: string;
  readonly version: string;
  readonly buildId: string;
  readonly platformBuildNumber: string | null;
  readonly commitSha: string;
  readonly builtAt: string;
  readonly sourceDirty: boolean;
};

export type DesktopUpdateInfo = {
  version: string | null;
  releaseName: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
} | null;

export type DesktopUpdateProgress = {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
} | null;

export type DesktopUpdateBlocker = {
  id: string;
  label: string;
  detail: string | null;
};

export type DesktopUpdateState = {
  status: DesktopUpdateStatus;
  currentVersion: string;
  channel: DesktopBuildChannel;
  availableVersion: string | null;
  updateInfo: DesktopUpdateInfo;
  progress: DesktopUpdateProgress;
  blockers: DesktopUpdateBlocker[];
  error: string | null;
  reason: string | null;
  lastCheckedAt: string | null;
  updatedAt: string;
};

export type GitAutoCommitWorkspacePolicy = {
  enabled: boolean;
  scope: "untracked-only";
  minimumIntervalMs: number;
  quietPeriodMs: number;
  updatedAt: string | null;
};

export type GitAutoCommitResult = {
  outcome: "committed" | "no-op" | "skipped" | "failed" | "needs-review";
  reason: string;
  commitId: string | null;
  pathCount: number | null;
  retryable: boolean;
  workspaceGeneration?: number;
  occurredAt?: string;
};

export type GitAutoCommitSnapshot = {
  available: boolean;
  experimentalOptIn: boolean;
  repository: boolean;
  workspacePolicy: GitAutoCommitWorkspacePolicy | null;
  effectiveEnabled: boolean;
  runtime: {
    state: "disabled" | "idle" | "waiting" | "running";
    nextEligibleAt: string | null;
    lastResult: GitAutoCommitResult | null;
  } | null;
};

export type WorkspaceChangedEvent = {
  rootPath: string;
  eventType: string;
  path: string | null;
  /** All paths coalesced in the watcher debounce window. */
  paths?: string[];
  error?: string;
  recovered?: boolean;
  reason?: string;
};

export type WorkspaceWriteFileResult =
  | { ok: true; version: string | null }
  | { ok: false; kind: "conflict"; content: string; version: string | null }
  | { ok: false; kind: "not-found" | "permission-denied" | "io"; message: string };

export type AiEditReviewUpdatedEvent = {
  rootPath: string;
  request: AiEditRequest;
};

export type GitRepositoryWatchResult = {
  subscriptionId: string;
  rootPath: string;
  repository: boolean;
};

export type GitRepositoryInvalidatedEvent = {
  subscriptionId: string;
  rootPath: string;
  reason: string;
};

export type GitRepositoryWindowFocusEvent = {
  focused: boolean;
};

export type LastWorkspaceResult = {
  workspaceId: string | null;
  path: string | null;
  workspace: Workspace | null;
  workspaces?: Workspace[];
  error: string | null;
};

export type RecentWorkspacesResult = {
  workspaces: Workspace[];
  items?: Array<{
    workspace: Workspace;
    lastOpenedAt: string | null;
  }>;
  errors: Array<{
    path: string;
    error: string;
  }>;
  hydrated?: boolean;
};

export type ProjectAppearance = Readonly<{
  projectIdentity: string;
  icon: Readonly<{
    kind: "asset";
    assetId: string;
    mediaType: "image/png";
    updatedAt: string;
    url: string;
  }> | Readonly<{
    kind: "emoji";
    value: string;
    updatedAt: string;
  }> | null;
}>;

export type ProjectIconSelectionResult = Readonly<{
  status: "cancelled";
}> | Readonly<{
  status: "updated";
  appearance: ProjectAppearance;
}>;

export type WorkspaceOpenResult = {
  status: "opened-current" | "opened-new-window" | "focused-existing";
  workspaceId: string | null;
  path: string | null;
  workspace: Workspace | null;
  workspaces?: Workspace[];
};

export type WorkspaceAttachResult = {
  status: "attached-current" | "already-attached" | "focused-existing";
  workspaceId: string;
  path: string | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
};

export type WorkspaceDetachResult = {
  status: "detached-current" | "not-attached";
  workspaceId: string;
  path: string | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
};

export type WorkspaceCreateProjectRequest = {
  name: string;
  locationGrantId: string;
};

export type WorkspaceProjectLocationGrant = {
  grantId: string;
  path: string;
};

export type WorkspaceCloneRepositoryRequest = {
  repositoryUrl: string;
};

export type WorkspaceCreateEntryKind = "file" | "folder";

export type WorkspaceCreateEntryRequest = {
  rootPath: string;
  parentPath: string | null;
  name: string;
  kind: WorkspaceCreateEntryKind;
  content?: string;
};

export type WorkspaceCreateEntryResult = {
  path: string;
};

export type WorkspaceInstantiateTemplateRequest = {
  rootPath: string;
  parentPath: string | null;
  name: string;
  templateId: "slides.default";
};

export type WorkspaceInstantiateTemplateResult = {
  rootPath: string;
  openPath: string;
  createdPaths: string[];
  template: { id: "slides.default"; version: number };
};

export type WorkspaceRenameEntryRequest = {
  rootPath: string;
  path: string;
  nextName: string;
};

export type WorkspaceMoveEntryRequest = {
  rootPath: string;
  fromPath: string;
  toPath: string;
};

export type WorkspaceCopyEntryRequest = {
  rootPath: string;
  fromPath: string;
  targetFolderPath: string | null;
  preferredName?: string;
  forceDuplicateName?: boolean;
};

export type WorkspaceCopyEntryBetweenRootsRequest = Omit<WorkspaceCopyEntryRequest, "rootPath"> & {
  sourceRootPath: string;
  targetRootPath: string;
};

export type WorkspaceImportEntriesRequest = {
  rootPath: string;
  targetFolderPath: string | null;
  files: File[];
};

export type WorkspaceImportEntriesResult = {
  paths: string[];
};

export type WorkspaceDeleteEntryRequest = {
  rootPath: string;
  path: string;
};

export type WorkspaceRevealEntryRequest = {
  rootPath: string;
  path: string;
};

export type WorkspaceConvertOfficeDocumentToDocxRequest = {
  rootPath: string;
  path: string;
  requestId: string;
};

export type WorkspaceCancelOfficeDocumentToDocxRequest = {
  requestId: string;
};

export type WorkspaceCancelOfficeDocumentToDocxResult = {
  cancelled: boolean;
};

export type WorkspaceConvertOfficeDocumentToDocxResult = {
  bytes: ArrayBuffer;
  warnings?: string[];
};

export type WorkspaceOpenEntryExternalRequest = {
  rootPath: string;
  path: string;
};

export type DesktopStoredCloudSession = {
  expires_in: number;
  expires_at: number;
  user_id: string;
  user_email: string;
  api_base_url: string;
  session_generation: string;
  status: DesktopCloudAuthStatus;
};

export type DesktopCloudAuthStatus =
  | "restoring"
  | "signing-in"
  | "authenticated"
  | "refreshing"
  | "offline-authenticated"
  | "signing-out"
  | "expired"
  | "signed-out";

export type DesktopCloudAuthStateSnapshot = {
  status: DesktopCloudAuthStatus;
  session: DesktopStoredCloudSession | null;
};

export type DesktopCloudIpcEnvelope<T> =
  | { transport: "puppyone-cloud-ipc-v1"; ok: true; data: T }
  | {
      transport: "puppyone-cloud-ipc-v1";
      ok: false;
      error: { message: string; status?: number; code?: string };
    };

export type PuppyoneBackendService = "puppyone" | "github" | "custom";

export type PuppyoneWorkspaceConfig = {
  version: 3;
  sync: {
    sourceOfTruth: {
      service: PuppyoneBackendService;
      remote: string | null;
      branch: string | null;
    };
  };
  git: {
    primaryRemote: string | null;
    watchedBranch: string | null;
  };
  backup: {
    enabled: boolean;
    service: PuppyoneBackendService;
    remote: string | null;
    branch: string | null;
  };
  updatedAt?: string;
};

export type DesktopThemeTarget = "application" | "typography" | "markdown" | "csv";
export type DesktopThemeColorMode = "light" | "dark";
export type DesktopThemeFirstPaint = Readonly<{
  background: string;
  colorScheme: DesktopThemeColorMode;
}>;
export type DesktopThemeDefinition = Readonly<{
  id: string;
  name: string;
  version: string;
  author?: string;
  contractVersion?: number;
  compatibleRootThemeIds?: readonly string[];
  modes: readonly DesktopThemeColorMode[];
  targets: readonly DesktopThemeTarget[];
  source: "local-css" | "local-package";
  compiledCss: Readonly<Partial<Record<DesktopThemeTarget, string>>>;
  firstPaint?: Readonly<Partial<Record<DesktopThemeColorMode, DesktopThemeFirstPaint>>>;
}>;
export type DesktopThemeDiagnostic = Readonly<{
  source: string;
  message: string;
}>;
export type DesktopThemeSnapshot = Readonly<{
  themes: readonly DesktopThemeDefinition[];
  diagnostics: readonly DesktopThemeDiagnostic[];
}>;
export type DesktopThemeMenuState = Readonly<{
  pack: string;
  requiredTargets?: readonly DesktopThemeTarget[];
  themes: readonly Readonly<{
    id: string;
    name: string;
    targets: readonly DesktopThemeTarget[];
  }>[];
}>;

export type EditorSurfaceBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type EditorSurfaceAppearance = Readonly<{
  dark: boolean;
  direction: "ltr" | "rtl";
  attributes: Readonly<Record<string, string>>;
  variables: Readonly<Record<string, string>>;
}>;

export type EditorSurfaceState = Readonly<{
  sessionId: string;
  viewerId: string;
  status: "loading" | "ready" | "unresponsive" | "crashed" | "error" | "disposed";
  reason?: string;
  message?: string;
  exitCode?: number | null;
}>;

declare global {
  interface Window {
    puppyoneItemHost?: import("../../shared/item-host-contract/types").ItemRendererBridge;
    puppyoneDesktop?: {
      itemHosts?: import("../../shared/item-host-contract/types").ItemHostBridge;
      getWindowChromeState: () => Promise<{ fullScreen: boolean; maximized: boolean }>;
      setWindowChromeProfile: (request: {
        titlebar: string;
      }) => Promise<{
        applied: boolean;
        customControls?: boolean;
      }>;
      performWindowAction: (request: {
        action: "minimize" | "toggle-maximize" | "close";
      }) => Promise<{ applied: boolean }>;
      onWindowChromeStateChanged: (
        callback: (state: { fullScreen: boolean }) => void,
      ) => () => void;
      setWindowBackground: (request: {
        background: string;
        themeSource: "system" | "light" | "dark";
      }) => void;
      themes: {
        list: () => Promise<DesktopThemeSnapshot>;
        openDirectory: () => Promise<{ opened: true }>;
        create: () => Promise<{ created: true; themeId: string }>;
        syncNativeMenu: (request: DesktopThemeMenuState) => Promise<{ synced: true }>;
        onSelectionRequested: (
          callback: (request: { kind: "pack"; themeId: string }) => void,
        ) => () => void;
      };
      setWindowMinimumWidth: (request: { width: number }) => Promise<{
        applied: boolean;
        width?: number;
      }>;
      capturePanePreview: (request: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => Promise<{
        dataUrl: string;
        width: number;
        height: number;
      } | null>;
      setNativeSurfaceOccluded: (request: { occluded: boolean }) => void;
      setNativeSurfacePointerPassthrough: (request: { active: boolean }) => void;
      setNativeSurfacePointerRoutingRegions: (request: {
        regions: Array<{ id?: number; cursor?: "col-resize" | "row-resize"; x: number; y: number; width: number; height: number }>;
      }) => void;
      onNativeSurfacePointerHover: (callback: (state: { regionId: number | null }) => void) => () => void;
      getBuildInfo: () => Promise<DesktopBuildInfo>;
      getPlatformCapabilities: () => Promise<DesktopPlatformCapabilities>;
      getTelemetryState: () => Promise<DesktopTelemetryState>;
      getTelemetryDisclosure: () => Promise<DesktopTelemetryDisclosure>;
      markTelemetryNoticeSeen: () => Promise<DesktopTelemetryState>;
      setTelemetryLevel: (request: { level: DesktopTelemetryLevel }) => Promise<DesktopTelemetryState>;
      resetTelemetryIdentity: () => Promise<DesktopTelemetryState>;
      onTelemetryStateChanged: (
        callback: (state: DesktopTelemetryState) => void,
      ) => () => void;
      getLocalizationBootstrap: () => Promise<LocaleState>;
      setLanguagePreference: (preference: AppLanguagePreference) => Promise<LocaleState>;
      onLocaleChanged: (callback: (state: LocaleState) => void) => () => void;
      setMarkdownFormatShortcutsActive: (request: { active: boolean }) => void;
      onMarkdownFormatShortcut: (
        callback: (payload: { type: import("@puppyone/shared-ui").MarkdownFormatCommand }) => void,
      ) => () => void;
      onMarkdownEditorCommand: (
        callback: (payload: { type: import("@puppyone/shared-ui").MarkdownEditorCommand }) => void,
      ) => () => void;
      onDocumentSessionFlushRequested: (
        callback: (request: {
          requestId: string;
          reason: "app-close" | "git-auto-commit";
        }) => void | Promise<void>,
      ) => () => void;
      onDocumentSessionCloseCancelled: (
        callback: (request: { requestId: string }) => void,
      ) => () => void;
      getGitAutoCommitSettings?: (request?: {
        rootPath?: string;
      }) => Promise<GitAutoCommitSnapshot>;
      setGitAutoCommitExperimentalOptIn?: (request: {
        enabled: boolean;
      }) => Promise<GitAutoCommitSnapshot>;
      setGitAutoCommitWorkspacePolicy?: (request: {
        rootPath: string;
        enabled?: boolean;
        minimumIntervalMs?: number;
      }) => Promise<GitAutoCommitSnapshot>;
      onGitAutoCommitStateChanged?: (
        callback: (snapshot: GitAutoCommitSnapshot) => void,
      ) => () => void;
      readCloudSession: () => Promise<DesktopStoredCloudSession | null>;
      readCloudAuthState: () => Promise<DesktopCloudAuthStateSnapshot>;
      restoreCloudSession: (request: {
        apiBaseUrl?: string | null;
      }) => Promise<DesktopStoredCloudSession | null>;
      startCloudOAuth: (request: {
        apiBaseUrl: string;
        provider?: "google" | "github";
      }) => Promise<{ ok: boolean }>;
      clearCloudSession: () => Promise<void>;
      onCloudSessionChanged: (
        callback: (session: DesktopStoredCloudSession | null) => void,
      ) => () => void;
      onCloudAuthStateChanged: (
        callback: (state: DesktopCloudAuthStateSnapshot) => void,
      ) => () => void;
      onCloudAuthError: (
        callback: (payload: { message?: string }) => void,
      ) => () => void;
      requestCloudApi: (request: {
        apiBaseUrl: string;
        path: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      }) => Promise<DesktopCloudIpcEnvelope<unknown>>;
      requestCloudSessionApi: (request: {
        apiBaseUrl: string;
        path: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      }) => Promise<DesktopCloudIpcEnvelope<unknown>>;
      cloudInitializationGetState: (request: CloudInitializationIdentityRequest) => Promise<CloudInitializationResult>;
      cloudInitializationStart: (request: CloudInitializationStartRequest) => Promise<CloudInitializationResult>;
      cloudInitializationCleanup: (request: CloudInitializationCleanupRequest) => Promise<CloudInitializationResult>;
      onCloudInitializationProgress: (callback: (progress: CloudInitializationProgress) => void) => () => void;
      cloudGitConnectProject: (request: CloudGitConnectRequest) => Promise<CloudGitConnectResult>;
      cloudGitAbandonConnect: (request: CloudGitConnectAbandonRequest) => Promise<CloudGitConnectResult>;
      listCloudAccessPointDirectory: (request: {
        accessKey: string;
        path?: string;
        userEmail?: string | null;
        remoteUrl?: string | null;
        apiBaseUrl?: string | null;
      }) => Promise<{
        path: string;
        entries: Array<{
          name: string;
          path: string;
          type: string;
          content_hash?: string | null;
          size_bytes?: number | null;
          mime_type?: string | null;
          children_count?: number | null;
          integrity_status?: "ok" | "damaged" | "unknown";
        }>;
        head_commit_id?: string;
      }>;
      getCloudAccessPointSemantics: (request: {
        accessKey: string;
        userEmail?: string | null;
        remoteUrl?: string | null;
        apiBaseUrl?: string | null;
      }) => Promise<{
        project_id?: string;
        scope?: {
          id?: string;
          project_id?: string;
          repo_id?: string;
          repo_kind?: string;
          repo_ref?: string;
          path?: string;
          mode?: string;
          exclude?: string[];
        };
      }>;
      openExternalUrl: (href: string) => Promise<{ ok: boolean }>;
      submitFeedback: (request: {
        message: string;
        email: string;
        locale?: string;
        screenshot?: {
          bytes: ArrayBuffer;
          mimeType: "image/jpeg" | "image/png" | "image/webp";
        };
      }) => Promise<{ ok: true }>;
      markdownWebEmbed: {
        create: (request: {
          href: string;
          bounds?: { x: number; y: number; width: number; height: number };
          capability: {
            editorViewId: string;
            workspaceId: string;
            documentPath: string;
            documentRevision: string;
            purpose: "web-embed";
            executionSessionId?: string;
          };
        }) => Promise<{ id: string; href?: string; visible?: boolean }>;
        setBounds: (request: {
          id: string;
          bounds: { x: number; y: number; width: number; height: number };
        }) => Promise<{ ok?: boolean; visible?: boolean } | void>;
        destroy: (request: { id: string }) => Promise<{ ok?: boolean } | void>;
      };
      editorSurfaces: {
        activate: (request: {
          viewerId: string;
          documentPath: string;
          documentRevision?: string | null;
          resourceUrl: string;
          title: string;
          safeMode?: boolean;
          bounds: EditorSurfaceBounds;
          geometryRevision: number;
          visible: boolean;
          appearance: EditorSurfaceAppearance;
        }) => Promise<{
          sessionId: string;
          viewerId: string;
          safeMode: boolean;
          processId: number | null;
          status: EditorSurfaceState["status"];
        }>;
        setBounds: (request: {
          sessionId: string;
          bounds: EditorSurfaceBounds;
          geometryRevision: number;
          visible: boolean;
        }) => Promise<{ ok: boolean; applied?: boolean; geometryRevision?: number }>;
        updateAppearance: (request: {
          sessionId: string;
          appearance: EditorSurfaceAppearance;
        }) => Promise<{ ok: boolean }>;
        destroy: (request: { sessionId: string }) => Promise<{ ok: boolean }>;
        onState: (callback: (state: EditorSurfaceState) => void) => () => void;
      };
      getInitialWorkspace: () => Promise<LastWorkspaceResult>;
      getLastWorkspace: () => Promise<LastWorkspaceResult>;
      getRecentWorkspaces: () => Promise<RecentWorkspacesResult>;
      hydrateRecentWorkspaces: () => Promise<RecentWorkspacesResult>;
      projectAppearance: {
        list: (request: { projectIdentities: string[] }) => Promise<ProjectAppearance[]>;
        chooseIcon: (request: {
          projectIdentity: string;
        }) => Promise<ProjectIconSelectionResult>;
        resetIcon: (request: { projectIdentity: string }) => Promise<ProjectAppearance>;
        setEmoji: (request: {
          projectIdentity: string;
          emoji: string;
        }) => Promise<ProjectAppearance>;
        onChanged: (callback: (appearance: ProjectAppearance) => void) => () => void;
      };
      removeRecentWorkspace: (folderPath: string) => Promise<{
        ok: true;
        removed: true;
        path: string;
      }>;
      forgetLastWorkspace: () => Promise<void>;
      showHomepage: () => Promise<{ ok: boolean }>;
      readProjectSessions: () => Promise<import("../../shared/project-session-contract/types").ProjectSessionSnapshot>;
      onWorkspaceOpenRequested: (callback: (request: { rootPath: string }) => void) => () => void;
      onProjectSessionsChanged: (callback: (snapshot: import("../../shared/project-session-contract/types").ProjectSessionSnapshot) => void) => () => void;
      openWorkspaceInCurrentWindow: (folderPath: string) => Promise<WorkspaceOpenResult>;
      openWorkspaceInNewWindow: (folderPath: string) => Promise<WorkspaceOpenResult>;
      openDroppedWorkspaceInCurrentWindow: (folder: File) => Promise<WorkspaceOpenResult>;
      selectFolder: () => Promise<WorkspaceOpenResult | null>;
      selectFolderToAttach: () => Promise<WorkspaceAttachResult | null>;
      attachFolder: (folderPath: string) => Promise<WorkspaceAttachResult>;
      detachFolder: (folderPath: string) => Promise<WorkspaceDetachResult>;
      selectFolderInNewWindow: () => Promise<WorkspaceOpenResult | null>;
      selectLocalProjectLocation: () => Promise<WorkspaceProjectLocationGrant | null>;
      createLocalProject: (
        request: WorkspaceCreateProjectRequest,
      ) => Promise<WorkspaceOpenResult | null>;
      cloneRepository: (
        request: WorkspaceCloneRepositoryRequest,
      ) => Promise<WorkspaceOpenResult | null>;
      getPathForFile: (file: File) => string;
      resourceDragSessionSupported: boolean;
      previewResourceDrag: () => Promise<import("../platform/resourceDragSession").ResourceDragPreview | null>;
      claimResourceDrop: (request: {
        files: File[];
        intent: "explorer-move" | "editor-split" | "terminal-path" | "agent-reference";
        targetResource?: string;
        sessionId?: string;
      }) => Promise<{ entries: import("@puppyone/shared-ui").ExplorerReferenceDragEntry[] } | null>;
      onResourceDragState: (listener: (state: import("../platform/resourceDragSession").ResourceDragState) => void) => () => void;
      startResourceDrag: (request: { resources: string[] }) => Promise<boolean>;
      resolveResourceReferences: (request: { resources: string[]; rootPath?: string; sourceWorkspaceId?: string }) => Promise<Array<{
        resourceUri: string;
        folderId: string;
        workspaceRoot: string;
        workspaceName: string;
        relativePath: string;
        absolutePath: string;
        entryType: "file" | "directory";
      }>>;
      stageAgentAttachments: (request: {
        rootPath: string;
        epoch: string;
        files: File[];
      }) => Promise<import("../../shared/agent-contract/types").AgentDraftReference[]>;
      revokeAgentAttachments: (request: {
        rootPath: string;
        tokens: string[];
      }) => Promise<{ revoked: number }>;
      resolveAgentWorkspaceReferences: (request: {
        rootPath: string;
        paths: string[];
      }) => Promise<import("../../shared/agent-contract/types").AgentDraftReference[]>;
      pickAgentWorkspaceReferences: (request: {
        rootPath: string;
      }) => Promise<import("../../shared/agent-contract/types").AgentDraftReference[]>;
      listFolderChildren: (request: {
        rootPath: string;
        folderPath: string | null;
      }) => Promise<DataNode[]>;
      resolveNode: (request: {
        rootPath: string;
        path: string;
      }) => Promise<DataNode>;
      readFile: (request: {
        rootPath: string;
        path: string;
      }) => Promise<FileContent>;
      getFileUrl: (request: {
        rootPath: string;
        path: string;
        purpose?: "file-preview" | "markdown-asset";
        expectedVersion?: string;
      }) => Promise<{ url: string }>;
      revokeFileUrl: (request: { url: string }) => Promise<{ revoked: boolean }>;
      convertOfficeDocumentToDocx: (
        request: WorkspaceConvertOfficeDocumentToDocxRequest,
      ) => Promise<WorkspaceConvertOfficeDocumentToDocxResult>;
      cancelOfficeDocumentToDocxConversion: (
        request: WorkspaceCancelOfficeDocumentToDocxRequest,
      ) => Promise<WorkspaceCancelOfficeDocumentToDocxResult>;
      writeFile: (request: {
        rootPath: string;
        path: string;
        content: string;
        expectedVersion?: string | null;
      }) => Promise<WorkspaceWriteFileResult>;
      createEntry: (request: WorkspaceCreateEntryRequest) => Promise<WorkspaceCreateEntryResult>;
      instantiateTemplate: (
        request: WorkspaceInstantiateTemplateRequest,
      ) => Promise<WorkspaceInstantiateTemplateResult>;
      renameEntry: (request: WorkspaceRenameEntryRequest) => Promise<WorkspaceCreateEntryResult>;
      moveEntry: (request: WorkspaceMoveEntryRequest) => Promise<WorkspaceCreateEntryResult>;
      copyEntry: (request: WorkspaceCopyEntryRequest) => Promise<WorkspaceCreateEntryResult>;
      copyEntryBetweenRoots: (
        request: WorkspaceCopyEntryBetweenRootsRequest,
      ) => Promise<WorkspaceCreateEntryResult>;
      importEntries: (request: WorkspaceImportEntriesRequest) => Promise<WorkspaceImportEntriesResult>;
      deleteEntry: (request: WorkspaceDeleteEntryRequest) => Promise<WorkspaceCreateEntryResult>;
      revealEntryInFinder: (request: WorkspaceRevealEntryRequest) => Promise<{ ok: boolean }>;
      openEntryExternal: (request: WorkspaceOpenEntryExternalRequest) => Promise<{ ok: boolean; cancelled?: boolean }>;
      startAppPreview: (request: {
        rootPath: string;
        path: string;
      }) => Promise<AppPreviewResult>;
      restartAppPreview: (request: {
        rootPath: string;
        path: string;
      }) => Promise<AppPreviewResult>;
      stopAppPreview: (request: {
        rootPath: string;
        path: string;
      }) => Promise<AppPreviewResult>;
      getAppPreviewLogs: (request: {
        rootPath: string;
        path: string;
      }) => Promise<string>;
      openAppPreviewExternal: (request: {
        rootPath: string;
        path: string;
      }) => Promise<{ ok: boolean }>;
      onAppPreviewRuntimeState: (
        callback: (state: AppPreviewResult & { rootPath: string }) => void,
      ) => () => void;
      watchWorkspace: (
        rootPath: string,
        callback: (event: WorkspaceChangedEvent) => void,
      ) => {
        stop: () => void;
        ready: Promise<{ subscriptionId: string | null; rootPath: string }>;
      };
      startGitRepositoryWatch: (request: {
        rootPath: string;
      }) => Promise<GitRepositoryWatchResult>;
      stopGitRepositoryWatch: (request: {
        subscriptionId: string;
      }) => Promise<{ ok: boolean }>;
      onGitRepositoryInvalidated: (
        callback: (event: GitRepositoryInvalidatedEvent) => void,
      ) => () => void;
      onGitRepositoryWindowFocus?: (
        callback: (event: GitRepositoryWindowFocusEvent) => void,
      ) => () => void;
      getLatestAiEditReviewRequest: (request: {
        rootPath: string;
      }) => Promise<AiEditRequest | null>;
      onAiEditReviewUpdated: (
        callback: (event: AiEditReviewUpdatedEvent) => void,
      ) => () => void;
      getGitStatus: (request: {
        rootPath: string;
        requestId?: string;
      }) => Promise<GitStatusSnapshot>;
      cancelGitStatus?: (request: {
        requestId: string;
      }) => Promise<{ ok: boolean }>;
      getGitBranchGraph?: (request: {
        rootPath: string;
        requestId?: string;
      }) => Promise<GitBranchGraphSnapshot>;
      cancelGitBranchGraph?: (request: {
        requestId: string;
      }) => Promise<{ ok: boolean }>;
      initGitRepository: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      removeGitRemote: (request: {
        rootPath: string;
        remoteName?: string;
      }) => Promise<GitStatusSnapshot>;
      readPuppyoneConfig: (request: {
        rootPath: string;
      }) => Promise<PuppyoneWorkspaceConfig>;
      writePuppyoneConfig: (request: {
        rootPath: string;
        config: PuppyoneWorkspaceConfig;
      }) => Promise<PuppyoneWorkspaceConfig>;
      getGitCommitDetail: (request: {
        rootPath: string;
        commitId: string;
      }) => Promise<GitCommitDetail>;
      getGitFileDiff: (request: {
        rootPath: string;
        path: string;
        scope: GitWorkingDiffScope;
        requestId?: string;
        sessionId?: string;
      }) => Promise<GitCommitDetail>;
      cancelGitFileDiff?: (request: {
        requestId: string;
        sessionId: string;
      }) => Promise<{ ok: boolean }>;
      readGitDiffResource: (request: {
        handle: string;
        sessionId: string;
        selectionIdentity: string;
        revisionIdentity: string;
        offset: number;
        length: number;
      }) => Promise<{
        bytes: Uint8Array;
        offset: number;
        size: number;
        done: boolean;
        selectionIdentity: string;
        revisionIdentity: string;
      }>;
      releaseGitDiffResources: (request: {
        sessionId: string;
      }) => Promise<{ ok: boolean }>;
      stageGitPaths: (request: {
        rootPath: string;
        paths: string[];
      }) => Promise<GitStatusSnapshot>;
      stageAllGitChanges: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      unstageGitPaths: (request: {
        rootPath: string;
        paths: string[];
      }) => Promise<GitStatusSnapshot>;
      unstageAllGitChanges: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      discardGitPaths: (request: {
        rootPath: string;
        paths: string[];
      }) => Promise<GitStatusSnapshot>;
      discardAllGitChanges: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      commitGit: (request: {
        rootPath: string;
        message: string;
        allowEmpty?: boolean;
        authorName?: string;
        authorEmail?: string;
      }) => Promise<GitStatusSnapshot>;
      continueGitOperation: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      abortGitOperation: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      checkoutGitBranch: (request: {
        rootPath: string;
        branchName: string;
        remote: boolean;
      }) => Promise<GitStatusSnapshot>;
      stashAndCheckoutGitBranch: (request: {
        rootPath: string;
        branchName: string;
        remote: boolean;
      }) => Promise<GitStatusSnapshot>;
      commitAndCheckoutGitBranch: (request: {
        rootPath: string;
        branchName: string;
        remote: boolean;
      }) => Promise<GitStatusSnapshot>;
      createGitBranch: (request: {
        rootPath: string;
        branchName: string;
      }) => Promise<GitStatusSnapshot>;
      fetchGit: (request: {
        rootPath: string;
        remoteName?: string;
      }) => Promise<GitStatusSnapshot>;
      pullGit: (request: {
        rootPath: string;
        showNativeErrorDialog?: boolean;
      }) => Promise<GitStatusSnapshot>;
      pushGit: (request: {
        rootPath: string;
        showNativeErrorDialog?: boolean;
      }) => Promise<GitStatusSnapshot>;
      pushGitCommitToRemote: (request: {
        rootPath: string;
        remoteName: string;
        destinationBranch: string;
        expectedHeadCommitId: string;
        expectedBranch: string;
      }) => Promise<GitStatusSnapshot>;
      publishGitBranch: (request: {
        rootPath: string;
        remoteName?: string | null;
      }) => Promise<GitStatusSnapshot>;
      syncGit: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      getUpdateState: () => Promise<DesktopUpdateState>;
      checkForUpdates: () => Promise<DesktopUpdateState>;
      downloadUpdate: () => Promise<DesktopUpdateState>;
      updateNow: () => Promise<DesktopUpdateState>;
      installUpdate: () => Promise<DesktopUpdateState>;
      onUpdateStateChanged: (
        callback: (state: DesktopUpdateState) => void,
      ) => () => void;
      discoverAgentProviders: (request?: AgentRuntimeRequest) => Promise<AgentProviderInspection>;
      discoverLocalAgentConnections: (request?: AgentLocalConnectionsRequest) => Promise<AgentLocalConnectionsSnapshot>;
      listAgentModels: (request?: AgentModelsListRequest) => Promise<AgentModel[]>;
      readAgentAccount: (request?: AgentAccountReadRequest) => Promise<AgentAccountState | null>;
      createAgentSession: (request: AgentSessionCreateRequest) => Promise<AgentSessionSnapshot>;
      resumeAgentSession: (request: AgentSessionResumeRequest) => Promise<AgentSessionSnapshot | null>;
      openAgentSession: (request: AgentSessionOpenRequest) => Promise<AgentSessionOpenResult>;
      replayAgentSession: (request: AgentReplayRequest) => Promise<AgentSessionSnapshot>;
      attachAgentSession: (request: AgentSessionAttachRequest) => Promise<AgentSessionFeedReceipt>;
      acknowledgeAgentSession: (request: AgentSessionFeedAckRequest) => Promise<{ subscriptionId: string; streamId: string; revision: number; synchronized: boolean }>;
      readAgentSessionWatermark: (request: AgentSessionDetachRequest) => Promise<{ subscriptionId: string; streamId: string; revision: number; acknowledgedRevision: number; resyncRequired: boolean }>;
      detachAgentSession: (request: AgentSessionDetachRequest) => Promise<{ subscriptionId: string; detached: boolean }>;
      listAgentSessions: (request: AgentSessionsListRequest) => Promise<AgentSessionsListResponse>;
      forkAgentSession: (request: AgentSessionMutationRequest) => Promise<AgentSessionSnapshot>;
      archiveAgentSession: (request: AgentSessionMutationRequest) => Promise<{ sessionId: string; archived: boolean }>;
      deleteAgentSession: (request: AgentSessionMutationRequest) => Promise<{ sessionId: string; deleted: boolean; nativeDeleted: boolean }>;
      closeAgentSession: (request: AgentSessionCloseRequest) => Promise<{ sessionId: string; closed: boolean }>;
      startAgentTurn: (request: AgentTurnStartRequest) => Promise<{ sessionId: string; turnId: string }>;
      steerAgentTurn: (request: AgentTurnSteerRequest) => Promise<{
        sessionId: string;
        turnId: string;
        steered: boolean;
      }>;
      interruptAgentTurn: (request: AgentTurnInterruptRequest) => Promise<{
        sessionId: string;
        turnId: string;
        interruptRequested: boolean;
      }>;
      compactAgentSession: (request: { rootPath: string; sessionId: string }) => Promise<{ sessionId: string; compacted: boolean }>;
      resolveAgentApproval: (request: AgentApprovalResolution) => Promise<{
        sessionId: string;
        requestId: string;
        decision: AgentApprovalResolution["decision"];
      }>;
      resolveAgentQuestion: (request: AgentQuestionResolution) => Promise<{
        sessionId: string;
        requestId: string;
      }>;
      onAgentSessionFrame: (callback: (frame: AgentSessionFrame) => void) => () => void;
      viewerPacks?: {
        getSnapshot: () => Promise<import("@puppyone/shared-ui").ViewerPackSnapshot>;
        installLocal: () => Promise<
          | { canceled: true }
          | { canceled: false; pluginId: string; version: string; contentHash: string }
        >;
        disable: (request: { pluginId: string }) => Promise<{ ok: boolean; reason?: string }>;
        uninstall: (request: { pluginId: string }) => Promise<{ ok: boolean; canceled?: boolean }>;
        activate: (request: {
          pluginId: string;
          rootPath: string;
          relativePath: string;
          bounds?: { x: number; y: number; width: number; height: number };
        }) => Promise<import("@puppyone/shared-ui").ViewerPackSessionDescriptor>;
        setBounds: (request: {
          sessionId: string;
          bounds: { x: number; y: number; width: number; height: number };
        }) => Promise<{ ok: boolean }>;
        destroySession: (request: { sessionId: string }) => Promise<{ ok: boolean }>;
        onSessionState: (callback: (payload: {
          sessionId: string;
          state: {
            status: "loading" | "ready" | "error";
            message?: string;
            progress?: number;
          };
        }) => void) => () => void;
      };
      locateTerminalAgents: (request: {
        refresh?: boolean;
        requestId: string;
      }) => Promise<TerminalAgentLocationSnapshot>;
      onTerminalAgentLocationProgress: (
        callback: (event: TerminalAgentLocationProgressEvent) => void,
      ) => () => void;
      createTerminal: (request: TerminalCreateRequest) => Promise<TerminalCreateResult | import("../../shared/project-session-contract/types").ProjectSessionFailure>;
      writeTerminal: (request: TerminalInputRequest) => void;
      resizeTerminal: (request: TerminalResizeRequest) => void;
      updateTerminalAppearance: (request: TerminalAppearanceRequest) => void;
      closeTerminal: (request: string | { id: string; instanceId?: string; projectContext?: import("../../shared/project-session-contract/types").ProjectSessionContext }) => Promise<boolean | import("../../shared/project-session-contract/types").ProjectSessionFailure>;
      onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void;
      onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void;
      subscribeAgentActivity: () => Promise<AgentActivitySnapshot>;
      unsubscribeAgentActivity: () => void;
      onAgentActivityEvent: (callback: (event: AgentActivityEvent) => void) => () => void;
      getAgentActivityEnrollment: () => Promise<AgentActivityEnrollmentSnapshot>;
      setAgentActivityEnrollment: (request: {
        providerId: string;
        enabled: boolean;
      }) => Promise<{ enrollment: string; reason?: string }>;
    };
  }
}

export {};
