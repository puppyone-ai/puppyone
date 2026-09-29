import { gitStatus } from "../../../support/source-control/gitFixtures";
/**
 * @vitest-environment happy-dom
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceFolder } from "../../../../packages/shared-ui/src/core/workbenchWorkspace";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import { DesktopWorkspaceSwitcher } from "../../../../src/features/app-shell/DesktopWorkspaceSwitcher";
import type { GitBranchSummary } from "../../../../src/types/electron";
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

describe("titlebar Portal menu interactions", () => {
  it("keeps the current location stable while the alternate Cloud row changes from setup to switch", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const workspace = createWorkspace("one", "Workspace one");
    const onSetupCloud = vi.fn();
    const onSwitchToCloud = vi.fn();

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopWorkspaceSwitcher
          open
          refObject={createRef<HTMLDivElement>()}
          titlebarLabel={workspace.name}
          workspace={workspace}
          workspaceFolders={[createWorkspaceFolder(workspace)]}
          multiRootWorkspacesEnabled={false}
          projectLocation={{ current: "local", localAvailable: true, cloudState: "unavailable" }}
          onClose={vi.fn()}
          onGoHome={vi.fn()}
          onSetupCloud={onSetupCloud}
          onToggle={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    const projectButton = container.querySelector<HTMLButtonElement>(".desktop-titlebar-workspace-button");
    expect(projectButton?.querySelector(".lucide-laptop")).not.toBeNull();
    expect(projectButton?.getAttribute("aria-label")).toContain("This Mac");
    expect(container.querySelector(".desktop-titlebar-project-location")).toBeNull();
    const currentProject = requireMenu().querySelector<HTMLElement>(".desktop-project-current-location[data-project-location='local']");
    expect(currentProject?.querySelector(".lucide-laptop")).not.toBeNull();
    expect(currentProject?.textContent).not.toContain("Workspace one");
    expect(currentProject?.textContent).toContain("This Mac");
    expect(currentProject?.textContent).toContain("Online");
    expect(currentProject?.querySelector(".desktop-project-location-dot")).not.toBeNull();
    expect(currentProject?.querySelector(".desktop-project-current-location-status"))
      .not.toBeNull();
    const setup = requireMenu().querySelector<HTMLButtonElement>("[data-location-action='setup']");
    expect(setup?.textContent).toContain("Make it always available to Agents");
    expect(setup?.textContent).not.toContain("24/7");
    expect(setup?.textContent).not.toContain("Even when this Mac is offline.");
    expect(setup?.textContent).not.toContain("Set up");
    expect(setup?.querySelector(".lucide-cloud")).not.toBeNull();
    expect(setup?.querySelector(".lucide-chevron-right")).not.toBeNull();
    act(() => setup?.click());
    expect(onSetupCloud).toHaveBeenCalledOnce();

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopWorkspaceSwitcher
          open
          refObject={createRef<HTMLDivElement>()}
          titlebarLabel={workspace.name}
          workspace={workspace}
          workspaceFolders={[createWorkspaceFolder(workspace)]}
          multiRootWorkspacesEnabled={false}
          projectLocation={{ current: "local", localAvailable: true, cloudState: "available" }}
          onClose={vi.fn()}
          onGoHome={vi.fn()}
          onSwitchToCloud={onSwitchToCloud}
          onToggle={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    expect(container.querySelector(".desktop-titlebar-workspace-button .lucide-laptop")).not.toBeNull();
    const cloudAction = requireMenu().querySelector<HTMLButtonElement>("[data-location-action='switch']");
    expect(cloudAction?.querySelector(".lucide-cloud")).not.toBeNull();
    expect(cloudAction?.textContent).toContain("Cloud");
    expect(cloudAction?.textContent).toContain("Available");
    expect(cloudAction?.textContent).toContain("Switch");
    act(() => cloudAction?.click());
    expect(onSwitchToCloud).toHaveBeenCalledOnce();

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopWorkspaceSwitcher
          open
          refObject={createRef<HTMLDivElement>()}
          titlebarLabel={workspace.name}
          workspace={workspace}
          workspaceFolders={[createWorkspaceFolder(workspace)]}
          multiRootWorkspacesEnabled={false}
          projectLocation={{ current: "local", localAvailable: true, cloudState: "signed-out" }}
          onClose={vi.fn()}
          onGoHome={vi.fn()}
          onSwitchToCloud={onSwitchToCloud}
          onToggle={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    const signedOutCloudAction = requireMenu()
      .querySelector<HTMLButtonElement>("[data-location-action='signed-out']");
    expect(signedOutCloudAction?.textContent).toContain("Make it always available to Agents");
    expect(signedOutCloudAction?.textContent).not.toContain("Sign in to access");
    expect(signedOutCloudAction?.textContent).not.toContain("Switch");
    expect(signedOutCloudAction?.querySelector(".lucide-cloud")).not.toBeNull();
    expect(signedOutCloudAction?.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(signedOutCloudAction?.querySelector(".desktop-project-location-dot")).toBeNull();
    act(() => signedOutCloudAction?.click());
    expect(onSwitchToCloud).toHaveBeenCalledTimes(2);
  });

  it("keeps workspace menu actions clickable outside the native Header tree", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const anchorRef = createRef<HTMLDivElement>();
    const onGoHome = vi.fn();
    const onClose = vi.fn();
    const onAddProject = vi.fn();
    const onAddExistingProject = vi.fn();
    const workspace = createWorkspace("one", "Workspace one");
    const secondWorkspace = createWorkspace("two", "Workspace two");
    const thirdWorkspace = createWorkspace("three", "Workspace three");

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopWorkspaceSwitcher
          open
          refObject={anchorRef}
          titlebarLabel={workspace.name}
          workspace={workspace}
          workspaceFolders={[
            createWorkspaceFolder(workspace),
            createWorkspaceFolder(secondWorkspace, { index: 1 }),
          ]}
          availableProjects={[workspace, secondWorkspace, thirdWorkspace]}
          multiRootWorkspacesEnabled
          onAddExistingProject={onAddExistingProject}
          onOpenFolder={onAddProject}
          onClose={onClose}
          onGoHome={onGoHome}
          onToggle={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    const menu = requireMenu();
    expect(container.contains(menu)).toBe(false);
    expect(menu.dataset.windowNoDrag).toBe("true");
    expect(menu.style.width).toBe("280px");
    expect(menu.querySelector("[data-workspace-menu-layout='workspace-composition-v1']"))
      .not.toBeNull();
    expect(menu.textContent).toContain("Home");
    expect(menu.textContent).toContain("Add Project…");
    expect(menu.textContent).not.toContain("Open Folder in New Window…");
    expect(menu.textContent).not.toContain("Workspace one");
    expect(menu.textContent).toContain("Workspace two");
    expect(menu.textContent).not.toContain("Current workspace");
    expect(menu.textContent).not.toContain("Recent projects");
    expect(menu.querySelector(".desktop-project-home-group")).not.toBeNull();
    expect(menu.querySelector(".desktop-project-current-indicator")).toBeNull();
    expect(menu.querySelector(".desktop-project-option.selected")).toBeNull();
    expect(menu.querySelector("[aria-current='true']")).toBeNull();
    expect(menu.querySelector(".desktop-project-copy-path")).toBeNull();
    expect(menu.querySelector(".desktop-project-option")?.getAttribute("aria-disabled"))
      .toBe("true");
    const homeButton = menu.querySelector<HTMLButtonElement>(".desktop-project-home");
    act(() => {
      homeButton?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      homeButton?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      homeButton?.click();
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => menu.querySelector<HTMLButtonElement>(".desktop-project-add-folder")?.click());
    expect(menu.textContent).toContain("Projects");
    expect(menu.textContent).toContain("Workspace three");
    expect(menu.textContent).toContain("Open Folder…");
    act(() => Array.from(menu.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Workspace three"))?.click());
    act(() => menu.querySelector<HTMLButtonElement>(".desktop-project-add-folder")?.click());

    expect(onGoHome).toHaveBeenCalledOnce();
    expect(onAddProject).toHaveBeenCalledOnce();
    expect(onAddExistingProject).toHaveBeenCalledWith(thirdWorkspace.path);
  });

  it("dismisses a titlebar menu when the user points outside it", async () => {
    const container = document.createElement("div");
    const titlebarDragRegion = document.createElement("div");
    titlebarDragRegion.dataset.windowDragRegion = "true";
    document.body.append(container, titlebarDragRegion);
    root = createRoot(container);
    const onClose = vi.fn();

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopWorkspaceSwitcher
          open
          refObject={createRef<HTMLDivElement>()}
          titlebarLabel="Workspace one"
          workspace={createWorkspace("one", "Workspace one")}
          workspaceFolders={[]}
          multiRootWorkspacesEnabled
          onClose={onClose}
          onGoHome={vi.fn()}
          onToggle={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    expect(requireMenu().querySelector<HTMLButtonElement>(".desktop-project-add-folder")?.disabled)
      .toBe(true);
    act(() => {
      requireMenu().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      titlebarDragRegion.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hides Project composition actions while the experiment is off", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopWorkspaceSwitcher
          open
          refObject={createRef<HTMLDivElement>()}
          titlebarLabel="Workspace one"
          workspace={createWorkspace("one", "Workspace one")}
          workspaceFolders={[]}
          multiRootWorkspacesEnabled={false}
          onAddExistingProject={vi.fn()}
          onOpenFolder={vi.fn()}
          onClose={vi.fn()}
          onGoHome={vi.fn()}
          onToggle={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    const menu = requireMenu();
    expect(menu.textContent).not.toContain("Add Project…");
    expect(menu.textContent).not.toContain("Open Folder…");
    expect(menu.querySelector(".desktop-project-add-folder")).toBeNull();
  });

  it("executes branch checkout from the Portal menu and closes after success", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onCheckoutBranch = vi.fn(async () => true);
    const onCloseBranchSwitcher = vi.fn();
    const branch = createBranch("feature/menu");

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopTitlebarContext availableProjects={[]}
          activeGitStatus={createGitStatus()}
          branchSwitcherOpen
          branchSwitcherRef={createRef<HTMLDivElement>()}
          gitStatusLoading={false}
          gitOperationLoading={null}
          localBranches={[branch]}
          remoteBranches={[]}
          workspace={createWorkspace("one", "Workspace one")}
          workspaceFolders={[]}
          multiRootWorkspacesEnabled={false}
          workspaceSwitcherOpen={false}
          workspaceSwitcherRef={createRef<HTMLDivElement>()}
          onCheckoutBranch={onCheckoutBranch}
          onCloseBranchSwitcher={onCloseBranchSwitcher}
          onCloseWorkspaceSwitcher={vi.fn()}
          onGoHome={vi.fn()}
          onAddProject={vi.fn()}
          onAddExistingProject={vi.fn()}
          onToggleBranchSwitcher={vi.fn()}
          onToggleWorkspaceSwitcher={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    const button = requireMenu().querySelector<HTMLButtonElement>(".desktop-branch-menu-row");
    if (!button) throw new Error("Missing branch menu action");
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(onCheckoutBranch).toHaveBeenCalledWith("feature/menu", false);
    expect(onCloseBranchSwitcher).toHaveBeenCalledOnce();
  });

  it("reserves branch space without rendering Loading copy during initial Git hydration", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopTitlebarContext availableProjects={[]}
          activeGitStatus={null}
          branchSwitcherOpen={false}
          branchSwitcherRef={createRef<HTMLDivElement>()}
          gitStatusLoading
          gitOperationLoading={null}
          localBranches={[]}
          remoteBranches={[]}
          workspace={createWorkspace("one", "Workspace one")}
          workspaceFolders={[]}
          multiRootWorkspacesEnabled={false}
          workspaceSwitcherOpen={false}
          workspaceSwitcherRef={createRef<HTMLDivElement>()}
          onCheckoutBranch={vi.fn(async () => false)}
          onCloseBranchSwitcher={vi.fn()}
          onCloseWorkspaceSwitcher={vi.fn()}
          onGoHome={vi.fn()}
          onAddProject={vi.fn()}
          onAddExistingProject={vi.fn()}
          onToggleBranchSwitcher={vi.fn()}
          onToggleWorkspaceSwitcher={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    const branchButton = container.querySelector<HTMLButtonElement>(".desktop-titlebar-branch-button");
    expect(branchButton?.textContent).not.toContain("Loading");
    expect(branchButton?.querySelector(".desktop-titlebar-branch-placeholder")).not.toBeNull();
  });

  it("shows the local location mark and omits the Header Cloud entry from the project menu", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopTitlebarContext availableProjects={[]}
          activeGitStatus={createGitStatus()}
          branchSwitcherOpen={false}
          branchSwitcherRef={createRef<HTMLDivElement>()}
          gitStatusLoading={false}
          gitOperationLoading={null}
          localBranches={[]}
          remoteBranches={[]}
          workspace={createWorkspace("one", "Workspace one")}
          workspaceFolders={[]}
          multiRootWorkspacesEnabled={false}
          workspaceSwitcherOpen
          workspaceSwitcherRef={createRef<HTMLDivElement>()}
          onCheckoutBranch={vi.fn(async () => false)}
          onCloseBranchSwitcher={vi.fn()}
          onCloseWorkspaceSwitcher={vi.fn()}
          onGoHome={vi.fn()}
          onAddProject={vi.fn()}
          onAddExistingProject={vi.fn()}
          onToggleBranchSwitcher={vi.fn()}
          onToggleWorkspaceSwitcher={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    const workspaceButton = container.querySelector<HTMLButtonElement>(".desktop-titlebar-workspace-button");
    expect(workspaceButton?.querySelector('.lucide-laptop')).not.toBeNull();
    expect(workspaceButton?.querySelector('.lucide-folder-closed')).toBeNull();
    expect(workspaceButton?.getAttribute("aria-label")).toContain("This Mac");
    expect(container.querySelector(".desktop-titlebar-cloud-button")).toBeNull();
    expect(requireMenu().querySelector(".desktop-project-cloud")).toBeNull();
    expect(requireMenu().textContent).not.toContain("Cloud");
    const currentLocation = requireMenu().querySelector(".desktop-project-current-location");
    expect(currentLocation?.textContent).toContain("This Mac");
    expect(currentLocation?.textContent).toContain("Online");
    expect(currentLocation?.querySelector(".desktop-project-location-dot")).not.toBeNull();
  });
});

function requireMenu(): HTMLElement {
  const menu = document.querySelector<HTMLElement>('[data-titlebar-context-menu="true"]');
  if (!menu) throw new Error("Missing titlebar Portal menu");
  return menu;
}

function createWorkspace(id: string, name: string) {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    status: "recording" as const,
  };
}

function createBranch(name: string): GitBranchSummary {
  return {
    name,
    current: false,
    remote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    lastCommitId: null,
    lastCommitMessage: null,
    lastCommitDate: null,
  };
}

function createGitStatus() {
  return gitStatus({ branch: "main" });
}
