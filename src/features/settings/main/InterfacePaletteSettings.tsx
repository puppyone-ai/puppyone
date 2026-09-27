import { Monitor, Moon, Sun } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import {
  getInterfaceStyleDefinition,
  type InterfaceStyle,
  type ThemeMode,
} from "../../appearance/interfaceStyles";
import type { DarkThemePreset, LightThemePreset } from "../../../preferences";
import { ThemePreview } from "./ThemePreview";
import {
  isAppearanceDecisionLocked,
  isAppearanceValueAllowed,
  type AppearanceSettingDecision,
} from "../../appearance/resolveAppearance";

type InterfacePaletteSettingsProps = {
  interfaceStyle: InterfaceStyle;
  subThemeId: string;
  decision: AppearanceSettingDecision<ThemeMode>;
  lightThemePreset: LightThemePreset;
  darkThemePreset: DarkThemePreset;
  onThemeModeChange: (mode: ThemeMode) => void;
};

const THEME_MODE_OPTIONS = {
  system: { labelId: "settings.appearance.theme.system", icon: Monitor },
  light: { labelId: "settings.appearance.theme.light", icon: Sun },
  dark: { labelId: "settings.appearance.theme.dark", icon: Moon },
} as const;

export function InterfacePaletteSettings({
  interfaceStyle,
  subThemeId,
  decision,
  lightThemePreset,
  darkThemePreset,
  onThemeModeChange,
}: InterfacePaletteSettingsProps) {
  const { t } = useLocalization();
  const palette = getInterfaceStyleDefinition(interfaceStyle).palette;
  if (palette.kind !== "adaptive") return null;
  const locked = isAppearanceDecisionLocked(decision);

  return (
    <>
      <div className="desktop-settings-row desktop-settings-row-control desktop-settings-wide-control-row desktop-theme-mode-row">
        <span>{t("settings.appearance.theme.title")}</span>
        <div className="desktop-theme-choice-list" aria-label={t("settings.appearance.theme.ariaLabel")}>
          {palette.modes.map((mode) => {
            const option = THEME_MODE_OPTIONS[mode];
            const Icon = option.icon;
            return (
              <button
                className={`desktop-theme-choice ${decision.effectiveValue === mode ? "active" : ""}${locked || !isAppearanceValueAllowed(decision, mode) ? " is-policy-controlled" : ""}`}
                type="button"
                key={mode}
                data-tooltip={decision.reasonKey ? t(decision.reasonKey) : undefined}
                aria-disabled={locked || !isAppearanceValueAllowed(decision, mode)}
                aria-pressed={decision.effectiveValue === mode}
                onClick={() => {
                  if (!locked && isAppearanceValueAllowed(decision, mode)) onThemeModeChange(mode);
                }}
              >
                <ThemePreview
                  mode={mode}
                  subThemeId={subThemeId}
                  lightThemePreset={lightThemePreset}
                  darkThemePreset={darkThemePreset}
                />
                <span className="desktop-theme-choice-label">
                  <Icon size={13} />
                  <span>{t(option.labelId)}</span>
                </span>
              </button>
            );
          })}
        </div>
        {decision.reasonKey && (
          <small className="desktop-appearance-policy-reason">{t(decision.reasonKey)}</small>
        )}
      </div>
    </>
  );
}
