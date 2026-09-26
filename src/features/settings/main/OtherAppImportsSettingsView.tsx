import { useLocalization } from "@puppyone/localization";
import { SettingsSectionHeader } from "../components";

const SOURCES = ["notion", "google-drive", "airtable", "obsidian"] as const;

export function OtherAppImportsSettingsView({ onOpenImport }: { onOpenImport: () => void }) {
  const { t } = useLocalization();

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader
            title={t("settings.experimental.otherAppImports.title")}
            detail={t("onboarding.entry.import.intro")}
          />
          <div className="desktop-settings-list">
            {SOURCES.map((source) => (
              <div className="desktop-settings-row" key={source}>
                <span>{t(`onboarding.entry.import.source.${source}.title`)}</span>
              </div>
            ))}
          </div>
          <button className="desktop-dialog-button primary" type="button" onClick={onOpenImport}>
            {t("onboarding.entry.import.title")}
          </button>
        </div>
      </div>
    </section>
  );
}
