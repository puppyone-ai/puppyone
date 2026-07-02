import { Cloud, ExternalLink, FolderOpen, GitBranch, RefreshCw, Settings, Users } from "lucide-react";
import type { Workspace } from "@puppyone/shared-ui";
import type {
  DesktopCloudProject,
  DesktopCloudRepoIdentity,
  DesktopCloudScope,
} from "../../lib/cloudApi";
import { openCloudApp } from "../../lib/cloudApi";
import type { getPuppyoneRemote } from "../source-control/remotes";
import {
  buildCloudAccessPointIdentity,
  buildCloudAccessPointScope,
  formatSidebarAccount,
} from "./utils";
import type { CloudWorkspaceSection } from "./types";
import { getCloudSectionDescriptor } from "./navigation";
import {
  CloudInlineEmpty,
  CloudMainMetric,
  CloudMainSection,
  CloudProjectRow,
  CloudWebEmpty,
  CloudWebPage,
} from "./components/shared";
import { CloudAccessPointAccessSection } from "./sections/access/AccessPointSection";
import { CloudGitSyncSection } from "./sections/GitSyncSection";
import { CloudMcpCliSection } from "./sections/McpCliSection";

export function CloudSignedOutState({
  workspace,
  onOpenDetails,
}: {
  workspace: Workspace;
  onOpenDetails: () => void;
}) {
  return (
    <CloudMainSection
      title="PuppyOne Cloud"
      count="Sign in required"
      action={<button className="desktop-cloud-row-action primary" type="button" onClick={onOpenDetails}>Sign in</button>}
    >
      <div className="desktop-cloud-empty-state">
        <span><Cloud size={22} /></span>
        <div>
          <strong>{workspace.name} is local only</strong>
          <p>Sign in before switching this folder to Cloud. After sign-in, you can back up this folder or open an existing Cloud project.</p>
        </div>
      </div>
    </CloudMainSection>
  );
}

export function CloudRemoteConnectedWorkspace({
  workspace,
  activeSection,
  branchName,
  localChangeCount,
  cloudRemote,
  loading,
  userEmail,
  onRefresh,
  onOpenGitSettings,
}: {
  workspace: Workspace;
  activeSection: CloudWorkspaceSection;
  branchName: string;
  localChangeCount: number;
  cloudRemote: NonNullable<ReturnType<typeof getPuppyoneRemote>>;
  loading: boolean;
  userEmail: string | null;
  onRefresh: () => Promise<void>;
  onOpenGitSettings: () => void;
}) {
  const section = getCloudSectionDescriptor(activeSection);

  if (cloudRemote.info.kind === "access-point" && cloudRemote.info.accessKey) {
    const accessPointScope = buildCloudAccessPointScope(cloudRemote.info.accessKey);
    const accessPointIdentity = buildCloudAccessPointIdentity(cloudRemote);

    if (activeSection === "access") {
      return (
        <CloudAccessPointAccessSection
          scope={accessPointScope}
          identity={accessPointIdentity}
          branchName={branchName}
          cloudRemote={cloudRemote}
        />
      );
    }

    if (activeSection === "mcp-cli") {
      return (
        <CloudMcpCliSection
          projectId=""
          identity={accessPointIdentity}
          scopes={[accessPointScope]}
          mcpEndpoints={[]}
          loading={loading}
          onOpenProject={() => openCloudApp("/projects")}
        />
      );
    }

    if (activeSection === "git-sync") {
      return (
        <CloudGitSyncSection
          workspace={workspace}
          status={null}
          identity={accessPointIdentity}
          cloudRemote={cloudRemote}
          accountConnected={Boolean(userEmail)}
          onOpenGitSettings={onOpenGitSettings}
          onRefresh={onRefresh}
        />
      );
    }
  }

  const Icon = activeSection === "overview" ? Cloud : section.icon;

  return (
    <>
      <CloudMainSection
        title={activeSection === "overview" ? "Cloud source" : section.title}
        count={loading ? "Resolving" : "Connected"}
        action={(
          <>
            <button className="desktop-cloud-row-action" type="button" onClick={() => void onRefresh()}>
              <RefreshCw size={13} className={loading ? "spin" : undefined} />
              <span>Refresh</span>
            </button>
            <button className="desktop-cloud-row-action" type="button" onClick={onOpenGitSettings}>
              <GitBranch size={13} />
              <span>Git Sync</span>
            </button>
          </>
        )}
      >
        <div className="desktop-cloud-project-overview">
          <div>
            <span>Hosted Git remote</span>
            <strong title={cloudRemote.rawUrl}>{workspace.name}</strong>
            <p>
              This workspace is already initialized because its Git remote points to PuppyOne Cloud.
              Desktop is resolving the Cloud project metadata for project-level {activeSection === "overview" ? "sections" : section.title.toLowerCase()}.
            </p>
          </div>
          <div className="desktop-cloud-sync-summary">
            <CloudMainMetric label="Source" value="PuppyOne Cloud" tone="ready" />
            <CloudMainMetric label="Remote" value={cloudRemote.info.displayId} tone="ready" mono />
            <CloudMainMetric label="Branch" value={branchName} />
          </div>
        </div>
      </CloudMainSection>

      <CloudMainSection
        title={section.title}
        count={loading ? "Resolving" : "Remote connected"}
        action={<button className="desktop-cloud-row-action" type="button" onClick={() => openCloudApp("/projects")}>Open Cloud</button>}
      >
        <div className="desktop-cloud-empty-state">
          <span><Icon size={22} /></span>
          <div>
            <strong>{loading ? "Resolving project metadata" : "PuppyOne Git remote is connected"}</strong>
            <p>
              Remote {cloudRemote.info.displayId} is the source of truth. Project-level access, MCP, branches, team, and settings appear after the Cloud API maps this access point to a project.
              {localChangeCount > 0 ? ` ${localChangeCount} local change${localChangeCount === 1 ? "" : "s"} are waiting in this working copy.` : ""}
            </p>
          </div>
        </div>
      </CloudMainSection>
    </>
  );
}

