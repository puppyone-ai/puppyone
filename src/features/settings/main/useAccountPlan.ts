import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getCloudOrganizationAccess,
  listCloudOrganizations,
  type DesktopBillingCatalog,
  type DesktopBillingSummary,
  type DesktopBillingUsage,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import {
  loadBillingCatalog,
  loadBillingResource,
  loadBillingSummary,
  loadBillingUsage,
  readBillingResource,
  type BillingReadScope,
} from "../../cloud/billing/billingReadCache";
import { createCloudBillingContextKey } from "../../cloud/billing/cloudBillingState";

export type AccountPlanOrganization = { id: string; name: string; personal: boolean };

export type AccountPlanSnapshot = {
  catalog: DesktopBillingCatalog | null;
  summary: DesktopBillingSummary | null;
  usage: DesktopBillingUsage | null;
  organizationId: string | null;
  organizations: AccountPlanOrganization[];
  canManageBilling: boolean | null;
  /** Includes background revalidation; cached readings remain visible. */
  loading: boolean;
  error: boolean;
};

const EMPTY: AccountPlanSnapshot = {
  catalog: null, summary: null, usage: null, organizationId: null,
  organizations: [], canManageBilling: null, loading: false, error: false,
};

function cachedSnapshot(scope: BillingReadScope, chosenId: string | null): AccountPlanSnapshot {
  const organizations = (readBillingResource(scope, "organizations") ?? [])
    .slice().sort((a, b) => Number(b.kind === "personal") - Number(a.kind === "personal"))
    .map((organization) => ({ id: organization.id, name: organization.name, personal: organization.kind === "personal" }));
  const organizationId = organizations.find((organization) => organization.id === chosenId)?.id
    ?? organizations[0]?.id ?? null;
  const selected = { ...scope, organizationId };
  return {
    catalog: readBillingResource(scope, "catalog") ?? null,
    summary: organizationId ? readBillingResource(selected, "summary") ?? null : null,
    usage: organizationId ? readBillingResource(selected, "usage") ?? null : null,
    organizationId,
    organizations,
    canManageBilling: organizationId ? readBillingResource(selected, "access")?.can_manage_billing ?? null : null,
    loading: true,
    error: false,
  };
}

/**
 * Account and Plan share session-scoped, coalesced reads. Paint the last reading
 * synchronously on remount, then revalidate after its 30-second freshness window.
 * No signed-in reading means loading, never an inferred Free subscription.
 */
