/** @vitest-environment happy-dom */
import { finalizeDisplay } from "../../../support/agent/agentDisplayFixture";

import React from "react";

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { AgentTranscript, agentRunStatusCode, agentSubmissionStatusLabel, shouldShowAgentThinking } from "../../../../src/features/desktop-agent/ui/AgentTranscript";
import { agentRunActiveElapsedMs } from "../../../../src/features/desktop-agent/ui/useAgentRunActiveElapsed";

import { applyAgentEvents, createAgentProjection } from "../../../support/agent/agentDisplayFixture";

import { stripBidiIsolation, testT, withTestLocalization } from "../../../support/react/localization";
import { root, render } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {

  it("renders a quiet document flow without role labels or a generic response toolbar", () => {
    const projection = createAgentProjection();
    projection.messages.push(
      {
        id: "user-1",
        role: "user",
        text: "Review @docs/README.md architecture",
        references: [
          { id: "image-1", kind: "attachment", displayName: "capture.png", mime: "image/png", size: 128 },
          { id: "file-1", kind: "workspace-file", displayName: "README.md", relativePath: "docs/README.md" },
        ],
        promptMentions: [{ referenceId: "file-1", start: 7, end: 22 }],
        sequence: 1,
        turnId: "turn-1",
        itemId: null,
        streaming: false,
        terminalState: null,
      },
      {
        id: "assistant-1",
        role: "assistant",
        text: "The boundary is clean.",
        sequence: 2,
        turnId: "turn-1",
        itemId: "message-1",
        streaming: false,
        terminalState: "completed",
      },
    );

    const container = render(React.createElement(AgentTranscript, { projection, loading: false, runtimeLabel: "OpenCode" }));
    expect(container.querySelector(".desktop-agent-message-role")).toBeNull();
    const userMessage = container.querySelector(".desktop-agent-message.is-user")!;
    const userReferences = userMessage.querySelector(".desktop-agent-message-references")!;
    const userText = userMessage.querySelector(".desktop-agent-message-text")!;
    expect(userMessage.getAttribute("aria-label")).toBe("You");
    expect(userReferences.getAttribute("role")).toBe("list");
    expect(userReferences.querySelectorAll('[role="listitem"]')).toHaveLength(1);
    expect(userReferences.textContent).toContain("capture.png");
    expect(userReferences.textContent).not.toContain("README.md");
    const historyMention = userText.querySelector(".desktop-agent-history-mention");
    expect(historyMention?.textContent).toBe("@docs/README.md");
    expect(historyMention?.getAttribute("title")).toBe("docs/README.md");
    expect(historyMention?.getAttribute("data-reference-kind")).toBe("workspace-file");
    expect(userReferences.compareDocumentPosition(userText) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(container.querySelector(".desktop-agent-message.is-assistant")?.getAttribute("aria-label")).toBe("OpenCode");
    expect(container.querySelector(".desktop-agent-message.is-user")?.getAttribute("data-message-surface")).toBe("row");
    expect(container.querySelector(".desktop-agent-message.is-assistant")?.getAttribute("data-message-surface")).toBe("document");
    expect(container.querySelector('button[aria-label="Copy response"]')).toBeNull();
  });

  it("renders one muted duration summary after a terminal Agent turn", () => {
    const projection = createAgentProjection();
    projection.messages = [{
      id: "assistant-duration",
      role: "assistant",
      turnId: "turn-duration",
      itemId: "message-duration",
      text: "Finished the requested work.",
      streaming: false,
      terminalState: "completed",
      sequence: 2,
    }];
    projection.turns = [{
      id: "turn-duration",
      status: "completed",
      startedAtSequence: 1,
      startedAtMs: 1_000,
      completedAtSequence: 3,
      durationMs: 62_000,
      partIds: ["assistant-duration"],
    }];

    const container = render(React.createElement(AgentTranscript, {
      projection: finalizeDisplay(projection),
      loading: false,
      runtimeLabel: "Codex",
    }));
    expect(container.querySelectorAll(".desktop-agent-turn-summary")).toHaveLength(1);
    expect(container.querySelector(".desktop-agent-turn-summary")?.textContent).toBe("Worked for 1m 2s");
  });

  it("distinguishes native session preparation from genuine Thinking and then yields to streaming text", () => {
    const preparing = createAgentProjection();
    expect(shouldShowAgentThinking(preparing, true)).toBe(false);
    expect(stripBidiIsolation(agentSubmissionStatusLabel("preparing-session", "Codex", testT))).toBe("Preparing Codex");
    expect(agentSubmissionStatusLabel("starting-turn", "Codex", testT)).toBe("Starting turn");

    const container = render(React.createElement(AgentTranscript, {
      projection: preparing,
      loading: false,
      working: true,
      pendingPrompt: "Please inspect this",
      submissionStage: "preparing-session",
      runtimeLabel: "Codex",
    }));
    expect(stripBidiIsolation(container.querySelector(".desktop-agent-working-indicator")?.getAttribute("aria-label"))).toBe("Preparing Codex");
    expect(container.textContent).not.toContain("Thinking");
    expect(container.querySelector(".desktop-agent-message.is-user")?.textContent).toContain("Please inspect this");

    const projection = createAgentProjection();
    projection.runningTurnId = "turn-live";
    projection.turns = [{ id: "turn-live", status: "running", startedAtSequence: 1, startedAtMs: 1_000, completedAtSequence: null, durationMs: null, partIds: [] }];
    expect(shouldShowAgentThinking(projection, true)).toBe(true);
    act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, { projection, loading: false, working: true, runtimeLabel: "Codex" }))));
    expect(stripBidiIsolation(container.querySelector(".desktop-agent-working-indicator")?.getAttribute("aria-label"))).toBe("Codex is thinking");

    const streaming = createAgentProjection();
    streaming.runningTurnId = "turn-live";
    streaming.turns = [{ id: "turn-live", status: "running", startedAtSequence: 1, startedAtMs: 1_000, completedAtSequence: null, durationMs: null, partIds: ["assistant:message-live"] }];
    streaming.messages = [{
      id: "assistant:message-live",
      role: "assistant",
      turnId: "turn-live",
      itemId: "message-live",
      text: "Streaming now",
      streaming: true,
      terminalState: null,
      sequence: 2,
    }];
    streaming.parts = [{ ...streaming.messages[0], kind: "assistant" }];
    streaming.rows = [{ id: "row:assistant:message-live", partId: "assistant:message-live", turnId: "turn-live", kind: "assistant", sequence: 2, estimatedHeight: 64 }];
    expect(shouldShowAgentThinking(streaming, true)).toBe(false);
    act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, { projection: streaming, loading: false, working: true, runtimeLabel: "Codex" }))));
    expect(container.querySelector(".desktop-agent-working-indicator")).toBeNull();
    expect(container.querySelector(".desktop-agent-stream-caret")).not.toBeNull();
  });

  it("uses one quiet live-tail indicator and reveals elapsed work after five seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const projection = createAgentProjection();
    projection.runningTurnId = "turn-live";
    projection.turns = [{
      id: "turn-live",
      status: "running",
      startedAtSequence: 1,
      startedAtMs: 1_000,
      completedAtSequence: null,
      durationMs: null,
      partIds: [],
    }];

    const container = render(React.createElement(AgentTranscript, {
      projection,
      loading: false,
      working: true,
      runtimeLabel: "Codex",
    }));
    expect(container.querySelectorAll(".desktop-agent-working-indicator")).toHaveLength(1);
    expect(container.querySelector(".desktop-agent-working-indicator")?.textContent).toBe("Thinking");

    act(() => vi.advanceTimersByTime(5_000));
    expect(container.querySelector(".desktop-agent-working-indicator")?.textContent).toBe("Thinking · 5s");
    expect(container.querySelectorAll("[data-puppy-loader='dots']")).toHaveLength(1);
  });

  it("excludes approval wait from the active run duration", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      {
        schemaVersion: 1,
        sequence: 1,
        sessionId: "session-wait",
        provider: "codex",
        providerSessionId: "native-wait",
        turnId: "turn-wait",
        itemId: null,
        emittedAt: new Date(1_000).toISOString(),
        type: "turn.started",
        payload: { prompt: "Inspect" },
      },
      {
        schemaVersion: 1,
        sequence: 2,
        sessionId: "session-wait",
        provider: "codex",
        providerSessionId: "native-wait",
        turnId: "turn-wait",
        itemId: "approval-wait",
        emittedAt: new Date(4_000).toISOString(),
        type: "approval.requested",
        payload: { requestId: "approval-wait", kind: "command", title: "Run" },
      },
      {
        schemaVersion: 1,
        sequence: 3,
        sessionId: "session-wait",
        provider: "codex",
        providerSessionId: "native-wait",
        turnId: "turn-wait",
        itemId: "approval-wait",
        emittedAt: new Date(9_000).toISOString(),
        type: "approval.resolved",
        payload: { requestId: "approval-wait", decision: "accept" },
      },
    ]);

    expect(projection.turns[0]).toMatchObject({
      userWaitStartedAtMs: null,
      userWaitDurationMs: 5_000,
    });
    expect(agentRunActiveElapsedMs(projection.turns[0] ?? null, 12_000)).toBe(6_000);
  });

  it("keeps an official non-transcript working pulse visible around native tool activity", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      {
        schemaVersion: 1,
        sequence: 1,
        sessionId: "session-working",
        provider: "claude",
        providerSessionId: "native-working",
        turnId: "turn-working",
        itemId: null,
        emittedAt: new Date(1_000).toISOString(),
        type: "turn.started",
        payload: { prompt: "List files" },
      },
      {
        schemaVersion: 1,
        sequence: 2,
        sessionId: "session-working",
        provider: "claude",
        providerSessionId: "native-working",
        turnId: "turn-working",
        itemId: "tool-list",
        emittedAt: new Date(2_000).toISOString(),
        type: "tool.started",
        payload: { kind: "command", tool: "list", label: "List", status: "running" },
      },
    ]);

    expect(agentRunStatusCode(projection, true)).toBe("working");
    const container = render(React.createElement(AgentTranscript, {
      projection,
      loading: false,
      working: true,
      runtimeLabel: "Claude Agent",
    }));
    const indicator = container.querySelector(".desktop-agent-working-indicator");
    expect(indicator?.textContent).toContain("Working");
    expect(indicator?.textContent).not.toContain("Working through the request");
    expect(indicator?.querySelector("[data-puppy-loader='dots']")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-spin")).toBeNull();
  });

  it("renders only the current connection state and removes its animation after recovery", () => {
    const reconnecting = createAgentProjection();
    reconnecting.connectionStatus = {
      state: "reconnecting",
      message: "Reconnecting… 4/5",
      attempt: 4,
      maxAttempts: 5,
      turnId: "turn-live",
      sequence: 4,
    };
    const container = render(React.createElement(AgentTranscript, {
      projection: reconnecting,
      loading: false,
      working: true,
      runtimeLabel: "Codex",
    }));

    expect(container.querySelectorAll(".desktop-agent-connection-status")).toHaveLength(1);
    expect(container.querySelector(".desktop-agent-connection-status")?.textContent).toBe("Reconnecting… 4/5");
    expect(container.querySelector(".desktop-agent-connection-status .desktop-agent-spin")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-working-indicator")).toBeNull();
    expect(container.querySelector(".desktop-agent-notice")).toBeNull();

    const fallback = createAgentProjection();
    fallback.connectionStatus = {
      state: "fallback",
      message: "Switching connection transport.",
      attempt: null,
      maxAttempts: null,
      turnId: "turn-live",
      sequence: 5,
    };
    act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, {
      projection: fallback,
      loading: false,
      working: true,
      runtimeLabel: "Codex",
    }))));
    expect(container.querySelectorAll(".desktop-agent-connection-status")).toHaveLength(1);
    expect(container.querySelector(".desktop-agent-connection-status .desktop-agent-spin")).toBeNull();

    act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, {
      projection: createAgentProjection(),
      loading: false,
      working: false,
      runtimeLabel: "Codex",
    }))));
    expect(container.querySelector(".desktop-agent-connection-status")).toBeNull();
  });
});
