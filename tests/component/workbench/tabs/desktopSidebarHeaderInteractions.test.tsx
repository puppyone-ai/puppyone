/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopCloudShell } from "../../../../src/components/DesktopCloudShell";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("desktop explorer Header expansion", () => {
  it.each([
    { collapsed: false, centered: false },
    { collapsed: true, centered: false },
    { collapsed: false, centered: true },
    { collapsed: true, centered: true },
  ])("keeps Home first and independently clickable with sidebar collapsed=$collapsed and centered project=$centered", ({ collapsed, centered }) => {
    const onGoHome = vi.fn();
    const onLeftSidebarExpand = vi.fn();
    const onProject = vi.fn();
    const container = renderShell({
      leftSidebarCollapsed: collapsed,
      onGoHome,
      onLeftSidebarExpand,
      titlebarCenteredSlot: centered ? <button onClick={onProject}>Project menu</button> : undefined,
      titlebarTabs: <div role="tablist">Files</div>,
    });
    const header = container.querySelector("header");
    const home = header?.querySelector<HTMLButtonElement>(".desktop-titlebar-home");
    expect(home).toBe(header?.querySelector("button"));
    expect(home?.getAttribute("aria-label")).toBe("Home");
    expect(home?.querySelector('[data-product-icon="home"]')).not.toBeNull();
    expect(home?.textContent).toBe("");
    expect(home?.closest(".desktop-titlebar-centered-context")).toBeNull();
    act(() => home?.click());
    expect(onGoHome).toHaveBeenCalledOnce();
    expect(onLeftSidebarExpand).not.toHaveBeenCalled();
    expect(onProject).not.toHaveBeenCalled();
  });

  it("keeps a centered project menu interactive beside file tabs in the same Header", () => {
    const onProject = vi.fn();
    const container = renderShell({
      leftSidebarCollapsed: false,
      titlebarCenteredSlot: <button onClick={onProject}>Project menu</button>,
      titlebarTabs: <div role="tablist">Files</div>,
    });
    const header = container.querySelector("header");
    expect(header?.getAttribute("data-centered-project")).toBe("true");
    expect(header?.querySelector('[role="tablist"]')?.textContent).toBe("Files");
    const project = header?.querySelector<HTMLButtonElement>(".desktop-titlebar-centered-context button");
    act(() => project?.click());
    expect(onProject).toHaveBeenCalledOnce();
    expect(container.querySelectorAll("header")).toHaveLength(1);
  });

  it("shows the expansion action without hiding workspace or Git context", () => {
    const collapsed = renderShell({ leftSidebarCollapsed: true });
    expect(collapsed.querySelector(".desktop-titlebar-sidebar-expand")).not.toBeNull();
    expect(collapsed.querySelector(".desktop-shell")?.getAttribute("data-titlebar-sidebar-state"))
      .toBe("collapsed");
    expect(collapsed.querySelector(".desktop-titlebar-sidebar-context")?.textContent)
      .toContain("Workspace");
    expect(collapsed.querySelector(".desktop-titlebar-sidebar-context")?.textContent)
      .toContain("main");
    expect(collapsed.querySelector(".desktop-titlebar-editor-context")?.textContent)
      .toContain("Editors");

    resetRender();

    const expanded = renderShell({ leftSidebarCollapsed: false });
    expect(expanded.querySelector(".desktop-titlebar-sidebar-expand")).toBeNull();
    expect(expanded.querySelector(".desktop-shell")?.getAttribute("data-titlebar-sidebar-state"))
      .toBe("expanded");
    expect(expanded.querySelector<HTMLElement>(".desktop-shell")?.style.getPropertyValue(
      "--desktop-titlebar-sidebar-width",
    )).toBe("");
    expect(expanded.querySelector(".desktop-titlebar-sidebar-context")?.textContent)
      .toContain("Workspace");
  });

  it("does not render an empty editor Header column when no slot is provided", () => {
    const container = renderShell({
      leftSidebarCollapsed: false,
      titlebarEditorSlot: null,
    });

    expect(container.querySelector(".desktop-titlebar-editor-context")).toBeNull();
  });

  it("does not expose an expansion action merely because the window is compact", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(640);
    const onLeftSidebarExpand = vi.fn();
    const container = renderShell({
      leftSidebarCollapsed: false,
      onLeftSidebarExpand,
      rightSidebar: <div>Auxiliary</div>,
      rightSidebarOpen: true,
    });

    expect(container.querySelector(".desktop-titlebar-sidebar-expand")).toBeNull();
    expect(onLeftSidebarExpand).not.toHaveBeenCalled();
  });

  it("expands an explicitly collapsed explorer from the single Header action", () => {
    const onLeftSidebarExpand = vi.fn();
    const container = renderShell({
      leftSidebarCollapsed: true,
      onLeftSidebarExpand,
    });
    const button = requireExpandButton(container);

    act(() => button.click());

    expect(onLeftSidebarExpand).toHaveBeenCalledOnce();
    expect(onLeftSidebarExpand).toHaveBeenCalledWith();
    expect(button.getAttribute("aria-label")).toBe("Expand sidebar");
  });

  it("mounts an optional cross-Project rail below the full-width Header", () => {
    const container = renderShell({
      leftSidebarCollapsed: false,
      leadingRail: <nav>Projects</nav>,
      leadingRailWidth: 60,
    });
    const shell = container.querySelector<HTMLElement>(".desktop-shell");
    const workbench = shell?.querySelector<HTMLElement>(":scope > .desktop-shell-workbench");
    const belowHeader = workbench?.querySelector<HTMLElement>(":scope > .desktop-shell-below-header");
    const rail = belowHeader?.querySelector<HTMLElement>(":scope > .desktop-shell-leading-rail");
    const workspaceColumn = belowHeader?.querySelector<HTMLElement>(":scope > .desktop-shell-workspace-column");
    const body = workspaceColumn?.querySelector<HTMLElement>(".desktop-shell-body");
    const panes = body?.querySelector<HTMLElement>(":scope > .desktop-shell-pane-group");

    expect(rail?.textContent).toBe("Projects");
    expect(panes?.textContent).toContain("Editor");
    expect(workbench?.querySelector(":scope > .desktop-titlebar")).not.toBeNull();
    expect(workbench?.querySelector(":scope > .desktop-titlebar")?.nextElementSibling).toBe(belowHeader);
    expect(rail?.nextElementSibling).toBe(workspaceColumn);
    expect(body?.querySelector(".desktop-shell-leading-rail")).toBeNull();
    expect(shell?.getAttribute("data-leading-rail")).toBe("true");
    expect(shell?.style.getPropertyValue(
      "--desktop-shell-leading-rail-width",
    )).toBe("60px");
  });
});

