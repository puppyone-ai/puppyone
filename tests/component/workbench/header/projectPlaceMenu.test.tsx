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
const openMenu = () => act(() => container.querySelector<HTMLButtonElement>(".desktop-titlebar-place-button")!.click());
const menuOpen = () => document.querySelector(".desktop-project-place-menu") !== null;
const label = (element: Element) => element.querySelector(".desktop-menu-item-label")?.textContent ?? "";
const action = (element: Element) => element.querySelector(".project-audience-action")?.textContent ?? null;
/** Each audience as the menu says it: [name, ticked, the action at its end]. */
const tiers = () => [...document.querySelectorAll(".project-audience-tier")]
  .map((tier) => [label(tier), tier.getAttribute("aria-checked") === "true", action(tier)]);
const details = () => [...document.querySelectorAll(".project-audience-detail")].map((detail) => [label(detail), action(detail)]);
const tier = (name: string) => [...document.querySelectorAll<HTMLButtonElement>(".project-audience-tier")].find((row) => label(row) === name)!;
const detail = (text: string) => [...document.querySelectorAll<HTMLButtonElement>(".project-audience-detail")]
  .find((row) => label(row).includes(text))!;

describe("where the open project is (ADR-001)", () => {
  it("keeps a local folder's link only as its Cloud copy, and offers a Cloud project its folder", () => {
    expect(local()).toEqual({ place: "local", address: null, action: null, link: null });
    expect(local({ notice: linked, disconnectable: true })).toEqual({
      place: "local", address: null, action: null, link: { notice: linked, disconnectable: true } });
    expect(local({ cloudEnabled: false, notice: linked })).toEqual({ place: "local", address: null, action: null });
    expect(resolveProjectPlaceMenu({ place: "cloud", notice: linked, linkedFolder: { path: "/tmp/one", name: "One" } }))
      .toEqual({ place: "cloud", address: null, action: { kind: "open-local-folder", path: "/tmp/one", name: "One" } });
  });

  it("states a local project by the folder that holds it, as a fact at the head of its menu", async () => {
    await renderHeader(local({ address: localProjectAddress("/Users/example/project/puppyone-qubits") }));
    const button = container.querySelector<HTMLButtonElement>(".desktop-titlebar-place-button")!;
    expect(button.textContent).toBe("~/project");
    expect(button.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(button.getAttribute("aria-label")).toBe("This Mac, ~/project/puppyone-qubits, Where this project is");
    openMenu();
    const current = document.querySelector<HTMLElement>('[data-project-place-row="current"]')!;
    expect(label(current)).toBe("This Mac");
    expect(current.querySelector(".desktop-menu-item-detail")?.textContent).toBe("~/project/puppyone-qubits");
    expect(current.getAttribute("aria-disabled")).toBe("true");
    // A fact, not a choice: no tick beside it.
    expect(current.querySelector(".desktop-menu-item-trailing")).toBeNull();
  });

  it("states a Cloud project by its space and opens its linked folder as another project", async () => {
    await renderHeader(resolveProjectPlaceMenu({ place: "cloud", address: cloudProjectAddress("Acme"),
      linkedFolder: { path: "/tmp/one", name: "One" } }));
    const button = container.querySelector<HTMLButtonElement>(".desktop-titlebar-place-button")!;
    expect(button.textContent).toBe("Acme");
    expect(button.getAttribute("aria-label")).toBe("Cloud project, Acme, Where this project is");
    openMenu();
    expect(document.querySelector(".project-audience")).toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('[data-project-place-row="open-local-folder"]')!.click());
    expect(handlers.onOpenLocalFolder).toHaveBeenCalledWith("/tmp/one");
  });

  it("marks a folder that has a Cloud copy, and a copy that cannot be used", async () => {
    await renderHeader(local({ address: localProjectAddress("/tmp/one"), notice: linked }));
    const button = container.querySelector<HTMLButtonElement>(".desktop-titlebar-place-button")!;
    expect(button.dataset.cloudLink).toBe("linked");
    expect(button.getAttribute("aria-label")).toBe("This Mac, /tmp/one, Linked to a Cloud project, Where this project is");
    await renderHeader(local({ notice: { kind: "missing" } }));
    expect(container.querySelector<HTMLButtonElement>(".desktop-titlebar-place-button")!.dataset.cloudLink).toBe("problem");
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
    expect(document.querySelector(".project-audience-title")?.textContent).toBe("Who can open it");
    expect(tiers()).toEqual([
      ["Only this computer", true, null],
      ["All my devices", false, "Turn on"],
      ["Team", false, "Copy…"],
    ]);
    expect(details()).toEqual([]);
    act(() => tier("Team").click());
    expect(audience.team.onCopy).toHaveBeenCalledOnce();
    expect(menuOpen()).toBe(false);
    openMenu();
    act(() => tier("All my devices").click());
    expect(audience.devices.onTurnOn).toHaveBeenCalledOnce();
  });

  it("opens this folder to my devices, stops it from the same row, and keeps its settings one line below", async () => {
    const devices = { on: true, detail: "Studio Mac and 2 others", onStop: vi.fn(), onSettings: vi.fn() };
    await renderHeader(local(), { devices });
    openMenu();
    expect(tiers()).toEqual([["Only this computer", false, null], ["All my devices", true, "Stop"]]);
    expect(details()).toEqual([["Studio Mac and 2 others", ""]]);
    act(() => detail("Studio Mac").click());
    expect(devices.onSettings).toHaveBeenCalledOnce();
    openMenu();
    act(() => tier("All my devices").click());
    expect(devices.onStop).toHaveBeenCalledOnce();
  });

  it("reaches a team only through a copy in the Cloud, opened from its own line, sent only when there is something to send", async () => {
    const copy = { onOpen: vi.fn(), unsent: 2, onSend: vi.fn() };
    await renderHeader(local({ notice: linked }), { team: { copy } });
    openMenu();
    expect(tiers()).toEqual([["Only this computer", false, null], ["Team", true, null]]);
    expect(details()).toEqual([["A copy in the cloud", "Open"], ["2 changes not sent", "Send"]]);
    // The team's row states the copy; it is not a control that undoes it.
    expect(tier("Team").getAttribute("aria-disabled")).toBe("true");
    act(() => detail("2 changes").click());
    expect(copy.onSend).toHaveBeenCalledOnce();
    openMenu();
    act(() => detail("A copy in the cloud").click());
    expect(copy.onOpen).toHaveBeenCalledOnce();

    await renderHeader(local({ notice: linked }), { team: { copy: { onOpen: vi.fn(), unsent: 0 } } });
    openMenu();
    expect(details()).toEqual([["A copy in the cloud", "Open"]]);
  });

  it("hangs a copy in my own space under my devices, not under a team", async () => {
    await renderHeader(local({ notice: linked }), { devicesCopy: { onOpen: vi.fn() } });
    openMenu();
    expect(tiers()).toEqual([["Only this computer", false, null], ["All my devices", true, null]]);
    expect(details()).toEqual([["A copy in the cloud", "Open"]]);
  });

  it("says why a copy cannot be used, with its remedy at the end of the line", async () => {
    const copy = { problem: "No longer in the Cloud", onResolve: vi.fn(), resolveLabel: "Disconnect…" };
    await renderHeader(local({ notice: { kind: "missing" } }), { team: { copy } });
    openMenu();
    expect(details()).toEqual([["A copy in the cloud", null], ["No longer in the Cloud", "Disconnect…"]]);
    expect(detail("No longer").dataset.tone).toBe("warning");
    expect(detail("A copy in the cloud").getAttribute("aria-disabled")).toBe("true");
    act(() => detail("No longer").click());
    expect(copy.onResolve).toHaveBeenCalledOnce();
  });

  it.each([true, false])("never restores local invitations from the retired preference (%s)", async (enabled) => {
    localStorage.setItem("puppyone.desktop.experimental", JSON.stringify({ enableShareOnboarding: enabled, enableProjectReach: true }));
    initializeDesktopPreferences();
    await renderHeader(local(), { team: { copy: null, onCopy: vi.fn() } });
    openMenu();
    expect(document.querySelector(".desktop-project-place-subrow, .desktop-titlebar-reach-button")).toBeNull();
    // Nothing invites a person to a local folder: a team is reached by a copy.
    expect(document.querySelector(".desktop-project-place-menu")?.textContent).not.toMatch(/invite/i);
  });

  it("offers no audience and no switch of one project's place where neither is available", async () => {
    await renderHeader(local({ notice: { kind: "other-environment", origin: "http://api.puppyone.ai" } }), null);
    openMenu();
    expect(document.querySelector(".project-audience")).toBeNull();
    expect(document.querySelector(".desktop-titlebar-location-button, .desktop-project-location-controls")).toBeNull();
  });
});
