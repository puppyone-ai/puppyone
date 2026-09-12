import { describe, expect, it } from "vitest";
import { presentAgentChatWorkbenchItem } from "../../../../src/features/desktop-agent/workbench/AgentChatWorkbenchItem";

describe("Agent Chat Workbench contribution", () => {
  it("projects feature state into generic Tab chrome without leaking controller state", () => {
    expect(presentAgentChatWorkbenchItem({
      title: "Fix authentication",
      runtimeLabel: "Codex",
      runtimeIconKey: "codex",
      sessionId: "native-session-1",
      statusCode: "ready",
      running: true,
    }, "Agent")).toEqual({
      title: "Fix authentication",
      accessibleLabel: "Fix authentication — Codex — ready",
      detail: "Codex — ready",
      iconKey: "codex",
      status: "running",
      running: true,
      resourceId: "native-session-1",
    });
  });

  it("keeps native session identity out of the Workbench Item identity", () => {
    const snapshot = presentAgentChatWorkbenchItem({
      title: "New Chat",
      runtimeLabel: null,
      runtimeIconKey: null,
      sessionId: null,
      statusCode: "checking",
      running: false,
    }, "Agent");

    expect(snapshot.status).toBe("starting");
    expect(snapshot.resourceId).toBeNull();
    expect(snapshot.accessibleLabel).toBe("New Chat — Agent — checking");
  });
});
