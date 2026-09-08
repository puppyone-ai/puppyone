import { useLocalization } from "@puppyone/localization";
import type { TypographyPreferences } from "../../../preferences";
import { TypographyScaleSetting } from "../TypographyScaleSetting";
import { SettingsSectionHeader, SettingsSubsection } from "../components";

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
            <SettingsSubsection title={t("settings.typography.preview.title")}>
              <section
                className="desktop-typography-preview markdown-codemirror-editor"
                aria-label={t("settings.typography.preview.ariaLabel")}
                data-po-theme-surface="markdown"
                data-po-theme-id={markdownThemeId}
                data-po-typography-role="content"
              >
                <div className="cm-md-html-rendered-surface" role="document" lang="en">
                  <h1>{t("settings.typography.preview.headingOne")}</h1>
                  <h2>{t("settings.typography.preview.headingTwo")}</h2>
                  <h3>{t("settings.typography.preview.headingThree")}</h3>
                  <p className="desktop-typography-preview-body">
                    <span>
                      {t("settings.typography.preview.body")}{" "}
                      <strong>{t("settings.typography.preview.bold")}</strong>.
                    </span>
                  </p>
                </div>
              </section>
            </SettingsSubsection>
          </div>
        </div>
      </div>
    </section>
  );
}