export function useAccountPlan({ session, apiBaseUrl, onSessionChange, enabled }: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  enabled: boolean;
}): AccountPlanSnapshot & { refresh: (force?: boolean) => void; selectOrganization: (id: string) => void } {
  const accountKey = enabled && session ? createCloudBillingContextKey(session, apiBaseUrl, null) : "";
  const [selection, setSelection] = useState<{ accountKey: string; id: string } | null>(null);
  const chosenId = selection?.accountKey === accountKey ? selection.id : null;
  const contextKey = `${accountKey}\u001f${chosenId ?? ""}`;
  const scope = session && enabled ? { session, apiBaseUrl } : null;
  const [stored, setStored] = useState(() => ({
    contextKey,
    snapshot: scope ? cachedSnapshot(scope, chosenId) : EMPTY,
  }));
  // Context changes must hide the old account/space before effects run.
  const initialSnapshot = scope ? cachedSnapshot(scope, chosenId) : EMPTY;
  const snapshot = stored.contextKey === contextKey ? stored.snapshot : initialSnapshot;
  const [revision, setRevision] = useState(0);
  const epochRef = useRef(0);
  const refreshRef = useRef(false);
  const latest = useRef({ session, onSessionChange });
  useLayoutEffect(() => { latest.current = { session, onSessionChange }; }, [session, onSessionChange]);

  useEffect(() => {
    const epoch = ++epochRef.current;
    const currentSession = latest.current.session;
    if (!enabled || !currentSession) {
      setStored({ contextKey, snapshot: EMPTY });
      return;
    }
    const readScope = { session: currentSession, apiBaseUrl };
    const refresh = refreshRef.current;
    refreshRef.current = false;
    setStored((current) => ({ contextKey, snapshot: current.contextKey === contextKey && current.snapshot.summary
      ? { ...current.snapshot, loading: true, error: false } : cachedSnapshot(readScope, chosenId) }));
    const handleSessionChange = (next: DesktopCloudSession | null) => {
      if (epoch === epochRef.current) latest.current.onSessionChange(next);
    };

    const load = async () => {
      let failed = false;
      const fallback = <T,>(promise: Promise<T>, cached: T | null): Promise<T | null> => promise.catch(() => {
        failed = true;
        return cached;
      });
      const [catalog, organizations] = await Promise.all([
        fallback(loadBillingCatalog(currentSession, handleSessionChange, apiBaseUrl, refresh), readBillingResource(readScope, "catalog") ?? null),
        fallback(loadBillingResource(readScope, "organizations",
          () => listCloudOrganizations(currentSession, handleSessionChange, apiBaseUrl), refresh), readBillingResource(readScope, "organizations") ?? null),
      ]);
      if (epoch !== epochRef.current) return;
      const ordered = (organizations ?? []).slice()
        .sort((a, b) => Number(b.kind === "personal") - Number(a.kind === "personal"))
        .map((organization) => ({ id: organization.id, name: organization.name, personal: organization.kind === "personal" }));
      const organizationId = ordered.find((organization) => organization.id === chosenId)?.id ?? ordered[0]?.id ?? null;
      const selected = { ...readScope, organizationId };
      const [summary, usage, access] = organizationId ? await Promise.all([
        fallback(loadBillingSummary(currentSession, organizationId, handleSessionChange, apiBaseUrl, refresh), readBillingResource(selected, "summary") ?? null),
        fallback(loadBillingUsage(currentSession, organizationId, handleSessionChange, apiBaseUrl, refresh), readBillingResource(selected, "usage") ?? null),
        fallback(loadBillingResource(selected, "access", async () => {
          const result = await getCloudOrganizationAccess(currentSession, organizationId, handleSessionChange, apiBaseUrl);
          if (result.org_id !== organizationId) throw new Error("Billing access space mismatch.");
          return result;
        }, refresh), readBillingResource(selected, "access") ?? null),
      ]) : [null, null, null];
      if (epoch !== epochRef.current) return;
      setStored((current) => {
        const previous = current.contextKey === contextKey ? current.snapshot : EMPTY;
        const sameSpace = previous.organizationId === organizationId || (organizations === null && organizationId === null);
        return { contextKey, snapshot: {
          catalog: catalog ?? (failed ? previous.catalog : null),
          summary: summary ?? (failed && sameSpace ? previous.summary : null),
          usage: usage ?? (failed && sameSpace ? previous.usage : null),
          organizationId: organizationId ?? (organizations === null ? previous.organizationId : null),
          organizations: organizations === null ? previous.organizations : ordered,
          canManageBilling: access?.can_manage_billing ?? (failed && sameSpace ? previous.canManageBilling : null),
          loading: false, error: failed || summary === null,
        } };
      });
    };
    void load();
    return () => { epochRef.current += 1; };
  }, [apiBaseUrl, chosenId, contextKey, enabled, revision]);

  useEffect(() => {
    if (!accountKey) return;
    const revalidate = () => { if (!document.hidden) setRevision((value) => value + 1); };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [accountKey]);

  const refresh = useCallback((force = true) => {
    refreshRef.current = force;
    setRevision((value) => value + 1);
  }, []);
  const selectOrganization = useCallback((id: string) => setSelection({ accountKey, id }), [accountKey]);
  return { ...snapshot, refresh, selectOrganization };
}
