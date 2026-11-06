import { LocalIcon } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { Check, Pause, Play, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import type { HostCatalogDevice, HostCatalogFolder } from "../../../../shared/host-contract/types";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { OnboardingGroupMenu } from "../../../components/onboarding/OnboardingGroupMenu";
import {
  onboardingBaseGroups,
  OnboardingProjectGroups,
  type OnboardingGroupsBase,
  type OnboardingProjectGroup,
} from "../../../components/onboarding/OnboardingProjectGroups";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { HomepageProjectLayout } from "../../../preferenceStorage";
import { activeSharedFolderIds, useHostCatalog, type HostCatalog } from "../data/useHostCatalog";
import type { HostFolderSelection } from "../model/hostFolderSelection";
import { HostFolderSharingDialog, type HostFolderSharingTarget } from "./HostFolderSharingDialog";
import { RemoteFolderList } from "./RemoteFolderList";


type RelativeTime = (value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) => string;

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

/**
 * The Homepage by where each project is: the Cloud, this computer, then each of
 * the owner's other computers. One computer is one group, named as the owner
 * named it; its presence is the only thing said about it at rest.
 */
export function HomepageComputers({ session, apiBase, onOpen, base }: {
  session: DesktopCloudSession;
  apiBase: string;
  onOpen: (selection: HostFolderSelection) => void;
  base: OnboardingGroupsBase;
}) {
  const { t } = useLocalization();
  const catalog = useHostCatalog(session);
  const [sharingTarget, setSharingTarget] = useState<HostFolderSharingTarget | null>(null);
  const sharedFolderIds = activeSharedFolderIds(catalog);
  const groups = onboardingBaseGroups(base, {
    sharedFolderIds,
    onSharingSettings: ({ folderId, name, rootPath }) => setSharingTarget({ kind: "settings", folderId, name, rootPath }),
  }).map((group) => group.id === "this-computer" ? { ...group, ...thisComputerHead(catalog, sharedFolderIds.size) } : group);
  if (base.showOtherComputers) {
    for (const device of catalog.devices) {
      if (device.id === catalog.thisComputerId) continue;
      groups.push(otherComputerGroup(device, base.layout, catalog,
        (folder) => onOpen({
          ref: { deployment: apiBase, accountId: session.user_id, deviceId: device.id, folderId: folder.id },
          name: folder.name, hostName: device.name, writable: folder.capabilities.includes("folder.write"),
          capabilities: folder.capabilities,
        })));
    }
  }
  return <>
    <OnboardingProjectGroups label={base.label} groups={groups}
      note={catalog.error ? <HomepageComputersNote catalog={catalog} /> : undefined} />
    {sharingTarget && <HostFolderSharingDialog target={sharingTarget} catalog={catalog}
      onClose={() => setSharingTarget(null)} />}
  </>;

  function thisComputerHead(current: HostCatalog, offering: number): Pick<OnboardingProjectGroup, "detail" | "actions"> {
    if (!current.thisComputerId) return {};
    return {
      detail: <ThisComputerDetail catalog={current} offering={offering} />,
      actions: <ThisComputerMenu catalog={current} />,
    };
  }

  function otherComputerGroup(device: HostCatalogDevice, layout: HomepageProjectLayout, current: HostCatalog,
    open: (folder: HostCatalogFolder) => void): OnboardingProjectGroup {
    const folders = device.folders.filter((folder) => folder.state === "active")
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      id: `computer:${device.id}`,
      icon: <LocalIcon size={14} strokeWidth={1.85} />,
      title: device.name,
      detail: <ComputerPresence device={device} />,
      inactive: !device.online,
      actions: <OnboardingGroupMenu label={t("hosts.home.computerActions", { host: bidiIsolate(device.name) })}>
        {(close) => <DesktopMenuItem destructive icon={<Trash2 size={14} />} label={t("hosts.catalog.removeComputer")}
          onClick={() => { close(); void current.run(async () => window.puppyoneDesktop?.revokeHostDevice({
            deviceId: device.id, expectedSession: current.expectedSession }), "hosts.catalog.removeFailure"); }} />}
      </OnboardingGroupMenu>,
      children: folders.length
        ? <RemoteFolderList device={device} folders={folders} layout={layout} onOpen={open} />
        : <p className="onboarding-project-group-empty">{t("hosts.home.computerEmpty")}</p>,
    };
  }
}

