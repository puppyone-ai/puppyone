/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopBillingCatalog,
  DesktopBillingOperation,
  DesktopBillingPlan,
  DesktopBillingQuote,
  DesktopBillingSummary,
  DesktopBillingUsage,
  DesktopCloudSession,
} from "../../../../src/lib/cloudApi";
import {
  BILLING_POLL_BACKOFF_MS,
  type CloudBillingControllerDependencies,
  useCloudBillingController,
} from "../../../../src/features/cloud/billing/useCloudBillingController";
import {
  billingReducer,
  createInitialBillingState,
} from "../../../../src/features/cloud/billing/cloudBillingState";
import { testT } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  user_id: "user-a",
  user_email: "a@example.com",
  api_base_url: "https://cloud.example/api/v1",
  session_generation: "generation-a",
  expires_in: 3600,
  expires_at: 0,
  status: "authenticated",
} satisfies DesktopCloudSession;

const plan: DesktopBillingPlan = {
  id: "plus",
  aliases: [],
  name: "Plus",
  description: "Plus plan",
  public: true,
  purchasable: true,
  highlighted: true,
  currency: "USD",
  interval: "month",
  price_per_seat_cents: 1800,
  seats: { minimum: 1, maximum: 14 },
  features: {},
  fixed_limits: {},
  per_seat_limits: {},
  allow: {},
  runtime: { fixed_units: 0, units_per_seat: 100 },
};

const catalog: DesktopBillingCatalog = {
  schema_version: "1.0",
  catalog_version: "2026-07-15.1",
  effective_at: "2026-07-15T00:00:00Z",
  currency: "USD",
  plans: [plan],
  runtime: {
    top_ups_enabled: false,
    overage_enabled: false,
    unit_seconds: 60,
    minimum_units: 1,
    overage_price_cents_per_unit: 0,
    profiles: [],
    top_up_packs: [],
  },
};

const billingTestNow = Date.parse("2026-07-15T12:00:00Z");

function summary(orgId: string, revision = 1): DesktopBillingSummary {
  return {
    org_id: orgId,
    plan_id: "plus",
    status: "active",
    seat_quantity: 2,
    pending_plan_id: null,
    cancel_at_period_end: false,
    current_period_end: null,
    catalog_version: catalog.catalog_version,
    source_revision: revision,
    portal_available: true,
    seat_changes_available: true,
    runtime_available_units: 100,
    runtime_reserved_units: 0,
    runtime_overage_enabled: false,
    runtime_monthly_limit_cents: 0,
  };
}

function usage(orgId: string): DesktopBillingUsage {
  return {
    runtime: {
      org_id: orgId,
      available_units: 100,
      reserved_units: 0,
      granted_units: 100,
      consumed_units: 0,
      postpaid_available_units: 0,
      postpaid_consumed_units: 0,
      buckets: [],
    },
    storage: {
      logical_bytes: 0,
      limit_bytes: 1000,
      percent: 0,
      threshold_percent: 0,
      version: 1,
    },
  };
}

function quote(orgId: string): DesktopBillingQuote {
  return {
    quote_id: `quote-${orgId}`,
    org_id: orgId,
    kind: "plan",
    current_plan_id: "free",
    target_plan_id: "plus",
    current_seats: 1,
    target_seats: 2,
    currency: "USD",
    current_amount_cents: 0,
    target_amount_cents: 3600,
    delta_amount_cents: 3600,
    application_mode: "checkout",
    requires_confirmation: true,
    catalog_version: catalog.catalog_version,
    expires_at: "2026-07-16T00:00:00Z",
    details: {},
  };
}

