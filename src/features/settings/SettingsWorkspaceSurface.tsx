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
  workspace: Workspace;
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
}: SettingsWorkspaceSurfaceProps) {
  return {
    sidebar: (
      <SettingsSidebar
        activeSection={activeSection}
        cloudEnabled={cloud.enabled}
        onSelectSection={onSelectSection}
      />
    ),
    main: (
      <SettingsView
        workspace={workspace}
        activeSection={activeSection}
        gitStatus={git.status}
        gitStatusLoading={git.loading}
        gitStatusError={git.error}
        subThemeCatalog={subThemeCatalog}
        cloudEnabled={cloud.enabled}
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
