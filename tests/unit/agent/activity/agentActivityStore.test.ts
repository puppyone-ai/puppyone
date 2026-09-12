import { describe, expect, it, vi } from "vitest";
import type { AgentActivityClient } from "../../../../src/features/desktop-agent-presence/application/agentActivityClient";
import {
  AGENT_FILE_ACTIVITY_COMPLETION_LINGER_MS,
  AgentActivityStore,
} from "../../../../src/features/desktop-agent-presence/application/agentActivityStore";
import type { AgentActivityEvent } from "../../../../shared/agent-activity-contract/types";
import {
  normalizeWorkspaceRelativePath,
  toWorkspaceRelativePath,
} from "../../../../src/features/desktop-agent-presence/domain/agentActivity";

describe("AgentActivityStore", () => {
  it("uses one native subscription and updates only affected path listeners", async () => {
    let nativeListener: ((event: AgentActivityEvent) => void) | null = null;
    const client: AgentActivityClient = {
      subscribe: vi.fn(async () => ({ schemaVersion: 1, activities: [] })),
      onEvent: vi.fn((listener) => {
        nativeListener = listener;
        return () => undefined;
      }),
      unsubscribe: vi.fn(),
    };
    const store = new AgentActivityStore(client);
    const appListener = vi.fn();
    const otherListener = vi.fn();
    store.subscribePath("src/App.tsx", appListener);
    store.subscribePath("src/Other.tsx", otherListener);
    expect(client.subscribe).toHaveBeenCalledTimes(1);
    nativeListener?.(event({ path: "src/App.tsx", operation: "file.read" }));
    expect(appListener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();
    expect(store.getPathSnapshot("src/App.tsx")?.primary).toMatchObject({
      providerLabel: "Codex",
      kind: "reading",
    });
    store.dispose();
  });

  it("prioritizes writes over reads and removes cancelled claims", () => {
    const client: AgentActivityClient = {
      subscribe: async () => ({ schemaVersion: 1, activities: [] }),
      onEvent: () => () => undefined,
      unsubscribe: () => undefined,
    };
    const store = new AgentActivityStore(client);
    store.apply(event({ activityId: "read", operation: "file.read" }));
    store.apply(event({ activityId: "write", providerId: "claude", operation: "file.write" }));
    expect(store.getPathSnapshot("src/App.tsx")?.primary).toMatchObject({
      providerLabel: "Claude Code",
      kind: "writing",
    });
    store.apply(event({ activityId: "write", providerId: "claude", operation: "file.write", phase: "cancelled" }));
    expect(store.getPathSnapshot("src/App.tsx")?.primary.kind).toBe("reading");
    store.dispose();
  });

  it("keeps a completed claim visible long enough to be perceived", () => {
    vi.useFakeTimers();
    const client: AgentActivityClient = {
      subscribe: async () => ({ schemaVersion: 1, activities: [] }),
      onEvent: () => () => undefined,
      unsubscribe: () => undefined,
    };
    const store = new AgentActivityStore(client);
    try {
      store.apply(event({ phase: "started" }));
      store.apply(event({ phase: "completed" }));
      expect(store.getPathSnapshot("src/App.tsx")?.primary.phase).toBe("completed");
      vi.advanceTimersByTime(AGENT_FILE_ACTIVITY_COMPLETION_LINGER_MS - 1);
      expect(store.getPathSnapshot("src/App.tsx")).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(store.getPathSnapshot("src/App.tsx")).toBeNull();
    } finally {
      store.dispose();
      vi.useRealTimers();
    }
  });
});

describe("Agent activity workspace path projection", () => {
  it("uses the same key for relative Editor resources and absolute Explorer paths", () => {
    const root = "/workspace/sample-project";
    expect(toWorkspaceRelativePath(root, "notes.md")).toBe("notes.md");
    expect(toWorkspaceRelativePath(root, "./notes/today.md")).toBe("notes/today.md");
    expect(toWorkspaceRelativePath(root, `${root}/notes.md`)).toBe("notes.md");
    expect(toWorkspaceRelativePath("C:\\workspace", "C:\\workspace\\src\\app.ts"))
      .toBe("src/app.ts");
  });

  it("rejects resources that do not identify a workspace-relative file", () => {
    const root = "/workspace/sample-project";
    expect(toWorkspaceRelativePath(root, root)).toBeNull();
    expect(toWorkspaceRelativePath(root, "/workspace/other-project/secret.md")).toBeNull();
    expect(toWorkspaceRelativePath(root, "../secret.md")).toBeNull();
    expect(toWorkspaceRelativePath(root, "file:///workspace/other-project/secret.md")).toBeNull();
    expect(normalizeWorkspaceRelativePath("C:\\outside\\secret.md")).toBeNull();
  });
});

function event(overrides: Partial<AgentActivityEvent> & { path?: string } = {}): AgentActivityEvent {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    activityId: overrides.activityId ?? "activity-1",
    providerId: overrides.providerId ?? "codex",
    terminalSessionId: "terminal-1",
    phase: overrides.phase ?? "started",
    operation: overrides.operation ?? "file.read",
    targets: [{
      workspaceRelativePath: overrides.path ?? "src/App.tsx",
      access: overrides.operation === "file.write" ? "write" : "read",
      confidence: "exact",
    }],
    occurredAt: 1,
  };
}
