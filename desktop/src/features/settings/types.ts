import type { FileIconThemeId, Workspace } from "@puppyone/shared-ui";
import type { DesktopUpdateState, GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../types/electron";
import type { FilesVisibilitySettings, GitDisplayMode, RightSidebarToolsSettings, SidebarNavigationLayout, ThemeMode } from "../../preferences";

export type SettingsSection = "workspace" | "editor" | "git" | "appearance" | "files";

export type SettingsViewProps = {
  workspace: Workspace;
  activeSection: SettingsSection;
  gitStatus: GitStatusSnapshot | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  themeMode: ThemeMode;
  gitDisplayMode: GitDisplayMode;
  fileIconTheme: FileIconThemeId;
  sidebarNavigationLayout: SidebarNavigationLayout;
  filesVisibilitySettings: FilesVisibilitySettings;
  rightSidebarToolsSettings: RightSidebarToolsSettings;
  aiEditAssistEnabled: boolean;
  puppyoneConfig: PuppyoneWorkspaceConfig | null;
  puppyoneConfigLoading: boolean;
  puppyoneConfigSaving: boolean;
  puppyoneConfigError: string | null;
  updateState: DesktopUpdateState;
  onThemeModeChange: (mode: ThemeMode) => void;
  onGitDisplayModeChange: (mode: GitDisplayMode) => void;
  onFileIconThemeChange: (theme: FileIconThemeId) => void;
  onSidebarNavigationLayoutChange: (layout: SidebarNavigationLayout) => void;
  onFilesVisibilitySettingsChange: (settings: FilesVisibilitySettings) => void;
  onRightSidebarToolsSettingsChange: (settings: RightSidebarToolsSettings) => void;
  onAiEditAssistEnabledChange: (enabled: boolean) => void;
  onPuppyoneConfigChange: (config: PuppyoneWorkspaceConfig) => Promise<PuppyoneWorkspaceConfig | null>;
  onUnlinkWorkspace: () => Promise<void>;
  onRefreshGitStatus: () => void;
  onCheckForUpdates: () => void;
  onUpdateNow: () => void;
};

export type SettingsSidebarProps = {
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
};
