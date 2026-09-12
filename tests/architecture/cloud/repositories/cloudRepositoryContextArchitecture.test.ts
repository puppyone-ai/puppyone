import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
