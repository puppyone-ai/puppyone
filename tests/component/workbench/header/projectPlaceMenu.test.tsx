/** @vitest-environment happy-dom */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowNavigationProvider, type WindowNavigation } from "../../../../src/components/WindowNavigation";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import {
  cloudProjectAddress,
  localProjectAddress,
  resolveProjectPlaceMenu,
  type ProjectPlaceMenu,
} from "../../../../src/features/app-shell/project-place/projectPlaceMenuState";
import type { LocalFolderCloudNotice } from "../../../../src/features/cloud/project/localFolderCloudNoticeState";
import type { CloudSpace } from "../../../../src/lib/workspaceHomeModel";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { accessibleName, getByRole, queryAllByRole, queryByRole } from "../../../support/react/queries";
import { withTestLocalization } from "../../../support/react/localization";
import { session } from "../../../fixtures/platform/ui-copy/billing";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({
  useDesktopPlatformCapabilities: () => ({ platform: "macos", windowChrome: { mode: "overlay" } }),
}));

const workspace = { id: "one", name: "Workspace one", path: "/tmp/one", status: "recording" as const };
const noOp = () => {};
const projectProps = {
  open: false, refObject: createRef<HTMLDivElement>(), workspace, titlebarLabel: workspace.name,
  workspaceFolders: [], multiRootWorkspacesEnabled: false, onClose: noOp, onToggle: noOp, availableProjects: [workspace],
};
const linked: LocalFolderCloudNotice = { kind: "linked", projectId: "p1", projectName: "Vault", openable: true };
const local = (input: Partial<Parameters<typeof resolveProjectPlaceMenu>[0]> = {}) => resolveProjectPlaceMenu({ place: "local", ...input });

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); initializeDesktopPreferences();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

const spaces: CloudSpace[] = [
  { id: "mine", name: "guanqun's Workspace", kind: "space", isDefault: true, canCreateProjects: true },
  { id: "acme", name: "Acme", kind: "space", role: "owner", canCreateProjects: true, planId: "team_v2" },
];
const navigation = (overrides: Partial<WindowNavigation> = {}): WindowNavigation => ({
  account: { session, apiBaseUrl: "https://cloud.fixture", onOpenAccount: vi.fn(), onOpenSettings: vi.fn(), onCreateSpace: vi.fn() },
  spaces, onShowPlace: vi.fn(), ...overrides,
});

async function renderHeader(menu: ProjectPlaceMenu, nav: WindowNavigation | null = null, extra: Record<string, unknown> = {}) {
  await act(async () => root.render(withTestLocalization(<WindowNavigationProvider value={nav}>
    <DesktopTitlebarContext {...projectProps} {...extra} placeMenu={{ menu }} />
  </WindowNavigationProvider>)));
}
const placeButton = () => getByRole(container, "button", { name: /Places and account$/ });
const openMenu = () => act(() => placeButton().click());
const menu = () => queryByRole(document, "menu", { name: "Places and account" });
/** The menu as it reads, row by row; a rule between sections reads as "—". */
const rows = () => [...menu()!.querySelectorAll(".desktop-menu-item, .desktop-menu-separator")]
  .map((row) => row.classList.contains("desktop-menu-separator") ? "—" : row.textContent);

