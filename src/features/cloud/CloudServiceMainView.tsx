import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  openCloudApp,
} from "../../lib/cloudApi";
import type { CloudServiceMainViewProps, CloudWorkspaceSection } from "./types";
import { getResolvedCloudProjectId } from "./project/context";
import { getCloudAuthEmail, getCloudAuthSession } from "./auth";
import { CloudSignedOutRoute } from "./auth/CloudSignedOutRoute";
import { useDesktopCloudData } from "./data";
import { CloudInitializationRoute } from "./initialization/CloudInitializationRoute";
import { CloudRouter } from "./routes/CloudRouter";
import { CloudSurfaceFrame } from "./shell/CloudSurfaceFrame";
import { CloudShareHome, useCloudShare } from "./share";
import {
  getCloudProjectDetailResources,
  getAvailableCloudSection,
  getCloudRouteSurface,
  getCloudRouteWebPath,
  isCloudOrganizationSection,
} from "./routes/cloudRoutes";
import {
  cloudMessage,
  formatCloudMessage,
  formatCloudPublishFailure,
  type CloudMessageDescriptor,
} from "./cloudPresentation";

type CloudActionFeedback = {
  notice: CloudMessageDescriptor | null;
  error: CloudMessageDescriptor | null;
};

export function CloudServiceMainView({
  workspace,
  status,
  cloudEnvironment,
  cloudAuthState,
  projectContext = null,
  onCloudSessionChange,
  activeSection,
  automationEnabled,
  loading,
  error,
  cloudBackupLoading,
  cloudBackupPending,
  cloudPublishError,
  cloudPublishNotice,
  cloudPublishProgress,
  cloudPublishState,
  cloudPublishStateLoading,
  onAbandonPuppyoneBackup,
  onStartPuppyoneBackup,
  onRemoveCloudRemote,
  onSelectSection,
  onRefresh,
  onOpenGitSettings,
}: CloudServiceMainViewProps) {
  const { t } = useLocalization();
  const share = useCloudShare();
  const cloudRemote = cloudEnvironment.cloudRemote;
  const cloudApiBaseUrl = cloudEnvironment.apiBaseUrl;
  const routedSection = getAvailableCloudSection(activeSection, { automationEnabled });
  const inOrganizationSection = isCloudOrganizationSection(routedSection);
  const localOnlyContext = !inOrganizationSection && (
      projectContext?.status === "local-only"
      || cloudPublishState !== null
      || cloudPublishStateLoading
      || (projectContext?.status === "resolving" && status === null)
  );
  const effectiveCloudSession = getCloudAuthSession(cloudAuthState);
  const projectDetailResources = getCloudProjectDetailResources(routedSection);
  const contextProjectId = projectContext ? getResolvedCloudProjectId(projectContext) : null;
  const cloudData = useDesktopCloudData({
    session: effectiveCloudSession,
    cloudEnvironment,
    projectId: inOrganizationSection ? null : contextProjectId,
    onSessionChange: onCloudSessionChange,
    workspaceRevisionKey: status?.headCommitId ?? null,
    loadProjectDetails: projectDetailResources.length > 0,
    projectDetailResources,
  });
  const [cloudAction, setCloudAction] = useState<CloudActionFeedback>({
    notice: null,
    error: null,
  });

  const accountEmail = getCloudAuthEmail(cloudAuthState);
  const actionRequestRef = useRef<symbol | null>(null);
  useEffect(() => {
    actionRequestRef.current = null;
    setCloudAction({ notice: null, error: null });
  }, [workspace.path, accountEmail, cloudApiBaseUrl]);

  useEffect(() => {
    const normalizedSection = getAvailableCloudSection(activeSection, { automationEnabled });
    if (normalizedSection !== activeSection) {
      onSelectSection(normalizedSection);
    }
  }, [activeSection, automationEnabled, onSelectSection]);

  const cloudPublishErrorMessage = cloudPublishError
    ? formatCloudPublishFailure(cloudPublishError, t)
    : null;

  useEffect(() => {
    if (
      routedSection === "initialize"
      && projectContext?.status === "resolved"
      && !cloudPublishStateLoading
      && !cloudPublishState
      && !cloudBackupLoading
    ) {
      onSelectSection("contents");
    }
  }, [
    cloudBackupLoading,
    cloudPublishState,
    cloudPublishStateLoading,
    onSelectSection,
    projectContext?.status,
    routedSection,
  ]);

  if (!effectiveCloudSession) {
    return (
      <CloudSignedOutRoute
        activeSection={routedSection}
        authState={cloudAuthState}
        apiBaseUrl={cloudApiBaseUrl}
        loadingLabel={t("cloud.loading.session")}
      />
    );
  }

  if (routedSection === "share" && share) {
    return (
      <CloudSurfaceFrame surface="landing">
        <CloudShareHome
          projectName={workspace.name}
          projectContext={projectContext ?? { status: "local-only", projectId: null }}
          share={share}
        />
      </CloudSurfaceFrame>
    );
  }

  if (localOnlyContext) {
    return (
      <CloudInitializationRoute
        activeSection={routedSection}
        workspace={workspace}
        status={status}
        session={effectiveCloudSession}
        apiBaseUrl={cloudApiBaseUrl}
        accountEmail={accountEmail}
        loading={loading}
        error={error}
        cloudActionNotice={cloudAction.notice}
        cloudBackupLoading={cloudBackupLoading}
        cloudBackupPending={cloudBackupPending}
        cloudPublishError={cloudPublishError}
        cloudPublishNotice={cloudPublishNotice}
        cloudPublishProgress={cloudPublishProgress}
        cloudPublishState={cloudPublishState}
        cloudPublishStateLoading={cloudPublishStateLoading}
        onSessionChange={onCloudSessionChange}
        onAbandonPublish={onAbandonPuppyoneBackup}
        onRefresh={onRefresh}
        onPublishWorkspace={onStartPuppyoneBackup}
      />
    );
  }

  const handleOpenProject = (projectId: string, section: CloudWorkspaceSection = "access") => {
    openCloudApp(getCloudRouteWebPath(section, projectId));
  };

  const handleRemoveCloudRemote = async () => {
    if (!onRemoveCloudRemote || actionRequestRef.current) return;
    const request = Symbol("remove-cloud-git-remote");
    actionRequestRef.current = request;
    setCloudAction({ notice: null, error: null });
    try {
      await onRemoveCloudRemote();
      setCloudAction({
        notice: cloudMessage("cloud-remote-removed"),
        error: null,
      });
    } catch (actionError) {
      setCloudAction({
        notice: null,
        error: cloudMessage("remove-remote-failed", undefined, actionError instanceof Error ? actionError.message : undefined),
      });
    } finally {
      if (actionRequestRef.current === request) actionRequestRef.current = null;
    }
  };

  const routeSurface = getCloudRouteSurface(routedSection);
  const activeSurface = routeSurface === "landing" && !contextProjectId
    ? "standard"
    : routeSurface;
  return (
    <CloudSurfaceFrame surface={activeSurface}>
        {cloudAuthState.status === "offline-authenticated" && (
          <div className="desktop-cloud-main-alert">
            {t("cloud.offline")}
          </div>
        )}
        {projectContext?.status === "resolved" && projectContext.warning && (
          <div className="desktop-cloud-main-alert warning" role="status">
            <span>{formatCloudMessage(projectContext.warning, t)}</span>
          </div>
        )}
        {!inOrganizationSection && error && <div className="desktop-cloud-main-alert">{error}</div>}
        {!inOrganizationSection && cloudData.error && <div className="desktop-cloud-main-alert">{formatCloudMessage(cloudData.error, t)}</div>}
        {!inOrganizationSection && cloudData.warning && <div className="desktop-cloud-main-alert">{formatCloudMessage(cloudData.warning, t)}</div>}
        {!inOrganizationSection && cloudPublishErrorMessage && <div className="desktop-cloud-main-alert">{cloudPublishErrorMessage}</div>}
        {!inOrganizationSection && cloudAction.error && <div className="desktop-cloud-main-alert">{formatCloudMessage(cloudAction.error, t)}</div>}
        {!inOrganizationSection && cloudAction.notice && <div className="desktop-cloud-main-alert success">{formatCloudMessage(cloudAction.notice, t)}</div>}

        <CloudRouter
          workspace={workspace}
          status={status}
          cloudSession={effectiveCloudSession}
          cloudApiBaseUrl={cloudApiBaseUrl}
          cloudRemote={cloudRemote}
          cloudData={cloudData}
          projectContext={projectContext}
          activeSection={routedSection}
          accountEmail={accountEmail}
          loading={loading}
          onSessionChange={onCloudSessionChange}
          onOpenProject={handleOpenProject}
          onOpenGitSettings={onOpenGitSettings}
          onSelectSection={onSelectSection}
          onRetryContext={() => {
            void cloudData.reload();
            onRefresh();
          }}
          onUseAnotherAccount={() => onCloudSessionChange(null)}
          onRemoveCloudRemote={onRemoveCloudRemote ? () => void handleRemoveCloudRemote() : undefined}
        />
    </CloudSurfaceFrame>
  );
}
