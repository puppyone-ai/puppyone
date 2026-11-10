/** @vitest-environment happy-dom */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectAudience } from "../../../../src/components/project-audience";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import {
  cloudProjectAddress,
  localProjectAddress,
  resolveProjectPlaceMenu,
  type ProjectPlaceMenu,
} from "../../../../src/features/app-shell/project-place/projectPlaceMenuState";
import type { LocalFolderCloudNotice } from "../../../../src/features/cloud/project/localFolderCloudNoticeState";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { accessibleName, getByRole, isChecked, isDisabled, queryAllByRole, queryByRole } from "../../../support/react/queries";
import { withTestLocalization } from "../../../support/react/localization";

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
const handlers = { onOpenLocalFolder: vi.fn() };
const linked: LocalFolderCloudNotice = { kind: "linked", projectId: "p1", projectName: "Vault", openable: true };
const local = (input: Partial<Parameters<typeof resolveProjectPlaceMenu>[0]> = {}) => resolveProjectPlaceMenu({ place: "local", ...input });

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); initializeDesktopPreferences();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

async function renderHeader(menu: ProjectPlaceMenu, audience?: ProjectAudience | null) {
  await act(async () => root.render(withTestLocalization(
    <DesktopTitlebarContext {...projectProps} placeMenu={{ menu, handlers, audience }} />)));
}
const placeButton = () => getByRole(container, "button", { name: /Where this project is$/ });
const openMenu = () => act(() => placeButton().click());
const menu = () => queryByRole(document, "dialog", { name: "Where this project is" });
const audienceRegion = () => queryByRole(menu()!, "region", { name: "Who can open it" });
/** Each audience as it is announced: [name with its action, ticked]. */
const tiers = () => queryAllByRole(audienceRegion()!, "menuitemcheckbox").map((tier) => [accessibleName(tier), isChecked(tier)]);
/** The lines under the audiences, as announced. */
const details = () => queryAllByRole(audienceRegion()!, "menuitem").map(accessibleName);
const tier = (name: RegExp) => getByRole(audienceRegion()!, "menuitemcheckbox", { name });
const detail = (name: RegExp) => getByRole(audienceRegion()!, "menuitem", { name });

