/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopBillingSummary, DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { cloudCache, invalidateCloudCacheForMutation } from "../../../../src/features/cloud/cache/cloudCache";
import { BILLING_READ_TIMEOUT_MS, BILLING_READ_TTL_MS } from "../../../../src/features/cloud/billing/billingReadCache";
import { useAccountPlan } from "../../../../src/features/settings/main/useAccountPlan";
import { CloudPlans } from "../../../../src/features/settings/main/CloudPlans";
import { useLocalization } from "@puppyone/localization";
import { withTestLocalization } from "../../../support/react/localization";
import { catalog as fixtureCatalog, usage as fixtureUsage } from "../../../fixtures/platform/ui-copy/billing";

const api = vi.hoisted(() => ({
  getCloudBillingCatalog: vi.fn(), listCloudOrganizations: vi.fn(),
  getCloudBillingSummary: vi.fn(), getCloudBillingUsage: vi.fn(), getCloudOrganizationAccess: vi.fn(),
}));
const operationsRead = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/lib/cloudApi", async () => ({
  ...await vi.importActual<typeof import("../../../../src/lib/cloudApi")>("../../../../src/lib/cloudApi"), ...api,
  listCloudBillingOperations: operationsRead,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  user_id: "user-a", session_generation: "generation-a", api_base_url: "https://cloud.example/api/v1",
  user_email: "a@example.com", status: "authenticated", expires_in: 3600, expires_at: 0,
} satisfies DesktopCloudSession;
const organizations = [
  { id: "personal", name: "Personal space", kind: "space" },
  { id: "team", name: "Research", kind: "space" },
];
const summary = (org = "personal", revision = 1) => ({ org_id: org, plan_id: "personal", source_revision: revision }) as DesktopBillingSummary;
const usage = (org: string) => ({ runtime: { org_id: org }, storage: { logical_bytes: 123 } });
let latest: ReturnType<typeof useAccountPlan>;
let observed: Array<ReturnType<typeof useAccountPlan>>;
let root: Root | null;
let host: HTMLDivElement;
let now: number;

function Probe({ activeSession = session, enabled = true, organizationId = "personal" }: { activeSession?: DesktopCloudSession | null; enabled?: boolean; organizationId?: string }) {
  latest = useAccountPlan({ session: activeSession, apiBaseUrl: activeSession?.api_base_url ?? null, enabled, onSessionChange: () => undefined, organizationId });
  observed.push(latest);
  return <div data-plan={latest.summary?.plan_id ?? "unknown"} data-loading={latest.loading} />;
}
function PlanPageProbe() {
  const localization = useLocalization();
  const snapshot = useAccountPlan({ session, apiBaseUrl: session.api_base_url, enabled: true, organizationId: "personal", onSessionChange: () => undefined });
  return <CloudPlans session={session} apiBaseUrl={session.api_base_url} organizationId={snapshot.organizationId}
    onSessionChange={() => undefined} catalog={snapshot.catalog} summary={snapshot.summary} usage={snapshot.usage}
    loading={snapshot.loading} loadError={snapshot.error} catalogUnavailable={snapshot.catalogUnavailable}
    onRefresh={snapshot.refresh} localization={localization}
    onSignIn={() => undefined} canManageBilling={snapshot.canManageBilling} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function mount(node: React.ReactNode = <Probe />) {
  if (!root) root = createRoot(host);
  await act(async () => root?.render(node));
}
function unmount() { act(() => root?.unmount()); root = null; }

beforeEach(() => {
  vi.resetAllMocks();
  cloudCache.clear();
  observed = [];
  now = 100_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  api.getCloudBillingCatalog.mockResolvedValue({ catalog_version: "1" });
  api.listCloudOrganizations.mockResolvedValue(organizations);
  api.getCloudBillingSummary.mockImplementation(async (_session, org: string) => summary(org));
  api.getCloudBillingUsage.mockImplementation(async (_session, org: string) => usage(org));
  api.getCloudOrganizationAccess.mockImplementation(async (_session, org: string) => ({ org_id: org, can_manage_billing: true }));
  operationsRead.mockResolvedValue([]);
  host = document.createElement("div"); document.body.append(host);
  root = null;
});
afterEach(() => { unmount(); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); cloudCache.clear(); });

