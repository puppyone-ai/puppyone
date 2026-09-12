import { describe, expect, it } from "vitest";
import { getRemoteUpdateNoticeModel } from "../../../../src/features/data-workspace/RemoteUpdateNotice";
import type { GitStatusSnapshot } from "../src/types/electron";

function incomingStatus(overrides: Partial<GitStatusSnapshot["sourceControl"]["remote"]> = {}) {
  return {
    isRepo: true,
    effectiveHosting: {
      kind: "github",
      remoteName: "origin",
      branchName: "main",
      ref: "origin/main",
      ready: true,
    },
    branches: [{
      name: "origin/main",
      remote: true,
      lastCommitDate: "2026-08-27T01:30:00.000Z",
      lastCommitAuthorName: "Preview Collaborator",
    }],
    sourceControl: {
      remote: {
        state: "incoming",
        behind: 3,
        canPull: true,
        target: { remote: "origin", ref: "origin/main" },
        incomingFileSummary: {
          total: 4,
          added: 1,
          modified: 2,
          deleted: 1,
          renamed: 0,
          copied: 0,
          changed: 0,
        },
        incomingPreview: [
          { path: "docs/brief.md", status: "modified" },
          { path: "research/notes.md", status: "modified" },
          { path: "assets/chart.png", status: "added" },
        ],
        ...overrides,
      },
    },
  } as GitStatusSnapshot;
}

describe("remote update notice model", () => {
  it("summarizes changed files, previews, and update time", () => {
    expect(getRemoteUpdateNoticeModel(incomingStatus())).toEqual({
      behind: 3,
      fileCount: 4,
      fileChanges: { added: 1, modified: 2, deleted: 1 },
      updatedAt: "2026-08-27T01:30:00.000Z",
      canPull: true,
      diverged: false,
    });
  });

  it("appears for divergence and stays hidden when there is nothing incoming", () => {
    expect(getRemoteUpdateNoticeModel(incomingStatus({ state: "diverged" }))?.diverged).toBe(true);
    expect(getRemoteUpdateNoticeModel(incomingStatus({ state: "synced", behind: 0 }))).toBeNull();
  });

  it("falls back to the incoming preview when the aggregate summary is unavailable", () => {
    const status = incomingStatus({
      incomingFileSummary: undefined,
      incomingPreview: [
        { path: "one.md", status: "added" },
        { path: "two.md", status: "modified" },
        { path: "three.md", status: "deleted" },
        { path: "four.md", status: "renamed" },
      ],
    });
    expect(getRemoteUpdateNoticeModel(status)?.fileChanges).toEqual({
      added: 1,
      modified: 2,
      deleted: 1,
    });
  });
});
