import type { Workspace } from "@puppyone/shared-ui";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import type { CloudSpace } from "../../lib/workspaceHomeModel";
import type { DesktopUpdateState, GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../types/electron";
import type { SubThemeCatalogController } from "../themes/useSubThemeCatalog";

export type SettingsSection = "general" | "privacy" | "local-project" | "appearance" | "typography" | "local-agents" | "model-connections" | "new-menu" | "other-app-imports" | "experimental" | "git" | "files" | "account" | "space" | "seats" | "cloud" | "other-computers";

export type SettingsViewProps = {
  workspace: Workspace | null;
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
  gitStatus: GitStatusSnapshot | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  subThemeCatalog: SubThemeCatalogController;
  currentSpaceId?: string | null;
  currentSpaceName?: string | null;
  /** The account's own Space keeps the name "Personal"; it is not renamed. */
  currentSpacePersonal?: boolean;
  onSpaceChange?: () => void;
  focusSpaceInvite?: boolean;
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
  /** Heads the Space group with the square and plan the Header and Homepage show. */
  currentSpace?: CloudSpace | null;
  currentSpaceId?: string | null;
  currentSpaceName?: string | null;
  localWorkspaceAvailable?: boolean;
  activeSection: SettingsSection;
  cloudEnabled: boolean;
  onSelectSection: (section: SettingsSection) => void;
};

export type SettingsSectionNavigator = (section: SettingsSection) => void;
