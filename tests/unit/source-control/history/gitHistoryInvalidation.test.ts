import { describe, expect, it } from "vitest";
import type { GitCommitSummary, GitStatusSnapshot } from "../src/types/electron";
import {
  createRepositoryRefreshReason,
  mergePreservedHistory,
  shouldInvalidateHistoryForReason,
} from "../../../../src/features/source-control/repositoryRefreshPolicy";

const sampleCommit: GitCommitSummary = {
  commit_id: "abc",
  parent_ids: [],
  author_name: "Test",
  author_email: "test@puppyone.test",
  created_at: null,
  message: "one",
  changes: [],
};

function snapshot(partial: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    isRepo: true,
    branch: "main",
    headCommitId: "abc",
    totalCommits: 1,
    entries: [],
    stagedEntries: [],
    unstagedEntries: [],
    untrackedEntries: [],
    branches: [],
    remotes: [],
    syncTarget: null,
    effectiveHosting: {
      kind: "local-only",
      remoteName: null,
      branchName: "main",
      ref: null,
      ready: false,
      reason: "local-only",
      identity: null,
    },
    sourceControl: {
      input: { placeholder: "", defaultMessage: "" },
      groups: [],
      remote: {
        target: null,
        currentBranch: "main",
        upstream: null,
        ahead: 0,
        behind: 0,
        incomingPreview: [],
        outgoingPreview: [],
        canPull: false,
        canPush: false,
        canSync: false,
        canPublish: false,
        state: "no-remote",
      },
      actions: {
        canStageAll: false,
        canUnstageAll: false,
        canDiscardAll: false,
        canCommit: false,
      },
    },
    commits: [],
    allCommits: [],
    statusLimit: 10_000,
    didHitStatusLimit: false,
    ...partial,
  };
}

describe("history invalidation policy", () => {
  it("invalidates cached history for ref/fetch/merge/config metadata reasons", () => {
    expect(shouldInvalidateHistoryForReason(createRepositoryRefreshReason("ref", "watcher"))).toBe(true);
    expect(shouldInvalidateHistoryForReason(createRepositoryRefreshReason("fetch", "watcher"))).toBe(true);
    expect(shouldInvalidateHistoryForReason(createRepositoryRefreshReason("merge", "watcher"))).toBe(true);
    expect(shouldInvalidateHistoryForReason(createRepositoryRefreshReason("config", "watcher"))).toBe(true);
    expect(shouldInvalidateHistoryForReason(createRepositoryRefreshReason("git-metadata", "watcher"))).toBe(true);
    expect(shouldInvalidateHistoryForReason(createRepositoryRefreshReason("watcher-recovered", "watcher"))).toBe(true);
  });

  it("preserves history across working-tree and index-only refreshes", () => {
    expect(shouldInvalidateHistoryForReason(createRepositoryRefreshReason("working-tree", "watcher"))).toBe(false);
    expect(shouldInvalidateHistoryForReason(createRepositoryRefreshReason("index", "watcher"))).toBe(false);
    expect(shouldInvalidateHistoryForReason(createRepositoryRefreshReason("configuration", "external"))).toBe(false);
  });

  it("preserves repository-change semantics across retries", () => {
    const original = createRepositoryRefreshReason("ref", "watcher");
    const retry = { ...original, source: "retry" as const, attempt: 1 };
    expect(shouldInvalidateHistoryForReason(retry)).toBe(true);
  });

  it("clears commits when invalidateHistory is requested even if HEAD is unchanged", () => {
    const previous = snapshot({
      commits: [sampleCommit],
      allCommits: [sampleCommit],
    });
    const next = snapshot({ commits: [], allCommits: [] });
    const merged = mergePreservedHistory(previous, next, { invalidateHistory: true });
    expect(merged.commits).toEqual([]);
    expect(merged.allCommits).toEqual([]);
  });

  it("keeps commits when HEAD is unchanged and history is not invalidated", () => {
    const previous = snapshot({
      commits: [sampleCommit],
      allCommits: [sampleCommit],
    });
    const next = snapshot({ commits: [], allCommits: [] });
    const merged = mergePreservedHistory(previous, next);
    expect(merged.commits).toHaveLength(1);
    expect(merged.allCommits).toHaveLength(1);
  });
});
