import { useDesktopPreference } from "../../settings";
import { useMemo, type ReactNode } from "react";
import { type Workspace } from "@puppyone/shared-ui";
import type { DesktopView } from "../../../components/ProjectShell";
import type { DesktopUpdatesController } from "../../updates";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type {
  CloudPublishErrorCode,
  CloudPublishProgress,
  CloudPublishState,
  PuppyoneWorkspaceConfig,
  GitStatusSnapshot,
} from "../../../types/electron";
import {
  CloudFileWorkspaceGate,
  CloudPublishTask,
  type CloudProjectPreparationProps,
  resolveCloudEnvironment,
  useCloudSessionForEnvironment,
  type ProjectCloudContext,
} from "../../cloud";
import { getGitHostingMode, type DesktopGitController } from "../../source-control";
import { createSettingsWorkspaceSurface, type SettingsSection } from "../../settings";
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
  WorkspaceSurfaceId,
} from "./workspaceSurfaceTypes";

export type DesktopWorkspaceCloudSurfaceController = {
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
  onAbandonPuppyoneBackup: () => void;
  onOpenGitSettings: () => void;
  onOpenCloudProject: (projectId: string) => void;
  onStartPuppyoneBackup: (organizationId?: string) => void;
};

export type WorkspaceSurfaceContentResult = {
  availableSurfaceIds: readonly WorkspaceSurfaceId[];
  cloudPublishTask: ReactNode;
  cloudFileState: ReactNode;
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
  onFilesVisibilityChange,
  onOpenGitChanges,
  onOpenImport,
  onPuppyoneConfigChange,
  onSelectSettingsSection,
  onUnlinkWorkspace,
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
  onFilesVisibilityChange: () => void;
  onOpenGitChanges: () => void;
  onOpenImport: () => void;
  onPuppyoneConfigChange: (config: PuppyoneWorkspaceConfig) => Promise<PuppyoneWorkspaceConfig | null>;
  onSelectSettingsSection: (section: SettingsSection) => void;
  onUnlinkWorkspace: () => Promise<void>;
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
    || git.activeGitStatus === null
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
    // A published project must not restore a Cloud session while Cloud is off.
    restoreEnabled: cloud.enabled && !localOnlyWorkspaceContext,
    environment: cloudEnvironment,
    onCloudSessionChange: cloud.onCloudSessionChange,
  });
  const settingsSurface = createSettingsWorkspaceSurface({
    workspace,
    activeSection: settingsSection,
    onSelectSection: onSelectSettingsSection,
    onOpenImport,
    subThemeCatalog,
    onFilesVisibilityChange,
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
  const cloudViewProps: CloudProjectPreparationProps = {
    workspace,
    status: git.activeGitStatus,
    cloudEnvironment,
    cloudAuthState,
    projectContext,
    onCloudSessionChange: cloud.onCloudSessionChange,
    loading: git.gitStatusLoading,
    error: git.gitStatusError,
    cloudBackupLoading: cloud.backupLoading,
    cloudBackupPending: cloud.backupPending,
    cloudPublishError: cloud.publishError,
    cloudPublishNotice: cloud.publishNotice,
    cloudPublishProgress: cloud.publishProgress,
    cloudPublishState: cloud.publishState,
    cloudPublishStateLoading: cloud.publishStateLoading,
    onAbandonPuppyoneBackup: cloud.onAbandonPuppyoneBackup,
    onStartPuppyoneBackup: cloud.onStartPuppyoneBackup,
    onRefresh: git.refreshGitStatus,
    onOpenGitSettings: cloud.onOpenGitSettings,
  };
  const adapters: WorkspaceSurfaceAdapters = {
    data: () => ({ sidebar: null, main: null }),
    // "git" is retained only as a migration-safe legacy route. All active
    // source-control work now lives in the Changes right sidebar.
    git: () => ({ sidebar: null, main: null }),
    cloud: () => ({ sidebar: null, main: null }),
    settings: () => settingsSurface,
  };
  return {
    availableSurfaceIds,
    cloudPublishTask: <CloudPublishTask {...cloudViewProps} onOpenCloudProject={cloud.onOpenCloudProject} />,
    cloudFileState: <CloudFileWorkspaceGate {...cloudViewProps} />,
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
