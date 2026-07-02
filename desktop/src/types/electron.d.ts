import type { AiEditRequest, DataNode, FileContent, Workspace } from "@puppyone/shared-ui";

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

export type GitFileDiff = GitCommitChange & {
  binary: boolean;
  lines: GitDiffLine[];
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
};

export type GitRemoteSummary = {
  name: string;
  fetchUrl: string | null;
  pushUrl: string | null;
  branches: string[];
};

export type GitSyncTargetSummary = {
  remote: string | null;
  branch: string | null;
  ref: string | null;
  exists: boolean;
  ahead: number;
  behind: number;
  incomingPreview: GitSourceControlResource[];
  outgoingPreview: GitSourceControlResource[];
};

export type GitSourceControlRemoteSummary = {
  target: GitSyncTargetSummary | null;
  currentBranch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
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

export type GitSourceControlSnapshot = {
  input: {
    placeholder: string;
    defaultMessage: string;
  };
  groups: GitSourceControlResourceGroup[];
  remote: GitSourceControlRemoteSummary;
  actions: {
    canStageAll: boolean;
    canUnstageAll: boolean;
    canDiscardAll: boolean;
    canCommit: boolean;
  };
};

export type GitWorkingDiffScope = "staged" | "unstaged" | "untracked" | "remote" | "committed";

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
  sourceControl: GitSourceControlSnapshot;
  commits: GitCommitSummary[];
  allCommits: GitCommitSummary[];
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
  id: string;
  cwd: string;
  cols: number;
  rows: number;
};

export type TerminalCreateResult = {
  id: string;
  pid: number | null;
  shell: string;
  cwd: string;
};

export type TerminalInputRequest = {
  id: string;
  data: string;
};

export type TerminalResizeRequest = {
  id: string;
  cols: number;
  rows: number;
};

export type TerminalDataEvent = {
  id: string;
  data: string;
};

export type TerminalExitEvent = {
  id: string;
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
  channel: "stable" | "beta" | "internal";
  availableVersion: string | null;
  updateInfo: DesktopUpdateInfo;
  progress: DesktopUpdateProgress;
  blockers: DesktopUpdateBlocker[];
  error: string | null;
  reason: string | null;
  lastCheckedAt: string | null;
  updatedAt: string;
};

export type WorkspaceChangedEvent = {
  rootPath: string;
  eventType: string;
  path: string | null;
  error?: string;
};

export type AiEditReviewUpdatedEvent = {
  rootPath: string;
  request: AiEditRequest;
};

export type LastWorkspaceResult = {
  path: string | null;
  workspace: Workspace | null;
  error: string | null;
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

export type WorkspaceDeleteEntryRequest = {
  rootPath: string;
  path: string;
};

export type DesktopStoredCloudSession = {
  expires_in?: number;
  expires_at?: number;
  user_email: string;
  api_base_url?: string;
};

export type PuppyoneBackendService = "puppyone" | "github" | "custom";

export type PuppyoneWorkspaceConfig = {
  version: 1;
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
  cloud: {
    projectId: string | null;
  };
  updatedAt?: string;
};

declare global {
  interface Window {
    puppyoneDesktop?: {
      readCloudSession: () => Promise<DesktopStoredCloudSession | null>;
      restoreCloudSession: (request: {
        apiBaseUrl?: string | null;
      }) => Promise<DesktopStoredCloudSession | null>;
      signInCloudSessionWithPassword: (request: {
        apiBaseUrl: string;
        email: string;
        password: string;
      }) => Promise<DesktopStoredCloudSession>;
      startCloudOAuth: (request: {
        apiBaseUrl: string;
        provider: "google" | "github";
      }) => Promise<{ ok: boolean }>;
      clearCloudSession: () => Promise<void>;
      onCloudSessionChanged: (
        callback: (session: DesktopStoredCloudSession | null) => void,
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
      }) => Promise<unknown>;
      requestCloudSessionApi: (request: {
        apiBaseUrl: string;
        path: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      }) => Promise<unknown>;
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
      getLastWorkspace: () => Promise<LastWorkspaceResult>;
      rememberLastWorkspace: (folderPath: string) => Promise<void>;
      forgetLastWorkspace: () => Promise<void>;
      selectFolder: () => Promise<Workspace | null>;
      workspaceFromPath: (folderPath: string) => Promise<Workspace>;
      getPathForFile: (file: File) => string;
      listFolderChildren: (request: {
        rootPath: string;
        folderPath: string | null;
      }) => Promise<DataNode[]>;
      readFile: (request: {
        rootPath: string;
        path: string;
      }) => Promise<FileContent>;
      writeFile: (request: {
        rootPath: string;
        path: string;
        content: string;
      }) => Promise<void>;
      createEntry: (request: WorkspaceCreateEntryRequest) => Promise<WorkspaceCreateEntryResult>;
      renameEntry: (request: WorkspaceRenameEntryRequest) => Promise<WorkspaceCreateEntryResult>;
      moveEntry: (request: WorkspaceMoveEntryRequest) => Promise<WorkspaceCreateEntryResult>;
      deleteEntry: (request: WorkspaceDeleteEntryRequest) => Promise<WorkspaceCreateEntryResult>;
      watchWorkspace: (
        rootPath: string,
        callback: (event: WorkspaceChangedEvent) => void,
      ) => () => void;
      getLatestAiEditReviewRequest: (request: {
        rootPath: string;
      }) => Promise<AiEditRequest | null>;
      onAiEditReviewUpdated: (
        callback: (event: AiEditReviewUpdatedEvent) => void,
      ) => () => void;
      getGitStatus: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      getGitBranchGraph?: (request: {
        rootPath: string;
      }) => Promise<GitBranchGraphSnapshot>;
      initGitRepository: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      configureGitCloudRemote: (request: {
        rootPath: string;
        remoteUrl: string;
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
      }) => Promise<GitCommitDetail>;
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
      }) => Promise<GitStatusSnapshot>;
      pullGit: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      pushGit: (request: {
        rootPath: string;
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
      createTerminal: (request: TerminalCreateRequest) => Promise<TerminalCreateResult>;
      writeTerminal: (request: TerminalInputRequest) => void;
      resizeTerminal: (request: TerminalResizeRequest) => void;
      closeTerminal: (id: string) => Promise<void>;
      onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void;
      onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void;
    };
  }
}

export {};
