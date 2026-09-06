/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@puppyone/shared-ui";
import type { RecentWorkspaceHomeItem } from "../src/features/app-shell/workspaceHomeModel";
import {
  getProjectSwitcherInitial,
  mergeProjectSwitcherRailOrder,
  ProjectSwitcherRail,
  resolveProjectSwitcherRailWidth,
  resolveProjectSwitcherRailItems,
} from "../src/features/app-shell/ProjectSwitcherRail";
import { ProjectEntryLauncherDialog } from "../src/features/app-shell/ProjectEntryLauncherDialog";
import { withTestLocalization } from "./testLocalization";

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
  it("matches the collapsed rail to the Header height", () => {
    expect(resolveProjectSwitcherRailWidth()).toBe(38);
    expect(resolveProjectSwitcherRailWidth(true)).toBe(220);
    expect(resolveProjectSwitcherRailWidth(true, 284)).toBe(284);
    expect(resolveProjectSwitcherRailWidth(true, 80)).toBe(160);
    expect(resolveProjectSwitcherRailWidth(true, 500)).toBe(360);
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
    expect(Array.from(rows, ({ textContent }) => textContent)).toEqual(["AAlpha", "BBeta"]);
    expect(rows[0]?.classList.contains("po-sidebar-row")).toBe(true);
    expect(rows[0]?.classList.contains("active")).toBe(true);
    expect(rows[0]?.querySelector(".desktop-project-switcher-rail-avatar")?.textContent).toBe("A");

    expect(host.querySelector(".desktop-project-switcher-rail-toggle")).toBeNull();
    expect(host.querySelector(".desktop-project-switcher-rail-footer")).toBeNull();
    expect(rail?.querySelector(".desktop-project-switcher-rail-title")).toBeNull();
  });

  it("keeps app-level Settings and Feedback utilities at the bottom of the expanded rail", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const onOpenSettings = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeView="settings"
        activeWorkspace={active}
        expanded
        recentWorkspaces={[]}
        onCreateNew={() => undefined}
        onOpenSettings={onOpenSettings}
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
    expect(settings?.getAttribute("aria-current")).toBe("page");
    expect(settings?.getAttribute("aria-label")).toBe("Settings");
    expect(settings?.querySelector(".desktop-sidebar-nav-label")).toBeNull();
    expect(feedback?.textContent).toBe("Feedback");

    await act(async () => settings?.click());
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("keeps Settings and Projects as peer destinations", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const onSelectProject = vi.fn(async () => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeView="settings"
        activeWorkspace={active}
        expanded
        recentWorkspaces={[]}
        onCreateNew={() => undefined}
        onOpenSettings={() => undefined}
        onSelectProject={onSelectProject}
      />,
    )));

    const project = host.querySelector<HTMLButtonElement>(
      ".desktop-project-switcher-rail-project",
    );
    const settings = host.querySelector<HTMLButtonElement>("[data-navigation-item='settings']");
    expect(project?.hasAttribute("aria-current")).toBe(false);
    expect(project?.classList.contains("active")).toBe(false);
    expect(settings?.getAttribute("aria-current")).toBe("page");

    await act(async () => project?.click());
    expect(onSelectProject).toHaveBeenCalledWith("/projects/alpha");
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
    expect(Array.from(buttons, ({ textContent }) => textContent)).toEqual(["A", "B"]);
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
    expect(buttons[0]?.textContent).toBe("A");
    expect(buttons[1]?.textContent).toBe("B");

    await act(async () => buttons[1]?.click());
    expect(onSelectProject).toHaveBeenCalledOnce();
    expect(onSelectProject).toHaveBeenCalledWith("/projects/beta");

    const createNew = host.querySelector<HTMLButtonElement>(".desktop-project-switcher-rail-create");
    expect(createNew?.parentElement?.classList.contains("desktop-project-switcher-rail-list")).toBe(true);
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

  it("opens Project details and edits local image or emoji appearance from the centered dialog", async () => {
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
    const chooseIcon = vi.fn(async () => ({ status: "updated" as const, appearance }));
    const resetIcon = vi.fn(async () => ({ ...appearance, icon: null }));
    const emojiAppearance = {
      projectIdentity: "active-instance",
      icon: {
        kind: "emoji" as const,
        value: "📁",
        updatedAt: "2026-09-04T00:00:01.000Z",
      },
    };
    const setEmoji = vi.fn(async () => emojiAppearance);
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        projectAppearance: {
          list: vi.fn(async () => [appearance]),
          chooseIcon,
          resetIcon,
          setEmoji,
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

    await act(async () => project?.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    })));
    const dialog = document.body.querySelector<HTMLElement>(".desktop-project-details-dialog");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.textContent).toContain("Alpha");
    expect(dialog?.textContent).toContain("/projects/alpha");

    const actions = dialog?.querySelectorAll<HTMLButtonElement>(".desktop-project-details-action");
    await act(async () => actions?.[1]?.click());
    expect(chooseIcon).toHaveBeenCalledWith({ projectIdentity: "active-instance" });

    const emoji = dialog?.querySelector<HTMLButtonElement>(".desktop-project-details-emoji");
    await act(async () => emoji?.click());
    expect(setEmoji).toHaveBeenCalledWith({
      projectIdentity: "active-instance",
      emoji: "📁",
    });
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
