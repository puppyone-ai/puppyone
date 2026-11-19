/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCloudOrganizations, type DesktopCloudOrganization, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import {
  resetCloudOrganizationNamesForTests,
  useCloudOrganizationName,
} from "../../../../src/features/cloud/workbench/useCloudOrganizationName";
import { clearCachedCatalog } from "../../../../src/features/cloud/workbench/homepageCloudCatalogCache";

vi.mock("../../../../src/lib/cloudApi", async (original) => ({
  ...await original<typeof import("../../../../src/lib/cloudApi")>(), listCloudOrganizations: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session = (user = "one"): DesktopCloudSession => ({ api_base_url: API, user_id: user, user_email: `${user}@example.com`,
  session_generation: "one", expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" });
const organization = (id: string, name: string) => ({ id, name, slug: id, plan: "free", seat_limit: 1,
  created_at: "2026-01-01T00:00:00Z" }) satisfies DesktopCloudOrganization;

let root: Root;
let container: HTMLDivElement;
function Probe(props: Parameters<typeof useCloudOrganizationName>[0]) {
  return <output>{useCloudOrganizationName(props) ?? "(none)"}</output>;
}
async function render(organizationId: string | null, user = "one") {
  await act(async () => root.render(<Probe session={session(user)} apiBaseUrl={API} organizationId={organizationId} />));
}
const shown = () => container.textContent;

beforeEach(() => {
  localStorage.clear(); resetCloudOrganizationNamesForTests();
  vi.mocked(listCloudOrganizations).mockReset().mockResolvedValue([organization("org-a", "Acme"), organization("org-b", "Beta")]);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); });

describe("the organization that holds an open Cloud project", () => {
  it("is asked for only while a Cloud project is open, and once per account in a launch", async () => {
    await render(null);
    expect(listCloudOrganizations).not.toHaveBeenCalled();
    expect(shown()).toBe("(none)");

    await render("org-a");
    expect(shown()).toBe("Acme");
    await render("org-b");
    expect(shown()).toBe("Beta");
    expect(listCloudOrganizations).toHaveBeenCalledOnce();
    expect(vi.mocked(listCloudOrganizations).mock.calls[0]?.[2]).toBe(API);

    // An organization the account does not list leaves the Header naming the Cloud.
    await render("org-unknown");
    expect(shown()).toBe("(none)");
  });

  it("names the place from the first frame with the last launch's answer, and forgets it on sign-out", async () => {
    await render("org-a");
    act(() => root.unmount());
    resetCloudOrganizationNamesForTests();
    let answer!: (organizations: DesktopCloudOrganization[]) => void;
    vi.mocked(listCloudOrganizations).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    root = createRoot(container);
    await render("org-a");
    expect(shown()).toBe("Acme");
    await act(async () => answer([organization("org-a", "Acme Labs")]));
    expect(shown()).toBe("Acme Labs");

    clearCachedCatalog();
    resetCloudOrganizationNamesForTests();
    vi.mocked(listCloudOrganizations).mockReturnValueOnce(new Promise(() => {}));
    act(() => root.unmount());
    root = createRoot(container);
    await render("org-a");
    expect(shown()).toBe("(none)");
  });

  it("asks again on the next open after an unanswered request, and keeps accounts apart", async () => {
    vi.mocked(listCloudOrganizations).mockRejectedValueOnce(new Error("offline"));
    await render("org-a");
    expect(shown()).toBe("(none)");
    await render("org-b");
    expect(shown()).toBe("Beta");
    expect(listCloudOrganizations).toHaveBeenCalledTimes(2);

    vi.mocked(listCloudOrganizations).mockResolvedValueOnce([organization("org-a", "Another account's Acme")]);
    await render("org-a", "two");
    expect(shown()).toBe("Another account's Acme");
  });
});
