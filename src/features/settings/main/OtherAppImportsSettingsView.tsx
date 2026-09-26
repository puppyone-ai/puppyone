import { useLocalization } from "@puppyone/localization";
import { IMPORT_SOURCE_REGISTRY } from "../../project-import/importSourceRegistry";
import { SettingsSectionHeader } from "../components";

const SOURCES = IMPORT_SOURCE_REGISTRY.filter(({ availability }) => availability === "experimental");

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
            {SOURCES.map(({ id, operational }) => (
              <div className="desktop-settings-row" key={id}>
                <span>{t(`onboarding.entry.import.source.${id}.title`)}</span>
                {!operational && <span>{t("onboarding.entry.import.directUnavailable")}</span>}
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
