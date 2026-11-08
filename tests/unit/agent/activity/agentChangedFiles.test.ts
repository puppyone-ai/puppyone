import { describe, expect, it, vi } from "vitest";
import { AgentChangedFilesStore } from "../../../../src/features/desktop-agent-presence/agentChangedFilesStore";
import { observeAgentChangedFiles } from "../../../../src/features/desktop-agent-presence/observeAgentChangedFiles";
import { createEmptyAgentDisplay } from "../../../../shared/agent-contract/display-state.mjs";
import type { AgentActivity, AgentProjection } from "../../../../shared/agent-contract/display-types";

const edit = (path: string, overrides: Partial<AgentActivity> = {}): AgentActivity => ({
  id: path, itemId: path, turnId: "turn-1", kind: "file-change", label: "Edit", status: "completed",
  detail: { changes: [{ path, kind: "update", additions: 1, deletions: 1 }] }, output: "", sequence: 2, ...overrides,
});
function source() {
  let state = { session: { id: "session-1" }, control: { execution: { activeTurnId: null as string | null }, terminalTurns: [] as string[] }, projection: createEmptyAgentDisplay() as AgentProjection };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    send(active: boolean, activities: AgentActivity[], status: "completed" | "failed" = "completed") {
      state = { ...state, control: { execution: { activeTurnId: active ? "turn-1" : null }, terminalTurns: active ? [] : ["turn-1"] }, projection: {
        ...state.projection, activities, turns: [{ id: "turn-1", status: active ? "running" : status,
          startedAtSequence: 1, startedAtMs: 1, completedAtSequence: active ? null : 5, durationMs: null, partIds: [] }],
      } };
      listeners.forEach(listener => listener());
    },
  };
}

describe("Agent changed file highlights", () => {
  it("publishes only successful edits when a live turn settles, without replaying history", () => {
    const store = new AgentChangedFilesStore();
    const controller = source();
    controller.send(false, [edit("old.md")]);
    const stop = observeAgentChangedFiles("/workspace/a", controller, store);
    expect(store.has("/workspace/a", "old.md")).toBe(false);
    const edits = [edit("src/new.md"), edit("read.md", { kind: "tool", detail: { tool: "read", path: "read.md" } }),
      edit("failed.md", { status: "failed" }), edit("noop.md", { detail: { changes: [{ path: "noop.md", additions: 0, deletions: 0 }] } }),
      edit("../escape.md"), edit("/workspace/b/outside.md")];
    controller.send(true, edits);
    expect(store.has("/workspace/a", "src/new.md")).toBe(false);
    controller.send(false, edits);
    expect(store.has("/workspace/a", "src/new.md")).toBe(true);
    expect(store.has("/workspace/a", "src", true)).toBe(true);
    for (const path of ["old.md", "read.md", "failed.md", "noop.md", "../escape.md"]) expect(store.has("/workspace/a", path)).toBe(false);
    expect(store.has("/workspace/b", "src/new.md")).toBe(false);
    store.acknowledge("/workspace/a", "src/new.md");
    controller.send(false, edits);
    expect(store.has("/workspace/a", "src/new.md")).toBe(false);
    stop();
  });

  it("retains successful edits even when a later tool fails the turn", () => {
    const store = new AgentChangedFilesStore(); const controller = source();
    const stop = observeAgentChangedFiles("/workspace/a", controller, store);
    controller.send(true, [edit("changed.md")]);
    controller.send(false, [edit("changed.md")], "failed");
    expect(store.has("/workspace/a", "changed.md")).toBe(true);
    stop();
  });

  it("handles a coalesced terminal frame and successful writes without a diff", () => {
    const store = new AgentChangedFilesStore(); const controller = source();
    const stop = observeAgentChangedFiles("/workspace/a", controller, store);
    controller.send(false, [edit("write.md", { detail: { path: "write.md", changes: [] } }),
      edit("empty.md", { detail: { changes: [{ path: "empty.md", kind: "add", additions: 0, deletions: 0 }] } })]);
    expect(store.has("/workspace/a", "write.md")).toBe(true);
    expect(store.has("/workspace/a", "empty.md")).toBe(true);
    stop();
  });

  it("clears deleted files rather than leaving an unread parent with no viewable child", () => {
    const store = new AgentChangedFilesStore(); const controller = source();
    store.mark("/workspace/a", ["src/temp.md"]);
    const stop = observeAgentChangedFiles("/workspace/a", controller, store);
    const write = edit("src/temp.md");
    const remove = edit("remove", { sequence: 3, detail: { changes: [{ path: "src/temp.md", kind: "delete" }] } });
    controller.send(true, [write]); controller.send(false, [write, remove]);
    expect(store.has("/workspace/a", "src/temp.md")).toBe(false);
    expect(store.has("/workspace/a", "src", true)).toBe(false);
    stop();
  });

  it("correlates a local submission before session creation and ignores history after an epoch change", () => {
    type State = ReturnType<Parameters<typeof observeAgentChangedFiles>[1]["getSnapshot"]>;
    const store = new AgentChangedFilesStore();
    let state: State = { session: null, control: null, pendingIntent: { id: "local-command" }, projection: createEmptyAgentDisplay() };
    let notify = () => {};
    const stop = observeAgentChangedFiles("/workspace/a", {
      getSnapshot: () => state, subscribe: listener => { notify = listener; return () => {}; },
    }, store);
    const completed = source(); completed.send(false, [edit("quick.md")]);
    state = { ...completed.getSnapshot(), pendingIntent: null, control: {
      execution: { activeTurnId: null }, sessionEpoch: "first", terminalTurns: ["turn-1"],
      commands: [{ commandId: "local-command", kind: "start", targetTurnId: "turn-1" }],
    } };
    notify();
    expect(store.has("/workspace/a", "quick.md")).toBe(true);
    store.acknowledge("/workspace/a", "quick.md");
    state = { ...state, control: { ...state.control!, sessionEpoch: "second" } };
    notify();
    expect(store.has("/workspace/a", "quick.md")).toBe(false);
    stop();
  });

  it("persists unread paths, isolates roots and does not clear a newer edit with an older open", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = new AgentChangedFilesStore(storage);
    const listener = vi.fn(); const stop = store.subscribe("/workspace/a", listener);
    store.mark("/workspace/a", ["nested/file.md"]);
    const previous = store.version("/workspace/a", "nested/file.md");
    store.mark("/workspace/a", ["nested/file.md"]);
    store.acknowledge("/workspace/a", "nested/file.md", previous);
    expect(store.has("/workspace/a", "nested/file.md")).toBe(true);
    const restored = new AgentChangedFilesStore(storage);
    expect(restored.has("/workspace/a", "nested", true)).toBe(true);
    expect(restored.has("/workspace/b", "nested/file.md")).toBe(false);
    restored.acknowledge("/workspace/a", "nested/file.md");
    expect(new AgentChangedFilesStore(storage).has("/workspace/a", "nested/file.md")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });
});
