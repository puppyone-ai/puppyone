// Unit tests for the desktop cloud API client (src/lib/cloudApi.ts). The client
// shapes requests and delegates to the Electron IPC bridge
// (window.puppyoneDesktop.requestCloudSessionApi). We mock that bridge on
// globalThis.window (no jsdom needed — getDesktopCloudApiBaseUrl guards window
// access in try/catch) and assert request shaping + the session/api-base guards.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCloudBillingPlanChange,
  applyCloudBillingSeatChange,
  cloudApiRequest,
  createCloudBillingCheckout,
  getCloudAutomationOauthAuthorizeUrl,
  getCloudAutomationOauthStatus,
  getCloudBillingCatalog,
  getCloudOrganizationSeatUsage,
  getCloudProject,
  listCloudAutomationConnectionRuns,
  listCloudAutomationProviderResources,
  openCloudBillingExternalUrl,
  quoteCloudBillingPlan,
  supportsCloudAutomationOauth,
  updateCloudProject,
  updateCloudAutomationConnection,
  updateCloudAutomationTrigger,
  validateDesktopBillingCatalog,
  validateDesktopBillingOperation,
  validateDesktopBillingQuote,
  validateDesktopBillingSummary,
  validateDesktopCloudOrganizationSeatUsage,
} from "../../../../src/lib/cloudApi";
import { getCloudHistory, normalizeCloudHistory } from "../../../../src/lib/cloudHistoryApi";

const API = "https://api.puppyone.ai/api/v1";
const session = {
  expires_in: 3600,
  expires_at: 0,
  user_id: "user-123",
  user_email: "user@example.com",
  api_base_url: API,
  session_generation: "generation-1",
  status: "authenticated" as const,
};

let bridge: ReturnType<typeof vi.fn>;

