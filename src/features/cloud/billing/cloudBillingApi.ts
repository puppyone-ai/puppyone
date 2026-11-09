import {
  applyCloudBillingPlanChange,
  applyCloudBillingSeatChange,
  createCloudBillingCheckout,
  createCloudBillingPortal,
  createDesktopBillingIdempotencyKey,
  getCloudBillingOperation,
  listCloudBillingOperations,
  openCloudBillingExternalUrl,
  quoteCloudBillingPlan,
  quoteCloudBillingSeats,
  type DesktopBillingCatalog,
  type DesktopBillingOperation,
  type DesktopBillingQuote,
  type DesktopBillingSummary,
  type DesktopBillingUsage,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import { loadBillingCatalog, loadBillingSummary, loadBillingUsage, withBillingReadDeadline } from "./billingReadCache";

export type SessionChangeHandler = (session: DesktopCloudSession | null) => void;

export type CloudBillingControllerDependencies = {
  getCatalog: (
    session: DesktopCloudSession,
    onSessionChange?: SessionChangeHandler,
    apiBaseUrl?: string | null,
  ) => Promise<DesktopBillingCatalog>;
  getSummary: (
    session: DesktopCloudSession,
    orgId: string,
    onSessionChange?: SessionChangeHandler,
    apiBaseUrl?: string | null,
  ) => Promise<DesktopBillingSummary>;
  getUsage: (
    session: DesktopCloudSession,
    orgId: string,
    onSessionChange?: SessionChangeHandler,
    apiBaseUrl?: string | null,
  ) => Promise<DesktopBillingUsage>;
  listOperations: (
    session: DesktopCloudSession,
    orgId: string,
    onSessionChange?: SessionChangeHandler,
    apiBaseUrl?: string | null,
  ) => Promise<DesktopBillingOperation[]>;
  getOperation: (
    session: DesktopCloudSession,
    orgId: string,
    operationId: string,
    onSessionChange?: SessionChangeHandler,
    apiBaseUrl?: string | null,
  ) => Promise<DesktopBillingOperation>;
  quotePlan: (
    session: DesktopCloudSession,
    orgId: string,
    targetPlanId: string,
    seatQuantity: number,
    idempotencyKey: string,
    onSessionChange?: SessionChangeHandler,
    apiBaseUrl?: string | null,
  ) => Promise<DesktopBillingQuote>;
  quoteSeats: (
    session: DesktopCloudSession,
    orgId: string,
    seatQuantity: number,
    idempotencyKey: string,
    operationId?: string | null,
    onSessionChange?: SessionChangeHandler,
    apiBaseUrl?: string | null,
  ) => Promise<DesktopBillingQuote>;
  createCheckout: typeof createCloudBillingCheckout;
  applyPlanChange: typeof applyCloudBillingPlanChange;
  applySeatChange: typeof applyCloudBillingSeatChange;
  createPortal: typeof createCloudBillingPortal;
  openExternalUrl: typeof openCloudBillingExternalUrl;
  createIdempotencyKey: typeof createDesktopBillingIdempotencyKey;
  now: () => number;
};

export const DEFAULT_CLOUD_BILLING_DEPENDENCIES: CloudBillingControllerDependencies = {
  // Controller refreshes follow billing actions and polling: always revalidate.
  getCatalog: (session, handler, api) => loadBillingCatalog(session, handler, api, true),
  getSummary: (session, org, handler, api) => loadBillingSummary(session, org, handler, api, true),
  getUsage: (session, org, handler, api) => loadBillingUsage(session, org, handler, api, true),
  listOperations: (session, org, handler, api) => withBillingReadDeadline((signal) => listCloudBillingOperations(session, org, handler, api, signal)),
  getOperation: (session, org, id, handler, api) => withBillingReadDeadline((signal) => getCloudBillingOperation(session, org, id, handler, api, signal)),
  quotePlan: quoteCloudBillingPlan,
  quoteSeats: quoteCloudBillingSeats,
  createCheckout: createCloudBillingCheckout,
  applyPlanChange: applyCloudBillingPlanChange,
  applySeatChange: applyCloudBillingSeatChange,
  createPortal: createCloudBillingPortal,
  openExternalUrl: openCloudBillingExternalUrl,
  createIdempotencyKey: createDesktopBillingIdempotencyKey,
  now: () => Date.now(),
};
