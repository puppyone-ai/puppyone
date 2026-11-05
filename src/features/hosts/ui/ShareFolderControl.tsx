import { useState } from "react";
import { useLocalization } from "@puppyone/localization";

/**
 * "Open on my other computers" for the folder shown in this window. One
 * explicit registration per folder; read-only unless editing is chosen. The
 * confirmation dialog itself is shown by Main, which owns the folder path.
 */
export function ShareFolderControl({ rootPath, sharedFolderId }: {
  rootPath: string;
  /** Present when this folder is already open on the owner's other computers. */
  sharedFolderId?: string | null;
}) {
  const { t } = useLocalization();
  const [status, setStatus] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const share = (writable: boolean) => {
    setChoosing(false);
    setStatus(t("hosts.register.pending"));
    void window.puppyoneDesktop?.registerHostFolder({ rootPath, writable }).then((result) => {
      setStatus("cancelled" in result ? null : t("hosts.register.success"));
    }).catch((cause: unknown) => setStatus(cause instanceof Error ? cause.message : t("hosts.register.failure")));
  };
  if (sharedFolderId && !status) {
    return <span role="status" className="desktop-share-folder-state">{t("hosts.register.shared")}</span>;
  }
  return <span className="desktop-share-folder-control" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
    {choosing ? <>
      <button type="button" onClick={() => share(false)}>{t("hosts.register.readOnly")}</button>
      <button type="button" onClick={() => share(true)}>{t("hosts.register.editable")}</button>
      <button type="button" onClick={() => setChoosing(false)}>{t("hosts.register.cancel")}</button>
    </> : <button type="button" onClick={() => setChoosing(true)}>{t("hosts.register.action")}</button>}
    {status && <span role="status">{status}</span>}
  </span>;
}
