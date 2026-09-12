import { defineAgentEvent } from "../../../support/agent/agentEventFixture";
/** @vitest-environment happy-dom */

import React from "react";

import { act } from "react";
import { describe, expect, it } from "vitest";

import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";

import { applyAgentEvents, createAgentProjection } from "../../../support/agent/agentDisplayFixture";

import { render, root } from "../../../support/agent/rendererHarness";
import { withTestLocalization } from "../../../support/react/localization";

describe("Desktop Agent renderer surfaces", () => {

  it("renders reasoning as a quiet disclosure branch instead of a message bubble", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "reasoning-1",
      turnId: "turn-1",
      itemId: "reasoning",
      kind: "reasoning",
      label: "Reasoning summary",
      status: "completed",
      output: "",
      detail: { delta: "Compared the provider boundaries." },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    expect(container.querySelector(".desktop-agent-reasoning")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-message")).toBeNull();
    act(() => (container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement).click());
    expect(container.textContent).toContain("Compared the provider boundaries.");
  });

  it("keeps a streaming reasoning summary behind the single live-tail status", () => {
    const events = [
      {
        schemaVersion: 1 as const,
        sequence: 1,
        sessionId: "session-reasoning",
        provider: "codex",
        providerSessionId: "native-reasoning",
        turnId: "turn-reasoning",
        itemId: null,
        emittedAt: new Date(1_000).toISOString(),
        type: "turn.started" as const,
        payload: { prompt: "Inspect" },
      },
      {
        schemaVersion: 1 as const,
        sequence: 2,
        sessionId: "session-reasoning",
        provider: "codex",
        providerSessionId: "native-reasoning",
        turnId: "turn-reasoning",
        itemId: "reasoning-summary",
        emittedAt: new Date(2_000).toISOString(),
        type: "reasoning.summary.delta" as const,
        payload: { delta: "Inspecting the project structure." },
      },
    ];
    const running = applyAgentEvents(createAgentProjection(), events);
    const container = render(React.createElement(AgentTranscript, {
      projection: running,
      loading: false,
      working: true,
      runtimeLabel: "Codex",
    }));

    expect(container.querySelector(".desktop-agent-reasoning")).toBeNull();
    expect(container.querySelectorAll(".desktop-agent-working-indicator")).toHaveLength(1);
    expect(container.querySelectorAll("[data-puppy-loader='dots']")).toHaveLength(1);
    expect(container.textContent).not.toContain("Working through the request");
    expect(container.textContent).not.toContain("Inspecting the project structure.");
    expect(container.querySelector(".desktop-agent-run-status-toggle")).not.toBeNull();
    act(() => (container.querySelector(".desktop-agent-run-status-toggle") as HTMLButtonElement).click());
    expect(container.textContent).toContain("Inspecting the project structure.");

    const settled = applyAgentEvents(running, [{
      ...events[0],
      sequence: 3,
      itemId: null,
      emittedAt: new Date(3_000).toISOString(),
      type: "turn.completed",
      payload: { status: "completed" },
    }]);
    act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, {
      projection: settled,
      loading: false,
      working: false,
      runtimeLabel: "Codex",
    }))));
    expect(container.querySelector(".desktop-agent-working-indicator")).toBeNull();
    expect(container.querySelector(".desktop-agent-reasoning")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-reasoning .desktop-agent-spin")).toBeNull();
  });

  it("omits empty reasoning boundaries after the owning turn settles", () => {
    const base = {
      schemaVersion: 1 as const,
      sessionId: "session-cursor",
      provider: "cursor",
      providerSessionId: "cursor-native-session",
      turnId: "turn-cursor",
    };
    const projection = applyAgentEvents(createAgentProjection(), [
      { ...base, sequence: 1, itemId: null, emittedAt: new Date(1_000).toISOString(), type: "turn.started", payload: { prompt: "?" } },
      defineAgentEvent({ ...base, sequence: 2, itemId: "cursor-thought", emittedAt: new Date(2_000).toISOString(), type: "reasoning.summary.delta", payload: { delta: "", boundary: true, status: "working" } }),
      { ...base, sequence: 3, itemId: "cursor-message", emittedAt: new Date(3_000).toISOString(), type: "assistant.completed", payload: { text: "I'm here." } },
      { ...base, sequence: 4, itemId: null, emittedAt: new Date(4_000).toISOString(), type: "turn.completed", payload: { status: "completed" } },
    ]);

    const container = render(React.createElement(AgentTranscript, {
      projection,
      loading: false,
      working: false,
      runtimeLabel: "Cursor Agent",
    }));

    expect(container.querySelector(".desktop-agent-reasoning")).toBeNull();
    expect(container.querySelector(".desktop-agent-working-indicator")).toBeNull();
    expect(container.textContent).not.toContain("Thought briefly");
    expect(container.textContent).not.toContain("Working through the request");
  });

  it("renders context compaction as a divider instead of a generic Tool timeline row", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "compact-1",
      turnId: "turn-1",
      itemId: "compact",
      kind: "tool",
      label: "Compacted context",
      status: "completed",
      output: "",
      detail: { tool: "compaction" },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    expect(container.querySelector(".desktop-agent-context-divider")?.textContent).toContain("Compacted context");
    expect(container.querySelector(".desktop-agent-tool-call")).toBeNull();
  });
});
