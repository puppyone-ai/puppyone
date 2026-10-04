import type { Workspace } from "@puppyone/shared-ui";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import type { DesktopUpdateState, GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../types/electron";
import type { SubThemeCatalogController } from "../themes/useSubThemeCatalog";

export type SettingsSection = "general" | "privacy" | "local-project" | "appearance" | "typography" | "local-agents" | "model-connections" | "new-menu" | "other-app-imports" | "experimental" | "git" | "files" | "account" | "cloud";

export type SettingsViewProps = {
  workspace: Workspace;
  activeSection: SettingsSection;
  gitStatus: GitStatusSnapshot | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  subThemeCatalog: SubThemeCatalogController;
  cloudEnabled: boolean;
  cloudSession: DesktopCloudSession | null;
  cloudSessionRestoring: boolean;
  cloudApiBaseUrl: string | null;
  puppyoneConfig: PuppyoneWorkspaceConfig | null;
  puppyoneConfigLoading: boolean;
  puppyoneConfigSaving: boolean;
  puppyoneConfigError: string | null;
  updateState: DesktopUpdateState;
  onFilesVisibilityChange: () => void;
  onOpenImport: () => void;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onPuppyoneConfigChange: (config: PuppyoneWorkspaceConfig) => Promise<PuppyoneWorkspaceConfig | null>;
  onUnlinkWorkspace: () => Promise<void>;
  onRefreshGitStatus: () => void;
  onCheckForUpdates: () => void;
  onUpdateNow: () => void;
  automaticDownloadPreferenceAvailable: boolean;
  automaticDownloadPreferenceSaving: boolean;
  automaticDownloadPreferenceError: boolean;
  onAutomaticallyDownloadUpdatesChange: (enabled: boolean) => void;
};

export type SettingsSidebarProps = {
  activeSection: SettingsSection;
  cloudEnabled: boolean;
  onSelectSection: (section: SettingsSection) => void;
};
