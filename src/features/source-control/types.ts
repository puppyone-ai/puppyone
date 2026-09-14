import type {
  GitRepositoryOperationState,
  GitSourceControlResource,
  GitSourceControlResourceStatus,
} from "../../types/electron";

export type GitWorkingSelection = {
  path: string;
  status: GitSourceControlResourceStatus;
  staged: boolean;
  origin?: "local" | "remote" | "committed";
};

export type GitHostingMode = "github" | "puppyone-cloud" | "generic-git";

export type GitActionIconKind = "check" | "download" | "upload" | "plus";

export type GitSidebarPrimaryActionKind = "commit" | "commit-push" | "continue" | "push" | "publish";

export type GitSidebarPrimaryAction = {
  label: string;
  title: string;
  disabled: boolean;
  kind: GitSidebarPrimaryActionKind;
  loadingKey: string;
  loadingLabel: string;
  icon: GitActionIconKind;
};

export type GitSyncState = {
  branchLabel: string;
  upstreamLabel: string;
  remoteExists: boolean;
  setupRequired: boolean;
  setupTitle: string;
  setupDetail: string;
  behind: number;
  ahead: number;
  pullDetail: string;
  pullDisabled: boolean;
  pushDisabled: boolean;
  pullLabel: string;
  pullTitle: string;
  pushTitle: string;
  pushLabel: string;
  pushDetail: string;
};

export type SourceControlDisplayMode = "simple" | "professional";

export type SourceControlSidebarModel = {
  professionalMode: boolean;
  repositoryOperation: GitRepositoryOperationState | null;
  hasConflicts: boolean;
  mergeResources: GitSourceControlResource[];
  stagedResources: GitSourceControlResource[];
  workingResources: GitSourceControlResource[];
  localChangeResources: GitSourceControlResource[];
  committedCount: number;
  committedResources: GitSourceControlResource[];
  committedPrimaryAction: GitSidebarPrimaryAction | null;
  operationPrimaryAction: GitSidebarPrimaryAction | null;
  showCommittedSection: boolean;
  showStagedSection: boolean;
  showUnstagedSection: boolean;
  showCleanSection: boolean;
  stagedPrimaryAction: GitSidebarPrimaryAction | null;
  showStageAndCommitAction: boolean;
  sectionContext: {
    merge: string;
    committed: string;
    staged: string;
    unstaged: string;
  };
};
