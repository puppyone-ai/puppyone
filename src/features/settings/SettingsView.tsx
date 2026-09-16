import { lazy, Suspense, useState } from "react";
import {
  FILE_ICON_THEMES,
  PULSE_GRID_PRESET_FRAMES,
  PULSE_GRID_PRESET_IDS,
  FileGlyphIcon,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { getOrderedHeaderElementDefinitions } from "../app-shell/headerElements";
import {
  isAppearanceDecisionLocked,
  isAppearanceValueAllowed,
} from "../appearance/resolveAppearance";
import { useFeatureFlag } from "../flags";
import { followThemeContentFont, isFollowingThemeContentFont } from "../typography";
import { LocalAgentsSettingsView } from "../local-agents";
import { SettingsSectionHeader } from "./components";
import { AccountSettingsView } from "./main/AccountSettingsView";
import { ExperimentalSettingsView } from "./main/ExperimentalSettingsView";
import { FilesSettingsView } from "./main/FileSettingsViews";
import { GeneralSettingsView } from "./main/GeneralSettingsView";
import { LocalProjectSettingsView } from "./main/LocalProjectSettingsView";
import { PrivacySettingsView } from "./main/PrivacySettingsView";
import { InterfacePaletteSettings } from "./main/InterfacePaletteSettings";
import { InterfaceStyleSetting } from "./main/InterfaceStyleSetting";
import { SubThemeSettingsSection } from "./main/SubThemeSettingsSection";
import { CreateNewSettingsView } from "./main/CreateNewSettingsView";
import { PulseGrid } from "../../components/loading";
import { CloudHostingSettingsView, GitSettingsView } from "./main/RepositorySettingsViews";
import { isSettingsSectionAvailable } from "./sidebar/settingsSidebarModel";
import type { SettingsViewProps } from "./types";
import { writeClipboardText } from "./utils";

const TypographySettingsView = lazy(async () => {
  const module = await import("./main/TypographySettingsView");
  return { default: module.TypographySettingsView };
});

export function SettingsView({
  workspace,
  activeSection,
  gitStatus,
  gitStatusLoading,
  gitStatusError,
  interfaceStyle,
  resolvedAppearance,
  lightThemePreset,
  darkThemePreset,
  loadingAnimationPreset,
  localAgentsSettings,
  typographyPreferences,
  pointerCursors,
  requestedSubThemeId,
  subThemeCatalog,
  fileIconTheme,
  sidebarNavigationVisibilitySettings,
  filesVisibilitySettings,
  createNewMenuSettings,
  experimentalSettings,
  rightSidebarToolsSettings,
  titlebarActionsSettings,
  gitSidebarLayout,
  cloudEnabled,
  cloudSession,
  cloudSessionRestoring,
  cloudApiBaseUrl,
  puppyoneConfig,
  puppyoneConfigLoading,
  puppyoneConfigSaving,
  puppyoneConfigError,
  updateState,
  onThemeModeChange,
  onInterfaceStyleChange,
  onLoadingAnimationPresetChange,
  onLocalAgentsSettingsChange,
  onAgentFileActivityIndicatorsEnabledChange,
  onTypographyPreferencesChange,
  onPointerCursorsChange,
  onSubThemeChange,
  onFileIconThemeChange,
  onSidebarNavigationVisibilitySettingsChange,
  onFilesVisibilitySettingsChange,
  onCreateNewMenuSettingsChange,
  onExperimentalSettingsChange,
  onRightSidebarToolsSettingsChange,
  onTitlebarActionsSettingsChange,
  onGitSidebarLayoutChange,
  onCloudSessionChange,
  onPuppyoneConfigChange,
  onUnlinkWorkspace,
  onRefreshGitStatus,
  onCheckForUpdates,
  onUpdateNow,
  automaticDownloadPreferenceAvailable,
  automaticDownloadPreferenceSaving,
  automaticDownloadPreferenceError,
  onAutomaticallyDownloadUpdatesChange,
}: SettingsViewProps) {
  const { t } = useLocalization();
  const assetLibraryHomeAvailable = useFeatureFlag("assetLibraryHome");
  const [copiedRemoteKey, setCopiedRemoteKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const orderedHeaderElements = getOrderedHeaderElementDefinitions(titlebarActionsSettings.order);

  if (!isSettingsSectionAvailable(activeSection, { cloudEnabled })) {
    return (
      <GeneralSettingsView
        updateState={updateState}
        onCheckForUpdates={onCheckForUpdates}
        onUpdateNow={onUpdateNow}
        automaticDownloadPreferenceAvailable={automaticDownloadPreferenceAvailable}
        automaticDownloadPreferenceSaving={automaticDownloadPreferenceSaving}
        automaticDownloadPreferenceError={automaticDownloadPreferenceError}
        onAutomaticallyDownloadUpdatesChange={onAutomaticallyDownloadUpdatesChange}
      />
    );
  }

  if (activeSection === "general") {
    return (
      <GeneralSettingsView
        updateState={updateState}
        onCheckForUpdates={onCheckForUpdates}
        onUpdateNow={onUpdateNow}
        automaticDownloadPreferenceAvailable={automaticDownloadPreferenceAvailable}
        automaticDownloadPreferenceSaving={automaticDownloadPreferenceSaving}
        automaticDownloadPreferenceError={automaticDownloadPreferenceError}
        onAutomaticallyDownloadUpdatesChange={onAutomaticallyDownloadUpdatesChange}
      />
    );
  }

  if (activeSection === "privacy") {
    return <PrivacySettingsView />;
  }

  if (activeSection === "local-agents") {
    return (
      <LocalAgentsSettingsView
        settings={localAgentsSettings}
        onChange={onLocalAgentsSettingsChange}
        onActivityIndicatorsEnabledChange={onAgentFileActivityIndicatorsEnabledChange}
      />
    );
  }

  if (activeSection === "local-project") {
    return (
      <LocalProjectSettingsView
        workspace={workspace}
        onUnlinkWorkspace={onUnlinkWorkspace}
      />
    );
  }

  if (activeSection === "account") {
    return (
      <AccountSettingsView
        cloudSession={cloudSession}
        cloudSessionRestoring={cloudSessionRestoring}
        cloudApiBaseUrl={cloudApiBaseUrl}
        onCloudSessionChange={onCloudSessionChange}
      />
    );
  }

  const copyRemoteUrl = async (key: string, url: string) => {
    setCopyError(null);
    try {
      await writeClipboardText(url);
      setCopiedRemoteKey(key);
      window.setTimeout(() => setCopiedRemoteKey((current) => current === key ? null : current), 1500);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : String(error));
    }
  };

  if (activeSection === "git") {
    return (
      <GitSettingsView
        workspaceRoot={workspace.path}
        experimentalOptIn={experimentalSettings.enableGitAutoCommit}
        status={gitStatus}
        loading={gitStatusLoading}
        error={gitStatusError}
        copiedRemoteKey={copiedRemoteKey}
        copyError={copyError}
        onCopyRemoteUrl={copyRemoteUrl}
        onRefresh={onRefreshGitStatus}
      />
    );
  }

  if (activeSection === "cloud") {
    return (
      <CloudHostingSettingsView
        status={gitStatus}
        loading={gitStatusLoading}
        error={gitStatusError}
        copiedRemoteKey={copiedRemoteKey}
        copyError={copyError}
        puppyoneConfig={puppyoneConfig}
        puppyoneConfigLoading={puppyoneConfigLoading}
        puppyoneConfigSaving={puppyoneConfigSaving}
        puppyoneConfigError={puppyoneConfigError}
        cloudEnabled={cloudEnabled}
        onCopyRemoteUrl={copyRemoteUrl}
        onPuppyoneConfigChange={onPuppyoneConfigChange}
        onRefresh={onRefreshGitStatus}
      />
    );
  }

  if (activeSection === "files") {
    return (
      <FilesSettingsView
        settings={filesVisibilitySettings}
        onChange={onFilesVisibilitySettingsChange}
      />
    );
  }

  if (activeSection === "new-menu") {
    return (
      <CreateNewSettingsView
        settings={createNewMenuSettings}
        experimentalSettings={experimentalSettings}
        fileIconTheme={fileIconTheme}
        onChange={onCreateNewMenuSettingsChange}
      />
    );
  }

  if (activeSection === "experimental") {
    return (
      <ExperimentalSettingsView
        settings={experimentalSettings}
        assetLibraryHomeAvailable={assetLibraryHomeAvailable}
        onChange={onExperimentalSettingsChange}
      />
    );
  }

  if (activeSection === "typography") {
    return (
      <Suspense fallback={null}>
        <TypographySettingsView
          typographyPreferences={typographyPreferences}
          markdownThemeId={resolvedAppearance.subThemeId}
          onTypographyPreferencesChange={onTypographyPreferencesChange}
        />
      </Suspense>
    );
  }

  if (activeSection === "appearance") {
    const fileIconDecision = resolvedAppearance.decisions.fileIconTheme;
    const fileIconLocked = isAppearanceDecisionLocked(fileIconDecision);
    return (
      <section className="desktop-utility-view desktop-settings-view">
        <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
          <div className="desktop-settings-section">
            <SettingsSectionHeader
              title={t("settings.appearance.title")}
              detail={t("settings.appearance.detail")}
            />
            <div className="desktop-settings-list">
              <InterfaceStyleSetting value={interfaceStyle} onChange={onInterfaceStyleChange} />
              <InterfacePaletteSettings
                interfaceStyle={interfaceStyle}
                subThemeId={resolvedAppearance.subThemeId}
                decision={resolvedAppearance.decisions.themeMode}
                lightThemePreset={lightThemePreset}
                darkThemePreset={darkThemePreset}
                onThemeModeChange={onThemeModeChange}
              />
              <SubThemeSettingsSection
                catalog={subThemeCatalog}
                rootThemeId={interfaceStyle}
                requestedSubThemeId={requestedSubThemeId}
                effectiveSubThemeId={resolvedAppearance.subThemeId}
                effectiveColorMode={resolvedAppearance.effectiveColorMode}
                contentFontOverrideActive={!isFollowingThemeContentFont(typographyPreferences)}
                onSubThemeChange={onSubThemeChange}
                onUseThemeContentFont={() => onTypographyPreferencesChange(
                  followThemeContentFont(typographyPreferences),
                )}
              />
              <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row">
                <span>{t("settings.appearance.fileIcons.title")}</span>
                <div className="desktop-theme-segment desktop-appearance-option-segment" aria-label={t("settings.appearance.fileIcons.ariaLabel")}>
                  {FILE_ICON_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      className={`${fileIconDecision.effectiveValue === theme.id ? "active" : ""}${fileIconLocked || !isAppearanceValueAllowed(fileIconDecision, theme.id) ? " is-policy-controlled" : ""}`}
                      type="button"
                      title={fileIconDecision.reasonKey
                        ? t(fileIconDecision.reasonKey)
                        : t(`settings.appearance.fileIcons.${theme.id}.description`)}
                      aria-disabled={fileIconLocked || !isAppearanceValueAllowed(fileIconDecision, theme.id)}
                      aria-pressed={fileIconDecision.effectiveValue === theme.id}
                      onClick={() => {
                        if (!fileIconLocked && isAppearanceValueAllowed(fileIconDecision, theme.id)) {
                          onFileIconThemeChange(theme.id);
                        }
                      }}
                    >
                      <FileGlyphIcon name="document.md" size={14} theme={theme.id} />
                      <span>{t(`settings.appearance.fileIcons.${theme.id}.label`)}</span>
                    </button>
                  ))}
                </div>
                {fileIconDecision.reasonKey && (
                  <small className="desktop-appearance-policy-reason">{t(fileIconDecision.reasonKey)}</small>
                )}
              </div>
              <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row">
                <span>{t("settings.appearance.gitSidebarLayout.title")}</span>
                <div
                  className="desktop-theme-segment desktop-appearance-option-segment desktop-appearance-hug-segment"
                  aria-label={t("settings.appearance.gitSidebarLayout.ariaLabel")}
                >
                  {(["cards", "dividers"] as const).map((layout) => (
                    <button
                      key={layout}
                      className={gitSidebarLayout === layout ? "active" : ""}
                      type="button"
                      title={t(`settings.appearance.gitSidebarLayout.${layout}.description`)}
                      aria-pressed={gitSidebarLayout === layout}
                      onClick={() => onGitSidebarLayoutChange(layout)}
                    >
                      <span>{t(`settings.appearance.gitSidebarLayout.${layout}.label`)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row">
                <span>{t("settings.appearance.loadingAnimation.title")}</span>
                <div
                  className="desktop-theme-segment desktop-appearance-option-segment desktop-appearance-hug-segment"
                  aria-label={t("settings.appearance.loadingAnimation.ariaLabel")}
                >
                  {PULSE_GRID_PRESET_IDS.map((presetId) => (
                    <button
                      key={presetId}
                      className={loadingAnimationPreset === presetId ? "active" : ""}
                      type="button"
                      title={t(`settings.appearance.loadingAnimation.${presetId}.description`)}
                      aria-pressed={loadingAnimationPreset === presetId}
                      onClick={() => onLoadingAnimationPresetChange(presetId)}
                    >
                      <span className="desktop-loading-animation-preview" aria-hidden="true">
                        <PulseGrid
                          size="sm"
                          tone="neutral"
                          frames={PULSE_GRID_PRESET_FRAMES[presetId]}
                          ariaHidden
                        />
                      </span>
                      <span>{t(`settings.appearance.loadingAnimation.${presetId}.label`)}</span>
                    </button>
                  ))}
                </div>
              </div>
              {experimentalSettings.enableViewerPlugins && (
                <div className="desktop-settings-row desktop-settings-row-control">
                  <span title={t("settings.appearance.pluginsShortcut.detail")}>
                    {t("settings.appearance.pluginsShortcut.title")}
                  </span>
                  <label
                    className="desktop-settings-switch"
                    title={t("settings.appearance.pluginsShortcut.detail")}
                  >
                    <input
                      type="checkbox"
                      aria-label={t("settings.appearance.pluginsShortcut.title")}
                      aria-description={t("settings.appearance.pluginsShortcut.detail")}
                      checked={sidebarNavigationVisibilitySettings.enabled.plugins}
                      onChange={(event) => onSidebarNavigationVisibilitySettingsChange({
                        ...sidebarNavigationVisibilitySettings,
                        enabled: {
                          ...sidebarNavigationVisibilitySettings.enabled,
                          plugins: event.target.checked,
                        },
                      })}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
              )}
              <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row desktop-settings-tools-row">
                <span>{t("settings.appearance.headerElements.title")}</span>
                <div className="desktop-settings-tool-list">
                  {orderedHeaderElements.map((element) => {
                    const Icon = element.icon;
                    const linkedToolId = element.linkedRightSidebarToolId;
                    const actionEnabled = linkedToolId
                      ? titlebarActionsSettings.enabled[element.id] && rightSidebarToolsSettings.enabled[linkedToolId]
                      : titlebarActionsSettings.enabled[element.id];
                    return (
                      <div
                        className="desktop-settings-tool-item"
                        key={element.id}
                      >
                        <span className="desktop-settings-tool-label">
                          <Icon size={14} />
                          <span>{t(`settings.appearance.headerElements.${element.id}`)}</span>
                        </span>
                        <label className="desktop-settings-switch">
                          <input
                            type="checkbox"
                            aria-label={t(`settings.appearance.headerElements.${element.id}`)}
                            checked={actionEnabled}
                            onChange={(event) => {
                              const enabled = event.target.checked;
                              onTitlebarActionsSettingsChange({
                                ...titlebarActionsSettings,
                                enabled: {
                                  ...titlebarActionsSettings.enabled,
                                  [element.id]: enabled,
                                },
                              });
                              if (linkedToolId && rightSidebarToolsSettings.enabled[linkedToolId] !== enabled) {
                                onRightSidebarToolsSettingsChange({
                                  ...rightSidebarToolsSettings,
                                  enabled: {
                                    ...rightSidebarToolsSettings.enabled,
                                    [linkedToolId]: enabled,
                                  },
                                });
                              }
                            }}
                          />
                          <span aria-hidden="true" />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="desktop-settings-row desktop-settings-row-control">
                <span id="desktop-pointer-cursors-label">{t("settings.appearance.pointerCursors.title")}</span>
                <label
                  className="desktop-settings-switch"
                  title={t("settings.appearance.pointerCursors.detail")}
                >
                  <input
                    type="checkbox"
                    checked={pointerCursors}
                    aria-labelledby="desktop-pointer-cursors-label"
                    onChange={(event) => onPointerCursorsChange(event.target.checked)}
                  />
                  <span aria-hidden="true" />
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return assertUnreachableSettingsSection(activeSection);
}

function assertUnreachableSettingsSection(section: never): never {
  throw new Error(`Unsupported Settings section: ${String(section)}`);
}
