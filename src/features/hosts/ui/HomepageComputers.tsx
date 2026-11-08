import { useLocalization } from "@puppyone/localization";
import { useState } from "react";
import {
  onboardingBaseGroups,
  OnboardingProjectGroups,
  type OnboardingGroupsBase,
  type OnboardingProjectGroup,
} from "../../../components/onboarding/OnboardingProjectGroups";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { useHostCatalog, type HostCatalog } from "../data/useHostCatalog";
import { forgetSharedFolder, useSharedFolderAssignments } from "../model/sharedFolders";
import type { HostFolderSelection } from "../model/hostFolderSelection";
import { HostFolderSharingDialog, type HostFolderSharingTarget } from "./HostFolderSharingDialog";
import { RemoteFolderList } from "./RemoteFolderList";


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
    otherComputers: catalog.devices.filter((device) => device.id !== catalog.thisComputerId).map((device) => device.name),
    onSharingSettings: ({ folderId, name, rootPath }) => setSharingTarget({ kind: "settings", folderId, name, rootPath }),
    // Main asks before the folder closes to the other computers; a refusal changes nothing.
    onStopSharing: mine ? ({ folderId, rootPath }) => {
      let cancelled = false;
      void catalog.run(async () => {
        const result = await window.puppyoneDesktop?.removeHostFolder({ deviceId: mine.id, folderId,
          expectedSession: catalog.expectedSession });
        cancelled = Boolean(result && "cancelled" in result);
        return result;
      }, "hosts.catalog.removeFailure").then((done) => { if (done && !cancelled) forgetSharedFolder(folderId, rootPath); });
    } : undefined,
  });
  const others = catalog.devices.filter((device) => device.id !== catalog.thisComputerId);
  const localFolderIds = new Set(local?.items.flatMap((item) => item.hostFolderId ? [item.hostFolderId] : []));
  const visible = others.map((device) => ({ ...device,
    folders: device.folders.filter((folder) => !localFolderIds.has(folder.id)),
  })).filter((device) => device.folders.length > 0);
  if (visible.length) {
    const index = groups.findIndex((group) => group.id === "personal-shared");
    const previous = groups[index] ?? base.cloud.find((group) => group.id === "personal-shared");
    const personal: OnboardingProjectGroup = {
      ...previous, id: "personal-shared", title: base.personalSharedTitle,
      alwaysShowHeading: true, empty: false,
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
    // The personal area is always there to drop into: dragging a folder in is how it
    // is shared, and every computer signed in to this account can then open it.
    const index = groups.findIndex((group) => group.id === "personal-shared");
    const previous = groups[index];
    const personal: OnboardingProjectGroup = {
      ...previous, id: "personal-shared", title: base.personalSharedTitle,
      alwaysShowHeading: true, empty: false,
      dropTarget: share.draggingPath ? { enabled: Boolean(source) && !share.busy,
        hint: t("onboarding.drop.personal"), onDrop: () => {
        share.endDrag();
        if (source && !share.busy) void share.request(source.localPath);
      } } : undefined,
      children: previous && !previous.empty ? previous.children
        : <p className="onboarding-cloud-space-empty">{t("onboarding.spaces.empty")}</p>,
    };
    if (index < 0) groups.push(personal);
    else groups[index] = personal;
  }
  const personalIndex = groups.findIndex((group) => group.id === "personal-shared");
  if (personalIndex >= 0 && catalog.thisComputerId) {
    groups[personalIndex] = { ...groups[personalIndex],
      detail: <ThisComputerDetail catalog={catalog} offering={sharedFolderIds.size} /> };
  }
  return <>
    <OnboardingProjectGroups label={base.label} groups={groups}
      note={catalog.error ? <HomepageComputersNote catalog={catalog} /> : undefined} />
    {sharingTarget && <HostFolderSharingDialog target={sharingTarget} catalog={catalog}
      onClose={() => setSharingTarget(null)} />}
  </>;

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
  // Paused sharing is resumed where it is seen to be paused; nothing else offers it.
  const resume = sharing?.paused && sharing.state !== "outdated" && <button type="button" className="onboarding-project-group-resume"
    onClick={() => { void catalog.run(async () => window.puppyoneDesktop?.setHostSharingPaused({
      paused: false, expectedSession: catalog.expectedSession }), "hosts.catalog.updateFailure"); }}>
    {t("hosts.sharing.resume")}
  </button>;
  return <span className="onboarding-project-group-presence" data-online={(sharing?.state === "online" && !sharing.paused) || undefined}>
    {[text, running > 0 && t("hosts.execution.running", { count: running })].filter(Boolean).join(" · ")}
    {resume}
  </span>;
}

function HomepageComputersNote({ catalog }: { catalog: HostCatalog }) {
  const { t } = useLocalization();
  return <p className="onboarding-project-groups-note" role="status">
    <span>{catalog.error}</span>
    <button type="button" className="project-cloud-link-button" onClick={() => { catalog.clearError(); void catalog.refresh(); }}>
      {t("common.action.retry")}</button>
  </p>;
}
