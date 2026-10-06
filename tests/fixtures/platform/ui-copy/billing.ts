import type { DesktopBillingCatalog, DesktopBillingSummary, DesktopBillingUsage, DesktopCloudOrganization, DesktopCloudSession } from "../../../../src/lib/cloudApi";
const session = {
  user_id: "user-a",
  user_email: "a@example.com",
  api_base_url: "http://127.0.0.1:5184/api/v1",
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


export { session, orgA, orgB, catalog, summary, usage };
