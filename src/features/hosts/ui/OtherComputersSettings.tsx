import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { SettingsSectionHeader, SettingsSubsection, SettingsToggle, SettingsValueRow } from "../../../components/SettingsControls";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { useHostCatalog, type HostCatalog } from "../data/useHostCatalog";

type RelativeTime = (value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) => string;

/**
 * The owner's computers, where they are managed: whether this computer is sharing
 * its folders and keeps sharing after a restart, and which other computers can open
 * them. Every computer signed in to the account can open shared folders, so this is
 * where one is taken out of that, not where it is let in. Main asks before removing.
 */
export function OtherComputersSettings({ session }: { session: DesktopCloudSession }) {
  const { t } = useLocalization();
  const catalog = useHostCatalog(session);
  const others = catalog.devices.filter((device) => device.id !== catalog.thisComputerId);
  const remove = (deviceId: string) => void catalog.run(async () => window.puppyoneDesktop?.revokeHostDevice({
    deviceId, expectedSession: catalog.expectedSession }), "hosts.settings.removeFailure");

  return (
    <section className="desktop-utility-view desktop-settings-view" data-settings-section="other-computers">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title={t("settings.sidebar.otherComputers")} />
          <SettingsSubsection title={t("hosts.settings.thisComputer")} detail={t("hosts.settings.thisComputerDetail")} leading>
            <ThisComputerRows catalog={catalog} onRemove={remove} />
          </SettingsSubsection>
          <SettingsSubsection title={t("hosts.settings.others")}>
            {others.length === 0 && <p className="desktop-settings-subsection-detail" data-other-computers-empty="">
              {t(catalog.loaded ? "hosts.settings.noOthers" : "common.status.loading")}
            </p>}
            {others.map((device) => (
              <SettingsValueRow key={device.id} label={device.name}
                value={<ComputerPresence online={device.online} lastSeenAt={device.last_seen_at} />}
                action={<button type="button" className="desktop-settings-row-action" data-remove-computer={device.id}
                  aria-label={t("hosts.settings.removeComputer", { host: bidiIsolate(device.name) })}
                  onClick={() => remove(device.id)}>{t("hosts.settings.remove")}</button>} />
            ))}
          </SettingsSubsection>
          {catalog.error && <p className="desktop-settings-subsection-detail" role="alert">{catalog.error}</p>}
        </div>
      </div>
    </section>
  );
}

function ThisComputerRows({ catalog, onRemove }: { catalog: HostCatalog; onRemove: (deviceId: string) => void }) {
  const { t } = useLocalization();
  const sharing = catalog.sharing;
  const deviceId = catalog.thisComputerId;
  const paused = Boolean(sharing?.paused);
  let state = t("hosts.settings.sharingOn");
  if (sharing?.state === "outdated") state = t("hosts.sharing.outdated");
  else if (paused) state = t("hosts.sharing.paused");
  else if (sharing?.state === "connecting") state = t("hosts.sharing.connecting");
  else if (sharing?.state === "offline") state = t("hosts.sharing.reconnecting");
  const setPaused = (next: boolean) => void catalog.run(async () => window.puppyoneDesktop?.setHostSharingPaused({
    paused: next, expectedSession: catalog.expectedSession }), "hosts.catalog.updateFailure");
  return <>
    <SettingsValueRow label={t("hosts.settings.sharing")} value={state}
      action={deviceId && sharing?.state !== "outdated" && <button type="button" className="desktop-settings-row-action"
        data-sharing-action={paused ? "resume" : "pause"} onClick={() => setPaused(!paused)}>
        {t(paused ? "hosts.sharing.resume" : "hosts.sharing.pause")}
      </button>} />
    {catalog.autostart?.supported && <div className="desktop-settings-row desktop-settings-row-control">
      <span>{t("hosts.sharing.startAtLogin")}</span>
      <SettingsToggle label={t("hosts.sharing.startAtLogin")} checked={catalog.autostart.enabled}
        onChange={(enabled) => { void catalog.setAutostart(enabled); }} />
    </div>}
    {deviceId && <SettingsValueRow label={t("hosts.settings.removeThis")} value={t("hosts.settings.removeThisDetail")}
      action={<button type="button" className="desktop-settings-row-action" data-remove-computer={deviceId}
        aria-label={t("hosts.settings.removeThis")} onClick={() => onRemove(deviceId)}>{t("hosts.settings.remove")}</button>} />}
  </>;
}

function ComputerPresence({ online, lastSeenAt }: { online: boolean; lastSeenAt: string | null }) {
  const { t, formatRelativeTime } = useLocalization();
  if (online) return <>{t("hosts.catalog.online")}</>;
  const seen = lastSeen(lastSeenAt, formatRelativeTime);
  return <>{seen ? t("hosts.catalog.lastSeen", { time: seen }) : t("hosts.catalog.offline")}</>;
}

function lastSeen(value: string | null, format: RelativeTime): string | null {
  if (!value) return null;
  const elapsed = Date.parse(value) - Date.now();
  if (Number.isNaN(elapsed)) return null;
  const minutes = Math.round(elapsed / 60_000);
  if (Math.abs(minutes) < 60) return format(minutes, "minute", { numeric: "auto" });
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return format(hours, "hour", { numeric: "auto" });
  return format(Math.round(hours / 24), "day", { numeric: "auto" });
}
