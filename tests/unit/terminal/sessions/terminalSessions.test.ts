import { describe, expect, it } from "vitest";
import {
  assertDesktopTerminalSessionsState,
  canInsertTerminalSession,
  canMergeTerminalGroup,
  canMoveTerminalGroup,
  canSplitTerminalSession,
  createDesktopTerminalSessionsState,
  desktopTerminalSessionsReducer,
  desktopTerminalSessionsStateErrors,
  findTerminalSessionGroup,
  getActiveTerminalGroup,
  getActiveTerminalSessionId,
  getOrderedTerminalSessions,
  getPresentedTerminalSessionIds,
  getTerminalLayoutGroupIds,
  type DesktopTerminalSessionsState,
} from "../../../../src/features/desktop-terminal/model/terminalSessions";

describe("Desktop Terminal local Tab Groups", () => {
  it.each([2, 3])(
    "preserves %i concurrent Sessions while splitting every Tab and merging them back",
    (sessionCount) => {
      let state = createDesktopTerminalSessionsState();
      for (let index = 0; index < sessionCount; index += 1) {
        state = create(
          state,
          `terminal-${index}`,
          index === 0 ? "group-0" : `unused-group-${index}`,
        );
      }
      const originalSessions = new Map(state.sessions.map((session) => [session.id, session]));

      expect(state.groups).toHaveLength(1);
      expect(state.groups[0]).toMatchObject({
        id: "group-0",
        sessionIds: Array.from({ length: sessionCount }, (_, index) => `terminal-${index}`),
        activeSessionId: `terminal-${sessionCount - 1}`,
      });
      assertDesktopTerminalSessionsState(state);

      for (let index = 1; index < sessionCount; index += 1) {
        state = split(
          state,
          `terminal-${index}`,
          "group-0",
          index % 2 === 0 ? "bottom" : "right",
          `group-${index}`,
          `split-${index}`,
        );
        assertDesktopTerminalSessionsState(state);
      }

      expect(state.groups).toHaveLength(sessionCount);
      expect(getTerminalLayoutGroupIds(state.root)).toHaveLength(sessionCount);
      expect(getPresentedTerminalSessionIds(state)).toHaveLength(sessionCount);
      for (let index = 0; index < sessionCount; index += 1) {
        expect(findTerminalSessionGroup(state, `terminal-${index}`)?.sessionIds)
          .toEqual([`terminal-${index}`]);
      }

      for (let index = 1; index < sessionCount; index += 1) {
        state = desktopTerminalSessionsReducer(state, {
          type: "merge-tab",
          sourceSessionId: `terminal-${index}`,
          targetGroupId: "group-0",
          targetIndex: index,
        });
        assertDesktopTerminalSessionsState(state);
      }

      expect(state.groups).toHaveLength(1);
      expect(state.root).toMatchObject({ kind: "group", groupId: "group-0" });
      expect(state.groups[0]?.sessionIds).toEqual(
        Array.from({ length: sessionCount }, (_, index) => `terminal-${index}`),
      );
      for (const session of state.sessions) {
        expect(session).toBe(originalSessions.get(session.id));
      }
      expect(desktopTerminalSessionsStateErrors(state)).toEqual([]);
    },
  );

  it("creates new Sessions as Tabs in the focused Group and deduplicates the launcher", () => {
    let state = createDesktopTerminalSessionsState("terminal-a");
    state = desktopTerminalSessionsReducer(state, {
      type: "create-launcher",
      sessionId: "launcher-a",
      groupId: "unused-group-a",
    });
    state = desktopTerminalSessionsReducer(state, {
      type: "create-launcher",
      sessionId: "launcher-duplicate",
      groupId: "unused-group-b",
    });

    expect(state.sessions).toMatchObject([
      { id: "terminal-a", launcherId: "shell", ordinal: 1, status: "starting" },
      { id: "launcher-a", launcherId: null, ordinal: 2, status: "selecting" },
    ]);
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]).toMatchObject({
      sessionIds: ["terminal-a", "launcher-a"],
      activeSessionId: "launcher-a",
    });
    expect(getActiveTerminalSessionId(state)).toBe("launcher-a");

    state = desktopTerminalSessionsReducer(state, {
      type: "launch",
      sessionId: "launcher-a",
      launcherId: "codex",
    });
    expect(state.sessions[1]).toMatchObject({
      launcherId: "codex",
      status: "starting",
    });
    assertDesktopTerminalSessionsState(state);
  });

  it("deduplicates launcher Tabs per Group rather than across the whole Sidebar", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");
    state = desktopTerminalSessionsReducer(state, {
      type: "create-launcher",
      sessionId: "launcher-left",
      groupId: "unused-left",
      targetGroupId: "group-a",
    });
    state = desktopTerminalSessionsReducer(state, {
      type: "create-launcher",
      sessionId: "launcher-right",
      groupId: "unused-right",
      targetGroupId: "group-b",
    });
    const beforeDuplicate = state;
    state = desktopTerminalSessionsReducer(state, {
      type: "create-launcher",
      sessionId: "launcher-right-duplicate",
      groupId: "unused-right-duplicate",
      targetGroupId: "group-b",
    });

    expect(state.sessions.map(({ id }) => id)).toContain("launcher-left");
    expect(state.sessions.map(({ id }) => id)).toContain("launcher-right");
    expect(state.sessions.map(({ id }) => id)).not.toContain("launcher-right-duplicate");
    expect(state.groups.find(({ id }) => id === "group-a")?.activeSessionId)
      .toBe("launcher-left");
    expect(state.groups.find(({ id }) => id === "group-b")?.activeSessionId)
      .toBe("launcher-right");
    expect(state.sessions).toBe(beforeDuplicate.sessions);
    assertDesktopTerminalSessionsState(state);
  });

  it("splits one Tab to the right into a new Group with its own Tab stack", () => {
    let state = createThreeTabs();
    const sessionBefore = state.sessions.find(({ id }) => id === "terminal-b");
    const targetGroupId = state.groups[0]!.id;

    state = split(state, "terminal-b", targetGroupId, "right", "group-b", "split-a-b");

    expect(state.groups).toHaveLength(2);
    expect(state.groups[0]).toMatchObject({
      id: "group-a",
      sessionIds: ["terminal-a", "terminal-c"],
      activeSessionId: "terminal-c",
    });
    expect(state.groups[1]).toMatchObject({
      id: "group-b",
      sessionIds: ["terminal-b"],
      activeSessionId: "terminal-b",
    });
    expect(state.root).toMatchObject({
      kind: "split",
      id: "split-a-b",
      direction: "horizontal",
      first: { kind: "group", groupId: "group-a" },
      second: { kind: "group", groupId: "group-b" },
    });
    expect(getActiveTerminalGroup(state)?.id).toBe("group-b");
    expect(state.sessions.find(({ id }) => id === "terminal-b")).toBe(sessionBefore);
    expect(getPresentedTerminalSessionIds(state)).toEqual(["terminal-c", "terminal-b"]);
    assertDesktopTerminalSessionsState(state);
  });

  it("supports nested horizontal and vertical Group splits", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");
    state = split(state, "terminal-c", "group-b", "bottom", "group-c", "split-b-c");

    expect(state.root).toMatchObject({
      kind: "split",
      id: "split-a-b",
      direction: "horizontal",
      first: { kind: "group", groupId: "group-a" },
      second: {
        kind: "split",
        id: "split-b-c",
        direction: "vertical",
        first: { kind: "group", groupId: "group-b" },
        second: { kind: "group", groupId: "group-c" },
      },
    });
    expect(getTerminalLayoutGroupIds(state.root)).toEqual(["group-a", "group-b", "group-c"]);
    expect(getPresentedTerminalSessionIds(state)).toEqual([
      "terminal-a",
      "terminal-b",
      "terminal-c",
    ]);
    assertDesktopTerminalSessionsState(state);
  });

  it("moves a sole Tab across the layout without leaving an empty Group", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");
    const sessionBefore = state.sessions.find(({ id }) => id === "terminal-b");

    state = split(state, "terminal-b", "group-a", "left", "group-b-moved", "split-moved");

    expect(state.groups.map(({ id }) => id).sort()).toEqual(["group-a", "group-b-moved"]);
    expect(getTerminalLayoutGroupIds(state.root)).toEqual(["group-b-moved", "group-a"]);
    expect(findTerminalSessionGroup(state, "terminal-b")?.id).toBe("group-b-moved");
    expect(state.sessions.find(({ id }) => id === "terminal-b")).toBe(sessionBefore);
    assertDesktopTerminalSessionsState(state);
  });

  it("swaps existing left/right Groups without creating or deleting a leaf", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");
    const groupsBefore = new Map(state.groups.map((group) => [group.id, group]));
    const sessionsBefore = state.sessions;

    expect(canMoveTerminalGroup(state, "group-b", "group-a")).toBe(true);
    state = desktopTerminalSessionsReducer(state, {
      type: "move-group",
      sourceGroupId: "group-b",
      targetGroupId: "group-a",
      edge: "left",
      splitId: "unused-for-direct-sibling",
    });

    expect(getTerminalLayoutGroupIds(state.root)).toEqual(["group-b", "group-a"]);
    expect(state.groups.find(({ id }) => id === "group-a")).toBe(groupsBefore.get("group-a"));
    expect(state.groups.find(({ id }) => id === "group-b")).toBe(groupsBefore.get("group-b"));
    expect(state.sessions).toEqual(sessionsBefore);
    expect(state.sessions.every((session, index) => session === sessionsBefore[index])).toBe(true);
    expect(state.activeGroupId).toBe("group-b");
    assertDesktopTerminalSessionsState(state);
  });

  it("moves a multi-Tab Group as one split-tree leaf", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");

    state = desktopTerminalSessionsReducer(state, {
      type: "move-group",
      sourceGroupId: "group-a",
      targetGroupId: "group-b",
      edge: "right",
      splitId: "unused-for-direct-sibling",
    });

    expect(getTerminalLayoutGroupIds(state.root)).toEqual(["group-b", "group-a"]);
    expect(state.groups.find(({ id }) => id === "group-a")?.sessionIds)
      .toEqual(["terminal-a", "terminal-c"]);
    expect(canMoveTerminalGroup(state, "group-a", "group-a")).toBe(false);
    assertDesktopTerminalSessionsState(state);
  });

  it("merges every Tab in a source Group into a target Bar as one ordered block", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");
    const sessionsBefore = state.sessions;

    expect(canMergeTerminalGroup(state, "group-a", "group-b", 1)).toBe(true);
    state = desktopTerminalSessionsReducer(state, {
      type: "merge-group",
      sourceGroupId: "group-a",
      targetGroupId: "group-b",
      targetIndex: 1,
    });

    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]).toMatchObject({
      id: "group-b",
      sessionIds: ["terminal-b", "terminal-a", "terminal-c"],
      activeSessionId: "terminal-c",
    });
    expect(state.root).toMatchObject({ kind: "group", groupId: "group-b" });
    expect(state.sessions.every((session, index) => session === sessionsBefore[index])).toBe(true);
    expect(canMergeTerminalGroup(state, "group-b", "group-b", 0)).toBe(false);
    assertDesktopTerminalSessionsState(state);
  });

  it("keeps one active Tab per visible Group while focus moves independently", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");
    state = desktopTerminalSessionsReducer(state, { type: "activate", sessionId: "terminal-a" });

    expect(state.activeGroupId).toBe("group-a");
    expect(getActiveTerminalSessionId(state)).toBe("terminal-a");
    expect(state.groups.find(({ id }) => id === "group-b")?.activeSessionId).toBe("terminal-b");
    expect(getPresentedTerminalSessionIds(state)).toEqual(["terminal-a", "terminal-b"]);
  });

  it("inserts a Tab at a relative position in another Bar and collapses its empty source Group", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");
    const sessionBefore = state.sessions.find(({ id }) => id === "terminal-b");

    state = desktopTerminalSessionsReducer(state, {
      type: "merge-tab",
      sourceSessionId: "terminal-b",
      targetGroupId: "group-a",
      targetIndex: 1,
    });

    expect(state.groups).toHaveLength(1);
    expect(state.root).toMatchObject({ kind: "group", groupId: "group-a" });
    expect(state.groups[0]).toMatchObject({
      sessionIds: ["terminal-a", "terminal-b", "terminal-c"],
      activeSessionId: "terminal-b",
    });
    expect(state.sessions.find(({ id }) => id === "terminal-b")).toBe(sessionBefore);
    assertDesktopTerminalSessionsState(state);
  });

  it("reorders a Tab inside its own Bar without changing the active Session", () => {
    let state = createThreeTabs();
    const sessionsBefore = state.sessions;

    expect(canInsertTerminalSession(state, "terminal-a", "group-a", 2)).toBe(true);
    state = desktopTerminalSessionsReducer(state, {
      type: "merge-tab",
      sourceSessionId: "terminal-a",
      targetGroupId: "group-a",
      targetIndex: 2,
    });

    expect(state.groups[0]).toMatchObject({
      sessionIds: ["terminal-b", "terminal-c", "terminal-a"],
      activeSessionId: "terminal-c",
    });
    expect(state.sessions).toEqual(sessionsBefore);
    expect(state.sessions[0]).toBe(sessionsBefore[0]);
    assertDesktopTerminalSessionsState(state);
  });

  it("keeps a multi-Tab source Group when one member joins another Bar", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");
    state = desktopTerminalSessionsReducer(state, {
      type: "create",
      sessionId: "terminal-d",
      groupId: "unused-group-d",
      targetGroupId: "group-b",
      launcherId: "shell",
    });
    state = desktopTerminalSessionsReducer(state, {
      type: "merge-tab",
      sourceSessionId: "terminal-b",
      targetGroupId: "group-a",
      targetIndex: 1,
    });

    expect(state.groups).toHaveLength(2);
    expect(state.groups.find(({ id }) => id === "group-a")).toMatchObject({
      sessionIds: ["terminal-a", "terminal-b", "terminal-c"],
      activeSessionId: "terminal-b",
    });
    expect(state.groups.find(({ id }) => id === "group-b")).toMatchObject({
      sessionIds: ["terminal-d"],
      activeSessionId: "terminal-d",
    });
    expect(getTerminalLayoutGroupIds(state.root)).toEqual(["group-a", "group-b"]);
    assertDesktopTerminalSessionsState(state);
  });

  it("rejects an insertion index outside the target Bar after source removal", () => {
    const state = createThreeTabs();
    expect(canInsertTerminalSession(state, "terminal-a", "group-a", 3)).toBe(false);
    expect(desktopTerminalSessionsReducer(state, {
      type: "merge-tab",
      sourceSessionId: "terminal-a",
      targetGroupId: "group-a",
      targetIndex: 3,
    })).toBe(state);
  });

  it("closes Tabs locally and collapses a Group only when its final Tab closes", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");

    state = desktopTerminalSessionsReducer(state, { type: "close", sessionId: "terminal-c" });
    expect(state.groups.find(({ id }) => id === "group-a")).toMatchObject({
      sessionIds: ["terminal-a"],
      activeSessionId: "terminal-a",
    });
    expect(state.groups).toHaveLength(2);

    state = desktopTerminalSessionsReducer(state, { type: "close", sessionId: "terminal-b" });
    expect(state.groups).toHaveLength(1);
    expect(state.root).toMatchObject({ kind: "group", groupId: "group-a" });
    expect(state.activeGroupId).toBe("group-a");
    assertDesktopTerminalSessionsState(state);
  });

  it("updates one Sidebar split ratio without affecting Session lifecycle", () => {
    let state = createThreeTabs();
    state = split(state, "terminal-b", "group-a", "right", "group-b", "split-a-b");
    const sessions = state.sessions;

    state = desktopTerminalSessionsReducer(state, {
      type: "resize-split",
      splitId: "split-a-b",
      ratio: 0.625,
    });

    expect(state.root).toMatchObject({ ratio: 0.625 });
    expect(state.sessions).toEqual(sessions);
    expect(state.sessions[0]).toBe(sessions[0]);
  });

  it("preserves ownership invariants across deterministic split, merge and focus commands", () => {
    let state = createDesktopTerminalSessionsState();
    for (let index = 0; index < 8; index += 1) {
      state = create(state, `terminal-${index}`, index === 0 ? "group-0" : `unused-${index}`);
    }
    let splitOrdinal = 0;
    for (const sessionId of ["terminal-1", "terminal-3", "terminal-5"]) {
      splitOrdinal += 1;
      state = split(
        state,
        sessionId,
        "group-0",
        splitOrdinal % 2 ? "right" : "bottom",
        `group-split-${splitOrdinal}`,
        `split-${splitOrdinal}`,
      );
      assertDesktopTerminalSessionsState(state);
    }
    state = desktopTerminalSessionsReducer(state, {
      type: "merge-tab",
      sourceSessionId: "terminal-3",
      targetGroupId: "group-0",
      targetIndex: 2,
    });
    state = desktopTerminalSessionsReducer(state, {
      type: "activate",
      sessionId: "terminal-5",
    });
    expect(desktopTerminalSessionsStateErrors(state)).toEqual([]);
    expect(getOrderedTerminalSessions(state).map(({ id }) => id).sort())
      .toEqual(state.sessions.map(({ id }) => id).sort());
  });

  it("rejects splitting the only Tab out of its own Group", () => {
    const state = createDesktopTerminalSessionsState("terminal-a");
    expect(canSplitTerminalSession(state, "terminal-a", state.groups[0]!.id)).toBe(false);
    expect(split(
      state,
      "terminal-a",
      state.groups[0]!.id,
      "right",
      "group-b",
      "split-a-b",
    )).toBe(state);
  });

  it("returns a failed startup to the selector inside the same local Tab Group", () => {
    let state = createDesktopTerminalSessionsState();
    state = desktopTerminalSessionsReducer(state, {
      type: "create-launcher",
      sessionId: "terminal-agent",
      groupId: "group-agent",
    });
    const groupBefore = state.groups[0];
    state = desktopTerminalSessionsReducer(state, {
      type: "launch",
      sessionId: "terminal-agent",
      launcherId: "claude",
    });
    state = desktopTerminalSessionsReducer(state, {
      type: "runtime-status",
      sessionId: "terminal-agent",
      status: "error",
      error: "Agent is unavailable",
    });

    expect(state.sessions[0]).toMatchObject({
      launcherId: null,
      launchError: "Agent is unavailable",
      status: "selecting",
    });
    expect(state.groups[0]).toBe(groupBefore);
  });
});

function createThreeTabs() {
  let state = createDesktopTerminalSessionsState();
  state = create(state, "terminal-a", "group-a");
  state = create(state, "terminal-b", "unused-b");
  return create(state, "terminal-c", "unused-c");
}

function create(
  state: DesktopTerminalSessionsState,
  sessionId: string,
  groupId: string,
) {
  return desktopTerminalSessionsReducer(state, {
    type: "create",
    sessionId,
    groupId,
    launcherId: "shell",
  });
}

function split(
  state: DesktopTerminalSessionsState,
  sourceSessionId: string,
  targetGroupId: string,
  edge: "left" | "right" | "top" | "bottom",
  groupId: string,
  splitId: string,
) {
  return desktopTerminalSessionsReducer(state, {
    type: "split-tab",
    sourceSessionId,
    targetGroupId,
    edge,
    groupId,
    splitId,
  });
}
