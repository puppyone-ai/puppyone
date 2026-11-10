/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopWindowChrome } from "../../../../src/components/DesktopWindowChrome";
import { WindowNavigationProvider } from "../../../../src/components/WindowNavigation";
import { CloudAccountButton } from "../../../../src/features/cloud/workbench/CloudAccountButton";
import { ProjectSwitcherRail } from "../../../../src/features/app-shell/ProjectSwitcherRail";
import { SettingsSidebar } from "../../../../src/features/settings/sidebar/SettingsSidebar";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import type { CloudSpace } from "../../../../src/lib/workspaceHomeModel";
import { session } from "../../../fixtures/platform/ui-copy/billing";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const spaces: CloudSpace[] = [
  { id: "a", name: "Studio", kind: "space", canManageSpace: true, canCreateProjects: true },
  { id: "b", name: "Research", kind: "space", canManageSpace: false, canCreateProjects: false },
];
const account = vi.fn();
let root: Root;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); initializeDesktopPreferences();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });
async function render(id: string | null = "a", inRail = false) {
  const accountControl = <CloudAccountButton session={session} onSignIn={vi.fn()} onOpenAccount={account} />;
  await act(async () => root.render(withTestLocalization(<WindowNavigationProvider value={accountControl}>
    <DesktopWindowChrome />
    {inRail && <ProjectSwitcherRail activeWorkspace={{ id: "local", path: "/fixture/local", name: "Local", status: "recording" }}
      recentWorkspaces={[]} projectItems={[]} expanded onCreateNew={vi.fn()} onSelectProject={vi.fn()} />}
    <SettingsSidebar activeSection="seats" cloudEnabled currentSpaceId={id}
      currentSpaceName={spaces.find(space => space.id === id)?.name} onSelectSection={vi.fn()} />
  </WindowNavigationProvider>)));
}
async function click(selector: string) {
  const target = document.querySelector<HTMLButtonElement>(selector); expect(target).not.toBeNull();
  await act(async () => target!.click());
}
it("keeps Account accessible and omits global Space switching from Header and project rail", async () => {
  await render("a", true);
  expect(document.querySelectorAll(".homepage-cloud-avatar")).toHaveLength(1);
  expect(document.querySelector(".desktop-titlebar-left .homepage-cloud-avatar")).not.toBeNull();
  expect(document.querySelector(".desktop-space-trigger")).toBeNull();
  await click(".homepage-cloud-avatar"); expect(account).toHaveBeenCalledOnce();
});

it("keeps Account and Plan flat and labels the management group with the current Space", async () => {
  await render();
  const sidebar = document.querySelector(".desktop-settings-sidebar")!;
  expect(sidebar.textContent).toContain("Studio");
  expect(sidebar.textContent).toContain("Members & settings");
  expect([...sidebar.querySelectorAll("button")].filter(button => button.textContent === "Plan")).toHaveLength(1);
  await render(null);
  expect(sidebar.textContent).not.toContain("Members & settings");
  expect(sidebar.textContent).toContain("Plan");
});
