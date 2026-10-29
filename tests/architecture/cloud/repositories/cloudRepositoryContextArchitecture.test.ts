import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("repository-context architecture", () => {
  it("never blocks or switches a local folder on its Cloud association (ADR-001)", () => {
    const source = (path: string) => readFileSync(new URL(`../../../../src/${path}`, import.meta.url), "utf8");
    const appSource = source("App.tsx");
    const surfaceSource = source("features/app-shell/DesktopDataWorkspaceSurface.tsx");
    const openCloud = appSource.slice(appSource.indexOf("const openCloudWorkspace = useCallback("));
    const opening = openCloud.slice(0, openCloud.indexOf("}, ["));
    // Asking for the folder's Cloud project opens that other project, starts a
    // first publish, or explains; it never prepares the folder in place.
    expect(opening).toContain("resolveLocalFolderCloudEntry(projectCloudContext");
    expect(opening).toContain("void selectCloudProjectRef.current(entry.projectId)");
    expect(opening).toContain("setDismissedCloudNoticeKey(null)");
    expect(appSource).toMatch(/<LocalFolderCloudNotice[\s\S]*?onOpenCloudProject=\{\(projectId\) => \{ void selectCloudProject\(projectId\); \}\}/);
    expect(appSource).toContain("cloudProjectNotice={cloudProjectNotice}");
    expect(surfaceSource).toContain("{localResources && cloudProjectNotice}");
    // The blocking switch, its gate and the in-place preparation are gone.
    for (const removed of ["features/cloud/workbench/RepositoryCloudSwitchGate.tsx",
      "features/cloud/workbench/CloudWorkspaceSwitchDialog.tsx",
      "features/cloud/workbench/MissingCloudProjectRecovery.tsx",
      "features/cloud/workbench/useRepositoryCloudWorkspaceSwitch.ts",
      "features/cloud/workbench/useCloudWorkspaceSwitch.ts",
      "app/DesktopCloudWorkspacePreparation.tsx",
      "components/DesktopProjectLocationSwitcher.tsx"]) {
      expect(existsSync(new URL(`../../../../src/${removed}`, import.meta.url)), removed).toBe(false);
    }
    expect(appSource).not.toMatch(/repositoryCloudSwitch|projectLocation\b|DesktopProjectLocation/);
  });

  it("keeps local association discovery separate from account project navigation", () => {
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
    expect(cloudApiSource).toContain("listCloudProjects");
    const accountSource = readFileSync(new URL("../../../../src/features/cloud/workbench/useAccountCloudWorkspace.ts", import.meta.url), "utf8");
    const homepageSource = readFileSync(new URL("../../../../src/features/cloud/workbench/useHomepageCloudProjects.ts", import.meta.url), "utf8");
    expect(homepageSource).toContain("listCloudProjects");
    expect(accountSource).not.toContain("listCloudProjects");
    expect(accountSource).toContain("getCloudRepositoryContext");
    expect(accountSource).not.toMatch(/localWorkspaceIdentity|rootPath|configureRemote|workspaceBinding/);
    expect(appSource).toContain("useHomepageCloudProjects");
    expect(appSource).not.toContain("AccountCloudProjectPicker");
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

  it("opens a Cloud project only as its own project, through the shared account navigation", () => {
    const source = (path: string) => readFileSync(new URL(`../../../../src/${path}`, import.meta.url), "utf8");
    const app = source("App.tsx");
    const surface = source("app/AccountCloudWorkspaceSurface.tsx");
    // Header and Homepage list the same account catalog (3a81b077).
    expect(app).toContain("const projectCatalog = useHomepageCloudProjects(");
    expect(app).toContain("projectItems={projectCatalog.items}");
    // The shared catalog also feeds the Header, so it waits only for workspace restoration.
    expect(app).toMatch(/useHomepageCloudProjects\(\{\s*visible: !restoringWorkspace,/);
    expect(app).not.toMatch(/browseAccountCloudProjects|cloud\.catalog\.browse/);
    expect(app).not.toContain("activatePrepared");
    expect(app).toContain("await accountCloud.openTarget({ kind: \"project_root\", project_id: target.projectId }, isCurrent, true);");
    expect(surface).not.toMatch(/onBrowse|cloud\.catalog\.browse/);
    expect(app).not.toContain("accountCloud.open;");
    expect(app).toContain("const accountCloudSurface = !workspace ?");
    expect(app).toContain("<DesktopWorkspaceLocationSurface location={workspaceLocation}");
    expect(surface).toContain("titlebarSidebarSlot={centered ? undefined : projectContext}");
    expect(surface).not.toMatch(/onViewLocal|projectLocation=/);
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
