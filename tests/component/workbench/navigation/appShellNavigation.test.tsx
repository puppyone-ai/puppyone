/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopSidebarFooterNavigation,
  DesktopSidebarRailNavigation,
  DesktopSidebarTopNavigation,
} from "../../../../src/features/app-shell/navigation";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("DesktopSidebarTopNavigation", () => {
  it("keeps project-specific Cloud tools out of the local shell navigation", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <DesktopSidebarTopNavigation
        activeView="data"
        gitEnabled={false}
        pluginsEnabled={false}
        orientation="horizontal"
        gitIncomingCount={0}
        gitOperationLoading={null}
        gitStatus={null}
        workspaceChangeCount={0}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    ));

    expect(
      Array.from(container.querySelectorAll("button"), (button) => button.getAttribute("aria-label")),
    ).toEqual(["Settings"]);
    expect(container.querySelector('[aria-label="Assets"]')).toBeNull();
    expect(container.querySelector('[aria-label="Automation"]')).toBeNull();
    expect(container.querySelectorAll(".desktop-sidebar-top-navigation-group")).toHaveLength(1);
  });

  it("places Cloud hub before the terminal Settings action and omits the linked dot", () => {
    const onNavigate = vi.fn();
    const onOpenCloud = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <DesktopSidebarTopNavigation
        activeView="data"
        cloudHubEnabled
        gitEnabled
        pluginsEnabled={false}
        orientation="horizontal"
        gitIncomingCount={0}
        gitOperationLoading={null}
        gitStatus={null}
        workspaceChangeCount={0}
        onNavigate={onNavigate}
        onOpenCloud={onOpenCloud}
        onOpenSettings={vi.fn()}
      />,
    ));

    expect(
      Array.from(container.querySelectorAll("button"), (button) => button.getAttribute("aria-label")),
    ).toEqual(["Changes", "Cloud", "Settings"]);
    expect(container.querySelectorAll(".desktop-sidebar-top-navigation-group")).toHaveLength(1);
    expect(container.querySelector(".desktop-sidebar-top-navigation-end")).toBeNull();
    expect(container.querySelector('[aria-label="Cloud"] .desktop-sidebar-nav-cloud-dot')).toBeNull();
    expect(container.querySelector('[aria-label="Assets"]')).toBeNull();
    expect(container.querySelector('[aria-label="Automation"]')).toBeNull();
    expect(container.querySelector('[aria-label="History"]')).toBeNull();

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Cloud"]')?.click());
    expect(onOpenCloud).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalledWith("cloud");
    expect(container.querySelector('[aria-label="Cloud"]')?.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("exposes a stable Shell-toolbar contract without replacing Sidebar semantics", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <DesktopSidebarTopNavigation
        activeView="data"
        cloudHubEnabled
        gitEnabled
        pluginsEnabled={false}
        orientation="horizontal"
        gitIncomingCount={0}
        gitOperationLoading={null}
        gitStatus={null}
        shellToolbar
        useToolLabels
        workspaceChangeCount={65}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    ));

    const navigation = container.querySelector('[data-shell-toolbar-section="navigation"]');
    expect(navigation?.classList.contains("desktop-sidebar-top-navigation")).toBe(true);
    expect(navigation?.classList.contains("desktop-shell-toolbar-navigation")).toBe(true);
    expect(navigation?.querySelectorAll(".desktop-shell-toolbar-button")).toHaveLength(3);
    expect(navigation?.querySelectorAll(".desktop-shell-toolbar-button-icon")).toHaveLength(3);
    expect(navigation?.querySelectorAll(".desktop-shell-toolbar-button-label")).toHaveLength(3);
    expect(navigation?.querySelector(".desktop-sidebar-nav-badge")).toBeNull();
  });

  it("places the Feedback utility at the far edge of top navigation", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <DesktopSidebarTopNavigation
        activeView="data"
        gitEnabled={false}
        pluginsEnabled={false}
        orientation="horizontal"
        gitIncomingCount={0}
        gitOperationLoading={null}
        gitStatus={null}
        workspaceChangeCount={0}
        utilitySlot={<button type="button" aria-label="Feedback">?</button>}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    ));

    const list = container.querySelector(".desktop-sidebar-top-navigation-list");
    expect(list?.lastElementChild?.classList.contains("desktop-sidebar-top-navigation-utility"))
      .toBe(true);
    expect(list?.lastElementChild?.textContent).toBe("?");
  });
});

describe("DesktopSidebarFooterNavigation", () => {
  it("keeps navigation left and the Feedback utility on the right edge", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <DesktopSidebarFooterNavigation
        activeView="data"
        cloudHubEnabled
        gitEnabled
        pluginsEnabled={false}
        gitIncomingCount={0}
        gitOperationLoading={null}
        gitStatus={null}
        workspaceChangeCount={0}
        utilitySlot={<button type="button" aria-label="Feedback">?</button>}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    ));

    expect(
      Array.from(container.querySelectorAll("button"), (button) => button.getAttribute("aria-label")),
    ).toEqual(["Changes", "Cloud", "Settings", "Feedback"]);
    expect(container.querySelectorAll(".desktop-sidebar-footer-actions")).toHaveLength(2);
    expect(container.querySelector(".desktop-sidebar-footer-actions-right")?.textContent).toBe("?");
  });
});

describe("DesktopSidebarRailNavigation local Cloud hub", () => {
  it("uses a dot without a count for local workspace changes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <DesktopSidebarRailNavigation
        activeView="git"
        cloudHubEnabled
        gitEnabled
        pluginsEnabled={false}
        gitIncomingCount={0}
        gitOperationLoading={null}
        gitStatus={null}
        workspaceChangeCount={2}
        utilitySlot={<button type="button" aria-label="Feedback">?</button>}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    ));

    expect(
      Array.from(container.querySelectorAll("button"), (button) => button.getAttribute("aria-label")),
    ).toEqual(["Changes, workspace changes detected", "Cloud", "Settings", "Feedback"]);
    const badge = container.querySelector('[data-navigation-item="git"] .desktop-sidebar-nav-badge');
    expect(badge?.classList.contains("workspace")).toBe(true);
    expect(badge?.textContent).toBe("");
    expect(container.querySelector('button[aria-label="History"]')).toBeNull();
    expect(container.querySelector(".desktop-sidebar-nav-cloud-dot")).toBeNull();
    expect(container.querySelector(".desktop-sidebar-rail-actions-end")?.lastElementChild?.textContent)
      .toBe("?");
  });

  it("shows only the incoming cloud count when local and remote changes coexist", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <DesktopSidebarRailNavigation
        activeView="git"
        cloudHubEnabled
        gitEnabled
        pluginsEnabled={false}
        gitIncomingCount={17}
        gitOperationLoading={null}
        gitStatus={null}
        workspaceChangeCount={65}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    ));

    const gitButton = container.querySelector('[data-navigation-item="git"]');
    const badge = gitButton?.querySelector(".desktop-sidebar-nav-badge");
    expect(gitButton?.getAttribute("aria-label")).toBe("Changes, 17 remote changes to pull");
    expect(badge?.classList.contains("remote")).toBe(true);
    expect(badge?.classList.contains("workspace")).toBe(false);
    expect(badge?.textContent).toBe("17");
  });
});
