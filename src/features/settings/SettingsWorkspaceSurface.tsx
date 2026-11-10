import type { ReactNode } from "react";
import type { CloudSpace } from "../../lib/workspaceHomeModel";
import type { Workspace } from "@puppyone/shared-ui";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import type {
  DesktopUpdateState,
  GitStatusSnapshot,
  PuppyoneWorkspaceConfig,
} from "../../types/electron";
import { SettingsView } from "./SettingsView";
import type { SubThemeCatalogController } from "../themes/useSubThemeCatalog";
import { SettingsSidebar } from "./sidebar";
import type { SettingsSection } from "./types";

export type SettingsWorkspaceSurfaceProps = {
  workspace: Workspace | null;
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
  subThemeCatalog: SubThemeCatalogController;
  onFilesVisibilityChange: () => void;
  onOpenImport: () => void;
  git: {
    status: GitStatusSnapshot | null;
    loading: boolean;
    error: string | null;
    refresh: () => void;
  };
  cloud: {
    spaces?: readonly CloudSpace[];
    spaceId?: string | null;
    spaceName?: string | null;
    onSpaceChange?: () => void;
    focusSpaceInvite?: boolean;
    enabled: boolean;
    session: DesktopCloudSession | null;
    sessionRestoring: boolean;
    apiBaseUrl: string | null;
    onSessionChange: (session: DesktopCloudSession | null) => void;
  };
  workspaceConfig: {
    value: PuppyoneWorkspaceConfig | null;
    loading: boolean;
    saving: boolean;
    error: string | null;
    change: (config: PuppyoneWorkspaceConfig) => Promise<PuppyoneWorkspaceConfig | null>;
    unlink: () => Promise<void>;
  };
  updates: {
    state: DesktopUpdateState;
    check: () => unknown;
    install: () => unknown;
    automaticDownloadPreferenceAvailable: boolean;
    automaticDownloadPreferenceSaving: boolean;
    automaticDownloadPreferenceError: boolean;
    setAutomaticallyDownloadUpdates: (enabled: boolean) => unknown;
  };
};

export function createSettingsWorkspaceSurface({
  activeSection,
  cloud,
  git,
  onFilesVisibilityChange,
  onOpenImport,
  onSelectSection,
  subThemeCatalog,
  updates,
  workspace,
  workspaceConfig,
}: SettingsWorkspaceSurfaceProps, spaceHeading?: ReactNode) {
  return {
    sidebar: (
      <SettingsSidebar
        currentSpaceId={cloud.spaceId}
        currentSpaceName={cloud.spaceName}
        spaceHeading={spaceHeading}
        activeSection={activeSection}
        cloudEnabled={cloud.enabled}
        localWorkspaceAvailable={workspace !== null}
        onSelectSection={onSelectSection}
      />
    ),
    main: (
      <SettingsView
        workspace={workspace}
        activeSection={activeSection}
        onSelectSection={onSelectSection}
        gitStatus={git.status}
        gitStatusLoading={git.loading}
        gitStatusError={git.error}
        subThemeCatalog={subThemeCatalog}
        cloudEnabled={cloud.enabled}
        currentSpaceId={cloud.spaceId}
        currentSpaceName={cloud.spaceName}
        onSpaceChange={cloud.onSpaceChange}
        focusSpaceInvite={cloud.focusSpaceInvite}
        cloudSession={cloud.session}
        cloudSessionRestoring={cloud.sessionRestoring}
        cloudApiBaseUrl={cloud.apiBaseUrl}
        puppyoneConfig={workspaceConfig.value}
        puppyoneConfigLoading={workspaceConfig.loading}
        puppyoneConfigSaving={workspaceConfig.saving}
        puppyoneConfigError={workspaceConfig.error}
        updateState={updates.state}
        onFilesVisibilityChange={onFilesVisibilityChange}
        onOpenImport={onOpenImport}
        onCloudSessionChange={cloud.onSessionChange}
        onPuppyoneConfigChange={workspaceConfig.change}
        onUnlinkWorkspace={workspaceConfig.unlink}
        onRefreshGitStatus={git.refresh}
        onCheckForUpdates={() => void updates.check()}
        onUpdateNow={() => void updates.install()}
        automaticDownloadPreferenceAvailable={updates.automaticDownloadPreferenceAvailable}
        automaticDownloadPreferenceSaving={updates.automaticDownloadPreferenceSaving}
        automaticDownloadPreferenceError={updates.automaticDownloadPreferenceError}
        onAutomaticallyDownloadUpdatesChange={(enabled) => void updates.setAutomaticallyDownloadUpdates(enabled)}
      />
    ),
  } as const;
}
