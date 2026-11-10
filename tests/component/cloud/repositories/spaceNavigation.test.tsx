/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopWindowChrome } from "../../../../src/components/DesktopWindowChrome";
import { WindowNavigationProvider, type WindowNavigation } from "../../../../src/components/WindowNavigation";
import { OnboardingHeaderBrand } from "../../../../src/components/onboarding/OnboardingBrandLockup";
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
function navigation(overrides: Partial<WindowNavigation> = {}): WindowNavigation {
  return { account: { session, apiBaseUrl: "https://cloud.fixture", onOpenAccount: account }, spaces, ...overrides };
}
async function render(id: string | null = "a", inRail = false) {
  await act(async () => root.render(withTestLocalization(<WindowNavigationProvider value={navigation()}>
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
const places = () => [...document.querySelectorAll<HTMLElement>("[data-window-place]")].map(row => row.dataset.windowPlace);
const accountRows = () => [...document.querySelectorAll<HTMLElement>("[data-account-row]")].map(row => row.textContent);

it("keeps the account out of the Header's trailing end and omits global Space switching", async () => {
  await render("a", true);
  expect(document.querySelector(".homepage-cloud-avatar")).toBeNull();
  expect(document.querySelector(".desktop-titlebar-actions")).toBeNull();
  expect(document.querySelector(".desktop-space-trigger")).toBeNull();
});

it("offers Home, every place and then the account from the Header's place menu", async () => {
  const home = vi.fn(); const show = vi.fn(); const dismiss = vi.fn(); const createSpace = vi.fn(); const signOut = vi.fn();
  const menu = resolveProjectPlaceMenu({ place: "cloud", address: cloudProjectAddress("Studio"), space: spaces[0] });
  await act(async () => root.render(withTestLocalization(<WindowNavigationProvider value={navigation({ onShowPlace: show,
    account: { session, apiBaseUrl: "https://cloud.fixture", onOpenAccount: account, onOpenSettings: vi.fn(), onCreateSpace: createSpace, onSignOut: signOut } })}>
    <ProjectPlaceRows menu={menu} handlers={{ onOpenLocalFolder: vi.fn() }} onHome={home} onDismiss={dismiss} />
  </WindowNavigationProvider>)));
  expect(places()).toEqual(["home", "local", "a", "b"]);
  expect(document.querySelector('[data-window-place="a"]')?.getAttribute("aria-current")).toBe("true");
  expect(document.querySelector('[data-window-place="b"]')?.hasAttribute("aria-current")).toBe(false);
  expect(document.querySelector("[data-window-place]")?.getAttribute("role")).toBe("button");
  expect(document.querySelector(".desktop-project-place-rows")?.textContent).toContain(session.user_email);
  expect(accountRows()).toEqual(["Account", "Settings", "Create space", "Sign out"]);

  await click('[data-window-place="home"]');
  expect(home).toHaveBeenCalledOnce(); expect(show).not.toHaveBeenCalled();
  await click('[data-window-place="b"]');
  expect(show).toHaveBeenCalledWith("b");
  await click('[data-account-row="create-space"]');
  await click('[data-account-row="sign-out"]');
  expect(createSpace).toHaveBeenCalledOnce(); expect(signOut).toHaveBeenCalledOnce();
  expect(dismiss).toHaveBeenCalledTimes(4);
});

it("marks this computer among the places of a local project", async () => {
  await act(async () => root.render(withTestLocalization(<WindowNavigationProvider value={navigation({ onShowPlace: vi.fn() })}>
    <ProjectPlaceRows menu={resolveProjectPlaceMenu({ place: "local" })} handlers={{ onOpenLocalFolder: vi.fn() }} onDismiss={vi.fn()} />
  </WindowNavigationProvider>)));
  expect(places()).toEqual(["local", "a", "b"]);
  expect(document.querySelector('[data-window-place="local"]')?.getAttribute("aria-current")).toBe("true");
});

it("asks to sign in from the place menu and the Header's trailing end while signed out", async () => {
  const signedOut = navigation({ account: { session: null, apiBaseUrl: "https://cloud.fixture", onOpenAccount: account },
    spaces: [], trailing: <button type="button" className="desktop-titlebar-action homepage-cloud-sign-in">Sign in</button> });
  await act(async () => root.render(withTestLocalization(<WindowNavigationProvider value={signedOut}>
    <DesktopWindowChrome />
    <ProjectPlaceRows menu={resolveProjectPlaceMenu({ place: "local" })} handlers={{ onOpenLocalFolder: vi.fn() }} onDismiss={vi.fn()} />
  </WindowNavigationProvider>)));
  expect(document.querySelector(".desktop-titlebar-actions .homepage-cloud-sign-in")).not.toBeNull();
  expect(accountRows()).toEqual(["Sign in"]);
});

it("opens the places and the account from the Homepage's brand, without a way to the page it is on", async () => {
  const show = vi.fn();
  await act(async () => root.render(withTestLocalization(<WindowNavigationProvider value={navigation({ onShowPlace: show })}>
    <OnboardingHeaderBrand />
  </WindowNavigationProvider>)));
  await click(".onboarding-header-brand");
  expect(places()).toEqual(["local", "a", "b"]);
  expect(accountRows()).toEqual(["Account"]);
  await click('[data-window-place="local"]');
  expect(show).toHaveBeenCalledWith("local");
  expect(document.querySelector("[data-window-place]")).toBeNull();
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
