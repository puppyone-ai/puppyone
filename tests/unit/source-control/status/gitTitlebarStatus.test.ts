import { describe, expect, it } from "vitest";
import { getGitTitlebarStatus } from "../../../../src/features/source-control/gitTitlebarStatus";
import type { GitStatusEntry } from "../../../../src/types/electron";
import { gitStatus } from "../../../support/source-control/gitFixtures";

describe("Git titlebar status", () => {
  it("keeps local files and remote commit directions as separate counts", () => {
    const shared = entry("shared.md", { staged: "M", unstaged: "M" });
    const conflict = entry("conflict.md", { conflict: true });
    const status = gitStatus({
      entries: [shared, conflict],
      stagedEntries: [shared],
      unstagedEntries: [shared, conflict],
      untrackedEntries: [entry("new.md")],
    });
    status.sourceControl.remote = {
      ...status.sourceControl.remote,
      ahead: 2,
      behind: 4,
    };

    expect(getGitTitlebarStatus(status)).toEqual({
      conflicts: 1,
      incoming: 4,
      localChanges: 3,
      outgoing: 2,
    });
  });

  it("returns a quiet state outside a repository", () => {
    expect(getGitTitlebarStatus(gitStatus({ isRepo: false }))).toEqual({
      conflicts: 0,
      incoming: 0,
      localChanges: 0,
      outgoing: 0,
    });
  });
});

function entry(
  path: string,
  overrides: Partial<GitStatusEntry> = {},
): GitStatusEntry {
  return {
    path,
    oldPath: null,
    staged: null,
    unstaged: "M",
    status: "modified",
    ...overrides,
  };
}
