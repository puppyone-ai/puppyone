import { useCallback, useEffect, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { DeviceFolderSelection } from "./DeviceFolderSurface";

type Catalog = Awaited<ReturnType<NonNullable<Window["puppyoneDesktop"]>["listHostDevices"]>>["devices"];

/** Signed-in catalog; an offline host remains listed but cannot be opened. */
export function HomepageDeviceFolders({ session, apiBase, onOpen }: {
  session: DesktopCloudSession; apiBase: string; onOpen: (selection: DeviceFolderSelection) => void;
}) {
  const { t } = useLocalization();
  const [devices, setDevices] = useState<Catalog>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.puppyoneDesktop?.listHostDevices({ userId: session.user_id,
        generation: session.session_generation });
      if (!Array.isArray(result?.devices)) throw new Error(t("hosts.catalog.unavailable"));
      setDevices(result.devices); setError(null);
    } catch (cause) { setDevices([]); setError(cause instanceof Error ? cause.message : t("hosts.catalog.unavailable")); }
    finally { setLoading(false); }
  }, [session.user_id, session.session_generation, t]);
  useEffect(() => { void refresh(); }, [refresh, apiBase]);
  return <section aria-label={t("hosts.catalog.title")} style={{ margin: "24px auto", maxWidth: 880, padding: "0 20px" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <h2 style={{ fontSize: 16 }}>{t("hosts.catalog.title")}</h2>
      <button type="button" onClick={() => void refresh()} disabled={loading}>{t("hosts.catalog.refresh")}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!error && !loading && devices.length === 0 && <p>{t("hosts.catalog.empty")}</p>}
    {devices.map(device => <div key={device.id}>
      <h3 style={{ fontSize: 14 }}>{device.name} · {device.online ? t("hosts.catalog.online") : t("hosts.catalog.offline")}</h3>
      {device.folders.filter(folder => folder.state === "active").map(folder =>
        <div key={folder.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button type="button" disabled={!device.online}
            onClick={() => onOpen({ ref: { deployment: apiBase, accountId: session.user_id,
              deviceId: device.id, folderId: folder.id }, name: folder.name,
              writable: folder.capabilities.includes("folder.write") })}>
            {folder.name}
          </button>
          <button type="button" onClick={() => {
            void window.puppyoneDesktop?.removeHostFolder({ deviceId: device.id, folderId: folder.id,
              expectedSession: { userId: session.user_id, generation: session.session_generation } })
              .then(() => refresh()).catch(cause => setError(cause instanceof Error ? cause.message : t("hosts.catalog.removeFailure")));
          }}>{t("hosts.catalog.remove")}</button>
        </div>)}
    </div>)}
  </section>;
}
