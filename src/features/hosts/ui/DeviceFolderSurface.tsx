import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { DataWorkspace, closeDocumentWorkingCopiesUnderResource,
  withEditorDocumentOperations } from "@puppyone/shared-ui";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { createDeviceDataService } from "../data/deviceDataPort";
import type { DeviceFolderRef } from "../model/deviceFolderIdentity";

export type DeviceFolderSelection = { ref: DeviceFolderRef; name: string; writable: boolean };

/** An isolated file workspace. Device files never become local checkout paths. */
export function DeviceFolderSurface({ selection, session, apiBase, onHome }: {
  selection: DeviceFolderSelection; session: DesktopCloudSession; apiBase: string; onHome: () => void | Promise<void>;
}) {
  const { t } = useLocalization();
  const lease = useMemo(() => ({ current: true }), [selection, session, apiBase]);
  const leaseRef = useRef(lease);
  leaseRef.current = lease;
  useEffect(() => () => { lease.current = false; }, [lease]);
  const [closeError, setCloseError] = useState<string | null>(null);
  const service = useMemo(() => createDeviceDataService({ ...selection, session, apiBase,
    isCurrent: () => lease.current && leaseRef.current === lease }),
    [selection, session, apiBase, lease]);
  const close = async () => {
    try {
      await closeDocumentWorkingCopiesUnderResource(service.workspace.id, service.folder.uri);
      setCloseError(null); await onHome();
    } catch (cause) { setCloseError(cause instanceof Error ? cause.message : t("hosts.folder.closeFailure")); }
  };
  useEffect(() => () => service.dispose(), [service]);
  const dataPort = useMemo(() => withEditorDocumentOperations(service.dataPort), [service]);
  return <div className="desktop-device-folder-surface" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <header style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 20px" }}>
      <button type="button" onClick={() => void close()}>← {t("hosts.folder.home")}</button>
      <strong>{selection.name}</strong>
      <span>{selection.writable ? t("hosts.folder.editing") : t("hosts.folder.readOnly")}</span>
      {closeError && <span role="alert">{closeError}</span>}
    </header>
    <div style={{ flex: 1, minHeight: 0 }}>
      <DataWorkspace key={service.workspace.id} workspace={service.workspace} dataPort={dataPort}
        documentSourceKind="cloud" capabilities={{ write: selection.writable }}
        showHeader={false} />
    </div>
  </div>;
}
