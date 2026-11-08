import { useEffect, useState, type ReactNode } from "react";
import type { HostSharingStatus } from "../../../../shared/host-contract/types";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { OtherComputersLabel, type DevicesAudience } from "../../../components/project-audience";
import { useHostCatalog } from "../data/useHostCatalog";
import { forgetSharedFolder, useSharedFolderId } from "../model/sharedFolders";
import { HostFolderSharingDialog, type HostFolderSharingTarget } from "./HostFolderSharingDialog";

/**
 * Whether the folder in this window is open to the owner's other computers, as the
 * all-my-devices audience of its place menu: turned on through the sharing dialog,
 * stopped after Main asks, and its settings one line below.
 */
export function useHostFolderPlace({ enabled, session, rootPath, recordedFolderId, name }: {
  enabled: boolean;
  session: DesktopCloudSession | null | undefined;
  rootPath: string | null | undefined;
  recordedFolderId: string | null | undefined;
  name: string;
}): { devices?: DevicesAudience; dialog: ReactNode } {
  const [target, setTarget] = useState<HostFolderSharingTarget | null>(null);
  const folderId = useSharedFolderId(rootPath, recordedFolderId);
  const status = useHostSharingStatus(enabled);
  const usable = enabled && Boolean(session && rootPath);
  const [shownFor, setShownFor] = useState(rootPath);
  if (shownFor !== rootPath) {
    setShownFor(rootPath);
    setTarget(null);
  }
  const offered = folderId ? status?.folders?.find((folder) => folder.folderId === folderId) : undefined;
  // Until this computer's own service answers, a recorded share is taken at its word.
  const shared = Boolean(folderId) && (offered !== undefined || status === null);
  const stop = async () => {
    if (!session || !rootPath || !folderId || !status?.deviceId) return;
    try {
      const result = await window.puppyoneDesktop?.removeHostFolder({ deviceId: status.deviceId, folderId,
        expectedSession: { userId: session.user_id, generation: session.session_generation } });
      if (result && !("cancelled" in result)) forgetSharedFolder(folderId, rootPath);
    } catch {
      // The settings say what went wrong and offer stopping again.
      setTarget({ kind: "settings", folderId, name, rootPath });
    }
  };
  return {
    devices: usable && rootPath && session ? {
      on: shared,
      detail: shared ? <OtherComputers session={session} paused={Boolean(status?.paused)} /> : undefined,
      onTurnOn: () => setTarget({ kind: "share", rootPath, name }),
      onStop: folderId && status?.deviceId ? () => void stop() : undefined,
      onSettings: folderId ? () => setTarget({ kind: "settings", folderId, name, rootPath }) : undefined,
    } : undefined,
    dialog: usable && session && target
      ? <HostFolderSharingSurface session={session} target={target} onClose={() => setTarget(null)} /> : null,
  };
}

function HostFolderSharingSurface({ session, target, onClose }: {
  session: DesktopCloudSession;
  target: HostFolderSharingTarget;
  onClose: () => void;
}) {
  const catalog = useHostCatalog(session);
  return <HostFolderSharingDialog target={target} catalog={catalog} onClose={onClose} />;
}

/**
 * Which of the owner's other computers can open the folder, read when the menu
 * shows it: "Studio Mac and 2 others". Until the catalog answers, it says so plainly.
 */
function OtherComputers({ session, paused }: { session: DesktopCloudSession; paused: boolean }) {
  const catalog = useHostCatalog(session);
  const names = catalog.devices.filter((device) => device.id !== catalog.thisComputerId).map((device) => device.name);
  return <OtherComputersLabel names={names} paused={paused} />;
}

/** This computer's sharing, from its own host service: no network, so it is there at once. */
function useHostSharingStatus(enabled: boolean) {
  const [status, setStatus] = useState<HostSharingStatus | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void window.puppyoneDesktop?.getHostStatus?.().then((value) => { if (live) setStatus(value); }).catch(() => undefined);
    const stop = window.puppyoneDesktop?.onHostStatus?.((value) => {
      if (live) setStatus((previous) => ({ ...(previous ?? {}), ...value }) as HostSharingStatus);
    });
    return () => { live = false; stop?.(); };
  }, [enabled]);
  return status;
}
