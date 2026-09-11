import { useLocalization } from "@puppyone/localization";
import type { TypographyPreferences } from "../../../preferences";
import { TypographyScaleSetting } from "../TypographyScaleSetting";
import { SettingsSectionHeader } from "../components";
import { TypographyPreview } from "./TypographyPreview";

export function TypographySettingsView({
  typographyPreferences,
  markdownThemeId,
  onTypographyPreferencesChange,
}: {
  typographyPreferences: TypographyPreferences;
  markdownThemeId: string;
  onTypographyPreferencesChange: (preferences: TypographyPreferences) => void;
}) {
  const { t } = useLocalization();

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title={t("settings.typography.title")} detail={t("settings.typography.detail")} />
          <div className="desktop-settings-list">
            <TypographyScaleSetting
              preferences={typographyPreferences}
              onChange={onTypographyPreferencesChange}
            />
            <TypographyPreview markdownThemeId={markdownThemeId} />
          </div>
        </div>
      </div>
    </section>
  );
}
