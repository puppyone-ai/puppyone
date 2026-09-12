import { describe, expect, it } from "vitest";
import {
  classifyLocalFile,
  getMimeType,
  isLocalFilePreviewable,
  resolveCopyNameExtension,
} from "../../../../local-api/files/file-format-policy.mjs";
import {
  normalizeRelativePath,
  resolveWorkspacePath,
} from "../../../../local-api/files/path-policy.mjs";
import { buildGitSourceControlSnapshot } from "../../../../local-api/git/source-control-model.mjs";
import { normalizePuppyoneWorkspaceConfig } from "../../../../local-api/workspace-config.mjs";

describe("local file-format policy", () => {
  it("keeps MIME, semantic kind, preview, and compound-extension decisions together", () => {
    expect(getMimeType("notes.md")).toBe("text/markdown; charset=utf-8");
    expect(getMimeType("report.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(getMimeType("backup.tar.gz")).toBe("application/gzip");
    expect(classifyLocalFile("table.csv")).toBe("spreadsheet");
    expect(classifyLocalFile("table.xlsx")).toBe("spreadsheet");
    expect(classifyLocalFile("flow.puppyflow.json")).toBe("workflow");
    expect(isLocalFilePreviewable("table.csv")).toBe(true);
    expect(isLocalFilePreviewable("source.ts")).toBe(true);
    expect(isLocalFilePreviewable("movie.mp4")).toBe(false);
    expect(resolveCopyNameExtension("backup.tar.gz")).toBe(".tar.gz");
    expect(resolveCopyNameExtension(".env")).toBe("");
  });
});

describe("local path policy", () => {
  it("normalizes safe paths and rejects paths outside the workspace", () => {
    expect(normalizeRelativePath("folder/../notes.md")).toBe("notes.md");
    expect(resolveWorkspacePath("/tmp/project", "docs/readme.md")).toBe("/tmp/project/docs/readme.md");
    expect(() => normalizeRelativePath("../secret.txt")).toThrow(/outside the selected workspace/i);
    expect(() => normalizeRelativePath("/tmp/secret.txt")).toThrow(/outside the selected workspace/i);
    expect(() => normalizeRelativePath(
      "puppyone-local://workspace/folder-a/docs/guanqun.md",
    )).toThrow(/provider-relative/i);
    expect(() => normalizeRelativePath(
      ".\\puppyone-local:\\workspace\\folder-a\\docs\\guanqun.md",
    )).toThrow(/provider-relative/i);
  });
});

describe("source-control presentation model", () => {
  it("derives stable groups and action availability without filesystem or Git side effects", () => {
    const snapshot = buildGitSourceControlSnapshot({
      entries: [
        { path: "staged.md", staged: "M", unstaged: "." },
        { path: "working.md", staged: ".", unstaged: "M" },
        { path: "new.md", status: "untracked", staged: "?", unstaged: "?" },
      ],
      branchName: "main",
      syncTarget: { remote: "origin", branch: "main", exists: true, ahead: 1, behind: 0 },
      currentBranch: null,
      headCommitId: "abc123",
    });

    expect(snapshot.groups.map(({ id }) => id)).toEqual(["index", "workingTree", "untracked"]);
    expect(snapshot.input.defaultMessage).toBe("Update staged.md");
    expect(snapshot.actions).toEqual({
      canStageAll: true,
      canUnstageAll: true,
      canDiscardAll: true,
      canCommit: true,
      canContinue: false,
      canAbort: false,
    });
    expect(snapshot.remote).toMatchObject({ state: "outgoing", canPush: true, canSync: true });
  });

  it("requires incoming commits to be integrated before a diverged branch can push", () => {
    const snapshot = buildGitSourceControlSnapshot({
      entries: [],
      branchName: "main",
      syncTarget: { remote: "origin", branch: "main", exists: true, ahead: 1, behind: 1 },
      currentBranch: null,
      headCommitId: "abc123",
    });

    expect(snapshot.remote).toMatchObject({
      state: "diverged",
      canPull: true,
      canPush: false,
      canSync: true,
    });
  });

  it("fails closed while a repository operation is waiting for conflict resolution", () => {
    const conflicted = buildGitSourceControlSnapshot({
      entries: [{ path: "shared.md", staged: "U", unstaged: "U", conflict: true }],
      branchName: "main",
      syncTarget: { remote: "origin", branch: "main", exists: true, ahead: 1, behind: 1 },
      currentBranch: null,
      headCommitId: "abc123",
      repositoryOperation: "rebase",
    });

    expect(conflicted.operation).toEqual({ kind: "rebase", canContinue: false, canAbort: true });
    expect(conflicted.actions).toMatchObject({ canCommit: false, canContinue: false, canAbort: true });
    expect(conflicted.remote).toMatchObject({ canPull: false, canPush: false, canPublish: false, canSync: false });

    const resolved = buildGitSourceControlSnapshot({
      entries: [{ path: "shared.md", staged: "M", unstaged: "." }],
      branchName: "main",
      syncTarget: { remote: "origin", branch: "main", exists: true, ahead: 1, behind: 1 },
      currentBranch: null,
      headCommitId: "abc123",
      repositoryOperation: "rebase",
    });
    expect(resolved.operation).toEqual({ kind: "rebase", canContinue: true, canAbort: true });
    expect(resolved.actions).toMatchObject({ canCommit: false, canContinue: true, canAbort: true });
  });
});

describe("workspace config normalization", () => {
  it("migrates v1 Git metadata into the v3 source-of-truth shape", () => {
    expect(normalizePuppyoneWorkspaceConfig({
      version: 1,
      git: { primaryRemote: "origin", watchedBranch: "main" },
      backup: { enabled: true, service: "github" },
    })).toMatchObject({
      version: 3,
      sync: {
        sourceOfTruth: { service: "github", remote: "origin", branch: "main" },
      },
      backup: { enabled: true, service: "github", remote: "origin", branch: "main" },
    });
  });

  it("strips historical Cloud, Project, and checkout identity from the local config", () => {
    const normalized = normalizePuppyoneWorkspaceConfig({
      version: 2,
      project: {
        id: "01234567-89ab-4def-8123-456789abcdef",
        workspaceInstanceId: "workspace-instance-1234",
      },
      cloud: {
        projectId: "cloud-project-123",
        origin: "https://API.PUPPYONE.AI",
      },
    });
    expect(normalized).toMatchObject({ version: 3 });
    expect(normalized).not.toHaveProperty("project");
    expect(normalized).not.toHaveProperty("cloud");
  });

  it("ignores obsolete local Project ids and rejects unsupported config versions", () => {
    expect(normalizePuppyoneWorkspaceConfig({
      project: { id: "not-a-uuid" },
    })).not.toHaveProperty("project");

    expect(() => normalizePuppyoneWorkspaceConfig({
      version: 4,
    })).toThrow(/Unsupported PuppyOne config version/i);
  });
});
