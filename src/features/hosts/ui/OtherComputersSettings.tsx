import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { FolderIcon, LocalIcon } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { SettingsSectionHeader, SettingsSubsection, SettingsToggle } from "../../../components/SettingsControls";
import { InlineLoading } from "../../../components/loading";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { useHostCatalog, type HostCatalog } from "../data/useHostCatalog";
import { ComputerActionsMenu } from "./ComputerActionsMenu";
import { HostFolderSharingDialog, type HostFolderSharingTarget } from "./HostFolderSharingDialog";
import "./computer-access-settings.css";

type RelativeTime = (value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) => string;

/** Cross-computer access is an application capability, with account sign-in as its prerequisite. */
export function OtherComputersSettings({ session, restoring = false, onSignIn }: {
  session: DesktopCloudSession | null; restoring?: boolean; onSignIn?: () => void;
}) {
  const { t } = useLocalization();
  return (
    <section className="desktop-utility-view desktop-settings-view" data-settings-section="other-computers">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section computer-access-settings">
          <SettingsSectionHeader title={t("hosts.settings.title")} />
          {!session && !restoring && <p className="computer-access-intro">{t("hosts.settings.thisComputerDetail")}</p>}
          {session && !restoring ? <ComputerAccessContent key={`${session.user_id}:${session.session_generation}`} session={session} />
            : <div className="desktop-settings-row computer-access-signin">
              {restoring ? <InlineLoading label={t("common.status.loading")} />
                : <button className="desktop-settings-action" type="button" onClick={onSignIn}>
                  {t("settings.account.signInWithBrowser")}</button>}
            </div>}
        </div>
      </div>
    </section>
  );
}

function ComputerAccessContent({ session }: { session: DesktopCloudSession }) {
  const { t } = useLocalization();
  const catalog = useHostCatalog(session);
  const [target, setTarget] = useState<HostFolderSharingTarget | null>(null);
  const [openComputer, setOpenComputer] = useState<string | null>(null);
  const mine = catalog.devices.find((device) => device.id === catalog.thisComputerId);
  const folders = catalog.sharing?.folders?.map((folder) => ({ id: folder.folderId, name: folder.name, writable: folder.writable }))
    ?? mine?.folders.filter((folder) => folder.state === "active").map((folder) => ({ id: folder.id, name: folder.name,
      writable: folder.capabilities.includes("folder.write") }));
  const localName = mine?.name ?? t("hosts.settings.thisComputer");
  const remove = (deviceId: string) => void catalog.run(async () => window.puppyoneDesktop?.revokeHostDevice({
    deviceId, expectedSession: catalog.expectedSession }), "hosts.settings.removeFailure");
  const noFolders = folders?.length === 0 || (catalog.sharing?.state === "off" && !catalog.thisComputerId);
  const canPause = Boolean(catalog.thisComputerId && !noFolders && !catalog.statusError && catalog.sharing?.state !== "outdated");
  const paused = Boolean(catalog.sharing?.paused);
  const toggleSharing = () => void catalog.run(async () => window.puppyoneDesktop?.setHostSharingPaused({
    paused: !paused, expectedSession: catalog.expectedSession }), "hosts.catalog.updateFailure");

  return <>
    <SettingsSubsection title={t("hosts.settings.localSharing")}>
      <div className="computer-access-device">
        <span className="computer-access-icon"><LocalIcon size={16} aria-hidden="true" /></span>
        <div className="computer-access-identity">
          <span>{localName}</span>
          <span className="computer-access-presence">
            <SharingStatus catalog={catalog} count={folders?.length} />
          </span>
        </div>
        {canPause && <button type="button" className="desktop-settings-action" disabled={catalog.pending}
          data-sharing-action={paused ? "resume" : "pause"} onClick={toggleSharing}>
          {t(paused ? "hosts.sharing.resume" : "hosts.sharing.pause")}</button>}
        {catalog.thisComputerId && <ComputerActionsMenu name={localName} current disabled={catalog.pending}
          open={openComputer === catalog.thisComputerId} onOpenChange={(open) => setOpenComputer(open ? catalog.thisComputerId : null)}
          onRemove={() => remove(catalog.thisComputerId!)} />}
      </div>
      {noFolders && !catalog.statusError && <p className="computer-access-hint">{t("hosts.settings.emptyFolders")}</p>}
      {folders && folders.length > 0 && <div className="computer-access-folders" role="list" aria-label={t("hosts.settings.sharedFolders")}>
        {folders.map((folder) => {
          const manageable = mine?.folders.some((item) => item.id === folder.id && item.state === "active");
          const content = <><FolderIcon size={14} aria-hidden="true" /><span>{folder.name}</span>
            <span className="computer-access-permission">{t(folder.writable ? "hosts.catalog.editable" : "hosts.catalog.readOnly")}</span>
            {manageable && <ChevronRight size={13} aria-hidden="true" />}</>;
          return <div role="listitem" key={folder.id}>{manageable
            ? <button type="button" className="computer-access-folder" disabled={catalog.pending}
              aria-label={t("hosts.dialog.settingsTitle", { name: bidiIsolate(folder.name) })}
              onClick={() => setTarget({ kind: "settings", folderId: folder.id, name: folder.name })}>{content}</button>
            : <div className="computer-access-folder">{content}</div>}</div>;
        })}
      </div>}
      {catalog.autostart?.supported && catalog.thisComputerId && !noFolders && !catalog.statusError && <div className="desktop-settings-row desktop-settings-row-control computer-access-autostart">
        <span>{t("hosts.sharing.startAtLogin")}</span>
        <SettingsToggle label={t("hosts.sharing.startAtLogin")} checked={catalog.autostart.enabled} disabled={catalog.pending}
          onChange={(enabled) => { void catalog.setAutostart(enabled); }} />
      </div>}
    </SettingsSubsection>
    <OtherComputerList catalog={catalog} onRemove={remove} openComputer={openComputer} setOpenComputer={setOpenComputer} />
    {catalog.actionError && <p className="computer-access-hint" role="alert">{catalog.actionError}</p>}
    {target && <HostFolderSharingDialog target={target} catalog={catalog} onClose={() => setTarget(null)} />}
  </>;
}