describe("the Header's place, and the way to every other place", () => {
  it("offers Home, the places with a new Space, then the account, and nothing about the folder", async () => {
    const nav = navigation();
    await renderHeader(local({ address: localProjectAddress("/Users/example/project/puppyone-qubits") }), nav, { onHome: noOp });
    openMenu();
    expect(rows()).toEqual(["Home", "—", "This Mac", "GPersonal", "AAcme", "Create space", "—", "Account", "Settings"]);
    expect(menu()!.textContent).not.toMatch(/Who can open it|~\/project|Sign out/);
    expect(menu()!.textContent).not.toContain(session.user_email);
    expect(getByRole(menu()!, "menuitem", { name: "This Mac" }).getAttribute("aria-current")).toBe("true");
    act(() => getByRole(menu()!, "menuitem", { name: "Acme" }).click());
    expect(nav.onShowPlace).toHaveBeenCalledWith("acme");
    expect(menu()).toBeNull();
  });

  it("goes Home from the place, and leaves the folder menu to switching and starting folders", async () => {
    const home = vi.fn();
    await renderHeader(local(), navigation(), { open: true, onHome: home, onCreateProject: noOp });
    expect(document.querySelector(".desktop-project-menu")?.textContent).not.toContain("Home");
    await renderHeader(local(), navigation(), { onHome: home });
    openMenu();
    act(() => getByRole(menu()!, "menuitem", { name: "Home" }).click());
    expect(home).toHaveBeenCalledOnce();
  });

  it("asks to sign in where no account is signed in", async () => {
    await renderHeader(local(), navigation({ account: { session: null, apiBaseUrl: "https://cloud.fixture", onOpenAccount: vi.fn() }, spaces: [] }));
    openMenu();
    expect(rows()).toEqual(["This Mac", "—", "Sign in"]);
  });

  it("keeps the place alone in the Header while the Project rail names the project", async () => {
    await renderHeader(local(), null, { projectHidden: true });
    const context = container.querySelector(".desktop-titlebar-context")!;
    expect([...context.children].map((child) => child.className)).toEqual(["desktop-titlebar-place-wrap"]);
  });

  it("keeps a local folder's link only as its Cloud copy", () => {
    expect(local()).toEqual({ place: "local", address: null, link: null });
    expect(local({ notice: linked, disconnectable: true })).toEqual({
      place: "local", address: null, link: { notice: linked, disconnectable: true } });
    expect(local({ cloudEnabled: false, notice: linked })).toEqual({ place: "local", address: null });
    expect(resolveProjectPlaceMenu({ place: "cloud", notice: linked })).toEqual({ place: "cloud", address: null });
  });

  it("states a local folder by this computer, before the folder, and speaks its path", async () => {
    await renderHeader(local({ address: localProjectAddress("/Users/example/project/puppyone-qubits") }));
    const button = placeButton();
    expect(button.textContent).toBe("This Mac");
    const context = container.querySelector(".desktop-titlebar-context")!;
    expect([...context.children].map((child) => child.className)).toEqual([
      "desktop-titlebar-place-wrap", "desktop-titlebar-context-separator", "desktop-titlebar-workspace-wrap"]);
    expect(accessibleName(button)).toBe("This Mac, ~/project/puppyone-qubits, Places and account");
  });

  it("states a Cloud folder by its organization until its Space is known", async () => {
    await renderHeader(resolveProjectPlaceMenu({ place: "cloud", address: cloudProjectAddress("Acme") }));
    expect(placeButton().textContent).toBe("Acme");
    expect(accessibleName(placeButton())).toBe("Cloud project, Acme, Places and account");
  });

  it("states a Cloud folder by the Space that holds it, with its square and the account's role, and marks it among the places", async () => {
    await renderHeader(resolveProjectPlaceMenu({ place: "cloud", address: cloudProjectAddress("Acme org"), space: spaces[1] }), navigation());
    const button = placeButton();
    expect(button.querySelector(".po-space-mark")?.textContent).toBe("A");
    expect(button.querySelector(".desktop-titlebar-place-address")?.textContent).toBe("Acme");
    expect(accessibleName(button)).toBe("Acme, Owner, Places and account");
    openMenu();
    expect(queryAllByRole(menu()!, "menuitem").filter((row) => row.getAttribute("aria-current") === "true")
      .map((row) => row.textContent)).toEqual(["AAcme"]);
  });

  it("names the account's own Space Personal, never the server's generated name", async () => {
    await renderHeader(resolveProjectPlaceMenu({ place: "cloud", space: spaces[0] }));
    expect(placeButton().querySelector(".desktop-titlebar-place-address")?.textContent).toBe("Personal");
    expect(placeButton().querySelector(".po-space-mark")?.textContent).toBe("G");
  });

  it("says a folder has a Cloud copy, and says what is wrong with one that cannot be used", async () => {
    await renderHeader(local({ address: localProjectAddress("/tmp/one"), notice: linked }));
    expect(accessibleName(placeButton())).toBe("This Mac, /tmp/one, Linked to a Cloud project, Places and account");
    await renderHeader(local({ notice: { kind: "missing" } }));
    expect(accessibleName(placeButton())).toBe("This Mac, No longer in the Cloud, Places and account");
    await renderHeader(local({ notice: { kind: "other-environment", origin: "http://localhost:9090" } }));
    expect(accessibleName(placeButton())).toBe("This Mac, In another environment: localhost:9090, Places and account");
  });

  it("shortens a local project's place to its root and last folders, and knows no Cloud place without a name", () => {
    expect(localProjectAddress("/Users/example/Library/Mobile Documents/Clients/2026/Pitch/"))
      .toEqual({ short: "~/\u2026/Clients/2026", full: "~/Library/Mobile Documents/Clients/2026/Pitch" });
    expect(localProjectAddress("/private/tmp/one")).toEqual({ short: "/private/tmp", full: "/private/tmp/one" });
    expect(localProjectAddress("/workspace")).toEqual({ short: "/", full: "/workspace" });
    expect(localProjectAddress("/Users/example")).toEqual({ short: "~", full: "~" });
    expect(localProjectAddress("C:\\Users\\example\\Documents\\Clients\\Pitch"))
      .toEqual({ short: "C:\\\u2026\\Documents\\Clients", full: "C:\\Users\\example\\Documents\\Clients\\Pitch" });
    expect(localProjectAddress("puppyone-cloud://project/p1")).toBeNull();
    expect(localProjectAddress("")).toBeNull();
    expect(cloudProjectAddress("  ")).toBeNull();
    expect(cloudProjectAddress(null)).toBeNull();
  });
});
