/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  isSettingsSectionAvailable,
  resolveSettingsSidebarGroups,
} from "../../../../src/features/settings/sidebar/settingsSidebarModel";
import {
  formatStorage,
  resolveAllowance,
  resolvePlanCatalog,
  resolvePlanHolding,
} from "../../../../src/features/settings/main/planPricing";
import {
  CloudPlans,
  CurrentPlan,
  describeQuoteTiming,
} from "../../../../src/features/settings/main/CloudPlans";
import type {
  DesktopBillingCatalog,
  DesktopBillingQuote,
  DesktopBillingSummary,
  DesktopBillingUsage,
} from "../../../../src/lib/cloudApi";
import { useLocalization } from "@puppyone/localization";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

async function render(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(withTestLocalization(node)));
  return host;
}

const GB = 1000 ** 3;

const REQUIRED = {
  "access_surface.agent": true, "access_surface.mcp": true, "access_surface.sandbox": true,
  "automation.hosted": true, "remote_workspace.create": true, "scope_sandbox.connect": true,
};
const TEAM = {
  "team.member_roles": true, "agent.access_rules": true, "activity.log": true, "billing.consolidated": true,
};
/** The 2026-11-09.1 catalog as the billing service publishes it. */
const CATALOG = {
  schema_version: "1.1", catalog_version: "2026-11-09.1", effective_at: "2026-11-09T00:00:00Z", currency: "USD",
  plans: [
    {
      id: "free", aliases: [], name: "Free", description: "", public: true, purchasable: false, highlighted: false,
      currency: "USD", interval: "none", price_per_seat_cents: 0, seats: { minimum: 1, maximum: 1 },
      features: REQUIRED, allow: {}, runtime: { fixed_units: 300, units_per_seat: 0 }, per_seat_limits: {},
      fixed_limits: { "projects.max": 1, "storage.max_bytes": GB, "history.retention_days": 30 },
    },
    {
      id: "personal", aliases: ["plus"], name: "Personal", description: "", public: true, purchasable: true,
      highlighted: true, currency: "USD", interval: "month", price_per_seat_cents: 2000,
      seats: { minimum: 1, maximum: 1, transition_to: "team" }, features: REQUIRED, allow: {},
      runtime: { fixed_units: 2400, units_per_seat: 0 }, per_seat_limits: {},
      fixed_limits: { "projects.max": 20, "storage.max_bytes": 10 * GB, "history.retention_days": 30 },
    },
    {
      id: "team", aliases: ["business"], name: "Team", description: "", public: true, purchasable: true,
      highlighted: false, currency: "USD", interval: "month", price_per_seat_cents: 4000,
      seats: { minimum: 2, retention_minimum: 1, maximum: null }, features: { ...REQUIRED, ...TEAM }, allow: {},
      runtime: { fixed_units: 0, units_per_seat: 2400 }, fixed_limits: { "history.retention_days": 365 },
      per_seat_limits: { "projects.max": 20, "storage.max_bytes": 20 * GB },
    },
  ],
  add_ons: [
    {
      id: "agent_hours_100", name: "Extra agent hours", description: "", price_cents: 500, currency: "USD",
      interval: "month", available_on_plans: ["personal", "team"], max_quantity: 20, runtime_units: 6000,
      limit_increments: {},
    },
    {
      id: "storage_10gb", name: "Extra storage", description: "", price_cents: 500, currency: "USD",
      interval: "month", available_on_plans: ["personal", "team"], max_quantity: 50, runtime_units: 0,
      limit_increments: { "storage.max_bytes": 10 * GB },
    },
  ],
  runtime: {
    top_ups_enabled: false, overage_enabled: false, unit_seconds: 60, minimum_units: 1,
    overage_price_cents_per_unit: 0, charged_sources: ["agent", "automation"], profiles: [], top_up_packs: [],
  },
} as unknown as DesktopBillingCatalog;

