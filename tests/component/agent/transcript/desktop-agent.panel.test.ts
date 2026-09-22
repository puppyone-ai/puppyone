import { displaySnapshot, withDisplayFeed } from "../../../support/agent/agentDisplayFixture";
import { defineAgentEvent, type AgentEventPayloadMap } from "../../../support/agent/agentEventFixture";
import { installDesktopBridge, type DesktopBridge } from "../../../support/electron/desktopBridge";
import type { ModelConnectionSnapshot } from "../../../../shared/model-connections/types";
/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuxiliaryWorkbenchPanel } from "../../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { ProjectWorkbenchStore } from "../../../../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import type { AuxiliaryWorkbenchContribution } from "../../../../src/features/app-shell/auxiliary-workbench/types";
import type { AgentEvent, AgentSessionSnapshot } from "../../../../src/features/desktop-agent/agentTypes";
import { AgentChatWorkbenchItem, requestCloseAgentChatWorkbenchItem } from "../../../../src/features/desktop-agent/workbench/AgentChatWorkbenchItem";
import { createProjectAgentClientProvider } from "../../../../src/features/desktop-agent/infrastructure/electron/electronAgentClient";
import { projectAgentControllers } from "../../../../src/features/desktop-agent/workbench/projectAgentControllers";
import { stripBidiIsolation, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let project: ProjectWorkbenchStore;

afterEach(() => {
  act(() => root?.unmount());
  project?.dispose();
  root = null;
  delete (window as Window & { puppyoneDesktop?: unknown }).puppyoneDesktop;
  document.body.innerHTML = "";
});

describe("Project-owned Agent Chat Workbench lifecycle", () => {
  it.each([
    ["RUNTIME_SETUP_REQUIRED", false],
    ["AUTHENTICATION_REQUIRED", true],
    ["RUNTIME_VERSION_UNSUPPORTED", true],
  ])("keeps first-use compute onboarding distinct from %s recovery", async (code, showRecovery) => {
    const harness = createBridgeHarness();
    const inspection = readyInspection();
    const readiness = { ...inspection.readiness, status: "setup-required", code };
    harness.bridge.discoverAgentProviders = vi.fn(async () => ({
      ...inspection, readiness, models: [], providers: [], account: null,
      runtimes: [{ ...inspection.runtimes[0], readiness }],
      capabilities: { ...capabilities(), modelConnections: true },
    }));
    const container = renderPanel(harness.bridge);
    await flushEffects(); await flushEffects();
    expect(Boolean(container.querySelector(".desktop-agent-readiness"))).toBe(showRecovery);
    expect(Boolean(container.querySelector(".desktop-agent-empty-state"))).toBe(!showRecovery);
    expect(container.querySelector(".desktop-agent-compute-summary")?.textContent).toContain("Puppyone's token");
    expect((container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
    expect(harness.bridge.createAgentSession).not.toHaveBeenCalled();
  });

  it("keeps the first draft through sign-in, grants access without checkout, and sends only on the next click", async () => {
    const harness = createBridgeHarness();
    const connectionId = "mc_11111111-1111-4111-8111-111111111111";
    const model = { id: `${connectionId}/test-model`, model: `${connectionId}/test-model`, connectionId,
      displayName: "Test model", description: "PuppyOne", isDefault: true };
    let credit: ModelConnectionSnapshot = { schemaVersion: 1, revision: 100, connections: [], catalogs: [],
      managed: { available: false, reason: "sign-in-required", signedIn: false, trialCreditMicroUsd: 1_000_000 } };
    let observe: ((value: ModelConnectionSnapshot) => void) | undefined;
    const result = async () => ({ ok: true as const, value: credit });
    const managed = vi.fn(result);
    const modelConnections: NonNullable<DesktopBridge["modelConnections"]> = {
      read: result, save: result, remove: result, refresh: result, verify: result,
      discover: async () => ({ ok: true, value: [] }), managed,
      subscribe: (listener) => { observe = listener; return () => { observe = undefined; }; },
    };
    harness.bridge.discoverAgentProviders = vi.fn(async () => {
      const inspection = readyInspection();
      const readiness = credit.managed.available ? inspection.readiness
        : { ...inspection.readiness, status: "setup-required", code: "RUNTIME_SETUP_REQUIRED" };
      return { ...inspection, readiness, models: credit.managed.available ? [model] : [], providers: [], account: null,
        runtimes: [{ ...inspection.runtimes[0], readiness }], capabilities: { ...capabilities(), modelConnections: true } };
    });
    harness.bridge.openAgentSession = vi.fn(async () => {
      const opened = snapshot([]);
      return { status: "opened", snapshot: { ...opened, models: [model], capabilities: { ...capabilities(), modelConnections: true },
        session: { ...opened.session, selectedModel: model.model } } };
    });
    const container = renderPanel(harness.bridge, null, modelConnections);
    await flushEffects(); await flushEffects();
    const tabId = activeTabPanel(container).dataset.terminalSessionPaneId!;
    const controller = projectAgentControllers(project).get(tabId);
    act(() => controller.setDraft("Help me with this local project"));
    expect(container.querySelector(".desktop-agent-access-prompt")).toBeNull();
    const send = () => container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
    expect(send().disabled).toBe(false);
    await act(async () => send().click());
    expect(container.querySelector(".desktop-agent-access-prompt")?.textContent).toContain("Sign in to start");
    expect(harness.bridge.startAgentTurn).not.toHaveBeenCalled();
    expect(harness.bridge.createAgentSession).not.toHaveBeenCalled();
    const signIn = [...container.querySelectorAll("button")].find((button) => button.textContent === "Sign in to start")!;
    await act(async () => signIn.click());
    expect(managed).toHaveBeenCalledWith({ action: "sign-in" });
    credit = { ...credit, revision: 101,
      managed: { available: false, reason: "loading", signedIn: true } };
    await act(async () => observe?.(credit));
    await flushEffects(); await flushEffects();
    expect(container.querySelector(".desktop-agent-access-prompt")?.textContent).toContain("Connecting to compute…");
    expect(container.textContent).not.toContain("Could not refresh Agent credits");
    expect(controller.getSnapshot().draft).toBe("Help me with this local project");
    expect(harness.bridge.startAgentTurn).not.toHaveBeenCalled();
    credit = { ...credit, revision: 102,
      managed: { available: true, reason: "ready", signedIn: true, availableMicroUsd: 1_000_000, trialGrantedMicroUsd: 1_000_000 },
      connections: [{ id: connectionId, sourceKind: "managed", driver: "openai-compatible", name: "PuppyOne", baseUrl: "https://example.test/ai",
        auth: "bearer", credentialConfigured: true, readOnly: true, configGeneration: 1, defaultModelId: "test-model", manualModelId: null,
        manualContextWindow: null, serverToolsDisabled: true, transport: "remote", executionLocation: "unknown" }],
      catalogs: [{ connectionId, configGeneration: 1, status: "ready", endpoint: "reachable", authentication: "valid", observedAt: null,
        complete: true, models: [], errorCode: null }],
    };
    await act(async () => observe?.(credit));
    await flushEffects(); await flushEffects();
    expect(controller.getSnapshot().draft).toBe("Help me with this local project");
    expect(container.querySelector(".desktop-agent-access-prompt")).toBeNull();
    expect(harness.bridge.startAgentTurn).not.toHaveBeenCalled();
    expect(managed).not.toHaveBeenCalledWith(expect.objectContaining({ action: "checkout" }));
    expect(send().disabled).toBe(false);
    await act(async () => send().click());
    await flushEffects();
    expect(harness.bridge.startAgentTurn).toHaveBeenCalledTimes(1);
  });

  it("keeps history out of the runtime chooser so choosing an Agent always starts a new chat", async () => {
    const harness = createBridgeHarness();
    const codex = {
      descriptor: {
        id: "codex",
        displayName: "Codex",
        iconKey: "codex",
        kind: "specialized-native",
        ownership: { session: "runtime" },
      },
      readiness: { ...readyInspection().readiness, runtimeId: "codex", provider: "codex" },
    };
    harness.bridge.discoverAgentProviders = vi.fn(async () => ({
      runtimes: [codex], selectedRuntimeId: null, readiness: null, account: null,
      providers: [], models: [], modes: [], commands: [], capabilities: null, warnings: [],
    }));

    const container = renderPanel(harness.bridge);
    await flushEffects();
    await flushEffects();

    expect(container.querySelector(".desktop-agent-runtime-launcher-group")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-history-view")).toBeNull();
    expect(container.querySelector('button[aria-label="Chat history"]')).toBeNull();
    expect(harness.bridge.listAgentSessions).not.toHaveBeenCalled();
  });

  it("opens on an installed-Agent launcher before mounting an empty Chat", async () => {
    const harness = createBridgeHarness();
    const runtimes = [
      {
        descriptor: { id: "codex", displayName: "Codex", kind: "harness" },
        readiness: { ...readyInspection().readiness, runtimeId: "codex", provider: "codex" },
      },
      {
        descriptor: { id: "claude", displayName: "Claude Agent", kind: "harness" },
        readiness: { ...readyInspection().readiness, runtimeId: "claude", provider: "claude" },
      },
    ];
    harness.bridge.discoverAgentProviders = vi.fn()
      .mockResolvedValueOnce({
        runtimes,
        selectedRuntimeId: null,
        readiness: null,
        account: null,
        providers: [],
        models: [],
        modes: [],
        commands: [],
        capabilities: null,
        warnings: [],
      })
      .mockResolvedValueOnce({
        ...readyInspection(),
        runtimes,
        selectedRuntimeId: "claude",
        runtime: runtimes[1].descriptor,
        readiness: runtimes[1].readiness,
      });
    harness.bridge.resumeAgentSession = vi.fn(async () => null);
    harness.bridge.createAgentSession = vi.fn(async () => {
      const created = snapshot([]);
      return {
        ...created,
        runtime: runtimes[1].descriptor,
        session: {
          ...created.session,
          runtimeId: "claude",
          runtime: runtimes[1].descriptor,
          provider: "claude",
        },
      };
    });

    const container = renderPanel(harness.bridge, "codex");
    await flushEffects();

    const launcher = container.querySelector(".desktop-agent-runtime-launcher") as HTMLElement;
    expect(harness.bridge.discoverAgentProviders).toHaveBeenNthCalledWith(1, {
      projectContext: project.context,
      rootPath: "/workspace",
      runtimeId: null,
      refresh: false,
    });
    expect(launcher).not.toBeNull();
    expect(launcher.textContent).toContain("Start with an Agent");
    expect(launcher.textContent).toContain("Codex");
    expect(launcher.textContent).toContain("Claude Agent");
    expect(container.querySelector('.desktop-agent-header-region')).toBeNull();
    expect(container.querySelector('button[aria-label="Coding Agent"]')).toBeNull();
    expect(container.querySelector(".cm-content")).toBeNull();
    expect(harness.bridge.resumeAgentSession).not.toHaveBeenCalled();
    expect(harness.bridge.createAgentSession).not.toHaveBeenCalled();

    act(() => (launcher.querySelector('button[aria-label="Claude Agent"]') as HTMLButtonElement).click());
    await flushEffects();
    await flushEffects();
    expect(harness.bridge.discoverAgentProviders).toHaveBeenLastCalledWith({
      projectContext: project.context,
      rootPath: "/workspace",
      runtimeId: "claude",
      refresh: false,
    });
    expect(container.querySelector(".desktop-agent-runtime-launcher")).toBeNull();
    expect(container.querySelector(".desktop-agent-header-region")).toBeNull();
    expect(container.querySelector('button[aria-label="Coding Agent"]')).toBeNull();
    expect(stripBidiIsolation(container.querySelector(".cm-content")?.getAttribute("aria-label"))).toBe("Message Claude Agent");
    expect(container.querySelector(".desktop-agent-empty-state .desktop-agent-brand-mark.is-claude.is-monochrome")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-empty-state .po-agent-monochrome-brand-image")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-empty-state")?.textContent).toContain("What should we work on?");
    expect(container.querySelector(".desktop-agent-empty-state")?.closest(".desktop-agent-conversation-overlay")).not.toBeNull();
  });

  it("uses one centered product loader while the chat runtime starts", async () => {
    const harness = createBridgeHarness();
    let finishDiscovery: ((inspection: ReturnType<typeof readyInspection>) => void) | null = null;
    harness.bridge.discoverAgentProviders = vi.fn(() => new Promise<ReturnType<typeof readyInspection>>((resolve) => {
      finishDiscovery = resolve;
    }));

    const container = renderPanel(harness.bridge);
    await act(async () => { await Promise.resolve(); });

    const loaders = container.querySelectorAll("[data-puppy-loader]");
    const loadingSurface = container.querySelector(".desktop-agent-startup-loading") as HTMLDivElement;
    expect(loaders).toHaveLength(1);
    expect(stripBidiIsolation(loaders[0].getAttribute("aria-label"))).toBe("Preparing Agent");
    expect(loadingSurface).not.toBeNull();
    expect(loadingSurface.style.alignItems).toBe("center");
    expect(loadingSurface.style.justifyContent).toBe("center");
    expect(container.querySelector(".desktop-agent-status-region")).toBeNull();
    expect(container.querySelector(".desktop-agent-dock-region")).toBeNull();
    expect(container.querySelector(".cm-content")).toBeNull();
    expect(container.textContent).not.toMatch(/Preparing Agent|Checking Agent|Restoring session|Starting session/);

    await act(async () => { finishDiscovery?.(readyInspection()); });
    await flushEffects();
    expect(container.querySelector(".desktop-agent-startup-loading")).toBeNull();
    expect(container.querySelector(".desktop-agent-dock-region")).not.toBeNull();
    expect(container.querySelector(".cm-content")).not.toBeNull();
  });

  it("keeps the empty-chat identity visible while the composer only contains an unsent draft", async () => {
    const harness = createBridgeHarness();
    const container = renderPanel(harness.bridge);
    await flushEffects();

    const panel = activeTabPanel(container);
    const tabId = panel.dataset.terminalSessionPaneId!;
    const controller = projectAgentControllers(project).get(tabId);
    const emptyOverlay = panel.querySelector(".desktop-agent-conversation-overlay");
    expect(panel.querySelector(".desktop-agent-empty-state")).not.toBeNull();
    expect(panel.querySelector(".desktop-agent-empty-state")?.closest(".desktop-agent-conversation-overlay")).not.toBeNull();

    act(() => controller.setDraft("This is still only a draft"));

    expect(panel.querySelector(".desktop-agent-empty-state")).not.toBeNull();
    expect(panel.querySelector(".desktop-agent-conversation-overlay")).toBe(emptyOverlay);
    expect(panel.querySelector(".desktop-agent-empty-state")?.textContent).toContain("What should we work on?");
  });

  it("keeps the failed tab available while opening recovery work in another tab", async () => {
    const harness = createBridgeHarness();
    const container = renderPanel(harness.bridge);
    await flushEffects();
    expect(container.querySelector(".cm-content")?.getAttribute("aria-disabled")).toBe("false");

    act(() => harness.exitListener?.({ sessionId: "session-1", reason: "provider-exited" }));

    expect(stripBidiIsolation(container.textContent)).toContain("OpenCode stopped unexpectedly");
    expect(container.querySelector(".cm-content")?.getAttribute("aria-disabled")).toBe("false");
    expect((container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
    await createChat();
    await flushEffects();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(project.getSnapshot().topology.items).toHaveLength(2);
    expect(harness.bridge.closeAgentSession).not.toHaveBeenCalled();
  });

  it("switches the complete Chat section between independently mounted tabs", async () => {
    const harness = createBridgeHarness();
    harness.bridge.discoverAgentProviders = vi.fn()
      .mockResolvedValueOnce(readyInspection())
      .mockResolvedValueOnce({
        ...readyInspection(),
        selectedRuntimeId: null,
        runtime: null,
        readiness: null,
        models: [],
        capabilities: null,
      });

    const container = renderPanel(harness.bridge);
    await flushEffects();
    const firstTab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    expect(firstTab?.getAttribute("aria-selected")).toBe("true");
    expect(activeTabPanel(container).querySelector(".desktop-agent-header-region")).toBeNull();
    expect(activeTabPanel(container).querySelector(".cm-content")).not.toBeNull();

    await createChat();
    await flushEffects();
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(activeTabPanel(container).querySelector(".desktop-agent-runtime-launcher")).not.toBeNull();

    act(() => tabs[0].click());
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(activeTabPanel(container).querySelector(".desktop-agent-header-region")).toBeNull();
    expect(activeTabPanel(container).querySelector(".cm-content")).not.toBeNull();

    act(() => tabs[1].click());
    const closeSecond = container.querySelector<HTMLButtonElement>('button[aria-label="Close New chat"]');
    expect(closeSecond).not.toBeNull();
    await act(async () => { closeSecond?.click(); await Promise.resolve(); });
    await flushEffects();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(activeTabPanel(container).querySelector(".desktop-agent-header-region")).toBeNull();
    expect(activeTabPanel(container).querySelector(".cm-content")).not.toBeNull();
  });

  it("retains workspace tab topology across Sidebar remounts", async () => {
    const harness = createBridgeHarness();
    const container = renderPanel(harness.bridge);
    await flushEffects();
    await createChat();
    await flushEffects();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);

    act(() => root?.unmount());
    root = createRoot(container);
    renderPanelContent();
    await flushEffects();

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(project.getSnapshot().topology.items).toHaveLength(2);
  });

  it("owns incompatible-engine recovery instead of asking users to update OpenCode", async () => {
    const harness = createBridgeHarness();
    harness.bridge.discoverAgentProviders = vi.fn(async () => ({
      runtimes: [{
        descriptor: { id: "opencode", displayName: "OpenCode", kind: "harness" },
        readiness: {
          runtimeId: "opencode",
          provider: "opencode",
          status: "unsupported-version",
          code: "RUNTIME_VERSION_UNSUPPORTED",
          version: "1.1.33",
          minimumVersion: "1.17.18",
          source: "external",
          compatibility: "unavailable",
          message: "The configured Agent engine is incompatible with this PuppyOne build. Use PuppyOne's managed engine, then retry.",
        },
      }],
      selectedRuntimeId: "opencode",
      runtime: { id: "opencode", displayName: "OpenCode", kind: "harness" },
      readiness: {
        runtimeId: "opencode",
        provider: "opencode",
        status: "unsupported-version",
        code: "RUNTIME_VERSION_UNSUPPORTED",
        version: "1.1.33",
        minimumVersion: "1.17.18",
        source: "external",
        compatibility: "unavailable",
        message: "The configured Agent engine is incompatible with this PuppyOne build. Use PuppyOne's managed engine, then retry.",
      },
      account: null,
      models: [],
      capabilities: null,
      warnings: [],
    }));

    const container = renderPanel(harness.bridge);
    await flushEffects();

    const promptEditor = container.querySelector(".cm-content") as HTMLElement;
    expect(promptEditor.getAttribute("aria-disabled")).toBe("false");
    expect(promptEditor.getAttribute("contenteditable")).toBe("true");
    const text = stripBidiIsolation(container.textContent);
    expect(text).toContain("Update OpenCode");
    expect(text).toContain("The configured Agent engine is incompatible");
    expect(text).toContain("Status code: RUNTIME_VERSION_UNSUPPORTED");
    expect(text).not.toContain("OpenCode update required");
    expect(container.querySelector('button[aria-label="Retry Agent engine"]')).not.toBeNull();
  });

  it("renders the Main-authored transcript without requesting raw event replay", async () => {
    const harness = createBridgeHarness();
    harness.bridge.replayAgentSession = vi.fn(async () => snapshot([
      event(2, "turn.started", { prompt: "Fix it" }, "turn-1"),
      event(3, "assistant.delta", { delta: "Working" }, "turn-1", "message-1"),
    ]));
    const container = renderPanel(harness.bridge);
    await flushEffects();

    act(() => harness.eventListener?.(event(2, "turn.started", { prompt: "Fix it" }, "turn-1")));
    act(() => harness.eventListener?.(event(
      3,
      "assistant.delta",
      { delta: "Working" },
      "turn-1",
      "message-1",
    )));
    await flushEffects();

    expect(harness.bridge.replayAgentSession).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Fix it");
    expect(container.textContent).toContain("Working");
  });

  it("ends Stop and offers a draft-preserving follow-up for degraded completion", async () => {
    const harness = createBridgeHarness();
    const container = renderPanel(harness.bridge);
    await flushEffects();
    const panel = activeTabPanel(container);
    const tabId = panel.dataset.terminalSessionPaneId!;
    const controller = projectAgentControllers(project).get(tabId);
    act(() => controller.setDraft("Keep my separate draft"));

    act(() => harness.eventListener?.(event(2, "turn.started", { prompt: "Finish it" }, "turn-degraded")));
    act(() => harness.eventListener?.(event(3, "assistant.completed", {
      text: "Native internal request ended early.",
    }, "turn-degraded", "message-degraded")));
    act(() => harness.eventListener?.(event(4, "turn.completed", {
      status: "completed",
      completionQuality: "degraded",
      failureScope: "upstream-request",
      failureCode: "CURSOR_HTTP2_STREAM_CANCEL",
      retryable: true,
      transportHealth: "healthy",
      sideEffects: "possible",
    }, "turn-degraded")));
    await flushEffects();

    expect(panel.querySelector(".desktop-agent-recovery")?.textContent).toContain("Task needs follow-up");
    expect(panel.querySelector(".desktop-agent-composer-action.is-stop")).toBeNull();
    const continueButton = [...panel.querySelectorAll<HTMLButtonElement>(".desktop-agent-recovery button")]
      .find((button) => button.textContent?.includes("Check current state and continue"));
    expect(continueButton).toBeTruthy();
    await act(async () => { continueButton?.click(); await Promise.resolve(); });

    expect(harness.bridge.startAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      recoveryOfTurnId: "turn-degraded",
      references: [],
      promptMentions: [],
    }));
    expect(controller.getSnapshot().draft).toBe("Keep my separate draft");
  });
});

function renderPanel(
  bridge: ReturnType<typeof createBridgeHarness>["bridge"],
  preferredRuntimeId: string | null = null,
  modelConnections?: DesktopBridge["modelConnections"],
) {
  installDesktopBridge({ ...bridge, ...(modelConnections ? { modelConnections } : {}) });
  project = new ProjectWorkbenchStore({ projectId: "workspace", generation: "open-1", rootPath: "/workspace" });
  // Component assertions use the controlled feed port. Real MessagePorts are
  // exercised by session transport contracts and the complete Desktop workflow.
  projectAgentControllers(project, { createClient: () => createProjectAgentClientProvider(project.context) });
  project.dispatch({ type: "create", item: { id: "chat-1", kind: "agent-chat", rootId: "/workspace", contextId: "workspace" }, groupId: "group-1", targetGroupId: null });
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  renderPanelContent(preferredRuntimeId);
  return container;
}

function renderPanelContent(preferredRuntimeId: string | null = null) {
  const contribution: AuxiliaryWorkbenchContribution = {
    kind: "agent-chat", label: "Chat", createLabel: "New chat", maximumItems: 8,
    minimumSize: { width: 280, height: 260 },
    initialSnapshot: { title: "New chat", accessibleLabel: "New chat", detail: null, iconKey: null, status: "idle", running: false, resourceId: null },
    renderItem: (context) => React.createElement(AgentChatWorkbenchItem, {
      ...context, hiddenRuntimeIds: [], preferredRuntimeId, preferredRoute: {}, preferredModel: null,
      onOpenAccount: vi.fn(),
      onOpenModelConnections: vi.fn(),
    }),
    close: { decide: () => ({ kind: "close" }), commit: ({ project, item }) => requestCloseAgentChatWorkbenchItem(project, item.id) },
  };
  act(() => root?.render(withTestLocalization(React.createElement(AuxiliaryWorkbenchPanel, {
    store: project, contributions: [contribution], active: true, renderLauncher: () => null,
  }))));
}

async function createChat() {
  await act(async () => { await project.create("agent-chat", null); });
}

function activeTabPanel(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])') as HTMLElement;
}