function operation(
  orgId: string,
  state: DesktopBillingOperation["state"] = "processing",
): DesktopBillingOperation {
  const lifecycle = {
    pending: { terminal: false, retryable: true, action_required: false },
    requires_action: { terminal: false, retryable: false, action_required: true },
    processing: { terminal: false, retryable: true, action_required: false },
    retryable_failed: { terminal: false, retryable: true, action_required: false },
    succeeded: { terminal: true, retryable: false, action_required: false },
    canceled: { terminal: true, retryable: false, action_required: false },
    failed: { terminal: true, retryable: false, action_required: false },
  } as const;
  return {
    id: `operation-${orgId}`,
    org_id: orgId,
    kind: "checkout",
    state,
    ...lifecycle[state],
    target_plan_id: "plus",
    current_seat_quantity: 1,
    target_seat_quantity: 2,
    quote_id: `quote-${orgId}`,
    confirmed_revision: state === "succeeded" ? 2 : null,
    error_code: state === "failed" ? "provider_declined" : null,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
    completed_at: state === "succeeded" ? "2026-07-15T00:01:00Z" : null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function dependencies(): CloudBillingControllerDependencies {
  return {
    getCatalog: vi.fn().mockResolvedValue(catalog),
    getSummary: vi.fn().mockImplementation(async (_session, orgId: string) => summary(orgId)),
    getUsage: vi.fn().mockImplementation(async (_session, orgId: string) => usage(orgId)),
    listOperations: vi.fn().mockResolvedValue([]),
    getOperation: vi.fn().mockImplementation(async (_session, orgId: string) => operation(orgId)),
    quotePlan: vi.fn().mockImplementation(async (_session, orgId: string) => quote(orgId)),
    quoteSeats: vi.fn().mockImplementation(async (_session, orgId: string) => quote(orgId)),
    createCheckout: vi.fn().mockImplementation(async (_session, orgId: string) => ({
      checkout_id: `checkout-${orgId}`,
      checkout_url: "https://checkout.example/session",
      quote: quote(orgId),
      operation: operation(orgId),
    })),
    applyPlanChange: vi.fn().mockImplementation(async (_session, orgId: string) => ({
      ...quote(orgId),
      operation: { ...operation(orgId), kind: "plan_change" },
    })),
    applySeatChange: vi.fn().mockImplementation(async (_session, orgId: string) => ({
      ...quote(orgId),
      operation: { ...operation(orgId), kind: "seat_increase" },
    })),
    createPortal: vi.fn().mockResolvedValue({ portal_url: "https://portal.example", expires_at: null }),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    createIdempotencyKey: vi.fn()
      .mockImplementation((scope: string) => `desktop:${scope}:${crypto.randomUUID()}`),
    now: () => billingTestNow,
  };
}

function Probe({
  activeSession = session,
  apiBaseUrl,
  organizationId = "org-a",
  enabled = true,
  deps,
}: {
  activeSession?: DesktopCloudSession;
  apiBaseUrl?: string | null;
  organizationId?: string | null;
  enabled?: boolean;
  deps: CloudBillingControllerDependencies;
}) {
  const billing = useCloudBillingController({
    session: activeSession,
    apiBaseUrl: apiBaseUrl === undefined ? activeSession.api_base_url : apiBaseUrl,
    organizationId,
    enabled,
    onSessionChange: React.useCallback(() => undefined, []),
    t: testT,
  }, deps);
  return (
    <div
      data-context={billing.state.contextKey}
      data-org={billing.state.summary?.org_id ?? ""}
      data-revision={billing.state.summary?.source_revision ?? ""}
      data-quote={billing.state.quote?.quote_id ?? ""}
      data-loading={billing.state.loading ? "true" : "false"}
      data-polling={billing.state.polling ? "true" : "false"}
      data-error={billing.state.actionError ?? billing.state.error ?? ""}
    >
      <button type="button" data-action="refresh" onClick={() => void billing.refresh()}>refresh</button>
      <button type="button" data-action="quote" onClick={() => void billing.quotePlan(plan)}>quote</button>
      <button
        type="button"
        data-action="quote-seats"
        onClick={() => void billing.quoteSeats(billing.actionableSeatOperation)}
      >quote seats</button>
      <button type="button" data-action="confirm" onClick={() => void billing.confirmQuote()}>confirm</button>
    </div>
  );
}

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useCloudBillingController", () => {
  it("never lets a delayed operation response regress an observed terminal state", () => {
    const contextKey = "billing-context";
    const succeeded = operation("org-a", "succeeded");
    const loaded = billingReducer(createInitialBillingState(contextKey), {
      type: "loadSucceeded",
      contextKey,
      result: {
        catalog,
        summary: summary("org-a", 2),
        usage: usage("org-a"),
        operations: [succeeded],
      },
    });
    const watching = {
      ...loaded,
      polling: { id: "watch", operationId: succeeded.id },
    };

    const next = billingReducer(watching, {
      type: "operationUpdated",
      contextKey,
      operation: operation("org-a", "processing"),
    });

    expect(next.operations).toEqual([succeeded]);
    expect(next.polling).toBeNull();
  });

  it("discards an old account response and resets quote/idempotency state on context change", async () => {
    const deps = dependencies();
    const oldSummary = deferred<DesktopBillingSummary>();
    vi.mocked(deps.getSummary)
      .mockReturnValueOnce(oldSummary.promise)
      .mockImplementation(async (_activeSession, orgId: string) => summary(orgId));

    await act(async () => root?.render(<Probe deps={deps} />));
    const nextSession = {
      ...session,
      user_id: "user-b",
      user_email: "b@example.com",
      session_generation: "generation-b",
    };
    await act(async () => root?.render(
      <Probe activeSession={nextSession} organizationId="org-b" deps={deps} />,
    ));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-b"));

    await act(async () => oldSummary.resolve(summary("org-a")));
    expect(container.firstElementChild?.getAttribute("data-org")).toBe("org-b");

    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-quote"))
      .toBe("quote-org-b"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-polling"))
      .toBe("true"));

    await act(async () => root?.render(<Probe organizationId="org-c" deps={deps} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-c"));
    expect(container.firstElementChild?.getAttribute("data-quote")).toBe("");
    expect(container.firstElementChild?.getAttribute("data-polling")).toBe("false");
  });

  it("treats the API host as a request epoch boundary", async () => {
    const deps = dependencies();
    const oldSummary = deferred<DesktopBillingSummary>();
    vi.mocked(deps.getSummary)
      .mockReturnValueOnce(oldSummary.promise)
      .mockResolvedValue(summary("org-a", 2));

    await act(async () => root?.render(
      <Probe apiBaseUrl="https://old-cloud.example/api/v1" deps={deps} />,
    ));
    await act(async () => root?.render(
      <Probe apiBaseUrl="https://new-cloud.example/api/v1" deps={deps} />,
    ));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-revision"))
      .toBe("2"));

    await act(async () => oldSummary.resolve(summary("org-a", 99)));
    expect(container.firstElementChild?.getAttribute("data-revision")).toBe("2");
    expect(container.firstElementChild?.getAttribute("data-context"))
      .toContain("https://new-cloud.example/api/v1");
  });

  it("rejects an old action even if the same context is disabled and re-enabled", async () => {
    const deps = dependencies();
    const oldQuote = deferred<DesktopBillingQuote>();
    vi.mocked(deps.quotePlan).mockReturnValueOnce(oldQuote.promise);

    await act(async () => root?.render(<Probe deps={deps} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await act(async () => root?.render(<Probe enabled={false} deps={deps} />));
    await act(async () => root?.render(<Probe deps={deps} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));

    await act(async () => oldQuote.resolve(quote("org-a")));
    expect(container.firstElementChild?.getAttribute("data-quote")).toBe("");
  });

  it("keeps operation polling single-flight while a request is unresolved", async () => {
    vi.useFakeTimers();
    const deps = dependencies();
    const slowOperation = deferred<DesktopBillingOperation>();

    await act(async () => root?.render(<Probe deps={deps} />));
    await act(async () => vi.runOnlyPendingTimersAsync());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await act(async () => vi.runOnlyPendingTimersAsync());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-quote"))
      .toBe("quote-org-a"));

    vi.mocked(deps.getOperation).mockReturnValueOnce(slowOperation.promise);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());
    await act(async () => Promise.resolve());
    expect(container.firstElementChild?.getAttribute("data-polling")).toBe("true");

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(deps.getOperation).toHaveBeenCalledTimes(1);

    await act(async () => slowOperation.resolve(operation("org-a")));
    await act(async () => vi.advanceTimersByTimeAsync(BILLING_POLL_BACKOFF_MS[1]));
    expect(deps.getOperation).toHaveBeenCalledTimes(2);
  });

  it("stops polling only after the durable operation succeeds", async () => {
    vi.useFakeTimers();
    const deps = dependencies();
    vi.mocked(deps.getOperation).mockResolvedValue(operation("org-a", "succeeded"));

    await act(async () => root?.render(<Probe deps={deps} />));
    await act(async () => vi.runOnlyPendingTimersAsync());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await act(async () => vi.runOnlyPendingTimersAsync());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());
    await act(async () => vi.advanceTimersByTimeAsync(BILLING_POLL_BACKOFF_MS[0]));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-polling"))
      .toBe("false"));

    const completedCalls = vi.mocked(deps.getOperation).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(deps.getOperation).toHaveBeenCalledTimes(completedCalls);
  });

  it("refreshes a watched operation immediately when the window regains focus", async () => {
    vi.useFakeTimers();
    const deps = dependencies();

    await act(async () => root?.render(<Probe deps={deps} />));
    await act(async () => vi.runOnlyPendingTimersAsync());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await act(async () => vi.runOnlyPendingTimersAsync());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());
    await act(async () => Promise.resolve());
    expect(deps.getOperation).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(deps.getOperation).toHaveBeenCalledTimes(1);
  });

  it("keeps the mutation idempotency key stable for retry but rotates it with context", async () => {
    const deps = dependencies();
    vi.mocked(deps.quotePlan)
      .mockRejectedValueOnce(new Error("retry"))
      .mockImplementation(async (_activeSession, orgId: string) => quote(orgId));

    await act(async () => root?.render(<Probe deps={deps} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-error"))
      .toContain("retry"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-quote"))
      .toBe("quote-org-a"));

    const firstKey = vi.mocked(deps.quotePlan).mock.calls[0]?.[4];
    const retryKey = vi.mocked(deps.quotePlan).mock.calls[1]?.[4];
    expect(retryKey).toBe(firstKey);

    await act(async () => root?.render(<Probe organizationId="org-b" deps={deps} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-b"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-quote"))
      .toBe("quote-org-b"));
    const nextContextKey = vi.mocked(deps.quotePlan).mock.calls[2]?.[4];
    expect(nextContextKey).not.toBe(firstKey);
  });

  it("keeps an apply idempotency key stable when confirmation is retried", async () => {
    const deps = dependencies();
    const planChangeQuote = { ...quote("org-a"), application_mode: "plan_change" as const };
    vi.mocked(deps.quotePlan).mockResolvedValue(planChangeQuote);
    vi.mocked(deps.applyPlanChange)
      .mockRejectedValueOnce(new Error("provider timeout"))
      .mockResolvedValue({
        ...planChangeQuote,
        operation: { ...operation("org-a"), kind: "plan_change" },
      });

    await act(async () => root?.render(<Probe deps={deps} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-quote"))
      .toBe("quote-org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-error"))
      .toContain("provider timeout"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());
    await vi.waitFor(() => expect(deps.applyPlanChange).toHaveBeenCalledTimes(2));

    expect(vi.mocked(deps.applyPlanChange).mock.calls[1]?.[3])
      .toBe(vi.mocked(deps.applyPlanChange).mock.calls[0]?.[3]);
  });

  it("reuses a membership operation when its seat quote requires checkout", async () => {
    const deps = dependencies();
    const membershipOperation: DesktopBillingOperation = {
      ...operation("org-a", "requires_action"),
      kind: "member_activation",
      target_plan_id: null,
      quote_id: null,
    };
    vi.mocked(deps.listOperations).mockResolvedValue([membershipOperation]);
    vi.mocked(deps.quoteSeats).mockResolvedValue({
      ...quote("org-a"),
      kind: "seats",
    });

    await act(async () => root?.render(<Probe deps={deps} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container
      .querySelector<HTMLButtonElement>('[data-action="quote-seats"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-quote"))
      .toBe("quote-org-a"));
    await act(async () => container
      .querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());

    expect(deps.createCheckout).toHaveBeenCalledWith(
      session,
      "org-a",
      {
        planId: "plus",
        seatQuantity: 2,
        quoteId: "quote-org-a",
        operationId: "operation-org-a",
      },
      expect.any(String),
      expect.any(Function),
      session.api_base_url,
    );
  });

  it("ignores a completed checkout after its account context was replaced", async () => {
    const deps = dependencies();
    const checkout = deferred<Awaited<ReturnType<typeof deps.createCheckout>>>();
    vi.mocked(deps.createCheckout).mockReturnValueOnce(checkout.promise);

    await act(async () => root?.render(<Probe deps={deps} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-quote"))
      .toBe("quote-org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());

    const nextSession = {
      ...session,
      user_id: "user-b",
      user_email: "b@example.com",
      session_generation: "generation-b",
    };
    await act(async () => root?.render(
      <Probe activeSession={nextSession} organizationId="org-b" deps={deps} />,
    ));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-b"));
    await act(async () => checkout.resolve({
      checkout_id: "checkout-org-a",
      checkout_url: "https://checkout.example/session",
      quote: quote("org-a"),
      operation: operation("org-a"),
    }));

    expect(container.firstElementChild?.getAttribute("data-org")).toBe("org-b");
    expect(container.firstElementChild?.getAttribute("data-polling")).toBe("false");
    expect(container.firstElementChild?.getAttribute("data-quote")).toBe("");
    expect(deps.openExternalUrl).not.toHaveBeenCalled();
  });

  it("does not turn a slow browser checkout into a one-minute failure", async () => {
    vi.useFakeTimers();
    const deps = dependencies();

    await act(async () => root?.render(<Probe deps={deps} />));
    await act(async () => vi.runOnlyPendingTimersAsync());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await act(async () => vi.runOnlyPendingTimersAsync());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(container.firstElementChild?.getAttribute("data-polling")).toBe("true");

    await act(async () => vi.advanceTimersByTimeAsync(65_000));
    expect(container.firstElementChild?.getAttribute("data-polling")).toBe("true");
    expect(container.firstElementChild?.getAttribute("data-error")).toBe("");
    expect(vi.mocked(deps.getOperation).mock.calls.length).toBeLessThan(10);
  });

  it("rejects an expired quote before starting a financial mutation", async () => {
    const deps = dependencies();
    deps.now = () => Date.parse("2026-07-17T00:00:00Z");

    await act(async () => root?.render(<Probe deps={deps} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-quote"))
      .toBe("quote-org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());

    expect(deps.createCheckout).not.toHaveBeenCalled();
    expect(container.firstElementChild?.getAttribute("data-error")).not.toBe("");
  });

  it("never opens checkout when the returned quote does not match the confirmed quote", async () => {
    const deps = dependencies();
    vi.mocked(deps.createCheckout).mockResolvedValue({
      checkout_id: "checkout-org-a",
      checkout_url: "https://checkout.example/session",
      quote: { ...quote("org-a"), quote_id: "quote-other" },
      operation: operation("org-a"),
    });

    await act(async () => root?.render(<Probe deps={deps} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="quote"]')?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-quote"))
      .toBe("quote-org-a"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click());

    expect(deps.openExternalUrl).not.toHaveBeenCalled();
    expect(container.firstElementChild?.getAttribute("data-polling")).toBe("false");
    expect(container.firstElementChild?.getAttribute("data-error")).not.toBe("");
  });

  it("resumes a durable commercial operation after the Billing surface reloads", async () => {
    vi.useFakeTimers();
    const deps = dependencies();
    const resumedOperation = deferred<DesktopBillingOperation>();
    vi.mocked(deps.listOperations).mockResolvedValue([operation("org-a", "pending")]);
    vi.mocked(deps.getOperation).mockReturnValue(resumedOperation.promise);

    await act(async () => root?.render(<Probe deps={deps} />));
    await act(async () => Promise.resolve());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-polling"))
      .toBe("true"));
    await act(async () => vi.advanceTimersByTimeAsync(BILLING_POLL_BACKOFF_MS[0]));

    expect(deps.getOperation).toHaveBeenCalledWith(
      session,
      "org-a",
      "operation-org-a",
      expect.any(Function),
      session.api_base_url,
    );
    await act(async () => resumedOperation.resolve(operation("org-a", "succeeded")));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-polling"))
      .toBe("false"));
  });

  it("stops a permanently mismatched resumed operation until an explicit refresh", async () => {
    vi.useFakeTimers();
    const deps = dependencies();
    vi.mocked(deps.listOperations).mockResolvedValue([operation("org-a", "pending")]);
    vi.mocked(deps.getOperation).mockResolvedValue({
      ...operation("org-a", "pending"),
      id: "unexpected-operation",
    });

    await act(async () => root?.render(<Probe deps={deps} />));
    await act(async () => Promise.resolve());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-polling"))
      .toBe("true"));
    await act(async () => vi.advanceTimersByTimeAsync(BILLING_POLL_BACKOFF_MS[0]));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-polling"))
      .toBe("false"));

    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(deps.getOperation).toHaveBeenCalledTimes(1);
    expect(container.firstElementChild?.getAttribute("data-error")).not.toBe("");
  });

  it("runs correctly under React StrictMode without retaining an abandoned request", async () => {
    const deps = dependencies();

    await act(async () => root?.render(
      <React.StrictMode><Probe deps={deps} /></React.StrictMode>,
    ));

    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-org"))
      .toBe("org-a"));
    expect(container.firstElementChild?.getAttribute("data-error")).toBe("");
  });
});
