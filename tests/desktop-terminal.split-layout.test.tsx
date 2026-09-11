/** @vitest-environment happy-dom */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalGroupViewport } from "../src/features/desktop-terminal/layout/TerminalGroupViewport";
import type { TerminalTabMoveDragController } from "../src/features/desktop-terminal/interactions/useTerminalTabMoveDrag";
import {
  createDesktopTerminalSessionsState,
  desktopTerminalSessionsReducer,
  getOrderedTerminalSessions,
  type DesktopTerminalSessionsState,
} from "../src/features/desktop-terminal/model/terminalSessions";
import type { TerminalRuntimeHandle } from "../src/features/desktop-terminal/runtime/terminalRuntime";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Terminal Group-owned Tab layout", () => {
  it("renders one complete local Tab Bar and only its active Session host", () => {
    const harness = createHarness(createThreeTabs());
    harness.render();

    const groups = harness.container.querySelectorAll(".desktop-terminal-tab-group");
    const tabs = groups[0]!.querySelectorAll('[role="option"]');
    expect(groups).toHaveLength(1);
    expect(tabs).toHaveLength(3);
    expect(groups[0]!.querySelectorAll(".desktop-terminal-subheader")).toHaveLength(1);
    expect(groups[0]!.querySelector(".desktop-terminal-tab-group-content")?.contains(
      harness.hosts.get("terminal-c")!,
    )).toBe(true);
    expect(harness.hosts.get("terminal-a")!.parentElement).toBeNull();
    expect(harness.hosts.get("terminal-b")!.parentElement).toBeNull();
  });

  it("keeps the local new-Tab action immediately after the Tab strip", () => {
    const harness = createHarness(createThreeTabs());
    harness.render();

    const rail = harness.container.querySelector<HTMLElement>(
      '[data-terminal-tab-bar-group-id="group-a"]',
    )!;
    const tabs = rail.querySelector<HTMLElement>(":scope > .desktop-terminal-tabs")!;
    const create = rail.querySelector<HTMLButtonElement>(
      ":scope > .desktop-terminal-new-button",
    )!;

    expect(create).not.toBeNull();
    expect(create.previousElementSibling).toBe(tabs);
    expect(harness.container.querySelector(".desktop-terminal-subheader-new")).toBeNull();
  });

  it("creates left and right Group leaves, each with its own Tab Bar and content", () => {
    const state = splitTab(createThreeTabs(), "terminal-b", "group-a", "right", "group-b");
    const harness = createHarness(state);
    harness.render();

    const groups = harness.container.querySelectorAll<HTMLElement>(
      ".desktop-terminal-tab-group",
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]!.dataset.terminalGroupPaneId).toBe("group-a");
    expect(groups[1]!.dataset.terminalGroupPaneId).toBe("group-b");
    expect(groups[0]!.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(groups[1]!.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(groups[0]!.querySelectorAll(":scope .desktop-terminal-new-button")).toHaveLength(1);
    expect(groups[1]!.querySelectorAll(":scope .desktop-terminal-new-button")).toHaveLength(1);
    expect(groups[0]!.querySelector(".desktop-terminal-tab-group-content")?.contains(
      harness.hosts.get("terminal-c")!,
    )).toBe(true);
    expect(groups[1]!.querySelector(".desktop-terminal-tab-group-content")?.contains(
      harness.hosts.get("terminal-b")!,
    )).toBe(true);
  });

  it("switches Tabs inside one Group without remounting another Group's host", () => {
    let state = splitTab(createThreeTabs(), "terminal-b", "group-a", "right", "group-b");
    const harness = createHarness(state);
    harness.render();
    const hostA = harness.hosts.get("terminal-a")!;
    const hostB = harness.hosts.get("terminal-b")!;
    const hostC = harness.hosts.get("terminal-c")!;
    const rightParent = hostB.parentElement;

    state = desktopTerminalSessionsReducer(state, {
      type: "activate",
      sessionId: "terminal-a",
    });
    harness.setState(state);
    harness.render();

    expect(harness.container.querySelector(
      '[data-terminal-group-pane-id="group-a"] .desktop-terminal-tab-group-content',
    )?.contains(hostA)).toBe(true);
    expect(hostC.parentElement).toBeNull();
    expect(hostB.parentElement).toBe(rightParent);
  });

  it("renders four-edge drop previews inside the target content viewport", () => {
    const state = createThreeTabs();
    const harness = createHarness(state);
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      harness.render({
        kind: "split",
        sourceSessionId: "terminal-b",
        targetGroupId: "group-a",
        edge,
        allowed: edge !== "top",
      });
      const target = harness.container.querySelector<HTMLElement>(
        '[data-terminal-group-pane-id="group-a"]',
      );
      const content = target?.querySelector<HTMLElement>(
        '[data-terminal-content-drop-group-id="group-a"]',
      );
      const preview = target?.querySelector<HTMLElement>(".desktop-terminal-drop-preview");
      expect(content?.contains(preview ?? null)).toBe(true);
      expect(content?.dataset.dropTarget).toBe(edge);
      expect(target?.dataset.dropTarget).toBeUndefined();
      expect(preview?.dataset.edge).toBe(edge);
      expect(preview?.dataset.allowed).toBe(edge === "top" ? "false" : "true");
    }
  });

  it("keeps Header insertion and content-edge Group movement as disjoint drop zones", () => {
    const state = splitTab(createThreeTabs(), "terminal-b", "group-a", "right", "group-b");
    const harness = createHarness(state);
    harness.render({
      kind: "move-group",
      sourceGroupId: "group-b",
      targetGroupId: "group-a",
      edge: "left",
      allowed: true,
    });

    const target = harness.container.querySelector<HTMLElement>(
      '[data-terminal-group-pane-id="group-a"]',
    )!;
    const rail = target.querySelector<HTMLElement>(
      '[data-terminal-tab-bar-group-id="group-a"]',
    )!;
    const content = target.querySelector<HTMLElement>(
      '[data-terminal-content-drop-group-id="group-a"]',
    )!;
    const preview = target.querySelector<HTMLElement>(".desktop-terminal-drop-preview")!;

    expect(rail.classList.contains("desktop-terminal-tab-rail")).toBe(true);
    expect(content.classList.contains("desktop-terminal-tab-group-content")).toBe(true);
    expect(rail.contains(content)).toBe(false);
    expect(content.contains(preview)).toBe(true);
    expect(rail.contains(preview)).toBe(false);
    expect(content.contains(target.querySelector(".desktop-terminal-pane-interaction-frame")))
      .toBe(true);
    expect(target.querySelector(".desktop-terminal-pane-handle-shell")).toBeNull();
    expect(preview.dataset.operation).toBe("move-group");
    expect(preview.dataset.edge).toBe("left");
    expect(preview.dataset.allowed).toBe("true");
  });

  it("opens a relative insertion slot so target-Bar Tabs move out of the way", () => {
    const state = splitTab(createThreeTabs(), "terminal-b", "group-a", "right", "group-b");
    const harness = createHarness(state);
    harness.render({
      kind: "insert",
      sourceSessionId: "terminal-b",
      targetGroupId: "group-a",
      targetIndex: 1,
      allowed: true,
    });

    const target = harness.container.querySelector<HTMLElement>(
      '[data-terminal-group-pane-id="group-a"]',
    )!;
    const rail = target.querySelector<HTMLElement>(".desktop-terminal-tab-rail")!;
    const slot = target.querySelector<HTMLElement>(".desktop-terminal-tab-drop-slot")!;
    const terminalC = target.querySelector<HTMLElement>(
      '[data-terminal-tab-session-id="terminal-c"]',
    )!;
    expect(rail.dataset.tabInsertion).toBe("true");
    expect(slot.style.getPropertyValue("--desktop-terminal-tab-inline-start")).toBe("147px");
    expect(terminalC.style.getPropertyValue("--desktop-terminal-tab-inline-start"))
      .toBe("294px");
    expect(harness.container.querySelector(
      '[data-terminal-group-pane-id="group-b"] .desktop-terminal-tab-drop-slot',
    )).toBeNull();
  });

  it("previews every Tab in a Group as an ordered block before Bar merge", () => {
    let state = splitTab(createThreeTabs(), "terminal-b", "group-a", "right", "group-b");
    state = desktopTerminalSessionsReducer(state, {
      type: "create",
      sessionId: "terminal-d",
      groupId: "unused-group-d",
      targetGroupId: "group-b",
      launcherId: "shell",
    });
    const harness = createHarness(state);
    harness.render({
      kind: "merge-group",
      sourceGroupId: "group-b",
      sourceSessionIds: ["terminal-b", "terminal-d"],
      targetGroupId: "group-a",
      targetIndex: 1,
      allowed: true,
    });

    const target = harness.container.querySelector<HTMLElement>(
      '[data-terminal-group-pane-id="group-a"]',
    )!;
    const terminalC = target.querySelector<HTMLElement>(
      '[data-terminal-tab-session-id="terminal-c"]',
    )!;
    expect(target.querySelectorAll(".desktop-terminal-tab-drop-slot")).toHaveLength(2);
    expect(terminalC.style.getPropertyValue("--desktop-terminal-tab-inline-start"))
      .toBe("441px");
  });

  it("repositions the dragged Tab itself during a same-Bar reorder preview", () => {
    const state = splitTab(createThreeTabs(), "terminal-b", "group-a", "right", "group-b");
    const harness = createHarness(state);
    harness.render({
      kind: "insert",
      sourceSessionId: "terminal-a",
      targetGroupId: "group-a",
      targetIndex: 1,
      allowed: true,
    });

    const target = harness.container.querySelector<HTMLElement>(
      '[data-terminal-group-pane-id="group-a"]',
    )!;
    const terminalA = target.querySelector<HTMLElement>(
      '[data-terminal-tab-session-id="terminal-a"]',
    )!;
    const terminalC = target.querySelector<HTMLElement>(
      '[data-terminal-tab-session-id="terminal-c"]',
    )!;
    expect(target.querySelector(".desktop-terminal-tab-drop-slot")).toBeNull();
    expect(terminalC.style.getPropertyValue("--desktop-terminal-tab-inline-start")).toBe("0px");
    expect(terminalA.style.getPropertyValue("--desktop-terminal-tab-inline-start")).toBe("147px");
  });

  it("renders each Group header without a move handle or reserved grip space", () => {
    const state = splitTab(createThreeTabs(), "terminal-b", "group-a", "right", "group-b");
    const harness = createHarness(state);
    harness.render();
    const groups = Array.from(harness.container.querySelectorAll<HTMLElement>(
      ".desktop-terminal-tab-group",
    ));

    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.querySelector(".desktop-terminal-pane-handle")).toBeNull();
      expect(group.querySelector(".desktop-terminal-group-chrome")).toBeNull();
      expect(group.querySelector(".desktop-terminal-subheader")?.parentElement).toBe(group);
    }
  });

  it("keeps stable Session host identities while nested Group geometry changes", () => {
    let state = createThreeTabs();
    state = splitTab(state, "terminal-b", "group-a", "right", "group-b");
    state = splitTab(state, "terminal-c", "group-b", "bottom", "group-c");
    const harness = createHarness(state);
    const stableHosts = new Map(harness.hosts);
    harness.render();

    expect(harness.container.querySelectorAll(".desktop-terminal-tab-group")).toHaveLength(3);
    for (const [sessionId, host] of stableHosts) {
      expect(harness.hosts.get(sessionId)).toBe(host);
      expect(host.parentElement).not.toBeNull();
    }
  });
});

