/** @vitest-environment happy-dom */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import { resolveProjectReachState } from "../../../../src/features/app-shell/project-reach";
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
const handlers = { onPutInCloud: vi.fn(), onOpenCloudProject: vi.fn(), onSignIn: vi.fn(),
  onPutInCloudAgain: vi.fn(), onOpenLocalFolder: vi.fn() };
const sharing = { onInvitePerson: vi.fn(), onConnectAgent: vi.fn() };
const local = (input: Partial<Parameters<typeof resolveProjectPlaceMenu>[0]> = {}) => resolveProjectPlaceMenu({
  place: "local", unhosted: false, publishPending: false, notice: null, missingReplaceable: false, ...input });

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); initializeDesktopPreferences();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

async function renderHeader(menu: ProjectPlaceMenu, reach = false, share = false) {
  await act(async () => root.render(withTestLocalization(<DesktopTitlebarContext {...projectProps}
    placeMenu={{ menu, handlers: share ? { ...handlers, ...sharing } : handlers }}
    projectReach={reach ? { state: resolveProjectReachState({ share: "local", shares: [], destinations: [] }),
      onInvitePerson: sharing.onInvitePerson, onConnectAgent: sharing.onConnectAgent } : undefined} />)));
}
function openMenu(selector = ".desktop-titlebar-place-button") {
  act(() => container.querySelector<HTMLButtonElement>(selector)!.click());
}
const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".desktop-project-place-row")].map((row) => [
  row.dataset.projectPlaceRow, row.querySelector(".desktop-menu-item-label")?.textContent,
  row.querySelector(".desktop-menu-item-detail")?.textContent ?? null]);
function click(kind: string) {
  act(() => document.querySelector<HTMLButtonElement>(`.desktop-project-place-row[data-project-place-row="${kind}"]`)!.click());
}

