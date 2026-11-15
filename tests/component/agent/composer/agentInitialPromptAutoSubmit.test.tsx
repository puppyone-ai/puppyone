/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuxiliaryWorkbenchPanel } from "../../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import type { AgentEvent, AgentSessionSnapshot } from "../../../../src/features/desktop-agent/agentTypes";
import { createProjectAgentClientProvider } from "../../../../src/features/desktop-agent/infrastructure/electron/electronAgentClient";
import {
  AgentChatWorkbenchItem,
  prepareAgentChatWorkbenchItem,
  requestCloseAgentChatWorkbenchItem,
} from "../../../../src/features/desktop-agent/workbench/AgentChatWorkbenchItem";
import { projectAgentControllers } from "../../../../src/features/desktop-agent/workbench/projectAgentControllers";
import { ProjectWorkbenchStore } from "../../../../src/lib/workbench/ProjectWorkbenchStore";
import type { AuxiliaryWorkbenchContribution } from "../../../../src/lib/workbench/types";
import { desktopPreferencesStore, initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { displaySnapshot, withDisplayFeed } from "../../../support/agent/agentDisplayFixture";
import { defineAgentEvent, type AgentEventPayloadMap } from "../../../support/agent/agentEventFixture";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let project: ProjectWorkbenchStore | null = null;

afterEach(() => {
  act(() => root?.unmount());
  project?.dispose();
  root = null;
  project = null;
  delete (window as Window & { puppyoneDesktop?: unknown }).puppyoneDesktop;
  document.body.innerHTML = "";
});

describe("Agent initial prompt handoff and one-shot auto-submit", () => {
  it("creates an agent-chat item with initialPrompt and submits it exactly once when ready", async () => {
    const harness = createClaudeHarness("ready", "READY");
    const { container, store } = await mountAgentWorkbenchWithSeed(
      harness.bridge,
      "claude-code-acp",
      "Build a pricing comparison page with an HTML summary",
    );

    await vi.waitFor(() => {
      expect(harness.bridge.startAgentTurn).toHaveBeenCalledTimes(1);
    });

    expect(harness.bridge.startAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Build a pricing comparison page with an HTML summary",
    }));

    // Re-rendering or subsequent state updates must never submit the initial prompt a second time.
    const itemId = container.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!.dataset.terminalSessionPaneId!;
    const controller = projectAgentControllers(store).get(itemId);
    expect(controller.hasPendingInitialAutoSubmit()).toBe(false);

    await act(async () => {
      controller.setDraft("Follow-up draft without clicking send");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(harness.bridge.startAgentTurn).toHaveBeenCalledTimes(1);
  });

  it("prefills the draft without sending when the runtime is not ready", async () => {
    const harness = createClaudeHarness("setup-required", "AUTHENTICATION_REQUIRED");
    const { container, store } = await mountAgentWorkbenchWithSeed(
      harness.bridge,
      "claude-code-acp",
      "Draft weekly changelog from git commits",
    );

    await flushEffects();
    await flushEffects();

    const itemId = container.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!.dataset.terminalSessionPaneId!;
    const controller = projectAgentControllers(store).get(itemId);

    expect(harness.bridge.startAgentTurn).not.toHaveBeenCalled();
    expect(controller.getSnapshot().draft).toBe("Draft weekly changelog from git commits");
    expect(controller.hasPendingInitialAutoSubmit()).toBe(false);
  });
});

async function mountAgentWorkbenchWithSeed(
  bridge: ReturnType<typeof createClaudeHarness>["bridge"],
  runtimeId: string,
  initialPrompt: string,
) {
  installDesktopBridge(bridge);
  initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  desktopPreferencesStore.getState().setAgentPreferredRuntime(runtimeId);

  const store = new ProjectWorkbenchStore({
    projectId: "created-project",
    generation: "open-1",
    rootPath: "/workspace/created-project",
  });
  project = store;
  projectAgentControllers(store, { createClient: () => createProjectAgentClientProvider(store.context) });

  const recipe = { id: runtimeId, label: "Claude Code", iconKey: "claude-code", status: "available" as const };
  const contribution: AuxiliaryWorkbenchContribution = {
    kind: "agent-chat",
    label: "Chat",
    createLabel: "New chat",
    maximumItems: 8,
    minimumSize: { width: 280, height: 260 },
    creationRecipes: [recipe],
    initialSnapshot: {
      title: "Claude Code",
      accessibleLabel: "Claude Code",
      detail: null,
      iconKey: "claude-code",
      status: "idle",
      running: false,
      resourceId: null,
    },
    prepare: async ({ project: targetProject, item, recipe: nextRecipe, seed }) => {
      prepareAgentChatWorkbenchItem(targetProject, item.id, nextRecipe?.id ?? null, seed?.initialPrompt ?? null);
    },
    renderItem: (context) => React.createElement(AgentChatWorkbenchItem, {
      ...context,
      hiddenRuntimeIds: [],
      onOpenAccount: vi.fn(),
      onOpenModelConnections: vi.fn(),
    }),
    close: {
      executionKind: "agent",
      decide: () => ({ kind: "close" }),
      commit: ({ project: targetProject, item }) => requestCloseAgentChatWorkbenchItem(targetProject, item.id),
    },
  };

  store.configure([contribution]);
  await act(async () => {
    await store.create(
      "agent-chat",
      null,
      recipe,
      null,
      null,
      { initialPrompt },
    );
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(withTestLocalization(React.createElement(AuxiliaryWorkbenchPanel, {
      store,
      contributions: [contribution],
      active: true,
      renderLauncher: () => null,
    })));
  });
  await flushEffects();
  return { container, store };
}

function createClaudeHarness(status: "ready" | "setup-required", code: "READY" | "AUTHENTICATION_REQUIRED") {
  const readiness = {
    runtimeId: "claude-code-acp",
    provider: "claude",
    status,
    code,
    version: "1.0.0",
    minimumVersion: "1.0.0",
    message: status === "ready" ? "Claude Code is ready." : "Sign in to Claude Code first.",
  };
  const runtime = { id: "claude-code-acp", displayName: "Claude Code", iconKey: "claude-code", kind: "harness" as const };
  const inspection = {
    runtimes: [{ descriptor: runtime, readiness }],
    selectedRuntimeId: "claude-code-acp",
    runtime,
    readiness,
    account: null,
    providers: [{ id: "anthropic", displayName: "Anthropic", defaultModel: "claude-sonnet-4-5", modelCount: 1 }],
    models: [{
      id: "claude-sonnet-4-5",
      model: "claude-sonnet-4-5",
      providerId: "anthropic",
      displayName: "Claude Sonnet",
      description: "Anthropic",
      isDefault: true,
    }],
    capabilities: capabilities(),
    warnings: [],
  };
  const sessionSnapshot = createSnapshot([]);
  const harness: {
    bridge: Record<string, ReturnType<typeof vi.fn> | ((listener: never) => () => void)>;
  } = { bridge: {} };
  harness.bridge = withDisplayFeed({
    discoverAgentProviders: vi.fn(async () => inspection),
    openAgentSession: vi.fn(async () => ({ status: "opened", snapshot: sessionSnapshot })),
    createAgentSession: vi.fn(async () => createSnapshot([
      makeEvent(1, "session.started", { title: "New session" }),
    ])),
    replayAgentSession: vi.fn(async () => sessionSnapshot),
    closeAgentSession: vi.fn(async () => ({ sessionId: "session-claude-1", closed: true })),
    startAgentTurn: vi.fn(async () => ({ accepted: true })),
    listAgentSessions: vi.fn(async () => ({
      sessions: [],
      discovery: { runtimeId: null, status: "not-requested", nextCursor: null, scanId: null, indexed: 0, warnings: [] },
      warnings: [],
    })),
  }, () => {}, () => {});
  return harness;
}

function createSnapshot(events: AgentEvent[]): AgentSessionSnapshot {
  return displaySnapshot({
    session: {
      id: "session-claude-1",
      runtimeId: "claude-code-acp",
      runtime: { id: "claude-code-acp", displayName: "Claude Code", iconKey: "claude-code", kind: "harness" },
      provider: "claude",
      providerSessionId: "thread-claude-1",
      workspaceRoot: "/workspace/created-project",
      title: "Claude Code",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:01.000Z",
      terminalState: "idle",
      selectedModel: "claude-sonnet-4-5",
      activeTurnId: null,
      lastSequence: events.at(-1)?.sequence ?? 1,
    },
    account: null,
    providers: [{ id: "anthropic", displayName: "Anthropic", defaultModel: "claude-sonnet-4-5", modelCount: 1 }],
    models: [{
      id: "claude-sonnet-4-5",
      model: "claude-sonnet-4-5",
      providerId: "anthropic",
      displayName: "Claude Sonnet",
      description: "Anthropic",
      isDefault: true,
    }],
    capabilities: capabilities(),
    runtime: { id: "claude-code-acp", displayName: "Claude Code", iconKey: "claude-code", kind: "harness" },
    events,
    partial: false,
    firstAvailableSequence: events[0]?.sequence ?? 1,
    lastSequence: events.at(-1)?.sequence ?? 1,
  });
}

function capabilities() {
  return {
    streamingText: true,
    structuredToolEvents: true,
    commandOutputStreaming: true,
    fileChangeEvents: true,
    manualApprovals: true,
    structuredQuestions: false,
    resume: true,
    fork: false,
    steer: false,
    queue: false,
    attachments: false,
    contextReferences: false,
    modelSelection: true,
    modeSelection: false,
    slashCommands: false,
    sessionHistory: true,
    usage: false,
    accountState: false,
    mcp: false,
    skills: false,
    compaction: false,
  };
}

function makeEvent<T extends AgentEvent["type"]>(
  sequence: number,
  type: T,
  payload: AgentEventPayloadMap[T] & Record<string, unknown>,
): AgentEvent<T> {
  return defineAgentEvent<T>({
    schemaVersion: 1,
    sequence,
    sessionId: "session-claude-1",
    runtimeId: "claude-code-acp",
    provider: "claude",
    providerSessionId: "thread-claude-1",
    turnId: null,
    itemId: null,
    emittedAt: new Date(sequence * 1000).toISOString(),
    type,
    payload,
  });
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
