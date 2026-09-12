import { describe, expect, it } from "vitest";
import {
  assertDesktopTerminalSessionsState,
  canInsertTerminalSession,
  canMergeTerminalGroup,
  canMoveTerminalGroup,
  canSplitTerminalSession,
  createDesktopTerminalSessionsState,
  desktopTerminalSessionsReducer,
  getOrderedTerminalSessions,
  getPresentedTerminalSessionIds,
  type DesktopTerminalLayoutNode,
  type DesktopTerminalSessionsAction,
  type DesktopTerminalSessionsState,
} from "../../../../src/features/desktop-terminal/model/terminalSessions";

const EDGES = ["left", "right", "top", "bottom"] as const;
const OPERATION_TYPES: readonly DesktopTerminalSessionsAction["type"][] = [
  "create",
  "create-launcher",
  "launch",
  "activate",
  "close",
  "split-tab",
  "merge-tab",
  "move-group",
  "merge-group",
  "resize-split",
  "runtime-status",
];
const SEEDS = [
  0x0000_0001,
  0x1020_3040,
  0x243f_6a88,
  0x5eed_c0de,
  0x7f4a_7c15,
  0x9e37_79b9,
  0xcafe_babe,
  0xffff_ffff,
];
const STEPS_PER_SEED = 500;

describe("Desktop Terminal reducer state machine", () => {
  it("preserves every ownership invariant across reproducible randomized command sequences", () => {
    const aggregateCoverage = new Map<DesktopTerminalSessionsAction["type"], number>();

    for (const seed of SEEDS) {
      const first = runScenario(seed);
      const replay = runScenario(seed);
      expect(replay.snapshot, `seed ${formatSeed(seed)} must replay deterministically`)
        .toBe(first.snapshot);
      expect(replay.invalidAttempts).toBe(first.invalidAttempts);
      for (const [type, count] of first.coverage) {
        aggregateCoverage.set(type, (aggregateCoverage.get(type) ?? 0) + count);
      }
    }

    for (const type of OPERATION_TYPES) {
      expect(
        aggregateCoverage.get(type) ?? 0,
        `randomized matrix never exercised ${type}`,
      ).toBeGreaterThan(0);
    }
  });
});

function runScenario(seed: number) {
  const random = mulberry32(seed);
  const ids = { session: 0, group: 0, split: 0 };
  const coverage = new Map<DesktopTerminalSessionsAction["type"], number>();
  let invalidAttempts = 0;
  let state = createDesktopTerminalSessionsState();

  for (let step = 0; step < STEPS_PER_SEED; step += 1) {
    if (step % 19 === 0) {
      const invalidAction = createInvalidAction(state, ids, step);
      expect(
        desktopTerminalSessionsReducer(state, invalidAction),
        `seed ${formatSeed(seed)} step ${step} accepted invalid ${invalidAction.type}`,
      ).toBe(state);
      invalidAttempts += 1;
    }

    const requestedType = OPERATION_TYPES[
      (step + randomInteger(random, OPERATION_TYPES.length)) % OPERATION_TYPES.length
    ]!;
    const action = createAction(state, requestedType, random, ids);
    const before = state;
    const beforeSessions = new Map(before.sessions.map((session) => [session.id, session]));
    state = desktopTerminalSessionsReducer(before, action);
    coverage.set(action.type, (coverage.get(action.type) ?? 0) + 1);

    assertState(seed, step, state);
    if (isLayoutOnlyAction(action)) {
      for (const session of state.sessions) {
        expect(
          session,
          `seed ${formatSeed(seed)} step ${step} recreated ${session.id} during ${action.type}`,
        ).toBe(beforeSessions.get(session.id));
      }
    }
    if (!changesSessionMembership(action)) {
      expect(state.sessions.map(({ id }) => id).sort()).toEqual(
        before.sessions.map(({ id }) => id).sort(),
      );
    }
  }

  return {
    coverage,
    invalidAttempts,
    snapshot: JSON.stringify(state),
  };
}

