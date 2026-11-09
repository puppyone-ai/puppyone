import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCloudOrganizationAccess, type DesktopBillingCatalog, type DesktopBillingSummary,
  type DesktopBillingUsage, type DesktopCloudSession } from "../../../lib/cloudApi";
import { loadBillingCatalog, loadBillingResource, loadBillingSummary, loadBillingUsage,
  readBillingResource, createCloudBillingContextKey, type BillingReadScope } from "../../cloud";

/** Cached readings belong to the window's explicit Space; personal wallets are separate. */
export type AccountPlanSnapshot = {
  catalog: DesktopBillingCatalog | null;
  summary: DesktopBillingSummary | null;
  usage: DesktopBillingUsage | null;
  organizationId: string | null;
  canManageBilling: boolean | null;
  loading: boolean;
  error: boolean;
  catalogUnavailable: boolean;
};
const EMPTY: AccountPlanSnapshot = {
  catalog: null, summary: null, usage: null, organizationId: null,
  canManageBilling: null, loading: false, error: false, catalogUnavailable: false,
};
function cachedSnapshot(scope: BillingReadScope): AccountPlanSnapshot {
  return {
    catalog: readBillingResource({ ...scope, organizationId: null }, "catalog") ?? null,
    summary: readBillingResource(scope, "summary") ?? null,
    usage: readBillingResource(scope, "usage") ?? null,
    organizationId: scope.organizationId ?? null,
    canManageBilling: readBillingResource(scope, "access")?.can_manage_billing ?? null,
    loading: true, error: false, catalogUnavailable: false,
  };
}
export function useAccountPlan({ session, apiBaseUrl, onSessionChange, enabled, organizationId = null }: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  enabled: boolean;
  organizationId?: string | null;
}): AccountPlanSnapshot & { refresh: (force?: boolean) => void } {
  const contextKey = enabled && session && organizationId
    ? createCloudBillingContextKey(session, apiBaseUrl, organizationId) : "";
  const scope = contextKey && session ? { session, apiBaseUrl, organizationId } : null;
  const [stored, setStored] = useState(() => ({ contextKey, snapshot: scope ? cachedSnapshot(scope) : EMPTY }));
  let snapshot = scope ? cachedSnapshot(scope) : EMPTY;
  if (stored.contextKey === contextKey) snapshot = stored.snapshot;
  const [revision, setRevision] = useState(0);
  const epochRef = useRef(0);
  const refreshRef = useRef(false);
  const latest = useRef({ session, onSessionChange });
  useLayoutEffect(() => { latest.current = { session, onSessionChange }; }, [session, onSessionChange]);

  useEffect(() => {
    const epoch = ++epochRef.current;
    const currentSession = latest.current.session;
    if (!contextKey || !currentSession || !organizationId) { setStored({ contextKey, snapshot: EMPTY }); return; }
    const selected = { session: currentSession, apiBaseUrl, organizationId };
    const force = refreshRef.current;
    refreshRef.current = false;
    setStored((current) => ({ contextKey, snapshot: current.contextKey === contextKey && current.snapshot.summary
      ? { ...current.snapshot, loading: true, error: false } : cachedSnapshot(selected) }));
    const handleSessionChange = (next: DesktopCloudSession | null) => {
      if (epoch === epochRef.current) latest.current.onSessionChange(next);
    };
    let failed = false;
    let catalogUnavailable = false;
    const fallback = <T,>(promise: Promise<T>, cached: T | null): Promise<T | null> => promise.catch(() => {
      failed = true; return cached;
    });
    void Promise.all([
      loadBillingCatalog(currentSession, handleSessionChange, apiBaseUrl, force).catch((error: unknown) => {
        const cause = error as Error & { status?: number; code?: string };
        catalogUnavailable = cause?.status === 404 && (cause.code === "hosting_billing_disabled"
          || /Hosting subscriptions are not available|Billing is not enabled/i.test(cause.message));
        if (!catalogUnavailable) failed = true;
        return catalogUnavailable ? null : readBillingResource({ ...selected, organizationId: null }, "catalog") ?? null;
      }),
      fallback(loadBillingSummary(currentSession, organizationId, handleSessionChange, apiBaseUrl, force),
        readBillingResource(selected, "summary") ?? null),
      fallback(loadBillingUsage(currentSession, organizationId, handleSessionChange, apiBaseUrl, force),
        readBillingResource(selected, "usage") ?? null),
      fallback(loadBillingResource(selected, "access", async (signal) => {
        const access = await getCloudOrganizationAccess(currentSession, organizationId, handleSessionChange, apiBaseUrl, signal);
        if (access.org_id !== organizationId) throw new Error("Billing access space mismatch.");
        return access;
      }, force), readBillingResource(selected, "access") ?? null),
    ]).then(([catalog, summary, usage, access]) => {
      if (epoch !== epochRef.current) return;
      setStored({ contextKey, snapshot: { catalog, summary, usage, organizationId,
        canManageBilling: access?.can_manage_billing ?? null, loading: false, error: failed || summary === null, catalogUnavailable } });
    });
    return () => { epochRef.current += 1; };
  }, [apiBaseUrl, contextKey, organizationId, revision]);

  useEffect(() => {
    if (!contextKey) return;
    const revalidate = () => { if (!document.hidden) setRevision((value) => value + 1); };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => { window.removeEventListener("focus", revalidate); document.removeEventListener("visibilitychange", revalidate); };
  }, [contextKey]);
  const refresh = useCallback((force = true) => { refreshRef.current = refreshRef.current || force; setRevision((value) => value + 1); }, []);
  return { ...snapshot, refresh };
}
