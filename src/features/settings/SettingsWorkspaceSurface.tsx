import { useDesktopPreference } from "../../preferencesStore";
import { useDesktopAppearance } from "./useDesktopAppearance";
import type { Workspace } from "@puppyone/shared-ui";
import type { FilesVisibilitySettings } from "../../preferences";
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
  onFilesVisibilitySettingsChange: (settings: FilesVisibilitySettings) => void;
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
  onFilesVisibilitySettingsChange,
  onOpenImport,
  onSelectSection,
  subThemeCatalog,
  updates,
  workspace,
  workspaceConfig,
}: SettingsWorkspaceSurfaceProps) {
  return {
    sidebar: (
      <SettingsWorkspaceSidebar
        activeSection={activeSection}
        cloudEnabled={cloud.enabled}
        onSelectSection={onSelectSection}
      />
    ),
    main: <SettingsWorkspaceMain {...{ workspace, activeSection, cloud, git, onFilesVisibilitySettingsChange, onOpenImport,
      onSelectSection, subThemeCatalog, updates, workspaceConfig }} />,
  } as const;
}

function SettingsWorkspaceMain({ workspace, activeSection, cloud, git, onFilesVisibilitySettingsChange, onOpenImport, subThemeCatalog, updates, workspaceConfig }: SettingsWorkspaceSurfaceProps) {
  const { darkThemePreset, fileIconTheme, lightThemePreset, requestedSubThemeId, resolvedAppearance, themeMode } = useDesktopAppearance();
  const createNewMenuSettings = useDesktopPreference(s => s.createNewMenuSettings);
  const experimentalSettings = useDesktopPreference(s => s.experimentalSettings);
  const filesVisibilitySettings = useDesktopPreference(s => s.filesVisibilitySettings);
  const gitSidebarLayout = useDesktopPreference(s => s.gitSidebarLayout);
  const interfaceStyle = useDesktopPreference(s => s.interfaceStyle);
  const loadingAnimationPreset = useDesktopPreference(s => s.loadingAnimationPreset);
  const localAgentsSettings = useDesktopPreference(s => s.localAgentsSettings);
  const pointerCursors = useDesktopPreference(s => s.pointerCursors);
  const rightSidebarToolsSettings = useDesktopPreference(s => s.rightSidebarToolsSettings);
  const setAgentFileActivityIndicatorsEnabled = useDesktopPreference(s => s.setAgentFileActivityIndicatorsEnabled);
  const setCreateNewMenuSettings = useDesktopPreference(s => s.setCreateNewMenuSettings);
  const setExperimentalSettings = useDesktopPreference(s => s.setExperimentalSettings);
  const setFileIconTheme = useDesktopPreference(s => s.setFileIconTheme);
  const setGitSidebarLayout = useDesktopPreference(s => s.setGitSidebarLayout);
  const setInterfaceStyle = useDesktopPreference(s => s.setInterfaceStyle);
  const setLoadingAnimationPreset = useDesktopPreference(s => s.setLoadingAnimationPreset);
  const setLocalAgentsSettings = useDesktopPreference(s => s.setLocalAgentsSettings);
  const setPointerCursors = useDesktopPreference(s => s.setPointerCursors);
  const setRightSidebarToolsSettings = useDesktopPreference(s => s.setRightSidebarToolsSettings);
  const setSubThemeId = useDesktopPreference(s => s.setSubThemeId);
  const setThemeMode = useDesktopPreference(s => s.setThemeMode);
  const setTitlebarActionsSettings = useDesktopPreference(s => s.setTitlebarActionsSettings);
  const setTypographyPreferences = useDesktopPreference(s => s.setTypographyPreferences);
  const titlebarActionsSettings = useDesktopPreference(s => s.titlebarActionsSettings);
  const typographyPreferences = useDesktopPreference(s => s.typographyPreferences);
  return (
      <SettingsView
        workspace={workspace}
        activeSection={activeSection}
        gitStatus={git.status}
        gitStatusLoading={git.loading}
        gitStatusError={git.error}
        themeMode={themeMode}
        interfaceStyle={interfaceStyle}
        resolvedAppearance={resolvedAppearance}
        lightThemePreset={lightThemePreset}
        darkThemePreset={darkThemePreset}
        loadingAnimationPreset={loadingAnimationPreset}
        localAgentsSettings={localAgentsSettings}
        typographyPreferences={typographyPreferences}
        pointerCursors={pointerCursors}
        requestedSubThemeId={requestedSubThemeId}
        subThemeCatalog={subThemeCatalog}
        fileIconTheme={fileIconTheme}
        filesVisibilitySettings={filesVisibilitySettings}
        createNewMenuSettings={createNewMenuSettings}
        experimentalSettings={experimentalSettings}
        rightSidebarToolsSettings={rightSidebarToolsSettings}
        titlebarActionsSettings={titlebarActionsSettings}
        gitSidebarLayout={gitSidebarLayout}
        cloudEnabled={cloud.enabled}
        cloudSession={cloud.session}
        cloudSessionRestoring={cloud.sessionRestoring}
        cloudApiBaseUrl={cloud.apiBaseUrl}
        puppyoneConfig={workspaceConfig.value}
        puppyoneConfigLoading={workspaceConfig.loading}
        puppyoneConfigSaving={workspaceConfig.saving}
        puppyoneConfigError={workspaceConfig.error}
        updateState={updates.state}
        onThemeModeChange={setThemeMode}
        onInterfaceStyleChange={setInterfaceStyle}
        onLoadingAnimationPresetChange={setLoadingAnimationPreset}
        onLocalAgentsSettingsChange={setLocalAgentsSettings}
        onAgentFileActivityIndicatorsEnabledChange={setAgentFileActivityIndicatorsEnabled}
        onTypographyPreferencesChange={setTypographyPreferences}
        onPointerCursorsChange={setPointerCursors}
        onSubThemeChange={setSubThemeId}
        onFileIconThemeChange={setFileIconTheme}
        onFilesVisibilitySettingsChange={onFilesVisibilitySettingsChange}
        onCreateNewMenuSettingsChange={setCreateNewMenuSettings}
        onOpenImport={onOpenImport}
        onExperimentalSettingsChange={setExperimentalSettings}
        onRightSidebarToolsSettingsChange={setRightSidebarToolsSettings}
        onTitlebarActionsSettingsChange={setTitlebarActionsSettings}
        onGitSidebarLayoutChange={setGitSidebarLayout}
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
    );
}

function SettingsWorkspaceSidebar(props: Omit<Parameters<typeof SettingsSidebar>[0], "otherAppImportsEnabled">) {
  const otherAppImportsEnabled = useDesktopPreference(s => s.experimentalSettings.enableOtherAppImports);
  return <SettingsSidebar {...props} otherAppImportsEnabled={otherAppImportsEnabled} />;
}
