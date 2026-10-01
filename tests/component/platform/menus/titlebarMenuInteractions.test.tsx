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
import { writeClipboardText } from "../../../../src/lib/clipboard";

vi.mock("../../../../src/lib/clipboard", () => ({ writeClipboardText: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("titlebar Portal menu interactions", () => {
  it("identifies the local device while keeping the centered project card free of branch controls", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onCheckoutBranch = vi.fn(async () => true);
    const onClose = vi.fn();
    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopTitlebarContext
          compactProjectMenu availableProjects={[]}
          backupProviders={["github", "gitlab"]}
          backupStatus={gitStatus({
            remotes: [{ name: "origin", fetchUrl: "https://github.com/team/project.git", pushUrl: null, branches: ["main"] }],
            branches: [{ ...createBranch("origin/main"), remote: true, lastCommitId: "remote-commit",
              lastCommitDate: "2026-09-30T01:00:00Z", lastCommitMessage: "Update project notes" }],
            syncTarget: { remote: "origin", branch: "main", ref: "origin/main", exists: true,
              ahead: 2, behind: 0, incomingPreview: [], outgoingPreview: [] },
          })}
          activeGitStatus={createGitStatus()}
          branchSwitcherOpen={false}
          branchSwitcherRef={createRef<HTMLDivElement>()}
          gitStatusLoading={false} gitOperationLoading={null}
          localBranches={[createBranch("feature/menu")]} remoteBranches={[]}
          workspace={createWorkspace("one", "Workspace one")}
          workspaceFolders={[]} multiRootWorkspacesEnabled={false}
          workspaceSwitcherOpen workspaceSwitcherRef={createRef<HTMLDivElement>()}
          onCheckoutBranch={onCheckoutBranch}
          onCloseBranchSwitcher={vi.fn()} onCloseWorkspaceSwitcher={onClose}
          onAddProject={vi.fn()} onAddExistingProject={vi.fn()}
          onToggleBranchSwitcher={vi.fn()} onToggleWorkspaceSwitcher={vi.fn()}
        />,
      ));
    });
    expect(container.querySelector(".desktop-titlebar-branch-button")).toBeNull();
    const menu = requireMenu();
    expect(menu.querySelector(".desktop-project-branch")).toBeNull();
    expect(menu.querySelector(".desktop-project-current-location-mark .desktop-project-location-dot")).not.toBeNull();
    expect(menu.querySelector(".desktop-project-location-visual .lucide-laptop")).not.toBeNull();
    expect(menu.querySelector(".desktop-project-location-visual .lucide-cloud")).toBeNull();
    expect(menu.querySelector(".desktop-project-cloud-copy")).toBeNull();
    expect(menu.querySelector("[role='group'][aria-label='This Mac']")).not.toBeNull();
    expect(menu.textContent).not.toContain("main");
    expect(onCheckoutBranch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(menu.querySelector(".desktop-project-backup-services")).toBeNull();
    expect(container.querySelector(".desktop-titlebar-cloud-button")).toBeNull();
    expect(container.querySelector(".desktop-titlebar-workspace-wrap img")).toBeNull();
    expect(container.querySelector(".desktop-titlebar-workspace-wrap .desktop-project-github-mark")).toBeNull();
    expect(menu.querySelector("[role='group'][aria-label='Remote copies']")).not.toBeNull();
    expect(Array.from(requireMenu().querySelectorAll<HTMLElement>("[data-backup-details]"))
      .map((details) => details.dataset.backupDetails)).toEqual(["github", "gitlab"]);
    expect(requireMenu().querySelector("[data-backup-details='github'] time")?.getAttribute("dateTime"))
      .toBe("2026-09-30T01:00:00Z");
    expect(requireMenu().textContent).toContain("Last change:");
    expect(requireMenu().textContent).not.toContain("Update project notes");
    expect(requireMenu().textContent).not.toContain("2 commits to back up");
    expect(requireMenu().textContent).not.toContain("Remote version");
    expect(requireMenu().textContent).not.toContain("remote-commit");
    expect(requireMenu().textContent).not.toContain("Backup time not recorded");
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([undefined, "unavailable", "available", "signed-out", "resolving", "attention"] as const)(
    "keeps a Cloud-linked local working copy on this Mac with Share state %s",
    async (cloudState) => {
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      const workspace = {
        ...createWorkspace("one", "Workspace one"),
        path: "/Users/example/project/demo",
        puppyoneGitRemote: { origin: "https://cloud.example.com", projectId: "linked-project" },
      };
      vi.mocked(writeClipboardText).mockResolvedValue(undefined);
      await act(async () => {
        root?.render(withTestLocalization(
          <DesktopWorkspaceSwitcher
            open refObject={createRef<HTMLDivElement>()} titlebarLabel={workspace.name}
            workspace={workspace} workspaceFolders={[createWorkspaceFolder(workspace)]}
            multiRootWorkspacesEnabled={false}
            projectLocation={cloudState ? { current: "local", localAvailable: true, cloudState } : undefined}
            onClose={vi.fn()} onShare={vi.fn()} onToggle={vi.fn()}
          />,
        ));
      });
      const header = container.querySelector(".desktop-titlebar-workspace-button");
      expect(header?.querySelector(".lucide-laptop")).not.toBeNull();
      expect(header?.querySelector(".lucide-cloud")).toBeNull();
      expect(container.querySelector(".desktop-titlebar-cloud-button")).toBeNull();
      expect(container.querySelector(".desktop-titlebar-workspace-location-link")).toBeNull();
      expect(header?.getAttribute("aria-label")).toContain("This Mac");
      const menu = requireMenu();
      const location = menu.querySelector(".desktop-project-current-location");
      expect(location?.getAttribute("data-project-location")).toBe("local");
      expect(location?.querySelector(".desktop-project-current-location-mark .lucide-laptop")).not.toBeNull();
      expect(location?.querySelector(".lucide-cloud")).toBeNull();
      expect(location?.querySelector(".desktop-project-location-link")).toBeNull();
      expect(menu.querySelector(".desktop-project-cloud-copy")).toBeNull();
      expect(menu.textContent).not.toContain("Cloud copy");
      const path = location?.querySelector<HTMLButtonElement>(".desktop-project-current-location-path");
      expect(path?.textContent).toBe("~/project/demo");
      expect(path?.getAttribute("aria-label")).toBe(workspace.path);
      await act(async () => path?.click());
      expect(writeClipboardText).toHaveBeenLastCalledWith(workspace.path);
      expect(path?.getAttribute("data-copy-feedback")).toBe("copied");
      expect(Boolean(menu.querySelector("[data-location-action='share']"))).toBe(cloudState !== undefined);
    },
  );

  it("opens only the actual GitHub repository from the service heading and closes the card", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const workspace = createWorkspace("one", "Workspace one");
    const onClose = vi.fn();
    const onShare = vi.fn();
    await act(async () => root?.render(withTestLocalization(
      <DesktopWorkspaceSwitcher open refObject={createRef<HTMLDivElement>()}
        titlebarLabel={workspace.name} workspace={workspace} workspaceFolders={[]}
        multiRootWorkspacesEnabled={false} cloudProject={{ id: "cloud-notes" }}
        backupProviders={["github", "gitlab"]}
        backupStatus={gitStatus({ remotes: [{ name: "origin", fetchUrl: "https://github.com/team/source.git",
          pushUrl: "git@github.com:team/project.git", branches: [] }] })}
        onClose={onClose} onToggle={vi.fn()} onShare={onShare}
      />,
    )));
    const menu = requireMenu();
    const link = menu.querySelector<HTMLAnchorElement>("[data-backup-details='github'] a")!;
    expect(link.getAttribute("href")).toBe("https://github.com/team/project");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("aria-label")).toBe("Open GitHub repository");
    expect(link.querySelector(".lucide-external-link")).not.toBeNull();
    expect(menu.querySelector("[data-backup-details='puppyone-cloud'] a")).toBeNull();
    expect(menu.querySelector("[data-backup-details='gitlab'] a")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    act(() => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onShare).not.toHaveBeenCalled();
  });

  it("shows Cloud details below the local card with Share disabled and clears them on project change", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const linkedWorkspace = { ...createWorkspace("one", "Workspace one"), path: "/Users/example/project/local-notes" };
    const nextWorkspace = { ...createWorkspace("two", "Workspace two"), path: "/Users/example/project/other" };
    const renderProject = async (workspace: typeof linkedWorkspace, cloudProject?: { id: string; name: string }) => {
      await act(async () => {
        root?.render(withTestLocalization(
          <DesktopWorkspaceSwitcher
            open refObject={createRef<HTMLDivElement>()} titlebarLabel={workspace.name}
            workspace={workspace} workspaceFolders={[createWorkspaceFolder(workspace)]}
            multiRootWorkspacesEnabled={false} cloudProject={cloudProject}
            onClose={vi.fn()} onToggle={vi.fn()}
          />,
        ));
      });
    };
    await renderProject(linkedWorkspace, { id: "cloud-notes", name: "Remote Notes" });
    expect(container.querySelector(".desktop-titlebar-cloud-button")).toBeNull();
    const menu = requireMenu();
    const localCard = menu.querySelector(".desktop-project-current-location");
    expect(localCard?.querySelector(".lucide-laptop")).not.toBeNull();
    expect(localCard?.querySelector(".lucide-cloud")).toBeNull();
    expect(localCard?.textContent).toBe("~/project/local-notes");
    expect(menu.querySelector("[data-location-action='share']")).toBeNull();
    expect(requireMenu().getAttribute("role")).toBe("menu");
    expect(requireMenu().querySelector("[data-backup-details='puppyone-cloud']")?.textContent).toBe("PuppyOne Cloud");
    expect(requireMenu().querySelector("time")).toBeNull();
    expect(requireMenu().querySelector(".desktop-project-current-location")).not.toBeNull();

    await renderProject(nextWorkspace);
    expect(container.querySelector(".desktop-titlebar-cloud-button")).toBeNull();
    expect(requireMenu().querySelector(".desktop-project-remote-copies")).toBeNull();
    expect(requireMenu().querySelector(".desktop-project-cloud-copy")).toBeNull();
    expect(requireMenu().textContent).not.toContain("Remote Notes");
    expect(requireMenu().querySelector(".desktop-project-current-location-path")?.textContent)
      .toBe("~/project/other");
  });

  it.each([false, undefined])("keeps remote services inside the project card in the classic Header: compact %s", async (compactProjectMenu) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopTitlebarContext
          compactProjectMenu={compactProjectMenu} availableProjects={[]}
          backupProviders={["github", "gitlab"]}
          activeGitStatus={createGitStatus()} branchSwitcherOpen={false}
          branchSwitcherRef={createRef<HTMLDivElement>()}
          gitStatusLoading={false} gitOperationLoading={null}
          localBranches={[]} remoteBranches={[]}
          workspace={createWorkspace("one", "Workspace one")}
          workspaceFolders={[]} multiRootWorkspacesEnabled={false}
          workspaceSwitcherOpen workspaceSwitcherRef={createRef<HTMLDivElement>()}
          onCheckoutBranch={vi.fn(async () => true)}
          onCloseBranchSwitcher={vi.fn()} onCloseWorkspaceSwitcher={vi.fn()}
          onAddProject={vi.fn()} onAddExistingProject={vi.fn()}
          onToggleBranchSwitcher={vi.fn()} onToggleWorkspaceSwitcher={vi.fn()}
        />,
      ));
    });
    expect(requireMenu().querySelector(".desktop-project-backup-services")).toBeNull();
    expect(container.querySelector(".desktop-titlebar-cloud-button")).toBeNull();
    expect(Array.from(requireMenu().querySelectorAll<HTMLElement>("[data-backup-details]"))
      .map((details) => details.dataset.backupDetails)).toEqual(["github", "gitlab"]);
    expect(container.querySelector(".desktop-titlebar-workspace-wrap img")).toBeNull();
  });

  it.each(["unavailable", "available", "signed-out", "resolving", "attention"] as const)(
    "opens the Share page from a local project with cloud state %s",
    async (cloudState) => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      const workspace = { ...createWorkspace("one", "Workspace one"), path: "/Users/example/project/demo" };
      const onShare = vi.fn();
      const onClose = vi.fn();
      await act(async () => {
        root?.render(withTestLocalization(
          <DesktopWorkspaceSwitcher
            open refObject={createRef<HTMLDivElement>()} titlebarLabel={workspace.name}
            workspace={workspace} workspaceFolders={[createWorkspaceFolder(workspace)]}
            multiRootWorkspacesEnabled={false}
            projectLocation={{ current: "local", localAvailable: true, cloudState }}
            onClose={onClose} onShare={onShare} onToggle={vi.fn()}
          />,
        ));
      });
      const menu = requireMenu();
      expect(container.querySelector(".desktop-titlebar-workspace-button .lucide-laptop")).not.toBeNull();
      const location = menu.querySelector(".desktop-project-current-location");
      expect(location?.querySelector(".desktop-project-location-visual")?.getAttribute("aria-label"))
        .toBe("This Mac");
      expect(location?.querySelector(".lucide-folder")).toBeNull();
      expect(location?.querySelector(".lucide-cloud")).toBeNull();
      expect(container.querySelector(".desktop-titlebar-cloud-button")).toBeNull();
      expect(Boolean(menu.querySelector("[data-backup-details='puppyone-cloud']")))
        .toBe(cloudState === "available" || cloudState === "signed-out");
      expect(menu.querySelector(".desktop-project-cloud-copy")).toBeNull();
      expect(location?.querySelector(".desktop-project-current-location-path")?.textContent).toBe("~/project/demo");
      expect(location?.querySelector(".desktop-project-current-location-path")?.getAttribute("aria-label"))
        .toBe(workspace.path);
      expect(menu.textContent).not.toContain("On this Mac");
      expect(menu.querySelector(".desktop-project-current-location-mark .desktop-project-location-dot")).not.toBeNull();
      expect(menu.querySelector(".desktop-project-backup-services")).toBeNull();
      const share = menu.querySelector<HTMLButtonElement>("[data-location-action='share']");
      expect(share?.textContent).toBe("Share via Cloud");
      expect(share?.querySelector(".lucide-cloud")).not.toBeNull();
      expect(share?.disabled).toBe(false);
      expect(onShare).not.toHaveBeenCalled();
      act(() => share?.click());
      expect(onClose).toHaveBeenCalledOnce();
      expect(onShare).toHaveBeenCalledOnce();
      expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onShare.mock.invocationCallOrder[0]);
    },
  );

  it("opens the project card with remote copies and preserves dismissal and keyboard focus", async () => {
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
    expect(Array.from(requireMenu().querySelectorAll<HTMLElement>("[data-backup-details]"))
      .map((details) => details.dataset.backupDetails)).toEqual(["puppyone-cloud", "github", "gitlab"]);
    expect(requireMenu().querySelector(".desktop-project-remote-copies")?.textContent).toBe("PuppyOne CloudGitHubGitLab");
    expect(requireMenu().querySelector(".desktop-project-current-location")).not.toBeNull();
    expect(requireMenu().querySelector("time")).toBeNull();
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
    expect(menu.style.width).toBe("224px");
    expect(menu.querySelector("[data-workspace-menu-layout='workspace-composition-v1']"))
      .not.toBeNull();
    expect(menu.textContent).toContain("Add Project…");
    expect(menu.textContent).not.toContain("Open Folder in New Window…");
    expect(menu.textContent).not.toContain("Workspace one");
    expect(menu.textContent).toContain("Workspace two");
    expect(menu.textContent).not.toContain("Current workspace");
    expect(menu.textContent).not.toContain("Recent projects");
    expect(menu.querySelector(".desktop-project-home-group")).toBeNull();
    expect(menu.querySelector(".desktop-project-current-indicator")).toBeNull();
    expect(menu.querySelector(".desktop-project-option.selected")).toBeNull();
    expect(menu.querySelector("[aria-current='true']")).toBeNull();
    expect(menu.querySelector("button.desktop-project-current-location-path")).not.toBeNull();
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

  it.each([false, true])("copies the absolute project path and reports clipboard failure: %s", async (fails) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const workspace = { ...createWorkspace("one", "Workspace one"), path: "/Users/example/project/demo" };
    const clipboard = vi.mocked(writeClipboardText);
    if (fails) clipboard.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    else clipboard.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopWorkspaceSwitcher
          open refObject={createRef<HTMLDivElement>()} titlebarLabel={workspace.name}
          workspace={workspace} workspaceFolders={[]} multiRootWorkspacesEnabled={false}
          onClose={onClose} onToggle={vi.fn()}
        />,
      ));
    });
    const copyButton = requireMenu().querySelector<HTMLButtonElement>(".desktop-project-current-location-path");
    expect(copyButton?.getAttribute("aria-label")).toBe(workspace.path);
    expect(copyButton?.getAttribute("data-tooltip")).toBe("Copy path");
    vi.useFakeTimers();
    await act(async () => { copyButton?.click(); });
    expect(clipboard).toHaveBeenLastCalledWith(workspace.path);
    const feedback = fails ? "Couldn’t copy. Try again." : "Copied";
    expect(copyButton?.textContent).toBe(feedback);
    expect(copyButton?.getAttribute("data-tooltip")).toBe(feedback);
    expect(copyButton?.getAttribute("data-copy-feedback")).toBe(fails ? "failed" : "copied");
    expect(Boolean(copyButton?.querySelector(".lucide-check"))).toBe(!fails);
    expect(requireMenu().querySelector("[role='status']")?.textContent).toBe(feedback);
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_500));
    expect(copyButton?.textContent).toBe("~/project/demo");
    expect(copyButton?.getAttribute("data-tooltip")).toBe("Copy path");
    expect(copyButton?.hasAttribute("data-copy-feedback")).toBe(false);
    expect(requireMenu().querySelector("[role='status']")?.textContent).toBe("");
  });

  it("reveals an overflowing path on hover and stops when the pointer leaves", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopWorkspaceSwitcher
          open refObject={createRef<HTMLDivElement>()} titlebarLabel="Workspace one"
          workspace={createWorkspace("one", "Workspace one")} workspaceFolders={[]}
          multiRootWorkspacesEnabled={false} onClose={vi.fn()} onToggle={vi.fn()}
        />,
      ));
    });
    const pathButton = requireMenu().querySelector<HTMLButtonElement>(".desktop-project-current-location-path");
    const path = pathButton?.querySelector<HTMLElement>(".desktop-project-path-text");
    if (!path || !pathButton) throw new Error("Missing path copy button and scroll region");
    Object.defineProperties(path, { scrollWidth: { value: 400 }, clientWidth: { value: 120 } });
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { nextFrame = callback; return 1; });
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    vi.spyOn(performance, "now").mockReturnValue(0);
    act(() => pathButton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(nextFrame).toBeDefined();
    act(() => nextFrame?.(1500));
    expect(path.scrollLeft).toBe(35);
    act(() => pathButton.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(path.scrollLeft).toBe(0);
    expect(cancel).toHaveBeenCalledWith(1);
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
    expect(currentLocation?.querySelector(".desktop-project-location-visual")?.getAttribute("aria-label")).toBe("This Mac");
    expect(currentLocation?.querySelector(".desktop-project-current-location-path")?.textContent).toBe("/tmp/one");
    expect(currentLocation?.querySelector(".desktop-project-current-location-mark .desktop-project-location-dot")).not.toBeNull();
    expect(currentLocation?.textContent).not.toContain("On this Mac");
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