const summaryOf = (values: Partial<DesktopBillingSummary>) => ({
  org_id: "o1", plan_id: "personal", status: "active", seat_quantity: 1, current_period_end: null,
  cancel_at_period_end: false, ...values,
}) as DesktopBillingSummary;

const usageOf = (usedUnits: number, grantedUnits: number, usedBytes: number, limitBytes: number | null) => ({
  runtime: {
    org_id: "o1",
    allowance: {
      granted_units: grantedUnits, consumed_units: usedUnits, reserved_units: 0,
      resets_at: "2026-12-01T00:00:00Z", unit_seconds: 60,
    },
  },
  storage: { logical_bytes: usedBytes, limit_bytes: limitBytes },
}) as unknown as DesktopBillingUsage;

function SignedOut({ onSignIn = () => undefined, signedIn = false }: {
  onSignIn?: () => void;
  signedIn?: boolean;
}) {
  const localization = useLocalization();
  return (
    <CloudPlans
      session={signedIn ? ({ user_id: "u1" } as never) : null}
      apiBaseUrl={null}
      organizationId={null}
      onSessionChange={() => undefined}
      catalog={null}
      summary={null}
      usage={null}
      loading={false}
      onRefresh={() => undefined}
      localization={localization}
      onSignIn={onSignIn}
    />
  );
}

/**
 * Pricing (2026-11-09): Free, Personal $20 a month and Team $40 per
 * person a month, each including cloud projects, storage and cloud agent
 * hours. Hours count agent time only. Add-ons are monthly packs on a paid plan.
 */

it("keeps the price reachable without a local project, and only with Cloud on", () => {
  const context = { cloudEnabled: true, accountAvailable: true, localWorkspaceAvailable: false };
  const ids = resolveSettingsSidebarGroups(context).flatMap((g) => g.items.map((i) => i.id));
  expect(ids).toContain("account");
  expect(ids).toContain("seats");
  // Hosting describes a project, so it needs one; the money never does.
  expect(ids).not.toContain("cloud");
  expect(isSettingsSectionAvailable("account", context)).toBe(true);
  // With Cloud off the account and its compute stay; the Plan sells storage
  // and the Cloud Computer, so it waits for Cloud.
  const localFirst = { cloudEnabled: false, accountAvailable: true, localWorkspaceAvailable: false };
  expect(isSettingsSectionAvailable("account", localFirst)).toBe(true);
  expect(isSettingsSectionAvailable("seats", localFirst)).toBe(false);
  // Only a build without accounts has no Account page.
  const noAccounts = { cloudEnabled: false, accountAvailable: false, localWorkspaceAvailable: false };
  expect(isSettingsSectionAvailable("account", noAccounts)).toBe(false);
});

it("splits state from purchase, and puts every price on Plan", () => {
  const context = { cloudEnabled: true, accountAvailable: true };
  const cloud = resolveSettingsSidebarGroups(context).find((group) => group.id === "cloud");
  expect(cloud?.items.map((item) => item.id)).toEqual(["account", "seats"]);
  expect(isSettingsSectionAvailable("seats", context)).toBe(true);
  // Invoices are documents, not a settings pane: Plan links out to them.
  expect(cloud?.items.map((item) => item.id)).not.toContain("billing");

  // The owner's computers sit with the account, after Plan, once device sharing is on.
  const withComputers = resolveSettingsSidebarGroups({ ...context, hostDevicesEnabled: true })
    .find((group) => group.id === "cloud");
  expect(withComputers?.items.map((item) => item.id)).toEqual(["account", "seats", "other-computers"]);
});

it("offers three plans with one price each and the same allowances", () => {
  const { plans, authoritative } = resolvePlanCatalog(null);
  expect(authoritative).toBe(false);
  expect(plans.map((plan) => [plan.id, plan.priceCents, plan.perPerson])).toEqual([
    ["free", 0, false],
    ["personal", 2000, false],
    ["team", 4000, true],
  ]);
  expect(plans.map((plan) => plan.agentHours)).toEqual([5, 40, 40]);
  expect(plans.map((plan) => plan.storageBytes)).toEqual([GB, 10 * GB, 20 * GB]);
  // Indicative offers carry no catalog plan, so nothing can be bought from them.
  expect(plans.every((plan) => plan.catalogPlan === undefined)).toBe(true);
  // No spec may survive on the model, or a surface can quote it by accident.
  for (const spec of ["vcpus", "memoryGb", "gpu", "units"]) {
    expect(plans[1]).not.toHaveProperty(spec);
  }
});

