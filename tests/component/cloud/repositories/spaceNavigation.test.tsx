/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpaceSwitcher } from "../../../../src/app/SpaceSwitcher";
import { DesktopWindowChrome } from "../../../../src/components/DesktopWindowChrome";
import { SidebarSpaceNavigationProvider, useSidebarSpaceNavigation, WindowNavigationProvider } from "../../../../src/components/WindowNavigation";
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
const select = vi.fn(); const settings = vi.fn(); const invite = vi.fn(); const account = vi.fn();
let root: Root;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); initializeDesktopPreferences();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });
function SidebarHost() {
  const navigation = useSidebarSpaceNavigation();
  return <aside className="test-project-sidebar"><div className="desktop-sidebar-space-navigation">{navigation}</div></aside>;
}
async function render(id: string | null = "a", inRail = false) {
  const navigation = <SpaceSwitcher spaces={spaces} selectedId={id} session={session} apiBaseUrl={session.api_base_url}
    onSessionChange={vi.fn()} onCreated={vi.fn()} onSelect={select} onSettings={settings} onInvite={invite} />;
  const accountControl = <CloudAccountButton session={session} onSignIn={vi.fn()} onOpenAccount={account} />;
  await act(async () => root.render(withTestLocalization(<SidebarSpaceNavigationProvider value={{ content: navigation, inProjectRail: inRail }}>
    <WindowNavigationProvider value={accountControl}>
      <DesktopWindowChrome />
      <SidebarHost />
      {inRail && <ProjectSwitcherRail activeWorkspace={{ id: "local", path: "/fixture/local", name: "Local", status: "recording" }}
        recentWorkspaces={[]} projectItems={[]} expanded onCreateNew={vi.fn()} onSelectProject={vi.fn()} />}
      <SettingsSidebar activeSection="seats" cloudEnabled currentSpaceId={id}
        currentSpaceName={spaces.find(space => space.id === id)?.name} onSelectSection={vi.fn()} />
    </WindowNavigationProvider>
  </SidebarSpaceNavigationProvider>)));
}
async function click(selector: string) {
  const target = document.querySelector<HTMLButtonElement>(selector); expect(target).not.toBeNull();
  await act(async () => target!.click());
}
async function key(value: string) {
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
}

it("keeps Account in the Header and Space at the Sidebar bottom", async () => {
  await render();
  expect(document.querySelectorAll(".homepage-cloud-avatar")).toHaveLength(1);
  expect(document.querySelector(".desktop-titlebar-left .homepage-cloud-avatar")).not.toBeNull();
  expect(document.querySelector(".desktop-titlebar-trailing .homepage-cloud-avatar")).toBeNull();
  expect(document.querySelector("header .desktop-space-trigger")).toBeNull();
  expect(document.querySelector(".desktop-sidebar-space-navigation .desktop-space-trigger")).not.toBeNull();
  const initial = document.querySelector(".homepage-cloud-avatar")?.textContent;
  await click(".homepage-cloud-avatar"); expect(account).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  await render("b");
  expect(document.querySelector(".desktop-space-trigger")?.textContent).toBe("Research");
  expect(document.querySelector(".homepage-cloud-avatar")?.textContent).toBe(initial);
});

it("portals a flat Space menu, focuses the current Space and supports keyboard dismissal", async () => {
  await render(); await click(".desktop-space-trigger");
  const menu = document.querySelector(".desktop-space-menu")!;
  expect(menu.closest("header")).toBeNull();
  expect(menu.querySelectorAll('[aria-haspopup="menu"]')).toHaveLength(0);
  expect(menu.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);
  expect(document.activeElement?.getAttribute("data-space-id")).toBe("a");
  await key("ArrowDown"); expect(document.activeElement?.getAttribute("data-space-id")).toBe("b");
  await key("Home"); expect(document.activeElement?.getAttribute("data-space-id")).toBe("a");
  await key("Escape"); expect(document.querySelector(".desktop-space-menu")).toBeNull();
  expect(document.activeElement?.classList.contains("desktop-space-trigger")).toBe(true);
  await key("ArrowDown");
  expect(document.querySelector(".desktop-space-menu")).not.toBeNull();
  await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  expect(document.querySelector(".desktop-space-menu")).toBeNull();
});

it("routes switching, invitations and settings directly without selecting another context", async () => {
  await render(); await click(".desktop-space-trigger"); await click('[data-space-id="b"]');
  expect(select).toHaveBeenCalledWith("b");
  expect(document.querySelector(".desktop-space-menu")).toBeNull();
  await click(".desktop-space-trigger"); await click('[data-space-action="invite"]');
  expect(invite).toHaveBeenCalledOnce();
  await click(".desktop-space-trigger"); await click('[data-space-action="settings"]');
  expect(settings).toHaveBeenCalledOnce();
  expect(select).toHaveBeenCalledTimes(1);
  await click(".desktop-space-trigger"); await click('[data-space-action="create"]');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("keeps Account and Plan flat and labels the management group with the current Space", async () => {
  await render();
  const sidebar = document.querySelector(".desktop-settings-sidebar")!;
  expect(sidebar.textContent).toContain("Studio");
  expect(sidebar.textContent).toContain("Members & settings");
  expect([...sidebar.querySelectorAll("button")].filter(button => button.textContent === "Plan")).toHaveLength(1);
  await render(null); await click(".desktop-space-trigger");
  expect(document.querySelector('[data-space-action="settings"]')).toBeNull();
  expect(document.querySelector('[data-space-action="invite"]')).toBeNull();
  expect(sidebar.textContent).not.toContain("Members & settings");
  expect(sidebar.textContent).toContain("Plan");
  await render("b"); await click(".desktop-space-trigger");
  expect(document.querySelector<HTMLButtonElement>('[data-space-action="invite"]')?.disabled).toBe(true);
});

it("moves the single switcher into the project rail when it owns the Sidebar", async () => {
  await render("a", true);
  expect(document.querySelectorAll(".desktop-space-trigger")).toHaveLength(1);
  expect(document.querySelector(".desktop-project-switcher-rail .desktop-sidebar-space-navigation .desktop-space-trigger")).not.toBeNull();
  expect(document.querySelector(".test-project-sidebar .desktop-space-trigger")).toBeNull();
});