function ComputerPresence({ device }: { device: HostCatalogDevice }) {
  const { t, formatRelativeTime } = useLocalization();
  const seen = lastSeen(device.last_seen_at, formatRelativeTime);
  let text = t("hosts.catalog.offline");
  if (device.online) text = t("hosts.catalog.online");
  else if (seen) text = t("hosts.catalog.lastSeen", { time: seen });
  return <span className="onboarding-project-group-presence" data-online={device.online || undefined}>{text}</span>;
}

/** What this computer offers its owner's other computers, in one line. */
function ThisComputerDetail({ catalog, offering }: { catalog: HostCatalog; offering: number }) {
  const { t } = useLocalization();
  const sharing = catalog.sharing;
  const running = sharing?.running?.length ?? 0;
  let text: string | null = null;
  if (sharing?.state === "outdated") text = t("hosts.sharing.outdated");
  else if (!offering) return null;
  else if (sharing?.paused) text = t("hosts.sharing.paused");
  else if (sharing?.state === "connecting") text = t("hosts.sharing.connecting");
  else if (sharing?.state === "offline") text = t("hosts.sharing.reconnecting");
  else text = t("hosts.home.offering", { count: offering });
  return <span className="onboarding-project-group-presence" data-online={(sharing?.state === "online" && !sharing.paused) || undefined}>
    {[text, running > 0 && t("hosts.execution.running", { count: running })].filter(Boolean).join(" · ")}
  </span>;
}

function ThisComputerMenu({ catalog }: { catalog: HostCatalog }) {
  const { t } = useLocalization();
  const sharing = catalog.sharing;
  const running = sharing?.running?.length ?? 0;
  const deviceId = catalog.thisComputerId;
  return <OnboardingGroupMenu label={t("hosts.home.thisComputerActions")}>
    {(close) => <>
      <DesktopMenuItem icon={sharing?.paused ? <Play size={14} /> : <Pause size={14} />}
        label={t(sharing?.paused ? "hosts.sharing.resume" : "hosts.sharing.pause")}
        onClick={() => { close(); void catalog.run(async () => window.puppyoneDesktop?.setHostSharingPaused({
          paused: !sharing?.paused, expectedSession: catalog.expectedSession }), "hosts.catalog.updateFailure"); }} />
      {catalog.autostart?.supported && <DesktopMenuItem role="menuitemcheckbox" aria-checked={catalog.autostart.enabled}
        icon={<span aria-hidden="true" />} label={t("hosts.sharing.startAtLogin")}
        trailing={catalog.autostart.enabled ? <Check size={14} aria-hidden="true" /> : undefined}
        onClick={() => { void catalog.setAutostart(!catalog.autostart?.enabled); }} />}
      {running > 0 && <DesktopMenuItem icon={<Square size={14} />}
        label={`${t("hosts.execution.stopAll")} (${running})`}
        onClick={() => { close(); void catalog.run(async () => window.puppyoneDesktop?.stopRemoteHostSessions?.(),
          "hosts.catalog.updateFailure"); }} />}
      {deviceId && <>
        <DesktopMenuSeparator />
        <DesktopMenuItem destructive icon={<Trash2 size={14} />} label={t("hosts.catalog.removeComputer")}
          onClick={() => { close(); void catalog.run(async () => window.puppyoneDesktop?.revokeHostDevice({
            deviceId, expectedSession: catalog.expectedSession }), "hosts.catalog.removeFailure"); }} />
      </>}
    </>}
  </OnboardingGroupMenu>;
}

function HomepageComputersNote({ catalog }: { catalog: HostCatalog }) {
  const { t } = useLocalization();
  return <p className="onboarding-project-groups-note" role="status">
    <span>{catalog.error}</span>
    <button type="button" className="project-cloud-link-button" onClick={() => { catalog.clearError(); void catalog.refresh(); }}>
      {t("common.action.retry")}</button>
  </p>;
}