function createHarness(initialState: DesktopTerminalSessionsState) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let state = initialState;
  const hosts = new Map(state.sessions.map(({ id }) => [id, terminalHost(id)]));
  const runtimes = new Map(state.sessions.map(({ id }) => [id, createRuntime()]));
  const sessionMove = createSessionMove();

  return {
    container,
    hosts,
    setState(nextState: DesktopTerminalSessionsState) {
      state = nextState;
    },
    render(dropIntent: Parameters<typeof TerminalGroupViewport>[0]["dropIntent"] = null) {
      act(() => root?.render(withTestLocalization(
        state.root ? (
          <TerminalGroupViewport
            activeGroupId={state.activeGroupId}
            dropIntent={dropIntent}
            groups={state.groups}
            hosts={hosts}
            root={state.root}
            runtimeRegistry={{
              get: (sessionId) => runtimes.get(sessionId) ?? null,
              require: (sessionId) => runtimes.get(sessionId)!,
            }}
            sessions={getOrderedTerminalSessions(state)}
            sessionMove={sessionMove}
            workspacePath="/workspace/local-tabs"
            onActivateSession={vi.fn()}
            onCloseSession={vi.fn()}
            onCreateSession={vi.fn()}
            onMoveByKeyboard={vi.fn()}
            onResizeSplit={vi.fn()}
          />
        ) : null,
      )));
    },
  };
}