it("reads plans and add-ons from the catalog, in hours and bytes", () => {
  const { plans, addOns, authoritative } = resolvePlanCatalog(CATALOG);
  expect(authoritative).toBe(true);
  const team = plans.find((plan) => plan.id === "team")!;
  expect([team.perPerson, team.minimumSeats, team.agentHours, team.storageBytes]).toEqual([true, 2, 40, 20 * GB]);
  expect(team.teamFeatures).toBe(true);
  expect(plans.find((plan) => plan.id === "free")!.agentHours).toBe(5);
  expect(addOns.map((addOn) => [addOn.id, addOn.kind, addOn.hours, addOn.storageBytes])).toEqual([
    ["agent_hours_100", "hours", 100, 0],
    ["storage_10gb", "storage", 0, 10 * GB],
  ]);
});

it("keeps indicative prices when the catalog is an older price list", () => {
  const legacy = { ...CATALOG, plans: CATALOG.plans.filter((plan) => plan.id !== "team") } as DesktopBillingCatalog;
  expect(resolvePlanCatalog(legacy).authoritative).toBe(false);
});

it("treats holding nothing as Free, a complete answer", () => {
  const holding = resolvePlanHolding(null, null);
  expect([holding.subscribed, holding.planId, holding.monthlyCents]).toEqual([false, "free", 0]);
  const pending = summaryOf({ status: "checkout_pending" });
  expect(resolvePlanHolding(pending, CATALOG).subscribed).toBe(false);
});

it("bills a team per person and names a legacy plan by its new name", () => {
  const team = resolvePlanHolding(summaryOf({ plan_id: "business", seat_quantity: 5 }), CATALOG);
  expect([team.planId, team.seats, team.monthlyCents]).toEqual(["team", 5, 20000]);
  const held = resolvePlanHolding(summaryOf({
    add_ons: [
      { add_on_id: "agent_hours_100", quantity: 2, status: "active", cancel_at_period_end: false, current_period_end: null },
      { add_on_id: "storage_10gb", quantity: 1, status: "cancel_scheduled", cancel_at_period_end: true, current_period_end: null },
    ],
  }), CATALOG);
  // A pack scheduled to end is not counted as held going forward.
  expect(held.addOns).toEqual({ agent_hours_100: 2 });
});

it("pools a team's hours and storage, and adds the packs held", () => {
  const { plans, addOns } = resolvePlanCatalog(CATALOG);
  const team = plans.find((plan) => plan.id === "team")!;
  const holding = resolvePlanHolding(summaryOf({
    plan_id: "team",
    seat_quantity: 3,
    add_ons: [{ add_on_id: "agent_hours_100", quantity: 1, status: "active", cancel_at_period_end: false, current_period_end: null }],
  }), CATALOG);
  const reading = resolveAllowance(null, team, holding, addOns);
  expect([reading.usedHours, reading.includedHours, reading.includedBytes]).toEqual([null, 220, 60 * GB]);
});

it("reads used hours only from the billing service, never invents them", () => {
  const { plans, addOns } = resolvePlanCatalog(CATALOG);
  const personal = plans.find((plan) => plan.id === "personal")!;
  const holding = resolvePlanHolding(summaryOf({}), CATALOG);
  const reading = resolveAllowance(usageOf(12 * 60, 40 * 60, 3.2 * GB, 10 * GB), personal, holding, addOns);
  expect([reading.usedHours, reading.includedHours, reading.usedBytes, reading.includedBytes])
    .toEqual([12, 40, 3.2 * GB, 10 * GB]);
});

