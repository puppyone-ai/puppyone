import { describe, expect, it } from "vitest";
import { getProjectBackupProviders } from "../../../../src/features/app-shell/projectBackupProviders";
import { gitStatus } from "../../../support/source-control/gitFixtures";
import type { GitRemoteSummary } from "../../../../src/types/electron";

const remote = (fetchUrl: string | null, pushUrl: string | null = null): GitRemoteSummary => ({
  name: "origin", fetchUrl, pushUrl, branches: [],
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
