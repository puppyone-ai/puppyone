/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAccountPlan } from "../../../../src/features/settings/main/useAccountPlan";
import { cloudCache } from "../../../../src/features/cloud/cache/cloudCache";
import * as api from "../../../../src/lib/cloudApi";

vi.mock("../../../../src/lib/cloudApi", async () => ({
  ...await vi.importActual<typeof import("../../../../src/lib/cloudApi")>("../../../../src/lib/cloudApi"),
  getCloudBillingCatalog: vi.fn(), getCloudBillingSummary: vi.fn(),
  getCloudBillingUsage: vi.fn(), getCloudOrganizationAccess: vi.fn(),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session: api.DesktopCloudSession = {
  user_id: "u1", user_email: "u1@example.test", session_generation: "1",
  api_base_url: "https://cloud.example.test/api/v1", status: "authenticated",
  expires_in: 3600, expires_at: 1_900_000_000,
};
let root: Root;
let value: ReturnType<typeof useAccountPlan>;
const changed = vi.fn();
function Harness({ id = "a", signedIn = true, enabled = true }: { id?: string | null; signedIn?: boolean; enabled?: boolean }) {
  value = useAccountPlan({ session: signedIn ? session : null, organizationId: id,
    enabled, apiBaseUrl: session.api_base_url, onSessionChange: changed });
  return null;
}
function summary(org_id: string) { return { org_id } as api.DesktopBillingSummary; }
beforeEach(() => {
  vi.resetAllMocks(); cloudCache.clear();
  vi.mocked(api.getCloudBillingCatalog).mockResolvedValue(null as never);
  vi.mocked(api.getCloudBillingSummary).mockImplementation(async (_session, id) => summary(id));
  vi.mocked(api.getCloudBillingUsage).mockResolvedValue(null as never);
  vi.mocked(api.getCloudOrganizationAccess).mockImplementation(async (_session, id) => ({ org_id: id, can_manage_billing: true }) as never);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); cloudCache.clear(); });

it("ignores a delayed old-Space bill after navigation has loaded the new Space", async () => {
  let finish!: (value: api.DesktopBillingSummary) => void;
  vi.mocked(api.getCloudBillingSummary).mockImplementation(async (_session, id) => id === "a"
    ? await new Promise<api.DesktopBillingSummary>((resolve) => { finish = resolve; }) : summary(id));
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(<Harness id="b" />));
  expect(value.summary?.org_id).toBe("b");
  await act(async () => finish(summary("a")));
  expect(value.organizationId).toBe("b"); expect(value.summary?.org_id).toBe("b");
});
it("clears money and owner authority when signed out or payments are disabled", async () => {
  await act(async () => root.render(<Harness />)); expect(value.canManageBilling).toBe(true);
  await act(async () => root.render(<Harness signedIn={false} />));
  expect(value.summary).toBeNull(); expect(value.canManageBilling).toBeNull();
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(<Harness enabled={false} />));
  expect(value.summary).toBeNull(); expect(value.loading).toBe(false);
});
it("does not choose another Space's bill when the window is in local mode", async () => {
  await act(async () => root.render(<Harness id={null} />));
  expect(api.getCloudBillingSummary).not.toHaveBeenCalled(); expect(value.summary).toBeNull();
});
it("rejects mismatched billing and authority responses", async () => {
  vi.mocked(api.getCloudBillingSummary).mockResolvedValue(summary("other"));
  vi.mocked(api.getCloudOrganizationAccess).mockResolvedValue({ org_id: "other", can_manage_billing: true } as never);
  await act(async () => root.render(<Harness />));
  expect(value.summary).toBeNull(); expect(value.canManageBilling).toBeNull();
});
