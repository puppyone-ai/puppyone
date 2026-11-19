import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { HostCatalogDevice, HostSession, HostSharingStatus } from "../../../../shared/host-contract/types";

const CATALOG_REFRESH_MS = 30_000;
export type HostAutostart = Readonly<{ supported: boolean; enabled: boolean }>;
type CatalogState = {
  key: string;
  devices: readonly HostCatalogDevice[];
  sharing: HostSharingStatus | null;
  autostart: HostAutostart | null;
  loaded: boolean;
  statusError: boolean;
  catalogError: string | null;
  actionError: string | null;
  refreshing: boolean;
  pending: boolean;
};
const emptyState = (key: string): CatalogState => ({ key, devices: [], sharing: null, autostart: null,
  loaded: false, statusError: false, catalogError: null, actionError: null, refreshing: false, pending: false });

export type HostCatalog = Readonly<Omit<CatalogState, "key"> & {
  thisComputerId: string | null;
  error: string | null;
  expectedSession: HostSession;
  refresh: (force?: boolean) => Promise<void>;
  run: (change: () => Promise<unknown> | undefined, failure: string) => Promise<boolean>;
  setAutostart: (enabled: boolean) => Promise<void>;
  clearError: () => void;
}>;

/** Independent local status and device reads; failures never become an empty list or "On". */
export function useHostCatalog(session: Readonly<{ user_id: string; session_generation: string }>): HostCatalog {
  const { t } = useLocalization();
  const key = `${session.user_id}\u001f${session.session_generation}`;
  const expectedSession = useMemo(() => ({ userId: session.user_id, generation: session.session_generation }),
    [session.user_id, session.session_generation]);
  const [stored, setStored] = useState(() => emptyState(key));
  const state = stored.key === key ? stored : emptyState(key);
  const currentKey = useRef(key);
  const live = useRef(true);
  const epoch = useRef(0);
  const statusVersion = useRef(0);
  const active = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const mutation = useRef(false);
  useLayoutEffect(() => { currentKey.current = key; }, [key]);
  useEffect(() => { live.current = true; return () => {
    live.current = false; epoch.current += 1; active.current = null;
  }; }, []);
  const update = useCallback((patch: Partial<CatalogState>) => {
    if (live.current && currentKey.current === key) {
      setStored((previous) => ({ ...(previous.key === key ? previous : emptyState(key)), ...patch }));
    }
  }, [key]);

  const refresh = useCallback((force = false): Promise<void> => {
    if (!live.current || currentKey.current !== key) return Promise.resolve();
    if (!force && active.current?.key === key) return active.current.promise;
    const request = ++epoch.current;
    const capturedStatus = statusVersion.current;
    const valid = () => live.current && currentKey.current === key && request === epoch.current;
    const bridge = window.puppyoneDesktop;
    update({ refreshing: true });
    const promise = Promise.all([
      Promise.resolve().then(() => bridge?.listHostDevices?.(expectedSession)).then((catalog) => {
        if (!valid()) return;
        if (!Array.isArray(catalog?.devices)) throw new Error();
        update({ devices: catalog.devices, loaded: true, catalogError: null });
      }).catch(() => { if (valid()) update({ catalogError: t("hosts.catalog.unavailable") }); }),
      Promise.resolve().then(() => bridge?.getHostStatus?.()).then((sharing) => {
        if (!valid() || capturedStatus !== statusVersion.current) return;
        if (!sharing) throw new Error();
        update({ sharing, statusError: false });
      }).catch(() => { if (valid() && capturedStatus === statusVersion.current) update({ statusError: true }); }),
    ]).then(() => undefined).finally(() => {
      if (valid()) update({ refreshing: false });
      if (active.current?.promise === promise) active.current = null;
    });
    active.current = { key, promise };
    return promise;
  }, [expectedSession, key, t, update]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, CATALOG_REFRESH_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  useEffect(() => window.puppyoneDesktop?.onHostStatus?.((status) => {
    if (!live.current || currentKey.current !== key) return;
    statusVersion.current += 1;
    setStored((previous) => {
      const current = previous.key === key ? previous : emptyState(key);
      return { ...current, sharing: { ...(current.sharing ?? {}), ...status } as HostSharingStatus,
        statusError: false };
    });
  }), [key]);

  useEffect(() => {
    void window.puppyoneDesktop?.getHostAutostart?.()
      .then((autostart) => { if (autostart) update({ autostart }); }).catch(() => undefined);
  }, [update]);

  const run = useCallback(async (change: () => Promise<unknown> | undefined, failure: string) => {
    if (mutation.current) return false;
    mutation.current = true;
    update({ pending: true, actionError: null });
    try {
      await change();
      await refresh(true);
      return true;
    } catch {
      update({ actionError: t(failure) });
      return false;
    } finally { mutation.current = false; update({ pending: false }); }
  }, [refresh, t, update]);

  const setAutostart = useCallback(async (enabled: boolean) => {
    await run(async () => {
      const autostart = await window.puppyoneDesktop?.setHostAutostart?.({ enabled });
      if (!autostart) throw new Error();
      update({ autostart });
    }, "hosts.sharing.startAtLoginFailure");
  }, [run, update]);
  const clearError = useCallback(() => update({ actionError: null }), [update]);
  const thisComputerId = state.sharing?.deviceId ?? null;
  const devices = useMemo(() => [...state.devices].sort((left, right) =>
    Number(right.id === thisComputerId) - Number(left.id === thisComputerId)), [state.devices, thisComputerId]);
  return { ...state, devices, thisComputerId, error: state.actionError ?? state.catalogError,
    expectedSession, refresh, run, setAutostart, clearError };
}

/** The folders this computer offers right now, by id. */
export function activeSharedFolderIds(catalog: Pick<HostCatalog, "devices" | "thisComputerId">): ReadonlySet<string> {
  const mine = catalog.devices.find((device) => device.id === catalog.thisComputerId);
  return new Set(mine?.folders.filter((folder) => folder.state === "active").map((folder) => folder.id) ?? []);
}
