import type { FileIconThemeId, Workspace } from "@puppyone/shared-ui";
import type {
  DarkThemePreset,
  CreateNewMenuSettings,
  ExperimentalSettings,
  FilesVisibilitySettings,
  InterfaceStyle,
  GitSidebarLayout,
  LightThemePreset,
  LoadingAnimationPreset,
  LocalAgentsSettings,
  RightSidebarToolsSettings,
  ThemeMode,
  TitlebarActionsSettings,
  TypographyPreferences,
} from "../../preferences";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import type {
  DesktopUpdateState,
  GitStatusSnapshot,
  PuppyoneWorkspaceConfig,
} from "../../types/electron";
import { SettingsView } from "./SettingsView";
import type { ResolvedAppearance } from "../appearance/resolveAppearance";
import type { MarkdownPresentationSettings } from "../markdown/markdownPresentation";
import type { SubThemeCatalogController } from "../themes/useSubThemeCatalog";
import { SettingsSidebar } from "./sidebar";
import type { SettingsSection } from "./types";

export type SettingsPreferencesPort = {
  themeMode: ThemeMode;
  interfaceStyle: InterfaceStyle;
  resolvedAppearance: ResolvedAppearance;
  lightThemePreset: LightThemePreset;
  darkThemePreset: DarkThemePreset;
  loadingAnimationPreset: LoadingAnimationPreset;
  localAgentsSettings: LocalAgentsSettings;
  typographyPreferences: TypographyPreferences;
  pointerCursors: boolean;
  markdownPresentation: MarkdownPresentationSettings;
  requestedSubThemeId: string;
  fileIconTheme: FileIconThemeId;
  filesVisibilitySettings: FilesVisibilitySettings;
  createNewMenuSettings: CreateNewMenuSettings;
  experimentalSettings: ExperimentalSettings;
  rightSidebarToolsSettings: RightSidebarToolsSettings;
  titlebarActionsSettings: TitlebarActionsSettings;
  gitSidebarLayout: GitSidebarLayout;
  setThemeMode: (value: ThemeMode) => void;
  setInterfaceStyle: (value: InterfaceStyle) => void;
  setLoadingAnimationPreset: (value: LoadingAnimationPreset) => void;
  setLocalAgentsSettings: (value: LocalAgentsSettings) => void;
  setAgentFileActivityIndicatorsEnabled: (value: boolean) => void;
  setTypographyPreferences: (value: TypographyPreferences) => void;
  setPointerCursors: (value: boolean) => void;
  setMarkdownPresentation: (value: MarkdownPresentationSettings) => void;
  setSubThemeId: (subThemeId: string) => void;
  setFileIconTheme: (value: FileIconThemeId) => void;
  setCreateNewMenuSettings: (value: CreateNewMenuSettings) => void;
  setExperimentalSettings: (value: ExperimentalSettings) => void;
  setRightSidebarToolsSettings: (value: RightSidebarToolsSettings) => void;
  setTitlebarActionsSettings: (value: TitlebarActionsSettings) => void;
  setGitSidebarLayout: (value: GitSidebarLayout) => void;
};

export type SettingsWorkspaceSurfaceProps = {
  workspace: Workspace;
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
  preferences: SettingsPreferencesPort;
  subThemeCatalog: SubThemeCatalogController;
  onFilesVisibilitySettingsChange: (settings: FilesVisibilitySettings) => void;
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
  onFilesVisibilitySettingsChange,
  onSelectSection,
  preferences,
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
        themeMode={preferences.themeMode}
        interfaceStyle={preferences.interfaceStyle}
        resolvedAppearance={preferences.resolvedAppearance}
        lightThemePreset={preferences.lightThemePreset}
        darkThemePreset={preferences.darkThemePreset}
        loadingAnimationPreset={preferences.loadingAnimationPreset}
        localAgentsSettings={preferences.localAgentsSettings}
        typographyPreferences={preferences.typographyPreferences}
        pointerCursors={preferences.pointerCursors}
        requestedSubThemeId={preferences.requestedSubThemeId}
        subThemeCatalog={subThemeCatalog}
        fileIconTheme={preferences.fileIconTheme}
        filesVisibilitySettings={preferences.filesVisibilitySettings}
        createNewMenuSettings={preferences.createNewMenuSettings}
        experimentalSettings={preferences.experimentalSettings}
        rightSidebarToolsSettings={preferences.rightSidebarToolsSettings}
        titlebarActionsSettings={preferences.titlebarActionsSettings}
        gitSidebarLayout={preferences.gitSidebarLayout}
        cloudEnabled={cloud.enabled}
        cloudSession={cloud.session}
        cloudSessionRestoring={cloud.sessionRestoring}
        cloudApiBaseUrl={cloud.apiBaseUrl}
        puppyoneConfig={workspaceConfig.value}
        puppyoneConfigLoading={workspaceConfig.loading}
        puppyoneConfigSaving={workspaceConfig.saving}
        puppyoneConfigError={workspaceConfig.error}
        updateState={updates.state}
        onThemeModeChange={preferences.setThemeMode}
        onInterfaceStyleChange={preferences.setInterfaceStyle}
        onLoadingAnimationPresetChange={preferences.setLoadingAnimationPreset}
        onLocalAgentsSettingsChange={preferences.setLocalAgentsSettings}
        onAgentFileActivityIndicatorsEnabledChange={preferences.setAgentFileActivityIndicatorsEnabled}
        onTypographyPreferencesChange={preferences.setTypographyPreferences}
        onPointerCursorsChange={preferences.setPointerCursors}
        onSubThemeChange={preferences.setSubThemeId}
        onFileIconThemeChange={preferences.setFileIconTheme}
        onFilesVisibilitySettingsChange={onFilesVisibilitySettingsChange}
        onCreateNewMenuSettingsChange={preferences.setCreateNewMenuSettings}
        onExperimentalSettingsChange={preferences.setExperimentalSettings}
        onRightSidebarToolsSettingsChange={preferences.setRightSidebarToolsSettings}
        onTitlebarActionsSettingsChange={preferences.setTitlebarActionsSettings}
        onGitSidebarLayoutChange={preferences.setGitSidebarLayout}
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
