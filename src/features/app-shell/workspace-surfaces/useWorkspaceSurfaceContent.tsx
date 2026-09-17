import { useMemo } from "react";
import { type Workspace } from "@puppyone/shared-ui";
import type { DesktopView } from "../../../components/DesktopCloudShell";
import type { DesktopUpdatesController } from "../../updates";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { FilesVisibilitySettings } from "../../../preferences";
import type {
  CloudPublishErrorCode,
  CloudPublishProgress,
  CloudPublishState,
  PuppyoneWorkspaceConfig,
  GitStatusSnapshot,
} from "../../../types/electron";
import {
  CloudServiceMainView,
  CloudServiceSidebar,
  cloudContextHasProject,
  resolveCloudEnvironment,
  useCloudSessionForEnvironment,
  type CloudWorkspaceSection,
  type ProjectCloudContext,
} from "../../cloud";
import { getGitHostingMode, type DesktopGitController } from "../../source-control";
import { createSettingsWorkspaceSurface, type SettingsSection } from "../../settings";
import type { DesktopPreferencesController } from "../useDesktopPreferences";
import type { SubThemeCatalogController } from "../../themes/useSubThemeCatalog";
import {
  getAvailableWorkspaceSurfaces,
  resolveWorkspaceSurface,
  resolveWorkspaceSurfaceContribution,
} from "./workspaceSurfaceRegistry";
import type {
  ResolvedWorkspaceSurface,
  WorkspaceSurfaceCapabilities,
  WorkspaceSurfaceAdapters,
  WorkspaceSurfaceContent,
  WorkspaceSurfaceId,
} from "./workspaceSurfaceTypes";

export type DesktopWorkspaceCloudSurfaceController = {
  activeSection: CloudWorkspaceSection;
  projectContext?: ProjectCloudContext | null;
  backupLoading: boolean;
  backupPending: boolean;
  publishError: { code: CloudPublishErrorCode; retryable: boolean } | null;
  publishNotice: "cleanup-completed" | null;
  publishProgress: CloudPublishProgress | null;
  publishState: CloudPublishState | null;
  publishStateLoading: boolean;
  cloudApiBaseUrl: string | null;
  storedCloudSession: DesktopCloudSession | null;
  enabled: boolean;
  sessionRestoring: boolean;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onRemoveCloudRemote?: () => Promise<void>;
  onAbandonPuppyoneBackup: () => void;
  onOpenGitSettings: () => void;
  onSelectSection: (section: CloudWorkspaceSection) => void;
  onStartPuppyoneBackup: (organizationId?: string) => void;
};

export type WorkspaceSurfaceContentResult = {
  availableSurfaceIds: readonly WorkspaceSurfaceId[];
  cloudSurface: WorkspaceSurfaceContent;
  gitEnabled: boolean;
  resolvedActiveView: WorkspaceSurfaceId;
  resolvedSurface: ResolvedWorkspaceSurface;
  workspaceChangeCount: number;
};

