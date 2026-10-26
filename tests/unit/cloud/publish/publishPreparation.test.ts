import { beforeEach, describe, expect, it, vi } from "vitest";
import { gitStatus } from "../../../support/source-control/gitFixtures";

const local = vi.hoisted(() => ({
  initializeWorkspaceGitRepository: vi.fn(),
  stageAllWorkspaceGitChanges: vi.fn(),
  commitWorkspaceGit: vi.fn(),
  createWorkspaceGitBranch: vi.fn(),
}));

vi.mock("../../../../src/lib/localFiles", () => local);

import {
  isIdentityDeferredPreparation,
  prepareWorkspaceForPublish,
  resolveCloudPublishBranchName,
} from "../../../../src/features/cloud/initialization/publishPreparation";

const ROOT = "/fixture/project";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("preparing a folder before anyone has an account", () => {
  it("enables version history, takes the first snapshot and names a branch, in that order", async () => {
    const stages: string[] = [];
    local.initializeWorkspaceGitRepository.mockResolvedValue(
      gitStatus({ isRepo: true, headCommitId: null, totalCommits: 0, branch: null }),
    );
    local.stageAllWorkspaceGitChanges.mockResolvedValue(
      gitStatus({ headCommitId: null, totalCommits: 0, branch: null }),
    );
    local.commitWorkspaceGit.mockResolvedValue(
      gitStatus({ headCommitId: "commit-1", totalCommits: 1, branch: null }),
    );
    local.createWorkspaceGitBranch.mockResolvedValue(
      gitStatus({ headCommitId: "commit-1", totalCommits: 1, branch: "main" }),
    );

    const result = await prepareWorkspaceForPublish({
      rootPath: ROOT,
      status: gitStatus({ isRepo: false, headCommitId: null, totalCommits: 0, branch: null }),
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(["enabling-version-control", "creating-snapshot", "creating-branch"]);
    expect(result.ok).toBe(true);
    expect(result.status.branch).toBe("main");
    expect(local.createWorkspaceGitBranch).toHaveBeenCalledWith(ROOT, "main");
  });

  it("leaves a prepared folder alone, so running it twice costs nothing", async () => {
    const result = await prepareWorkspaceForPublish({ rootPath: ROOT, status: gitStatus() });

    expect(result).toEqual({ ok: true, status: gitStatus() });
    expect(local.initializeWorkspaceGitRepository).not.toHaveBeenCalled();
    expect(local.commitWorkspaceGit).not.toHaveBeenCalled();
    expect(local.createWorkspaceGitBranch).not.toHaveBeenCalled();
  });

  it("commits under the supplied identity and omits it when there is none", async () => {
    const committed = gitStatus({ headCommitId: "commit-1", totalCommits: 1 });
    local.stageAllWorkspaceGitChanges.mockResolvedValue(gitStatus({ headCommitId: null, totalCommits: 0 }));
    local.commitWorkspaceGit.mockResolvedValue(committed);
    const pending = gitStatus({ headCommitId: null, totalCommits: 0 });

    await prepareWorkspaceForPublish({ rootPath: ROOT, status: pending, author: "dev@example.com" });
    await prepareWorkspaceForPublish({ rootPath: ROOT, status: pending });

    expect(local.commitWorkspaceGit.mock.calls[0]?.[2]).toEqual({
      allowEmpty: true,
      authorName: "dev@example.com",
      authorEmail: "dev@example.com",
    });
    expect(local.commitWorkspaceGit.mock.calls[1]?.[2]).toEqual({ allowEmpty: true });
  });

  it("reports the step that is still missing, and whether an account would supply it", async () => {
    local.stageAllWorkspaceGitChanges.mockResolvedValue(gitStatus({ headCommitId: null, totalCommits: 0 }));
    local.commitWorkspaceGit.mockRejectedValue(new Error("no identity configured"));

    const result = await prepareWorkspaceForPublish({
      rootPath: ROOT,
      status: gitStatus({ headCommitId: null, totalCommits: 0 }),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("COMMIT_REQUIRED");
    expect(isIdentityDeferredPreparation("COMMIT_REQUIRED")).toBe(true);
    expect(isIdentityDeferredPreparation("BRANCH_REQUIRED")).toBe(true);
    expect(isIdentityDeferredPreparation("REPOSITORY_REQUIRED")).toBe(false);
  });

  it("never takes a branch name that already exists", () => {
    const named = (names: string[]) => resolveCloudPublishBranchName(gitStatus({
      branches: names.map((name) => ({
        name, current: false, remote: false, upstream: null, ahead: 0, behind: 0,
        lastCommitId: null, lastCommitMessage: null, lastCommitDate: null,
      })),
    }));

    expect(named([])).toBe("main");
    expect(named(["main"])).toBe("puppyone-publish");
    expect(named(["main", "puppyone-publish"])).toBe("puppyone-publish-2");
    expect(named(["main", "puppyone-publish", "puppyone-publish-2"])).toBe("puppyone-publish-3");
  });
});
