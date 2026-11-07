import { LocalIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { useEffect, useState, type ReactNode } from "react";
import type { HostSharingStatus } from "../../../../shared/host-contract/types";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { useHostCatalog } from "../data/useHostCatalog";
import { useSharedFolderId } from "../model/sharedFolders";
import { HostFolderSharingDialog, type HostFolderSharingTarget } from "./HostFolderSharingDialog";

/**
 * Opening the folder in this window on the owner's other computers belongs with
 * where the folder is, in the Header's place menu, not among the Header's tools.
 * The row says whether it is open to them and how; the dialog changes that.
 */
export function useHostFolderPlace({ enabled, session, rootPath, recordedFolderId, name }: {
  enabled: boolean;
  session: DesktopCloudSession | null | undefined;
  rootPath: string | null | undefined;
  recordedFolderId: string | null | undefined;
  name: string;
}): { placeRows?: (dismiss: () => void) => ReactNode; dialog: ReactNode } {
  const [target, setTarget] = useState<HostFolderSharingTarget | null>(null);
  const folderId = useSharedFolderId(rootPath, recordedFolderId);
  const usable = enabled && Boolean(session && rootPath);
  const [shownFor, setShownFor] = useState(rootPath);
  if (shownFor !== rootPath) {
    setShownFor(rootPath);
    setTarget(null);
  }
  return {
    placeRows: usable && rootPath ? (dismiss) => <HostFolderPlaceRow folderId={folderId} onOpen={(shared) => {
      dismiss();
      setTarget(shared && folderId ? { kind: "settings", folderId, name, rootPath } : { kind: "share", rootPath, name });
    }} /> : undefined,
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

function HostFolderPlaceRow({ folderId, onOpen }: { folderId: string | null; onOpen: (shared: boolean) => void }) {
  const { t } = useLocalization();
  const status = useHostSharingStatus();
  const offered = folderId ? status?.folders?.find((folder) => folder.folderId === folderId) : undefined;
  // Until this computer's own service answers, a recorded share is taken at its word.
  const shared = Boolean(folderId) && (offered !== undefined || status === null);
  let detail: string | undefined;
  if (offered) detail = t(offered.writable ? "hosts.catalog.editable" : "hosts.catalog.readOnly");
  if (offered && status?.paused) detail = `${detail} · ${t("hosts.sharing.paused")}`;
  return <DesktopMenuItem className="desktop-project-place-row" role="button" data-project-place-row="other-computers"
    icon={<span className="desktop-project-place-mark" aria-hidden="true"><LocalIcon size={15} strokeWidth={1.75} /></span>}
    label={t(shared ? "hosts.place.shared" : "hosts.place.share")} detail={shared ? detail : undefined}
    onClick={() => onOpen(shared)} />;
}

/** This computer's sharing, from its own host service: no network, so it is there at once. */
function useHostSharingStatus() {
  const [status, setStatus] = useState<HostSharingStatus | null>(null);
  useEffect(() => {
    let live = true;
    void window.puppyoneDesktop?.getHostStatus?.().then((value) => { if (live) setStatus(value); }).catch(() => undefined);
    const stop = window.puppyoneDesktop?.onHostStatus?.((value) => {
      if (live) setStatus((previous) => ({ ...(previous ?? {}), ...value }) as HostSharingStatus);
    });
    return () => { live = false; stop?.(); };
  }, []);
  return status;
}
