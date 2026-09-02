import type { TypographyPreferences } from "../../preferences";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import {
  createCatalogFontFamily,
  getFontCatalogEntries,
  useTypographyCatalog,
  withTypographyFont,
} from "../typography";

export function ContentFontSetting({
  preferences,
  onChange,
}: {
  preferences: TypographyPreferences;
  onChange: (preferences: TypographyPreferences) => void;
}) {
  const { t } = useLocalization();
  const fontCatalog = useTypographyCatalog();
  const contentFonts = getFontCatalogEntries("content", fontCatalog);

  return (
    <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row">
      <span>{t("settings.appearance.contentFont.title")}</span>
      <div
        className="desktop-theme-segment desktop-content-font-segment"
        aria-label={t("settings.appearance.contentFont.ariaLabel")}
      >
        {contentFonts.map((font) => (
          <button
            key={font.id}
            className={preferences.contentFont.mode === "explicit" && preferences.contentFont.fontId === font.id ? "active" : ""}
            type="button"
            aria-label={t("settings.appearance.contentFont.use", { font: bidiIsolate(font.label) })}
            aria-pressed={preferences.contentFont.mode === "explicit" && preferences.contentFont.fontId === font.id}
            onClick={() => onChange(withTypographyFont(preferences, "content", font.id))}
          >
            <span style={{ fontFamily: createCatalogFontFamily(font) }}>{font.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
