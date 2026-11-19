import type { MessageFormatter } from "@puppyone/localization/core";
import type {
  DesktopBillingCatalog,
  DesktopBillingOperation,
  DesktopBillingPlan,
  DesktopBillingQuote,
  DesktopBillingSummary,
  DesktopBillingUsage,
  DesktopCloudSession,
} from "../../../lib/cloudApi";

export const BILLING_POLL_BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;

export type BillingActionKind = "quote" | "confirm" | "portal";

export type BillingPollingState = {
  id: string;
  operationId: string;
};

export type CloudBillingControllerState = {
  contextKey: string;
  catalog: DesktopBillingCatalog | null;
  summary: DesktopBillingSummary | null;
  usage: DesktopBillingUsage | null;
  operations: DesktopBillingOperation[];
  loading: boolean;
  error: string | null;
  seatQuantity: number;
  seatQuantityTouched: boolean;
  quote: DesktopBillingQuote | null;
  quotedOperationId: string | null;
  requestedPlanId: string | null;
  action: BillingActionKind | null;
  actionError: string | null;
  polling: BillingPollingState | null;
};

export type BillingLoadResult = {
  catalog: DesktopBillingCatalog;
  summary: DesktopBillingSummary;
  usage: DesktopBillingUsage;
  operations: DesktopBillingOperation[];
};

export type BillingReducerAction =
  | { type: "contextChanged"; contextKey: string }
  | { type: "loadStarted"; contextKey: string }
  | { type: "loadSucceeded"; contextKey: string; result: BillingLoadResult }
  | { type: "loadFailed"; contextKey: string; error: string }
  | { type: "operationsLoaded"; contextKey: string; operations: DesktopBillingOperation[] }
  | { type: "setSeatQuantity"; contextKey: string; value: number }
  | { type: "clearActionError"; contextKey: string }
  | {
    type: "quoteStarted";
    contextKey: string;
    requestedPlanId: string;
    quotedOperationId: string | null;
    seatQuantity: number;
  }
  | { type: "quoteSucceeded"; contextKey: string; quote: DesktopBillingQuote }
  | { type: "actionStarted"; contextKey: string; action: Exclude<BillingActionKind, "quote"> }
  | { type: "actionFailed"; contextKey: string; error: string }
  | { type: "actionFinished"; contextKey: string }
  | { type: "mutationSucceeded"; contextKey: string; polling: BillingPollingState | null }
  | { type: "operationWatchStarted"; contextKey: string; polling: BillingPollingState }
  | { type: "operationUpdated"; contextKey: string; operation: DesktopBillingOperation }
  | { type: "operationWatchFailed"; contextKey: string; error: string };

export function createCloudBillingContextKey(
  session: DesktopCloudSession,
  apiBaseUrl: string | null,
  organizationId: string | null,
): string {
  return [
    session.user_id,
    session.session_generation,
    normalizeApiIdentity(apiBaseUrl ?? session.api_base_url),
    organizationId ?? "",
  ].join("\u001f");
}

export function createInitialBillingState(contextKey: string): CloudBillingControllerState {
  return {
    contextKey,
    catalog: null,
    summary: null,
    usage: null,
    operations: [],
    loading: false,
    error: null,
    seatQuantity: 1,
    seatQuantityTouched: false,
    quote: null,
    quotedOperationId: null,
    requestedPlanId: null,
    action: null,
    actionError: null,
    polling: null,
  };
}

