import { describe, expect, it } from "vitest";
import { getRemoteUpdateNoticeModel } from "../../../../src/features/data-workspace/RemoteUpdateNotice";
import type { GitStatusSnapshot } from "../../../../src/types/electron";
import { gitResource } from "../../../support/source-control/gitFixtures";

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
          gitResource("docs/brief.md", "modified"),
          gitResource("research/notes.md", "modified"),
          gitResource("assets/chart.png", "added"),
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
        gitResource("one.md", "added"),
        gitResource("two.md", "modified"),
        gitResource("three.md", "deleted"),
        gitResource("four.md", "renamed"),
      ],
    });
    expect(getRemoteUpdateNoticeModel(status)?.fileChanges).toEqual({
      added: 1,
      modified: 2,
      deleted: 1,
    });
  });
});
