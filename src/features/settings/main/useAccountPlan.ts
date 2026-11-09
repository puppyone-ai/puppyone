import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getCloudBillingCatalog,
  getCloudBillingSummary,
  getCloudBillingUsage,
  getCloudOrganizationAccess,
  listCloudOrganizations,
  type DesktopBillingCatalog,
  type DesktopBillingSummary,
  type DesktopBillingUsage,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";

/**
 * Account-level subscription state.
 *
 * Unlike `useCloudBillingController` (the organization console: quotes, seats,
 * checkout confirmation) this hook answers only "what plan is this account on,
 * and what is it using". It is safe to mount anywhere, including signed-out
 * and with no project open.
 *
 * `enabled` carries the payments experiment. With payments off this hook makes
 * no request at all, which keeps the `src/features/payments/README.md`
 * guarantee that a switched-off install never reads a wallet or a price.
 *
 * Every remote read degrades on its own: a billing outage must not blank the
 * pricing surface, it should fall back to published pricing.
 */

export type AccountPlanOrganization = {
  id: string;
  name: string;
  personal: boolean;
};

export type AccountPlanSnapshot = {
  catalog: DesktopBillingCatalog | null;
  summary: DesktopBillingSummary | null;
  usage: DesktopBillingUsage | null;
  organizationId: string | null;
  /** Every organization the account belongs to, personal space first. */
  organizations: AccountPlanOrganization[];
  /** Whether this person may change the selected space's plan; null while unknown. */
  canManageBilling: boolean | null;
  loading: boolean;
};

const EMPTY: AccountPlanSnapshot = {
  catalog: null,
  summary: null,
  usage: null,
  organizationId: null,
  organizations: [],
  canManageBilling: null,
  loading: false,
};

export function useAccountPlan({
  session,
  apiBaseUrl,
  onSessionChange,
  enabled,
}: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  /** The payments experiment. Off means no wallet or billing read happens. */
  enabled: boolean;
}): AccountPlanSnapshot & { refresh: () => void; selectOrganization: (id: string) => void } {
  const [snapshot, setSnapshot] = useState<AccountPlanSnapshot>(EMPTY);
  // Null follows the default: the personal space. Plans, hours and storage
  // belong to one organization, so a projects-holding team must be pickable.
  const [chosenOrganizationId, setChosenOrganizationId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const epochRef = useRef(0);
  const onSessionChangeRef = useRef(onSessionChange);
  useLayoutEffect(() => {
    onSessionChangeRef.current = onSessionChange;
  }, [onSessionChange]);

  // Session identity, not object identity: the session object is recreated on
  // every refresh and would otherwise restart the load loop forever.
  const sessionKey = session
    ? `${session.user_id}${session.session_generation}${session.api_base_url}`
    : "";

  useEffect(() => {
    const epoch = ++epochRef.current;
    if (!enabled || !session) {
      setSnapshot(EMPTY);
      return;
    }
    setSnapshot((current) => ({ ...current, loading: true }));

    const handleSessionChange = (next: DesktopCloudSession | null) => {
      onSessionChangeRef.current(next);
    };

    const load = async () => {
      const [catalog, organizations] = await Promise.all([
        getCloudBillingCatalog(session, handleSessionChange, apiBaseUrl).catch(() => null),
        listCloudOrganizations(session, handleSessionChange, apiBaseUrl).catch(() => []),
      ]);
      if (epoch !== epochRef.current) return;

      // Personal space first: it is the account's own plan, and the API's order
      // is not a promise. Teams follow in the order the API returns them.
      const ordered: AccountPlanOrganization[] = [...organizations]
        .sort((a, b) => Number(b.kind === "personal") - Number(a.kind === "personal"))
        .map((organization) => ({
          id: organization.id,
          name: organization.name,
          personal: organization.kind === "personal",
        }));
      const organizationId = ordered.find((organization) => organization.id === chosenOrganizationId)?.id
        ?? ordered[0]?.id
        ?? null;
      const [summary, usage, access] = organizationId
        ? await Promise.all([
          getCloudBillingSummary(session, organizationId, handleSessionChange, apiBaseUrl)
            .catch(() => null),
          getCloudBillingUsage(session, organizationId, handleSessionChange, apiBaseUrl)
            .catch(() => null),
          getCloudOrganizationAccess(session, organizationId, handleSessionChange, apiBaseUrl)
            .catch(() => null),
        ])
        : [null, null, null];
      if (epoch !== epochRef.current) return;

      // Never show one organization's money under another's name.
      setSnapshot({
        catalog,
        summary: summary && summary.org_id === organizationId ? summary : null,
        usage: usage && usage.runtime.org_id === organizationId ? usage : null,
        organizationId,
        organizations: ordered,
        canManageBilling: access && access.org_id === organizationId ? access.can_manage_billing : null,
        loading: false,
      });
    };
    void load();

    return () => {
      epochRef.current += 1;
    };
  }, [apiBaseUrl, chosenOrganizationId, enabled, revision, session, sessionKey]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const selectOrganization = useCallback((id: string) => setChosenOrganizationId(id), []);
  return { ...snapshot, refresh, selectOrganization };
}