export function CloudUnmappedWorkspace({
  workspace,
  activeSection,
  accountEmail,
  branchName,
  localChangeCount,
  projects,
  loading,
  backupLoading,
  cloudRemote,
  action,
  onBackupWorkspace,
  onConnectProject,
  onCopyCloneCommand,
  onOpenProject,
}: {
  workspace: Workspace;
  activeSection: CloudWorkspaceSection;
  accountEmail: string | null;
  branchName: string;
  localChangeCount: number;
  projects: DesktopCloudProject[];
  loading: boolean;
  backupLoading: boolean;
  cloudRemote: ReturnType<typeof getPuppyoneRemote>;
  action: { kind: "backup" | "connect" | "copy" | null; projectId: string | null };
  onBackupWorkspace: () => void;
  onConnectProject: (project: DesktopCloudProject) => void;
  onCopyCloneCommand: (project: DesktopCloudProject) => void;
  onOpenProject: (projectId: string, section?: CloudWorkspaceSection) => void;
}) {
  if (activeSection !== "overview") {
    return (
      <CloudUnmappedSection
        workspace={workspace}
        activeSection={activeSection}
        projects={projects}
        loading={loading}
        backupLoading={backupLoading}
        cloudRemote={cloudRemote}
        action={action}
        onBackupWorkspace={onBackupWorkspace}
        onConnectProject={onConnectProject}
        onCopyCloneCommand={onCopyCloneCommand}
        onOpenProject={onOpenProject}
      />
    );
  }

  return (
    <>
      <CloudMainSection
        title="Local workspace"
        count={cloudRemote ? "Remote not matched" : "Not backed up"}
        action={(
          <button
            className="desktop-cloud-row-action primary"
            type="button"
            disabled={backupLoading}
            onClick={onBackupWorkspace}
          >
            {backupLoading ? "Connecting..." : "Back up and connect"}
          </button>
        )}
      >
        <div className="desktop-cloud-project-overview">
          <div>
            <span>Local working copy</span>
            <strong title={workspace.path}>{workspace.name}</strong>
            <p>This folder is local only. Back it up to create a hosted Cloud repo, make Cloud the source of truth, and keep this desktop workspace as a Git working copy.</p>
          </div>
          <div className="desktop-cloud-sync-summary">
            <CloudMainMetric label="Account" value={accountEmail ?? "Signed in"} tone="ready" />
            <CloudMainMetric label="Branch" value={branchName} />
            <CloudMainMetric label="Local changes" value={String(localChangeCount)} tone={localChangeCount > 0 ? "warning" : undefined} />
          </div>
        </div>
      </CloudMainSection>

      <CloudMainSection
        title="Open existing Cloud project"
        count={loading ? "Loading" : projects.length}
        action={<button className="desktop-cloud-row-action" type="button" onClick={() => openCloudApp("/projects")}>Open Cloud</button>}
      >
        <div className="desktop-cloud-project-list">
          {loading ? (
            <CloudInlineEmpty icon={RefreshCw} title="Loading projects" detail="Reading your Cloud projects from the API." />
          ) : projects.length === 0 ? (
            <CloudInlineEmpty icon={FolderOpen} title="No Cloud projects yet" detail="Create a backup from this folder to start a Cloud project." />
          ) : (
            projects.map((project) => (
              <CloudProjectRow
                key={project.id}
                project={project}
                action={action}
                onOpenProject={onOpenProject}
                onConnectProject={onConnectProject}
                onCopyCloneCommand={onCopyCloneCommand}
              />
            ))
          )}
        </div>
      </CloudMainSection>
    </>
  );
}

