import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCloudRemoteNameAvailable,
  assertExpectedGitRepositoryState,
  isTrustedCloudProjectLocator,
  isTrustedCloudGitOrigin,
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

describe("legacy Cloud locator identity", () => {
  const api = "https://api.puppyone.ai/api/v1";
  beforeEach(() => vi.stubEnv("VITE_DESKTOP_CLOUD_GIT_ORIGIN", ""));
  afterEach(() => vi.unstubAllEnvs());
  it("accepts the official HTTP identity without trusting HTTP Git transport", () => {
    const locator = "http://api.puppyone.ai/git/project-1.git";
    expect(isTrustedCloudProjectLocator(locator, api)).toBe(true);
    expect(isTrustedCloudGitOrigin(locator, api)).toBe(false);
  });
  it.each([
    "http://other.puppyone.ai/git/project-1.git",
    "http://api.puppyone.ai:9000/git/project-1.git",
    "http://user:secret@api.puppyone.ai/git/project-1.git",
    "http://api.puppyone.ai/git/project-1.git?token=secret",
    "http://api.puppyone.ai/git/project-1.git#secret",
  ])("rejects unrelated or credential-bearing locators: %s", locator => {
    expect(isTrustedCloudProjectLocator(locator, api)).toBe(false);
    vi.stubEnv("VITE_DESKTOP_CLOUD_GIT_ORIGIN", "https://api.puppyone.ai");
    expect(isTrustedCloudProjectLocator(locator, "http://localhost:9090/api/v1")).toBe(false);
  });
  it("keeps development and production environments distinct", () => {
    expect(isTrustedCloudProjectLocator("http://api.puppyone.ai/git/project-1.git", "http://localhost:8000/api/v1")).toBe(false);
  });
  it.each(["http://localhost:9090/api/v1", "http://127.0.0.1:9090/api/v1"])(
    "recognizes the legacy identity for an explicitly configured hosted Git origin via %s", apiBaseUrl => {
      vi.stubEnv("VITE_DESKTOP_CLOUD_GIT_ORIGIN", "https://api.puppyone.ai");
      const locator = "http://api.puppyone.ai/git/project-1.git";
      expect(isTrustedCloudProjectLocator(locator, apiBaseUrl)).toBe(true);
      expect(isTrustedCloudGitOrigin(locator, apiBaseUrl)).toBe(false);
    },
  );
  it.each(["https://other.puppyone.ai", "http://api.puppyone.ai", "https://api.puppyone.ai:9000"])(
    "does not infer a hosted Git identity from a different configured origin: %s", gitOrigin => {
      vi.stubEnv("VITE_DESKTOP_CLOUD_GIT_ORIGIN", gitOrigin);
      expect(isTrustedCloudProjectLocator("http://api.puppyone.ai/git/project-1.git", "http://localhost:9090/api/v1")).toBe(false);
      expect(isTrustedCloudGitOrigin("http://api.puppyone.ai/git/project-1.git", "http://localhost:9090/api/v1")).toBe(false);
    },
  );
  it("does not let the development Git override bind a different hosted API", () => {
    vi.stubEnv("VITE_DESKTOP_CLOUD_GIT_ORIGIN", "https://api.puppyone.ai");
    expect(isTrustedCloudProjectLocator("http://api.puppyone.ai/git/project-1.git", "https://other.puppyone.ai/api/v1")).toBe(false);
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
