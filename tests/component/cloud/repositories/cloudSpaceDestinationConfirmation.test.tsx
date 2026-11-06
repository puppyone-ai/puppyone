/** @vitest-environment happy-dom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CloudInitializationRoute } from "../../../../src/features/cloud/initialization/CloudInitializationRoute";
import { withTestLocalization } from "../../../support/react/localization";
const organizationData = vi.hoisted(() => ({ organizations: [
  { id: "personal", name: "Alex", can_create_projects: true }, { id: "team", name: "Design", can_create_projects: true },
], selectedOrganizationId: "personal", status: "selection-required", error: null, selectOrganization: vi.fn(), refresh: vi.fn() }));
vi.mock("../../../../src/features/cloud/organization/CloudOrganizationTeamPage", () => ({ useCloudOrganizationData: () => organizationData }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const publish = vi.fn();
const props = {
  workspace: { id: "folder", name: "Draft", path: "/fixture/draft", status: "recording" },
  status: { isRepo: true, branch: "main", totalCommits: 1, headCommitId: "a".repeat(40), entries: [] },
  session: { user_id: "owner" }, apiBaseUrl: "https://fixture.puppyone.ai/api/v1", accountEmail: "owner@example.test",
  activeSection: "initialize", loading: false, error: null, cloudActionNotice: null,
  cloudBackupLoading: false, cloudBackupPending: false, cloudPublishError: null, cloudPublishNotice: null,
  cloudPublishState: null, cloudPublishStateLoading: false, onSessionChange: vi.fn(), onAbandonPublish: vi.fn(),
  onRefresh: vi.fn(), onPublishWorkspace: publish, publishOrganizationId: "team",
} as unknown as ComponentProps<typeof CloudInitializationRoute>;
beforeEach(() => { publish.mockReset(); const host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });
async function render(overrides: Partial<typeof props> = {}) { await act(async () => root.render(withTestLocalization(<CloudInitializationRoute {...props} {...overrides} />))); }
async function click(selector: string) { await act(async () => document.querySelector<HTMLButtonElement>(selector)!.click()); }
it("uses the drop destination, discloses Git scope and confirms before publication", async () => {
  await render();
  expect(document.querySelector('[data-cloud-publish-destination="team"]')?.textContent).toContain("Design");
  expect(publish).not.toHaveBeenCalled();
  await click('[data-cloud-publish-action="true"]');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Uncommitted changes stay on this computer");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Design");
  await click('.desktop-cloud-publish-confirmation .desktop-dialog-button.primary');
  expect(publish).toHaveBeenCalledExactlyOnceWith("team");
});
it("cancelling confirmation has no publication side effect", async () => {
  await render(); await click('[data-cloud-publish-action="true"]');
  await click('.desktop-cloud-publish-confirmation .desktop-dialog-button:not(.primary)');
  expect(publish).not.toHaveBeenCalled();
});
it("a missing target cannot fall back to the account's default space", async () => {
  await render({ publishOrganizationId: "revoked" });
  expect(document.querySelector<HTMLButtonElement>('[data-cloud-publish-action="true"]')?.disabled).toBe(true);
  expect(publish).not.toHaveBeenCalled();
});
it("a pending sign-in flow cannot auto-start a targeted drag", async () => {
  await render({ cloudBackupPending: true });
  expect(publish).not.toHaveBeenCalled();
});
