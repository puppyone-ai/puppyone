/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentApprovalDock } from "../src/features/desktop-agent/ui/AgentApprovalDock";
import { AgentChangesControl, summarizeAgentChanges } from "../src/features/desktop-agent/ui/AgentChangesControl";
import { AgentComposer } from "../src/features/desktop-agent/ui/AgentComposer";
import { AgentEmptyState } from "../src/features/desktop-agent/ui/AgentEmptyState";
import { AgentPanelLayout } from "../src/features/desktop-agent/ui/AgentPanelLayout";
import { AgentPanelStatus } from "../src/features/desktop-agent/ui/AgentPanelStatus";
import { AgentPickerPopover } from "../src/features/desktop-agent/ui/AgentPickerPopover";
import { AgentRuntimePicker } from "../src/features/desktop-agent/ui/AgentRuntimePicker";
import { AgentSurfaceHeader } from "../src/features/desktop-agent/ui/AgentSurfaceHeader";
import { agentPickerLimits } from "../src/features/desktop-agent/ui/agent-picker-limits";
import {
  AgentTranscript,
  agentRunStatusCode,
  agentSubmissionStatusLabel,
  shouldShowAgentThinking,
} from "../src/features/desktop-agent/ui/AgentTranscript";
import { agentRunActiveElapsedMs } from "../src/features/desktop-agent/ui/useAgentRunActiveElapsed";
import { registerAgentToolRenderer } from "../src/features/desktop-agent/ui/AgentToolRendererRegistry";
import { registerAgentPartRenderer } from "../src/features/desktop-agent/ui/AgentPartRenderer";
import { agentToolEvidenceLimits } from "../src/features/desktop-agent/domain/agent-tool-evidence";
import { resolveAnchoredOverlayPosition } from "../src/features/app-shell/useAnchoredOverlayPosition";
import { applyAgentEvents, createAgentProjection } from "../src/features/desktop-agent/agentProjection";
import {
  listAgentRuntimes,
  listEnabledAgentRuntimes,
  listVisibleAgentRuntimes,
} from "../src/features/desktop-agent/domain/agent-backend-routing";
import type { AgentRuntimeReadiness } from "../src/features/desktop-agent/agentTypes";
import { stripBidiIsolation, testT, withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.head.querySelectorAll("style[data-agent-layout-test]").forEach((node) => node.remove());
});

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(node)));
  return container;
}

function runtimeEntry(id: string, displayName: string) {
  return {
    descriptor: { id, displayName, iconKey: id, distribution: "user-installed" },
    readiness: {
      runtimeId: id,
      provider: id,
      status: "ready" as const,
      code: "READY" as const,
      version: "1.0.0",
      minimumVersion: null,
      message: "Ready",
      selectable: true,
    },
  };
}

function modelSessionControl(models: Array<{ model: string; displayName: string; description?: string }>, value: string | null) {
  return [{
    id: "model" as const,
    value,
    options: models.map((model) => ({
      value: model.model,
      label: model.displayName,
      description: model.description,
    })),
  }];
}