function createBridgeHarness() {
  const harness: {
    eventListener: ((event: AgentEvent) => void) | null;
    exitListener: ((event: { sessionId: string; reason: "closed" | "provider-exited" }) => void) | null;
    bridge: Record<string, ReturnType<typeof vi.fn> | ((listener: never) => () => void)>;
  } = {
    eventListener: null,
    exitListener: null,
    bridge: {},
  };
  harness.bridge = withDisplayFeed({
    discoverAgentProviders: vi.fn(async () => readyInspection()),
    resumeAgentSession: vi.fn(async () => snapshot([
      event(1, "session.resumed", { title: "Session" }),
    ])),
    openAgentSession: vi.fn(async () => ({ status: "opened", snapshot: snapshot([]) })),
    replayAgentSession: vi.fn(async () => snapshot([])),
    closeAgentSession: vi.fn(async () => ({ sessionId: "session-1", closed: true })),
    startAgentTurn: vi.fn(async () => ({ accepted: true })),
    createAgentSession: vi.fn(async () => snapshot([
      event(1, "session.started", { title: "New session" }),
    ])),
    listAgentSessions: vi.fn(async () => ({
      sessions: [],
      discovery: {
        runtimeId: null,
        status: "not-requested",
        nextCursor: null,
        scanId: null,
        indexed: 0,
        warnings: [],
      },
      warnings: [],
    })),
  }, listener => { harness.eventListener = listener; }, listener => { harness.exitListener = listener; });
  return harness;
}