it("compares the three plans side by side, each with one price", async () => {
  const host = await render(<SignedOut />);
  const cards = [...host.querySelectorAll(".desktop-plan-card")];
  // Each plan is a spec sheet: an index and a name, one price, the same rows.
  expect(cards.map((card) => card.querySelector(".desktop-plan-card-head .desktop-plan-mono-label")?.textContent))
    .toEqual(["01 / Free", "02 / Personal", "03 / Team"]);
  expect(cards.map((card) => [
    card.querySelector(".desktop-plan-card-amount")?.textContent,
    card.querySelector(".desktop-plan-card-per")?.textContent,
  ])).toEqual([["$0", "/ month"], ["$20", "/ month"], ["$40", "/ person / month"]]);
  const specs = (card: Element | undefined) => [...(card?.querySelectorAll(".desktop-plan-spec-row") ?? [])]
    .map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]);
  expect(specs(cards[1])).toEqual([
    ["Agent hours", "40 h / month"], ["Storage", "10 GB"], ["Projects online", "20"], ["History", "30 days"],
  ]);
  expect(specs(cards[2])[0]).toEqual(["Agent hours", "40 h / person / month"]);
  expect(cards[2]?.textContent).toContain("Member roles");
  // Not sold until Cloud enforces them.
  expect(cards[2]?.textContent).not.toMatch(/Choose what each agent|record of what agents/);
  // The machine behind the hours is never described.
  expect(host.textContent).not.toMatch(/vCPU|GPU|RAM|\bcores?\b|\bVM\b|virtual machine|instance|\bunits?\b/i);
});

it("says beside the hours that people working in the cloud never spend them", async () => {
  const host = await render(<SignedOut />);
  expect(host.querySelector(".desktop-plan-note")?.textContent)
    .toMatch(/people opening and editing files never use them/);
});

it("routes a signed-out reader to sign-in from every plan", async () => {
  const signIn = vi.fn();
  const host = await render(<SignedOut onSignIn={signIn} />);
  const buttons = [...host.querySelectorAll<HTMLButtonElement>(".desktop-plan-card button")];
  expect(buttons.map((button) => button.textContent)).toEqual([
    "Sign in to choose", "Sign in to choose", "Sign in to choose",
  ]);
  await act(async () => buttons[1]?.click());
  expect(signIn).toHaveBeenCalledOnce();
});

it("does not offer sign-in to a reader who is already signed in", async () => {
  const host = await render(<SignedOut signedIn />);
  const button = host.querySelector<HTMLButtonElement>(".desktop-plan-card button")!;
  expect(button.textContent).toBe("Loading…");
  expect(button.disabled).toBe(true);
});

it("never reads a few saved files as zero gigabytes", () => {
  const L = { t: (id: string, v?: Record<string, string>) => `${v?.amount} ${id.endsWith("Mb") ? "MB" : "GB"}`,
    formatNumber: (n: number) => String(n) } as never;
  expect(formatStorage(0, L)).toBe("0 MB");
  expect(formatStorage(10 * GB, L)).toBe("10 GB");
});

it("carries no way back, because the nav it came from is still on screen", async () => {
  const host = await render(<SignedOut />);
  expect(host.querySelector(".desktop-settings-back")).toBeNull();
});

/**
 * Downgrades and seat decreases decided on 2026-11-09: they wait for renewal,
 * keep everything paid for until then, and refund nothing.
 */
const SCHEDULED_TEAM = summaryOf({
  plan_id: "team",
  seat_quantity: 3,
  current_period_end: "2026-12-08T12:00:00Z",
  pending_plan_id: null,
  pending_seat_quantity: 2,
  pending_effective_at: "2026-12-08T12:00:00Z",
});