function createAction(
  state: DesktopTerminalSessionsState,
  requestedType: DesktopTerminalSessionsAction["type"],
  random: () => number,
  ids: IdCounters,
): DesktopTerminalSessionsAction {
  if (requestedType === "create") return createSessionAction(state, random, ids);
  if (requestedType === "create-launcher") {
    if (state.sessions.length >= 12) return closeAction(state, random, ids);
    return {
      type: "create-launcher",
      sessionId: nextId(ids, "session"),
      groupId: nextId(ids, "group"),
      targetGroupId: pick(state.groups, random)?.id ?? null,
    };
  }
  if (requestedType === "launch") {
    const selecting = state.sessions.filter(({ status }) => status === "selecting");
    const session = pick(selecting, random);
    return session
      ? { type: "launch", sessionId: session.id, launcherId: "shell" }
      : createLauncherFallback(state, random, ids);
  }
  if (requestedType === "activate") {
    const session = pick(state.sessions, random);
    return session
      ? { type: "activate", sessionId: session.id }
      : createSessionAction(state, random, ids);
  }
  if (requestedType === "close") return closeAction(state, random, ids);
  if (requestedType === "split-tab") {
    const candidates = state.sessions.flatMap((session) => state.groups
      .filter((group) => canSplitTerminalSession(state, session.id, group.id))
      .map((group) => ({ sessionId: session.id, groupId: group.id })));
    const candidate = pick(candidates, random);
    return candidate
      ? {
          type: "split-tab",
          sourceSessionId: candidate.sessionId,
          targetGroupId: candidate.groupId,
          edge: pick(EDGES, random)!,
          groupId: nextId(ids, "group"),
          splitId: nextId(ids, "split"),
        }
      : createSessionAction(state, random, ids);
  }
  if (requestedType === "merge-tab") {
    const session = pick(state.sessions, random);
    const group = pick(state.groups, random);
    if (!session || !group) return createSessionAction(state, random, ids);
    const sourceGroup = state.groups.find(({ sessionIds }) => sessionIds.includes(session.id));
    const maximum = group.sessionIds.length - (sourceGroup?.id === group.id ? 1 : 0);
    const targetIndex = randomInteger(random, maximum + 1);
    if (!canInsertTerminalSession(state, session.id, group.id, targetIndex)) {
      return createSessionAction(state, random, ids);
    }
    return {
      type: "merge-tab",
      sourceSessionId: session.id,
      targetGroupId: group.id,
      targetIndex,
    };
  }
  if (requestedType === "move-group") {
    const pairs = distinctGroupPairs(state).filter(({ source, target }) => (
      canMoveTerminalGroup(state, source.id, target.id)
    ));
    const pair = pick(pairs, random);
    return pair
      ? {
          type: "move-group",
          sourceGroupId: pair.source.id,
          targetGroupId: pair.target.id,
          edge: pick(EDGES, random)!,
          splitId: nextId(ids, "split"),
        }
      : splitFallback(state, random, ids);
  }
  if (requestedType === "merge-group") {
    const pairs = distinctGroupPairs(state);
    const pair = pick(pairs, random);
    if (!pair) return splitFallback(state, random, ids);
    const targetIndex = randomInteger(random, pair.target.sessionIds.length + 1);
    if (!canMergeTerminalGroup(state, pair.source.id, pair.target.id, targetIndex)) {
      return splitFallback(state, random, ids);
    }
    return {
      type: "merge-group",
      sourceGroupId: pair.source.id,
      targetGroupId: pair.target.id,
      targetIndex,
    };
  }
  if (requestedType === "resize-split") {
    const splitId = pick(collectSplitIds(state.root), random);
    return splitId
      ? { type: "resize-split", splitId, ratio: random() * 1.6 - 0.3 }
      : splitFallback(state, random, ids);
  }
  const session = pick(state.sessions, random);
  return session
    ? {
        type: "runtime-status",
        sessionId: session.id,
        status: pick(["starting", "running", "exited", "error"] as const, random)!,
        shell: random() > 0.5 ? "zsh" : "bash",
        error: "seeded failure",
      }
    : createSessionAction(state, random, ids);
}

function createSessionAction(
  state: DesktopTerminalSessionsState,
  random: () => number,
  ids: IdCounters,
): DesktopTerminalSessionsAction {
  if (state.sessions.length >= 12) return closeAction(state, random, ids);
  return {
    type: "create",
    sessionId: nextId(ids, "session"),
    groupId: nextId(ids, "group"),
    targetGroupId: pick(state.groups, random)?.id ?? null,
    launcherId: "shell",
  };
}

