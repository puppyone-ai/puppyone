import path from "node:path";
import { normalizeRelativePath } from "../files/path-policy.mjs";

const GIT_RESOURCE_GROUPS = Object.freeze([
  { id: "merge", label: "Merge Changes" },
  { id: "index", label: "Staged Changes" },
  { id: "workingTree", label: "Changes" },
  { id: "untracked", label: "Untracked Changes" },
]);

export function buildGitSourceControlSnapshot({
  entries,
  branchName,
  syncTarget,
  currentBranch,
  headCommitId,
  repositoryOperation = null,
}) {
  const resourcesByGroup = new Map(GIT_RESOURCE_GROUPS.map((group) => [group.id, []]));

  for (const entry of entries) {
    for (const resource of buildGitSourceControlResourcesForEntry(entry)) {
      resourcesByGroup.get(resource.group)?.push(resource);
    }
  }

  const groups = GIT_RESOURCE_GROUPS
    .map((group) => ({
      ...group,
      resources: resourcesByGroup.get(group.id) ?? [],
    }))
    .filter((group) => group.resources.length > 0 || group.id === "index" || group.id === "workingTree");
  const stagedCount = resourcesByGroup.get("index")?.length ?? 0;
  const workingCount = (resourcesByGroup.get("workingTree")?.length ?? 0) + (resourcesByGroup.get("untracked")?.length ?? 0);
  const mergeCount = resourcesByGroup.get("merge")?.length ?? 0;
  const operation = repositoryOperation ? {
    kind: repositoryOperation,
    canContinue: mergeCount === 0,
    canAbort: true,
  } : null;

  return {
    input: {
      placeholder: branchName && branchName !== "detached"
        ? `Message (⌘↩ to commit on ${branchName})`
        : "Message (⌘↩ to commit)",
      defaultMessage: buildDefaultCommitMessageFromResources(resourcesByGroup.get("index") ?? []),
    },
    groups,
    operation,
    remote: buildGitSourceControlRemoteSummary({
      branchName,
      syncTarget,
      currentBranch,
      headCommitId,
      operationInProgress: Boolean(operation),
    }),
    actions: {
      canStageAll: workingCount > 0 || mergeCount > 0,
      canUnstageAll: stagedCount > 0,
      canDiscardAll: workingCount > 0 || mergeCount > 0,
      canCommit: stagedCount > 0 && mergeCount === 0 && !operation,
      canContinue: operation?.canContinue === true,
      canAbort: operation?.canAbort === true,
    },
  };
}

export function getDiscardableResources(sourceControl) {
  return (sourceControl?.groups ?? [])
    .filter((group) => group.id === "workingTree" || group.id === "untracked" || group.id === "merge")
    .flatMap((group) => group.resources);
}

export function getResourceGitPaths(resource) {
  return resource.oldPath && resource.oldPath !== resource.path
    ? [resource.oldPath, resource.path]
    : [resource.path];
}

export function uniqueGitPaths(paths) {
  return [...new Set(paths.map((value) => normalizeRelativePath(value)).filter(Boolean))];
}

export function gitStatusLabelToLetter(status) {
  if (status === "untracked") return "U";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "renamed") return "R";
  if (status === "copied") return "C";
  if (status === "conflict") return "!";
  return "M";
}

export function hasStagedStatus(entry) {
  return Boolean(entry.staged && entry.staged !== "?" && entry.staged !== ".");
}

export function hasUnstagedStatus(entry) {
  return entry.status !== "untracked" && Boolean(entry.unstaged && entry.unstaged !== "?" && entry.unstaged !== ".");
}

function buildGitSourceControlResourcesForEntry(entry) {
  if (entry.conflict || entry.status === "conflict" || isConflictStatus(entry.staged, entry.unstaged)) {
    return [buildGitSourceControlResource(entry, "merge", "conflict")];
  }

  const resources = [];
  if (entry.status === "untracked") {
    resources.push(buildGitSourceControlResource(entry, "untracked", "untracked"));
    return resources;
  }

  const stagedStatus = gitStatusCodeToLabel(entry.staged);
  if (stagedStatus) {
    resources.push(buildGitSourceControlResource(entry, "index", stagedStatus));
  }

  const unstagedStatus = gitStatusCodeToLabel(entry.unstaged);
  if (unstagedStatus) {
    resources.push(buildGitSourceControlResource(entry, "workingTree", unstagedStatus));
  }

  return resources;
}

function buildGitSourceControlResource(entry, group, status) {
  return {
    id: `${group}:${entry.oldPath ?? ""}:${entry.path}:${status}`,
    group,
    path: entry.path,
    oldPath: entry.oldPath ?? null,
    status,
    staged: group === "index",
    conflict: group === "merge",
    letter: gitStatusLabelToLetter(status),
  };
}

function buildGitSourceControlRemoteSummary({
  branchName,
  syncTarget,
  currentBranch,
  headCommitId,
  operationInProgress,
}) {
  const ahead = syncTarget?.ahead ?? currentBranch?.ahead ?? 0;
  const behind = syncTarget?.behind ?? currentBranch?.behind ?? 0;
  const hasBranch = Boolean(branchName && branchName !== "detached");
  const hasTarget = Boolean(syncTarget?.remote && syncTarget?.branch);
  const remoteExists = syncTarget?.exists === true;
  const upstream = syncTarget?.ref ?? currentBranch?.upstream ?? null;
  const canPublish = !operationInProgress && hasBranch && hasTarget && !remoteExists && Boolean(headCommitId);
  const canPull = !operationInProgress && remoteExists && behind > 0;
  const canPush = !operationInProgress && remoteExists && ahead > 0 && behind === 0;
  const canSync = !operationInProgress && (canPublish || (remoteExists && (ahead > 0 || behind > 0)));

  let state = "synced";
  if (branchName == null && !headCommitId && !syncTarget) {
    state = "no-repository";
  } else if (!hasBranch) {
    state = "no-branch";
  } else if (!hasTarget) {
    state = "no-remote";
  } else if (!remoteExists) {
    state = "publish";
  } else if (ahead > 0 && behind > 0) {
    state = "diverged";
  } else if (behind > 0) {
    state = "incoming";
  } else if (ahead > 0) {
    state = "outgoing";
  }

  return {
    target: syncTarget,
    currentBranch: branchName ?? null,
    upstream,
    ahead,
    behind,
    incomingFileSummary: syncTarget?.incomingFileSummary ?? {
      total: 0,
      added: 0,
      modified: 0,
      deleted: 0,
      renamed: 0,
      copied: 0,
      changed: 0,
    },
    incomingPreview: syncTarget?.incomingPreview ?? [],
    outgoingPreview: syncTarget?.outgoingPreview ?? [],
    canPull,
    canPush,
    canSync,
    canPublish,
    state,
  };
}

function buildDefaultCommitMessageFromResources(resources) {
  if (resources.length === 1) {
    return `Update ${path.basename(resources[0].path) || resources[0].path}`;
  }
  if (resources.length > 1) return `Update ${resources.length} files`;
  return "Update workspace";
}

function isConflictStatus(staged, unstaged) {
  const code = `${staged ?? " "}${unstaged ?? " "}`;
  return code.includes("U") || ["DD", "AA"].includes(code);
}

function gitStatusCodeToLabel(code) {
  if (!code || code === " " || code === "." || code === "?") return null;
  if (code === "M") return "modified";
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "C") return "copied";
  if (code === "U") return "conflict";
  return "changed";
}
