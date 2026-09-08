import { useLocalization } from "@puppyone/localization";
import type { TypographyPreferences } from "../../preferences";
import {
  TYPOGRAPHY_SCALE_OPTIONS,
  withTypographyScale,
} from "../typography";
import { SettingsSubsection } from "./components";

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
        <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row">
          <span>{t("settings.typography.textSize.application.title")}</span>
          <div
            className="desktop-theme-segment desktop-appearance-option-segment desktop-appearance-hug-segment desktop-typography-scale-segment"
            aria-label={t("settings.typography.textSize.ariaLabel")}
          >
            {TYPOGRAPHY_SCALE_OPTIONS.map((scale) => (
              <button
                className={preferences.scale === scale ? "active" : ""}
                type="button"
                key={scale}
                aria-label={t("settings.typography.textSize.useScale", {
                  scale: t(`settings.typography.textSize.scale.${scale}`),
                })}
                aria-pressed={preferences.scale === scale}
                onClick={() => onChange(withTypographyScale(preferences, scale))}
              >
                <span>{t(`settings.typography.textSize.scale.${scale}`)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </SettingsSubsection>
  );
}