describe("the Header place menu (ADR-001)", () => {
  it("offers exactly the one action that applies to each state", () => {
    const linked: LocalFolderCloudNotice = { kind: "linked", projectId: "p1", projectName: "Vault", openable: true };
    expect(local({ unhosted: true }).action).toEqual({ kind: "put-in-cloud", continuing: false });
    expect(local({ publishPending: true }).action).toEqual({ kind: "put-in-cloud", continuing: true });
    expect(local({ notice: linked }).action).toEqual({ kind: "open-cloud-project", projectId: "p1", projectName: "Vault" });
    expect(local({ notice: { ...linked, openable: false } }).action).toBeNull();
    expect(local({ notice: { kind: "sign-in" } }).action).toEqual({ kind: "sign-in" });
    expect(local({ notice: { kind: "missing" }, missingReplaceable: true }).action).toEqual({ kind: "put-in-cloud-again" });
    for (const notice of [{ kind: "missing" }, { kind: "other-environment", origin: null }, { kind: "no-access" },
      { kind: "ambiguous" }, { kind: "unreachable", cause: null }] as LocalFolderCloudNotice[]) {
      expect(local({ notice }).action).toBeNull();
    }
    expect(resolveProjectPlaceMenu({ place: "cloud", unhosted: false, publishPending: false, notice: null,
      missingReplaceable: false, linkedFolder: { path: "/tmp/one", name: "One" } }).action)
      .toEqual({ kind: "open-local-folder", path: "/tmp/one", name: "One" });
  });

  it("puts an unhosted folder in the Cloud from the This Mac menu, the conversion entry", async () => {
    await renderHeader(local({ unhosted: true }));
    const button = container.querySelector<HTMLButtonElement>(".desktop-titlebar-place-button")!;
    expect(button.textContent).toBe("This Mac");
    openMenu();
    expect(rows()).toEqual([
      ["current", "This Mac", null],
      ["put-in-cloud", "Put in the Cloud", null],
    ]);
    click("put-in-cloud");
    expect(handlers.onPutInCloud).toHaveBeenCalledOnce();
    expect(document.querySelector(".desktop-project-place-menu")).toBeNull();
  });

  it("puts inviting a person and connecting an agent under Put in the Cloud, as part of going to the Cloud", async () => {
    await renderHeader(local({ unhosted: true }), false, true);
    openMenu();
    expect(rows().map(([kind, label]) => [kind, label])).toEqual([
      ["current", "This Mac"],
      ["put-in-cloud", "Put in the Cloud"],
      ["invite-person", "Invite a person"],
      ["connect-agent", "Connect an agent"],
    ]);
    const subrows = document.querySelectorAll(".desktop-project-place-subrow");
    expect([...subrows].map((row) => (row as HTMLElement).dataset.projectPlaceRow)).toEqual(["invite-person", "connect-agent"]);
    click("invite-person");
    expect(sharing.onInvitePerson).toHaveBeenCalledOnce();
    openMenu();
    click("connect-agent");
    expect(sharing.onConnectAgent).toHaveBeenCalledOnce();
  });

  it("offers no sharing for a folder whose Cloud project cannot be reached from here", async () => {
    await renderHeader(local({ notice: { kind: "sign-in" } }), false, true);
    openMenu();
    expect(rows().map(([kind]) => kind)).toEqual(["current", "sign-in"]);
  });

  it("opens a linked folder's Cloud project as another project", async () => {
    await renderHeader(local({ notice: { kind: "linked", projectId: "p1", projectName: "Vault", openable: true } }));
    openMenu();
    expect(rows()[1]).toEqual(["open-cloud-project", "Open Cloud project", "⁨Vault⁩"]);
    click("open-cloud-project");
    expect(handlers.onOpenCloudProject).toHaveBeenCalledWith("p1");
  });

  it("states a Cloud project and opens its linked folder as another project", async () => {
    await renderHeader(resolveProjectPlaceMenu({ place: "cloud", unhosted: false, publishPending: false, notice: null,
      missingReplaceable: false, linkedFolder: { path: "/tmp/one", name: "One" } }));
    expect(container.querySelector(".desktop-titlebar-place-button")?.textContent).toBe("Cloud project");
    openMenu();
    expect(rows()).toEqual([["current", "Cloud project", null], ["open-local-folder", "Open folder on this Mac", "⁨One⁩"]]);
    click("open-local-folder");
    expect(handlers.onOpenLocalFolder).toHaveBeenCalledWith("/tmp/one");
  });

  it("states a local project by the folder that holds it, and a Cloud project by its organization", async () => {
    await renderHeader(local({ unhosted: true, address: localProjectAddress("/Users/example/project/puppyone-qubits") }));
    const button = container.querySelector<HTMLButtonElement>(".desktop-titlebar-place-button")!;
    expect(button.textContent).toBe("~/project");
    expect(button.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
    // The words name the place; the kind of place stays in the accessible name and the menu.
    expect(button.getAttribute("aria-label")).toBe("This Mac, ~/project/puppyone-qubits, Where this project is");
    openMenu();
    expect(rows()[0]).toEqual(["current", "This Mac", "~/project/puppyone-qubits"]);
    act(() => button.click());

    await renderHeader(resolveProjectPlaceMenu({ place: "cloud", address: cloudProjectAddress("Acme"), unhosted: false,
      publishPending: false, notice: null, missingReplaceable: false }));
    const cloud = container.querySelector<HTMLButtonElement>(".desktop-titlebar-place-button")!;
    expect(cloud.dataset.projectPlace).toBe("cloud");
    expect(cloud.textContent).toBe("Acme");
    expect(cloud.getAttribute("aria-label")).toBe("Cloud project, Acme, Where this project is");
    openMenu();
    expect(rows()).toEqual([["current", "Cloud project", "Acme"]]);
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

  it("offers nothing that cannot work, and never a switch of one project's place", async () => {
    await renderHeader(local({ notice: { kind: "other-environment", origin: "http://api.puppyone.ai" } }));
    openMenu();
    expect(rows()).toEqual([["current", "This Mac", null]]);
    expect(document.querySelector(".desktop-titlebar-location-button, .desktop-project-location-controls")).toBeNull();
  });

  it("is the reach panel itself on the reach path, without a separate reach statement or actions", async () => {
    await renderHeader(local({ unhosted: true }), true);
    expect(container.querySelector(".desktop-titlebar-place-button")).toBeNull();
    openMenu(".desktop-titlebar-reach-button");
    expect(rows().map(([kind]) => kind)).toEqual(["current", "put-in-cloud", "invite-person", "connect-agent"]);
    expect(document.querySelector(".desktop-project-reach-card, .desktop-project-reach-action")).toBeNull();
    expect(document.body.textContent).not.toContain("Only you can reach this project");
    click("put-in-cloud");
    expect(handlers.onPutInCloud).toHaveBeenCalledOnce();
  });
});
