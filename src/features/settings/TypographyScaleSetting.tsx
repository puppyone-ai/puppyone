import { useLocalization } from "@puppyone/localization";
import type { TypographyPreferences } from "../../preferences";
import {
  TYPOGRAPHY_SCALE_OPTIONS,
  withTypographyScale,
  type TypographyScaleSurface,
} from "../typography";
import { SettingsSubsection } from "./components";

const USER_ADJUSTABLE_SURFACES = [
  "leftSidebar",
  "header",
  "editor",
  "rightSidebar",
] as const satisfies readonly TypographyScaleSurface[];

export function TypographyScaleSetting({
  preferences,
  onChange,
}: {
  preferences: TypographyPreferences;
  onChange: (preferences: TypographyPreferences) => void;
}) {
  const { t } = useLocalization();

  return (
    <SettingsSubsection title={t("settings.typography.textSize.title")}>
      <p className="desktop-typography-scale-help">
        {t("settings.typography.textSize.detail")}
      </p>
      <div className="desktop-typography-scale-list">
        {USER_ADJUSTABLE_SURFACES.map((surface) => (
          <div
            className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row"
            key={surface}
          >
            <span>{t(`settings.typography.textSize.${surface}.title`)}</span>
            <div
              className="desktop-theme-segment desktop-appearance-option-segment desktop-appearance-hug-segment desktop-typography-scale-segment"
              aria-label={t(`settings.typography.textSize.${surface}.ariaLabel`)}
            >
              {TYPOGRAPHY_SCALE_OPTIONS.map((scale) => (
                <button
                  className={preferences.scales[surface] === scale ? "active" : ""}
                  type="button"
                  key={scale}
                  aria-label={t("settings.typography.textSize.useScale", {
                    surface: t(`settings.typography.textSize.${surface}.title`),
                    scale: t(`settings.typography.textSize.scale.${scale}`),
                  })}
                  aria-pressed={preferences.scales[surface] === scale}
                  onClick={() => onChange(withTypographyScale(preferences, surface, scale))}
                >
                  <span>{t(`settings.typography.textSize.scale.${scale}`)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SettingsSubsection>
  );
}
