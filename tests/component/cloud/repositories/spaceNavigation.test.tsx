/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopWindowChrome } from "../../../../src/components/DesktopWindowChrome";
import { WindowAccountProvider } from "../../../../src/components/WindowAccount";
import { CloudAccountButton } from "../../../../src/features/cloud/workbench/CloudAccountButton";
import { ProjectSwitcherRail } from "../../../../src/features/app-shell/ProjectSwitcherRail";
import { SettingsSidebar } from "../../../../src/features/settings/sidebar/SettingsSidebar";
import { ProjectPlaceRows } from "../../../../src/features/app-shell/project-place/ProjectPlaceMenu";
import { cloudProjectAddress, resolveProjectPlaceMenu } from "../../../../src/features/app-shell/project-place/projectPlaceMenuState";
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
  await act(async () => root.render(withTestLocalization(<WindowAccountProvider value={accountControl}>
    <DesktopWindowChrome />
    {inRail && <ProjectSwitcherRail activeWorkspace={{ id: "local", path: "/fixture/local", name: "Local", status: "recording" }}
      recentWorkspaces={[]} projectItems={[]} expanded onCreateNew={vi.fn()} onSelectProject={vi.fn()} />}
    <SettingsSidebar activeSection="seats" cloudEnabled currentSpaceId={id}
      currentSpaceName={spaces.find(space => space.id === id)?.name} onSelectSection={vi.fn()} />
  </WindowAccountProvider>)));
}
async function click(selector: string) {
  const target = document.querySelector<HTMLButtonElement>(selector); expect(target).not.toBeNull();
  await act(async () => target!.click());
}
it("keeps Account accessible and omits global Space switching from Header and project rail", async () => {
  await render("a", true);
  expect(document.querySelectorAll(".homepage-cloud-avatar")).toHaveLength(1);
  expect(document.querySelector(".desktop-titlebar-actions .homepage-cloud-avatar")).not.toBeNull();
  expect(document.querySelector(".desktop-titlebar-left .homepage-cloud-avatar")).toBeNull();
  expect(document.querySelector(".desktop-space-trigger")).toBeNull();
  await click(".homepage-cloud-avatar"); expect(account).not.toHaveBeenCalled();
  expect(document.querySelector(".desktop-account-menu")?.textContent).toContain(session.user_email);
  await click(".desktop-account-menu .desktop-menu-item"); expect(account).toHaveBeenCalledOnce();
  expect(document.querySelector(".desktop-account-menu")).toBeNull();
});

it("offers Settings, a new Space and Sign out from the account menu at the trailing end of the Header", async () => {
  const settings = vi.fn(); const createSpace = vi.fn(); const signOut = vi.fn();
  await act(async () => root.render(withTestLocalization(<WindowAccountProvider value={<CloudAccountButton session={session}
    onSignIn={vi.fn()} onOpenAccount={account} onOpenSettings={settings} onCreateSpace={createSpace} onSignOut={signOut} />}>
    <DesktopWindowChrome actions={<button type="button" className="desktop-titlebar-action fixture-tool">Tool</button>} />
  </WindowAccountProvider>)));
  const actions = document.querySelector(".desktop-titlebar-actions")!;
  expect(actions.lastElementChild?.classList.contains("homepage-cloud-avatar")).toBe(true);
  const items = async () => {
    await click(".homepage-cloud-avatar");
    return [...document.querySelectorAll<HTMLButtonElement>(".desktop-account-menu .desktop-menu-item")];
  };
  const opened = await items();
  expect(opened.map(item => item.textContent)).toEqual(["Account", "Settings", "Create space", "Sign out"]);
  await act(async () => opened[2].click());
  expect(createSpace).toHaveBeenCalledOnce();
  const reopened = await items();
  await act(async () => reopened[3].click());
  expect(signOut).toHaveBeenCalledOnce(); expect(settings).not.toHaveBeenCalled();
});

it("reaches a Cloud project's Space members and plan from the Header's place menu", async () => {
  const manage = vi.fn(); const dismiss = vi.fn();
  const menu = resolveProjectPlaceMenu({ place: "cloud", address: cloudProjectAddress("Studio") });
  await act(async () => root.render(withTestLocalization(<ProjectPlaceRows menu={menu}
    handlers={{ onOpenLocalFolder: vi.fn(), onManageSpace: manage }} onDismiss={dismiss} />)));
  await click('[data-project-place-row="space"]');
  expect(manage).toHaveBeenCalledOnce(); expect(dismiss).toHaveBeenCalledOnce();
  await act(async () => root.render(withTestLocalization(<ProjectPlaceRows menu={resolveProjectPlaceMenu({ place: "local" })}
    handlers={{ onOpenLocalFolder: vi.fn(), onManageSpace: manage }} onDismiss={dismiss} />)));
  expect(document.querySelector('[data-project-place-row="space"]')).toBeNull();
});

it("keeps Account and Plan flat and labels the management group with the current Space", async () => {
  await render();
  const sidebar = document.querySelector(".desktop-settings-sidebar")!;
  expect(sidebar.textContent).toContain("Studio");
  expect(sidebar.textContent).toContain("Members");
  expect([...sidebar.querySelectorAll("button")].filter(button => button.textContent === "Plan")).toHaveLength(1);
  await render(null);
  expect(sidebar.textContent).not.toContain("Members");
  expect(sidebar.textContent).toContain("Plan");
});

it("heads the Space group with the square and plan the Header and Homepage show", async () => {
  const studio = { ...spaces[0], planId: "team_v2" };
  await act(async () => root.render(withTestLocalization(<SettingsSidebar activeSection="space" cloudEnabled
    currentSpace={studio} currentSpaceId="a" currentSpaceName="Studio" onSelectSection={vi.fn()} />)));
  const heading = document.querySelector(".desktop-settings-space-heading")!;
  expect(heading.querySelector(".po-space-mark")?.textContent).toBe("S");
  expect(heading.querySelector("bdi")?.textContent).toBe("Studio");
  expect(heading.querySelector(".po-space-plan")?.textContent).toBe("Team");
});
