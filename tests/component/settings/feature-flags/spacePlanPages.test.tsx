/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SeatsSettingsView } from "../../../../src/features/settings/main/SeatsSettingsView";
import { SpaceSettingsView } from "../../../../src/features/settings/main/SpaceSettingsView";
import { AccountSettingsView } from "../../../../src/features/settings/main/AccountSettingsView";
import { cloudCache } from "../../../../src/features/cloud/cache/cloudCache";
import { initializeDesktopPreferences, desktopPreferencesStore } from "../../../../src/preferencesStore";
import * as api from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";
import { session, catalog, summary, usage } from "../../../fixtures/platform/ui-copy/billing";

vi.mock("../../../../src/lib/cloudApi", async () => ({
  ...await vi.importActual<typeof import("../../../../src/lib/cloudApi")>("../../../../src/lib/cloudApi"),
  getCloudBillingCatalog: vi.fn(), getCloudBillingSummary: vi.fn(), getCloudBillingUsage: vi.fn(),
  getCloudOrganizationAccess: vi.fn(), listCloudOrganizationMembers: vi.fn(), listCloudBillingOperations: vi.fn(),
}));
vi.mock("../../../../src/features/settings/main/AccountAICredits", () => ({ AccountAICredits: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const props = { cloudSession: session, cloudApiBaseUrl: session.api_base_url,
  onCloudSessionChange: vi.fn(), onSignIn: vi.fn() };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks(); cloudCache.clear(); localStorage.clear(); initializeDesktopPreferences();
  vi.mocked(api.getCloudBillingCatalog).mockResolvedValue(catalog);
  vi.mocked(api.getCloudBillingSummary).mockImplementation(async (_session, id) => summary(id));
  vi.mocked(api.getCloudBillingUsage).mockImplementation(async (_session, id) => usage(id));
  vi.mocked(api.getCloudOrganizationAccess).mockImplementation(async (_session, id) => ({
    org_id: id, user_id: session.user_id, role: "owner", can_manage_billing: true,
  }));
  vi.mocked(api.listCloudOrganizationMembers).mockResolvedValue([
    { id: "membership", user_id: session.user_id, role: "owner", display_name: "Owner", joined_at: "2026-11-10T00:00:00Z" },
  ]);
  vi.mocked(api.listCloudBillingOperations).mockResolvedValue([]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); cloudCache.clear(); localStorage.clear(); });
async function render(node: ReactNode) { await act(async () => root.render(withTestLocalization(node))); }

it("restores Plan without member forms and retains the current Space's usage and Refresh", async () => {
  vi.mocked(api.listCloudBillingOperations).mockRejectedValueOnce(new Error("History unavailable"));
  await render(<SeatsSettingsView {...props} organizationId="a" spaceName="Studio" />);
  expect(host.querySelector("h2")?.textContent).toBe("Plan");
  expect(host.textContent).toContain("Studio");
  expect(host.querySelector(".desktop-plan-grid")).not.toBeNull();
  expect(host.querySelector(".desktop-space-member-form")).toBeNull();
  expect(api.listCloudOrganizationMembers).not.toHaveBeenCalled();
  const refresh = [...host.querySelectorAll("button")].find(button => button.textContent === "Refresh")!;
  expect(refresh).toBeDefined();
  await act(async () => refresh.click());
  expect(api.getCloudBillingSummary).toHaveBeenCalledTimes(2);
  expect(api.getCloudBillingUsage).toHaveBeenLastCalledWith(session, "a", expect.any(Function), session.api_base_url, expect.any(AbortSignal));

  await render(<SeatsSettingsView {...props} organizationId="b" spaceName="Research" />);
  expect(host.textContent).toContain("Research");
  expect(host.textContent).not.toContain("Studio");
  expect(api.getCloudBillingSummary).toHaveBeenLastCalledWith(session, "b", expect.any(Function), session.api_base_url, expect.any(AbortSignal));
});

it("keeps Space settings available with payments off and makes no billing reads", async () => {
  desktopPreferencesStore.getState().setExperimentalSettings(value => ({ ...value, enablePayments: false }));
  await render(<SpaceSettingsView {...props} organizationId="a" spaceName="Studio" focusInvite />);
  expect(document.activeElement?.getAttribute("type")).toBe("email");
  expect(host.textContent).toContain("Members & settings");
  expect(host.querySelector(".desktop-space-member-form")).not.toBeNull();
  expect(host.querySelector(".desktop-plan-grid")).toBeNull();
  expect(api.listCloudOrganizationMembers).toHaveBeenCalledWith(session, "a", props.onCloudSessionChange, session.api_base_url);
  expect(api.getCloudBillingSummary).not.toHaveBeenCalled();
  expect(api.getCloudBillingCatalog).not.toHaveBeenCalled();
});

it("shows plan comparison in local mode without reading or charging another Space", async () => {
  await render(<SeatsSettingsView {...props} organizationId={null} />);
  expect(host.querySelector("h2")?.textContent).toBe("Plan");
  expect(host.textContent).toContain("Choose a space in the navigation");
  expect(host.querySelectorAll(".desktop-plan-card")).toHaveLength(3);
  expect(host.querySelector(".desktop-plan-loading")).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector(".desktop-plan-card button")).toBeNull();
  expect(api.getCloudBillingSummary).not.toHaveBeenCalled();
});

