import { Tooltip, FILE_ICON_THEMES, PULSE_GRID_PRESET_FRAMES, PULSE_GRID_PRESET_IDS, FileGlyphIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { TITLEBAR_ACTION_IDS } from "../../../preferences";
import { AgentEntryIcon } from "../../../components/brand/AgentEntryIcon";
import { VersionControlIcon } from "../../source-control";
import { isAppearanceDecisionLocked, isAppearanceValueAllowed } from "../../appearance";
import { PulseGrid } from "../../../components/loading";
import { useDesktopPreference } from "../../../preferencesStore";
import { useDesktopAppearance } from "../useDesktopAppearance";
import { SettingsSectionHeader } from "../components";
import { InterfacePaletteSettings } from "./InterfacePaletteSettings";
import { InterfaceStyleSetting } from "./InterfaceStyleSetting";
import { SubThemeSettingsSection } from "./SubThemeSettingsSection";
import type { SubThemeCatalogController } from "../../themes";

export function AppearanceSettingsView({ subThemeCatalog }: { subThemeCatalog: SubThemeCatalogController }) {
  const { t } = useLocalization();
  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title={t("settings.appearance.title")} />
          <div className="desktop-settings-list desktop-settings-lead-list">
            <InterfacePaletteSettings />
            <SubThemeSettingsSection catalog={subThemeCatalog} />
            <FileIconSetting />
            <GitSidebarLayoutSetting />
            <LoadingAnimationSetting />
            <HeaderElementsSetting />
            <PointerCursorSetting />
            <InterfaceStyleSetting />
          </div>
        </div>
      </div>
    </section>
  );
}

function FileIconSetting() {
  const { t } = useLocalization();
  const { resolvedAppearance } = useDesktopAppearance();
  const fileIconDecision = resolvedAppearance.decisions.fileIconTheme;
  const fileIconLocked = isAppearanceDecisionLocked(fileIconDecision);
  const onFileIconThemeChange = useDesktopPreference(s => s.setFileIconTheme);
  return (
    <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row">
      <span>{t("settings.appearance.fileIcons.title")}</span>
      <div className="desktop-theme-segment desktop-appearance-option-segment" aria-label={t("settings.appearance.fileIcons.ariaLabel")}>
        {FILE_ICON_THEMES.map((theme) => (
          <Tooltip content={fileIconDecision.reasonKey ? t(fileIconDecision.reasonKey) : undefined} key={theme.id}><button
            className={`${fileIconDecision.effectiveValue === theme.id ? "active" : ""}${fileIconLocked || !isAppearanceValueAllowed(fileIconDecision, theme.id) ? " is-policy-controlled" : ""}`}
            type="button"
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
          </button></Tooltip>
        ))}
      </div>
      {fileIconDecision.reasonKey && (
        <small className="desktop-appearance-policy-reason">{t(fileIconDecision.reasonKey)}</small>
      )}
    </div>
  );
}

function GitSidebarLayoutSetting() {
  const { t } = useLocalization();
  const gitSidebarLayout = useDesktopPreference(s => s.gitSidebarLayout);
  const onGitSidebarLayoutChange = useDesktopPreference(s => s.setGitSidebarLayout);
  return (
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
            aria-pressed={gitSidebarLayout === layout}
            onClick={() => onGitSidebarLayoutChange(layout)}
          >
            <span>{t(`settings.appearance.gitSidebarLayout.${layout}.label`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LoadingAnimationSetting() {
  const { t } = useLocalization();
  const loadingAnimationPreset = useDesktopPreference(s => s.loadingAnimationPreset);
  const onLoadingAnimationPresetChange = useDesktopPreference(s => s.setLoadingAnimationPreset);
  return (
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
  );
}

function HeaderElementsSetting() {
  const { t } = useLocalization();
  const titlebarActionsSettings = useDesktopPreference(s => s.titlebarActionsSettings);
  const terminalToolEnabled = useDesktopPreference(s => s.rightSidebarToolsSettings.enabled.terminal);
  const onTitlebarActionsSettingsChange = useDesktopPreference(s => s.setTitlebarActionsSettings);
  const onRightSidebarToolsSettingsChange = useDesktopPreference(s => s.setRightSidebarToolsSettings);
  const orderedHeaderElements = TITLEBAR_ACTION_IDS.filter(id => titlebarActionsSettings.order.includes(id));
  return (
    <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row desktop-settings-tools-row">
      <span>{t("settings.appearance.headerElements.title")}</span>
      <div className="desktop-settings-tool-list">
        {orderedHeaderElements.map((id) => {
          const Icon = id === "terminal" ? AgentEntryIcon : VersionControlIcon;
          const linkedToolId = id === "terminal" ? "terminal" : null;
          const actionEnabled = linkedToolId
            ? titlebarActionsSettings.enabled[id] && terminalToolEnabled
            : titlebarActionsSettings.enabled[id];
          return (
            <div
              className="desktop-settings-tool-item"
              key={id}
            >
              <span className="desktop-settings-tool-label">
                <Icon size={14} />
                <span>{t(`settings.appearance.headerElements.${id}`)}</span>
              </span>
              <label className="desktop-settings-switch">
                <input
                  type="checkbox"
                  aria-label={t(`settings.appearance.headerElements.${id}`)}
                  checked={actionEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    onTitlebarActionsSettingsChange({
                      ...titlebarActionsSettings,
                      enabled: {
                        ...titlebarActionsSettings.enabled,
                        [id]: enabled,
                      },
                    });
                    if (linkedToolId && terminalToolEnabled !== enabled) {
                      onRightSidebarToolsSettingsChange(current => ({
                        ...current, enabled: { ...current.enabled, [linkedToolId]: enabled },
                      }));
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
  );
}

function PointerCursorSetting() {
  const { t } = useLocalization();
  const pointerCursors = useDesktopPreference(s => s.pointerCursors);
  const onPointerCursorsChange = useDesktopPreference(s => s.setPointerCursors);
  return (
    <div className="desktop-settings-row desktop-settings-row-control">
      <span id="desktop-pointer-cursors-label">{t("settings.appearance.pointerCursors.title")}</span>
      <label className="desktop-settings-switch">
        <input
          type="checkbox"
          checked={pointerCursors}
          aria-labelledby="desktop-pointer-cursors-label"
          onChange={(event) => onPointerCursorsChange(event.target.checked)}
        />
        <span aria-hidden="true" />
      </label>
    </div>
  );
}
