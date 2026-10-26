import { useDesktopPreference } from "../../../preferencesStore";
import { useDesktopAppearance } from "../useDesktopAppearance";
import { followThemeContentFont, isFollowingThemeContentFont } from "../../typography";
import { Tooltip, FolderIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { Plus } from "lucide-react";
import {
  listSelectableSubThemes,
} from "../../themes/builtinSubThemes";
import type { SubThemeCatalogController } from "../../themes/useSubThemeCatalog";
import { getInterfaceStyleSubThemePolicy } from "../../appearance/interfaceStyles";

export function SubThemeSettingsSection({ catalog }: { catalog: SubThemeCatalogController }) {
  const rootThemeId = useDesktopPreference(s => s.interfaceStyle);
  const preferences = useDesktopPreference(s => s.typographyPreferences);
  const setTypography = useDesktopPreference(s => s.setTypographyPreferences);
  const onSubThemeChange = useDesktopPreference(s => s.setSubThemeId);
  const { requestedSubThemeId, resolvedAppearance } = useDesktopAppearance();
  const { subThemeId: effectiveSubThemeId, effectiveColorMode } = resolvedAppearance;
  const contentFontOverrideActive = !isFollowingThemeContentFont(preferences);
  const onUseThemeContentFont = () => setTypography(followThemeContentFont(preferences));
  const { t } = useLocalization();
  const allowedTargets = getInterfaceStyleSubThemePolicy(rootThemeId).allowedTargets;
  const variants = listSelectableSubThemes(
    catalog.snapshot,
    rootThemeId,
    effectiveColorMode,
    allowedTargets,
  );
  const selectedExists = variants.some((subTheme) => subTheme.id === requestedSubThemeId);
  const requestedExistsInCatalog = catalog.snapshot.subThemes.some(
    (subTheme) => subTheme.id === requestedSubThemeId,
  );
  const effective = variants.find((subTheme) => subTheme.id === effectiveSubThemeId);
  const selectValue = selectedExists ? requestedSubThemeId : effectiveSubThemeId;
  const onAddTheme = async () => {
    const result = await catalog.createTheme();
    if (result.created && result.themeId) onSubThemeChange(result.themeId);
  };

  return (
    <div className="desktop-theme-settings-section">
      <div className="desktop-settings-list">
        <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row">
          <label className="desktop-theme-pack-label" htmlFor="desktop-sub-theme-select">
            {t("settings.appearance.themes.pack")}
          </label>
          <div className="desktop-theme-pack-controls">
            <div className="desktop-theme-pack-picker">
              {variants.length <= 1 ? (
                <span className="desktop-appearance-policy-reason">
                  {effective?.name ?? effectiveSubThemeId}
                </span>
              ) : (
                <select
                  id="desktop-sub-theme-select"
                  className="desktop-settings-select desktop-theme-pack-select"
                  value={selectValue}
                  onChange={(event) => onSubThemeChange(event.currentTarget.value)}
                >
                  {!selectedExists && !requestedExistsInCatalog && (
                    <option value={requestedSubThemeId}>
                      {t("settings.appearance.themes.missing", { id: requestedSubThemeId })}
                    </option>
                  )}
                  {variants.map((subTheme) => (
                    <option key={subTheme.id} value={subTheme.id}>{subTheme.name}</option>
                  ))}
                </select>
              )}
            </div>
            <Tooltip content={t("settings.appearance.themes.openFolder")}><button
              className="desktop-theme-pack-icon-action"
              type="button"
              aria-label={t("settings.appearance.themes.openFolder")}
              onClick={() => void catalog.openDirectory()}
            >
              <FolderIcon size={14} strokeWidth={1.8} aria-hidden="true" />
            </button></Tooltip>
            <Tooltip content={t("settings.appearance.themes.add")}><button
              className="desktop-theme-pack-icon-action"
              type="button"
              aria-label={t("settings.appearance.themes.add")}
              onClick={() => void onAddTheme()}
            >
              <Plus size={14} strokeWidth={1.9} aria-hidden="true" />
            </button></Tooltip>
          </div>
        </div>
      </div>
      {contentFontOverrideActive && (
        <div className="desktop-theme-font-override" role="status">
          <span>{t("settings.appearance.themes.contentFontOverride")}</span>
          <button type="button" onClick={onUseThemeContentFont}>
            {t("settings.appearance.themes.useThemeFont")}
          </button>
        </div>
      )}
      {catalog.error && <p className="desktop-theme-settings-error" role="alert">{catalog.error}</p>}
      {catalog.snapshot.diagnostics.length > 0 && (
        <ul className="desktop-theme-settings-diagnostics" aria-label={t("settings.appearance.themes.diagnostics")}>
          {catalog.snapshot.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.source}:${index}`}>
              <strong>{diagnostic.source}</strong>: {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
