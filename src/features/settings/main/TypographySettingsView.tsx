import { useLocalization } from "@puppyone/localization";
import { TypographyScaleSetting } from "../TypographyScaleSetting";
import { SettingsSectionHeader } from "../components";
import { TypographyPreview } from "./TypographyPreview";

export function TypographySettingsView() {
  const { t } = useLocalization();

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title={t("settings.typography.title")} />
          <div className="desktop-settings-list desktop-settings-lead-list">
            <TypographyScaleSetting />
            <TypographyPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