it("starts loading on the first render and publishes one complete snapshot after slow reads", async () => {
  const pending = deferred<DesktopBillingSummary>();
  api.getCloudBillingSummary.mockReturnValue(pending.promise);
  await mount();
  expect(observed[0]?.loading).toBe(true);
  expect(latest.summary).toBeNull();
  await act(async () => pending.resolve(summary()));
  expect(latest.loading).toBe(false);
  expect(latest.summary?.plan_id).toBe("personal");
});

it("paints a cached reading synchronously on return without repeating fresh reads", async () => {
  await mount(); unmount(); observed = [];
  await mount();
  expect(observed[0]?.summary?.plan_id).toBe("personal");
  expect(api.getCloudBillingCatalog).toHaveBeenCalledTimes(1);
  expect(api.listCloudOrganizations).not.toHaveBeenCalled();
  expect(api.getCloudBillingSummary).toHaveBeenCalledTimes(1);
  expect(api.getCloudBillingUsage).toHaveBeenCalledTimes(1);
});

it("coalesces Strict Mode and simultaneous Account/Plan readers", async () => {
  await mount(<React.StrictMode><Probe /><Probe /></React.StrictMode>);
  for (const [name, read] of Object.entries(api)) expect(read).toHaveBeenCalledTimes(name === "listCloudOrganizations" ? 0 : 1);
});

it("does not restart reads when only the session object is recreated", async () => {
  await mount();
  await mount(<Probe activeSession={{ ...session, expires_at: 9999, status: "refreshing" }} />);
  for (const [name, read] of Object.entries(api)) expect(read).toHaveBeenCalledTimes(name === "listCloudOrganizations" ? 0 : 1);
});

it("revalidates stale readings on focus without blanking the page", async () => {
  await mount();
  now += BILLING_READ_TTL_MS + 1;
  const pending = deferred<DesktopBillingSummary>();
  api.getCloudBillingSummary.mockReturnValue(pending.promise);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(latest.summary?.source_revision).toBe(1);
  await act(async () => pending.resolve(summary("personal", 2)));
  expect(latest.summary?.source_revision).toBe(2);
});

it("keeps expired readings visible while revalidating in the background", async () => {
  await mount(); unmount();
  now += BILLING_READ_TTL_MS + 1;
  const pending = deferred<DesktopBillingSummary>();
  api.getCloudBillingSummary.mockReturnValue(pending.promise);
  observed = [];
  await mount();
  expect(observed[0]?.summary?.source_revision).toBe(1);
  expect(latest.loading).toBe(true);
  await act(async () => pending.resolve(summary("personal", 2)));
  expect(latest.summary?.source_revision).toBe(2);
  expect(latest.loading).toBe(false);
  expect(api.getCloudBillingSummary).toHaveBeenCalledTimes(2);
});

it("does not carry one space's usage into a newly selected space", async () => {
  await mount();
  const pending = deferred<DesktopBillingSummary>();
  api.getCloudBillingSummary.mockReturnValue(pending.promise);
  observed = [];
  await mount(<Probe organizationId="team" />);
  expect(observed[0]?.organizationId).toBe("team");
  expect(observed[0]?.summary).toBeNull();
  expect(latest.loading).toBe(true);
  await act(async () => pending.resolve(summary("team")));
  expect(latest.summary?.org_id).toBe("team");
  expect(latest.usage?.runtime.org_id).toBe("team");
  // Returning to the first space is immediate.
  observed = [];
  await mount(<Probe organizationId="personal" />);
  expect(observed[0]?.summary?.org_id).toBe("personal");
  expect(api.getCloudBillingSummary).toHaveBeenCalledTimes(2);
});

it("isolates new accounts and login generations before effects run", async () => {
  await mount();
  const pending = deferred<DesktopBillingSummary>();
  api.getCloudBillingSummary.mockReturnValue(pending.promise);
  observed = [];
  await mount(<Probe activeSession={{ ...session, session_generation: "generation-b" }} />);
  expect(observed[0]?.summary).toBeNull();
  expect(observed[0]?.loading).toBe(true);
  await act(async () => pending.resolve(summary()));
  observed = [];
  await mount(<Probe activeSession={null} />);
  expect(observed[0]?.summary).toBeNull();
});

it("ignores a late response for a previous space", async () => {
  const pending = deferred<DesktopBillingSummary>();
  api.getCloudBillingSummary.mockImplementation(async (_session, org: string) => org === "personal" ? pending.promise : summary(org));
  await mount();
  await mount(<Probe organizationId="team" />);
  expect(latest.summary?.org_id).toBe("team");
  await act(async () => pending.resolve(summary("personal")));
  expect(latest.summary?.org_id).toBe("team");
});