export function useWorkspaceSurfaceContent({
  activeView,
  cloud,
  desktopUpdates,
  git,
  onFilesVisibilitySettingsChange,
  onOpenGitChanges,
  onPuppyoneConfigChange,
  onSelectSettingsSection,
  onUnlinkWorkspace,
  preferences,
  puppyoneConfig,
  puppyoneConfigError,
  puppyoneConfigLoading,
  puppyoneConfigSaving,
  settingsSection,
  subThemeCatalog,
  workspace,
}: {
  activeView: DesktopView;
  cloud: DesktopWorkspaceCloudSurfaceController;
  desktopUpdates: DesktopUpdatesController;
  git: DesktopGitController;
  onFilesVisibilitySettingsChange: (settings: FilesVisibilitySettings) => void;
  onOpenGitChanges: () => void;
  onPuppyoneConfigChange: (config: PuppyoneWorkspaceConfig) => Promise<PuppyoneWorkspaceConfig | null>;
  onSelectSettingsSection: (section: SettingsSection) => void;
  onUnlinkWorkspace: () => Promise<void>;
  preferences: DesktopPreferencesController;
  puppyoneConfig: PuppyoneWorkspaceConfig | null;
  puppyoneConfigError: string | null;
  puppyoneConfigLoading: boolean;
  puppyoneConfigSaving: boolean;
  settingsSection: SettingsSection;
  subThemeCatalog: SubThemeCatalogController;
  workspace: Workspace;
}): WorkspaceSurfaceContentResult {
  const surfaceCapabilities = useMemo<WorkspaceSurfaceCapabilities>(() => ({
    cloudEnabled: cloud.enabled,
  }), [cloud.enabled]);
  const requestedSurfaceId = activeView === "git" || activeView === "cloud" ? "data" : activeView;
  const resolvedActiveView = resolveWorkspaceSurfaceContribution(requestedSurfaceId, surfaceCapabilities).id;
  const availableSurfaceIds = useMemo(
    () => getAvailableWorkspaceSurfaces(surfaceCapabilities)
      .map(({ id }) => id)
      .filter((id) => id !== "git"),
    [surfaceCapabilities],
  );
  const gitEnabled = true;
  const gitHostingMode = getGitHostingMode(git.activeGitStatus, puppyoneConfig);
  const workspaceChangeCount = gitEnabled
    ? getDesktopWorkspaceChangeCount(git.activeGitStatus, gitHostingMode === "github")
    : 0;
  const projectContext = cloud.projectContext ?? { status: "local-only" as const, projectId: null };
  const localOnlyWorkspaceContext = (
    projectContext.status === "local-only"
    || cloud.publishState !== null
    || cloud.publishStateLoading
    || (cloud.activeSection === "initialize" && git.activeGitStatus === null)
  );
  const cloudEnvironment = useMemo(
    () => resolveCloudEnvironment({
      status: git.activeGitStatus,
      desktopApiBaseUrl: cloud.cloudApiBaseUrl,
    }),
    [cloud.cloudApiBaseUrl, git.activeGitStatus],
  );
  const cloudAuthState = useCloudSessionForEnvironment({
    cloudSession: cloud.storedCloudSession,
    sessionRestoring: cloud.sessionRestoring,
    restoreEnabled: !localOnlyWorkspaceContext,
    environment: cloudEnvironment,
    onCloudSessionChange: cloud.onCloudSessionChange,
  });
  const settingsSurface = createSettingsWorkspaceSurface({
    workspace,
    activeSection: settingsSection,
    onSelectSection: onSelectSettingsSection,
    preferences,
    subThemeCatalog,
    onFilesVisibilitySettingsChange,
    git: {
      status: git.activeGitStatus,
      loading: git.gitStatusLoading,
      error: git.gitStatusError,
      refresh: git.refreshGitStatus,
    },
    cloud: {
      enabled: cloud.enabled,
      session: cloud.storedCloudSession,
      sessionRestoring: cloud.sessionRestoring,
      apiBaseUrl: cloud.cloudApiBaseUrl,
      onSessionChange: cloud.onCloudSessionChange,
    },
    workspaceConfig: {
      value: puppyoneConfig,
      loading: puppyoneConfigLoading,
      saving: puppyoneConfigSaving,
      error: puppyoneConfigError,
      change: onPuppyoneConfigChange,
      unlink: onUnlinkWorkspace,
    },
    updates: {
      state: desktopUpdates.state,
      check: desktopUpdates.checkForUpdates,
      install: desktopUpdates.updateNow,
      automaticDownloadPreferenceAvailable: desktopUpdates.automaticDownloadPreferenceAvailable,
      automaticDownloadPreferenceSaving: desktopUpdates.automaticDownloadPreferenceSaving,
      automaticDownloadPreferenceError: desktopUpdates.automaticDownloadPreferenceError,
      setAutomaticallyDownloadUpdates: desktopUpdates.setAutomaticallyDownloadUpdates,
    },
  });
  const cloudServiceSurface = {
    sidebar: (
      <CloudServiceSidebar
        cloudAuthState={cloudAuthState}
        activeSection={cloud.activeSection}
        automationEnabled={preferences.experimentalSettings.enableCloudAutomation}
        projectAvailable={cloudContextHasProject(projectContext)}
        projectCapabilities={projectContext.status === "resolved"
          ? projectContext.capabilities ?? []
          : []}
        onSelectSection={cloud.onSelectSection}
      />
    ),
    main: (
      <CloudServiceMainView
        workspace={workspace}
        status={git.activeGitStatus}
        cloudEnvironment={cloudEnvironment}
        cloudAuthState={cloudAuthState}
        projectContext={projectContext}
        onCloudSessionChange={cloud.onCloudSessionChange}
        activeSection={cloud.activeSection}
        automationEnabled={preferences.experimentalSettings.enableCloudAutomation}
        loading={git.gitStatusLoading}
        error={git.gitStatusError}
        cloudBackupLoading={cloud.backupLoading}
        cloudBackupPending={cloud.backupPending}
        cloudPublishError={cloud.publishError}
        cloudPublishNotice={cloud.publishNotice}
        cloudPublishProgress={cloud.publishProgress}
        cloudPublishState={cloud.publishState}
        cloudPublishStateLoading={cloud.publishStateLoading}
        onAbandonPuppyoneBackup={cloud.onAbandonPuppyoneBackup}
        onStartPuppyoneBackup={cloud.onStartPuppyoneBackup}
        onRemoveCloudRemote={cloud.onRemoveCloudRemote}
        onSelectSection={cloud.onSelectSection}
        onRefresh={git.refreshGitStatus}
        onOpenGitSettings={cloud.onOpenGitSettings}
        onOpenSourceControl={onOpenGitChanges}
      />
    ),
  };
  const adapters: WorkspaceSurfaceAdapters = {
    data: () => ({ sidebar: null, main: null }),
    // "git" is retained only as a migration-safe legacy route. All active
    // source-control work now lives in the Changes right sidebar.
    git: () => ({ sidebar: null, main: null }),
    cloud: () => cloudServiceSurface,
    settings: () => settingsSurface,
  };
  return {
    availableSurfaceIds,
    cloudSurface: cloudServiceSurface,
    gitEnabled,
    resolvedActiveView,
    resolvedSurface: resolveWorkspaceSurface({ capabilities: surfaceCapabilities, adapters, requestedId: requestedSurfaceId }),
    workspaceChangeCount,
  };
}

function getDesktopWorkspaceChangeCount(
  status: GitStatusSnapshot | null,
  includeCommittedChanges: boolean,
) {
  if (!status?.isRepo) return 0;
  const localChangeCount = status.stagedEntries.length
    + status.unstagedEntries.length
    + status.untrackedEntries.length;
  return localChangeCount + (includeCommittedChanges ? Math.max(0, status.sourceControl.remote.ahead) : 0);
}
