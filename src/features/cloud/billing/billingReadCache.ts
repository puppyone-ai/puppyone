import {
  getCloudBillingCatalog,
  getCloudBillingSummary,
  getCloudBillingUsage,
  type DesktopBillingCatalog,
  type DesktopBillingSummary,
  type DesktopBillingUsage,
  type DesktopCloudOrganization,
  type DesktopCloudOrganizationAccess,
  type DesktopCloudSession,
  type MutableSessionHandler,
} from "../../../lib/cloudApi";
import { cloudCache, type CloudCacheContext } from "../cache/cloudCache";

/** Memory only. Session changes and successful mutations invalidate this cache. */
export const BILLING_READ_TTL_MS = 30_000;

type BillingResources = {
  catalog: DesktopBillingCatalog;
  organizations: DesktopCloudOrganization[];
  summary: DesktopBillingSummary;
  usage: DesktopBillingUsage;
  access: DesktopCloudOrganizationAccess;
};

export type BillingReadScope = {
  session: DesktopCloudSession;
  apiBaseUrl: string | null;
  organizationId?: string | null;
};

function context(scope: BillingReadScope, resource: keyof BillingResources): CloudCacheContext {
  return {
    session: scope.session,
    projectId: `billing:${scope.organizationId ?? "account"}`,
    revision: (scope.apiBaseUrl ?? scope.session.api_base_url).replace(/\/+$/, ""),
    resource: `billing.${resource}`,
  };
}

/** An expired reading may paint while a fresh request runs; it never proves a charge. */
export function readBillingResource<K extends keyof BillingResources>(
  scope: BillingReadScope,
  resource: K,
): BillingResources[K] | undefined {
  cloudCache.activateSession(scope.session);
  return cloudCache.read<BillingResources[K]>(context(scope, resource), { allowStale: true });
}

export function loadBillingResource<K extends keyof BillingResources>(
  scope: BillingReadScope,
  resource: K,
  loader: () => Promise<BillingResources[K]>,
  refresh = false,
): Promise<BillingResources[K]> {
  return cloudCache.load(context(scope, resource), loader, { ttlMs: BILLING_READ_TTL_MS, refresh });
}

export function loadBillingCatalog(
  session: DesktopCloudSession,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl: string | null = null,
  refresh = false,
) {
  return loadBillingResource({ session, apiBaseUrl }, "catalog",
    () => getCloudBillingCatalog(session, onSessionChange, apiBaseUrl), refresh);
}

export function loadBillingSummary(
  session: DesktopCloudSession,
  organizationId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl: string | null = null,
  refresh = false,
) {
  return loadBillingResource({ session, apiBaseUrl, organizationId }, "summary", async () => {
    const summary = await getCloudBillingSummary(session, organizationId, onSessionChange, apiBaseUrl);
    if (summary.org_id !== organizationId) throw new Error("Billing summary space mismatch.");
    return summary;
  }, refresh);
}

export function loadBillingUsage(
  session: DesktopCloudSession,
  organizationId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl: string | null = null,
  refresh = false,
) {
  return loadBillingResource({ session, apiBaseUrl, organizationId }, "usage", async () => {
    const usage = await getCloudBillingUsage(session, organizationId, onSessionChange, apiBaseUrl);
    if (usage.runtime.org_id !== organizationId) throw new Error("Billing usage space mismatch.");
    return usage;
  }, refresh);
}