describe("where the open project is (ADR-001)", () => {
  it("goes Home from the place, and leaves the project menu to switching and adding projects", async () => {
    const home = vi.fn();
    await act(async () => root.render(withTestLocalization(
      <DesktopTitlebarContext {...projectProps} open onHome={home} onCreateProject={noOp} placeMenu={{ menu: local(), handlers }} />)));
    const projectMenu = document.querySelector(".desktop-workspace-menu, [role='menu']")!;
    expect(projectMenu.textContent).not.toContain("Home");
    await act(async () => root.render(withTestLocalization(
      <DesktopTitlebarContext {...projectProps} onHome={home} placeMenu={{ menu: local(), handlers }} />)));
    openMenu();
    act(() => getByRole(menu()!, "button", { name: "Home" }).click());
    expect(home).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();
  });

  it("keeps the place alone in the Header while the Project rail names the project", async () => {
    await act(async () => root.render(withTestLocalization(
      <DesktopTitlebarContext {...projectProps} projectHidden placeMenu={{ menu: local(), handlers }} />)));
    const context = container.querySelector(".desktop-titlebar-context")!;
    expect([...context.children].map((child) => child.className)).toEqual(["desktop-titlebar-place-wrap"]);
  });

  it("keeps a local folder's link only as its Cloud copy, and offers a Cloud project its folder", () => {
    expect(local()).toEqual({ place: "local", address: null, action: null, link: null });
    expect(local({ notice: linked, disconnectable: true })).toEqual({
      place: "local", address: null, action: null, link: { notice: linked, disconnectable: true } });
    expect(local({ cloudEnabled: false, notice: linked })).toEqual({ place: "local", address: null, action: null });
    expect(resolveProjectPlaceMenu({ place: "cloud", notice: linked, linkedFolder: { path: "/tmp/one", name: "One" } }))
      .toEqual({ place: "cloud", address: null, action: { kind: "open-local-folder", path: "/tmp/one", name: "One" } });
  });

  it("states a local project by this computer, before the project, with its folder at the head of its menu", async () => {
    await renderHeader(local({ address: localProjectAddress("/Users/example/project/puppyone-qubits") }));
    const button = placeButton();
    expect(button.textContent).toBe("This Mac");
    // Read like a path: the place, then the project.
    const context = container.querySelector(".desktop-titlebar-context")!;
    expect([...context.children].map((child) => child.className)).toEqual([
      "desktop-titlebar-place-wrap", "desktop-titlebar-context-separator", "desktop-titlebar-workspace-wrap"]);
    expect(accessibleName(button)).toBe("This Mac, ~/project/puppyone-qubits, Where this project is");
    openMenu();
    const current = getByRole(menu()!, "button", { name: "This Mac ~/project/puppyone-qubits" });
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(isDisabled(current)).toBe(true);
    // A fact, not a choice: nothing to tick.
    expect(current.hasAttribute("aria-checked")).toBe(false);
  });

  it("states a Cloud project by its organization until its Space is known, and opens its linked folder as another project", async () => {
    await renderHeader(resolveProjectPlaceMenu({ place: "cloud", address: cloudProjectAddress("Acme"),
      linkedFolder: { path: "/tmp/one", name: "One" } }));
    expect(placeButton().textContent).toBe("Acme");
    expect(accessibleName(placeButton())).toBe("Cloud project, Acme, Where this project is");
    openMenu();
    expect(audienceRegion()).toBeNull();
    act(() => getByRole(menu()!, "button", { name: /^Open folder on this Mac/ }).click());
    expect(handlers.onOpenLocalFolder).toHaveBeenCalledWith("/tmp/one");
  });

  it("states a Cloud project by the Space that holds it, with its square, plan and the account's role", async () => {
    const space = { id: "acme", name: "Acme", kind: "space" as const, role: "owner", canCreateProjects: true, planId: "team_v2" };
    await renderHeader(resolveProjectPlaceMenu({ place: "cloud", address: cloudProjectAddress("Acme org"), space }));
    const button = placeButton();
    expect(button.querySelector(".po-space-mark")?.textContent).toBe("A");
    expect(button.querySelector(".desktop-titlebar-place-address")?.textContent).toBe("Acme");
    expect(accessibleName(button)).toBe("Acme, Owner, Where this project is");
    openMenu();
    const current = menu()!.querySelector('[data-project-place-row="current"]')!;
    expect(current.querySelector(".po-space-mark")?.getAttribute("data-size")).toBe("lg");
    expect(current.querySelector(".po-space-plan")?.textContent).toBe("Team");
    expect(current.querySelector(".desktop-menu-item-detail")?.textContent).toBe("Owner");
  });

  it("names the account's own Space Personal, never the server's generated name", async () => {
    const space = { id: "mine", name: "guanqun's Workspace", kind: "space" as const, isDefault: true, role: "owner", canCreateProjects: true };
    await renderHeader(resolveProjectPlaceMenu({ place: "cloud", space }));
    expect(placeButton().querySelector(".desktop-titlebar-place-address")?.textContent).toBe("Personal");
    expect(placeButton().querySelector(".po-space-mark")?.textContent).toBe("G");
  });

  it("says a folder has a Cloud copy, and says what is wrong with one that cannot be used", async () => {
    await renderHeader(local({ address: localProjectAddress("/tmp/one"), notice: linked }));
    expect(accessibleName(placeButton())).toBe("This Mac, /tmp/one, Linked to a Cloud project, Where this project is");
    await renderHeader(local({ notice: { kind: "missing" } }));
    // Heard, not only seen: the mark's warning colour has words.
    expect(accessibleName(placeButton())).toBe("This Mac, No longer in the Cloud, Where this project is");
    await renderHeader(local({ notice: { kind: "other-environment", origin: "http://localhost:9090" } }));
    expect(accessibleName(placeButton())).toBe("This Mac, In another environment: localhost:9090, Where this project is");
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

describe("who can open a local project", () => {
  it("ticks only this computer, and offers my devices and a team their own way in", async () => {
    const audience = { devices: { on: false, onTurnOn: vi.fn() }, team: { copy: null, onCopy: vi.fn() } };
    await renderHeader(local(), audience);
    openMenu();
    expect(tiers()).toEqual([
      ["Only this computer", true],
      ["All my devices Turn on", false],
      ["Team Copy…", false],
    ]);
    expect(details()).toEqual([]);
    act(() => tier(/^Team/).click());
    expect(audience.team.onCopy).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();
    openMenu();
    act(() => tier(/^All my devices/).click());
    expect(audience.devices.onTurnOn).toHaveBeenCalledOnce();
  });

  it("opens this folder to my devices, stops it from the same row, and keeps its settings one line below", async () => {
    const devices = { on: true, detail: "Studio Mac and 2 others", onStop: vi.fn(), onSettings: vi.fn() };
    await renderHeader(local(), { devices });
    openMenu();
    expect(tiers()).toEqual([["Only this computer", false], ["All my devices Stop", true]]);
    expect(details()).toEqual(["Studio Mac and 2 others"]);
    act(() => detail(/^Studio Mac/).click());
    expect(devices.onSettings).toHaveBeenCalledOnce();
    openMenu();
    act(() => tier(/^All my devices/).click());
    expect(devices.onStop).toHaveBeenCalledOnce();
  });

  it("reaches a team only through a copy in the Cloud, opened from its own line, sent only when there is something to send", async () => {
    const copy = { onOpen: vi.fn(), unsent: 2, onSend: vi.fn() };
    await renderHeader(local({ notice: linked }), { team: { copy } });
    openMenu();
    expect(tiers()).toEqual([["Only this computer", false], ["Team", true]]);
    expect(details()).toEqual(["A copy in the cloud Open", "2 changes not sent Send"]);
    // The team's row states the copy; it is not a control that undoes it.
    expect(isDisabled(tier(/^Team/))).toBe(true);
    act(() => detail(/^2 changes/).click());
    expect(copy.onSend).toHaveBeenCalledOnce();
    openMenu();
    act(() => detail(/^A copy in the cloud/).click());
    expect(copy.onOpen).toHaveBeenCalledOnce();

    await renderHeader(local({ notice: linked }), { team: { copy: { onOpen: vi.fn(), unsent: 0 } } });
    openMenu();
    expect(details()).toEqual(["A copy in the cloud Open"]);
  });

  it("hangs a copy in my own space under my devices, not under a team", async () => {
    await renderHeader(local({ notice: linked }), { devicesCopy: { onOpen: vi.fn() } });
    openMenu();
    expect(tiers()).toEqual([["Only this computer", false], ["All my devices", true]]);
    expect(details()).toEqual(["A copy in the cloud Open"]);
  });

  it("says why a copy cannot be used, with its remedy at the end of the line", async () => {
    const copy = { problem: "No longer in the Cloud", onResolve: vi.fn(), resolveLabel: "Disconnect…" };
    await renderHeader(local({ notice: { kind: "missing" } }), { team: { copy } });
    openMenu();
    expect(details()).toEqual(["A copy in the cloud", "No longer in the Cloud Disconnect…"]);
    expect(detail(/^No longer/).dataset.tone).toBe("warning");
    expect(isDisabled(detail(/^A copy in the cloud/))).toBe(true);
    act(() => detail(/^No longer/).click());
    expect(copy.onResolve).toHaveBeenCalledOnce();
  });

  it.each([true, false])("never restores local invitations from the retired preference (%s)", async (enabled) => {
    localStorage.setItem("puppyone.desktop.experimental", JSON.stringify({ enableShareOnboarding: enabled, enableProjectReach: true }));
    initializeDesktopPreferences();
    await renderHeader(local(), { team: { copy: null, onCopy: vi.fn() } });
    openMenu();
    // Nothing invites a person to a local folder: a team is reached by a copy.
    const controls = [...queryAllByRole(menu()!, "button"), ...queryAllByRole(menu()!, "menuitem"),
      ...queryAllByRole(menu()!, "menuitemcheckbox")].map(accessibleName);
    expect(controls).toEqual(["This Mac", "Only this computer", "Team Copy…"]);
    expect(queryAllByRole(container, "button").map(accessibleName).filter((name) => /invite|share/i.test(name))).toEqual([]);
  });

  it("offers no audience and no switch of one project's place where neither is available", async () => {
    await renderHeader(local({ notice: { kind: "other-environment", origin: "http://api.puppyone.ai" } }), null);
    openMenu();
    expect(audienceRegion()).toBeNull();
    // One fact and nothing to switch: a folder and its Cloud project are two projects.
    expect(queryAllByRole(menu()!, "button").map(accessibleName)).toEqual(["This Mac"]);
    expect(queryAllByRole(container, "button").map(accessibleName).filter((name) => /local|cloud/i.test(name) && !/Where this project is$/.test(name))).toEqual([]);
  });
});