it("keeps sign-in and the payment opt-out behavior on the restored Plan page", async () => {
  await render(<SeatsSettingsView {...props} cloudSession={null} organizationId={null} />);
  const signIn = [...host.querySelectorAll("button")].find(button => button.textContent === "Sign in to choose")!;
  await act(async () => signIn.click());
  expect(props.onSignIn).toHaveBeenCalledOnce();
  await act(async () => desktopPreferencesStore.getState().setExperimentalSettings(value => ({ ...value, enablePayments: false })));
  expect(host.textContent).toBe("");
  expect(api.getCloudBillingSummary).not.toHaveBeenCalled();
});

it("restores the Account plan reading and shortcut while following the current Space", async () => {
  const onOpenBilling = vi.fn();
  await render(<AccountSettingsView {...props} cloudSessionRestoring={false} cloudEnabled
    organizationId="a" spaceName="Studio" onOpenBilling={onOpenBilling} />);
  expect(host.textContent).toContain("Studio ·");
  const open = [...host.querySelectorAll("button")].find(button => button.textContent === "Billing")!;
  expect(open).toBeDefined();
  await act(async () => open.click());
  expect(onOpenBilling).toHaveBeenCalledOnce();
  await render(<AccountSettingsView {...props} cloudSessionRestoring={false} cloudEnabled
    organizationId="b" spaceName="Research" onOpenBilling={onOpenBilling} />);
  expect(host.textContent).not.toContain("Studio");
  expect(host.textContent).toContain("Research ·");
  expect(api.getCloudBillingSummary).toHaveBeenLastCalledWith(session, "b", expect.any(Function), session.api_base_url, expect.any(AbortSignal));
  expect(host.querySelector(".desktop-plan-grid")).toBeNull();
  await render(<AccountSettingsView {...props} cloudSessionRestoring={false} cloudEnabled
    organizationId={null} onOpenBilling={onOpenBilling} />);
  expect(host.textContent).not.toContain("Research");
  expect(host.querySelector(".desktop-settings-row")).toBeNull();
  await act(async () => desktopPreferencesStore.getState().setExperimentalSettings(value => ({ ...value, enablePayments: false })));
  await render(<AccountSettingsView {...props} cloudSessionRestoring={false} cloudEnabled
    organizationId="a" spaceName="Studio" onOpenBilling={onOpenBilling} />);
  expect(host.textContent).not.toContain("Studio");
  expect(api.getCloudBillingSummary).toHaveBeenCalledTimes(2);
});
