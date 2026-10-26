/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@puppyone/shared-ui";
import type { ProjectHomeItem, RecentWorkspaceHomeItem } from "../../../../src/lib/workspaceHomeModel";
import { buildHomepageProjects } from "../../../../src/features/cloud/workbench/homepageCloudProjects";
import type { ProjectAppearance } from "../../../../src/types/electron";
import {
  getProjectSwitcherInitial,
  mergeProjectSwitcherRailOrder,
  ProjectSwitcherRail,
  resolveProjectRowPlace,
  resolveProjectSwitcherCompactWidth,
  resolveProjectSwitcherRailWidth,
  resolveProjectSwitcherRailItems,
} from "../../../../src/features/app-shell/ProjectSwitcherRail";
import { resolveDesktopSidebarActionMenuPosition } from "../../../../src/components/DesktopSidebarActionMenu";
import {
  ProjectEntryFlow,
  useProjectEntryFlow,
} from "../../../../src/features/app-shell/ProjectEntryFlow";
import { useProjectNavigation } from "../../../../src/features/app-shell/useProjectNavigation";
import { ProjectEntryLauncherDialog } from "../../../../src/features/app-shell/ProjectEntryLauncherDialog";
import { DesktopCloudShell } from "../../../../src/components/DesktopCloudShell";
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
  it.each([false, true])("retains shell controls and New Project during pending navigation (expanded=%s)", async (expanded) => {
    const alpha = workspace("alpha", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const switching = deferred<void>();
    const onCreateNew = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const renderShell = (activeWorkspace: Workspace) => withTestLocalization(
      <DesktopCloudShell
        leadingRailWidth={220}
        leadingRailCollapsed={!expanded}
        leadingRailCollapsedWidth={56}
        renderLeadingRail={(presentation) => (
          <ProjectSwitcherRail activeWorkspace={activeWorkspace} expanded={presentation.expanded}
            recentWorkspaces={[{ workspace: alpha }, { workspace: beta }]}
            projectItems={localCatalog(activeWorkspace, [{ workspace: alpha }, { workspace: beta }])}
            onCreateNew={onCreateNew} onSelectProject={() => switching.promise} />
        )}
      >
        <div>{activeWorkspace.name}</div>
      </DesktopCloudShell>,
    );
    await act(async () => root?.render(renderShell(alpha)));
    const rail = host.querySelector(".desktop-project-switcher-rail");
    const brand = host.querySelector(".desktop-titlebar-brand-icon");
    expect(rail).not.toBeNull();
    expect(brand).not.toBeNull();
    const create = host.querySelector<HTMLButtonElement>(".desktop-project-switcher-rail-create")!;
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".desktop-project-switcher-rail-project")];
    await act(async () => rows[1]!.click());
    expect(rows[1]!.getAttribute("aria-busy")).toBe("true");
    expect(create.disabled).toBe(false);
    await act(async () => create.click());
    expect(onCreateNew).toHaveBeenCalledOnce();
    await act(async () => root?.render(renderShell(beta)));
    await act(async () => switching.resolve());
    expect(host.querySelector(".desktop-project-switcher-rail")).toBe(rail);
    expect(host.querySelector(".desktop-titlebar-brand-icon")).toBe(brand);
    expect(host.querySelector(".desktop-project-switcher-rail-create")).toBe(create);
    expect([...host.querySelectorAll(".desktop-project-switcher-rail-project")]).toEqual(rows);
    expect(rows[1]!.getAttribute("aria-current")).toBe("page");
    expect(rows[1]!.hasAttribute("aria-busy")).toBe(false);
  });

  it("does not reload appearance data when switching among the same project identities", async () => {
    const alpha = workspace("alpha", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const list = vi.fn(async () => []);
    let onChanged!: (appearance: ProjectAppearance) => void;
    window.puppyoneDesktop = { projectAppearance: {
      list,
      onChanged: (listener: typeof onChanged) => { onChanged = listener; return () => undefined; },
    } } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = (activeWorkspace: Workspace, recentWorkspaces: RecentWorkspaceHomeItem[]) => withTestLocalization(
      <ProjectSwitcherRail activeWorkspace={activeWorkspace} recentWorkspaces={recentWorkspaces}
        projectItems={localCatalog(activeWorkspace, recentWorkspaces)}
        onCreateNew={() => undefined} onSelectProject={() => undefined} />,
    );
    await act(async () => root?.render(render(alpha, [{ workspace: beta }])));
    await act(async () => root?.render(render(beta, [{ workspace: { ...alpha } }, { workspace: { ...beta } }])));
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => onChanged({
      projectIdentity: "alpha-instance",
      icon: { kind: "emoji", value: "🌱", updatedAt: "2026-09-20T00:00:00.000Z" },
    }));
    expect(host.querySelector(".desktop-project-switcher-rail-identity-badge")?.textContent).toBe("🌱");
    expect(list).toHaveBeenCalledTimes(1);
    const gamma = workspace("gamma", "Gamma", "/projects/gamma");
    await act(async () => root?.render(render(beta, [{ workspace: alpha }, { workspace: gamma }])));
    expect(list).toHaveBeenCalledTimes(2);
  });

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
        projectItems={localCatalog(active, [{ workspace: beta }])}
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
    expect(rows[0]?.querySelector('[data-project-location="local"] [data-product-icon="local"]')).not.toBeNull();

    expect(host.querySelector(".desktop-project-switcher-rail-toggle")).toBeNull();
    expect(host.querySelector(".desktop-project-switcher-rail-footer")).toBeNull();
    expect(rail?.querySelector(".desktop-project-switcher-rail-title")).toBeNull();
  });

  it("opens a Project actions menu and confirms rename or unlink in centered dialogs", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const onRenameProject = vi.fn(async () => undefined);
    const onUnlinkProject = vi.fn(async () => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        expanded
        recentWorkspaces={[{ workspace: beta }]}
        projectItems={localCatalog(active, [{ workspace: beta }])}
        onCreateNew={() => undefined}
        onRenameProject={onRenameProject}
        onSelectProject={() => undefined}
        onUnlinkProject={onUnlinkProject}
      />,
    )));

    const actionButtons = host.querySelectorAll<HTMLButtonElement>(
      ".desktop-project-switcher-row-action",
    );
    const projectRows = host.querySelectorAll<HTMLElement>(
      ".desktop-project-switcher-rail-project-row",
    );
    expect(actionButtons).toHaveLength(2);
    expect(actionButtons[1]?.getAttribute("aria-label")).toContain("Beta");
    expect(actionButtons[1]?.getAttribute("aria-haspopup")).toBe("menu");

    vi.spyOn(actionButtons[0]!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(232, 16, 24, 28));
    vi.spyOn(actionButtons[1]!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(248, 52, 24, 28));

    await act(async () => actionButtons[0]?.click());
    expect(document.body.querySelectorAll(".desktop-project-row-actions-menu")).toHaveLength(1);
    expect(actionButtons[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(projectRows[0]?.dataset.menuOpen).toBe("true");

    await act(async () => actionButtons[1]?.click());
    expect(document.body.querySelectorAll(".desktop-project-row-actions-menu")).toHaveLength(1);
    expect(actionButtons[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(actionButtons[1]?.getAttribute("aria-expanded")).toBe("true");
    expect(projectRows[0]?.dataset.menuOpen).toBeUndefined();
    expect(projectRows[1]?.dataset.menuOpen).toBe("true");
    let menu = document.body.querySelector<HTMLElement>(".desktop-project-row-actions-menu");
    expect(menu?.getAttribute("aria-label")).toContain("Beta");
    expect(menu?.style.left).toBe("248px");
    expect(menu?.style.top).toBe("84px");

    await act(async () => actionButtons[1]?.click());
    expect(document.body.querySelector(".desktop-project-row-actions-menu")).toBeNull();
    expect(actionButtons[1]?.getAttribute("aria-expanded")).toBe("false");
    expect(projectRows[1]?.dataset.menuOpen).toBeUndefined();

    await act(async () => actionButtons[1]?.click());
    menu = document.body.querySelector<HTMLElement>(".desktop-project-row-actions-menu");
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(menu?.classList.contains("desktop-sidebar-action-menu")).toBe(true);
    expect(menu?.dataset.menuTone).toBe("quiet");
    expect(menu?.dataset.menuElevation).toBe("compact");
    expect(menu?.dataset.menuTypographySurface).toBe("left-sidebar");
    expect(Array.from(menu?.querySelectorAll(".desktop-menu-item") ?? [], (item) => item.textContent))
      .toEqual(["Rename…", "Unlink…"]);

    await act(async () => menu?.querySelector<HTMLButtonElement>(".desktop-menu-item")?.click());
    const renameDialog = document.body.querySelector<HTMLElement>("[role='dialog']");
    expect(renameDialog?.textContent).toContain("Rename project");
    expect(renameDialog?.textContent).toContain("The local folder stays the same.");
    const nameInput = renameDialog?.querySelector<HTMLInputElement>("input");
    expect(nameInput?.value).toBe("Beta");
    await act(async () => {
      if (!nameInput) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(nameInput, "Research Notes");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const renameSubmit = renameDialog?.querySelector<HTMLButtonElement>("button[type='submit']");
    await act(async () => renameSubmit?.click());
    expect(onRenameProject).toHaveBeenCalledWith(beta.path, "Research Notes");
    expect(document.body.querySelector("[role='dialog']")).toBeNull();

    await act(async () => actionButtons[1]?.click());
    const unlinkMenu = document.body.querySelector<HTMLElement>(".desktop-project-row-actions-menu");
    const unlinkItem = [...(unlinkMenu?.querySelectorAll<HTMLButtonElement>(".desktop-menu-item") ?? [])]
      .find((item) => item.textContent === "Unlink…");
    await act(async () => unlinkItem?.click());
    const unlinkDialog = document.body.querySelector<HTMLElement>("[role='dialog']");
    expect(unlinkDialog?.textContent).toContain("Local files will stay on disk.");
    const unlinkButton = [...(unlinkDialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent === "Unlink");
    await act(async () => unlinkButton?.click());
    expect(onUnlinkProject).toHaveBeenCalledWith(beta.path);
  });

  it("keeps Project actions out of the compact rail and clamps the expanded menu to the viewport", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        recentWorkspaces={[]}
        projectItems={localCatalog(active, [])}
        onCreateNew={() => undefined}
        onRenameProject={async () => undefined}
        onSelectProject={() => undefined}
        onUnlinkProject={async () => undefined}
      />,
    )));

    expect(host.querySelector(".desktop-project-switcher-row-action")).toBeNull();
    expect(resolveDesktopSidebarActionMenuPosition(
      { left: 232, bottom: 48 },
      { menuWidth: 184, estimatedHeight: 82, viewportWidth: 1_000, viewportHeight: 800 },
    )).toEqual({
      top: 52,
      left: 232,
    });
    expect(resolveDesktopSidebarActionMenuPosition(
      { left: 990, bottom: 790 },
      { menuWidth: 184, estimatedHeight: 82, viewportWidth: 1_000, viewportHeight: 800 },
    )).toEqual({
      top: 706,
      left: 804,
    });
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
        projectItems={localCatalog(active, [])}
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

  it("keeps app-level Plugins, Settings, and Feedback utilities at the bottom of the expanded rail", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const onOpenPlugins = vi.fn();
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
        projectItems={localCatalog(active, [])}
        onCreateNew={() => undefined}
        onOpenPlugins={onOpenPlugins}
        onOpenSettings={onOpenSettings}
        pluginsOpen
        settingsOpen
        onSelectProject={() => undefined}
        utilitySlot={<button type="button" data-testid="feedback">Feedback</button>}
      />,
    )));

    const utilities = host.querySelector(".desktop-project-switcher-rail-utilities");
    const plugins = utilities?.querySelector<HTMLButtonElement>("[data-navigation-item='plugins']");
    const settings = utilities?.querySelector<HTMLButtonElement>("[data-navigation-item='settings']");
    const feedback = utilities?.querySelector<HTMLButtonElement>("[data-testid='feedback']");
    expect(utilities?.parentElement?.classList.contains("desktop-project-switcher-rail")).toBe(true);
    expect(utilities?.classList.contains("desktop-sidebar-navigation-surface")).toBe(true);
    expect(utilities?.getAttribute("data-placement")).toBe("bottom");
    expect(plugins?.classList.contains("desktop-sidebar-footer-button")).toBe(true);
    expect(plugins?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(plugins?.getAttribute("aria-expanded")).toBe("true");
    expect(plugins?.getAttribute("aria-label")).toBe("Plugins");
    expect(settings?.classList.contains("desktop-sidebar-footer-button")).toBe(true);
    expect(settings?.hasAttribute("aria-current")).toBe(false);
    expect(settings?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(settings?.getAttribute("aria-expanded")).toBe("true");
    expect(settings?.getAttribute("aria-label")).toBe("Settings");
    expect(settings?.querySelector(".desktop-sidebar-nav-label")).toBeNull();
    expect(feedback?.textContent).toBe("Feedback");

    await act(async () => plugins?.click());
    await act(async () => settings?.click());
    expect(onOpenPlugins).toHaveBeenCalledOnce();
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
        projectItems={localCatalog(active, [])}
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

  it("uses the shared catalog and de-duplicates catalog identities", () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const catalog = localCatalog(active, [{ workspace: beta }]);
    const items = resolveProjectSwitcherRailItems(active, [{ workspace: beta }, { workspace: active }],
      [...catalog, catalog[0]!]);

    expect(items.map((item) => item.item.localPath)).toEqual([
      "/projects/alpha",
      "/projects/beta",
    ]);
    expect(items.map((item) => item.initial)).toEqual(["A", "B"]);
  });

  it("renders all three Homepage project types and routes hosted-only rows without local file actions", async () => {
    const local = workspace("local", "Local", "/projects/local");
    const linked = workspace("linked", "Linked", "/projects/linked");
    const items: ProjectHomeItem[] = [
      { id: "local:local", label: "Local", localPath: local.path },
      { id: "local:linked", label: "Linked", localPath: linked.path, cloudProjectId: "linked-cloud" },
      { id: "cloud:hosted", label: "Hosted", localPath: "", cloudProjectId: "hosted" },
    ];
    const selectLocal = vi.fn(), selectCloud = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const renderRail = (expanded: boolean, activeCloudProjectId?: string) => withTestLocalization(
      <ProjectSwitcherRail activeWorkspace={local} activeCloudProjectId={activeCloudProjectId}
        expanded={expanded} recentWorkspaces={[{ workspace: linked }]} projectItems={items}
        onSelectProject={selectLocal} onSelectCloudProject={selectCloud}
        onCreateNew={() => undefined} onRenameProject={async () => undefined} onUnlinkProject={async () => undefined} />,
    );
    await act(async () => root?.render(renderRail(true)));
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".desktop-project-switcher-rail-project")];
    expect(rows.map(row => row.dataset.contextAssetKind)).toEqual(["local", "linked", "cloud"]);
    expect(rows[0]?.querySelector('[data-project-location="local"] [data-product-icon="local"]')).not.toBeNull();
    expect(rows[1]?.querySelector('[data-project-location="linked"] .onboarding-project-cloud-badge')).not.toBeNull();
    expect(rows[2]?.querySelector('[data-project-location="cloud"] .desktop-cloud-icon')).not.toBeNull();
    expect(rows[1]?.getAttribute("aria-label")).toContain("Local folder + Cloud project");
    // Read the rendered attribute: the DOM test environment does not reflect `draggable`.
    expect(rows[2]?.getAttribute("draggable")).toBe("false");
    expect(rows[2]?.closest(".desktop-project-switcher-rail-project-row")?.querySelector(".desktop-project-switcher-row-action")).toBeNull();
    expect(rows[1]?.getAttribute("draggable")).toBe("true");
    await act(async () => rows[1]?.click());
    expect(selectLocal).toHaveBeenCalledExactlyOnceWith(linked.path);
    await act(async () => rows[2]?.click());
    expect(selectCloud).toHaveBeenCalledExactlyOnceWith("hosted");
    await act(async () => root?.render(renderRail(false, "hosted")));
    const compactRows = [...host.querySelectorAll<HTMLButtonElement>(".desktop-project-switcher-rail-project")];
    expect(compactRows.map(row => row.dataset.contextAssetKind)).toEqual(["local", "linked", "cloud"]);
    expect(compactRows[2]?.getAttribute("aria-current")).toBe("page");
    expect(compactRows[0]?.hasAttribute("aria-current")).toBe(false);
    expect(compactRows[1]?.querySelector(".onboarding-project-cloud-badge")).not.toBeNull();
  });

  it("lists Projects without a way back to a second Project list", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    for (const expanded of [true, false]) {
      await act(async () => root?.render(withTestLocalization(
        <ProjectSwitcherRail
          activeWorkspace={active}
          expanded={expanded}
          recentWorkspaces={[]}
          projectItems={localCatalog(active, [])}
          onCreateNew={() => undefined}
          onSelectProject={() => undefined}
        />,
      )));
      const buttons = [...host.querySelectorAll<HTMLButtonElement>(".desktop-project-switcher-rail-button")];
      expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
        "Project: ⁨Alpha⁩ · Local folder",
        "New workspace",
      ]);
      expect(host.querySelector(".desktop-project-switcher-rail-home")).toBeNull();
      expect(host.querySelector(".po-directional-icon")).toBeNull();
    }
  });

  it("states only the Cloud place on rows, and never in the compact rail", async () => {
    const local = workspace("local", "Local", "/projects/local");
    const linked = workspace("linked", "Linked", "/projects/linked");
    const items: ProjectHomeItem[] = [
      { id: "local:local", label: "Local", localPath: local.path },
      { id: "local:linked", label: "Linked", localPath: linked.path, cloudProjectId: "linked-cloud" },
      { id: "cloud:hosted", label: "Hosted", localPath: "", cloudProjectId: "hosted" },
    ];
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const renderRail = (expanded: boolean, activeCloudProjectId?: string) => withTestLocalization(
      <ProjectSwitcherRail activeWorkspace={local} activeCloudProjectId={activeCloudProjectId}
        expanded={expanded} recentWorkspaces={[{ workspace: linked }]} projectItems={items}
        onCreateNew={() => undefined} onSelectProject={() => undefined} onSelectCloudProject={() => undefined} />,
    );

    await act(async () => root?.render(renderRail(true)));
    const placed = [...host.querySelectorAll<HTMLElement>(".desktop-project-switcher-rail-project-row")]
      .map((row) => Boolean(row.querySelector(".desktop-project-switcher-rail-place")));
    expect(placed).toEqual([false, false, true]);
    expect(host.querySelector(".desktop-project-switcher-rail-place .desktop-cloud-icon")).not.toBeNull();
    expect(host.querySelector(".desktop-project-switcher-rail-place")?.getAttribute("aria-hidden")).toBe("true");

    // Working on the linked Project in the Cloud moves the place with it.
    await act(async () => root?.render(renderRail(true, "linked-cloud")));
    expect([...host.querySelectorAll<HTMLElement>(".desktop-project-switcher-rail-project-row")]
      .map((row) => Boolean(row.querySelector(".desktop-project-switcher-rail-place")))).toEqual([false, true, true]);

    await act(async () => root?.render(renderRail(false)));
    expect(host.querySelector(".desktop-project-switcher-rail-place")).toBeNull();
  });

  it("derives a row's place from the Project itself and the surface it is open on", () => {
    const localOnly: ProjectHomeItem = { id: "local:a", label: "A", localPath: "/projects/a" };
    const hosted: ProjectHomeItem = { id: "cloud:b", label: "B", localPath: "", cloudProjectId: "b" };
    expect(resolveProjectRowPlace(localOnly, false)).toBe("local");
    expect(resolveProjectRowPlace(localOnly, true)).toBe("cloud");
    expect(resolveProjectRowPlace(hosted, false)).toBe("cloud");
  });

  it("carries the Local / Cloud switch in the open Project's row menu only", async () => {
    const active = workspace("active", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        activeProjectLocationControls={<button type="button" data-testid="place-switch">This Mac</button>}
        expanded
        recentWorkspaces={[{ workspace: beta }]}
        projectItems={localCatalog(active, [{ workspace: beta }])}
        onCreateNew={() => undefined}
        onRenameProject={async () => undefined}
        onSelectProject={() => undefined}
        onUnlinkProject={async () => undefined}
      />,
    )));

    const actions = host.querySelectorAll<HTMLButtonElement>(".desktop-project-switcher-row-action");
    await act(async () => actions[1]?.click());
    expect(document.body.querySelector("[data-testid='place-switch']")).toBeNull();

    await act(async () => actions[0]?.click());
    const menu = document.body.querySelector<HTMLElement>(".desktop-project-row-actions-menu");
    const place = menu?.querySelector<HTMLButtonElement>("[data-testid='place-switch']");
    expect(place).not.toBeNull();
    expect(place?.closest(".desktop-project-row-actions-location")).not.toBeNull();

    // Choosing a place acts on the open Project, so the session ends with it.
    await act(async () => place?.click());
    expect(document.body.querySelector(".desktop-project-row-actions-menu")).toBeNull();
  });

  it("omits hints for Project initials and expanded labels while hinting the icon-only create action", async () => {
    const active = workspace("active", "Alpha Project", "/projects/alpha");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        recentWorkspaces={[]}
        projectItems={localCatalog(active, [])}
        onCreateNew={() => undefined}
        onSelectProject={() => undefined}
      />,
    )));

    const compactRow = host.querySelector<HTMLButtonElement>(
      ".desktop-project-switcher-rail-project",
    );
    expect(compactRow?.textContent).toContain("A");
    expect(compactRow?.hasAttribute("data-tooltip")).toBe(false);
    expect(compactRow?.hasAttribute("title")).toBe(false);
    const create = host.querySelector<HTMLButtonElement>(".desktop-project-switcher-rail-create");
    expect(create?.dataset.tooltip).toBe("New workspace");
    expect(create?.dataset.tooltipPlacement).toBe("right");
    expect(create?.hasAttribute("title")).toBe(false);

    await act(async () => root?.render(withTestLocalization(
      <ProjectSwitcherRail
        activeWorkspace={active}
        expanded
        recentWorkspaces={[]}
        projectItems={localCatalog(active, [])}
        onCreateNew={() => undefined}
        onSelectProject={() => undefined}
      />,
    )));
    expect(host.querySelector<HTMLButtonElement>(".desktop-project-switcher-rail-project")?.dataset.tooltip).toBeUndefined();
    expect(host.querySelector<HTMLButtonElement>(".desktop-project-switcher-rail-create")?.hasAttribute("data-tooltip")).toBe(false);
  });

  it("derives a stable Unicode grapheme from the Project identity", () => {
    expect(getProjectSwitcherInitial("  项目", "/projects/fallback")).toBe("项");
    expect(getProjectSwitcherInitial("🧠 Lab", "/projects/fallback")).toBe("🧠");
    expect(getProjectSwitcherInitial("", "/projects/traction")).toBe("T");
  });

  it("preserves existing slots when the active and recent Project order changes", () => {
    const alpha = workspace("alpha", "Alpha", "/projects/alpha");
    const beta = workspace("beta", "Beta", "/projects/beta");
    const initialCatalog = resolveProjectSwitcherRailItems(alpha, [{ workspace: beta }], localCatalog(alpha, [{ workspace: beta }]));
    const initialOrder = initialCatalog.map(({ item }) => item.id);
    const reorderedCatalog = resolveProjectSwitcherRailItems(beta, [{ workspace: beta }, { workspace: alpha }], localCatalog(beta, [{ workspace: alpha }]));

    expect(mergeProjectSwitcherRailOrder(initialOrder, reorderedCatalog)).toEqual([
      "local:/projects/alpha",
      "local:/projects/beta",
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
          projectItems={localCatalog(activeWorkspace, recentWorkspaces)}
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
        projectItems={localCatalog(active, [{ workspace: beta }])}
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
    expect(buttons[0]?.querySelector('.desktop-project-switcher-rail-compact-context-avatar [data-product-icon="local"]')).not.toBeNull();
    expect(buttons[1]?.querySelector('.desktop-project-switcher-rail-compact-context-avatar [data-product-icon="local"]')).not.toBeNull();
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

    function NavigationHost() {
      const navigation = useProjectNavigation({ open: async target => {
        if (target.kind === "local") await onSelectProject(target.path);
      }, onError: error => { throw error; } });
      return <ProjectSwitcherRail activeWorkspace={alpha}
        recentWorkspaces={[{ workspace: beta }, { workspace: gamma }]}
        projectItems={localCatalog(alpha, [{ workspace: beta }, { workspace: gamma }])}
        pendingProject={navigation.pending} onCreateNew={() => undefined}
        onSelectProject={path => navigation.select({ kind: "local", path })} />;
    }
    await act(async () => root?.render(withTestLocalization(<NavigationHost />)));

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
        projectItems={localCatalog(active, [])}
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
    const onImport = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectEntryLauncherDialog
        canCreateProject
        canImport
        onClose={() => undefined}
        onOpenFolder={onOpenFolder}
        onCreateProject={onCreateProject}
        onImport={onImport}
      />,
    )));

    const options = host.querySelectorAll<HTMLButtonElement>(".desktop-project-entry-option");
    expect(options).toHaveLength(3);
    expect(Array.from(
      options[2]?.querySelectorAll<HTMLImageElement>(".onboarding-import-mark") ?? [],
      (mark) => mark.dataset.importBrand,
    )).toEqual(["github", "gitlab"]);
    await act(async () => options[0]?.click());
    await act(async () => options[1]?.click());
    await act(async () => options[2]?.click());
    expect(onOpenFolder).toHaveBeenCalledOnce();
    expect(onCreateProject).toHaveBeenCalledOnce();
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("hands the in-project launcher off to the shared Import flow", async () => {
    const onImportSource = vi.fn(async () => true);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withTestLocalization(
      <ProjectEntryFlowHarness onImportSource={onImportSource} />,
    )));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-open-project-entry]")?.click());

    const launcherOptions = host.querySelectorAll<HTMLButtonElement>(
      ".desktop-project-entry-option",
    );
    expect(launcherOptions).toHaveLength(3);
    await act(async () => launcherOptions[2]?.click());

    expect(host.querySelector(".desktop-project-entry-launcher")).toBeNull();
    expect(host.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import");
    expect(host.querySelectorAll(".onboarding-import-source")).toHaveLength(2);
    expect(onImportSource).not.toHaveBeenCalled();
  });
});

function ProjectEntryFlowHarness({
  onImportSource,
}: {
  onImportSource: () => Promise<boolean>;
}) {
  const controller = useProjectEntryFlow();
  return (
    <>
      <button type="button" data-open-project-entry onClick={controller.openLauncher}>
        Open Project setup
      </button>
      <ProjectEntryFlow
        controller={controller}
        onOpenFolder={() => undefined}
        onChooseLocation={async () => null}
        onCreateProject={async () => {
          throw new Error("not used");
        }}
        onImportSource={onImportSource}
        onConnectSource={async () => ({ connectionId: "test" })}
        onListResources={async () => ({ items: [], nextCursor: null })}
        onCancelImport={async () => ({ cancelled: true })}
        onImportProgress={() => () => undefined}
      />
    </>
  );
}

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

function localCatalog(active: Workspace, recent: readonly RecentWorkspaceHomeItem[]): ProjectHomeItem[] {
  const local = [...new Map([{ workspace: active }, ...recent].map(item => [item.workspace.path, item])).values()];
  return buildHomepageProjects({ local, cloud: [], apiBaseUrl: "https://api.puppyone.ai" });
}
