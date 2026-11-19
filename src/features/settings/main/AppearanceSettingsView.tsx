import {
  FILE_ICON_THEMES,
  LoadingMark,
  LoadingPlaceholderStyleProvider,
  FileGlyphIcon,
  PlaceholderLayer,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { SELECTABLE_LOADING_STYLES, TITLEBAR_ACTION_IDS } from "../../../preferences";
import { AgentEntryIcon } from "../../../components/brand/AgentEntryIcon";
import { VersionControlIcon } from "../../source-control";
import { isAppearanceDecisionLocked, isAppearanceValueAllowed } from "../../appearance";
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
            {/* A choice exists only once a second file-icon theme is registered. */}
            {FILE_ICON_THEMES.length > 1 && <FileIconSetting />}
            <ShowFileIconsSetting />
            {/* A choice exists only while more than one loading style is offered. */}
            {SELECTABLE_LOADING_STYLES.length > 1 && <LoadingStyleSetting />}
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
          <button key={theme.id}
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
          </button>
        ))}
      </div>
      {fileIconDecision.reasonKey && (
        <small className="desktop-appearance-policy-reason">{t(fileIconDecision.reasonKey)}</small>
      )}
    </div>
  );
}

/**
 * One loading style for the whole app: loading marks and loading placeholders
 * are drawn in the same material. Each option previews both in its own style.
 */
function LoadingStyleSetting() {
  const { t } = useLocalization();
  const loadingStyle = useDesktopPreference(s => s.loadingPlaceholderStyle);
  const onLoadingStyleChange = useDesktopPreference(s => s.setLoadingPlaceholderStyle);
  return (
    <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row">
      <span>{t("settings.appearance.loadingStyle.title")}</span>
      <div
        className="desktop-theme-segment desktop-appearance-option-segment desktop-appearance-hug-segment"
        aria-label={t("settings.appearance.loadingStyle.ariaLabel")}
      >
        {SELECTABLE_LOADING_STYLES.map((style) => (
          <button
            key={style}
            className={loadingStyle === style ? "active" : ""}
            type="button"
            aria-pressed={loadingStyle === style}
            onClick={() => onLoadingStyleChange(style)}
          >
            <span className="desktop-loading-style-preview" aria-hidden="true">
              <LoadingMark size="sm" loadingStyle={style} ariaHidden />
              <span className="desktop-loading-placeholder-preview po-placeholder-surface">
                <span data-placeholder-shape="" />
                <span data-placeholder-shape="" />
                <LoadingPlaceholderStyleProvider style={style}>
                  <PlaceholderLayer />
                </LoadingPlaceholderStyleProvider>
              </span>
            </span>
            <span>{t(`settings.appearance.loadingStyle.${style}.label`)}</span>
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

/** File glyphs in the explorer; off leaves only the folder chevrons. */
function ShowFileIconsSetting() {
  const { t } = useLocalization();
  const showFileIcons = useDesktopPreference(s => s.showFileIcons);
  const onShowFileIconsChange = useDesktopPreference(s => s.setShowFileIcons);
  return (
    <div className="desktop-settings-row desktop-settings-row-control">
      <span id="desktop-show-file-icons-label">{t("settings.appearance.showFileIcons.title")}</span>
      <label className="desktop-settings-switch">
        <input
          type="checkbox"
          checked={showFileIcons}
          aria-labelledby="desktop-show-file-icons-label"
          onChange={(event) => onShowFileIconsChange(event.target.checked)}
        />
        <span aria-hidden="true" />
      </label>
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