function createThreeTabs() {
  let state = createDesktopTerminalSessionsState();
  for (const [index, id] of ["terminal-a", "terminal-b", "terminal-c"].entries()) {
    state = desktopTerminalSessionsReducer(state, {
      type: "create",
      sessionId: id,
      groupId: index === 0 ? "group-a" : `unused-${index}`,
      launcherId: "shell",
    });
  }
  return state;
}

function splitTab(
  state: DesktopTerminalSessionsState,
  sourceSessionId: string,
  targetGroupId: string,
  edge: "left" | "right" | "top" | "bottom",
  groupId: string,
) {
  return desktopTerminalSessionsReducer(state, {
    type: "split-tab",
    sourceSessionId,
    targetGroupId,
    edge,
    groupId,
    splitId: `split-${groupId}`,
  });
}

function terminalHost(sessionId: string) {
  const host = document.createElement("div");
  host.className = "desktop-terminal-session-host";
  host.dataset.terminalSessionHostId = sessionId;
  return host;
}

function createSessionMove(): TerminalTabMoveDragController {
  return {
    dragging: false,
    dropIntent: null,
    start: vi.fn(),
    move: vi.fn(),
    end: vi.fn(() => "press"),
    cancel: vi.fn(),
    lostCapture: vi.fn(),
  };
}

function createRuntime(): TerminalRuntimeHandle {
  return {
    activity: false,
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
    setFocused: vi.fn(),
    setPresented: vi.fn(),
    subscribeActivity: vi.fn(() => () => undefined),
    subscribeReady: vi.fn(() => () => undefined),
    subscribeScrollbar: vi.fn(() => () => undefined),
    unmount: vi.fn(),
    write: vi.fn(),
  };
}
