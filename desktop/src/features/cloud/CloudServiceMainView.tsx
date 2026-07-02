import { useEffect, useState } from "react";
import {
  getCloudRepoIdentity,
  openCloudApp,
  type DesktopCloudProject,
} from "../../lib/cloudApi";
import type { CloudServiceMainViewProps, CloudWorkspaceSection } from "./types";
import { getCloudAuthSession, isCloudAuthBlocking, useCloudSessionForEnvironment } from "./auth";
import { useDesktopCloudData } from "./data";
import { resolveCloudEnvironment } from "./environment";
import { copyText, shellQuote } from "./utils";
import { CloudWorkspaceLoadingState } from "./components/shared";
import { CloudProjectBrowserSignedOut } from "./components/ProjectBrowser";
import { CloudRouter } from "./routes/CloudRouter";
import { getCloudRouteWebPath, isCloudAccountSection, normalizeCloudSection } from "./routes/cloudRoutes";

export function CloudServiceMainView({
  workspace,
  status,
  puppyoneConfig,
  cloudSession,
  sessionRestoring = false,
  onCloudSessionChange,
  activeSection,
  loading,
  error,
  cloudBackupLoading,
  cloudBackupError,
  onStartPuppyoneBackup,
  onConfigureCloudRemote,
  onSelectSection,
  onRefresh,
  onOpenDetails,
  onOpenGitSettings,
}: CloudServiceMainViewProps) {
  const cloudEnvironment = resolveCloudEnvironment({ status, puppyoneConfig });
  const cloudRemote = cloudEnvironment.cloudRemote;
  const cloudApiBaseUrl = cloudEnvironment.apiBaseUrl;
  const cloudAuthState = useCloudSessionForEnvironment({
    cloudSession,
    sessionRestoring,
    environment: cloudEnvironment,
    onCloudSessionChange,
  });
  const effectiveCloudSession = getCloudAuthSession(cloudAuthState);
  const [selectedCloudProjectId, setSelectedCloudProjectId] = useState<string | null>(null);
  const loadAggregateProjectDetails = shouldLoadAggregateProjectDetails(activeSection);
  const cloudData = useDesktopCloudData(
    effectiveCloudSession,
    cloudEnvironment,
    selectedCloudProjectId,
    onCloudSessionChange,
    status?.headCommitId ?? null,
    loadAggregateProjectDetails,
  );
  const [cloudAction, setCloudAction] = useState<{
    kind: "backup" | "connect" | "copy" | null;
    projectId: string | null;
    message: string | null;
    error: string | null;
  }>({ kind: null, projectId: null, message: null, error: null });

  const accountEmail = effectiveCloudSession?.user_email ?? null;

  useEffect(() => {
    setSelectedCloudProjectId(null);
  }, [workspace.path, accountEmail, cloudApiBaseUrl]);

  useEffect(() => {
    const normalizedSection = normalizeCloudSection(activeSection);
    if (normalizedSection !== activeSection) {
      onSelectSection(normalizedSection);
    }
  }, [activeSection, onSelectSection]);

  if (cloudAuthState.status === "restoring" && !effectiveCloudSession) {
    return (
      <main className="desktop-cloud-main-view">
        <div className="desktop-cloud-page-shell">
          <CloudWorkspaceLoadingState label="Loading Cloud session" />
        </div>
      </main>
    );
  }

  const handleOpenProject = (projectId: string, section: CloudWorkspaceSection = "access") => {
    openCloudApp(getCloudRouteWebPath(section, projectId));
  };

  const handleBackupWorkspace = async () => {
    if (!effectiveCloudSession) {
      onOpenDetails();
      return;
    }

    setCloudAction({ kind: null, projectId: null, message: null, error: null });
    onStartPuppyoneBackup();
  };

  const handleConnectProject = async (project: DesktopCloudProject) => {
    if (!effectiveCloudSession) return;
    setCloudAction({ kind: "connect", projectId: project.id, message: null, error: null });
    try {
      const identity = await getCloudRepoIdentity(effectiveCloudSession, project.id, onCloudSessionChange, cloudApiBaseUrl);
      await onConfigureCloudRemote(identity.url);
      setSelectedCloudProjectId(project.id);
      setCloudAction({
        kind: null,
        projectId: project.id,
        message: `${project.name} is connected to this local folder. Use Access to manage Git Remote, CLI, and MCP entry points.`,
        error: null,
      });
      await cloudData.reload();
      onSelectSection("access");
    } catch (actionError) {
      setCloudAction({
        kind: null,
        projectId: project.id,
        message: null,
        error: actionError instanceof Error ? actionError.message : "Unable to connect this project.",
      });
    }
  };

  const handleCopyCloneCommand = async (project: DesktopCloudProject) => {
    if (!effectiveCloudSession) return;
    setCloudAction({ kind: "copy", projectId: project.id, message: null, error: null });
    try {
      const identity = await getCloudRepoIdentity(effectiveCloudSession, project.id, onCloudSessionChange, cloudApiBaseUrl);
      await copyText(`git clone ${identity.url} ${shellQuote(project.name)}`);
      setCloudAction({ kind: null, projectId: project.id, message: "Clone command copied.", error: null });
    } catch (actionError) {
      setCloudAction({
        kind: null,
        projectId: project.id,
        message: null,
        error: actionError instanceof Error ? actionError.message : "Unable to copy clone command.",
      });
    }
  };

  if (isCloudAuthBlocking(cloudAuthState)) {
    return (
      <main className="desktop-cloud-main-view desktop-cloud-auth-main-view">
        <div className="desktop-cloud-page-shell">
          <CloudProjectBrowserSignedOut
            apiBaseUrl={cloudApiBaseUrl}
            accountEmail={accountEmail}
            onSignedIn={(session) => onCloudSessionChange(session)}
            onRefresh={onRefresh}
          />
        </div>
      </main>
    );
  }

  if (cloudAuthState.status !== "signed-in") {
    return (
      <main className="desktop-cloud-main-view">
        <div className="desktop-cloud-page-shell">
          <CloudWorkspaceLoadingState label="Loading Cloud session" />
        </div>
      </main>
    );
  }

  const accountConnected = Boolean(accountEmail);
  const currentBranch = status?.branches.find((branch) => branch.current) ?? null;
  const localChangeCount =
    (status?.stagedEntries.length ?? 0) +
    (status?.unstagedEntries.length ?? 0) +
    (status?.untrackedEntries.length ?? 0);
  const branchName = currentBranch?.name ?? status?.branch ?? "No branch";
  const inCloudGlobalAccountSection = isCloudAccountSection(activeSection);

  return (
    <main className="desktop-cloud-main-view">
      <div className="desktop-cloud-page-shell">
        {!inCloudGlobalAccountSection && error && <div className="desktop-cloud-main-alert">{error}</div>}
        {!inCloudGlobalAccountSection && cloudData.error && <div className="desktop-cloud-main-alert">{cloudData.error}</div>}
        {!inCloudGlobalAccountSection && cloudBackupError && <div className="desktop-cloud-main-alert">{cloudBackupError}</div>}
        {!inCloudGlobalAccountSection && cloudAction.error && <div className="desktop-cloud-main-alert">{cloudAction.error}</div>}
        {!inCloudGlobalAccountSection && cloudAction.message && <div className="desktop-cloud-main-alert success">{cloudAction.message}</div>}

        <CloudRouter
          workspace={workspace}
          status={status}
          cloudSession={cloudAuthState.session}
          cloudApiBaseUrl={cloudApiBaseUrl}
          cloudRemote={cloudRemote}
          cloudData={cloudData}
          activeSection={activeSection}
          accountEmail={accountEmail}
          accountConnected={accountConnected}
          branchName={branchName}
          localChangeCount={localChangeCount}
          loading={loading}
          cloudBackupLoading={cloudBackupLoading}
          cloudAction={cloudAction}
          onSessionChange={onCloudSessionChange}
          onBackupWorkspace={handleBackupWorkspace}
          onConnectProject={handleConnectProject}
          onCopyCloneCommand={handleCopyCloneCommand}
          onOpenProject={handleOpenProject}
          onOpenGitSettings={onOpenGitSettings}
          onSelectProject={(project) => {
            setSelectedCloudProjectId(project.id);
            onSelectSection("contents");
          }}
          onSelectSection={onSelectSection}
        />
      </div>
    </main>
  );
}

function shouldLoadAggregateProjectDetails(section: CloudWorkspaceSection): boolean {
  return section === "contents" || section === "access" || section === "mcp-cli" || section === "git-sync";
}