function renderShell({
  leftSidebarCollapsed,
  leadingRail,
  leadingRailWidth,
  onGoHome,
  onLeftSidebarExpand = vi.fn(),
  rightSidebar,
  rightSidebarOpen = false,
  titlebarEditorSlot = <div>Editors</div>,
  titlebarCenteredSlot,
  titlebarTabs,
}: {
  leftSidebarCollapsed: boolean;
  leadingRail?: React.ReactNode;
  leadingRailWidth?: number;
  onGoHome?: () => void;
  onLeftSidebarExpand?: () => void;
  rightSidebar?: React.ReactNode;
  rightSidebarOpen?: boolean;
  titlebarEditorSlot?: React.ReactNode;
  titlebarCenteredSlot?: React.ReactNode;
  titlebarTabs?: React.ReactNode;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(withTestLocalization(
      <DesktopCloudShell
        onGoHome={onGoHome}
        leadingRail={leadingRail}
        leadingRailWidth={leadingRailWidth}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onLeftSidebarExpand={onLeftSidebarExpand}
        rightSidebar={rightSidebar}
        rightSidebarOpen={rightSidebarOpen}
        titlebarSidebarSlot={<div>Workspace · main</div>}
        titlebarEditorSlot={titlebarEditorSlot}
        titlebarCenteredSlot={titlebarCenteredSlot}
        titlebarTabs={titlebarTabs}
      >
        <div>Editor</div>
      </DesktopCloudShell>,
    ));
  });
  return container;
}

function requireExpandButton(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(".desktop-titlebar-sidebar-expand");
  if (!button) throw new Error("Missing collapsed explorer expansion action");
  return button;
}

function resetRender() {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
}
