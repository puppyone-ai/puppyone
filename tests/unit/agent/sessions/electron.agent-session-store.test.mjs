import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionStore } from "../../../../electron/main/agent/application/agent-session-store.mjs";

describe("AgentSessionStore", () => {
  it("owns one destruction listener per window and releases it after the final session", () => {
    const onOwnerDestroyed = vi.fn();
    const sender = new Sender(7);
    const store = new AgentSessionStore({ onOwnerDestroyed });
    const first = session("first", sender, false);
    const second = session("second", sender, false);

    store.add(first);
    store.add(second);
    expect(sender.listenerCount("destroyed")).toBe(1);
    store.remove(first);
    expect(sender.listenerCount("destroyed")).toBe(1);
    store.remove(second);
    expect(sender.listenerCount("destroyed")).toBe(0);
  });

  it("keeps an unrelated retired snapshot when a requested id is missing", () => {
    const sender = new Sender(8);
    const store = new AgentSessionStore({ onOwnerDestroyed: vi.fn() });
    const retained = session("retained", sender, true);
    store.add(retained);

    expect(store.takeRetired(8, "/workspace", "missing")).toBeNull();
    expect(store.size).toBe(1);
    expect(store.takeRetired(8, "/workspace")).toBe(retained);
    expect(store.size).toBe(0);
  });
});

function session(id, sender, providerExited) {
  return {
    id,
    ownerId: sender.id,
    sender,
    workspaceRoot: "/workspace",
    providerExited,
    providerSessionId: `native-${id}`,
    updatedAt: "2026-07-11T00:00:00.000Z",
    persistTimer: null,
  };
}

class Sender extends EventEmitter {
  constructor(id) { super(); this.id = id; }
}
