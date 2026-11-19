import type {
  GitBranchSummary,
  GitSourceControlRemoteSummary,
  GitSourceControlResource,
  GitSourceControlResourceStatus,
  GitStatusSnapshot,
} from "../../types/electron";

/** One file a receipt covers, selectable for review in the existing diff surface. */
export type IncomingChangeFile = {
  path: string;
  status: GitSourceControlResourceStatus;
  letter: string;
  staged: false;
  origin: "remote";
};

export type IncomingChangeReceipt = {
  /**
   * Identity of one pending review. The commit the tracking ref points at is
   * what the user decided about, so later work produces a new receipt instead
   * of silently reusing an answer that was given about something else.
   */
  id: string;
  /** Who made the changes, as the local Git facts know them. */
  source: string | null;
  /** When the newest incoming change was made. */
  changedAt: string | null;
  /** How many files this receipt would change on this Mac. */
  changeCount: number;
  files: IncomingChangeFile[];
  /** Files beyond the preview the status snapshot carries. */
  additionalFiles: number;
  /** The user has saved work of their own that others cannot see yet. */
  localWorkWaiting: boolean;
  /** Applying is blocked until the files that need a decision are settled. */
  blocked: boolean;
  canApply: boolean;
};

/**
 * A receipt is a projection of local Git facts, never a second copy of them.
 * The pending state therefore survives a restart for free: the fetched commits
 * stay in the repository until the user applies them, and the only thing worth
 * persisting is the user's decision.
 */
export function getIncomingChangeReceipt(status: GitStatusSnapshot | null): IncomingChangeReceipt | null {
  const remote = getPendingRemote(status);
  if (!status || !remote) return null;
  const { ref, tip } = findIncomingTip(status, remote);
  const files = remote.incomingPreview.filter((resource) => resource.path).map(toIncomingFile);
  const reportedFiles = remote.incomingFileSummary?.total ?? files.length;
  const blocked = hasFilesNeedingDecision(status);

  return {
    id: `${ref}@${tip?.lastCommitId ?? `behind-${remote.behind}`}`,
    source: tip?.lastCommitAuthorName ?? null,
    changedAt: tip?.lastCommitDate ?? null,
    changeCount: Math.max(reportedFiles, files.length),
    files,
    additionalFiles: Math.max(0, reportedFiles - files.length),
    localWorkWaiting: remote.ahead > 0,
    blocked,
    canApply: remote.canPull && !blocked,
  };
}

/** Only an actual backlog of changes made elsewhere produces a receipt. */
function getPendingRemote(status: GitStatusSnapshot | null): GitSourceControlRemoteSummary | null {
  if (!status?.isRepo) return null;
  const remote = status.sourceControl.remote;
  if (remote.behind <= 0) return null;
  return remote.state === "incoming" || remote.state === "diverged" ? remote : null;
}

function findIncomingTip(status: GitStatusSnapshot, remote: GitSourceControlRemoteSummary): {
  ref: string;
  tip: GitBranchSummary | null;
} {
  const ref = remote.target?.ref ?? remote.upstream ?? status.effectiveHosting.ref ?? "";
  return {
    ref,
    tip: status.branches.find((branch) => branch.remote && branch.name === ref) ?? null,
  };
}

function toIncomingFile(resource: GitSourceControlResource): IncomingChangeFile {
  return {
    path: resource.path,
    status: resource.status,
    letter: resource.letter,
    staged: false,
    origin: "remote",
  };
}

/**
 * A repository operation in progress, or files Git marked for a decision, mean
 * the working tree is mid-change. Applying more on top would be the silent
 * rewrite this surface exists to prevent.
 */
function hasFilesNeedingDecision(status: GitStatusSnapshot): boolean {
  if (status.sourceControl.operation) return true;
  return status.sourceControl.groups.some(
    (group) => group.id === "merge" && group.resources.length > 0,
  );
}
