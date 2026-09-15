/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@puppyone/shared-ui";
import type { RecentWorkspaceHomeItem } from "../../../../src/features/app-shell/workspaceHomeModel";
import {
  getProjectSwitcherInitial,
  mergeProjectSwitcherRailOrder,
  ProjectSwitcherRail,
  resolveProjectSwitcherCompactWidth,
  resolveProjectSwitcherRailWidth,
  resolveProjectSwitcherRailItems,
} from "../../../../src/features/app-shell/ProjectSwitcherRail";
import { ProjectEntryLauncherDialog } from "../../../../src/features/app-shell/ProjectEntryLauncherDialog";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  Reflect.deleteProperty(window, "puppyoneDesktop");
});

describe("Project switcher rail", () => {
  it("sizes the compact rail from a square control plus stable inline padding", () => {
    expect(resolveProjectSwitcherRailWidth()).toBe(56);
    expect(resolveProjectSwitcherRailWidth(true)).toBe(220);
    expect(resolveProjectSwitcherRailWidth(true, 284)).toBe(284);
    expect(resolveProjectSwitcherRailWidth(true, 80)).toBe(160);
    expect(resolveProjectSwitcherRailWidth(true, 500)).toBe(360);
    expect(resolveProjectSwitcherCompactWidth(30)).toBe(54);
    expect(resolveProjectSwitcherCompactWidth(32)).toBe(56);
    expect(resolveProjectSwitcherCompactWidth(34)).toBe(58);
  });

  it("renders the expanded rail with full Sidebar rows and no collapse button", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        expanded
        recentWorkspaces={[{ workspace: beta }]}
        onCreateNew={() => undefined}
        onSelectProject={() => undefined}
      />,
    )));

    const rail = host.querySelector<HTMLElement>(".desktop-project-switcher-rail");
    const rows = host.querySelectorAll<HTMLButtonElement>(
      ".desktop-project-switcher-rail-project",
    );
    expect(rail?.dataset.expanded).toBe("true");
    expect(Array.from(rows, (row) => (
      row.querySelector(".desktop-project-switcher-rail-label")?.textContent
    ))).toEqual(["Alpha", "Beta"]);
    expect(rows[0]?.classList.contains("po-sidebar-row")).toBe(true);
    expect(rows[0]?.classList.contains("desktop-project-switcher-rail-expanded-project")).toBe(true);
    expect(rows[0]?.classList.contains("active")).toBe(true);
    expect(rows[0]?.querySelector('[data-context-asset-kind="local"] .lucide-folder-closed')).not.toBeNull();

    expect(host.querySelector(".desktop-project-switcher-rail-toggle")).toBeNull();
    expect(host.querySelector(".desktop-project-switcher-rail-footer")).toBeNull();
    expect(rail?.querySelector(".desktop-project-switcher-rail-title")).toBeNull();
  });

  it("exports a Project row as a Finder-compatible native folder drag", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha folder");
    const startProjectRootDrag = vi.fn(async () => true);
    window.puppyoneDesktop = {
      resourceDragSessionSupported: true,
      startProjectRootDrag,
    } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        expanded
        recentWorkspaces={[]}
        onCreateNew={() => undefined}
        onSelectProject={() => undefined}
      />,
    )));

    const project = host.querySelector<HTMLButtonElement>(
      ".desktop-project-switcher-rail-project",
    );
    const transfer = new DataTransfer();
    const event = new DragEvent("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    await act(async () => project?.dispatchEvent(event));

    expect(project?.getAttribute("draggable")).toBe("true");
    expect(event.defaultPrevented).toBe(true);
    expect(transfer.effectAllowed).toBe("copy");
    expect(transfer.getData("text/plain")).toBe(active.path);
    expect(transfer.getData("text/uri-list")).toBe("file:///projects/alpha%20folder");
    expect(startProjectRootDrag).toHaveBeenCalledWith({ path: active.path });
  });

  it("keeps app-level Settings and Feedback utilities at the bottom of the expanded rail", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const onOpenSettings = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeView="data"
        activeWorkspace={active}
        expanded
        recentWorkspaces={[]}
        onCreateNew={() => undefined}
        onOpenSettings={onOpenSettings}
        settingsOpen
        onSelectProject={() => undefined}
        utilitySlot={<button type="button" data-testid="feedback">Feedback</button>}
      />,
    )));

    const utilities = host.querySelector(".desktop-project-switcher-rail-utilities");
    const settings = utilities?.querySelector<HTMLButtonElement>("[data-navigation-item='settings']");
    const feedback = utilities?.querySelector<HTMLButtonElement>("[data-testid='feedback']");
    expect(utilities?.parentElement?.classList.contains("desktop-project-switcher-rail")).toBe(true);
    expect(utilities?.classList.contains("desktop-sidebar-navigation-surface")).toBe(true);
    expect(utilities?.getAttribute("data-placement")).toBe("bottom");
    expect(settings?.classList.contains("desktop-sidebar-footer-button")).toBe(true);
    expect(settings?.hasAttribute("aria-current")).toBe(false);
    expect(settings?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(settings?.getAttribute("aria-expanded")).toBe("true");
    expect(settings?.getAttribute("aria-label")).toBe("Settings");
    expect(settings?.querySelector(".desktop-sidebar-nav-label")).toBeNull();
    expect(feedback?.textContent).toBe("Feedback");

    await act(async () => settings?.click());
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("keeps the active Project selected underneath the Settings dialog", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const onSelectProject = vi.fn(async () => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeView="data"
        activeWorkspace={active}
        expanded
        recentWorkspaces={[]}
        onCreateNew={() => undefined}
        onOpenSettings={() => undefined}
        settingsOpen
        onSelectProject={onSelectProject}
      />,
    )));

    const project = host.querySelector<HTMLButtonElement>(
      ".desktop-project-switcher-rail-project",
    );
    const settings = host.querySelector<HTMLButtonElement>("[data-navigation-item='settings']");
    expect(project?.getAttribute("aria-current")).toBe("page");
    expect(project?.classList.contains("active")).toBe(true);
    expect(settings?.hasAttribute("aria-current")).toBe(false);
    expect(settings?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => project?.click());
    expect(onSelectProject).not.toHaveBeenCalled();
  });

  it("keeps the active Project first and de-duplicates the recent registry", () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const items = resolveProjectSwitcherRailItems(active, [
      { workspace: beta },
      { workspace: active },
    ]);

    expect(items.map((item) => item.workspace.path)).toEqual([
      "/projects/alpha",
      "/projects/beta",
    ]);
    expect(items.map((item) => item.initial)).toEqual(["A", "B"]);
  });

  it("uses context marks when expanded and compact identity badges when collapsed", async () => {
    const local = workspace("local", "Local", "/projects/local");
    const cloud = {
      ...workspace("cloud", "Cloud", "/projects/cloud"),
      puppyoneGitRemote: {
        origin: "https://api.puppyone.ai",
        projectId: "cloud-project",
        scopeId: null,
      },
    };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={local}
        expanded
        recentWorkspaces={[{ workspace: cloud }]}
        onCreateNew={() => undefined}
        onSelectProject={() => undefined}
      />,
    )));

    const rows = host.querySelectorAll(".desktop-project-switcher-rail-project");
    expect(rows[0]?.getAttribute("data-context-asset-kind")).toBe("local");
    expect(rows[0]?.getAttribute("data-avatar-kind")).toBe("context-local");
    expect(rows[0]?.querySelector(".desktop-project-switcher-rail-initial")).toBeNull();
    const localMark = rows[0]?.querySelector(".lucide-folder-closed");
    expect(localMark?.closest(".desktop-project-switcher-rail-context-avatar")).not.toBeNull();
    expect(localMark?.getAttribute("width")).toBe("15");
    expect(localMark?.getAttribute("stroke-width")).toBe("1.65");
    expect(rows[0]?.getAttribute("aria-label")).toContain("Local folder");
    expect(rows[1]?.getAttribute("data-context-asset-kind")).toBe("cloud");
    expect(rows[1]?.getAttribute("data-avatar-kind")).toBe("context-cloud");
    expect(rows[1]?.querySelector(".desktop-project-switcher-rail-initial")).toBeNull();
    const cloudMark = rows[1]?.querySelector(".lucide-cloud");
    expect(cloudMark?.closest(".desktop-project-switcher-rail-context-avatar")).not.toBeNull();
    expect(cloudMark?.getAttribute("width")).toBe("15");
    expect(cloudMark?.getAttribute("stroke-width")).toBe("1.8");
    expect(rows[1]?.getAttribute("aria-label")).toContain("Cloud project");

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={local}
        recentWorkspaces={[{ workspace: cloud }]}
        onCreateNew={() => undefined}
        onSelectProject={() => undefined}
      />,
    )));

    const compactRows = host.querySelectorAll(".desktop-project-switcher-rail-project");
    expect(compactRows[0]?.querySelector(".desktop-project-switcher-rail-identity-badge")?.textContent).toBe("L");
    const compactLocalMark = compactRows[0]?.querySelector(
      ".desktop-project-switcher-rail-compact-context-avatar .lucide-folder-closed",
    );
    expect(compactLocalMark).not.toBeNull();
    expect(compactLocalMark?.getAttribute("width")).toBe("15");
    expect(compactRows[1]?.querySelector(".desktop-project-switcher-rail-identity-badge")?.textContent).toBe("C");
    const compactCloudMark = compactRows[1]?.querySelector(
      ".desktop-project-switcher-rail-compact-context-avatar .lucide-cloud",
    );
    expect(compactCloudMark).not.toBeNull();
    expect(compactCloudMark?.getAttribute("width")).toBe("15");
  });

  it("reveals a themed Project-name tooltip only for compact rows", async () => {
    const active = workspace("active", "Alpha Project", "/projects/alpha");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        recentWorkspaces={[]}
        onCreateNew={() => undefined}
        onSelectProject={() => undefined}
      />,
    )));

    const compactRow = host.querySelector<HTMLButtonElement>(
      ".desktop-project-switcher-rail-project",
    );
    await act(async () => compactRow?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));

    const tooltip = host.querySelector<HTMLElement>("[role='tooltip']");
    expect(tooltip?.textContent).toBe("Alpha Project");
    expect(tooltip?.classList.contains("desktop-project-switcher-rail-tooltip")).toBe(true);
    expect(compactRow?.getAttribute("aria-describedby")).toBe(tooltip?.id);
    expect(compactRow?.hasAttribute("title")).toBe(false);

    await act(async () => compactRow?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(host.querySelector("[role='tooltip']")).toBeNull();

    await act(async () => compactRow?.focus());
    expect(host.querySelector("[role='tooltip']")?.textContent).toBe("Alpha Project");

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        expanded
        recentWorkspaces={[]}
        onCreateNew={() => undefined}
        onSelectProject={() => undefined}
      />,
    )));
    expect(host.querySelector("[role='tooltip']")).toBeNull();
  });

  it("derives a stable Unicode grapheme from the Project identity", () => {
    expect(getProjectSwitcherInitial("  项目", "/projects/fallback")).toBe("项");
    expect(getProjectSwitcherInitial("🧠 Lab", "/projects/fallback")).toBe("🧠");
    expect(getProjectSwitcherInitial("", "/projects/traction")).toBe("T");
  });

  it("preserves existing slots when the active and recent Project order changes", () => {
    const alpha = workspace("alpha", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const initialCatalog = resolveProjectSwitcherRailItems(alpha, [{ workspace: beta }]);
    const initialOrder = initialCatalog.map(({ workspace: project }) => project.path);
    const reorderedCatalog = resolveProjectSwitcherRailItems(beta, [{ workspace: beta }, { workspace: alpha }]);

    expect(mergeProjectSwitcherRailOrder(initialOrder, reorderedCatalog)).toEqual([
      "/projects/alpha",
      "/projects/beta",
    ]);
  });

  it("moves only the active state when switching Projects", async () => {
    const alpha = workspace("alpha", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const renderRail = (activeWorkspace: Workspace, recentWorkspaces: RecentWorkspaceHomeItem[]) => (
      withTestLocalization(
        <ProjectSwitcherRail
          activeWorkspace={activeWorkspace}
          recentWorkspaces={recentWorkspaces}
          onCreateNew={() => undefined}
          onSelectProject={() => undefined}
        />,
      )
    );

    await act(async () => root?.render(renderRail(alpha, [{ workspace: beta }])));
    await act(async () => root?.render(renderRail(beta, [
      { workspace: beta },
      { workspace: alpha },
    ])));

    const buttons = host.querySelectorAll<HTMLButtonElement>(
      ".desktop-project-switcher-rail-list .desktop-project-switcher-rail-project",
    );
    expect(Array.from(buttons, (button) => (
      button.querySelector(".desktop-project-switcher-rail-identity-badge")?.textContent
    ))).toEqual(["A", "B"]);
    expect(Array.from(buttons).every((button) => (
      button.classList.contains("desktop-project-switcher-rail-compact-project")
      && button.querySelector(".desktop-project-switcher-rail-identity-badge") !== null
      && button.querySelector(".desktop-project-switcher-rail-label") === null
    ))).toBe(true);
    expect(buttons[0]?.hasAttribute("aria-current")).toBe(false);
    expect(buttons[1]?.getAttribute("aria-current")).toBe("page");
  });

  it("announces the active Project and routes selection through the host", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const onSelectProject = vi.fn(async () => undefined);
    const onCreateNew = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        recentWorkspaces={[{ workspace: beta }]}
        onCreateNew={onCreateNew}
        onSelectProject={onSelectProject}
      />,
    )));

    const buttons = host.querySelectorAll<HTMLButtonElement>(
      ".desktop-project-switcher-rail-list .desktop-project-switcher-rail-project",
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-current")).toBe("page");
    expect(buttons[0]?.querySelector(".desktop-project-switcher-rail-identity-badge")?.textContent).toBe("A");
    expect(buttons[1]?.querySelector(".desktop-project-switcher-rail-identity-badge")?.textContent).toBe("B");
    expect(buttons[0]?.querySelector(".desktop-project-switcher-rail-compact-context-avatar .lucide-folder-closed")).not.toBeNull();
    expect(buttons[1]?.querySelector(".desktop-project-switcher-rail-compact-context-avatar .lucide-folder-closed")).not.toBeNull();
    expect(buttons[0]?.querySelector(".desktop-project-switcher-rail-label")).toBeNull();
    expect(buttons[1]?.querySelector(".desktop-project-switcher-rail-label")).toBeNull();

    await act(async () => buttons[1]?.click());
    expect(onSelectProject).toHaveBeenCalledOnce();
    expect(onSelectProject).toHaveBeenCalledWith("/projects/beta");

    const createNew = host.querySelector<HTMLButtonElement>(".desktop-project-switcher-rail-create");
    expect(createNew?.parentElement?.classList.contains("desktop-project-switcher-rail-list")).toBe(true);
    expect(createNew?.classList.contains("desktop-project-switcher-rail-compact-create")).toBe(true);
    expect(createNew?.querySelector(".desktop-project-switcher-rail-label")).toBeNull();
    const createNewIcon = createNew?.querySelector("svg");
    expect(createNewIcon?.getAttribute("width")).toBe("14");
    expect(createNewIcon?.getAttribute("height")).toBe("14");
    expect(createNewIcon?.getAttribute("stroke-width")).toBe("2.2");
    await act(async () => createNew?.click());
    expect(onCreateNew).toHaveBeenCalledOnce();

    expect(host.querySelector(".desktop-project-switcher-rail-home")).toBeNull();
  });

  it("keeps every Project visually stable and serializes the latest switch intent", async () => {
    const alpha = workspace("alpha", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const gamma = workspace("gamma", "Gamma", "/projects/gamma");
    const firstSwitch = deferred<void>();
    const calls: string[] = [];
    const onSelectProject = vi.fn(async (path: string) => {
      calls.push(path);
      if (calls.length === 1) await firstSwitch.promise;
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={alpha}
        recentWorkspaces={[{ workspace: beta }, { workspace: gamma }]}
        onCreateNew={() => undefined}
        onSelectProject={onSelectProject}
      />,
    )));

    const buttons = host.querySelectorAll<HTMLButtonElement>(
      ".desktop-project-switcher-rail-project",
    );
    act(() => buttons[1]?.click());
    await act(async () => Promise.resolve());
    act(() => buttons[2]?.click());
    await act(async () => Promise.resolve());

    expect(Array.from(buttons).every((button) => !button.disabled)).toBe(true);
    expect(buttons[2]?.getAttribute("aria-busy")).toBe("true");
    expect(calls).toEqual(["/projects/beta"]);

    await act(async () => {
      firstSwitch.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls).toEqual(["/projects/beta", "/projects/gamma"]);
  });

  it("keeps stored Project appearance without owning a context-menu action", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const appearance = {
      projectIdentity: "active-instance",
      icon: {
        kind: "asset" as const,
        assetId: "a".repeat(64),
        mediaType: "image/png" as const,
        updatedAt: "2026-09-04T00:00:00.000Z",
        url: `puppyone-asset://project-icon/${"a".repeat(64)}.png`,
      },
    };
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        projectAppearance: {
          list: vi.fn(async () => [appearance]),
          onChanged: vi.fn(() => () => undefined),
        },
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        recentWorkspaces={[]}
        onCreateNew={() => undefined}
        onSelectProject={() => undefined}
      />,
    )));
    await act(async () => Promise.resolve());

    const project = host.querySelector<HTMLButtonElement>(
      ".desktop-project-switcher-rail-list .desktop-project-switcher-rail-project",
    );
    expect(project?.dataset.avatarKind).toBe("asset");
    expect(project?.querySelector("img")?.getAttribute("src")).toBe(appearance.icon.url);
    expect(project?.hasAttribute("aria-haspopup")).toBe(false);
    expect(project?.hasAttribute("aria-expanded")).toBe(false);

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => project?.dispatchEvent(contextMenuEvent));

    expect(contextMenuEvent.defaultPrevented).toBe(false);
    expect(document.body.querySelector(".desktop-project-details-dialog")).toBeNull();
  });

  it("routes the create launcher through the three existing Project entry paths", async () => {
    const onOpenFolder = vi.fn();
    const onCreateProject = vi.fn();
    const onCloneRepository = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectEntryLauncherDialog
        canCreateProject
        canCloneRepository
        onClose={() => undefined}
        onOpenFolder={onOpenFolder}
        onCreateProject={onCreateProject}
        onCloneRepository={onCloneRepository}
      />,
    )));

    const options = host.querySelectorAll<HTMLButtonElement>(".desktop-project-entry-option");
    expect(options).toHaveLength(3);
    await act(async () => options[0]?.click());
    await act(async () => options[1]?.click());
    await act(async () => options[2]?.click());
    expect(onOpenFolder).toHaveBeenCalledOnce();
    expect(onCreateProject).toHaveBeenCalledOnce();
    expect(onCloneRepository).toHaveBeenCalledOnce();
  });
});

function workspace(id: string, name: string, path: string): Workspace {
  return {
    id,
    name,
    path,
    status: "recording",
    workspaceInstanceId: `${id}-instance`,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
