import type { GitSourceControlResource, GitStatusSnapshot } from "../../../src/types/electron";

export function gitResource(path: string, status: GitSourceControlResource["status"] = "modified"): GitSourceControlResource {
  return { id: `workingTree:${path}`, group: "workingTree", path, oldPath: null, status, staged: false, conflict: false, letter: status[0].toUpperCase() };
}

/** A complete clean local repository; tests override the state they exercise. */
export function gitStatus(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    isRepo: true, branch: "main", headCommitId: "fixture-head", totalCommits: 1,
    entries: [], stagedEntries: [], unstagedEntries: [], untrackedEntries: [], branches: [], remotes: [],
    syncTarget: null,
    effectiveHosting: { kind: "local-only", remoteName: null, branchName: "main", ref: null, ready: false, reason: "local-only", identity: null },
    sourceControl: {
      input: { placeholder: "", defaultMessage: "" }, groups: [],
      remote: { target: null, currentBranch: "main", upstream: null, ahead: 0, behind: 0,
        incomingPreview: [], outgoingPreview: [], canPull: false, canPush: false, canSync: false, canPublish: false, state: "no-remote" },
      actions: { canStageAll: false, canUnstageAll: false, canDiscardAll: false, canCommit: false },
    },
    commits: [], allCommits: [], statusLimit: 10_000, didHitStatusLimit: false,
    ...overrides,
  };
}
