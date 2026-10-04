import { gitStatus } from "../../../support/source-control/gitFixtures";
/**
 * @vitest-environment happy-dom
 */
import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceFolder } from "../../../../packages/shared-ui/src/core/workbenchWorkspace";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import { DesktopWorkspaceSwitcher } from "../../../../src/features/app-shell/DesktopWorkspaceSwitcher";
import type { GitBranchSummary } from "../../../../src/types/electron";
import { withTestLocalization } from "../../../support/react/localization";
import { CloudDialog } from "../../../../src/features/cloud/CloudDialog";
import { DesktopProjectLocationControls } from "../../../../src/features/app-shell/DesktopWorkspaceSwitcher";


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const devicePlatform = vi.hoisted(() => ({ value: "macos" as "macos" | "windows" | "linux" | null }));
vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({
  useDesktopPlatformCapabilities: () => devicePlatform.value ? { platform: devicePlatform.value } : null,
}));

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  devicePlatform.value = "macos";
});

describe("titlebar Portal menu interactions", () => {
  it.each([
    ["macos", "This Mac"], ["windows", "This computer"], ["linux", "This computer"], [null, "This computer"],
  ] as const)("names the current device on %s beside Cloud and a safe GitHub link", async (platform, label) => {
    devicePlatform.value = platform;
    const workspace = createWorkspace("one", "Workspace one");
    await renderSwitcher({
      workspace,
      projectLocation: { current: "local", localAvailable: true, cloudState: "available" },
      backupProviders: ["github", "gitlab"],
      backupStatus: gitStatus({ remotes: [{ name: "origin",
        fetchUrl: "https://github.com/team/project.git", pushUrl: null, branches: [] }] }),
      onViewCloud: vi.fn(),
    });
    const menu = requireMenu();
    expect(menu.getAttribute("role")).toBe("dialog");
    expect(menu.textContent).toBe(`${label}Cloud`);
    expect(document.querySelector(".desktop-titlebar-workspace-button")?.getAttribute("aria-label")).toContain(label);
    expect(locationButton("cloud").querySelector(".lucide-plus")).toBeNull();
    expect(menu.querySelectorAll("button")).toHaveLength(2);
    expect(menu.querySelectorAll("[aria-current='true']")).toHaveLength(1);
    expect(locationButton("local").getAttribute("aria-pressed")).toBe("true");
    expect(locationButton("cloud").getAttribute("aria-pressed")).toBe("false");
    expect(menu.querySelector("time")).toBeNull();
    expect(menu.querySelector("[data-backup-details]")).toBeNull();
    expect(menu.textContent).not.toContain(workspace.path);
    const link = menu.querySelector<HTMLAnchorElement>("a")!;
    expect(link.getAttribute("aria-label")).toBe("Open GitHub repository");
    expect(link.href).toBe("https://github.com/team/project");
    expect(link.textContent).toBe("");
    expect(link.querySelector(".desktop-project-github-mark")).not.toBeNull();
    expect(locationButton("cloud").compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([false, true])("offers Create Cloud for an unhosted project, with existing GitHub: %s", async (github) => {
    const actions: string[] = [];
    const onShare = vi.fn();
    await renderSwitcher({
      projectLocation: { current: "local", localAvailable: true, cloudState: "unavailable" },
      backupProviders: github ? ["github"] : [],
      backupStatus: github ? gitStatus({ remotes: [{ name: "origin",
        fetchUrl: "https://github.com/team/project.git", pushUrl: null, branches: [] }] }) : null,
      onClose: () => actions.push("close"), onViewCloud: () => actions.push("initialize"), onShare,
    });
    const create = locationButton("cloud");
    expect(create.textContent).toBe("Create Cloud");
    expect(create.querySelector(".lucide-plus")).not.toBeNull();
    expect(create.getAttribute("data-cloud-action")).toBe("create");
    expect(create.hasAttribute("aria-pressed")).toBe(false);
    expect(locationButton("local").getAttribute("aria-pressed")).toBe("true");
    expect(Boolean(requireMenu().querySelector("a"))).toBe(github);
    expect(requireMenu().textContent).not.toContain("GitHub");
    act(() => create.click());
    expect(actions).toEqual(["close", "initialize"]);
    expect(onShare).not.toHaveBeenCalled();
    expect(locationButton("local").getAttribute("aria-pressed")).toBe("true");
  });

  it("changes creation into a switch when a Cloud version becomes available", async () => {
    const container = await renderSwitcher({ onViewCloud: vi.fn(),
      projectLocation: { current: "local", localAvailable: true, cloudState: "unavailable" } });
    expect(locationButton("cloud").textContent).toBe("Create Cloud");
    await act(async () => root?.render(withTestLocalization(
      <DesktopWorkspaceSwitcher open refObject={createRef<HTMLDivElement>()}
        titlebarLabel="Workspace one" workspace={createWorkspace("one", "Workspace one")}
        workspaceFolders={[]} multiRootWorkspacesEnabled={false}
        projectLocation={{ current: "local", localAvailable: true, cloudState: "available" }}
        onViewCloud={vi.fn()} onClose={vi.fn()} onToggle={vi.fn()} />,
    )));
    expect(locationButton("cloud").textContent).toBe("Cloud");
    expect(locationButton("cloud").hasAttribute("data-cloud-action")).toBe(false);
    expect(locationButton("cloud").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".desktop-titlebar-workspace-button .lucide-laptop")).not.toBeNull();
  });

  it("labels a linked but signed-out destination as authentication-required, not available Cloud", async () => {
    await renderSwitcher({ onViewCloud: vi.fn(),
      projectLocation: { current: "local", localAvailable: true, cloudState: "signed-out" } });
    expect(locationButton("cloud").textContent).toBe("Sign in to access");
    expect(locationButton("cloud").getAttribute("data-cloud-action")).toBeNull();
    expect(locationButton("cloud").disabled).toBe(false);
  });

  it.each(["resolving", "attention"] as const)("does not offer a new deployment while Cloud association is %s", async (cloudState) => {
    await renderSwitcher({ onViewCloud: vi.fn(),
      projectLocation: { current: "local", localAvailable: true, cloudState } });
    expect(locationButton("cloud").textContent).toBe("Cloud");
    expect(locationButton("cloud").hasAttribute("data-cloud-action")).toBe(false);
    expect(locationButton("cloud").disabled).toBe(cloudState === "resolving");
  });

  it.each([undefined, "unavailable", "available", "signed-out", "resolving", "attention"] as const)(
    "does not select Cloud just because the local project has a remote (%s)", async (cloudState) => {
      await renderSwitcher({
        workspace: { ...createWorkspace("one", "Workspace one"),
          puppyoneGitRemote: { origin: "https://cloud.example.com", projectId: "linked-project" } },
        projectLocation: cloudState ? { current: "local", localAvailable: true, cloudState } : undefined,
        onViewCloud: vi.fn(),
      });
      expect(document.querySelector(".desktop-titlebar-workspace-button .lucide-laptop")).not.toBeNull();
      expect(locationButton("local").getAttribute("aria-pressed")).toBe("true");
      expect(locationButton("cloud").disabled).toBe(cloudState === "resolving");
    },
  );

  it.each(["unavailable", "available", "signed-out", "attention"] as const)(
    "closes the menu before navigating to Cloud, independently of Share (%s)", async (cloudState) => {
      const actions: string[] = [];
      const onShare = vi.fn();
      await renderSwitcher({
        projectLocation: { current: "local", localAvailable: true, cloudState },
        onClose: () => actions.push("close"),
        onViewCloud: () => actions.push("cloud"),
        onShare,
      });
      act(() => locationButton("cloud").click());
      expect(actions).toEqual(["close", "cloud"]);
      expect(onShare).not.toHaveBeenCalled();
      // Selection changes only when the caller actually displays Cloud.
      expect(locationButton("local").getAttribute("aria-pressed")).toBe("true");
    },
  );

  it("does not offer a false switch when a destination is unavailable", async () => {
    const onLocal = vi.fn();
    const onCloud = vi.fn();
    const onClose = vi.fn();
    await renderSwitcher({
      projectLocation: { current: "cloud", localAvailable: false, cloudState: "available" },
      onViewLocal: onLocal, onViewCloud: onCloud, onClose,
    });
    expect(locationButton("local").disabled).toBe(true);
    act(() => locationButton("local").click());
    expect(onLocal).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    act(() => locationButton("cloud").click());
    expect(onCloud).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector(".desktop-titlebar-workspace-button .desktop-cloud-icon[data-cloud-icon=ant-design]")).not.toBeNull();
  });

  it("opens the GitHub push repository without navigating either project surface", async () => {
    const onLocal = vi.fn();
    const onCloud = vi.fn();
    const onClose = vi.fn();
    await renderSwitcher({
      backupProviders: ["github"],
      backupStatus: gitStatus({ remotes: [{ name: "origin",
        fetchUrl: "https://github.com/upstream/project.git",
        pushUrl: "git@github.com:team/fork.git", branches: [] }] }),
      onViewLocal: onLocal, onViewCloud: onCloud, onClose,
    });
    const link = requireMenu().querySelector<HTMLAnchorElement>("a")!;
    expect(link.href).toBe("https://github.com/team/fork");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    link.addEventListener("click", (event) => event.preventDefault());
    act(() => link.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onLocal).not.toHaveBeenCalled();
    expect(onCloud).not.toHaveBeenCalled();
  });

  it.each(["https://github.com.evil.example/team/project", "javascript:alert(1)", "https://gitlab.com/team/project"])(
    "hides the GitHub button without a recognized GitHub repository (%s)", async (fetchUrl) => {
      await renderSwitcher({ backupProviders: ["github"],
        backupStatus: gitStatus({ remotes: [{ name: "origin", fetchUrl, pushUrl: null, branches: [] }] }) });
      expect(requireMenu().querySelector("a")).toBeNull();
      expect(locationButton("cloud").disabled).toBe(true);
    },
  );

  it("switches Local → Cloud → Local through the Header and preserves the local editor", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const workspace = createWorkspace("one", "Workspace one");
    function Harness() {
      const [cloudOpen, setCloudOpen] = useState(false);
      const [menuOpen, setMenuOpen] = useState(true);
      const [draft, setDraft] = useState("Unsaved local draft");
      const location = { current: cloudOpen ? "cloud" as const : "local" as const,
        localAvailable: true, cloudState: "available" as const };
      return <>
        <input aria-label="Local draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <DesktopTitlebarContext availableProjects={[]} compactProjectMenu
          activeGitStatus={createGitStatus()} branchSwitcherOpen={false}
          branchSwitcherRef={createRef<HTMLDivElement>()} gitStatusLoading={false}
          gitOperationLoading={null} localBranches={[]} remoteBranches={[]}
          workspace={workspace} workspaceFolders={[]} multiRootWorkspacesEnabled={false}
          projectLocation={location} workspaceSwitcherOpen={menuOpen}
          workspaceSwitcherRef={createRef<HTMLDivElement>()}
          onCheckoutBranch={vi.fn(async () => true)} onCloseBranchSwitcher={vi.fn()}
          onCloseWorkspaceSwitcher={() => setMenuOpen(false)}
          onAddProject={vi.fn()} onAddExistingProject={vi.fn()}
          onViewLocal={() => setCloudOpen(false)} onViewCloud={() => setCloudOpen(true)}
          onToggleBranchSwitcher={vi.fn()} onToggleWorkspaceSwitcher={() => setMenuOpen((open) => !open)}
        />
        {cloudOpen && <CloudDialog sidebar={<nav>Cloud navigation</nav>} main={<div>Cloud project</div>}
          onClose={() => setCloudOpen(false)}
          locationControls={<DesktopProjectLocationControls projectLocation={location}
            onViewLocal={() => setCloudOpen(false)} onViewCloud={() => setCloudOpen(true)} />} />}
      </>;
    }
    await act(async () => root?.render(withTestLocalization(<Harness />)));
    const editor = container.querySelector<HTMLInputElement>("input")!;
    const project = container.querySelector<HTMLButtonElement>(".desktop-titlebar-workspace-button")!;
    expect(container.querySelector(".desktop-titlebar-branch-button")).toBeNull();
    await act(async () => locationButton("cloud").click());
    expect(document.querySelector("[data-titlebar-context-menu]")).toBeNull();
    const cloud = document.querySelector(".desktop-cloud-dialog")!;
    expect(cloud.querySelector("[data-project-location='cloud'][aria-pressed='true']")).not.toBeNull();
    expect(cloud.textContent).toContain("Cloud project");
    expect(project.querySelector(".desktop-cloud-icon[data-cloud-icon=ant-design]")).not.toBeNull();
    await act(async () => cloud.querySelector<HTMLButtonElement>("button[data-project-location='local']")!.click());
    expect(document.querySelector(".desktop-cloud-dialog")).toBeNull();
    expect(container.querySelector("input")).toBe(editor);
    expect(editor.value).toBe("Unsaved local draft");
    expect(project.querySelector(".lucide-laptop")).not.toBeNull();
    await act(async () => project.click());
    expect(locationButton("local").getAttribute("aria-pressed")).toBe("true");
  });

  it("preserves dismissal and keyboard focus in the compact project menu", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const workspace = { ...createWorkspace("one", "Workspace one"), puppyoneGitRemote: {
      origin: "https://cloud.example", projectId: "cloud-notes",
    } };
    const onToggle = vi.fn();
    const onClose = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <DesktopWorkspaceSwitcher
        open={open} refObject={createRef<HTMLDivElement>()} titlebarLabel={workspace.name}
        workspace={workspace} workspaceFolders={[]} multiRootWorkspacesEnabled={false}
        backupProviders={["github", "gitlab"]}
        cloudProject={{ id: "cloud-notes", name: "Notes on Cloud" }}
        onToggle={() => { onToggle(); setOpen((value) => !value); }}
        onClose={() => { onClose(); setOpen(false); }}
      />;
    }
    await act(async () => root?.render(withTestLocalization(<Harness />)));
    const project = container.querySelector<HTMLButtonElement>(".desktop-titlebar-workspace-button")!;
    expect(document.querySelector("[data-titlebar-context-menu]")).toBeNull();
    await act(async () => project.click());
    expect(onToggle).toHaveBeenCalledOnce();
    expect(requireMenu().textContent).toBe("This MacCloud");
    expect(project.getAttribute("aria-expanded")).toBe("true");
    act(() => requireMenu().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-titlebar-context-menu]")).toBeNull();
    expect(document.activeElement).toBe(project);
    await act(async () => project.click());
    await act(async () => project.click());
    expect(document.querySelector("[data-titlebar-context-menu]")).toBeNull();
    await act(async () => project.click());
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector("[data-titlebar-context-menu]")).toBeNull();
  });

  it("keeps workspace menu actions clickable outside the native Header tree", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const anchorRef = createRef<HTMLDivElement>();
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
          onToggle={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    const menu = requireMenu();
    expect(container.contains(menu)).toBe(false);
    expect(menu.dataset.windowNoDrag).toBe("true");
    expect(menu.style.width).toBe("248px");
    expect(menu.querySelector(".desktop-project-location-controls")).not.toBeNull();
    expect(menu.textContent).toContain("Add Project…");
    expect(menu.textContent).not.toContain("Open Folder in New Window…");
    expect(menu.textContent).not.toContain("Workspace one");
    expect(menu.textContent).toContain("Workspace two");
    expect(menu.textContent).not.toContain("Current workspace");
    expect(menu.textContent).not.toContain("Recent projects");
    expect(menu.querySelector(".desktop-project-home-group")).toBeNull();
    expect(menu.querySelector(".desktop-project-current-indicator")).toBeNull();
    expect(menu.querySelector(".desktop-project-option.selected")).toBeNull();
    expect(menu.querySelectorAll("[aria-current='true']")).toHaveLength(1);
    expect(menu.querySelector("[aria-current='true']")?.getAttribute("data-project-location")).toBe("local");
    expect(menu.querySelector("button.desktop-project-current-location-path")).toBeNull();
    expect(menu.querySelector(".desktop-project-copy-path")).toBeNull();
    expect(menu.querySelector(".desktop-project-option")?.getAttribute("aria-disabled"))
      .toBe("true");
    expect(onClose).not.toHaveBeenCalled();
    act(() => menu.querySelector<HTMLButtonElement>(".desktop-project-add-folder")?.click());
    expect(menu.textContent).toContain("Projects");
    expect(menu.textContent).toContain("Workspace three");
    expect(menu.textContent).toContain("Open Folder…");
    act(() => Array.from(menu.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Workspace three"))?.click());
    act(() => menu.querySelector<HTMLButtonElement>(".desktop-project-add-folder")?.click());

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

  it("keeps the local Header mark and disables Cloud when no navigation is provided", async () => {
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
    expect(requireMenu().textContent).toBe("This MacCloud");
    expect(locationButton("local").getAttribute("aria-pressed")).toBe("true");
    expect(locationButton("cloud").disabled).toBe(true);
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

function locationButton(location: "local" | "cloud"): HTMLButtonElement {
  const button = requireMenu().querySelector<HTMLButtonElement>(`button[data-project-location="${location}"]`);
  if (!button) throw new Error(`Missing ${location} switch`);
  return button;
}

async function renderSwitcher(props: Partial<Parameters<typeof DesktopWorkspaceSwitcher>[0]> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const workspace = createWorkspace("one", "Workspace one");
  await act(async () => root?.render(withTestLocalization(
    <DesktopWorkspaceSwitcher open refObject={createRef<HTMLDivElement>()}
      titlebarLabel={workspace.name} workspace={workspace} workspaceFolders={[]}
      multiRootWorkspacesEnabled={false} onClose={vi.fn()} onToggle={vi.fn()} {...props} />,
  )));
  return container;
}
