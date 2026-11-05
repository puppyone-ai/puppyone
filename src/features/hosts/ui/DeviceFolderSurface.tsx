import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { DataWorkspace, appendWorkspaceContentChange, closeDocumentWorkingCopiesUnderResource,
  withEditorDocumentOperations, type WorkspaceContentChange } from "@puppyone/shared-ui";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { HostFolderSelection } from "../../app-shell/window-project/windowProjectStore";
import { createDeviceDataService, type DeviceFolderAvailability } from "../data/deviceDataPort";

/** @deprecated name kept for existing imports; the selection lives in the window project. */
export type DeviceFolderSelection = HostFolderSelection;

/**
 * Another computer's folder in this window. Files only: there is no terminal,
 * Agent, Git, "show in Finder" or "open with" for a folder that lives elsewhere.
 * Device files never become local checkout paths.
 */
export function DeviceFolderSurface({ selection, session, apiBase, onClose }: {
  selection: HostFolderSelection; session: DesktopCloudSession; apiBase: string; onClose: () => void | Promise<void>;
}) {
  const { t } = useLocalization();
  // One lease per folder identity and session: requests of a replaced service fail closed.
  const opened = useMemo(() => {
    const lease = { current: true };
    return { lease, service: createDeviceDataService({ ref: selection.ref, name: selection.name,
      writable: selection.writable, session, apiBase, isCurrent: () => lease.current }) };
  }, [selection, session, apiBase]);
  const { service } = opened;
  useEffect(() => () => { opened.lease.current = false; opened.service.dispose(); }, [opened]);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<DeviceFolderAvailability | "opening">("opening");
  const [refreshToken, setRefreshToken] = useState<WorkspaceContentChange>({ sequence: 0, entries: [] });
  const refresh = useCallback((paths: string[] | null) => setRefreshToken((current) =>
    appendWorkspaceContentChange(current, { rootUri: service.folder.uri, paths })), [service]);
  useEffect(() => service.watch(
    (paths) => refresh(paths),
    (next) => setAvailability((previous) => {
      // Coming back online: changes made meanwhile are unknown, so rescan.
      if (next === "online" && previous !== "online") refresh(null);
      return next;
    }),
  ), [service, refresh]);
  useEffect(() => {
    void window.puppyoneDesktop?.recordRecentHostFolder?.({ deviceId: selection.ref.deviceId,
      folderId: selection.ref.folderId, name: selection.name, hostName: selection.hostName,
      writable: selection.writable, expectedSession: { userId: session.user_id, generation: session.session_generation } })
      .catch(() => {});
  }, [selection, session.user_id, session.session_generation]);
  const close = async () => {
    try {
      await closeDocumentWorkingCopiesUnderResource(service.workspace.id, service.folder.uri);
      setCloseError(null);
      void window.puppyoneDesktop?.closeRecentHostFolder?.({
        expectedSession: { userId: session.user_id, generation: session.session_generation } }).catch(() => {});
      await onClose();
    } catch (cause) { setCloseError(cause instanceof Error ? cause.message : t("hosts.folder.closeFailure")); }
  };
  const dataPort = useMemo(() => withEditorDocumentOperations(service.dataPort), [service]);
  const banners: Partial<Record<typeof availability, string>> = {
    offline: t("hosts.folder.offline", { host: selection.hostName }),
    revoked: t("hosts.folder.revoked"),
    denied: t("hosts.folder.denied"),
  };
  const banner = banners[availability] ?? null;
  return <div className="desktop-device-folder-surface" data-host-folder={selection.ref.folderId}
    style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <header style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 20px" }}>
      <button type="button" onClick={() => void close()}>← {t("hosts.folder.home")}</button>
      <strong>{selection.name}</strong>
      <span>{t("hosts.folder.onHost", { host: selection.hostName })}</span>
      <span>{selection.writable ? t("hosts.folder.editing") : t("hosts.folder.readOnly")}</span>
      <button type="button" onClick={() => refresh(null)}>{t("hosts.catalog.refresh")}</button>
      {closeError && <span role="alert">{closeError}</span>}
    </header>
    {banner && <div role="status" className="desktop-device-folder-availability"
      data-availability={availability} style={{ padding: "8px 20px" }}>{banner}</div>}
    <div style={{ flex: 1, minHeight: 0 }}>
      <DataWorkspace key={service.workspace.id} workspace={service.workspace} dataPort={dataPort}
        documentSourceKind="cloud" capabilities={{ write: selection.writable, create: selection.writable,
          rename: selection.writable, delete: selection.writable, move: selection.writable, copy: false,
          history: false, localGit: false, cloudSync: false, accessPoints: false, connectors: false }}
        refreshKey={refreshToken} showHeader={false} />
    </div>
  </div>;
}
