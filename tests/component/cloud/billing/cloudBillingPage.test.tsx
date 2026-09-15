/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopBillingCatalog,
  DesktopBillingSummary,
  DesktopBillingUsage,
  DesktopCloudOrganization,
  DesktopCloudSession,
} from "../../../../src/lib/cloudApi";
import { renderWithTestLocalization } from "../../../support/react/localization";

const api = vi.hoisted(() => ({
  listCloudOrganizations: vi.fn(),
  listCloudOrganizationMembers: vi.fn(),
  getCloudOrganizationEntitlements: vi.fn(),
  getCloudOrganizationSeatUsage: vi.fn(),
  getCloudOrganizationAccess: vi.fn(),
  getCloudBillingCatalog: vi.fn(),
  getCloudBillingSummary: vi.fn(),
  getCloudBillingUsage: vi.fn(),
  listCloudBillingOperations: vi.fn(),
}));

vi.mock("../../../../src/lib/cloudApi", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/lib/cloudApi")>("../../../../src/lib/cloudApi");
  return { ...actual, ...api };
});

import { CloudOrganizationBillingPage as CloudGlobalBillingPage } from "../../../../src/features/cloud/organization/CloudOrganizationBillingPage";

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

const orgA: DesktopCloudOrganization = {
  id: "org-a",
  name: "Organization A",
  slug: "organization-a",
  plan: "plus",
  seat_limit: 5,
  created_at: "2026-07-15T00:00:00Z",
};

const orgB: DesktopCloudOrganization = {
  ...orgA,
  id: "org-b",
  name: "Organization B",
  slug: "organization-b",
};

const catalog: DesktopBillingCatalog = {
  schema_version: "1.0",
  catalog_version: "2026-07-15.1",
  effective_at: "2026-07-15T00:00:00Z",
  currency: "USD",
  plans: [{
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
    fixed_limits: { "repo_scopes.max_per_project": 10 },
    per_seat_limits: {},
    allow: {},
    runtime: { fixed_units: 0, units_per_seat: 100 },
  }],
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

function summary(orgId: string): DesktopBillingSummary {
  return {
    org_id: orgId,
    plan_id: "plus",
    status: "active",
    seat_quantity: 2,
    pending_plan_id: null,
    cancel_at_period_end: false,
    current_period_end: null,
    catalog_version: catalog.catalog_version,
    source_revision: 2,
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

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  window.localStorage.clear();
  api.listCloudOrganizations.mockResolvedValue([orgA]);
  api.listCloudOrganizationMembers.mockImplementation(async (_activeSession, orgId: string) => [{
    id: `member-${orgId}`,
    user_id: session.user_id,
    email: session.user_email,
    display_name: "Owner",
    role: "owner",
    joined_at: "2026-07-15T00:00:00Z",
  }]);
  api.getCloudOrganizationEntitlements.mockImplementation(async (_activeSession, orgId: string) => ({
    org_id: orgId,
    plan_id: "plus",
    status: "active",
    source: "puppypay",
    seat_quantity: 2,
    catalog_version: catalog.catalog_version,
    source_revision: 2,
    entitlements: {},
  }));
  api.getCloudOrganizationSeatUsage.mockResolvedValue({ billable_seat_quantity: 1 });
  api.getCloudOrganizationAccess.mockImplementation(async (_activeSession, orgId: string) => ({
    org_id: orgId,
    user_id: session.user_id,
    role: "owner",
    can_manage_billing: true,
  }));
  api.getCloudBillingCatalog.mockResolvedValue(catalog);
  api.getCloudBillingSummary.mockImplementation(async (_activeSession, orgId: string) => summary(orgId));
  api.getCloudBillingUsage.mockImplementation(async (_activeSession, orgId: string) => usage(orgId));
  api.listCloudBillingOperations.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function renderPage() {
  renderWithTestLocalization(root, (
    <CloudGlobalBillingPage
      session={session}
      apiBaseUrl={session.api_base_url}
      onSessionChange={vi.fn()}
    />
  ));
}

describe("CloudGlobalBillingPage", () => {
  it("shows an access-load error without misrepresenting the user as a non-owner", async () => {
    api.getCloudOrganizationAccess.mockRejectedValueOnce(new Error("access unavailable"));

    await act(async () => renderPage());
    await vi.waitFor(() => expect(container.textContent)
      .toContain("Unable to load the organization."));

    expect(container.textContent).not.toContain("Only the organization owner");
    expect(api.getCloudBillingCatalog).not.toHaveBeenCalled();
    expect(api.getCloudBillingSummary).not.toHaveBeenCalled();
    expect(api.listCloudOrganizationMembers).not.toHaveBeenCalled();
    expect(api.getCloudOrganizationEntitlements).not.toHaveBeenCalled();
    expect(api.getCloudOrganizationSeatUsage).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".desktop-cloud-org-secondary-button")?.click();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Plus plan"));
    expect(api.getCloudBillingSummary).toHaveBeenCalledWith(
      session,
      "org-a",
      expect.any(Function),
      session.api_base_url,
    );
  });

  it("requires an explicit organization choice before loading billing", async () => {
    api.listCloudOrganizations.mockResolvedValueOnce([orgA, orgB]);

    await act(async () => renderPage());
    await vi.waitFor(() => expect(container.querySelector("select")).not.toBeNull());

    expect(container.textContent).toContain("Select an organization before viewing team or billing details.");
    expect(api.getCloudBillingCatalog).not.toHaveBeenCalled();

    const selector = container.querySelector<HTMLSelectElement>("select");
    await act(async () => {
      if (!selector) return;
      selector.value = "org-b";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Plus plan"));

    expect(api.getCloudBillingSummary).toHaveBeenCalledWith(
      session,
      "org-b",
      expect.any(Function),
      session.api_base_url,
    );
  });

  it("renders organization billing without a workspace-scoped project count", async () => {
    await act(async () => renderPage());
    await vi.waitFor(() => expect(container.textContent).toContain("Secure billing"));

    expect(container.textContent).not.toContain("projects in this organization");
    expect(container.textContent).not.toContain("project in this organization");
    expect(api.listCloudOrganizationMembers).not.toHaveBeenCalled();
    expect(api.getCloudOrganizationEntitlements).not.toHaveBeenCalled();
    expect(api.getCloudOrganizationSeatUsage).not.toHaveBeenCalled();
  });
});