beforeEach(() => {
  bridge = vi.fn();
  (globalThis as unknown as { window: unknown }).window = {
    puppyoneDesktop: { requestCloudSessionApi: bridge },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("cloud API client delegation", () => {
  it("reads capability-derived seat usage without trusting or mis-encoding organization ids", async () => {
    bridge.mockResolvedValueOnce({ billable_seat_quantity: 2 });

    await expect(getCloudOrganizationSeatUsage(session, "org/1", undefined, API))
      .resolves.toEqual({ billable_seat_quantity: 2 });
    expect(bridge).toHaveBeenCalledWith(expect.objectContaining({
      path: "/organizations/org%2F1/seat-usage",
      method: "GET",
    }));
    expect(() => validateDesktopCloudOrganizationSeatUsage({ billable_seat_quantity: -1 }))
      .toThrow(/billable_seat_quantity/i);
  });

  it("uses only the PuppyOne BFF and preserves billing idempotency headers", async () => {
    bridge
      .mockResolvedValueOnce(validBillingCatalog())
      .mockResolvedValueOnce(validBillingQuote())
      .mockResolvedValueOnce({
        checkout_id: "checkout-1",
        checkout_url: "https://checkout.example/session",
        quote: validBillingQuote(),
        operation: validBillingOperation(),
      })
      .mockResolvedValueOnce({
        ...validBillingQuote(),
        kind: "plan",
        application_mode: "plan_change",
        operation: { ...validBillingOperation(), kind: "plan_change" },
      })
      .mockResolvedValueOnce({
        ...validBillingQuote(),
        kind: "seats",
        application_mode: "seat_change",
        operation: { ...validBillingOperation(), kind: "seat_increase" },
      });

    await getCloudBillingCatalog(session, undefined, API);
    await quoteCloudBillingPlan(
      session,
      "org/1",
      "plus",
      2,
      "desktop:plan-quote:stable-key",
      undefined,
      API,
    );
    await createCloudBillingCheckout(
      session,
      "org/1",
      {
        planId: "plus",
        seatQuantity: 2,
        quoteId: "quote-1",
        operationId: "operation-1",
      },
      "desktop:checkout:stable-key",
      undefined,
      API,
    );
    await applyCloudBillingPlanChange(
      session,
      "org/1",
      "quote-1",
      "desktop:plan-change:stable-key",
      undefined,
      API,
    );
    await applyCloudBillingSeatChange(
      session,
      "org/1",
      "quote-1",
      "desktop:seat-change:stable-key",
      "operation-1",
      undefined,
      API,
    );

    expect(bridge).toHaveBeenNthCalledWith(1, expect.objectContaining({
      path: "/billing/catalog",
      method: "GET",
    }));
    expect(bridge).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: "/billing/organizations/org%2F1/plan/quote",
      method: "POST",
      headers: expect.objectContaining({
        "Idempotency-Key": "desktop:plan-quote:stable-key",
      }),
      body: JSON.stringify({ target_plan_id: "plus", seat_quantity: 2 }),
    }));
    expect(bridge).toHaveBeenNthCalledWith(3, expect.objectContaining({
      path: "/billing/organizations/org%2F1/checkout",
      method: "POST",
      headers: expect.objectContaining({ "Idempotency-Key": "desktop:checkout:stable-key" }),
      body: JSON.stringify({
        plan_id: "plus",
        seat_quantity: 2,
        quote_id: "quote-1",
        operation_id: "operation-1",
      }),
    }));
    expect(bridge).toHaveBeenNthCalledWith(4, expect.objectContaining({
      path: "/billing/organizations/org%2F1/plan/change",
      headers: expect.objectContaining({ "Idempotency-Key": "desktop:plan-change:stable-key" }),
      body: JSON.stringify({
        quote_id: "quote-1",
      }),
    }));
    expect(bridge).toHaveBeenNthCalledWith(5, expect.objectContaining({
      path: "/billing/organizations/org%2F1/seats/change",
      headers: expect.objectContaining({ "Idempotency-Key": "desktop:seat-change:stable-key" }),
      body: JSON.stringify({
        quote_id: "quote-1",
        operation_id: "operation-1",
      }),
    }));
  });

  it("fails closed on unknown catalog majors and leaked provider mappings", () => {
    expect(() => validateDesktopBillingCatalog({
      ...validBillingCatalog(),
      schema_version: "2.0",
    })).toThrow(/unsupported/i);
    const catalog = validBillingCatalog();
    expect(() => validateDesktopBillingCatalog({
      ...catalog,
      plans: [{ ...catalog.plans[0], provider: { checkout_product_id: "secret" } }],
    })).toThrow(/private provider/i);
    expect(() => validateDesktopBillingCatalog({
      ...catalog,
      runtime: { ...catalog.runtime, overage_enabled: false },
    })).toThrow(/disabled billing overage/i);
  });

  it("requires server-declared billing actions instead of inferring them from plan ids", () => {
    const summary = {
      org_id: "org-1",
      plan_id: "starter-v2",
      status: "active",
      seat_quantity: 2,
      pending_plan_id: null,
      cancel_at_period_end: false,
      current_period_end: null,
      catalog_version: "test.1",
      source_revision: 3,
      portal_available: true,
      seat_changes_available: true,
      runtime_available_units: 10,
      runtime_reserved_units: 0,
      runtime_overage_enabled: false,
      runtime_monthly_limit_cents: 0,
    };
    expect(validateDesktopBillingSummary(summary).seat_changes_available).toBe(true);
    expect(() => validateDesktopBillingSummary({
      ...summary,
      seat_changes_available: undefined,
    })).toThrow(/seat_changes_available/i);

    const quote = {
      quote_id: "quote-1",
      org_id: "org-1",
      kind: "plan",
      current_plan_id: "starter-v2",
      target_plan_id: "team-v3",
      current_seats: 2,
      target_seats: 3,
      currency: "USD",
      current_amount_cents: 100,
      target_amount_cents: 200,
      delta_amount_cents: 100,
      application_mode: "checkout",
      requires_confirmation: true,
      catalog_version: "test.1",
      expires_at: "2026-07-14T00:00:00Z",
      details: {},
    };
    expect(validateDesktopBillingQuote(quote).application_mode).toBe("checkout");
    expect(() => validateDesktopBillingQuote({
      ...quote,
      application_mode: "infer-from-free-plan",
    })).toThrow(/application_mode/i);
  });

  it("rejects malformed or contradictory billing lifecycle data", () => {
    expect(validateDesktopBillingOperation(validBillingOperation()).state).toBe("processing");
    expect(() => validateDesktopBillingOperation({
      ...validBillingOperation(),
      terminal: true,
    })).toThrow(/lifecycle flags/i);
    expect(() => validateDesktopBillingOperation({
      ...validBillingOperation(),
      state: "succeeded",
      terminal: true,
      retryable: false,
    })).toThrow(/incomplete succeeded/i);
    expect(() => validateDesktopBillingOperation({
      ...validBillingOperation(),
      state: "retryable_failed",
    })).toThrow(/retryable billing operation/i);
    expect(() => validateDesktopBillingSummary({
      org_id: "org-1",
      plan_id: "plus",
      status: "paid-ish",
      seat_quantity: 2,
      pending_plan_id: null,
      cancel_at_period_end: false,
      current_period_end: null,
      catalog_version: "test.1",
      source_revision: 1,
      portal_available: true,
      seat_changes_available: true,
      runtime_available_units: 1,
      runtime_reserved_units: 0,
      runtime_overage_enabled: false,
      runtime_monthly_limit_cents: 0,
    })).toThrow(/summary.status/i);
  });

  it("opens verified checkout URLs through the system-browser bridge", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue({ ok: true });
    (globalThis.window as unknown as { puppyoneDesktop: Record<string, unknown> }).puppyoneDesktop
      .openExternalUrl = openExternalUrl;

    await openCloudBillingExternalUrl("https://checkout.example/session");
    expect(openExternalUrl).toHaveBeenCalledWith("https://checkout.example/session");
    await expect(openCloudBillingExternalUrl("http://checkout.example/session"))
      .rejects.toThrow(/unsafe/i);
  });

  it("getCloudProject URL-encodes the project id in the path", async () => {
    bridge.mockResolvedValue({ id: "a/b" });
    await getCloudProject(session, "a/b", undefined, API);
    expect(bridge).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/projects/a%2Fb", method: "GET" }),
    );
  });

  it("updates native Project settings through the secure Cloud bridge", async () => {
    bridge.mockResolvedValue({ id: "project/1", name: "Atlas", visibility: "private" });

    await expect(updateCloudProject(
      session,
      "project/1",
      {
        name: "  Atlas  ",
        description: null,
        bound_git_branch: "  main  ",
        visibility: "private",
      },
      undefined,
      API,
    )).resolves.toEqual({ id: "project/1", name: "Atlas", visibility: "private" });

    expect(bridge).toHaveBeenCalledWith(expect.objectContaining({
      path: "/projects/project%2F1",
      method: "PUT",
      body: JSON.stringify({
        name: "Atlas",
        description: null,
        bound_git_branch: "main",
        visibility: "private",
      }),
    }));
    expect(() => updateCloudProject(session, "project-1", {})).toThrow(/at least one setting/i);
    expect(() => updateCloudProject(session, "project-1", { name: "  " })).toThrow(/name cannot be empty/i);
  });

  it("keeps OAuth provider-to-slug translation inside the Automation adapter", async () => {
    bridge
      .mockResolvedValueOnce({ connected: false, workspace_name: null, connected_at: null, connection_id: null })
      .mockResolvedValueOnce({ authorization_url: "https://accounts.example.test/oauth" });

    await getCloudAutomationOauthStatus(session, "google_search_console", undefined, API);
    await expect(getCloudAutomationOauthAuthorizeUrl(session, "google_docs", undefined, API))
      .resolves.toBe("https://accounts.example.test/oauth");

    expect(bridge).toHaveBeenNthCalledWith(1, expect.objectContaining({
      path: "/oauth/google-search-console/status",
      method: "GET",
    }));
    expect(bridge).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: "/oauth/google-docs/authorize",
      method: "GET",
    }));
    expect(supportsCloudAutomationOauth("google_docs")).toBe(true);
    expect(supportsCloudAutomationOauth("url")).toBe(false);
  });

  it("shapes resource pagination, edits, trigger updates, and lazy run history", async () => {
    bridge.mockResolvedValue({ resources: [], next_cursor: null });
    await listCloudAutomationProviderResources(
      session,
      "google_docs",
      { q: "product brief", cursor: "page/2", resourceType: "document" },
      undefined,
      API,
    );
    await updateCloudAutomationConnection(
      session,
      "connection/1",
      { target_path: "Research/Docs", config: { source: { resource_id: "doc-1" } } },
      undefined,
      API,
    );
    await updateCloudAutomationTrigger(
      session,
      "connection/1",
      { sync_mode: "scheduled", trigger: { type: "schedule", schedule: "0 9 * * *", timezone: "UTC" } },
      undefined,
      API,
    );
    await listCloudAutomationConnectionRuns(session, "connection/1", 10, undefined, API);

    expect(bridge).toHaveBeenNthCalledWith(1, expect.objectContaining({
      path: "/integrations/providers/google_docs/resources?q=product+brief&cursor=page%2F2&resource_type=document",
      method: "GET",
    }));
    expect(bridge).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: "/integrations/connections/connection%2F1",
      method: "PATCH",
    }));
    expect(bridge).toHaveBeenNthCalledWith(3, expect.objectContaining({
      path: "/integrations/connections/connection%2F1/trigger",
      method: "PATCH",
    }));
    expect(bridge).toHaveBeenNthCalledWith(4, expect.objectContaining({
      path: "/integrations/connections/connection%2F1/runs?limit=10",
      method: "GET",
    }));
  });

  it("getCloudHistory requests the topological contract and forwards its cursor", async () => {
    bridge.mockResolvedValue({
      project_id: "a/b",
      commits: [],
      head_commit_id: null,
      refs: [],
      refs_included: false,
      snapshot_id: "1".repeat(64),
      next_cursor: null,
      has_more: false,
      total: 0,
      graph_health: "complete",
      unreadable_commit_ids: [],
    });
    await getCloudHistory(session, "a/b", 80, undefined, API, "a".repeat(40));
    expect(bridge).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/content/a%2Fb/commits?limit=80&order=topo&cursor=${"a".repeat(40)}`,
        method: "GET",
      }),
    );
  });

  it("normalizes legacy optional fields at the API boundary and rejects malformed ancestry", () => {
    const commitId = "b".repeat(40);
    expect(normalizeCloudHistory({
      project_id: "p1",
      commits: [{ commit_id: commitId }],
      head_commit_id: commitId,
    })).toEqual(expect.objectContaining({
      project_id: "p1",
      topology_available: false,
      refs: [],
      has_more: false,
      graph_health: "complete",
      commits: [expect.objectContaining({ parent_ids: [], changes: [] })],
    }));
    expect(() => normalizeCloudHistory({
      commits: [{ commit_id: commitId, parent_ids: ["not-a-commit"] }],
    })).toThrow(/parent id is invalid/i);
  });

  it("fails closed on cross-project, topology-less, or inconsistent History pages", async () => {
    const valid = {
      project_id: "p1",
      commits: [],
      head_commit_id: null,
      refs: [],
      refs_included: true,
      snapshot_id: "1".repeat(64),
      next_cursor: null,
      has_more: false,
      total: 0,
      graph_health: "complete",
      unreadable_commit_ids: [],
    };

    bridge.mockResolvedValueOnce({ ...valid, project_id: "p2" });
    await expect(getCloudHistory(session, "p1", 80, undefined, API))
      .rejects.toThrow(/another project/i);

    bridge.mockResolvedValueOnce({
      ...valid,
      commits: [{ commit_id: "a".repeat(40) }],
      total: 1,
    });
    await expect(getCloudHistory(session, "p1", 80, undefined, API))
      .rejects.toThrow(/does not include commit topology/i);

    bridge.mockResolvedValueOnce({ ...valid, has_more: true });
    await expect(getCloudHistory(session, "p1", 80, undefined, API))
      .rejects.toThrow(/pagination state is inconsistent/i);
  });
});

function validBillingCatalog() {
  return {
    schema_version: "1.0",
    catalog_version: "test.1",
    effective_at: "2026-07-14T00:00:00Z",
    currency: "USD",
    plans: [{
      id: "free",
      aliases: [],
      name: "Free",
      description: "Local first",
      public: true,
      purchasable: false,
      highlighted: false,
      currency: "USD",
      interval: "none",
      price_per_seat_cents: 0,
      seats: { minimum: 1, maximum: 1 },
      features: {},
      fixed_limits: {},
      per_seat_limits: {},
      allow: {},
      runtime: { fixed_units: 0, units_per_seat: 0 },
    }],
    runtime: {
      top_ups_enabled: false,
      overage_enabled: true,
      unit_seconds: 60,
      minimum_units: 1,
      overage_price_cents_per_unit: 2,
      profiles: [],
      top_up_packs: [],
    },
  };
}

function validBillingQuote() {
  return {
    quote_id: "quote-1",
    org_id: "org/1",
    kind: "checkout",
    current_plan_id: "free",
    target_plan_id: "plus",
    current_seats: 1,
    target_seats: 2,
    currency: "USD",
    current_amount_cents: 0,
    target_amount_cents: 3600,
    delta_amount_cents: 3600,
    application_mode: "checkout" as const,
    requires_confirmation: true,
    catalog_version: "test.1",
    expires_at: "2026-07-14T00:30:00Z",
    details: {},
  };
}

function validBillingOperation() {
  return {
    id: "operation-1",
    org_id: "org/1",
    kind: "checkout",
    state: "processing",
    terminal: false,
    retryable: true,
    action_required: false,
    target_plan_id: "plus",
    current_seat_quantity: 1,
    target_seat_quantity: 2,
    quote_id: "quote-1",
    confirmed_revision: null,
    error_code: null,
    created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z",
    completed_at: null,
  };
}

describe("session / api-base guards", () => {
  it("reconstructs typed errors from the structured IPC envelope", async () => {
    bridge.mockResolvedValue({
      transport: "puppyone-cloud-ipc-v1",
      ok: false,
      error: {
        status: 503,
        code: "AUTHORIZATION_UNAVAILABLE",
        message: "Project authorization is temporarily unavailable",
      },
    });

    const error = await cloudApiRequest("/projects/project-1", session, undefined, {}, API)
      .then(() => null, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: "Project authorization is temporarily unavailable",
      status: 503,
      code: "AUTHORIZATION_UNAVAILABLE",
    });
  });

  it("rejects with 401 (without calling the bridge) when the requested api base != the session's", async () => {
    const otherApi = "https://subdomain.puppyone.ai/api/v1";
    await expect(
      cloudApiRequest("/projects/", session, undefined, {}, otherApi),
    ).rejects.toThrow(/sign in/i);
    expect(bridge).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the desktop session bridge is unavailable", async () => {
    (globalThis as unknown as { window: unknown }).window = {
      puppyoneDesktop: undefined,
      localStorage: { getItem: () => null, setItem: () => {} },
    };
    await expect(
      cloudApiRequest("/projects/", session, undefined, {}, API),
    ).rejects.toThrow(/unavailable/i);
  });
});
