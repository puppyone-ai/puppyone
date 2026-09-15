import { useLocalization } from "@puppyone/localization";
import { DesktopUpdateSettingsRow, type DesktopUpdatesController } from "../../updates";
import { DesktopBuildVersionSettingsRow } from "../../build-info/DesktopBuildIdentity";
import { LanguageSettingRow } from "../LanguageSetting";
import { SettingsSectionHeader } from "../components";
import { AutomaticUpdateDownloadSettingRow } from "./AutomaticUpdateDownloadSettingRow";

export function GeneralSettingsView({
  updateState,
  onCheckForUpdates,
  onUpdateNow,
  automaticDownloadPreferenceAvailable,
  automaticDownloadPreferenceSaving,
  automaticDownloadPreferenceError,
  onAutomaticallyDownloadUpdatesChange,
}: {
  updateState: DesktopUpdatesController["state"];
  onCheckForUpdates: () => void;
  onUpdateNow: () => void;
  automaticDownloadPreferenceAvailable: boolean;
  automaticDownloadPreferenceSaving: boolean;
  automaticDownloadPreferenceError: boolean;
  onAutomaticallyDownloadUpdatesChange: (enabled: boolean) => void;
}) {
  const { t } = useLocalization();

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title={t("settings.general.title")} detail={t("settings.general.detail")} />
          <div className="desktop-settings-list">
            <LanguageSettingRow />
            <DesktopBuildVersionSettingsRow />
            <AutomaticUpdateDownloadSettingRow
              state={updateState}
              available={automaticDownloadPreferenceAvailable}
              saving={automaticDownloadPreferenceSaving}
              error={automaticDownloadPreferenceError}
              onChange={onAutomaticallyDownloadUpdatesChange}
            />
            <DesktopUpdateSettingsRow
              state={updateState}
              onCheckForUpdates={onCheckForUpdates}
              onUpdateNow={onUpdateNow}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
