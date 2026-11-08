import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { Check, Pause, Play, Square, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import type { HostCatalogDevice } from "../../../../shared/host-contract/types";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { OnboardingGroupMenu } from "../../../components/onboarding/OnboardingGroupMenu";
import {
  onboardingBaseGroups,
  OnboardingProjectGroups,
  type OnboardingGroupsBase,
  type OnboardingProjectGroup,
} from "../../../components/onboarding/OnboardingProjectGroups";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { useHostCatalog, type HostCatalog } from "../data/useHostCatalog";
import { useSharedFolderAssignments } from "../model/sharedFolders";
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

/** Device folders join the same personal audience as hosted projects, not new device groups. */
export function HomepageComputers({ session, apiBase, onOpen, base }: {
  session: DesktopCloudSession;
  apiBase: string;
  onOpen: (selection: HostFolderSelection) => void;
  base: OnboardingGroupsBase;
}) {
  const { t } = useLocalization();
  const catalog = useHostCatalog(session);
  const [sharingTarget, setSharingTarget] = useState<HostFolderSharingTarget | null>(null);
  const assignments = useSharedFolderAssignments();
  const local = base.local && { ...base.local, items: base.local.items.map((item) => assignments.has(item.localPath)
    ? { ...item, hostFolderId: assignments.get(item.localPath) ?? undefined } : item) };
  const mine = catalog.devices.find((device) => device.id === catalog.thisComputerId);
  // Paused still means shared. On a failed read, retain recorded offers instead
  // of incorrectly promising that other devices have never had access.
  const offered = mine?.folders.map((folder) => folder.id)
    ?? (!catalog.thisComputerId || !catalog.loaded || catalog.error
      ? local?.items.flatMap((item) => item.hostFolderId ? [item.hostFolderId] : []) : []);
  const sharedFolderIds = new Set(offered);
  for (const item of local?.items ?? []) {
    if (item.hostFolderId && assignments.get(item.localPath) === item.hostFolderId) sharedFolderIds.add(item.hostFolderId);
  }
  const groups = onboardingBaseGroups({ ...base, local }, {
    sharedFolderIds,
    onSharingSettings: ({ folderId, name, rootPath }) => setSharingTarget({ kind: "settings", folderId, name, rootPath }),
  });
  const others = catalog.devices.filter((device) => device.id !== catalog.thisComputerId);
  const localFolderIds = new Set(local?.items.flatMap((item) => item.hostFolderId ? [item.hostFolderId] : []));
  const visible = base.showOtherComputers ? others.map((device) => ({ ...device,
    folders: device.folders.filter((folder) => !localFolderIds.has(folder.id)),
  })).filter((device) => device.folders.length > 0) : [];
  if (visible.length) {
    const index = groups.findIndex((group) => group.id === "personal-shared");
    const previous = groups[index] ?? base.cloud.find((group) => group.id === "personal-shared");
    const personal: OnboardingProjectGroup = {
      ...previous, id: "personal-shared", title: base.personalSharedTitle,
      icon: <UserRound size={14} />, alwaysShowHeading: true, empty: false,
      children: <>{previous && !previous.empty && previous.children}{visible.map((device) => <RemoteFolderList
        key={device.id} device={device} folders={[...device.folders].sort((a, b) => a.name.localeCompare(b.name))}
        layout={base.layout} onOpen={(folder) => onOpen({
          ref: { deployment: apiBase, accountId: session.user_id, deviceId: device.id, folderId: folder.id },
          name: folder.name, hostName: device.name, writable: folder.capabilities.includes("folder.write"),
          capabilities: folder.capabilities,
        })} />)}</>,
    };
    if (index < 0) groups.unshift(personal);
    else groups[index] = personal;
  }
  const share = base.localShare;
  if (share) {
    const candidates = (local?.items ?? []).filter((item) => !item.hostFolderId || !sharedFolderIds.has(item.hostFolderId));
    const source = candidates.find((item) => item.localPath === share.draggingPath);
    const index = groups.findIndex((group) => group.id === "personal-shared");
    if (source || index >= 0) {
      const previous = groups[index];
      const personal: OnboardingProjectGroup = {
        ...previous, id: "personal-shared", title: base.personalSharedTitle,
        icon: <UserRound size={14} />, alwaysShowHeading: true,
        dropTarget: share.draggingPath ? { enabled: Boolean(source) && !share.busy, onDrop: () => {
          share.endDrag();
          if (source && !share.busy) void share.request(source.localPath);
        } } : undefined,
        children: previous?.children ?? <p className="onboarding-cloud-space-empty">{t("hosts.place.share")}</p>,
      };
      if (index < 0) groups.push(personal);
      else groups[index] = personal;
    }
    // When the personal area is empty, expose the same action on the local
    // heading so keyboard users never need a drag to reveal their destination.
    const personalIndex = groups.findIndex((group) => group.id === "personal-shared");
    const menuIndex = personalIndex >= 0 ? personalIndex : groups.findIndex((group) => group.id === "local-only");
    if (menuIndex >= 0) groups[menuIndex] = { ...groups[menuIndex],
      actions: <OnboardingGroupMenu label={t("hosts.place.share")} disabled={share.busy || candidates.length === 0}>
        {(close) => candidates.map((item) => <DesktopMenuItem key={item.id} label={item.label}
          onClick={() => { close(); share.endDrag(); void share.request(item.localPath); }} />)}
      </OnboardingGroupMenu>,
    };
  }
  const controls = groups.findIndex((group) => group.id === "personal-shared");
  const controlsIndex = controls >= 0 ? controls : groups.findIndex((group) => group.id === "local-only");
  if (controlsIndex >= 0 && (catalog.thisComputerId || others.length)) {
    const group = groups[controlsIndex];
    groups[controlsIndex] = { ...group,
      detail: <ThisComputerDetail catalog={catalog} offering={sharedFolderIds.size} />,
      actions: <>{group.actions}<ThisComputerMenu catalog={catalog} others={others} /></>,
    };
  }
  return <>
    <OnboardingProjectGroups label={base.label} groups={groups}
      note={catalog.error ? <HomepageComputersNote catalog={catalog} /> : undefined} />
    {sharingTarget && <HostFolderSharingDialog target={sharingTarget} catalog={catalog}
      onClose={() => setSharingTarget(null)} />}
  </>;

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
  if (!text && !running) return null;
  return <span className="onboarding-project-group-presence" data-online={(sharing?.state === "online" && !sharing.paused) || undefined}>
    {[text, running > 0 && t("hosts.execution.running", { count: running })].filter(Boolean).join(" · ")}
  </span>;
}

function ThisComputerMenu({ catalog, others }: { catalog: HostCatalog; others: readonly HostCatalogDevice[] }) {
  const { t } = useLocalization();
  const sharing = catalog.sharing;
  const running = sharing?.running?.length ?? 0;
  const deviceId = catalog.thisComputerId;
  return <OnboardingGroupMenu label={t("onboarding.sharing.computers")}>
    {(close) => <>
      {deviceId && <DesktopMenuItem icon={sharing?.paused ? <Play size={14} /> : <Pause size={14} />}
        label={t(sharing?.paused ? "hosts.sharing.resume" : "hosts.sharing.pause")}
        onClick={() => { close(); void catalog.run(async () => window.puppyoneDesktop?.setHostSharingPaused({
          paused: !sharing?.paused, expectedSession: catalog.expectedSession }), "hosts.catalog.updateFailure"); }} />}
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
      {others.length > 0 && <DesktopMenuSeparator />}
      {others.map((device) => <DesktopMenuItem key={device.id} destructive icon={<Trash2 size={14} />}
        label={t("onboarding.sharing.removeComputer", { host: bidiIsolate(device.name) })}
        detail={<ComputerPresence device={device} />}
        onClick={() => { close(); void catalog.run(async () => window.puppyoneDesktop?.revokeHostDevice({
          deviceId: device.id, expectedSession: catalog.expectedSession }), "hosts.catalog.removeFailure"); }} />)}
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
