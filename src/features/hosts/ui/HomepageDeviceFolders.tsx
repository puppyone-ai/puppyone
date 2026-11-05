import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { HostCatalogDevice, HostSharingStatus, RecentHostFolder } from "../../../../shared/host-contract/types";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { HostFolderSelection } from "../../app-shell/window-project/windowProjectStore";

type RelativeTime = (value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) => string;

function relativeTime(value: string | null, format: RelativeTime): string | null {
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
 * Folders grouped by the computer they live on. This computer is listed first
 * with its sharing switch; another computer that is offline stays listed with
 * when it was last online, and its folders cannot be opened until it returns.
 */
/** What remote runs may do on this computer, in the words of its execution tier. */
function tierMessage(sharing: HostSharingStatus) {
  if (sharing.wholeComputer) return "hosts.execution.wholeComputerOn";
  return sharing.sandbox ? "hosts.execution.sandboxed" : "hosts.execution.noSandbox";
}

export function HomepageDeviceFolders({ session, apiBase, onOpen }: {
  session: DesktopCloudSession; apiBase: string; onOpen: (selection: HostFolderSelection) => void;
}) {
  const { t, formatRelativeTime } = useLocalization();
  const [devices, setDevices] = useState<HostCatalogDevice[]>([]);
  const [recents, setRecents] = useState<RecentHostFolder[]>([]);
  const [sharing, setSharing] = useState<HostSharingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const expectedSession = useMemo(() => ({ userId: session.user_id, generation: session.session_generation }),
    [session.user_id, session.session_generation]);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const bridge = window.puppyoneDesktop;
      const [result, recent, status] = await Promise.all([
        bridge?.listHostDevices(expectedSession),
        bridge?.listRecentHostFolders?.(expectedSession).catch(() => null),
        bridge?.getHostStatus?.().catch(() => null),
      ]);
      if (!Array.isArray(result?.devices)) throw new Error(t("hosts.catalog.unavailable"));
      setDevices(result.devices); setRecents(recent?.folders ?? []); setSharing(status ?? null); setError(null);
    } catch (cause) { setDevices([]); setError(cause instanceof Error ? cause.message : t("hosts.catalog.unavailable")); }
    finally { setLoading(false); }
  }, [expectedSession, t]);
  useEffect(() => { void refresh(); }, [refresh, apiBase]);
  useEffect(() => window.puppyoneDesktop?.onHostStatus?.((status) => setSharing((previous) =>
    ({ ...(previous ?? {}), ...status }) as HostSharingStatus)), []);
  const thisComputer = sharing?.deviceId ?? null;
  const ordered = [...devices].sort((left, right) => Number(right.id === thisComputer) - Number(left.id === thisComputer));
  const open = (device: HostCatalogDevice, folder: HostCatalogDevice["folders"][number]) => onOpen({
    ref: { deployment: apiBase, accountId: session.user_id, deviceId: device.id, folderId: folder.id },
    name: folder.name, hostName: device.name, writable: folder.capabilities.includes("folder.write"),
    capabilities: folder.capabilities });
  const act = (operation: Promise<unknown> | undefined, failure: string) => {
    void operation?.then(() => refresh()).catch((cause) => setError(cause instanceof Error ? cause.message : t(failure)));
  };
  const stateLabels: Partial<Record<HostSharingStatus["state"], string>> = {
    online: t("hosts.sharing.online"),
    connecting: t("hosts.sharing.connecting"),
    offline: t("hosts.sharing.reconnecting"),
    outdated: t("hosts.sharing.outdated"),
  };
  const sharingLabel = sharing?.paused ? t("hosts.sharing.paused") : (sharing && stateLabels[sharing.state]) ?? null;
  return <section aria-label={t("hosts.catalog.title")} style={{ margin: "24px auto", maxWidth: 880, padding: "0 20px" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <h2 style={{ fontSize: "var(--po-type-ui-heading)" }}>{t("hosts.catalog.title")}</h2>
      <button type="button" onClick={() => void refresh()} disabled={loading}>{t("hosts.catalog.refresh")}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!error && !loading && devices.length === 0 && <p>{t("hosts.catalog.empty")}</p>}
    {ordered.map((device) => {
      const mine = device.id === thisComputer;
      const lastSeen = relativeTime(device.last_seen_at, formatRelativeTime);
      let presence = t("hosts.catalog.offline");
      if (device.online) presence = t("hosts.catalog.online");
      else if (lastSeen) presence = t("hosts.catalog.lastSeen", { time: lastSeen });
      return <div key={device.id} data-host-device={device.id}>
        <h3 style={{ fontSize: "var(--po-type-ui-body-large)", display: "flex", gap: 8, alignItems: "center" }}>
          <span>{mine ? t("hosts.catalog.thisComputer", { name: device.name }) : device.name}</span>
          <span>· {presence}</span>
          {mine && sharingLabel && <span role="status">· {sharingLabel}</span>}
          {mine && sharing && sharing.activeRequests + sharing.watching > 0 &&
            <span role="status">· {t("hosts.sharing.inUse")}</span>}
          {mine && (sharing?.running?.length ?? 0) > 0 && <>
            <span role="status">· {t("hosts.execution.running", { count: sharing?.running?.length ?? 0 })}</span>
            <button type="button" onClick={() => act(window.puppyoneDesktop?.stopRemoteHostSessions?.(),
              "hosts.catalog.updateFailure")}>{t("hosts.execution.stopAll")}</button>
          </>}
          {mine && <button type="button" onClick={() => act(window.puppyoneDesktop?.setHostSharingPaused?.({
            paused: !sharing?.paused, expectedSession }), "hosts.catalog.updateFailure")}>
            {sharing?.paused ? t("hosts.sharing.resume") : t("hosts.sharing.pause")}</button>}
          <button type="button" onClick={() => act(window.puppyoneDesktop?.revokeHostDevice?.({
            deviceId: device.id, expectedSession }), "hosts.catalog.removeFailure")}>
            {t("hosts.catalog.removeComputer")}</button>
        </h3>
        {mine && sharing && <p className="desktop-host-tier" role="note"
          style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 8px" }}>
          <span>{t(tierMessage(sharing))}</span>
          <label style={{ display: "inline-flex", gap: 4 }}>
            <input type="checkbox" checked={sharing.wholeComputer === true} onChange={() => act(
              window.puppyoneDesktop?.setHostWholeComputer?.({ enabled: sharing.wholeComputer !== true, expectedSession }),
              "hosts.catalog.updateFailure")} />
            {t("hosts.execution.wholeComputer")}
          </label>
        </p>}
        {device.folders.filter((folder) => folder.state === "active").map((folder) => {
          const writable = folder.capabilities.includes("folder.write");
          return <div key={folder.id} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            {mine
              ? <span>{folder.name}</span>
              : <button type="button" disabled={!device.online} onClick={() => open(device, folder)}>{folder.name}</button>}
            <span>{writable ? t("hosts.catalog.editable") : t("hosts.catalog.readOnly")}</span>
            {mine && <button type="button" onClick={() => act(window.puppyoneDesktop?.updateHostFolder?.({
              deviceId: device.id, folderId: folder.id, name: folder.name, writable: !writable,
              expectedRevision: folder.revision, expectedSession }), "hosts.catalog.updateFailure")}>
              {writable ? t("hosts.catalog.makeReadOnly") : t("hosts.catalog.allowEditing")}</button>}
            {mine && writable && <span className="desktop-host-execution" style={{ display: "inline-flex", gap: 8 }}>
              {(["terminal", "git", "agent"] as const).map((kind) => {
                const capability = { terminal: "folder.shell", git: "folder.git", agent: "folder.agent" }[kind];
                const allowed = folder.capabilities.includes(capability as HostCatalogDevice["folders"][number]["capabilities"][number]);
                const next = { terminal: folder.capabilities.includes("folder.shell"), git: folder.capabilities.includes("folder.git"),
                  agent: folder.capabilities.includes("folder.agent"), [kind]: !allowed };
                return <label key={kind} style={{ display: "inline-flex", gap: 4 }}>
                  <input type="checkbox" checked={allowed} onChange={() => act(window.puppyoneDesktop?.setHostExecution?.({
                    deviceId: device.id, folderId: folder.id, ...next, expectedRevision: folder.revision, expectedSession }),
                    "hosts.catalog.updateFailure")} />
                  {t(`hosts.execution.${kind}`)}
                </label>;
              })}
            </span>}
            <button type="button" onClick={() => act(window.puppyoneDesktop?.removeHostFolder({
              deviceId: device.id, folderId: folder.id, expectedSession }), "hosts.catalog.removeFailure")}>
              {t("hosts.catalog.remove")}</button>
          </div>;
        })}
      </div>;
    })}
    {recents.length > 0 && <div>
      <h3 style={{ fontSize: "var(--po-type-ui-body-large)" }}>{t("hosts.catalog.recent")}</h3>
      {recents.map((recent) => {
        const device = devices.find((item) => item.id === recent.deviceId);
        const folder = device?.folders.find((item) => item.id === recent.folderId && item.state === "active");
        return <div key={recent.folderId} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button type="button" disabled={!device?.online || !folder}
            onClick={() => device && folder && open(device, folder)}>
            {recent.name} · {t("hosts.folder.onHost", { host: device?.name ?? recent.hostName })}</button>
          {!folder && <span>{t("hosts.catalog.noLongerShared")}</span>}
          <button type="button" onClick={() => act(window.puppyoneDesktop?.forgetRecentHostFolder?.({
            folderId: recent.folderId, expectedSession }), "hosts.catalog.removeFailure")}>
            {t("hosts.catalog.forgetRecent")}</button>
        </div>;
      })}
    </div>}
  </section>;
}
