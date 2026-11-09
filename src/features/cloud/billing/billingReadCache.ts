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
export const BILLING_READ_TIMEOUT_MS = 15_000;

/** Bound the cached promise as well as the transport, so Retry cannot reuse a stalled read. */
export function withBillingReadDeadline<T>(loader: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException("Billing read timed out.", "TimeoutError");
      controller.abort(error);
      reject(error);
    }, BILLING_READ_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve().then(() => loader(controller.signal)), deadline])
    .finally(() => clearTimeout(timer));
}

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
  loader: (signal: AbortSignal) => Promise<BillingResources[K]>,
  refresh = false,
): Promise<BillingResources[K]> {
  return cloudCache.load(context(scope, resource), () => withBillingReadDeadline(loader), { ttlMs: BILLING_READ_TTL_MS, refresh });
}

export function loadBillingCatalog(
  session: DesktopCloudSession,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl: string | null = null,
  refresh = false,
) {
  return loadBillingResource({ session, apiBaseUrl }, "catalog",
    (signal) => getCloudBillingCatalog(session, onSessionChange, apiBaseUrl, signal), refresh);
}

export function loadBillingSummary(
  session: DesktopCloudSession,
  organizationId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl: string | null = null,
  refresh = false,
) {
  return loadBillingResource({ session, apiBaseUrl, organizationId }, "summary", async (signal) => {
    const summary = await getCloudBillingSummary(session, organizationId, onSessionChange, apiBaseUrl, signal);
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
  return loadBillingResource({ session, apiBaseUrl, organizationId }, "usage", async (signal) => {
    const usage = await getCloudBillingUsage(session, organizationId, onSessionChange, apiBaseUrl, signal);
    if (usage.runtime.org_id !== organizationId) throw new Error("Billing usage space mismatch.");
    return usage;
  }, refresh);
}
