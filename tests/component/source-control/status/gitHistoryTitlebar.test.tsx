import { initializeDesktopPreferences, desktopPreferencesStore as preferences } from "../../../../src/preferencesStore";
/**
 * @vitest-environment happy-dom
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopTitlebarActions } from "../../../../src/features/app-shell/DesktopTitlebarActions";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import { DEFAULT_TITLEBAR_ACTIONS_SETTINGS } from "../../../../src/preferences";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => { localStorage.clear(); initializeDesktopPreferences(); });

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Git right-sidebar titlebar entries", () => {
  it.each([false, true])("keeps one working Git entry on the right with centered project %s", (centered) => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onToggleGitChanges = vi.fn();
    const onToggleTerminal = vi.fn();
    const onShare = vi.fn();
    const onToggleWorkspaceSwitcher = vi.fn();
    const actionProps = {
      terminalSidebarOpen: false,
      terminalToolEnabled: true,
      gitChangesAvailable: true,
      gitChangesOpen: true,
      gitChangesStatus: { conflicts: 0, incoming: 4, localChanges: 12, outgoing: 2 },
      onToggleGitChanges,
      onToggleTerminal,
      cloudEnabled: true,
      shareEnabled: true,
      onShare,
    };
    const render = (centered: boolean, changesEnabled = true) => act(() => {
      preferences.getState().setTitlebarActionsSettings(current => ({ ...current, enabled: { ...current.enabled, changes: changesEnabled } }));
      root?.render(withTestLocalization(
      <>
        <DesktopTitlebarContext
          compactProjectMenu={centered}
          activeGitStatus={null}
          branchSwitcherOpen={false} branchSwitcherRef={createRef<HTMLDivElement>()}
          gitStatusLoading={false} gitOperationLoading={null}
          localBranches={[]} remoteBranches={[]}
          workspace={{ id: "demo", name: "Demo", path: "/tmp/demo", status: "recording" }}
          workspaceFolders={[]} multiRootWorkspacesEnabled={false} availableProjects={[]}
          workspaceSwitcherOpen={false} workspaceSwitcherRef={createRef<HTMLDivElement>()}
          onCheckoutBranch={vi.fn(async () => true)}
          onCloseBranchSwitcher={vi.fn()} onCloseWorkspaceSwitcher={vi.fn()}
          onAddProject={vi.fn()} onAddExistingProject={vi.fn()}
          onToggleBranchSwitcher={vi.fn()} onToggleWorkspaceSwitcher={onToggleWorkspaceSwitcher}
        />
        <div data-header-trailing>
          <DesktopTitlebarActions
            {...actionProps}
          />
        </div>
      </>,
    ));
    });

    render(centered);
    const context = container.querySelector(".desktop-titlebar-context");
    const trailing = container.querySelector("[data-header-trailing]");
    const changes = container.querySelector<HTMLButtonElement>(".desktop-titlebar-changes");
    expect(container.querySelectorAll(".desktop-titlebar-changes")).toHaveLength(1);
    expect(context?.contains(changes)).toBe(false);
    expect(trailing?.contains(changes)).toBe(true);
    expect(changes?.getAttribute("aria-pressed")).toBe("true");
    expect(changes?.getAttribute("aria-label")).toContain("Pull 4 commits");
    expect(context?.querySelector(".desktop-titlebar-share")).toBeNull();
    expect(context?.querySelector(".desktop-titlebar-terminal")).toBeNull();
    expect(trailing?.querySelector(".desktop-titlebar-share")).not.toBeNull();
    expect(trailing?.querySelector(".desktop-titlebar-terminal")).not.toBeNull();
    expect(context?.querySelector(".desktop-titlebar-action-divider")).toBeNull();
    expect(Array.from(trailing?.querySelectorAll(".desktop-titlebar-action") ?? []).map((button) =>
      button.className,
    )).toEqual([
      "desktop-titlebar-action desktop-titlebar-share",
      "desktop-titlebar-action desktop-titlebar-changes",
      "desktop-titlebar-action desktop-titlebar-terminal",
    ]);

    act(() => {
      changes?.click();
      trailing?.querySelector<HTMLButtonElement>(".desktop-titlebar-share")?.click();
      trailing?.querySelector<HTMLButtonElement>(".desktop-titlebar-terminal")?.click();
      context?.querySelector<HTMLButtonElement>(".desktop-titlebar-workspace-button")?.click();
    });
    expect(onToggleGitChanges).toHaveBeenCalledOnce();
    expect(onToggleTerminal).toHaveBeenCalledOnce();
    expect(onShare).toHaveBeenCalledOnce();
    expect(onToggleWorkspaceSwitcher).toHaveBeenCalledOnce();

    render(!centered);
    expect(container.querySelectorAll(".desktop-titlebar-changes")).toHaveLength(1);
    expect(container.querySelector(".desktop-titlebar-context")?.contains(
      container.querySelector(".desktop-titlebar-changes"),
    )).toBe(false);
    expect(container.querySelector("[data-header-trailing]")?.contains(
      container.querySelector(".desktop-titlebar-changes"),
    )).toBe(true);
    act(() => preferences.getState().setTitlebarActionsSettings(current => ({ ...current, enabled: { ...current.enabled, changes: false } })));
    expect(container.querySelector(".desktop-titlebar-changes")).toBeNull();
    expect(container.querySelector(".desktop-titlebar-context .desktop-titlebar-action-divider")).toBeNull();
    expect(container.querySelector(".desktop-titlebar-terminal")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("puppyone.desktop.titlebarActions")!).enabled.changes).toBe(false);
  });

  it("retains Git in the workspace toolbar", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(withTestLocalization(
      <DesktopTitlebarActions
        terminalSidebarOpen={false} terminalToolEnabled gitChangesAvailable
        placement="toolbar" visibleGroups={["header", "right-sidebar"]}
        onToggleTerminal={vi.fn()}
      />,
    )));
    expect(container.querySelector('[data-toolbar-action="changes"]')).not.toBeNull();
    expect(container.querySelector('[data-toolbar-action="terminal"]')).not.toBeNull();
  });

  it("keeps the high-frequency Changes entry and removes standalone History", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onToggleGitChanges = vi.fn();
    preferences.getState().setTitlebarActionsSettings({ ...DEFAULT_TITLEBAR_ACTIONS_SETTINGS, order: ["terminal", "changes"] });

    act(() => root?.render(withTestLocalization(
      <DesktopTitlebarActions
        terminalSidebarOpen={false}
        terminalToolEnabled
        gitChangesAvailable
        gitChangesOpen
        gitChangesStatus={{ conflicts: 0, incoming: 4, localChanges: 12, outgoing: 2 }}
        onToggleTerminal={vi.fn()}
        onToggleGitChanges={onToggleGitChanges}
      />,
    )));

    const history = container.querySelector<HTMLButtonElement>(".desktop-titlebar-history");
    const changes = container.querySelector<HTMLButtonElement>(".desktop-titlebar-changes");
    expect(history).toBeNull();
    expect(changes?.getAttribute("aria-label")).toContain("Changes, 12 files");
    expect(changes?.getAttribute("aria-label")).toContain("Pull 4 commits");
    expect(changes?.getAttribute("aria-label")).toContain("2 local commits waiting");
    expect(changes?.getAttribute("aria-pressed")).toBe("true");
    expect(Array.from(changes?.children ?? []).some((child) => child.tagName === "svg"))
      .toBe(false);
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.local")?.textContent).toBe("12");
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.local .lucide-asterisk"))
      .not.toBeNull();
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.incoming")?.textContent).toBe("4");
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.incoming .lucide-arrow-down"))
      .not.toBeNull();
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.outgoing")?.textContent).toBe("2");
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.outgoing .lucide-arrow-up"))
      .not.toBeNull();
    expect(Array.from(changes?.querySelectorAll(".desktop-titlebar-git-indicator") ?? []).map(
      (indicator) => Array.from(indicator.classList).at(-1),
    )).toEqual(["incoming", "outgoing", "local"]);
    expect(Array.from(container.querySelectorAll(".desktop-titlebar-action")).map(
      (button) => button.getAttribute("aria-label"),
    )).toEqual([
      "Changes, 12 files, Pull 4 commits, 2 local commits waiting.",
      "Show Agent",
    ]);
    const dividers = container.querySelectorAll(".desktop-titlebar-action-divider");
    expect(dividers).toHaveLength(1);
    expect(changes?.closest(".desktop-header-coachmark-anchor")?.nextElementSibling)
      .toBe(dividers[0]);

    act(() => {
      changes?.click();
    });
    expect(onToggleGitChanges).toHaveBeenCalledOnce();
  });

  it("keeps Changes discoverable without restoring the standalone Git mark", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <DesktopTitlebarActions
        terminalSidebarOpen={false}
        terminalToolEnabled={false}
        gitChangesAvailable
        onToggleTerminal={vi.fn()}
      />,
    )));

    const changes = container.querySelector<HTMLButtonElement>(".desktop-titlebar-changes");
    expect(changes?.getAttribute("aria-label")).toBe("Changes");
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.local.idle .lucide-asterisk"))
      .not.toBeNull();
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.local.idle")?.textContent)
      .toBe("0");
    expect(Array.from(changes?.children ?? []).some((child) => child.tagName === "svg"))
      .toBe(false);
  });
});
