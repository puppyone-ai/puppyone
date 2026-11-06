/** @vitest-environment happy-dom */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import {
  cloudProjectAddress,
  localProjectAddress,
  resolveProjectPlaceMenu,
  type ProjectPlaceMenu,
} from "../../../../src/features/app-shell/project-place/projectPlaceMenuState";
import { ProjectPlaceRows } from "../../../../src/features/app-shell/project-place/ProjectPlaceMenu";
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
  onRetryCloudLink: vi.fn(), onDisconnectCloudLink: vi.fn(), onOpenLocalFolder: vi.fn() };
const local = (input: Partial<Parameters<typeof resolveProjectPlaceMenu>[0]> = {}) => resolveProjectPlaceMenu({
  place: "local", unhosted: false, publishPending: false, notice: null, disconnectable: false, ...input });

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); initializeDesktopPreferences();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

async function renderHeader(menu: ProjectPlaceMenu) {
  await act(async () => root.render(withTestLocalization(<DesktopTitlebarContext {...projectProps} placeMenu={{ menu, handlers }} />)));
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
  it("offers other-computer folders without exposing Cloud actions while Cloud is off", async () => {
    const menu = local({ cloudEnabled: false, unhosted: true, publishPending: true,
      notice: { kind: "linked", projectId: "p1", projectName: "Vault", openable: true }, disconnectable: true });
    await act(async () => root.render(withTestLocalization(<ProjectPlaceRows menu={menu} handlers={handlers}
      onDismiss={noOp} hostRows={() => <button data-project-place-row="other-computers">Other computers</button>} />)));
    expect(menu.action).toBeNull();
    expect(menu.link).toBeUndefined();
    expect(document.querySelector('[data-project-place-row="other-computers"]')).not.toBeNull();
    expect(document.querySelector('[data-project-place-row="put-in-cloud"], [data-project-place-row="cloud-link"]')).toBeNull();
  });

  it("puts an unlinked folder in the Cloud, and shows a linked folder's Cloud link instead", () => {
    const linked: LocalFolderCloudNotice = { kind: "linked", projectId: "p1", projectName: "Vault", openable: true };
    expect(local({ unhosted: true })).toMatchObject({ action: { kind: "put-in-cloud", continuing: false } });
    expect(local({ unhosted: true }).link).toBeUndefined();
    // A running first publish owns the folder's link until it ends.
    expect(local({ publishPending: true, notice: linked, disconnectable: true }))
      .toEqual({ place: "local", address: null, action: { kind: "put-in-cloud", continuing: true } });
    for (const notice of [linked, { kind: "sign-in" }, { kind: "missing" }, { kind: "other-environment", origin: null },
      { kind: "no-access" }, { kind: "ambiguous" }, { kind: "unreachable", cause: null }] as LocalFolderCloudNotice[]) {
      expect(local({ notice, disconnectable: true })).toMatchObject({ action: null, link: { notice, disconnectable: true } });
    }
    expect(local().link).toBeNull();
    expect(resolveProjectPlaceMenu({ place: "cloud", unhosted: false, publishPending: false, notice: linked,
      disconnectable: true, linkedFolder: { path: "/tmp/one", name: "One" } }))
      .toEqual({ place: "cloud", address: null, action: { kind: "open-local-folder", path: "/tmp/one", name: "One" } });
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

  it.each([true, false])("never restores local invitations from the retired preference (%s)", async enabled => {
    localStorage.setItem("puppyone.desktop.experimental", JSON.stringify({ enableShareOnboarding: enabled, enableProjectReach: true }));
    initializeDesktopPreferences();
    await renderHeader(local({ unhosted: true }));
    openMenu();
    expect(rows().map(([kind]) => kind)).toEqual(["current", "put-in-cloud"]);
    expect(document.querySelector(".desktop-project-place-subrow, .desktop-titlebar-reach-button")).toBeNull();
  });

  it("offers no sharing for a folder whose Cloud project needs a sign-in, only signing in", async () => {
    await renderHeader(local({ notice: { kind: "sign-in" } }));
    openMenu();
    expect(rows()).toEqual([["current", "This Mac", null], ["cloud-link", "Cloud project", "Sign in to open"]]);
    click("cloud-link");
    expect(handlers.onSignIn).toHaveBeenCalledOnce();
  });

  it("marks a linked folder in the Header and opens its Cloud project as another project", async () => {
    await renderHeader(local({ address: localProjectAddress("/tmp/one"), disconnectable: true,
      notice: { kind: "linked", projectId: "p1", projectName: "Vault", openable: true } }));
    const button = container.querySelector<HTMLButtonElement>(".desktop-titlebar-place-button")!;
    expect(button.dataset.cloudLink).toBe("linked");
    expect(button.querySelector(".desktop-titlebar-place-link")).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("This Mac, /tmp/one, Linked to a Cloud project, Where this project is");
    openMenu();
    expect(rows()).toEqual([["current", "This Mac", "/tmp/one"], ["cloud-link", "⁨Vault⁩", null],
      ["disconnect", "Disconnect from Cloud…", null]]);
    click("cloud-link");
    expect(handlers.onOpenCloudProject).toHaveBeenCalledWith("p1");
  });

  it("ends a link that cannot be used from here, and says why it cannot", async () => {
    await renderHeader(local({ notice: { kind: "other-environment", origin: "http://localhost:9090" }, disconnectable: true }));
    expect(container.querySelector<HTMLButtonElement>(".desktop-titlebar-place-button")!.dataset.cloudLink).toBe("problem");
    openMenu();
    expect(rows()).toEqual([["current", "This Mac", null], ["cloud-link", "Cloud project", "In another environment: localhost:9090"],
      ["disconnect", "Disconnect from Cloud…", null]]);
    const link = document.querySelector<HTMLButtonElement>('[data-project-place-row="cloud-link"]')!;
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect(link.dataset.cloudLink).toBe("problem");
    act(() => link.click());
    expect(handlers.onOpenCloudProject).not.toHaveBeenCalled();
    expect(document.querySelector(".desktop-project-place-menu")).not.toBeNull();
    click("disconnect");
    expect(handlers.onDisconnectCloudLink).toHaveBeenCalledOnce();
    expect(document.querySelector(".desktop-project-place-menu")).toBeNull();
  });

  it.each([
    [{ kind: "missing" }, "No longer in the Cloud"],
    [{ kind: "no-access" }, "This account can’t open it"],
    [{ kind: "ambiguous" }, "Points to more than one Cloud project"],
    [{ kind: "unreachable", cause: null }, "Can’t be reached right now"],
  ] as [LocalFolderCloudNotice, string][])("says why a %o link cannot be opened", async (notice, detail) => {
    await renderHeader(local({ notice }));
    openMenu();
    // A link this app cannot end by itself offers no way to end it.
    expect(rows()).toEqual([["current", "This Mac", null], ["cloud-link", "Cloud project", detail]]);
    if (notice.kind === "unreachable") {
      click("cloud-link");
      expect(handlers.onRetryCloudLink).toHaveBeenCalledOnce();
    }
  });

  it("states a Cloud project and opens its linked folder as another project", async () => {
    await renderHeader(resolveProjectPlaceMenu({ place: "cloud", unhosted: false, publishPending: false, notice: null,
      disconnectable: false, linkedFolder: { path: "/tmp/one", name: "One" } }));
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
      publishPending: false, notice: null, disconnectable: false }));
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
    expect(rows().map(([kind]) => kind)).toEqual(["current", "cloud-link"]);
    expect(document.querySelector(".desktop-titlebar-location-button, .desktop-project-location-controls")).toBeNull();
  });

});
