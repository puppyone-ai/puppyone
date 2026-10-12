import { describe, expect, it } from "vitest";
import {
  reachHeaderChangesStatus,
  resolveProjectReachState,
  resolveReachAudience,
  type ReachDestination,
} from "../../../../src/features/app-shell/project-reach";

const destinations: readonly ReachDestination[] = [
  { id: "viktor", brand: "Viktor", label: "Viktor" },
  { id: "claude", brand: "Claude", label: "Claude" },
  { id: "person", brand: null, label: "A person" },
  { id: "mcp", brand: null, label: "Other MCP client" },
];

function share(id: string, name: string, lastSeenAt: string | null = null) {
  return { id, name, lastSeenAt };
}

describe("reach audience", () => {
  it("reads a person from the invite destination and a machine from a brand", () => {
    expect(resolveReachAudience("A person", destinations)).toBe("person");
    expect(resolveReachAudience("a person", destinations)).toBe("person");
    expect(resolveReachAudience("Viktor", destinations)).toBe("machine");
    expect(resolveReachAudience("Claude", destinations)).toBe("machine");
  });

  it("treats anything it cannot identify as a machine instead of claiming a person", () => {
    expect(resolveReachAudience("Internal tool", destinations)).toBe("machine");
    expect(resolveReachAudience("   ", destinations)).toBe("machine");
    expect(resolveReachAudience("Other MCP client", destinations)).toBe("machine");
  });
});

describe("project reach state", () => {
  const base = { destinations, shares: [] as ReturnType<typeof share>[] };

  it("stays quiet while only this device reaches the project", () => {
    for (const kind of ["local", "signed-out", "resolving", "published"] as const) {
      const state = resolveProjectReachState({ ...base, share: kind });
      expect(state.kind).toBe("only-you");
      expect(state.emphasis).toBe(false);
      expect(state.members).toEqual([]);
    }
  });

  it("counts people and machines separately once somebody can reach it", () => {
    const state = resolveProjectReachState({
      ...base,
      share: "shared",
      shares: [share("1", "A person", "2026-10-13T00:00:00.000Z"), share("2", "Viktor"), share("3", "Claude")],
    });
    expect(state.kind).toBe("reachable");
    expect([state.people, state.machines]).toEqual([1, 2]);
    expect(state.members.map((member) => member.audience)).toEqual(["person", "machine", "machine"]);
    expect(state.emphasis).toBe(false);
  });

  it("names the destination still waiting for its first read", () => {
    const waiting = resolveProjectReachState({
      ...base, share: "waiting", shares: [share("1", "Viktor")],
    });
    expect(waiting.kind).toBe("waiting");
    expect(waiting.waitingFor).toBe("Viktor");
    const named = resolveProjectReachState({
      ...base, share: "waiting", shares: [share("1", "Viktor")], waitingFor: "Claude",
    });
    expect(named.waitingFor).toBe("Claude");
  });

  it("states activity instead of reach while a destination is working", () => {
    const state = resolveProjectReachState({
      ...base,
      share: "shared",
      shares: [share("1", "Viktor", "2026-10-13T00:00:00.000Z"), share("2", "Claude")],
      activity: { "2": { kind: "writing", label: "Claude" } },
    });
    expect(state.kind).toBe("working");
    expect(state.members[1]?.activity).toEqual({ kind: "writing", label: "Claude" });
    expect(state.members[0]?.activity).toBeNull();
  });

  it("emphasizes only what the user has to deal with", () => {
    const attention = resolveProjectReachState({ ...base, share: "attention" });
    expect([attention.kind, attention.emphasis]).toEqual(["attention", true]);
    const shared = resolveProjectReachState({ ...base, share: "shared", shares: [share("1", "Viktor")] });
    expect(shared.emphasis).toBe(false);
  });

  it("puts the missing working copy ahead of every other statement", () => {
    const state = resolveProjectReachState({
      ...base,
      share: "attention",
      shares: [share("1", "Viktor")],
      activity: { "1": { kind: "reading", label: "Viktor" } },
      deviceCopyAvailable: false,
    });
    expect(state.kind).toBe("not-on-this-device");
    expect(state.emphasis).toBe(false);
  });

  it("keeps the freshest read as the fact worth stating, ignoring unusable timestamps", () => {
    const state = resolveProjectReachState({
      ...base,
      share: "shared",
      shares: [
        share("1", "Viktor", "2026-10-12T10:00:00.000Z"),
        share("2", "Claude", "2026-10-13T10:00:00.000Z"),
        share("3", "A person", "not a date"),
      ],
    });
    expect(state.freshest?.name).toBe("Claude");
  });
});

describe("header changes status", () => {
  it("drops incoming and outgoing distance while keeping this device's own work", () => {
    expect(reachHeaderChangesStatus({ conflicts: 1, incoming: 3, localChanges: 4, outgoing: 2 }))
      .toEqual({ conflicts: 1, incoming: 0, localChanges: 4, outgoing: 0 });
  });

  it("returns the established status untouched when there is no distance to hide", () => {
    const status = { conflicts: 0, incoming: 0, localChanges: 2, outgoing: 0 };
    expect(reachHeaderChangesStatus(status)).toBe(status);
  });
});
