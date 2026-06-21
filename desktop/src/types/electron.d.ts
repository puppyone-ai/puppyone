import type { DataNode, FileContent, Workspace } from "@puppyone/shared-ui";

export type GitStatusEntry = {
  path: string;
  oldPath: string | null;
  staged: string | null;
  unstaged: string | null;
  status: string;
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

export type GitWorkingDiffScope = "staged" | "unstaged" | "untracked";

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

export type WorkspaceChangedEvent = {
  rootPath: string;
  eventType: string;
  path: string | null;
  error?: string;
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

export type WorkspaceDeleteEntryRequest = {
  rootPath: string;
  path: string;
};

declare global {
  interface Window {
    puppyoneDesktop?: {
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
      deleteEntry: (request: WorkspaceDeleteEntryRequest) => Promise<WorkspaceCreateEntryResult>;
      watchWorkspace: (
        rootPath: string,
        callback: (event: WorkspaceChangedEvent) => void,
      ) => () => void;
      getGitStatus: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
      initGitRepository: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
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
      unstageGitPaths: (request: {
        rootPath: string;
        paths: string[];
      }) => Promise<GitStatusSnapshot>;
      discardGitPaths: (request: {
        rootPath: string;
        paths: string[];
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
