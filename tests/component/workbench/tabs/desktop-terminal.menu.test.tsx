/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopTitlebarActions } from "../../../../src/features/app-shell/DesktopTitlebarActions";
import { AuxiliaryWorkbenchCloseDialog } from "../../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchCloseDialog";
import type { TerminalRuntimeHandle } from "../../../../src/features/desktop-terminal/runtime/terminalRuntime";
import { TerminalSessionHeader } from "../../../../src/features/desktop-terminal/ui/session-header/TerminalSessionHeader";
import type { TerminalTabMoveDragController } from "../../../../src/features/desktop-terminal/interactions/useTerminalTabMoveDrag";
import { DEFAULT_TITLEBAR_ACTIONS_SETTINGS } from "../../../../src/preferences";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Desktop Terminal tab session manager", () => {
  it("presents one unified Agent Workbench toggle in the workspace toolbar", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <DesktopTitlebarActions
        titlebarActionsSettings={DEFAULT_TITLEBAR_ACTIONS_SETTINGS}
        terminalSidebarOpen={false}
        terminalToolEnabled
        placement="toolbar"
        visibleGroups={["right-sidebar"]}
        onToggleTerminal={vi.fn()}
      />,
    )));

    const terminal = container.querySelector('[data-toolbar-action="terminal"]');
    expect(terminal?.textContent).toBe("Agent");
    expect(terminal?.classList.contains("desktop-shell-toolbar-button")).toBe(true);
    expect(terminal?.classList.contains("desktop-titlebar-action")).toBe(false);
    expect(terminal?.querySelector(".lucide-agent-entry")).not.toBeNull();
    expect(terminal?.querySelector(".desktop-shell-toolbar-button-icon")).not.toBeNull();
    expect(terminal?.querySelector(".desktop-shell-toolbar-button-label")).not.toBeNull();
    expect(Array.from(container.querySelectorAll("[data-toolbar-action]"), (item) => item.textContent))
      .toEqual(["Agent"]);
    expect(container.querySelector('[aria-label="Terminal actions"]')).toBeNull();
  });

  it("manages sessions from the Terminal tab bar", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const onCreate = vi.fn();
    const onMoveByKeyboard = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <TerminalSessionHeader
        sessions={[
          { id: "terminal-a", launcherId: "codex", ordinal: 1, shell: "Codex", status: "running" },
          { id: "terminal-b", launcherId: "shell", ordinal: 2, shell: null, status: "exited" },
        ]}
        activeSessionId="terminal-a"
        onActivate={onActivate}
        onClose={onClose}
        onCreate={onCreate}
        onMoveByKeyboard={onMoveByKeyboard}
        presentedSessionIds={["terminal-a", "terminal-b"]}
        workspacePath="/workspace/my private"
      />,
    )));

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]?.getAttribute("aria-label"))
      .toContain("Terminal 1 — Codex — /workspace/my private — Running");
    expect(tabs[1]?.getAttribute("aria-label"))
      .toContain("Terminal 2 — Shell — /workspace/my private — Exited");
    expect(tabs[0]?.textContent).toBe("my private");
    expect(tabs[1]?.textContent).toBe("my private");
    expect(tabs[0]?.querySelector(".desktop-terminal-launcher-icon.is-codex")).not.toBeNull();
    expect(tabs[1]?.closest(".desktop-terminal-tab")?.classList.contains("is-visible-group"))
      .toBe(true);

    act(() => tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "ArrowRight",
      altKey: true,
      shiftKey: true,
    })));
    expect(onMoveByKeyboard).toHaveBeenCalledWith("terminal-a", "right");

    act(() => tabs[1]?.click());
    expect(onActivate).toHaveBeenCalledWith("terminal-b");

    clickButton(container, "Close Terminal 2");
    expect(onClose).toHaveBeenCalledWith("terminal-b");

    clickButton(container, "New terminal");
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("uses the native click as the single source of pointer Tab activation", () => {
    const onActivate = vi.fn();
    const tabMove = inertTabMove(() => "ignored");
    const { container } = renderTwoSessionHeader({ onActivate, tabMove });
    const tab = container.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]!;

    act(() => tab.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 31,
    })));
    act(() => tab.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 31,
    })));
    expect(onActivate).not.toHaveBeenCalled();

    act(() => tab.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      button: 0,
      detail: 1,
    })));
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith("terminal-b");
  });

  it("suppresses only the click derived from a completed drag", () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    const tabMove = inertTabMove(() => "drag");
    const { container } = renderTwoSessionHeader({ onActivate, tabMove });
    const tab = container.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]!;

    act(() => tab.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 32,
    })));
    act(() => tab.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      button: 0,
      detail: 1,
    })));
    expect(onActivate).not.toHaveBeenCalled();

    act(() => vi.runAllTimers());
    act(() => tab.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      button: 0,
      detail: 1,
    })));
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith("terminal-b");
  });

  it("keeps roving-tab keyboard navigation on the complete session order", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const [activeSessionId, setActiveSessionId] = React.useState("terminal-b");
      return (
        <TerminalSessionHeader
          sessions={[
            { id: "terminal-a", launcherId: "codex", ordinal: 1, shell: "codex", status: "running" },
            { id: "terminal-b", launcherId: "claude", ordinal: 2, shell: "claude", status: "running" },
            { id: "terminal-c", launcherId: "cursor", ordinal: 3, shell: "cursor", status: "running" },
          ]}
          activeSessionId={activeSessionId}
          onActivate={setActiveSessionId}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          workspacePath="/workspace/my private"
        />
      );
    }

    act(() => root?.render(withTestLocalization(<Harness />)));
    const selectedTab = () => container.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');

    act(() => selectedTab()?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "End",
    })));
    expect(selectedTab()?.id).toBe("desktop-terminal-tab-terminal-c");

    act(() => selectedTab()?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "Home",
    })));
    expect(selectedTab()?.id).toBe("desktop-terminal-tab-terminal-a");

    act(() => selectedTab()?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "ArrowLeft",
    })));
    expect(selectedTab()?.id).toBe("desktop-terminal-tab-terminal-c");
  });

  it("labels a runtime-free launcher tab without requiring a Terminal runtime", () => {
    const requireRuntime = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <TerminalSessionHeader
        sessions={[{
          id: "launcher-a",
          launcherId: null,
          ordinal: 1,
          shell: null,
          status: "selecting",
        }]}
        activeSessionId="launcher-a"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        runtimeRegistry={{ require: requireRuntime }}
        workspacePath="/workspace/my private"
      />,
    )));

    expect(container.querySelector('[role="option"]')?.textContent).toBe("my private");
    expect(requireRuntime).not.toHaveBeenCalled();
  });

  it("compresses inactive tabs and moves excess sessions into an accessible menu", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 281,
      height: 38,
      top: 0,
      right: 281,
      bottom: 38,
      left: 0,
      toJSON: () => ({}),
    });
    const onActivate = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const launchers = ["codex", "claude", "cursor", "opencode", "pi", "hermes"] as const;

    act(() => root?.render(withTestLocalization(
      <TerminalSessionHeader
        sessions={launchers.map((launcherId, index) => ({
          id: `terminal-${index + 1}`,
          launcherId,
          ordinal: index + 1,
          shell: launcherId,
          status: "running" as const,
        }))}
        activeSessionId="terminal-4"
        onActivate={onActivate}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        workspacePath="/workspace/my private"
      />,
    )));

    const rail = container.querySelector<HTMLElement>(".desktop-terminal-tab-rail")!;
    const overflow = rail.querySelector<HTMLElement>(
      ":scope > .desktop-terminal-tab-overflow-wrap",
    )!;
    const create = rail.querySelector<HTMLButtonElement>(
      ":scope > .desktop-terminal-new-button",
    )!;
    expect(rail.getAttribute("data-layout")).toBe("overflow");
    expect(create.previousElementSibling).toBe(overflow);
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(4);
    expect(container.querySelectorAll(".desktop-terminal-tab.is-compact")).toHaveLength(3);
    expect(container.querySelector(".desktop-terminal-tab.is-active")?.textContent)
      .toBe("my private");

    clickButton(container, "More terminal tabs (2)");
    expect(document.querySelectorAll('.desktop-terminal-tab-overflow-menu [role="menuitemradio"]'))
      .toHaveLength(2);
    clickButton(document.body, "Codex");
    expect(onActivate).toHaveBeenCalledWith("terminal-1");
    expect(document.querySelector(".desktop-terminal-tab-overflow-menu")).toBeNull();
  });

  it("measures stable Header capacity and expands from overflow back to full tabs", () => {
    let headerWidth = 281;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      x: 0,
      y: 0,
      width: headerWidth,
      height: 38,
      top: 0,
      right: headerWidth,
      bottom: 38,
      left: 0,
      toJSON: () => ({}),
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const launchers = ["codex", "claude", "cursor", "opencode", "pi", "hermes"] as const;

    act(() => root?.render(withTestLocalization(
      <TerminalSessionHeader
        sessions={launchers.map((launcherId, index) => ({
          id: `terminal-${index + 1}`,
          launcherId,
          ordinal: index + 1,
          shell: launcherId,
          status: "running" as const,
        }))}
        activeSessionId="terminal-4"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        workspacePath="/workspace/my private"
      />,
    )));

    const rail = container.querySelector(".desktop-terminal-tab-rail");
    expect(rail?.getAttribute("data-layout")).toBe("overflow");

    headerWidth = 931;
    act(() => window.dispatchEvent(new Event("resize")));

    expect(rail?.getAttribute("data-layout")).toBe("full");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(6);
    expect(container.querySelectorAll(".desktop-terminal-tab.is-compact")).toHaveLength(0);
    expect(container.querySelector(".desktop-terminal-tab-overflow-trigger")).toBeNull();
  });

  it("enables continuous Header motion after initial measurement, without an activation timer", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 300,
      height: 38,
      top: 0,
      right: 300,
      bottom: 38,
      left: 0,
      toJSON: () => ({}),
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const [activeSessionId, setActiveSessionId] = React.useState("terminal-a");
      return (
        <TerminalSessionHeader
          sessions={[
            { id: "terminal-a", launcherId: "codex", ordinal: 1, shell: "codex", status: "running" },
            { id: "terminal-b", launcherId: "claude", ordinal: 2, shell: "claude", status: "running" },
            { id: "terminal-c", launcherId: "cursor", ordinal: 3, shell: "cursor", status: "running" },
          ]}
          activeSessionId={activeSessionId}
          onActivate={setActiveSessionId}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          workspacePath="/workspace/my private"
        />
      );
    }

    act(() => root?.render(withTestLocalization(<Harness />)));
    const rail = container.querySelector(".desktop-terminal-tab-rail");
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const tabShells = container.querySelectorAll<HTMLElement>(".desktop-terminal-tab");
    expect(rail?.getAttribute("data-layout")).toBe("compact");
    expect(rail?.hasAttribute("data-layout-motion")).toBe(false);
    act(() => vi.advanceTimersByTime(20));
    expect(tabShells[0]?.style.getPropertyValue("--desktop-terminal-tab-inline-start")).toBe("0px");
    expect(tabShells[0]?.style.getPropertyValue("--desktop-terminal-tab-resolved-width")).toBe("144px");
    expect(tabShells[1]?.style.getPropertyValue("--desktop-terminal-tab-inline-start")).toBe("147px");
    expect(tabShells[1]?.style.getPropertyValue("--desktop-terminal-tab-resolved-width")).toBe("28px");

    act(() => tabs[1]?.click());
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(rail?.getAttribute("data-layout-motion")).toBe("true");
    expect(tabShells[0]?.style.getPropertyValue("--desktop-terminal-tab-inline-start")).toBe("0px");
    expect(tabShells[0]?.style.getPropertyValue("--desktop-terminal-tab-resolved-width")).toBe("28px");
    expect(tabShells[1]?.style.getPropertyValue("--desktop-terminal-tab-inline-start")).toBe("31px");
    expect(tabShells[1]?.style.getPropertyValue("--desktop-terminal-tab-resolved-width")).toBe("144px");

    act(() => vi.advanceTimersByTime(250));
    expect(rail?.getAttribute("data-layout-motion")).toBe("true");
  });

  it("keeps visible overflow tabs mounted while the active width pushes across the rail", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 281,
      height: 38,
      top: 0,
      right: 281,
      bottom: 38,
      left: 0,
      toJSON: () => ({}),
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const sessions = ["codex", "claude", "cursor", "opencode", "pi", "hermes"]
      .map((launcherId, index) => ({
        id: `terminal-${index + 1}`,
        launcherId,
        ordinal: index + 1,
        shell: launcherId,
        status: "running" as const,
      }));

    function Harness() {
      const [activeSessionId, setActiveSessionId] = React.useState("terminal-4");
      return (
        <TerminalSessionHeader
          sessions={sessions}
          activeSessionId={activeSessionId}
          onActivate={setActiveSessionId}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          workspacePath="/workspace/my private"
        />
      );
    }

    act(() => root?.render(withTestLocalization(<Harness />)));
    const before = [...container.querySelectorAll<HTMLElement>(".desktop-terminal-tab")];
    act(() => vi.advanceTimersByTime(20));
    expect(before.map((tab) => tab.querySelector('[role="option"]')?.id)).toEqual([
      "desktop-terminal-tab-terminal-2",
      "desktop-terminal-tab-terminal-3",
      "desktop-terminal-tab-terminal-4",
      "desktop-terminal-tab-terminal-5",
    ]);

    act(() => container.querySelector<HTMLButtonElement>("#desktop-terminal-tab-terminal-5")?.click());
    const after = [...container.querySelectorAll<HTMLElement>(".desktop-terminal-tab")];
    expect(after).toEqual(before);
    expect(after[2]?.classList.contains("is-compact")).toBe(true);
    expect(after[3]?.classList.contains("is-active")).toBe(true);
    expect(container.querySelector(".desktop-terminal-tab-rail")?.getAttribute("data-layout-motion"))
      .toBe("true");
  });

  it("uses one activity grid for every Agent while preserving its idle brand mark", () => {
    const activityHarness = createTerminalActivityHarness();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <TerminalSessionHeader
        sessions={[
          { id: "terminal-a", launcherId: "cursor", ordinal: 1, shell: "Cursor Agent", status: "running" },
        ]}
        activeSessionId="terminal-a"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        runtimeRegistry={{ require: () => activityHarness.runtime }}
        workspacePath="/workspace/my private"
      />,
    )));

    const status = container.querySelector(".desktop-terminal-tab-status");
    expect(status?.querySelector(".desktop-terminal-launcher-icon.is-cursor")).not.toBeNull();
    expect(status?.classList.contains("is-activity")).toBe(false);
    expect(status?.querySelectorAll(".desktop-terminal-activity-grid > span")).toHaveLength(0);

    activityHarness.setActivity(true);
    expect(status?.querySelector(".desktop-terminal-launcher-icon")).toBeNull();
    expect(status?.classList.contains("is-activity")).toBe(true);
    expect(status?.querySelectorAll(".desktop-terminal-activity-grid > span")).toHaveLength(4);

    activityHarness.setActivity(false);
    expect(status?.querySelector(".desktop-terminal-launcher-icon.is-cursor")).not.toBeNull();
    expect(status?.classList.contains("is-activity")).toBe(false);
    expect(status?.querySelectorAll(".desktop-terminal-activity-grid > span")).toHaveLength(0);

    act(() => root?.render(withTestLocalization(
      <TerminalSessionHeader
        sessions={[
          { id: "terminal-a", launcherId: "cursor", ordinal: 1, shell: null, status: "starting" },
        ]}
        activeSessionId="terminal-a"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        runtimeRegistry={{ require: () => activityHarness.runtime }}
        workspacePath="/workspace/my private"
      />,
    )));
    expect(status?.querySelector(".desktop-terminal-launcher-icon")).toBeNull();
    expect(status?.classList.contains("is-activity")).toBe(true);
    expect(status?.querySelectorAll(".desktop-terminal-activity-grid > span")).toHaveLength(4);

    activityHarness.setActivity(true);
    act(() => root?.render(withTestLocalization(
      <TerminalSessionHeader
        sessions={[
          { id: "terminal-a", launcherId: "cursor", ordinal: 1, shell: "Cursor Agent", status: "exited" },
        ]}
        activeSessionId="terminal-a"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        runtimeRegistry={{ require: () => activityHarness.runtime }}
        workspacePath="/workspace/my private"
      />,
    )));
    expect(status?.querySelector(".desktop-terminal-launcher-icon.is-cursor")).not.toBeNull();
    expect(status?.classList.contains("is-activity")).toBe(false);
  });

  it("makes cancellation the safe default before closing a terminal", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <AuxiliaryWorkbenchCloseDialog
        pending={{
          itemId: "terminal-2",
          decision: {
            kind: "confirm",
            tone: "danger",
            dialog: {
              title: "Close Terminal 2?",
              detail: "This will stop the shell and any command running in this terminal.",
              actionLabel: "Close terminal",
            },
          },
        }}
        committing={false}
        onDismiss={onCancel}
        onConfirm={onConfirm}
      />,
    )));

    const overlayRoot = document.querySelector<HTMLElement>("#desktop-overlay-root");
    const dialog = overlayRoot?.querySelector<HTMLElement>('[role="dialog"]');
    expect(overlayRoot).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(dialog?.getAttribute("aria-label")).toBe("Close Terminal 2?");
    expect(dialog?.textContent).toContain(
      "This will stop the shell and any command running in this terminal.",
    );
    const confirmButton = Array.from(dialog?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent?.trim() === "Close terminal");
    expect(confirmButton?.classList.contains("po-button--danger")).toBe(true);
    expect(document.activeElement?.textContent).toBe("Cancel");

    clickButton(overlayRoot!, "Cancel");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    clickButton(overlayRoot!, "Close terminal");
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