describe("Desktop Agent renderer surfaces", () => {
  it.each([
    [
      "explicit sign-out",
      { status: "installed-not-authenticated" as const, code: "AUTHENTICATION_REQUIRED" as const },
      "Sign in to Cursor Agent",
    ],
    [
      "status probe failure",
      { status: "error" as const, code: "AUTHENTICATION_PROBE_CRASHED" as const },
      "Cursor Agent sign-in check crashed",
    ],
  ])("renders %s from the structured readiness code", (_label, reason, heading) => {
    const container = render(React.createElement(AgentPanelStatus, {
      unavailable: true,
      failed: false,
      error: null,
      runtimeLabel: "Cursor Agent",
      readiness: {
        runtimeId: "cursor",
        provider: "cursor",
        ...reason,
        version: "2026.08.1",
        minimumVersion: null,
        message: "Structured backend detail.",
      },
      onRetry: vi.fn(),
    }));

    const text = stripBidiIsolation(container.textContent);
    expect(text).toContain(heading);
    expect(text).toContain(`Status code: ${reason.code}`);
    if (reason.code === "AUTHENTICATION_PROBE_CRASHED") expect(text).not.toContain("Sign in to Cursor Agent");
  });

  it("keeps the transcript generic when no product empty-state slot is supplied", () => {
    const container = render(React.createElement(AgentTranscript, {
      projection: createAgentProjection(),
      loading: false,
      runtimeLabel: "Codex",
    }));

    expect(container.textContent).toBe("");
    expect(container.querySelector(".desktop-agent-empty")).toBeNull();
  });

  it("renders the quiet runtime identity only for a ready empty conversation", () => {
    const emptyState = React.createElement(AgentEmptyState, {
      runtimeIconKey: "codex",
      runtimeLabel: "Codex",
    });
    const container = render(React.createElement(AgentTranscript, {
      projection: createAgentProjection(),
      loading: false,
      runtimeLabel: "Codex",
      emptyState,
    }));

    expect(container.textContent).toContain(testT("agent.empty.prompt"));
    expect(container.querySelector(".desktop-agent-empty-state .desktop-agent-brand-mark.is-codex.is-monochrome")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-empty-state .po-agent-monochrome-brand-image")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-empty-state .po-agent-brand-image")).toBeNull();

    const logoButton = container.querySelector<HTMLButtonElement>(".desktop-agent-empty-logo-button");
    expect(stripBidiIsolation(logoButton?.getAttribute("aria-label"))).toBe("Spin the Codex logo");
    expect(logoButton?.style.getPropertyValue("--agent-empty-logo-turns")).toBe("0");
    act(() => {
      logoButton?.click();
      logoButton?.click();
      logoButton?.click();
    });
    expect(logoButton?.style.getPropertyValue("--agent-empty-logo-turns")).toBe("3");
  });

  it("uses Pi's theme-colored normalized vector in the empty conversation", () => {
    const container = render(React.createElement(AgentTranscript, {
      projection: createAgentProjection(),
      loading: false,
      runtimeLabel: "Pi Agent",
      emptyState: React.createElement(AgentEmptyState, {
        runtimeIconKey: "pi",
        runtimeLabel: "Pi Agent",
      }),
    }));

    const brandMark = container.querySelector(
      ".desktop-agent-empty-state .desktop-agent-brand-mark.is-pi.is-monochrome",
    );
    expect(brandMark?.querySelector('.po-agent-monochrome-brand-image[fill="currentColor"]')).not.toBeNull();
    expect(brandMark?.querySelector(".po-agent-brand-image")).toBeNull();
  });

  it("removes the empty-state cue as soon as a prompt enters the live tail", () => {
    const container = render(React.createElement(AgentTranscript, {
      projection: createAgentProjection(),
      loading: false,
      pendingPrompt: "Start here",
      runtimeLabel: "Codex",
      emptyState: React.createElement(AgentEmptyState, {
        runtimeIconKey: "codex",
        runtimeLabel: "Codex",
      }),
    }));

    expect(container.querySelector(".desktop-agent-empty-state")).toBeNull();
    expect(container.textContent).toContain("Start here");
  });

  it("renders the structural regions and applies the real layout CSS contract", () => {
    const style = document.createElement("style");
    style.dataset.agentLayoutTest = "true";
    style.textContent = [
      readFileSync(`${process.cwd()}/packages/shared-ui/src/styles/control-geometry.css`, "utf8"),
      readFileSync(`${process.cwd()}/src/styles/tokens.css`, "utf8"),
      ...["theme.css", "foundation.css", "composer.css", "pickers.css"]
        .map((file) => readFileSync(`${process.cwd()}/src/features/desktop-agent/ui/styles/${file}`, "utf8")),
    ].join("\n");
    document.head.appendChild(style);

    const container = render(React.createElement(AgentPanelLayout, {
      ariaLabel: "Layout contract",
      header: React.createElement(AgentSurfaceHeader, {
        title: "New chat",
        runtimeLabel: "Codex",
        statusCode: "ready",
        statusLabel: "ready",
        loading: false,
        newSessionDisabled: false,
        onNewSession: vi.fn(),
        agentSelector: React.createElement(AgentRuntimePicker, {
          agentRuntimes: [runtimeEntry("codex", "Codex")],
          selectedRuntimeId: "codex",
          onSelectRuntime: vi.fn(),
        }),
      }),
      status: React.createElement("span", null, "Status"),
      conversation: React.createElement("span", null, "Conversation"),
      conversationOverlay: React.createElement("span", null, "Stable empty state"),
      dock: React.createElement(AgentComposer, {
        draft: "Ready",
        onDraftChange: vi.fn(),
        disabled: false,
        running: false,
        stopping: false,
        submitting: false,
        placeholder: "Ask anything",
        sessionControls: modelSessionControl([{ model: "gpt-5", displayName: "GPT-5" }], "gpt-5"),
        onSubmit: vi.fn(async () => true),
        onStop: vi.fn(),
      }),
    }));
    const boundary = container.querySelector(".desktop-agent-boundary") as HTMLElement;
    const panel = container.querySelector(".desktop-agent-panel") as HTMLElement;
    const conversationOverlay = container.querySelector(".desktop-agent-conversation-overlay") as HTMLElement;
    const dock = container.querySelector(".desktop-agent-dock-region") as HTMLElement;

    expect(style.sheet?.cssRules.length).toBeGreaterThan(0);
    expect(boundary.children).toHaveLength(1);
    expect(panel.children).toHaveLength(5);
    expect(window.getComputedStyle(panel).display).toBe("grid");
    expect(conversationOverlay.parentElement).toBe(panel);
    expect(conversationOverlay.classList.contains("has-dock")).toBe(true);
    expect(window.getComputedStyle(conversationOverlay).gridRow).toBe("3 / 5");
    expect(window.getComputedStyle(dock).paddingTop).toBe("12px");
    expect(window.getComputedStyle(dock).paddingRight).toBe("12px");
    expect(window.getComputedStyle(dock).paddingBottom).toBe("12px");
    expect(window.getComputedStyle(dock).paddingLeft).toBe("12px");
    const providerControl = container.querySelector('button[aria-label="Coding Agent"]') as HTMLElement;
    const modelControl = container.querySelector('button[aria-label="Agent model"]') as HTMLElement;
    const sendControl = container.querySelector('button[aria-label="Send message"]') as HTMLElement;
    const composerSurface = container.querySelector(".desktop-agent-composer") as HTMLElement;
    const promptEditor = container.querySelector(".cm-content") as HTMLElement;
    expect(window.getComputedStyle(providerControl).height).toBe("calc(32px - 6px)");
    expect(window.getComputedStyle(sendControl).width).toBe("32px");
    expect(window.getComputedStyle(sendControl).height).toBe("32px");
    expect(window.getComputedStyle(modelControl).height).toBe("32px");
    expect(window.getComputedStyle(composerSurface).cursor).not.toBe("text");
    expect(window.getComputedStyle(promptEditor).cursor).toBe("text");
  });

  it("leaves pointer selection to CodeMirror without stealing button focus", () => {
    const onDraftChange = vi.fn();
    const container = render(React.createElement(AgentComposer, {
      draft: "Ready",
      onDraftChange,
      disabled: false,
      running: false,
      stopping: false,
      submitting: false,
      placeholder: "Ask anything",
      onSubmit: vi.fn(async () => true),
      onStop: vi.fn(),
    }));
    const composerSurface = container.querySelector(".desktop-agent-composer") as HTMLElement;
    const promptEditor = container.querySelector(".cm-content") as HTMLElement;
    const sendControl = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement;

    act(() => promptEditor.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 1,
      clientY: 1,
    })));
    expect(document.activeElement).toBe(promptEditor);

    act(() => promptEditor.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "End",
      code: "End",
    })));
    act(() => promptEditor.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Backspace",
      code: "Backspace",
    })));
    expect(onDraftChange).toHaveBeenLastCalledWith("Read");

    act(() => sendControl.focus());
    act(() => composerSurface.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })));
    expect(document.activeElement).toBe(sendControl);

    act(() => sendControl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })));
    expect(document.activeElement).toBe(sendControl);
  });

  it("removes the Agent header region when Minimal Mode supplies no header", () => {
    const container = render(React.createElement(AgentPanelLayout, {
      ariaLabel: "Minimal Agent layout",
      header: null,
      conversation: React.createElement("span", null, "Conversation"),
    }));

    expect(container.querySelector(".desktop-agent-header-region")).toBeNull();
    expect(container.querySelector(".desktop-agent-conversation-region")).not.toBeNull();
  });

  it("keeps anchored overlays inside the Agent boundary and prefers the available side", () => {
    const position = resolveAnchoredOverlayPosition({
      anchor: { top: 700, right: 430, bottom: 730, left: 400, width: 30, height: 30 },
      boundary: { top: 0, right: 469, bottom: 800, left: 50, width: 419, height: 800 },
      viewportWidth: 1000,
      viewportHeight: 800,
      overlayHeight: 360,
    });

    expect(position.placement).toBe("above");
    expect(position.width).toBe(320);
    expect(position.left).toBe(137);
    expect(position.left + position.width).toBeLessThanOrEqual(457);
    expect(position.top).toBeGreaterThanOrEqual(12);
  });

  it("locks Composer pickers above the trigger even when the lower side has more room", () => {
    const position = resolveAnchoredOverlayPosition({
      anchor: { top: 250, right: 430, bottom: 280, left: 400, width: 30, height: 30 },
      boundary: { top: 0, right: 469, bottom: 800, left: 50, width: 419, height: 800 },
      viewportWidth: 1000,
      viewportHeight: 800,
      overlayHeight: 180,
      placementPreference: "above",
    });

    expect(position.placement).toBe("above");
    expect(position.top).toBe(62);
    expect(position.top + 180).toBeLessThanOrEqual(250 - 8);
  });

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
      projection,
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

  it("leaves composer auto-sizing to CSS while controlled draft text changes", () => {
    const OriginalResizeObserver = globalThis.ResizeObserver;
    let constructions = 0;
    class StableResizeObserver {
      constructor(_callback: ResizeObserverCallback) { constructions += 1; }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = StableResizeObserver as unknown as typeof ResizeObserver;
    const props = {
      onDraftChange: vi.fn(),
      disabled: false,
      running: false,
      stopping: false,
      submitting: false,
      placeholder: "Ask anything",
      onSubmit: vi.fn(async () => true),
      onStop: vi.fn(),
    };
    try {
      const container = render(React.createElement(AgentComposer, { ...props, draft: "a" }));
      act(() => root?.render(withTestLocalization(React.createElement(AgentComposer, { ...props, draft: "ab" }))));
      act(() => root?.render(withTestLocalization(React.createElement(AgentComposer, { ...props, draft: "abc" }))));
      expect(constructions).toBe(1);
      expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });

  it("keeps a useful placeholder when the caller supplies blank copy", () => {
    const container = render(React.createElement(AgentComposer, {
      draft: "",
      onDraftChange: vi.fn(),
      disabled: false,
      running: false,
      stopping: false,
      submitting: false,
      placeholder: "   ",
      onSubmit: vi.fn(async () => true),
      onStop: vi.fn(),
    }));

    expect(container.querySelector(".cm-content")?.getAttribute("aria-placeholder")).toBe("Ask about this project");
    const sendButton = container.querySelector(
      'button[aria-label="Send message"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).not.toBeNull();
    expect(sendButton?.disabled).toBe(true);
  });

  it("morphs the single send action into stop while a turn is running", () => {
    const onStop = vi.fn();
    const props = {
      draft: "Follow up",
      onDraftChange: vi.fn(),
      disabled: false,
      running: true,
      stopping: false,
      submitting: false,
      runtimeLabel: "Codex",
      steerAvailable: true,
      queueAvailable: true,
      onSubmit: vi.fn(async () => true),
      onStop,
    };
    const container = render(React.createElement(AgentComposer, props));

    const actions = container.querySelectorAll(".desktop-agent-composer-action");
    expect(actions).toHaveLength(1);
    const stopAction = actions[0] as HTMLButtonElement;
    expect(stopAction.classList.contains("is-stop")).toBe(true);
    expect(stripBidiIsolation(stopAction.getAttribute("aria-label"))).toBe(testT("agent.composer.stop", { agent: "Codex" }));
    expect(container.querySelector(`button[aria-label="${testT("agent.composer.send")}"]`)).toBeNull();

    act(() => stopAction.click());
    expect(onStop).toHaveBeenCalledTimes(1);

    act(() => root?.render(withTestLocalization(React.createElement(AgentComposer, { ...props, stopping: true }))));
    const stoppingAction = container.querySelector(".desktop-agent-composer-action") as HTMLButtonElement;
    expect(stoppingAction.getAttribute("aria-busy")).toBe("true");
    expect(stoppingAction.disabled).toBe(true);
  });

  it("hides the configured Model in Minimal Mode without removing the composer", () => {
    const container = render(React.createElement(AgentComposer, {
      draft: "Continue",
      onDraftChange: vi.fn(),
      disabled: false,
      hideConfiguration: true,
      running: false,
      stopping: false,
      submitting: false,
      placeholder: "Ask anything",
      sessionControls: modelSessionControl([{ model: "gpt-5", displayName: "GPT-5" }], "gpt-5"),
      onSubmit: vi.fn(async () => true),
      onStop: vi.fn(),
    }));

    expect(container.querySelector('button[aria-label="Agent model"]')).toBeNull();
    expect(stripBidiIsolation(container.querySelector(".cm-content")?.getAttribute("aria-label"))).toBe("Message Agent");
    expect(container.querySelector('button[aria-label="Send message"]')).not.toBeNull();
  });

  it("keeps the session-level Agent in the header and only Model in the composer", () => {
    const runtimePicker = React.createElement(AgentRuntimePicker, {
      agentRuntimes: [runtimeEntry("codex", "Codex")],
      selectedRuntimeId: "codex",
      onSelectRuntime: vi.fn(),
    });
    const container = render(React.createElement("div", null,
      React.createElement(AgentSurfaceHeader, {
        title: "New chat",
        runtimeLabel: "Codex",
        statusCode: "ready",
        statusLabel: "ready",
        loading: false,
        newSessionDisabled: false,
        onNewSession: vi.fn(),
        agentSelector: runtimePicker,
      }),
      React.createElement(AgentComposer, {
        draft: "",
        onDraftChange: vi.fn(),
        disabled: false,
        running: false,
        stopping: false,
        submitting: false,
        placeholder: "Ask anything",
        sessionControls: modelSessionControl([{ model: "gpt-5", displayName: "GPT-5" }], "gpt-5"),
        onSubmit: vi.fn(async () => true),
        onStop: vi.fn(),
      }),
    ));

    expect(container.querySelector("select")).toBeNull();
    const runtimeTrigger = container.querySelector('button[aria-label="Coding Agent"]') as HTMLButtonElement;
    const composer = container.querySelector(".desktop-agent-composer") as HTMLElement;
    expect(container.querySelector('button[aria-label="Agent backend"]')).toBeNull();
    expect(runtimeTrigger.classList.contains("is-compact")).toBe(false);
    expect(runtimeTrigger.title).toContain("Switching Agent starts a new chat");
    expect(runtimeTrigger.querySelector(".desktop-agent-brand-mark")).not.toBeNull();
    expect(runtimeTrigger.textContent).toContain("Codex");
    expect(composer.querySelector('button[aria-label="Coding Agent"]')).toBeNull();
    expect(container.textContent).not.toContain("Google");
    expect(container.querySelector('button[aria-label="Agent model"]')?.textContent).toContain("GPT");
    expect(container.textContent).not.toContain("OpenCode runtime");
    expect(container.querySelector(".cm-content")?.getAttribute("aria-multiline")).toBe("true");
    expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(container.querySelector(".desktop-agent-composer-row")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-composer-input-row button[aria-label='Send message']")).toBeNull();
    expect(container.querySelector(".desktop-agent-composer-trailing button[aria-label='Send message']")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-composer-trailing button[aria-label='Agent model']")).not.toBeNull();
    expect(container.querySelector('button[aria-label="Add context or change Agent mode"]')).toBeNull();
  });

  it("preserves registry-provided Agent products without provider-specific UI filtering", () => {
    const providers = listAgentRuntimes({
      runtimes: [
        {
          descriptor: { id: "custom-agent", displayName: "Custom Agent", distribution: "bundled" },
          readiness: { runtimeId: "custom-agent", provider: "custom-agent", status: "ready", version: "1.0.0", minimumVersion: null, message: "Ready" },
        },
        runtimeEntry("codex", "Codex"),
        runtimeEntry("claude", "Claude Agent"),
        runtimeEntry("opencode-native", "OpenCode"),
        runtimeEntry("cursor", "Cursor Agent"),
      ],
      selectedRuntimeId: "custom-agent",
      runtime: { id: "custom-agent", displayName: "Custom Agent", distribution: "bundled" },
      readiness: { runtimeId: "custom-agent", provider: "custom-agent", status: "ready", version: "1.0.0", minimumVersion: null, message: "Ready" },
      account: null,
      models: [],
      capabilities: null,
      warnings: [],
    });

    expect(providers.map((entry) => entry.descriptor.displayName)).toEqual([
      "Custom Agent",
      "Codex",
      "Claude Agent",
      "OpenCode",
      "Cursor Agent",
    ]);
  });

  it("shows only locally selected and still-installed Coding Agents", () => {
    const inspection = {
      runtimes: [
        runtimeEntry("codex", "Codex"),
        runtimeEntry("claude", "Claude Agent"),
        runtimeEntry("opencode-native", "OpenCode"),
        {
          ...runtimeEntry("cursor", "Cursor Agent"),
          readiness: {
            ...runtimeEntry("cursor", "Cursor Agent").readiness,
            status: "not-installed" as const,
          },
        },
      ],
      readiness: runtimeEntry("codex", "Codex").readiness,
      account: null,
      models: [],
      capabilities: null,
      warnings: [],
    };

    expect(listEnabledAgentRuntimes(inspection, ["claude", "opencode-native", "cursor"])
      .map((entry) => entry.descriptor.id)).toEqual(["claude", "opencode-native"]);
    expect(listVisibleAgentRuntimes(inspection, ["claude"])
      .map((entry) => entry.descriptor.id)).toEqual(["codex", "opencode-native"]);
  });

  it("shows Agent in the header and withholds Model until a connected runtime is selected", () => {
    const container = render(React.createElement("div", null,
      React.createElement(AgentSurfaceHeader, {
        title: "New chat",
        statusCode: "checking",
        statusLabel: "checking",
        loading: false,
        newSessionDisabled: true,
        onNewSession: vi.fn(),
        agentSelector: React.createElement(AgentRuntimePicker, {
          agentRuntimes: [runtimeEntry("codex", "Codex"), runtimeEntry("claude", "Claude Agent")],
          selectedRuntimeId: null,
          onSelectRuntime: vi.fn(),
        }),
      }),
      React.createElement(AgentComposer, {
        draft: "Hello",
        onDraftChange: vi.fn(),
        disabled: true,
        running: false,
        stopping: false,
        submitting: false,
        placeholder: "Choose a provider to start",
        sessionControls: [],
        onSubmit: vi.fn(async () => false),
        onStop: vi.fn(),
      }),
    ));

    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('button[aria-label="Coding Agent"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Agent model"]')).toBeNull();
    expect(container.textContent).not.toContain("Agent model");
    expect((container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("updates the visible Agent and Model labels after pointer selection", () => {
    const catalogs = {
      codex: [
        { id: "gpt-5", model: "gpt-5", displayName: "GPT-5", description: "Native Codex model", isDefault: true },
      ],
      claude: [
        { id: "claude-sonnet", model: "claude-sonnet", displayName: "Claude Sonnet", description: "Native Claude Agent model", isDefault: true },
        { id: "claude-opus", model: "claude-opus", displayName: "Claude Opus", description: "Native Claude Agent model", isDefault: false },
      ],
    };

    function StatefulSurface() {
      const [runtime, setRuntime] = React.useState<keyof typeof catalogs>("codex");
      const [model, setModel] = React.useState(catalogs.codex[0].model);
      const models = catalogs[runtime];
      const onSelectRuntime = (nextRuntime: string) => {
          const typedRuntime = nextRuntime as keyof typeof catalogs;
          setRuntime(typedRuntime);
          setModel(catalogs[typedRuntime][0].model);
      };
      return React.createElement("div", null,
        React.createElement(AgentSurfaceHeader, {
          title: "New chat",
          runtimeLabel: runtime,
          statusCode: "ready",
          statusLabel: "ready",
          loading: false,
          newSessionDisabled: false,
          onNewSession: vi.fn(),
          agentSelector: React.createElement(AgentRuntimePicker, {
            agentRuntimes: [runtimeEntry("codex", "Codex"), runtimeEntry("claude", "Claude Agent")],
            selectedRuntimeId: runtime,
            onSelectRuntime,
          }),
        }),
        React.createElement(AgentComposer, {
          draft: "",
          onDraftChange: vi.fn(),
          disabled: false,
          running: false,
          stopping: false,
          submitting: false,
          placeholder: "Ask anything",
          sessionControls: modelSessionControl(models, model),
          onSelectSessionControl: (id, value) => {
            if (id === "model") setModel(value);
          },
          onSubmit: vi.fn(async () => true),
          onStop: vi.fn(),
        }),
      );
    }

    const container = render(React.createElement(StatefulSurface));
    const runtimeTrigger = container.querySelector('button[aria-label="Coding Agent"]') as HTMLButtonElement;
    expect(runtimeTrigger.textContent).toContain("Codex");
    act(() => runtimeTrigger.click());
    const claude = Array.from(document.querySelectorAll('[role="option"]'))
      .find((option) => option.textContent?.includes("Claude Agent")) as HTMLButtonElement;
    act(() => claude.click());
    expect(runtimeTrigger.textContent).toContain("Claude Agent");

    const modelTrigger = container.querySelector('button[aria-label="Agent model"]') as HTMLButtonElement;
    expect(modelTrigger.textContent).toContain("Claude Sonnet");
    expect(modelTrigger.querySelector("svg")).toBeNull();
    act(() => modelTrigger.click());
    const opus = Array.from(document.querySelectorAll('[role="option"]'))
      .find((option) => option.textContent?.includes("Claude Opus")) as HTMLButtonElement;
    act(() => opus.click());
    expect(modelTrigger.textContent).toContain("Claude Opus");
  });

  it("keeps a large model catalog searchable while bounding mounted picker options", () => {
    const options = Array.from({ length: 500 }, (_, index) => ({
      id: `provider/model-${index}`,
      label: `Model ${index}`,
      description: `Connected model ${index}`,
      selectable: true,
      kind: "model" as const,
    }));
    const container = render(React.createElement(AgentPickerPopover, {
      ariaLabel: "Agent model",
      placeholder: "Choose model",
      groups: [{ id: "models", label: "Models", options }],
      onSelect: vi.fn(),
    }));
    act(() => (container.querySelector('[aria-label="Agent model"]') as HTMLButtonElement).click());
    const overlay = document.querySelector(".desktop-agent-picker-popover") as HTMLElement;
    expect(overlay.closest("#desktop-overlay-root")).not.toBeNull();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(overlay.querySelectorAll('[role="option"]')).toHaveLength(agentPickerLimits.maxRenderedOptions);
    expect(overlay.textContent).toContain("Showing 120 of 500");

    const input = overlay.querySelector<HTMLInputElement>('.desktop-agent-picker-search input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Model 499");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Model 499" }));
    });
    expect(overlay.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(overlay.textContent).toContain("Model 499");
  });

  it("renders one flat coding-Agent menu and keeps detected runtimes selectable with one warning", () => {
    const onSelectRuntime = vi.fn();
    const container = render(React.createElement(AgentRuntimePicker, {
      agentRuntimes: [
        {
          descriptor: { id: "codex", displayName: "Codex", iconKey: "codex", distribution: "user-installed" },
          readiness: { runtimeId: "codex", provider: "codex", status: "ready", version: "0.144.1", minimumVersion: null, message: "Native login ready", selectable: true },
        },
        {
          descriptor: { id: "cursor", displayName: "Cursor Agent", iconKey: "cursor", distribution: "user-installed" },
          readiness: { runtimeId: "cursor", provider: "cursor", status: "protocol-unavailable", version: "1.0.0", minimumVersion: null, message: "Native protocol unavailable", selectable: false },
        },
      ],
      selectedRuntimeId: null,
      onSelectRuntime: onSelectRuntime,
    }));

    const trigger = container.querySelector('button[aria-label="Coding Agent"]') as HTMLButtonElement;
    act(() => trigger.click());
    const popup = document.querySelector(".desktop-agent-picker-list[role='listbox']") as HTMLElement;
    expect(popup).not.toBeNull();
    expect((popup.closest(".desktop-agent-picker-popover") as HTMLElement).dataset.positioned).toBe("true");
    expect(popup.textContent).not.toContain("Coding Agents");
    expect(popup.textContent).not.toContain("Detected");
    expect(popup.textContent).not.toContain("Refresh");
    expect(popup.querySelectorAll('[role="group"]')).toHaveLength(0);
    const cursor = Array.from(popup.querySelectorAll('[role="option"]')).find((option) => option.textContent?.includes("Cursor Agent")) as HTMLButtonElement;
    expect(cursor.getAttribute("aria-disabled")).toBeNull();
    expect(cursor.querySelector(".desktop-agent-picker-warning")).not.toBeNull();
    expect(cursor.querySelector(".desktop-agent-picker-warning")?.getAttribute("title")).toContain("Native protocol unavailable");
    expect(popup.textContent).not.toContain("Native protocol unavailable");
    act(() => cursor.click());
    expect(onSelectRuntime).toHaveBeenCalledWith("cursor");
    expect(document.querySelector('[role="listbox"][aria-label="Coding Agent options"]')).toBeNull();
  });

  it("supports Arrow, Enter and Escape with focus return in the custom Agent picker", async () => {
    const onSelectRuntime = vi.fn();
    const container = render(React.createElement(AgentRuntimePicker, {
      agentRuntimes: [
        runtimeEntry("codex", "Codex"),
        runtimeEntry("claude", "Claude Agent"),
      ],
      selectedRuntimeId: null,
      onSelectRuntime,
    }));
    const trigger = container.querySelector('button[aria-label="Coding Agent"]') as HTMLButtonElement;
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect((document.activeElement as HTMLElement).textContent).toContain("Codex");
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect((document.activeElement as HTMLElement).textContent).toContain("Claude Agent");
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(onSelectRuntime).toHaveBeenCalledWith("claude");
    expect(document.activeElement).toBe(trigger);

    act(() => trigger.click());
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(document.querySelector('[role="listbox"][aria-label="Coding Agent options"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("summarizes real file changes in the compact Changes control", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "change-1",
      turnId: "turn-1",
      itemId: "tool-1",
      kind: "file-change",
      label: "Edited files",
      status: "completed",
      output: "",
      detail: {
        changes: [
          { path: "src/a.ts", additions: 86, deletions: 12 },
          { path: "src/b.ts", additions: 4, deletions: 1 },
        ],
      },
      sequence: 1,
    });
    expect(summarizeAgentChanges(projection)).toEqual({ additions: 90, deletions: 13, files: 2 });
    const onViewChanges = vi.fn();
    const container = render(React.createElement(AgentChangesControl, { projection, onViewChanges }));
    const button = container.querySelector(".desktop-agent-changes-control") as HTMLButtonElement;
    expect(button.textContent).toBe("+90-13");
    act(() => button.click());
    expect(onViewChanges).toHaveBeenCalledTimes(1);
  });

  it("renders Bash activity as a compact product row with a bounded expandable transcript", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "command-1",
      turnId: "turn-1",
      itemId: "tool-1",
      kind: "command",
      label: "Run tests",
      status: "completed",
      output: "25 files passed",
      detail: {
        tool: "bash",
        input: { command: "npm test" },
        metadata: { exitCode: 0, duration: 842 },
      },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    const row = container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement;
    expect(row.textContent).toContain("Bash");
    expect(row.textContent).not.toContain("npm test");
    expect(row.querySelector(".desktop-agent-tool-chevron")).toBeNull();
    expect(row.querySelector(".desktop-agent-tool-summary")).toBeNull();
    expect(row.getAttribute("aria-expanded")).toBe("false");
    act(() => row.click());
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(row.querySelector(".desktop-agent-tool-chevron")).toBeNull();
    expect(row.querySelector(".desktop-agent-tool-summary")).toBeNull();
    expect(row.textContent).not.toContain("npm test");
    const evidence = Array.from(container.querySelectorAll(".desktop-agent-evidence-node"));
    expect(evidence).toHaveLength(2);
    expect(evidence.map((node) => node.getAttribute("data-evidence-kind"))).toEqual(["command", "result"]);
    expect(evidence[0].querySelector(".desktop-agent-evidence-marker")?.textContent).toBe("$");
    expect(container.querySelector(".desktop-agent-command-line")?.textContent).toBe("npm test");
    expect(container.querySelector(".desktop-agent-command-output")?.textContent).toContain("25 files passed");
    expect(row.textContent).not.toContain("Exit 0");
    expect(row.textContent).not.toMatch(/\d+\s*ms/u);
    expect(container.querySelector(".desktop-agent-command-meta")).toBeNull();
    expect(container.querySelector('button[aria-label="Open command in terminal"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="Copy"]')).toBeNull();
  });

  it("presents conservative read-only shell commands semantically without collapsed provenance noise", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "command-search",
      turnId: "turn-1",
      itemId: "tool-search",
      kind: "command",
      label: "Search repository",
      status: "completed",
      output: "src/App.tsx:12:liangyu",
      detail: {
        tool: "bash",
        command: "/bin/zsh -lc \"rg -n -i liangyu src\"",
        exitCode: 0,
      },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    const row = container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement;
    expect(row.textContent).toContain("Grep");
    expect(row.textContent).not.toContain("rg -n -i liangyu src");
    expect(row.textContent).not.toContain("via Bash");
    expect(row.textContent).not.toContain("Exit 0");
    act(() => row.click());
    expect(row.textContent).not.toContain("rg -n -i liangyu src");
    expect(container.querySelector(".desktop-agent-command-line")?.textContent).toContain("rg -n -i liangyu src");
    expect(container.querySelector(".desktop-agent-command.is-grep")).not.toBeNull();
  });

  it("renders native Grep as a dedicated bounded result disclosure", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "grep-1",
      turnId: "turn-1",
      itemId: "tool-grep",
      kind: "tool",
      label: "Find liangyu",
      status: "completed",
      output: "src/a.ts:3:liangyu\nsrc/b.ts:8:LIANGYU",
      detail: { tool: "grep", input: { pattern: "liangyu", path: "src" } },
      sequence: 1,
    });
    const onOpenFile = vi.fn();
    const container = render(React.createElement(AgentTranscript, { projection, loading: false, onOpenFile }));
    const row = container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement;
    expect(row.textContent).toContain("Grep");
    expect(row.textContent).not.toContain("liangyu");
    act(() => row.click());
    expect(row.textContent).not.toContain("liangyu");
    expect(container.querySelector(".desktop-agent-search-results")?.textContent).toContain("liangyu");
    expect(container.querySelectorAll(".desktop-agent-search-results > button")).toHaveLength(2);
    act(() => (container.querySelector(".desktop-agent-search-results > button") as HTMLButtonElement).click());
    expect(onOpenFile).toHaveBeenCalledWith("src/a.ts");
  });

  it("renders Write/Edit activity with file stats and inline diff lines without row action clutter", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "edit-1",
      turnId: "turn-1",
      itemId: "tool-2",
      kind: "file-change",
      label: "Updated app.ts",
      status: "completed",
      output: "",
      detail: {
        tool: "edit",
        path: "src/app.ts",
        changes: [{ path: "src/app.ts", additions: 2, deletions: 1 }],
        input: { patch: "@@ -1,2 +1,3 @@\n-old\n+new\n context" },
      },
      sequence: 1,
    });
    const onOpenFile = vi.fn();
    const container = render(React.createElement(AgentTranscript, { projection, loading: false, onOpenFile }));
    const row = container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement;
    expect(row.textContent).toContain("Edit");
    expect(row.textContent).not.toContain("src/app.ts");
    act(() => row.click());
    expect(row.textContent).not.toContain("src/app.ts");
    expect(container.querySelector(".desktop-agent-file-list")?.textContent).toContain("src/app.ts");
    expect(container.querySelectorAll(".desktop-agent-diff-line.is-addition")).toHaveLength(1);
    expect(container.querySelectorAll(".desktop-agent-diff-line.is-deletion")).toHaveLength(1);
    expect(container.textContent).toContain("+2");
    expect(container.querySelector('button[aria-label="Review file changes"]')).toBeNull();
    act(() => (container.querySelector('.desktop-agent-file-list button[title="src/app.ts"]') as HTMLButtonElement).click());
    expect(onOpenFile).toHaveBeenCalledWith("src/app.ts");
  });

  it("does not render a generic File Change row or Review action without a real change", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "empty-change",
      turnId: "turn-1",
      itemId: "session-diff",
      kind: "file-change",
      label: "File changes",
      status: "completed",
      output: "",
      detail: { changes: [] },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    expect(container.textContent).not.toContain("File Change");
    expect(container.querySelector('button[aria-label="Review file changes"]')).toBeNull();
  });

  it("keeps Read activity compact and reveals output without a redundant row action", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "read-1",
      turnId: "turn-1",
      itemId: "tool-read",
      kind: "tool",
      label: "Read composer",
      status: "completed",
      output: "export function AgentComposer() {}",
      detail: { tool: "read", input: { path: "src/features/desktop-agent/ui/AgentComposer.tsx" } },
      sequence: 1,
    });
    const onOpenFile = vi.fn();
    const container = render(React.createElement(AgentTranscript, { projection, loading: false, onOpenFile }));
    const row = container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement;
    expect(row.textContent).toContain("Read");
    act(() => row.click());
    expect(container.querySelector(".desktop-agent-evidence-tree")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-evidence-node")?.getAttribute("data-evidence-kind")).toBe("result");
    expect(container.querySelector(".desktop-agent-tool-output")?.textContent).toContain("export function AgentComposer");
    expect(container.querySelector('button[aria-label^="Open"]')).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("mounts a bounded tool preview instead of the complete provider output", () => {
    const projection = createAgentProjection();
    const output = Array.from({ length: 10_000 }, (_, index) => `line-${index}`).join("\n");
    projection.activities.push({
      id: "command-large",
      turnId: "turn-large",
      itemId: "tool-large",
      kind: "command",
      label: "Large output",
      status: "completed",
      output,
      detail: { tool: "bash", command: "generate-output" },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    act(() => (container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement).click());
    const visibleOutput = container.querySelector(".desktop-agent-command-output") as HTMLElement;
    const evidence = visibleOutput.closest(".desktop-agent-tool-text-evidence") as HTMLElement;
    const visible = visibleOutput.textContent ?? "";

    expect(evidence.dataset.truncated).toBe("true");
    expect(Number(evidence.dataset.sourceLength)).toBe(64 * 1024);
    expect(visible.length).toBeLessThan(agentToolEvidenceLimits.maxChars + 200);
    expect(visible).toContain("omitted");
  });

  it("mounts at most eighty searchable result elements", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "grep-large",
      turnId: "turn-large",
      itemId: "grep-large",
      kind: "tool",
      label: "Large search",
      status: "completed",
      output: Array.from({ length: 1_000 }, (_, index) => `src/file-${index}.ts:${index + 1}:match`).join("\n"),
      detail: { tool: "grep", input: { pattern: "match" } },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    act(() => (container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement).click());

    expect(container.querySelectorAll(".desktop-agent-search-results > span, .desktop-agent-search-results > button")).toHaveLength(80);
    expect(container.querySelector(".desktop-agent-search-results")?.textContent).toContain("more results");
  });

  it("isolates one crashing tool renderer and preserves following transcript rows", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dispose = registerAgentToolRenderer("fixture-crash", () => {
      throw new Error("fixture tool detail failed");
    });
    const projection = createAgentProjection();
    projection.activities.push({
      id: "broken-tool",
      turnId: "turn-1",
      itemId: "broken-tool",
      kind: "tool",
      label: "Broken tool",
      status: "completed",
      output: "ignored",
      detail: { tool: "fixture-crash" },
      sequence: 1,
    });
    projection.messages.push({
      id: "assistant-after-tool",
      role: "assistant",
      turnId: "turn-1",
      itemId: null,
      text: "The transcript survived.",
      streaming: false,
      terminalState: "completed",
      sequence: 2,
    });

    try {
      const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
      expect(container.querySelector(".desktop-agent-activity-render-fallback")).not.toBeNull();
      expect(container.textContent).toContain("The transcript survived.");
      expect(error).toHaveBeenCalled();
    } finally {
      dispose();
      error.mockRestore();
    }
  });

  it("registers semantic part extensions by kind and restores the previous renderer on dispose", () => {
    const projection = createAgentProjection();
    projection.parts = [{
      id: "future-part",
      turnId: "turn-1",
      itemId: "future-item",
      kind: "unknown",
      eventType: "future.semantic.part",
      label: "Future semantic part",
      sequence: 1,
    }];
    projection.rows = [{
      id: "row:future-part",
      partId: "future-part",
      turnId: "turn-1",
      kind: "unknown",
      sequence: 1,
      estimatedHeight: 36,
    }];
    const dispose = registerAgentPartRenderer("unknown", ({ part }) => React.createElement(
      "output",
      { "data-testid": "semantic-extension" },
      part.eventType,
    ));

    try {
      const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
      expect(container.querySelector("[data-testid='semantic-extension']")?.textContent).toBe("future.semantic.part");

      dispose();
      act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, {
        projection: { ...projection, parts: projection.parts.map((part) => ({ ...part })) },
        loading: false,
      }))));
      expect(container.querySelector("[data-testid='semantic-extension']")).toBeNull();
      expect(container.textContent).toContain("Future semantic part");
    } finally {
      dispose();
    }
  });

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
      { ...base, sequence: 2, itemId: "cursor-thought", emittedAt: new Date(2_000).toISOString(), type: "reasoning.summary.delta", payload: { delta: "", boundary: true, status: "working" } },
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

  it("shows Jump to latest when the transcript is not pinned to the bottom", () => {
    const projection = createAgentProjection();
    projection.messages.push({
      id: "msg-1",
      role: "assistant",
      text: "hello".repeat(200),
      sequence: 1,
      turnId: "turn-1",
      itemId: "item-1",
      streaming: false,
      terminalState: null,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get() { return (this as HTMLElement & { _scrollTop?: number })._scrollTop ?? 0; },
      set(value: number) { (this as HTMLElement & { _scrollTop?: number })._scrollTop = value; },
    });

    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    const transcript = container.querySelector(".desktop-agent-transcript") as HTMLElement;
    act(() => {
      transcript.scrollTop = 0;
      transcript.dispatchEvent(new Event("scroll"));
    });
    const jump = container.querySelector(".desktop-agent-jump-latest") as HTMLButtonElement;
    expect(jump.textContent).toBe("");
    expect(jump.getAttribute("aria-label")).toContain("Jump to latest");
    expect(jump.querySelector("svg")).not.toBeNull();
  });

  it("disables approval actions while a decision is resolving", () => {
    const onResolve = vi.fn();
    const container = render(React.createElement(AgentApprovalDock, {
      approval: {
        requestId: "req-1",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "command",
        title: "Run npm test",
        command: "npm test",
        cwd: "/workspace",
        commandActions: [],
        networkApprovalContext: null,
        grantRoot: null,
        policyChangeRequested: false,
        reason: null,
        availableDecisions: ["accept", "decline", "cancel"],
        sequence: 1,
      },
      queueLength: 1,
      resolving: true,
      onResolve,
    }));
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it("keeps approval copy concise and preserves every provider decision", () => {
    const onResolve = vi.fn();
    const repeatedCopy = "Web search: Notion launch screenshots";
    const container = render(React.createElement(AgentApprovalDock, {
      approval: {
        requestId: "req-search",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "command",
        title: repeatedCopy,
        command: null,
        cwd: null,
        commandActions: [],
        networkApprovalContext: null,
        grantRoot: null,
        policyChangeRequested: false,
        reason: `  ${repeatedCopy}  `,
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        sequence: 1,
      },
      queueLength: 1,
      resolving: false,
      onResolve,
    }));

    expect(container.textContent?.split(repeatedCopy)).toHaveLength(2);
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.map((button) => button.textContent)).toEqual(["Deny", "Allow for session", "Allow once"]);
    act(() => buttons[0].click());
    act(() => buttons[1].click());
    act(() => buttons[2].click());
    expect(onResolve.mock.calls.map(([decision]) => decision)).toEqual(["decline", "acceptForSession", "accept"]);
  });

  it("renders material network and filesystem approval scope", () => {
    const container = render(React.createElement(AgentApprovalDock, {
      approval: {
        requestId: "req-network",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "command",
        title: "Allow network access",
        command: null,
        cwd: "/workspace",
        commandActions: [],
        networkApprovalContext: { host: "registry.npmjs.org:443", protocol: "https" },
        grantRoot: "/workspace/generated",
        policyChangeRequested: true,
        reason: "Download a package",
        availableDecisions: ["accept", "decline", "cancel"],
        sequence: 1,
      },
      queueLength: 1,
      resolving: false,
      onResolve: vi.fn(),
    }));

    expect(container.textContent).toContain("https://registry.npmjs.org:443");
    expect(container.textContent).toContain("/workspace/generated");
    expect(container.textContent).toContain("reusable policy change");
  });

  it("keeps incompatible runtime recovery product-owned", () => {
    const readiness: AgentRuntimeReadiness = {
      runtimeId: "opencode",
      provider: "opencode",
      status: "unsupported-version",
      code: "RUNTIME_VERSION_UNSUPPORTED",
      version: "0.100.0",
      minimumVersion: "0.144.1",
      message: "The managed Agent engine is incompatible with this PuppyOne build.",
    };
    const container = render(React.createElement("div", {
      className: "desktop-agent-readiness",
      role: "status",
      children: [
        React.createElement("strong", { key: "h" }, "PuppyOne Agent needs repair"),
        React.createElement("p", { key: "p" },
          `${readiness.message} Update or reinstall PuppyOne, then retry.`,
        ),
      ],
    }));
    expect(container.textContent).toContain("PuppyOne Agent needs repair");
    expect(container.textContent).toContain("Update or reinstall PuppyOne");
    expect(container.textContent).not.toContain("Update OpenCode");
  });
});
