import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getCloudBillingCatalog, getCloudBillingSummary, getCloudBillingUsage, getCloudOrganizationAccess,
  type DesktopBillingCatalog, type DesktopBillingSummary, type DesktopBillingUsage, type DesktopCloudSession,
} from "../../../lib/cloudApi";

/** Read-only billing projection for the window's explicit Space. Wallet state is separate. */
export type AccountPlanSnapshot = {
  catalog: DesktopBillingCatalog | null;
  summary: DesktopBillingSummary | null;
  usage: DesktopBillingUsage | null;
  organizationId: string | null;
  canManageBilling: boolean | null;
  loading: boolean;
};
const EMPTY: AccountPlanSnapshot = {
  catalog: null, summary: null, usage: null, organizationId: null, canManageBilling: null, loading: false,
};

export function useAccountPlan({ session, apiBaseUrl, onSessionChange, enabled, organizationId = null }: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  enabled: boolean;
  organizationId?: string | null;
}): AccountPlanSnapshot & { refresh: () => void } {
  const [snapshot, setSnapshot] = useState<AccountPlanSnapshot>(EMPTY);
  const [revision, setRevision] = useState(0);
  const epochRef = useRef(0);
  const loadedForRef = useRef("");
  const sessionRef = useRef(session);
  const onSessionChangeRef = useRef(onSessionChange);
  useLayoutEffect(() => {
    sessionRef.current = session;
    onSessionChangeRef.current = onSessionChange;
  }, [session, onSessionChange]);
  const sessionKey = session ? `${session.user_id}|${session.session_generation}|${session.api_base_url}` : "";
  const scope = `${sessionKey}|${apiBaseUrl}|${organizationId}`;

  useEffect(() => {
    const epoch = ++epochRef.current;
    const currentSession = sessionRef.current;
    if (!enabled || !currentSession || !organizationId) { setSnapshot(EMPTY); return; }
    setSnapshot((current) => ({ ...current, loading: true }));
    const handleSessionChange = (next: DesktopCloudSession | null) => onSessionChangeRef.current(next);
    void Promise.all([
      getCloudBillingCatalog(currentSession, handleSessionChange, apiBaseUrl).catch(() => null),
      getCloudBillingSummary(currentSession, organizationId, handleSessionChange, apiBaseUrl).catch(() => null),
      getCloudBillingUsage(currentSession, organizationId, handleSessionChange, apiBaseUrl).catch(() => null),
      getCloudOrganizationAccess(currentSession, organizationId, handleSessionChange, apiBaseUrl).catch(() => null),
    ]).then(([catalog, summary, usage, access]) => {
      if (epoch !== epochRef.current) return;
      loadedForRef.current = scope;
      setSnapshot({ catalog, organizationId,
        summary: summary?.org_id === organizationId ? summary : null,
        usage: usage?.runtime.org_id === organizationId ? usage : null,
        canManageBilling: access?.org_id === organizationId ? access.can_manage_billing : null,
        loading: false,
      });
    });
    return () => { epochRef.current += 1; };
  }, [apiBaseUrl, enabled, organizationId, revision, scope]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const matches = enabled && Boolean(session) && loadedForRef.current === scope;
  return { ...(matches ? snapshot : { ...EMPTY, organizationId,
    loading: enabled && Boolean(session) && Boolean(organizationId) }), refresh };
}