function OtherComputerList({ catalog, onRemove, openComputer, setOpenComputer }: {
  catalog: HostCatalog; onRemove: (id: string) => void; openComputer: string | null; setOpenComputer: (id: string | null) => void;
}) {
  const { t } = useLocalization();
  const others = catalog.devices.filter((device) => device.id !== catalog.thisComputerId);
  const failed = Boolean(catalog.catalogError || catalog.statusError);
  let content = failed ? null : <div className="computer-access-read-state"><InlineLoading label={t("common.status.loading")} /></div>;
  if (catalog.loaded && catalog.sharing) {
    if (others.length > 0) content = <>{others.map((device) => <div className="computer-access-device" key={device.id}>
      <span className="computer-access-icon"><LocalIcon size={16} aria-hidden="true" /></span>
      <div className="computer-access-identity"><span>{device.name}</span>
        <span className="computer-access-presence">
          <ComputerPresence online={device.online} lastSeenAt={device.last_seen_at} /></span></div>
      <ComputerActionsMenu name={device.name} disabled={catalog.pending} onRemove={() => onRemove(device.id)}
        open={openComputer === device.id} onOpenChange={(open) => setOpenComputer(open ? device.id : null)} />
    </div>)}</>;
    else if (!failed) content = <p className="computer-access-hint" data-other-computers-empty="">{t("hosts.settings.noOthers")}</p>;
  }
  return <SettingsSubsection title={t("hosts.settings.others")}>
    {failed && <div className="computer-access-read-state" role="alert">
      <span>{t("hosts.catalog.unavailable")}</span>
      <button type="button" className="desktop-settings-action" disabled={catalog.refreshing} onClick={() => void catalog.refresh()}>
        {t("common.action.retry")}</button>
    </div>}
    {content}
  </SettingsSubsection>;
}

function SharingStatus({ catalog, count }: { catalog: HostCatalog; count?: number }) {
  const { t } = useLocalization();
  const sharing = catalog.sharing;
  if (catalog.statusError) return <>{t("hosts.settings.statusUnavailable")}</>;
  if (!sharing) return <>{t("common.status.loading")}</>;
  if (sharing.state === "outdated") return <>{t("hosts.sharing.outdated")}</>;
  if (sharing.paused) return <>{t("hosts.sharing.paused")}</>;
  if (sharing.state === "off") return <>{t("hosts.settings.sharingOff")}</>;
  if (sharing.state === "connecting") return <>{t("hosts.sharing.connecting")}</>;
  if (sharing.state === "offline") return <>{t("hosts.sharing.reconnecting")}</>;
  if (count !== undefined) return <>{t(count > 0 ? "hosts.settings.folderCount" : "hosts.settings.sharingOff", { count })}</>;
  return <>{t("hosts.settings.sharingOn")}</>;
}

function ComputerPresence({ online, lastSeenAt }: { online: boolean; lastSeenAt: string | null }) {
  const { t, formatRelativeTime } = useLocalization();
  if (online) return <>{t("hosts.catalog.online")}</>;
  if (!lastSeenAt) return <>{t("hosts.catalog.offline")}</>;
  const elapsed = Date.parse(lastSeenAt) - Date.now();
  if (Number.isNaN(elapsed)) return <>{t("hosts.catalog.offline")}</>;
  const format: RelativeTime = formatRelativeTime;
  const minutes = Math.round(elapsed / 60_000);
  let seen = format(minutes, "minute", { numeric: "auto" });
  if (Math.abs(minutes) >= 60) {
    const hours = Math.round(minutes / 60);
    seen = Math.abs(hours) < 48 ? format(hours, "hour", { numeric: "auto" }) : format(Math.round(hours / 24), "day", { numeric: "auto" });
  }
  return <>{t("hosts.catalog.lastSeen", { time: seen })}</>;
}
