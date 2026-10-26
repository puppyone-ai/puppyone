/** @vitest-environment happy-dom */
import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceFolder } from "../../../../packages/shared-ui/src/core/workbenchWorkspace";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import { DesktopWorkspaceSwitcher } from "../../../../src/features/app-shell/DesktopWorkspaceSwitcher";
import { DesktopProjectLocationSwitcher } from "../../../../src/components/DesktopProjectLocationSwitcher";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { withTestLocalization } from "../../../support/react/localization";
import { writeClipboardText } from "../../../../src/lib/clipboard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const device = vi.hoisted(() => ({ platform: "macos" as string | null }));
vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({
  useDesktopPlatformCapabilities: () => device.platform ? { platform: device.platform } : null,
}));
vi.mock("../../../../src/lib/clipboard", () => ({ writeClipboardText: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const workspace = { id: "one", name: "Workspace one", path: "/tmp/one", status: "recording" as const };
const second = { ...workspace, id: "two", name: "Workspace two", path: "/tmp/two" };
const third = { ...workspace, id: "three", name: "Workspace three", path: "/tmp/three" };
const noOp = () => {};
beforeEach(() => {
  localStorage.clear(); initializeDesktopPreferences();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); device.platform = "macos"; vi.restoreAllMocks(); });
async function render(content: React.ReactNode) { await act(async () => root.render(withTestLocalization(content))); }
function menu(selector = ".desktop-project-menu") {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
function clickText(label: string) {
  const button = [...menu().querySelectorAll("button")].find(b => b.textContent?.trim() === label);
  if (!button) throw new Error(`Missing ${label}`);
  act(() => button.click());
}
function locationButton(kind: string) { return menu(".desktop-project-location-menu").querySelector<HTMLButtonElement>(`button[data-project-location="${kind}"]`)!; }
function openLocation() { act(() => container.querySelector<HTMLButtonElement>(".desktop-titlebar-location-button")!.click()); }
const projectProps = { open: true, refObject: createRef<HTMLDivElement>(), workspace, titlebarLabel: workspace.name,
  workspaceFolders: [], multiRootWorkspacesEnabled: false, onClose: noOp, onToggle: noOp };

describe("combined Home and project menu", () => {
  it("uses a draggable static project identity in Sidebar mode while retaining the provider menu", async () => {
    const toggle = vi.fn(), close = vi.fn(), viewCloud = vi.fn();
    await render(<DesktopTitlebarContext {...projectProps} projectMenuEnabled={false}
      availableProjects={[workspace, second]} onToggle={toggle} onClose={close}
      projectLocation={{ current: "local", localAvailable: true, cloudState: "available" }} onViewCloud={viewCloud} />);
    const identity = container.querySelector<HTMLElement>(".desktop-titlebar-workspace-label")!;
    expect(identity.tagName).toBe("DIV");
    expect(identity.textContent).toBe(workspace.name);
    expect(identity.dataset.windowDragRegion).toBe("true");
    expect(identity.querySelector('[data-project-location="local"]')).not.toBeNull();
    expect(identity.hasAttribute("aria-haspopup")).toBe(false);
    expect(identity.hasAttribute("aria-expanded")).toBe(false);
    act(() => identity.click());
    expect(toggle).not.toHaveBeenCalled();
    expect(document.querySelector(".desktop-project-menu")).toBeNull();
    openLocation();
    act(() => locationButton("cloud").click());
    expect(viewCloud).toHaveBeenCalledOnce();
    expect(document.querySelector(".desktop-project-menu")).toBeNull();
  });

  it("lists registered projects, marks the current one and routes Home, create and another project separately", async () => {
    const close = vi.fn(), home = vi.fn(), create = vi.fn(), select = vi.fn();
    await render(<DesktopWorkspaceSwitcher {...projectProps} availableProjects={[workspace, second, second]}
      onClose={close} onHome={home} onCreateProject={create} onSelectProject={select} />);
    const trigger = container.querySelector<HTMLButtonElement>(".desktop-titlebar-workspace-button")!;
    expect(trigger.querySelector(".lucide-house")).not.toBeNull();
    expect(trigger.textContent).toBe(workspace.name);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.contains(menu())).toBe(false);
    expect(menu().dataset.windowNoDrag).toBe("true");
    expect(menu().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(menu().querySelectorAll(".desktop-menu-item")).toHaveLength(4);
    clickText(workspace.name); expect(select).not.toHaveBeenCalled();
    clickText(second.name); expect(select).toHaveBeenCalledExactlyOnceWith(second.path);
    clickText("Home"); expect(home).toHaveBeenCalledOnce();
    clickText("Create new"); expect(create).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledTimes(4);
  });

  it("copies each local project's path without navigating or closing the menu", async () => {
    const close = vi.fn(), select = vi.fn(), selectCloud = vi.fn();
    vi.mocked(writeClipboardText).mockResolvedValue(undefined);
    await render(<DesktopWorkspaceSwitcher {...projectProps} onHome={noOp}
      projectItems={[
        { id: workspace.id, label: workspace.name, localPath: workspace.path },
        { id: second.id, label: second.name, localPath: second.path, cloudProjectId: "linked" },
        { id: "cloud", label: "Cloud only", localPath: "", cloudProjectId: "cloud" },
      ]}
      onClose={close} onSelectProject={select} onSelectCloudProject={selectCloud} />);
    const popup = menu();
    expect(popup.querySelector(".desktop-project-menu-header")).toBeNull();
    expect(popup.querySelector(".desktop-menu-item")?.textContent).toBe("Home");
    const copyButtons = [...popup.querySelectorAll<HTMLButtonElement>(".desktop-project-switcher-copy")];
    expect(copyButtons).toHaveLength(2);
    for (const [index, project] of [workspace, second].entries()) {
      expect(copyButtons[index].dataset.tooltip).toContain(project.path);
      await act(async () => copyButtons[index].click());
      expect(writeClipboardText).toHaveBeenLastCalledWith(project.path);
      expect(copyButtons[index].getAttribute("aria-label")).toContain("Copied");
    }
    expect(popup.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(popup.querySelector('[aria-current="page"]')?.textContent).toBe(workspace.name);
    expect(close).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(selectCloud).not.toHaveBeenCalled();
    expect(menu()).toBe(popup);
  });

  it("keeps a failed copy retryable without switching the selected project", async () => {
    const close = vi.fn(), select = vi.fn();
    vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error("Clipboard unavailable"))
      .mockResolvedValue(undefined);
    await render(<DesktopWorkspaceSwitcher {...projectProps} availableProjects={[workspace, second]}
      onClose={close} onSelectProject={select} />);
    const copy = menu().querySelectorAll<HTMLButtonElement>(".desktop-project-switcher-copy")[1];
    await act(async () => copy.click());
    expect(menu().querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(copy.disabled).toBe(false);
    await act(async () => copy.click());
    expect(writeClipboardText).toHaveBeenLastCalledWith(second.path);
    expect(menu().querySelector('[role="alert"]')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("restores focus on Escape and dismisses outside the menu, including Header blank space", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <DesktopWorkspaceSwitcher {...projectProps} open={open} availableProjects={[workspace, second]}
        onToggle={() => setOpen(v => !v)} onClose={() => setOpen(false)} />;
    }
    await render(<Harness />);
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    act(() => trigger.click());
    act(() => menu().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector(".desktop-project-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    act(() => trigger.click());
    act(() => menu().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(menu()).not.toBeNull();
    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(document.querySelector(".desktop-project-menu")).toBeNull();
  });

  it("keeps composition actions distinct from switching projects", async () => {
    const add = vi.fn(), folder = vi.fn(), select = vi.fn();
    await render(<DesktopWorkspaceSwitcher {...projectProps} multiRootWorkspacesEnabled
      workspaceFolders={[createWorkspaceFolder(workspace), createWorkspaceFolder(second, { index: 1 })]}
      availableProjects={[workspace, second, third]} onAddExistingProject={add} onOpenFolder={folder} onSelectProject={select} />);
    clickText("Add Project…");
    expect(menu().textContent).not.toContain(second.name);
    expect(menu().textContent).toContain(third.name);
    act(() => [...menu().querySelectorAll("button")].find(b => b.textContent?.includes(third.name))!.click());
    expect(add).toHaveBeenCalledExactlyOnceWith(third.path);
    clickText("Open Folder…"); expect(folder).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
  });

  it("offers project navigation with Cloud and composition disabled, without Git branch controls", async () => {
    await render(<DesktopTitlebarContext {...projectProps} availableProjects={[workspace, second]} onHome={noOp} onCreateProject={noOp} />);
    expect(menu().textContent).toContain(second.name);
    expect(menu().textContent).not.toContain("Add Project…");
    expect(container.querySelector(".desktop-titlebar-branch-button")).toBeNull();
    expect(container.querySelector(".desktop-titlebar-location-button")).toBeNull();
  });
});

describe("independent Local / Cloud menu", () => {
  it.each([["macos", "This Mac"], ["windows", "This computer"], ["linux", "This computer"], [null, "This computer"]] as const)(
    "shows Local in the Header and the device label inside the popup (%s)", async (platform, label) => {
      device.platform = platform;
      await render(<DesktopProjectLocationSwitcher projectLocation={{ current: "local", localAvailable: true, cloudState: "available" }} onViewCloud={noOp} />);
      expect(container.querySelector(".desktop-titlebar-location-button")?.textContent).toBe("Local");
      openLocation();
      expect(menu(".desktop-project-location-menu").textContent).toBe(`Open on ${label}Open in a hosted workspace`);
      expect(menu(".desktop-project-location-menu").getAttribute("role")).toBe("dialog");
      expect(locationButton("local").getAttribute("aria-current")).toBe("true");
    });

  it.each(["unavailable", "available", "signed-out", "resolving", "attention"] as const)(
    "routes the Cloud action without prematurely changing the committed location (%s)", async cloudState => {
      const cloud = vi.fn();
      await render(<DesktopProjectLocationSwitcher projectLocation={{ current: "local", localAvailable: true, cloudState }} onViewCloud={cloud} />);
      openLocation(); const popup = menu(".desktop-project-location-menu");
      expect(locationButton("cloud").textContent).toBe("Open in a hosted workspace");
      expect(Boolean(locationButton("cloud").querySelector('[data-puppy-loader]'))).toBe(cloudState === "resolving");
      act(() => locationButton("cloud").click());
      expect(cloud).toHaveBeenCalledOnce();
      expect(menu(".desktop-project-location-menu")).toBe(popup);
      expect(locationButton("local").getAttribute("aria-pressed")).toBe("true");
    });

  it("switches Local / Cloud without remounting the project trigger or discarding the local draft", async () => {
    function Harness() {
      const [cloud, setCloud] = useState(false);
      const [open, setOpen] = useState(false);
      return <><input defaultValue="Unsaved local draft" /><DesktopTitlebarContext {...projectProps}
        open={open} onToggle={() => setOpen(v => !v)} onClose={() => setOpen(false)}
        projectLocation={{ current: cloud ? "cloud" : "local", localAvailable: true, cloudState: "available" }}
        availableProjects={[workspace, second]} onViewCloud={() => setCloud(true)} onViewLocal={() => setCloud(false)} /></>;
    }
    await render(<Harness />);
    const input = container.querySelector("input"), project = container.querySelector<HTMLButtonElement>(".desktop-titlebar-workspace-button")!;
    openLocation(); const popup = menu(".desktop-project-location-menu");
    act(() => locationButton("cloud").click());
    expect(container.querySelector(".desktop-titlebar-location-button")?.textContent).toBe("Hosted workspace");
    expect(container.querySelector(".desktop-titlebar-location-button .lucide-server")).not.toBeNull();
    expect(container.querySelector(".desktop-titlebar-workspace-button")).toBe(project);
    act(() => locationButton("local").click());
    expect(menu(".desktop-project-location-menu")).toBe(popup);
    expect(container.querySelector("input")).toBe(input);
    expect(input?.value).toBe("Unsaved local draft");
    act(() => project.click());
    expect(document.querySelector(".desktop-project-location-menu")).toBeNull();
    expect(menu()).not.toBeNull();
    openLocation();
    expect(document.querySelector(".desktop-project-menu")).toBeNull();
    expect(menu(".desktop-project-location-menu")).not.toBeNull();
  });
});
