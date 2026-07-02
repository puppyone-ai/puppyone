import type { GitSourceControlResource } from "../../types/electron";

export type GitWorkingSelection = {
  path: string;
  status: string;
  staged: boolean;
  origin?: "local" | "remote" | "committed";
};

export type GitMainPanel = "changes" | "history";

export type GitActionIconKind = "download" | "upload" | "plus";

export type GitSidebarPrimaryActionKind = "commit" | "commit-push" | "push" | "publish";

export type GitSidebarPrimaryAction = {
  label: string;
  title: string;
  disabled: boolean;
  kind: GitSidebarPrimaryActionKind;
  loadingKey: string;
  loadingLabel: string;
  icon: GitActionIconKind;
};

export type GitScmSyncAction = {
  kind: "pull" | "push" | "publish";
  label: string;
  loadingLabel: string;
  title: string;
  disabled: boolean;
  icon: GitActionIconKind;
};

export type GitScmSyncCopy = {
  title: string;
  count: number;
  detail: string;
  tone: "ready" | "pending" | "warning" | "muted";
};

export type GitScmSyncSection = {
  copy: GitScmSyncCopy;
  action: GitScmSyncAction | null;
  previewResources: GitSourceControlResource[];
  fallbackSummary: string | null;
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
  mergeResources: GitSourceControlResource[];
  stagedResources: GitSourceControlResource[];
  workingResources: GitSourceControlResource[];
  localChangeResources: GitSourceControlResource[];
  committedCount: number;
  committedResources: GitSourceControlResource[];
  committedPrimaryAction: GitSidebarPrimaryAction | null;
  showCommittedSection: boolean;
  stagedPrimaryAction: GitSidebarPrimaryAction | null;
  showSimpleChangeAction: boolean;
};
