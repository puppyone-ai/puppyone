import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { HostCatalogDevice, HostSession, HostSharingStatus } from "../../../../shared/host-contract/types";

/** Presence changes while the page is open; a quiet poll keeps "online" honest without a button. */
const CATALOG_REFRESH_MS = 30_000;

export type HostAutostart = Readonly<{ supported: boolean; enabled: boolean }>;

export type HostCatalog = Readonly<{
  /** The owner's computers, this one first once it is known. */
  devices: readonly HostCatalogDevice[];
  /** This computer's sharing, from its own host service. */
  sharing: HostSharingStatus | null;
  autostart: HostAutostart | null;
  /** This computer's id in the catalog, once it has shared anything. */
  thisComputerId: string | null;
  loaded: boolean;
  error: string | null;
  expectedSession: HostSession;
  refresh: () => Promise<void>;
  /** Runs one change, then reads the catalog again; a refusal becomes `error`. */
  run: (change: () => Promise<unknown> | undefined, failure: string) => Promise<boolean>;
  setAutostart: (enabled: boolean) => Promise<void>;
  clearError: () => void;
}>;

/**
 * The owner's computers and this computer's sharing. Every change goes through
 * Main, which asks the person before anything is widened; this only reads and asks.
 */
export function useHostCatalog(session: Readonly<{ user_id: string; session_generation: string }>): HostCatalog {
  const { t } = useLocalization();
  const [devices, setDevices] = useState<readonly HostCatalogDevice[]>([]);
  const [sharing, setSharing] = useState<HostSharingStatus | null>(null);
  const [autostart, setAutostartState] = useState<HostAutostart | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expectedSession = useMemo(() => ({ userId: session.user_id, generation: session.session_generation }),
    [session.user_id, session.session_generation]);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const refresh = useCallback(async () => {
    const bridge = window.puppyoneDesktop;
    if (!bridge?.listHostDevices) return;
    const [catalog, status] = await Promise.all([
      bridge.listHostDevices(expectedSession).catch(() => null),
      bridge.getHostStatus?.().catch(() => null),
    ]);
    if (!live.current) return;
    if (Array.isArray(catalog?.devices)) {
      setDevices(catalog.devices);
      setError((current) => current === t("hosts.catalog.unavailable") ? null : current);
    } else {
      setError(t("hosts.catalog.unavailable"));
    }
    if (status) setSharing(status);
    setLoaded(true);
  }, [expectedSession, t]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); },
      CATALOG_REFRESH_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  useEffect(() => window.puppyoneDesktop?.onHostStatus?.((status) => {
    if (live.current) setSharing((previous) => ({ ...(previous ?? {}), ...status }) as HostSharingStatus);
  }), []);

  useEffect(() => {
    void window.puppyoneDesktop?.getHostAutostart?.()
      .then((value) => { if (live.current) setAutostartState(value); })
      .catch(() => undefined);
  }, []);

  const run = useCallback(async (change: () => Promise<unknown> | undefined, failure: string) => {
    setError(null);
    try {
      await change();
      await refresh();
      return true;
    } catch (cause) {
      if (live.current) setError(cause instanceof Error && cause.message ? cause.message : t(failure));
      return false;
    }
  }, [refresh, t]);

  const setAutostart = useCallback(async (enabled: boolean) => {
    setError(null);
    try {
      const next = await window.puppyoneDesktop?.setHostAutostart?.({ enabled });
      if (next && live.current) setAutostartState(next);
    } catch {
      if (live.current) setError(t("hosts.sharing.startAtLoginFailure"));
    }
  }, [t]);

  const thisComputerId = sharing?.deviceId ?? null;
  const ordered = useMemo(() => [...devices].sort((left, right) =>
    Number(right.id === thisComputerId) - Number(left.id === thisComputerId)), [devices, thisComputerId]);
  const clearError = useCallback(() => setError(null), []);

  return { devices: ordered, sharing, autostart, thisComputerId, loaded, error, expectedSession, refresh, run,
    setAutostart, clearError };
}

/** The folders this computer offers right now, by id. */
export function activeSharedFolderIds(catalog: Pick<HostCatalog, "devices" | "thisComputerId">): ReadonlySet<string> {
  const mine = catalog.devices.find((device) => device.id === catalog.thisComputerId);
  return new Set(mine?.folders.filter((folder) => folder.state === "active").map((folder) => folder.id) ?? []);
}
