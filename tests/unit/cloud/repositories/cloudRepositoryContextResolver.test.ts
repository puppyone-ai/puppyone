import { describe, expect, it } from "vitest";
import {
  assertCloudRemoteNameAvailable,
  assertExpectedGitRepositoryState,
} from "../../../../src/features/cloud/workspace/workspaceGitRemote";
import {
  describePuppyoneRemoteCandidates,
  parsePuppyoneRemote,
  resolveCanonicalPuppyoneRemotes,
  resolvePuppyoneRemotes,
} from "../../../../src/features/source-control/remotes";
import { gitStatus } from "../../../support/source-control/gitFixtures";

describe("Initialize remote collision policy", () => {
  it("refuses to repoint an existing canonical remote", () => {
    expect(() => assertCloudRemoteNameAvailable({
      remotes: [{ name: "PuppyOne" }],
    } as never)).toThrow('A Git remote named "puppyone" already exists');
  });

  it("ignores unrelated remotes", () => {
    expect(() => assertCloudRemoteNameAvailable({
      remotes: [{ name: "origin" }],
    } as never)).not.toThrow();
  });
});

describe("Initialize Git state race guard", () => {
  const reviewedStatus = gitStatus({
    isRepo: true,
    headCommitId: "commit-reviewed",
    branch: "main",
    remotes: [],
  });

  it("accepts the exact attached branch and HEAD reviewed by the caller", () => {
    expect(() => assertExpectedGitRepositoryState(reviewedStatus, {
      headCommitId: "commit-reviewed",
      branch: "main",
    })).not.toThrow();
  });

  it.each([
    ["repository disappeared", { isRepo: false }],
    ["HEAD disappeared", { headCommitId: null }],
    ["branch disappeared", { branch: null }],
    ["repository reported HEAD", { branch: "HEAD" }],
    ["repository became detached", { branch: "DeTaChEd" }],
    ["HEAD changed", { headCommitId: "commit-new" }],
    ["branch changed", { branch: "feature/new" }],
  ])("rejects when the %s", (_label, change) => {
    expect(() => assertExpectedGitRepositoryState({
      ...reviewedStatus,
      ...change,
    }, {
      headCommitId: "commit-reviewed",
      branch: "main",
    })).toThrow("local Git branch or HEAD changed");
  });
});

describe("canonical Git locator discovery", () => {
  it("classifies exact Project and Scope locators without treating them as authority", () => {
    expect(parsePuppyoneRemote("https://cloud.example/git/project-1.git")).toEqual({
      kind: "project",
      host: "cloud.example",
      origin: "https://cloud.example",
      displayId: "project-1",
      projectId: "project-1",
    });
    expect(parsePuppyoneRemote("https://cloud.example/git/project-1/scopes/scope-docs.git")).toEqual({
      kind: "scope",
      host: "cloud.example",
      origin: "https://cloud.example",
      displayId: "project-1/scope-docs",
      projectId: "project-1",
      scopeId: "scope-docs",
    });
  });

  it("deduplicates matching fetch/push locators and fails closed on conflicts", () => {
    const unique = resolvePuppyoneRemotes({
      remotes: [{
        name: "puppyone",
        fetchUrl: "https://cloud.example/git/project-1.git",
        pushUrl: "https://cloud.example/git/project-1.git",
        branches: [],
      }],
    } as never);
    expect(unique.status).toBe("unique");
    expect(unique.candidates).toHaveLength(2);

    const conflict = resolvePuppyoneRemotes({
      remotes: [{
        name: "puppyone",
        fetchUrl: "https://cloud.example/git/project-1.git",
        pushUrl: "https://cloud.example/git/project-2.git",
        branches: [],
      }],
    } as never);
    expect(conflict.status).toBe("conflict");
  });

  it("describes conflicts without exposing a legacy credential", () => {
    const secret = "pwg_secret-value-1234567890";
    const conflict = resolvePuppyoneRemotes({
      remotes: [
        {
          name: "legacy",
          fetchUrl: `https://cloud.example/git/ap/${secret}.git`,
          pushUrl: `https://cloud.example/git/ap/${secret}.git`,
          branches: [],
        },
        {
          name: "canonical",
          fetchUrl: "https://cloud.example/git/project-1.git",
          pushUrl: "https://cloud.example/git/project-1.git",
          branches: [],
        },
      ],
    } as never);
    const summary = describePuppyoneRemoteCandidates(conflict.candidates);
    expect(summary).not.toContain(secret);
    expect(summary).toContain("pwg_…7890");
    expect(summary).toContain("project-1");
  });

  it("never uses a legacy access-key remote as Cloud Project identity", () => {
    const status = {
      remotes: [{
        name: "legacy",
        fetchUrl: "https://cloud.example/git/ap/pwg_secret.git",
        pushUrl: "https://cloud.example/git/ap/pwg_secret.git",
        branches: [],
      }],
    } as never;
    expect(resolvePuppyoneRemotes(status).status).toBe("unique");
    expect(resolveCanonicalPuppyoneRemotes(status)).toEqual({ status: "none", candidates: [] });
  });

  it("rejects encoded IDs, embedded credentials, query secrets, SSH, and file URLs", () => {
    expect(parsePuppyoneRemote("https://cloud.example/git/project-1/scopes/scope%2Fchild.git")).toBeNull();
    expect(parsePuppyoneRemote("https://user:secret@cloud.example/git/project-1.git")).toBeNull();
    expect(parsePuppyoneRemote("https://cloud.example/git/project-1.git?token=secret")).toBeNull();
    expect(parsePuppyoneRemote("ssh://cloud.example/git/project-1.git")).toBeNull();
    expect(parsePuppyoneRemote("file:///git/project-1.git")).toBeNull();
  });
});