function createLauncherFallback(
  state: DesktopTerminalSessionsState,
  random: () => number,
  ids: IdCounters,
): DesktopTerminalSessionsAction {
  return state.sessions.length >= 12
    ? closeAction(state, random, ids)
    : {
        type: "create-launcher",
        sessionId: nextId(ids, "session"),
        groupId: nextId(ids, "group"),
        targetGroupId: pick(state.groups, random)?.id ?? null,
      };
}

function closeAction(
  state: DesktopTerminalSessionsState,
  random: () => number,
  ids: IdCounters,
): DesktopTerminalSessionsAction {
  const session = pick(state.sessions, random);
  return session
    ? { type: "close", sessionId: session.id }
    : createSessionAction(state, random, ids);
}

function splitFallback(
  state: DesktopTerminalSessionsState,
  random: () => number,
  ids: IdCounters,
): DesktopTerminalSessionsAction {
  const candidates = state.sessions.flatMap((session) => state.groups
    .filter((group) => canSplitTerminalSession(state, session.id, group.id))
    .map((group) => ({ sessionId: session.id, groupId: group.id })));
  const candidate = pick(candidates, random);
  return candidate
    ? {
        type: "split-tab",
        sourceSessionId: candidate.sessionId,
        targetGroupId: candidate.groupId,
        edge: pick(EDGES, random)!,
        groupId: nextId(ids, "group"),
        splitId: nextId(ids, "split"),
      }
    : createSessionAction(state, random, ids);
}

function createInvalidAction(
  state: DesktopTerminalSessionsState,
  ids: IdCounters,
  step: number,
): DesktopTerminalSessionsAction {
  const session = state.sessions[0];
  if (session && step % 2 === 0) {
    return {
      type: "create",
      sessionId: session.id,
      groupId: nextId(ids, "group"),
      launcherId: "shell",
    };
  }
  return {
    type: "merge-tab",
    sourceSessionId: session?.id ?? "missing-session",
    targetGroupId: "missing-group",
    targetIndex: -1,
  };
}

function assertState(seed: number, step: number, state: DesktopTerminalSessionsState) {
  expect(() => assertDesktopTerminalSessionsState(state), (
    `seed ${formatSeed(seed)} step ${step} violated an ownership invariant`
  )).not.toThrow();
  expect(getOrderedTerminalSessions(state).map(({ id }) => id).sort()).toEqual(
    state.sessions.map(({ id }) => id).sort(),
  );
  expect(getPresentedTerminalSessionIds(state)).toHaveLength(state.groups.length);
  expect(Object.isFrozen(state)).toBe(true);
  expect(state.sessions.every(Object.isFrozen)).toBe(true);
  expect(state.groups.every(Object.isFrozen)).toBe(true);
}

function distinctGroupPairs(state: DesktopTerminalSessionsState) {
  return state.groups.flatMap((source) => state.groups
    .filter((target) => target.id !== source.id)
    .map((target) => ({ source, target })));
}

function collectSplitIds(root: DesktopTerminalLayoutNode | null): string[] {
  if (!root || root.kind === "group") return [];
  return [root.id, ...collectSplitIds(root.first), ...collectSplitIds(root.second)];
}

function isLayoutOnlyAction(action: DesktopTerminalSessionsAction) {
  return action.type === "activate"
    || action.type === "split-tab"
    || action.type === "merge-tab"
    || action.type === "move-group"
    || action.type === "merge-group"
    || action.type === "resize-split";
}

function changesSessionMembership(action: DesktopTerminalSessionsAction) {
  return action.type === "create"
    || action.type === "create-launcher"
    || action.type === "close";
}

type IdCounters = {
  session: number;
  group: number;
  split: number;
};

function nextId(ids: IdCounters, kind: keyof IdCounters) {
  ids[kind] += 1;
  return `state-machine-${kind}-${ids[kind]}`;
}

function pick<T>(values: readonly T[], random: () => number): T | undefined {
  return values[randomInteger(random, values.length)];
}

function randomInteger(random: () => number, upperExclusive: number) {
  return upperExclusive > 0 ? Math.floor(random() * upperExclusive) : 0;
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b_79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function formatSeed(seed: number) {
  return `0x${(seed >>> 0).toString(16).padStart(8, "0")}`;
}