it("reads a scheduled seat decrease and a scheduled downgrade from the summary", () => {
  expect(resolvePlanHolding(SCHEDULED_TEAM, CATALOG).scheduled).toEqual({
    planId: "team", seats: 2, effectiveAt: "2026-12-08T12:00:00Z",
  });
  const downgrade = resolvePlanHolding(summaryOf({
    ...SCHEDULED_TEAM, pending_plan_id: "plus", pending_seat_quantity: 1,
  }), CATALOG);
  expect(downgrade.scheduled?.planId).toBe("personal");
  // A change still waiting on the payment service is not a schedule.
  expect(resolvePlanHolding(summaryOf({ status: "change_pending", pending_plan_id: "team" }), CATALOG)
    .scheduled).toBeNull();
});

function ScheduledCard({ summary, onKeep }: { summary: DesktopBillingSummary; onKeep: () => void }) {
  const localization = useLocalization();
  const { plans, addOns } = resolvePlanCatalog(CATALOG);
  const holding = resolvePlanHolding(summary, CATALOG);
  return (
    <CurrentPlan
      offer={plans.find((plan) => plan.id === holding.planId)!}
      holding={holding}
      usage={null}
      addOns={addOns}
      localization={localization}
      scheduledAction={<button type="button" onClick={onKeep}>Keep current plan</button>}
    />
  );
}

it("says what changes at renewal and offers to keep the current plan", async () => {
  const keep = vi.fn();
  const host = await render(<ScheduledCard summary={SCHEDULED_TEAM} onKeep={keep} />);
  expect(host.textContent).toContain("Scheduled change");
  expect(host.textContent).toMatch(/2 people from Dec 8/);
  await act(async () => host.querySelector<HTMLButtonElement>("button")?.click());
  expect(keep).toHaveBeenCalledOnce();

  const downgrade = await render(
    <ScheduledCard
      summary={summaryOf({ ...SCHEDULED_TEAM, pending_plan_id: "personal", pending_seat_quantity: 1 })}
      onKeep={() => undefined}
    />,
  );
  expect(downgrade.textContent).toMatch(/Personal from Dec 8/);
});

function QuoteTiming({ quote, summary }: { quote: DesktopBillingQuote; summary: DesktopBillingSummary }) {
  const localization = useLocalization();
  const timing = describeQuoteTiming(quote, resolvePlanHolding(summary, CATALOG), localization);
  return <p data-confirm={localization.t(timing.confirm)} data-browser={String(timing.opensBrowser)}>{timing.note}</p>;
}

const quoteOf = (values: Partial<DesktopBillingQuote>) => ({
  quote_id: "q1", org_id: "o1", kind: "plan", current_plan_id: "team", target_plan_id: "team",
  current_seats: 3, target_seats: 3, currency: "USD", current_amount_cents: 6000, target_amount_cents: 6000,
  delta_amount_cents: 0, application_mode: "plan_change", effective: "now", requires_confirmation: true,
  catalog_version: "2026-11-08.1", expires_at: "2026-11-09T00:00:00Z", details: {}, ...values,
}) as DesktopBillingQuote;

it("tells a downgrade apart from a payment before it is confirmed", async () => {
  const later = await render(
    <QuoteTiming
      quote={quoteOf({ target_seats: 2, target_amount_cents: 4000, effective: "next_period" })}
      summary={summaryOf({ plan_id: "team", seat_quantity: 3, current_period_end: "2026-12-08T12:00:00Z" })}
    />,
  );
  const note = later.querySelector("p")!;
  expect(note.textContent).toMatch(/Takes effect on Dec 8.*nothing is refunded/);
  expect([note.dataset.confirm, note.dataset.browser]).toEqual(["Schedule change", "false"]);

  const keep = await render(<QuoteTiming quote={quoteOf({})} summary={SCHEDULED_TEAM} />);
  expect(keep.querySelector("p")!.dataset.confirm).toBe("Keep current plan");

  const pay = await render(
    <QuoteTiming
      quote={quoteOf({ target_seats: 4, target_amount_cents: 8000 })}
      summary={summaryOf({ plan_id: "team", seat_quantity: 3 })}
    />,
  );
  expect([pay.querySelector("p")!.dataset.confirm, pay.querySelector("p")!.dataset.browser])
    .toEqual(["Confirm and pay", "true"]);
});
