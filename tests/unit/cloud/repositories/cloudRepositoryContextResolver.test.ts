import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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
  const reviewedStatus = {
    isRepo: true,
    headCommitId: "commit-reviewed",
    branch: "main",
    remotes: [],
  } as never;

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

describe("repository-context architecture", () => {
  it("resolves one current repository Project and keeps catalogs archive-only", () => {
    const dataSource = readFileSync(
      new URL("../../../../src/features/cloud/data/useDesktopCloudData.ts", import.meta.url),
      "utf8",
    );
    const resolverSource = readFileSync(
      new URL("../../../../src/features/cloud/project/context/useCurrentRepositoryCloudContext.ts", import.meta.url),
      "utf8",
    );
    const cloudApiSource = readFileSync(
      new URL("../../../../src/lib/cloudApi.ts", import.meta.url),
      "utf8",
    );
    const publishHookSource = readFileSync(
      new URL("../../../../src/features/cloud/initialization/useCloudInitialization.ts", import.meta.url),
      "utf8",
    );
    const appSource = readFileSync(new URL("../../../../src/App.tsx", import.meta.url), "utf8");
    const combined = `${dataSource}\n${resolverSource}\n${cloudApiSource}\n${appSource}`;

    expect(dataSource).not.toContain("listCloudProjects");
    expect(dataSource).not.toContain("loadProjectCatalog");
    expect(dataSource).toContain("getCloudProject");
    expect(resolverSource).not.toContain("listCloudProjects");
    expect(appSource).not.toContain("listCloudProjects");
    expect(cloudApiSource).not.toContain("listCloudProjects");
    expect(cloudApiSource).not.toContain("listCloudTemplates");
    expect(cloudApiSource).not.toContain("instantiateCloudTemplate");
    expect(resolverSource).toContain("resolveCanonicalPuppyoneRemotes");
    expect(resolverSource).toContain("getCloudRepositoryContext");
    expect(resolverSource).not.toContain("remote_url");
    expect(combined).not.toContain("cloud://");
    expect(combined).not.toContain("CloudTemplateStore");
    expect(existsSync(new URL(
      "../../../../archive/desktop-cloud-catalog/src/features/cloud/data/useCloudProjectCatalog.ts",
      import.meta.url,
    ))).toBe(true);
    expect(existsSync(new URL(
      "../../../../archive/desktop-cloud-catalog/src/features/cloud/components/CloudTemplateStore.tsx",
      import.meta.url,
    ))).toBe(true);
    expect(combined).not.toMatch(/WorkspaceBinding|workspaceBinding|workspace_binding|cloudBinding|bindingId/);
    expect(publishHookSource).toContain("startWorkspaceCloudInitialization");
    expect(publishHookSource).toContain("pending?.selectedSourceBranch");
    expect(publishHookSource).toContain("pending.availableActions");
    expect(publishHookSource).not.toContain("expectedHeadCommitId");
    expect(publishHookSource).not.toContain("issueWorkspaceGitRemote");
    expect(publishHookSource).not.toContain("configureWorkspaceCloudRemote");
    expect(appSource).not.toMatch(/revokeCloudWorkspace|workspaceInstanceId/);
  });

  it("keeps Initialize remote mutation inside the durable main-process transaction", () => {
    const coordinatorSource = readFileSync(
      new URL("../../../../electron/main/cloud-initialization/coordinator.mjs", import.meta.url),
      "utf8",
    );
    const transactionStart = coordinatorSource.indexOf("async function runInitializeUnderLock");
    const transactionEnd = coordinatorSource.indexOf("async function runCleanupUnderLock");
    const transaction = coordinatorSource.slice(transactionStart, transactionEnd);

    expect(transactionStart).toBeGreaterThan(-1);
    expect(transaction).toContain("assertFreshPublishStatus(status, base)");
    expect(transaction).toContain("gitService.assertNoRemote(base.rootPath)");
    expect(transaction).toContain("gitService.resolveSourceCommit(base.rootPath, base.sourceBranch)");
    expect(transaction).toContain("createPushAttempt({ sequence: 1, commitOid: source.commitOid");
    expect(transaction).toContain("durableJournal.write(base.rootPath, record, { createOnly: true })");
    expect(transaction).toContain("cloudApi.createProject(record)");
    expect(transaction).toContain("cloudApi.issueCredential(record, secret.value)");
    expect(transaction).toContain("configureRemote(base.rootPath, record, reportProgress)");
    expect(coordinatorSource).toContain("gitService.configureCanonicalRemote(");
    expect(transaction).toContain("gitService.pushExpectedCommit(");
    expect(coordinatorSource).toContain("repositoryLockKey(context.identity.commonDir)");
    expect(coordinatorSource).toContain("secretVault.clear(record.secret_ref)");
  });
});