function renderTwoSessionHeader({
  onActivate,
  tabMove,
}: {
  onActivate: (sessionId: string) => void;
  tabMove: TerminalTabMoveDragController;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <TerminalSessionHeader
      sessions={[
        { id: "terminal-a", launcherId: "codex", ordinal: 1, shell: "Codex", status: "running" },
        { id: "terminal-b", launcherId: "shell", ordinal: 2, shell: "Shell", status: "running" },
      ]}
      activeSessionId="terminal-a"
      onActivate={onActivate}
      onClose={vi.fn()}
      onCreate={vi.fn()}
      tabMove={tabMove}
      workspacePath="/workspace/click-contract"
    />,
  )));
  return { container };
}

function inertTabMove(
  end: TerminalTabMoveDragController["end"],
): TerminalTabMoveDragController {
  return {
    dragging: false,
    dropIntent: null,
    start: vi.fn(),
    move: vi.fn(),
    end: vi.fn(end),
    cancel: vi.fn(),
    lostCapture: vi.fn(),
  };
}

function clickButton(container: HTMLElement, accessibleName: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${accessibleName}"]`)
    ?? Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent?.trim().startsWith(accessibleName));
  if (!button) throw new Error(`Button not found: ${accessibleName}`);
  act(() => button.click());
}

function createTerminalActivityHarness() {
  let activity = false;
  const listeners = new Set<(nextActivity: boolean) => void>();
  const runtime: TerminalRuntimeHandle = {
    get activity() {
      return activity;
    },
    ready: true,
    scrollbarState: {
      visible: false,
      canDecrement: false,
      canIncrement: false,
      position: 0,
      viewportRatio: 1,
    },
    applyAppearance: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
    getMinimumViewportSize: vi.fn(() => ({ width: 172, height: 128 })),
    mount: vi.fn(),
    scrollLines: vi.fn(),
    scrollToRatio: vi.fn(),
    unmount: vi.fn(),
    setFocused: vi.fn(),
    setPresented: vi.fn(),
    subscribeActivity: vi.fn((listener) => {
      listeners.add(listener);
      listener(activity);
      return () => listeners.delete(listener);
    }),
    subscribeReady: vi.fn(() => () => undefined),
    subscribeScrollbar: vi.fn(() => () => undefined),
    write: vi.fn(),
  };

  return {
    runtime,
    setActivity(nextActivity: boolean) {
      activity = nextActivity;
      act(() => listeners.forEach((listener) => listener(activity)));
    },
  };
}
