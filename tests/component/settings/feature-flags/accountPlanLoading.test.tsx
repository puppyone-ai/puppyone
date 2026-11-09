/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopBillingSummary, DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { cloudCache, invalidateCloudCacheForMutation } from "../../../../src/features/cloud/cache/cloudCache";
import { BILLING_READ_TTL_MS } from "../../../../src/features/cloud/billing/billingReadCache";
import { useAccountPlan } from "../../../../src/features/settings/main/useAccountPlan";

const api = vi.hoisted(() => ({
  getCloudBillingCatalog: vi.fn(), listCloudOrganizations: vi.fn(),
  getCloudBillingSummary: vi.fn(), getCloudBillingUsage: vi.fn(), getCloudOrganizationAccess: vi.fn(),
}));
vi.mock("../../../../src/lib/cloudApi", async () => ({
  ...await vi.importActual<typeof import("../../../../src/lib/cloudApi")>("../../../../src/lib/cloudApi"), ...api,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  user_id: "user-a", session_generation: "generation-a", api_base_url: "https://cloud.example/api/v1",
  user_email: "a@example.com", status: "authenticated", expires_in: 3600, expires_at: 0,
} satisfies DesktopCloudSession;
const organizations = [
  { id: "personal", name: "Personal space", kind: "personal" },
  { id: "team", name: "Research", kind: "team" },
];
const summary = (org = "personal", revision = 1) => ({ org_id: org, plan_id: "personal", source_revision: revision }) as DesktopBillingSummary;
const usage = (org: string) => ({ runtime: { org_id: org }, storage: { logical_bytes: 123 } });
let latest: ReturnType<typeof useAccountPlan>;
let observed: Array<ReturnType<typeof useAccountPlan>>;
let root: Root | null;
let host: HTMLDivElement;
let now: number;

function Probe({ activeSession = session, enabled = true }: { activeSession?: DesktopCloudSession | null; enabled?: boolean }) {
  latest = useAccountPlan({ session: activeSession, apiBaseUrl: activeSession?.api_base_url ?? null, enabled, onSessionChange: () => undefined });
  observed.push(latest);
  return <div data-plan={latest.summary?.plan_id ?? "unknown"} data-loading={latest.loading} />;
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
  host = document.createElement("div"); document.body.append(host);
  root = null;
});
afterEach(() => { unmount(); document.body.replaceChildren(); vi.restoreAllMocks(); cloudCache.clear(); });

it("starts loading on the first render and publishes one complete snapshot after slow reads", async () => {
  const pending = deferred<DesktopBillingSummary>();
  api.getCloudBillingSummary.mockReturnValue(pending.promise);
  await mount();
  expect(observed[0]?.loading).toBe(true);
  expect(latest.summary).toBeNull();
  expect(latest.organizations).toEqual([]);
  await act(async () => pending.resolve(summary()));
  expect(latest.loading).toBe(false);
  expect(latest.summary?.plan_id).toBe("personal");
  expect(latest.organizations).toHaveLength(2);
});

it("paints a cached reading synchronously on return without repeating fresh reads", async () => {
  await mount(); unmount(); observed = [];
  await mount();
  expect(observed[0]?.summary?.plan_id).toBe("personal");
  expect(api.getCloudBillingCatalog).toHaveBeenCalledTimes(1);
  expect(api.listCloudOrganizations).toHaveBeenCalledTimes(1);
  expect(api.getCloudBillingSummary).toHaveBeenCalledTimes(1);
  expect(api.getCloudBillingUsage).toHaveBeenCalledTimes(1);
});

it("coalesces Strict Mode and simultaneous Account/Plan readers", async () => {
  await mount(<React.StrictMode><Probe /><Probe /></React.StrictMode>);
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
});

it("does not restart reads when only the session object is recreated", async () => {
  await mount();
  await mount(<Probe activeSession={{ ...session, expires_at: 9999, status: "refreshing" }} />);
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
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
  await act(async () => latest.selectOrganization("team"));
  expect(observed[0]?.organizationId).toBe("team");
  expect(observed[0]?.summary).toBeNull();
  expect(latest.loading).toBe(true);
  await act(async () => pending.resolve(summary("team")));
  expect(latest.summary?.org_id).toBe("team");
  expect(latest.usage?.runtime.org_id).toBe("team");
  // Returning to the first space is immediate.
  observed = [];
  await act(async () => latest.selectOrganization("personal"));
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
  expect(latest.organizations).toEqual([]);
});

it("ignores a late response for a previous space", async () => {
  const pending = deferred<DesktopBillingSummary>();
  api.getCloudBillingSummary.mockImplementation(async (_session, org: string) => org === "personal" ? pending.promise : summary(org));
  await mount();
  await act(async () => latest.selectOrganization("team"));
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
