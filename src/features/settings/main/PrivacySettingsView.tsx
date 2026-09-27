import { useLocalization } from "@puppyone/localization";
import { SettingsSectionHeader } from "../components";
import { ProductAnalyticsSettingsRow } from "./ProductAnalyticsSettingsRow";

export function PrivacySettingsView() {
  const { t } = useLocalization();

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader
            title={t("settings.privacy.title")}
          />
          <div className="desktop-settings-list desktop-settings-lead-list">
            <ProductAnalyticsSettingsRow />
          </div>
        </div>
      </div>
    </section>
  );
}