it("preserves the last successful readings after a failed refresh", async () => {
  await mount();
  for (const read of Object.values(api)) read.mockRejectedValue(new Error("offline"));
  await act(async () => latest.refresh());
  expect(latest.summary?.plan_id).toBe("personal");
  expect(latest.usage?.storage.logical_bytes).toBe(123);
  expect(latest.error).toBe(true);
  expect(latest.loading).toBe(false);
});

it("reports an unknown plan after an initial failure, and allows a forced retry", async () => {
  api.getCloudBillingSummary.mockRejectedValueOnce(new Error("offline"));
  await mount();
  expect(latest.error).toBe(true);
  expect(latest.loading).toBe(false);
  expect(latest.summary).toBeNull();
  await act(async () => latest.refresh());
  expect(latest.summary?.plan_id).toBe("personal");
  expect(latest.error).toBe(false);
});

it("ends a stalled read, starts a new request on retry, and ignores the late old response", async () => {
  vi.useFakeTimers();
  const stalled = deferred<DesktopBillingSummary>();
  api.getCloudBillingSummary.mockReturnValueOnce(stalled.promise);
  await mount();
  expect(latest.loading).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(BILLING_READ_TIMEOUT_MS));
  expect(latest.loading).toBe(false);
  expect(latest.error).toBe(true);
  expect(cloudCache.snapshot().requests).toBe(0);
  api.getCloudBillingSummary.mockResolvedValue(summary("personal", 2));
  await act(async () => latest.refresh());
  expect(api.getCloudBillingSummary).toHaveBeenCalledTimes(2);
  expect(latest.summary?.source_revision).toBe(2);
  expect(latest.error).toBe(false);
  await act(async () => stalled.resolve(summary("personal", 1)));
  unmount(); observed = [];
  await mount();
  expect(observed[0]?.summary?.source_revision).toBe(2);
});

it("forces fresh readings when Refresh is pressed inside the cache freshness window", async () => {
  await mount();
  api.getCloudBillingSummary.mockResolvedValue(summary("personal", 2));
  await act(async () => latest.refresh());
  expect(latest.summary?.source_revision).toBe(2);
  for (const [name, read] of Object.entries(api)) {
    expect(read).toHaveBeenCalledTimes(name === "listCloudOrganizations" ? 0 : 2);
  }
});

it("does not let a cache notification downgrade a manual Refresh in the same turn", async () => {
  await mount();
  api.getCloudBillingSummary.mockResolvedValue(summary("personal", 2));
  await act(async () => { latest.refresh(true); latest.refresh(false); });
  expect(latest.summary?.source_revision).toBe(2);
  expect(api.getCloudBillingSummary).toHaveBeenCalledTimes(2);
});