export function CloudUnmappedSection({
  workspace,
  activeSection,
  projects,
  loading,
  backupLoading,
  cloudRemote,
  action,
  onBackupWorkspace,
  onConnectProject,
  onCopyCloneCommand,
  onOpenProject,
}: {
  workspace: Workspace;
  activeSection: CloudWorkspaceSection;
  projects: DesktopCloudProject[];
  loading: boolean;
  backupLoading: boolean;
  cloudRemote: ReturnType<typeof getPuppyoneRemote>;
  action: { kind: "backup" | "connect" | "copy" | null; projectId: string | null };
  onBackupWorkspace: () => void;
  onConnectProject: (project: DesktopCloudProject) => void;
  onCopyCloneCommand: (project: DesktopCloudProject) => void;
  onOpenProject: (projectId: string, section?: CloudWorkspaceSection) => void;
}) {
  const section = getCloudSectionDescriptor(activeSection);
  const remoteLabel = cloudRemote?.info.displayId ?? "No PuppyOne remote";
  const Icon = section.icon;

  return (
    <>
      <CloudMainSection
        title={section.title}
        count="Project required"
        action={(
          <button
            className="desktop-cloud-row-action primary"
            type="button"
            disabled={backupLoading}
            onClick={onBackupWorkspace}
          >
            {backupLoading ? "Connecting..." : "Back up and connect"}
          </button>
        )}
      >
        <div className="desktop-cloud-empty-state">
          <span><Icon size={22} /></span>
          <div>
            <strong>{section.title} needs a mapped Cloud project</strong>
            <p>{section.description} Connect {workspace.name} to a Cloud project first. Current remote: {remoteLabel}.</p>
          </div>
        </div>
      </CloudMainSection>

      <CloudMainSection
        title="Available Cloud projects"
        count={loading ? "Loading" : projects.length}
        action={<button className="desktop-cloud-row-action" type="button" onClick={() => openCloudApp("/projects")}>Open Cloud</button>}
      >
        <div className="desktop-cloud-project-list">
          {loading ? (
            <CloudInlineEmpty icon={RefreshCw} title="Loading projects" detail="Reading your Cloud projects from the API." />
          ) : projects.length === 0 ? (
            <CloudInlineEmpty icon={FolderOpen} title="No Cloud projects yet" detail="Back up this workspace to create the Cloud project mapping." />
          ) : (
            projects.map((project) => (
              <CloudProjectRow
                key={project.id}
                project={project}
                action={action}
                onOpenProject={onOpenProject}
                onConnectProject={onConnectProject}
                onCopyCloneCommand={onCopyCloneCommand}
              />
            ))
          )}
        </div>
      </CloudMainSection>
    </>
  );
}

export function CloudProjectWebSection({
  icon: Icon,
  title,
  description,
  primaryLabel,
  onOpen,
}: {
  projectId: string;
  icon: typeof Cloud;
  title: string;
  description: string;
  primaryLabel: string;
  onOpen: () => void;
}) {
  return (
    <CloudWebPage
      title={title}
      count="Web"
      action={<button className="desktop-cloud-row-action primary" type="button" onClick={onOpen}>{primaryLabel}</button>}
    >
      <CloudWebEmpty icon={Icon} title={title} detail={description} />
    </CloudWebPage>
  );
}