export function billingReducer(
  state: CloudBillingControllerState,
  action: BillingReducerAction,
): CloudBillingControllerState {
  if (action.type === "contextChanged") return createInitialBillingState(action.contextKey);
  if (action.contextKey !== state.contextKey) return state;
  switch (action.type) {
    case "loadStarted":
      return { ...state, loading: true, error: null };
    case "loadSucceeded": {
      const operations = action.result.operations.map((incoming) => {
        const observed = state.operations.find((candidate) => candidate.id === incoming.id);
        return observed?.terminal && !incoming.terminal ? observed : incoming;
      });
      const nextState = {
        ...state,
        ...action.result,
        operations,
        loading: false,
        error: null,
        seatQuantity: state.seatQuantityTouched
          ? state.seatQuantity
          : Math.max(1, action.result.summary.seat_quantity),
      };
      return state.polling && billingPollIsTerminal(
        { ...action.result, operations },
        state.polling,
      )
        ? { ...nextState, polling: null }
        : nextState;
    }
    case "loadFailed":
      return { ...state, loading: false, error: action.error };
    case "operationsLoaded":
      return { ...state, loading: false, error: null, operations: action.operations.map((incoming) => {
        const observed = state.operations.find((candidate) => candidate.id === incoming.id);
        return observed?.terminal && !incoming.terminal ? observed : incoming;
      }) };
    case "setSeatQuantity":
      return {
        ...state,
        seatQuantity: Math.max(1, Math.trunc(action.value) || 1),
        seatQuantityTouched: true,
      };
    case "clearActionError":
      return { ...state, actionError: null };
    case "quoteStarted":
      return {
        ...state,
        seatQuantity: action.seatQuantity,
        seatQuantityTouched: true,
        requestedPlanId: action.requestedPlanId,
        quotedOperationId: action.quotedOperationId,
        quote: null,
        action: "quote",
        actionError: null,
      };
    case "quoteSucceeded":
      return { ...state, quote: action.quote };
    case "actionStarted":
      return { ...state, action: action.action, actionError: null };
    case "actionFailed":
      return { ...state, actionError: action.error };
    case "actionFinished":
      return { ...state, action: null };
    case "mutationSucceeded":
      return {
        ...state,
        quote: null,
        quotedOperationId: null,
        requestedPlanId: null,
        polling: action.polling,
      };
    case "operationWatchStarted":
      return { ...state, polling: action.polling, actionError: null };
    case "operationUpdated": {
      const observed = state.operations.find(
        (candidate) => candidate.id === action.operation.id,
      );
      if (observed?.terminal && !action.operation.terminal) {
        return { ...state, polling: null };
      }
      const operations = [
        action.operation,
        ...state.operations.filter((candidate) => candidate.id !== action.operation.id),
      ];
      return {
        ...state,
        operations,
        polling: action.operation.terminal ? null : state.polling,
      };
    }
    case "operationWatchFailed":
      return { ...state, polling: null, actionError: action.error };
  }
}

export function pendingBillingOperations(
  operations: DesktopBillingOperation[],
): DesktopBillingOperation[] {
  return operations.filter((operation) => !operation.terminal);
}

export function actionableSeatOperation(
  operations: DesktopBillingOperation[],
): DesktopBillingOperation | null {
  return operations.find((operation) => (
    ["member_activation", "member_deactivation"].includes(operation.kind)
    && operation.action_required
    && Number.isSafeInteger(operation.target_seat_quantity)
    && (operation.target_seat_quantity ?? 0) > 0
  )) ?? null;
}

export function resumableBillingOperation(
  operations: DesktopBillingOperation[],
): DesktopBillingOperation | null {
  return operations.find((operation) => (
    ["checkout", "plan_change", "seat_increase", "seat_decrease"].includes(operation.kind)
    && ["pending", "processing", "retryable_failed"].includes(operation.state)
    && !operation.terminal
  )) ?? null;
}

export function assertQuoteOrganization(
  quote: DesktopBillingQuote,
  organizationId: string,
  t: MessageFormatter,
): void {
  if (quote.org_id !== organizationId) {
    throw new Error(t("cloud.billing.organizationMismatch"));
  }
}

export function assertQuoteNotExpired(
  quote: DesktopBillingQuote,
  now: number,
  t: MessageFormatter,
): void {
  const expiresAt = Date.parse(quote.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error(t("cloud.billing.quoteExpired"));
  }
}

export function assertReturnedQuoteMatches(
  returnedQuote: DesktopBillingQuote,
  requestedQuote: DesktopBillingQuote,
  organizationId: string,
  t: MessageFormatter,
): void {
  if (returnedQuote.org_id !== organizationId
    || returnedQuote.quote_id !== requestedQuote.quote_id
    || returnedQuote.target_plan_id !== requestedQuote.target_plan_id
    || returnedQuote.target_seats !== requestedQuote.target_seats
    || returnedQuote.application_mode !== requestedQuote.application_mode) {
    throw new Error(t("cloud.billing.organizationMismatch"));
  }
}

export function assertOperationMatchesQuote(
  operation: DesktopBillingOperation,
  quote: DesktopBillingQuote,
  organizationId: string,
  t: MessageFormatter,
  expectedOperationId: string | null = null,
): void {
  if (operation.org_id !== organizationId
    || (expectedOperationId !== null && operation.id !== expectedOperationId)
    || operation.quote_id !== quote.quote_id
    || operation.target_plan_id !== quote.target_plan_id
    || operation.target_seat_quantity !== quote.target_seats) {
    throw new Error(t("cloud.billing.organizationMismatch"));
  }
}

export function clampBillingSeats(value: number, plan: DesktopBillingPlan): number {
  const minimum = Math.max(1, plan.seats.minimum);
  const maximum = plan.seats.maximum ?? Number.MAX_SAFE_INTEGER;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value) || minimum));
}

function billingPollIsTerminal(
  result: BillingLoadResult,
  polling: BillingPollingState,
): boolean {
  return result.operations.find((candidate) => candidate.id === polling.operationId)?.terminal
    ?? false;
}

function normalizeApiIdentity(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return trimmed;
  }
}