function readyInspection() {
  return {
    runtimes: [{
      descriptor: { id: "opencode", displayName: "OpenCode", kind: "harness" },
      readiness: {
        runtimeId: "opencode",
        provider: "opencode",
        status: "ready" as const,
        code: "READY" as const,
        version: "0.144.1",
        minimumVersion: "0.144.1",
        message: "OpenCode is ready.",
      },
    }],
    selectedRuntimeId: "opencode",
    runtime: { id: "opencode", displayName: "OpenCode", kind: "harness" },
    readiness: {
      runtimeId: "opencode",
      provider: "opencode",
      status: "ready" as const,
      code: "READY" as const,
      version: "0.144.1",
      minimumVersion: "0.144.1",
      message: "OpenCode is ready.",
    },
    account: { account: { type: "chatgpt" as const, email: null, planType: null }, requiresOpenaiAuth: true },
    providers: [{ id: "openai", displayName: "OpenAI", defaultModel: "openai/gpt-5", modelCount: 1 }],
    models: [{ id: "openai/gpt-5", model: "openai/gpt-5", providerId: "openai", displayName: "GPT-5", description: "OpenAI · GPT-5", isDefault: true }],
    capabilities: capabilities(),
    warnings: [],
  };
}

function snapshot(events: AgentEvent[]): AgentSessionSnapshot {
  return displaySnapshot({
    session: {
      id: "session-1",
      runtimeId: "opencode",
      runtime: { id: "opencode", displayName: "OpenCode", kind: "harness" },
      provider: "opencode",
      providerSessionId: "thread-1",
      workspaceRoot: "/workspace",
      title: "Session",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      terminalState: "idle",
      selectedModel: "openai/gpt-5",
      activeTurnId: null,
      lastSequence: events.at(-1)?.sequence ?? 1,
    },
    account: { account: { type: "chatgpt", email: null, planType: null }, requiresOpenaiAuth: true },
    providers: [{ id: "openai", displayName: "OpenAI", defaultModel: "openai/gpt-5", modelCount: 1 }],
    models: [{ id: "openai/gpt-5", model: "openai/gpt-5", providerId: "openai", displayName: "GPT-5", description: "OpenAI · GPT-5", isDefault: true }],
    capabilities: capabilities(),
    runtime: { id: "opencode", displayName: "OpenCode", kind: "harness" },
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
    usage: true,
    accountState: true,
    mcp: false,
    skills: false,
    compaction: false,
  };
}

function event<T extends AgentEvent["type"]>(
  sequence: number,
  type: T,
  payload: AgentEventPayloadMap[T] & Record<string, unknown>,
  turnId: string | null = null,
  itemId: string | null = null,
): AgentEvent<T> {
  return defineAgentEvent<T>({
    schemaVersion: 1,
    sequence,
    sessionId: "session-1",
    runtimeId: "opencode",
    provider: "opencode",
    providerSessionId: "thread-1",
    turnId,
    itemId,
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