it("retries failed usage without depending on operation history", async () => {
  api.getCloudBillingCatalog.mockResolvedValue(fixtureCatalog);
  api.getCloudBillingUsage.mockRejectedValueOnce(new Error("offline"));
  await mount(withTestLocalization(<PlanPageProbe />));
  expect(host.querySelector('.is-hours[role="progressbar"]')).toBeNull();
  const fresh = fixtureUsage("personal");
  fresh.runtime.allowance = { granted_units: 2400, consumed_units: 600, reserved_units: 0, unit_seconds: 60, resets_at: null };
  fresh.storage.logical_bytes = 3 * 1000 ** 3;
  fresh.storage.limit_bytes = 10 * 1000 ** 3;
  api.getCloudBillingUsage.mockResolvedValue(fresh);
  operationsRead.mockRejectedValue(new Error("history unavailable"));
  const refresh = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Retry");
  expect(refresh).toBeTruthy();
  await act(async () => refresh!.click());
  expect(host.querySelector('.is-hours[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("25");
  expect(host.querySelector('.is-storage[role="progressbar"]')).toBeNull();
  expect(host.querySelector('.desktop-plan-storage-body')?.textContent).toContain("3 GB / 10 GB");
  expect(api.getCloudBillingSummary).toHaveBeenCalledTimes(2);
  expect(api.getCloudBillingUsage).toHaveBeenCalledTimes(2);
});

it("shows the real plan and balance when the service disables only its sales catalog", async () => {
  api.getCloudBillingCatalog.mockRejectedValue(Object.assign(new Error("Hosting subscriptions are not available"), {
    status: 404, code: "hosting_billing_disabled",
  }));
  api.getCloudBillingSummary.mockResolvedValue({ ...summary(), plan_id: "free", status: "free" });
  api.getCloudBillingUsage.mockResolvedValue(fixtureUsage("personal"));
  await mount();
  expect(latest.summary?.plan_id).toBe("free");
  expect(latest.catalogUnavailable).toBe(true);
  expect(latest.error).toBe(false);
  unmount();
  await mount(withTestLocalization(<PlanPageProbe />));
  expect(host.querySelector('.desktop-plan-summary h4')?.textContent).toBe("Free");
  expect(host.textContent).not.toContain("Available now");
  expect(host.textContent).not.toContain("Plan changes are currently unavailable.");
  expect([...host.querySelectorAll('button')].some(button => button.textContent === "Refresh")).toBe(false);
  expect(host.textContent).not.toContain("Billing details unavailable");
  expect(host.querySelector('.desktop-plan-meter.is-storage')).toBeNull();
  expect(host.querySelectorAll('.desktop-plan-card')).toHaveLength(3);
  expect([...host.querySelectorAll<HTMLButtonElement>('.desktop-plan-card button')].every(button => button.disabled)).toBe(true);
  expect(host.querySelector('.desktop-plan-storage-body')?.textContent).toContain("Your storage");
  api.getCloudBillingSummary.mockResolvedValue({ ...summary(), plan_id: "personal", status: "active" });
  await mount();
  await act(async () => latest.refresh());
  unmount();
  await mount(withTestLocalization(<PlanPageProbe />));
  expect(host.querySelector('.desktop-plan-summary h4')?.textContent).toBe("Team");
  expect(host.querySelector('.desktop-plan-summary')?.textContent).not.toContain("$20");
});

it("shows a readable price catalog and balance without enabling non-purchasable offers", async () => {
  const base = fixtureCatalog.plans[0]!;
  api.getCloudBillingCatalog.mockResolvedValue({ ...fixtureCatalog, plans: [
    { ...base, id: "free", price_per_seat_cents: 0, purchasable: false },
    { ...base, id: "team_v2", price_per_seat_cents: 2000, purchasable: false },
    { ...base, id: "enterprise_v2", price_per_seat_cents: 4000, purchasable: false },
  ] });
  api.getCloudBillingSummary.mockResolvedValue({ ...summary(), plan_id: "free", status: "free" });
  api.getCloudBillingUsage.mockResolvedValue(fixtureUsage("personal"));
  await mount(withTestLocalization(<PlanPageProbe />));
  expect(host.querySelector('.desktop-plan-summary h4')?.textContent).toBe("Free");
  expect(host.querySelectorAll('.desktop-plan-card')).toHaveLength(3);
  expect(host.textContent).toContain("$20");
  expect(host.textContent).toContain("$40");
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('.desktop-plan-card button')];
  expect(buttons.length).toBeGreaterThan(0);
  expect(buttons.every(button => button.disabled)).toBe(true);
  expect(host.textContent).not.toContain("Billing details unavailable");
});

it("keeps an unavailable catalog distinct from an unknown current holding", async () => {
  const disabled = Object.assign(new Error("Billing is not enabled"), { status: 404 });
  api.getCloudBillingCatalog.mockRejectedValue(disabled);
  api.getCloudBillingSummary.mockRejectedValue(disabled);
  await mount();
  expect(latest.summary).toBeNull();
  expect(latest.error).toBe(true);
  expect(latest.catalogUnavailable).toBe(true);
  unmount();
  await mount(withTestLocalization(<PlanPageProbe />));
  expect(host.textContent).toContain("Billing details unavailable");
  expect(host.querySelector('.desktop-plan-summary')).toBeNull();
  expect(host.querySelectorAll('.desktop-plan-card')).toHaveLength(3);
  expect(host.querySelector('.desktop-plan-card[aria-current="true"]')).toBeNull();
});

it("invalidates snapshots after a billing mutation and never caches a mismatched space", async () => {
  await mount(); unmount();
  invalidateCloudCacheForMutation({ session, apiPath: "/billing/organizations/personal/checkout" });
  api.getCloudBillingSummary.mockResolvedValue(summary("another-space"));
  await mount();
  expect(latest.summary).toBeNull();
  expect(latest.error).toBe(true);
  expect(api.getCloudBillingSummary).toHaveBeenCalledTimes(2);
});

it("makes no requests when payments are disabled", async () => {
  await mount(<Probe enabled={false} />);
  for (const read of Object.values(api)) expect(read).not.toHaveBeenCalled();
  expect(latest.loading).toBe(false);
});
