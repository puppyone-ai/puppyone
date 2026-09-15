import { useLocalization } from "@puppyone/localization";
import type { DesktopUpdateState } from "../../../types/electron";
import { SettingsToggle } from "../components";

export function AutomaticUpdateDownloadSettingRow({
  state,
  available,
  saving,
  error,
  onChange,
}: {
  state: DesktopUpdateState;
  available: boolean;
  saving: boolean;
  error: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const { t } = useLocalization();
  const title = t("updates.settings.autoDownload.title");
  const detail = t("updates.settings.autoDownload.detail");
  const disabled = !available || saving || state.status === "disabled";

  return (
    <div className="desktop-settings-row desktop-settings-row-control" aria-busy={saving || undefined}>
      <div className="desktop-update-preference-label">
        <span title={detail}>{title}</span>
        {error && (
          <small className="desktop-update-preference-error" role="alert">
            {t("updates.settings.autoDownload.error")}
          </small>
        )}
      </div>
      <SettingsToggle
        checked={state.automaticallyDownloadUpdates}
        description={detail}
        disabled={disabled}
        label={title}
        onChange={onChange}
      />
    </div>
  );
}
