import { describe, expect, it } from "vitest";
import { getProjectBackupProviders, getProjectBackupSnapshot } from "../../../../src/features/app-shell/projectBackupProviders";
import { gitStatus } from "../../../support/source-control/gitFixtures";
import type { GitRemoteSummary } from "../../../../src/types/electron";

const remote = (fetchUrl: string | null, pushUrl: string | null = null): GitRemoteSummary => ({
  name: "origin", fetchUrl, pushUrl, branches: [],
});

describe("remote backup observations", () => {
  const savedBranch = { name: "origin/main", current: false, remote: true, upstream: null,
    ahead: 0, behind: 0, lastCommitId: "saved-commit", lastCommitMessage: "Saved",
    lastCommitDate: "2026-09-30T01:00:00Z" };
  it("keeps an unverified destination unknown and never treats a commit date as backup time", () => {
    expect(getProjectBackupSnapshot(null, "github")).toMatchObject({ state: "unverified", commitId: null });
    const snapshot = getProjectBackupSnapshot(gitStatus({
      remotes: [remote("https://github.com/team/project.git")], branches: [savedBranch], headCommitId: "saved-commit",
    }), "github");
    expect(snapshot).toMatchObject({ state: "matching", branch: "main", commitId: "saved-commit" });
    expect(snapshot).not.toHaveProperty("lastBackupAt");
    expect(snapshot).not.toHaveProperty("lastCommitDate");
  });
  it.each([[0, 0, "matching"], [2, 0, "outgoing"], [0, 3, "incoming"], [2, 3, "diverged"]] as const)(
    "uses observed sync counts %s/%s for %s", (ahead, behind, state) => {
      const status = gitStatus({ remotes: [remote("https://github.com/team/project.git")], branches: [savedBranch],
        syncTarget: { remote: "origin", branch: "main", ref: "origin/main", exists: true,
          ahead, behind, incomingPreview: [], outgoingPreview: [] },
      });
      expect(getProjectBackupSnapshot(status, "github")).toMatchObject({ state, ahead, behind });
    },
  );
  it("does not use fetch-host refs to claim a backup at a different push destination", () => {
    expect(getProjectBackupSnapshot(gitStatus({
      remotes: [remote("https://github.com/team/project.git", "https://gitlab.com/team/project.git")],
      branches: [savedBranch], headCommitId: "saved-commit",
    }), "gitlab")).toMatchObject({ state: "unverified", commitId: null });
  });
  it("does not borrow another Cloud project's remote version", () => {
    const url = "https://cloud.example/git/project-1.git";
    expect(getProjectBackupSnapshot(gitStatus({ remotes: [remote(url, url)],
      branches: [savedBranch], headCommitId: "saved-commit",
    }), "puppyone-cloud", "project-2")).toMatchObject({ state: "unverified", commitId: null });
  });
  it("does not borrow a matching project ID from another Cloud server", () => {
    const url = "https://other.example/git/project-1.git";
    expect(getProjectBackupSnapshot(gitStatus({ remotes: [remote(url, url)],
      branches: [savedBranch], headCommitId: "saved-commit",
    }), "puppyone-cloud", "project-1", "https://cloud.example"))
      .toMatchObject({ state: "unverified", commitId: null });
  });
});

describe("project hosting services", () => {
  it("does not invent a backup for a missing or uninitialized repository", () => {
    expect(getProjectBackupProviders(null)).toEqual([]);
    expect(getProjectBackupProviders(gitStatus({ isRepo: false }))).toEqual([]);
    expect(getProjectBackupProviders(gitStatus({ headCommitId: null, totalCommits: 0 }))).toEqual([]);
  });

  it("does not present local Git history as a hosting service", () => {
    expect(getProjectBackupProviders(gitStatus())).toEqual([]);
  });

  it.each([
    ["https://github.com/team/project.git", "github"],
    ["git@github.com:team/project.git", "github"],
    ["github.com:team/project.git", "github"],
    ["ssh://git@ssh.github.com:443/team/project.git", "github"],
    ["https://GITHUB.COM/team/project.git", "github"],
    ["https://gitlab.com/team/project.git", "gitlab"],
    ["git@gitlab.com:team/project.git", "gitlab"],
    ["https://git.example.test/team/project.git", null],
    ["/srv/backups/project.git", null],
    ["https://github.com.example.test/team/project.git", null],
    ["https://example.test/github.com/project.git", null],
  ])("classifies the actual remote host: %s", (url, provider) => {
    expect(getProjectBackupProviders(gitStatus({
      headCommitId: null, totalCommits: 0, remotes: [remote(url)],
    }))).toEqual(provider ? [provider] : []);
  });

  it("uses the push destination when it differs from the fetch host", () => {
    expect(getProjectBackupProviders(gitStatus({
      remotes: [remote("https://github.com/team/project.git", "git@gitlab.com:team/project.git")],
    }))).toEqual(["gitlab"]);
  });

  it("deduplicates brands across multiple remotes and ignores empty URLs", () => {
    expect(getProjectBackupProviders(gitStatus({ remotes: [
      remote("git@gitlab.com:team/project.git"),
      remote("https://github.com/team/project.git"),
      remote("git@github.com:team/project.git"),
      remote("https://git.example.test/team/project.git"),
      remote(null), remote(" ", " "),
    ] }))).toEqual(["github", "gitlab"]);
  });
});
