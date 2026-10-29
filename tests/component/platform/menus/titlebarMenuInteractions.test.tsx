/** @vitest-environment happy-dom */
import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceFolder } from "../../../../packages/shared-ui/src/core/workbenchWorkspace";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import { DesktopWorkspaceSwitcher } from "../../../../src/features/app-shell/DesktopWorkspaceSwitcher";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { withTestLocalization } from "../../../support/react/localization";
import { writeClipboardText } from "../../../../src/lib/clipboard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const device = vi.hoisted(() => ({ platform: "macos" as string | null }));
vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({
  useDesktopPlatformCapabilities: () => device.platform ? { platform: device.platform, windowChrome: { mode: "overlay" } } : null,
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
const projectProps = { open: true, refObject: createRef<HTMLDivElement>(), workspace, titlebarLabel: workspace.name,
  workspaceFolders: [], multiRootWorkspacesEnabled: false, onClose: noOp, onToggle: noOp };

describe("combined Home and project menu", () => {
  // The Header states the Project only while it is the Project switcher. When
  // the rail takes that role its hosts render no context at all, so this
  // component has no second, menu-less presentation to cover.
  it("states the Project with one menu trigger and no silent identity variant", async () => {
    await render(<DesktopTitlebarContext {...projectProps} open={false} availableProjects={[workspace, second]} />);
    expect(container.querySelector(".desktop-titlebar-workspace-label")).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>(".desktop-titlebar-workspace-button")!;
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("lists registered projects, marks the current one and routes Home, create and another project separately", async () => {
    const close = vi.fn(), home = vi.fn(), create = vi.fn(), select = vi.fn();
    await render(<DesktopWorkspaceSwitcher {...projectProps} availableProjects={[workspace, second, second]}
      onClose={close} onHome={home} onCreateProject={create} onSelectProject={select} />);
    const trigger = container.querySelector<HTMLButtonElement>(".desktop-titlebar-workspace-button")!;
    expect(trigger.querySelector('[data-product-icon="home"]')).not.toBeNull();
    expect(trigger.textContent).toBe(workspace.name);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.contains(menu())).toBe(false);
    expect(menu().dataset.windowNoDrag).toBe("true");
    expect(menu().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(menu().querySelectorAll(".desktop-menu-item")).toHaveLength(4);
    clickText(workspace.name); expect(select).not.toHaveBeenCalled();
    clickText(second.name); expect(select).toHaveBeenCalledExactlyOnceWith(second.path);
    clickText("Home"); expect(home).toHaveBeenCalledOnce();
    clickText("New workspace"); expect(create).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledTimes(4);
  });

  it("lets a click on the displayed project replace a pending switch", async () => {
    const select = vi.fn();
    await render(<DesktopWorkspaceSwitcher {...projectProps} availableProjects={[workspace, second]}
      pendingProject={{ kind: "local", path: second.path }} onSelectProject={select} />);
    expect(menu().querySelector('[aria-busy="true"]')?.textContent).toContain(second.name);
    clickText(workspace.name);
    expect(select).toHaveBeenCalledWith(workspace.path);
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

describe("a local folder and its Cloud project in the project menu (ADR-001)", () => {
  const linkedItems = [
    { id: "local:one", label: workspace.name, localPath: workspace.path, linkedCloudProject: { id: "cloud-one", name: workspace.name } },
    { id: "cloud:cloud-one", label: workspace.name, localPath: "", cloudProjectId: "cloud-one" },
  ];

  it("lists them as two projects and opens the Cloud one as its own project", async () => {
    const select = vi.fn(), selectCloud = vi.fn();
    await render(<DesktopTitlebarContext {...projectProps} projectItems={linkedItems}
      onSelectProject={select} onSelectCloudProject={selectCloud} />);
    const rows = [...menu().querySelectorAll<HTMLElement>(".desktop-project-switcher-row")];
    expect(rows.map((row) => row.dataset.projectLocation)).toEqual(["local", "cloud"]);
    expect(rows[0]!.dataset.linkedCloudProjectId).toBe("cloud-one");
    expect(rows[0]!.querySelector('.onboarding-project-icon[data-project-location="linked"]')).not.toBeNull();
    expect(rows[1]!.querySelector('.onboarding-project-icon[data-project-location="cloud"]')).not.toBeNull();
    expect(menu().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    act(() => rows[1]!.querySelector<HTMLButtonElement>("button")!.click());
    expect(selectCloud).toHaveBeenCalledExactlyOnceWith("cloud-one");
    expect(select).not.toHaveBeenCalled();
  });

  it("has no Header control that switches one project between this computer and the Cloud", async () => {
    await render(<DesktopTitlebarContext {...projectProps} open={false} projectItems={linkedItems} />);
    expect(container.querySelector(".desktop-titlebar-location-button, .desktop-project-location-controls")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("marks the open Cloud project, not the folder, while the Cloud project is shown", async () => {
    const cloudWorkspace = { ...workspace, id: "cloud-one", path: "puppyone-cloud:cloud-one", projectId: "cloud-one" };
    await render(<DesktopTitlebarContext {...projectProps} workspace={cloudWorkspace} projectItems={linkedItems} />);
    const current = menu().querySelector<HTMLElement>('[aria-current="page"]')!;
    expect(current.closest<HTMLElement>(".desktop-project-switcher-row")?.dataset.projectLocation).toBe("cloud");
  });
});
