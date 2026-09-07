import { withDisplayFeed, displaySnapshot } from "./helpers/agentDisplayFixture";
import { describe, expect, it, vi } from "vitest";
import {
  AgentSessionController,
  agentSessionControllerLimits,
} from "../src/features/desktop-agent/application/AgentSessionController";
import type { AgentEvent, AgentSessionSnapshot } from "../src/features/desktop-agent/agentTypes";

describe("AgentSessionController", () => {
  it("discovers installed Agents without selecting or resuming one on first open", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.discoverAgentRuntimes.mockResolvedValueOnce({
      runtimes: [
        { descriptor: { id: "codex", displayName: "Codex" }, readiness: readinessFor("codex") },
        { descriptor: { id: "claude", displayName: "Claude Agent" }, readiness: readinessFor("claude") },
      ],
      selectedRuntimeId: null,
      readiness: null,
      account: null,
      providers: [],
      models: [],
      modes: [],
      commands: [],
      capabilities: null,
      warnings: [],
    });
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await controller.initialize();

    expect(bridge.discoverAgentRuntimes).toHaveBeenCalledWith({
      rootPath: "/workspace",
      runtimeId: null,
      refresh: false,
    });
    expect(controller.getSnapshot()).toMatchObject({
      initialized: true,
      phase: "ready",
      selectedRuntimeId: null,
      selectedModel: null,
      session: null,
    });
    expect(bridge.resumeAgentSession).not.toHaveBeenCalled();
    expect(bridge.createAgentSession).not.toHaveBeenCalled();
  });

  it("binds a creation recipe before discovery without restoring prior Chat history", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.discoverAgentRuntimes.mockResolvedValueOnce({
      runtimes: [
        { descriptor: { id: "codex", displayName: "Codex", iconKey: "codex" }, readiness: readinessFor("codex") },
      ],
      selectedRuntimeId: "codex",
      runtime: { id: "codex", displayName: "Codex", iconKey: "codex" },
      readiness: readinessFor("codex"),
      account: null,
      providers: [],
      models: [],
      modes: [],
      commands: [],
      capabilities: capabilities(),
      warnings: [],
    });
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await expect(controller.initializeForRuntime("codex")).resolves.toBe(true);

    expect(bridge.discoverAgentRuntimes).toHaveBeenCalledWith({
      rootPath: "/workspace",
      runtimeId: "codex",
      refresh: false,
    });
    expect(controller.getSnapshot()).toMatchObject({
      initialized: true,
      phase: "ready",
      selectedRuntimeId: "codex",
      session: null,
    });
    expect(bridge.resumeAgentSession).not.toHaveBeenCalled();
    expect(bridge.createAgentSession).not.toHaveBeenCalled();
  });

  it("begins direct-recipe discovery without blocking Workbench admission", async () => {
    const bridge = bridgeFixture(() => {});
    const inspection = await bridge.discoverAgentRuntimes();
    bridge.discoverAgentRuntimes.mockClear();
    let resolveDiscovery: ((value: typeof inspection) => void) | null = null;
    bridge.discoverAgentRuntimes.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDiscovery = resolve;
    }));
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    controller.beginInitializeForRuntime("codex");

    expect(bridge.discoverAgentRuntimes).toHaveBeenCalledWith({
      rootPath: "/workspace",
      runtimeId: "codex",
      refresh: false,
    });
    expect(controller.getSnapshot()).toMatchObject({
      initialized: false,
      phase: "discovering",
      selectedRuntimeId: "codex",
      session: null,
    });

    resolveDiscovery?.({
      ...inspection,
      selectedRuntimeId: "codex",
      runtime: { id: "codex", displayName: "Codex", iconKey: "codex" },
      readiness: readinessFor("codex"),
    });
    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({
      initialized: true,
      phase: "ready",
      selectedRuntimeId: "codex",
    }));
    expect(bridge.resumeAgentSession).not.toHaveBeenCalled();
  });

  it("renders Main display revisions and preserves the old locator on New Chat", async () => {
    let eventListener: ((event: AgentEvent) => void) | null = null;
    const bridge = bridgeFixture((listener) => { eventListener = listener; });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    expect(controller.getSnapshot().selectedRuntimeId).toBe("opencode");
    expect(controller.getSnapshot().selectedProviderId).toBe("openai");
    await expect(controller.selectRuntime("codex")).resolves.toBe(false);

    eventListener?.(event(2, "turn.started", { prompt: "Fix it" }, "turn-1"));
    eventListener?.(event(3, "assistant.delta", { delta: "Working" }, "turn-1", "message-1"));
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(controller.getSnapshot().projection.messages.map((message) => message.text)).toEqual(["Fix it", "Working"]);

    eventListener?.(event(5, "turn.completed", { status: "completed" }, "turn-1"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.replayAgentSession).not.toHaveBeenCalled();
    expect(controller.getSnapshot().projection.lastSequence).toBe(5);
    expect(controller.getSnapshot().projection.terminalState).toBe("completed");

    controller.rememberViewport(320, { "row:assistant:message-1": 88 }, false);
    expect(controller.readViewport()).toEqual({
      draft: "",
      draftMentions: [],
      scrollTop: 320,
      measurements: { "row:assistant:message-1": 88 },
      pinned: false,
    });

    await controller.newSession();
    expect(bridge.closeAgentSession).toHaveBeenCalledWith({ rootPath: "/workspace", sessionId: "session-1", removePersistence: false });
    expect(controller.getSnapshot().session?.id).toBe("session-2");
  });

  it("closes a tab-owned native session without affecting another controller", async () => {
    const firstBridge = bridgeFixture(() => {});
    const secondBridge = bridgeFixture(() => {});
    const first = new AgentSessionController("/workspace", () => firstBridge as never);
    const second = new AgentSessionController("/workspace", () => secondBridge as never);
    await first.initialize();
    await second.initialize();

    await expect(first.closeTabSession()).resolves.toBe(true);
    expect(firstBridge.closeAgentSession).toHaveBeenCalledWith({
      rootPath: "/workspace",
      sessionId: "session-1",
      removePersistence: false,
    });
    expect(secondBridge.closeAgentSession).not.toHaveBeenCalled();
    expect(second.getSnapshot().session?.id).toBe("session-1");
  });

  it("opens an explicitly selected saved conversation instead of implicitly resuming the latest session", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.resumeAgentSession
      .mockResolvedValueOnce(snapshot("session-1", []));
    bridge.openAgentSession.mockResolvedValueOnce({ status: "opened", snapshot: snapshot("saved-session", [
        event(1, "turn.started", { prompt: "Past prompt" }, "past-turn", null, "saved-session"),
        event(2, "assistant.completed", { text: "Past answer" }, "past-turn", "past-answer", "saved-session"),
      ]) });
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await controller.initialize();
    await controller.openSavedSession("saved-session", "opencode");

    expect(bridge.openAgentSession).toHaveBeenCalledWith({
      rootPath: "/workspace",
      sessionId: "saved-session",
      runtimeId: "opencode",
    });
    expect(controller.getSnapshot().session?.id).toBe("saved-session");
    expect(controller.getSnapshot().projection.messages.map((message) => message.text))
      .toEqual(["Past prompt", "Past answer"]);
  });

  it("unconditionally closes a restored native session when Workbench preparation rolls back", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.openAgentSession.mockResolvedValueOnce({
      status: "opened",
      snapshot: snapshot("prepared-session", [
        event(1, "turn.started", { prompt: "Still running" }, "prepared-turn", null, "prepared-session"),
      ]),
    });
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await controller.openSavedSession("prepared-session", "opencode");
    expect(controller.getSnapshot().projection.runningTurnId).toBe("prepared-turn");

    await expect(controller.rollbackPreparation()).resolves.toBeUndefined();
    expect(bridge.closeAgentSession).toHaveBeenCalledWith({
      rootPath: "/workspace",
      sessionId: "prepared-session",
      removePersistence: false,
    });
  });

  it("preserves an exact History open error instead of collapsing it to false", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.openAgentSession.mockResolvedValueOnce({
      status: "failed",
      error: {
        code: "SESSION_NOT_FOUND",
        message: "This saved Agent session is no longer available.",
        retryable: false,
      },
    });
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await expect(controller.openSavedSession("stale-session", "opencode")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      retryable: false,
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      sessionPreparation: "failed",
      error: { detail: "This saved Agent session is no longer available." },
    });
  });

  it("refuses to close a tab while its turn is running", async () => {
    let eventListener: ((event: AgentEvent) => void) | null = null;
    const bridge = bridgeFixture((listener) => { eventListener = listener; });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    eventListener?.(event(2, "turn.started", { prompt: "Keep going" }, "turn-1"));

    await expect(controller.closeTabSession()).resolves.toBe(false);
    expect(bridge.closeAgentSession).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error?.code).toBe("active-turn");
  });

  it("selects the backend catalog's first model and derives any internal inference route from the model", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.discoverAgentRuntimes.mockResolvedValueOnce({
      runtimes: [{ descriptor: { id: "opencode", displayName: "OpenCode", priority: 100 }, readiness: readiness() }],
      selectedRuntimeId: "opencode",
      runtime: { id: "opencode", displayName: "OpenCode" },
      readiness: readiness(),
      account: { account: { type: "opencode", email: null, planType: null }, requiresOpenaiAuth: false },
      providers: [
        { id: "anthropic", displayName: "Anthropic", defaultModel: "anthropic/claude-sonnet", modelCount: 1 },
        { id: "openai", displayName: "OpenAI", defaultModel: "openai/gpt-5", modelCount: 1 },
      ],
      models: [
        { id: "anthropic/claude-sonnet", model: "anthropic/claude-sonnet", providerId: "anthropic", displayName: "Claude Sonnet", description: "Anthropic · Claude", isDefault: false, variants: ["low", "high"], defaultVariant: "high" },
        { id: "openai/gpt-5", model: "openai/gpt-5", providerId: "openai", displayName: "GPT-5", description: "OpenAI · GPT-5", isDefault: true, variants: ["low", "medium"], defaultVariant: "medium" },
      ],
      modes: [],
      commands: [],
      capabilities: capabilities(),
      warnings: [],
    });
    bridge.resumeAgentSession.mockResolvedValueOnce(null);
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await controller.initialize();

    expect(controller.getSnapshot()).toMatchObject({
      selectedProviderId: "anthropic",
      selectedModel: "anthropic/claude-sonnet",
      selectedEffort: "high",
    });
    const discoveryCalls = bridge.discoverAgentRuntimes.mock.calls.length;
    const resumeCalls = bridge.resumeAgentSession.mock.calls.length;
    controller.selectModel("openai/gpt-5");
    expect(controller.getSnapshot()).toMatchObject({
      selectedProviderId: "openai",
      selectedModel: "openai/gpt-5",
      selectedEffort: "medium",
    });
    controller.selectEffort("low");
    expect(controller.getSnapshot().selectedEffort).toBe("low");
    expect(bridge.discoverAgentRuntimes).toHaveBeenCalledTimes(discoveryCalls);
    expect(bridge.resumeAgentSession).toHaveBeenCalledTimes(resumeCalls);
    expect(bridge.createAgentSession).not.toHaveBeenCalled();
  });

  it("switches a blank composer between ready native Agents and supports providerless model catalogs", async () => {
    const bridge = bridgeFixture(() => {});
    const runtimes = [
      { descriptor: { id: "opencode", displayName: "PuppyOne Agent", iconKey: "puppyone-agent" }, readiness: readinessFor("opencode") },
      { descriptor: { id: "codex", displayName: "Codex", iconKey: "codex" }, readiness: readinessFor("codex") },
    ];
    bridge.discoverAgentRuntimes
      .mockResolvedValueOnce({
        runtimes,
        selectedRuntimeId: "opencode",
        runtime: runtimes[0].descriptor,
        readiness: readinessFor("opencode"),
        account: null,
        providers: [{ id: "openai", displayName: "OpenAI", defaultModel: "openai/gpt-5", modelCount: 1 }],
        models: [{ id: "openai/gpt-5", model: "openai/gpt-5", providerId: "openai", displayName: "GPT-5", description: "OpenAI · GPT-5", isDefault: true }],
        modes: [],
        commands: [],
        capabilities: capabilities(),
        warnings: [],
      })
      .mockResolvedValueOnce({
        runtimes,
        selectedRuntimeId: "codex",
        runtime: runtimes[1].descriptor,
        readiness: readinessFor("codex"),
        account: null,
        providers: [],
        models: [{ id: "gpt-5-codex", model: "gpt-5-codex", displayName: "GPT-5 Codex", description: "Native Codex model", isDefault: true }],
        modes: [],
        commands: [],
        capabilities: capabilities(),
        warnings: [],
      });
    bridge.resumeAgentSession.mockResolvedValue(null);
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await controller.initialize();
    expect(controller.getSnapshot()).toMatchObject({ session: null, selectedRuntimeId: "opencode" });

    await expect(controller.selectRuntime("codex")).resolves.toBe(true);
    expect(bridge.discoverAgentRuntimes).toHaveBeenLastCalledWith({ rootPath: "/workspace", runtimeId: "codex", refresh: false });
    expect(controller.getSnapshot()).toMatchObject({
      selectedRuntimeId: "codex",
      selectedProviderId: null,
      selectedModel: "gpt-5-codex",
    });
  });

  it("switches Coding Agent providers into a new chat without implicitly resuming native history", async () => {
    const bridge = bridgeFixture(() => {});
    const runtimes = [
      { descriptor: { id: "codex", displayName: "Codex", iconKey: "codex", distribution: "user-installed" }, readiness: readinessFor("codex") },
      { descriptor: { id: "claude", displayName: "Claude Code", iconKey: "claude", distribution: "sdk-bundled" }, readiness: readinessFor("claude") },
    ];
    const codexModel = { id: "gpt-5-codex", model: "gpt-5-codex", displayName: "GPT-5 Codex", description: "Native Codex model", isDefault: true };
    const claudeModel = { id: "claude-sonnet", model: "claude-sonnet", displayName: "Claude Sonnet", description: "Native Claude model", isDefault: true };
    bridge.discoverAgentRuntimes
      .mockResolvedValueOnce(runtimeInspection(runtimes, "codex", codexModel))
      .mockResolvedValueOnce(runtimeInspection(runtimes, "claude", claudeModel));
    bridge.resumeAgentSession
      .mockResolvedValueOnce(runtimeSnapshot("codex-session", "codex", "Codex", codexModel));
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await controller.initialize();
    expect(controller.getSnapshot()).toMatchObject({ selectedRuntimeId: "codex", selectedModel: "gpt-5-codex" });

    await controller.stageExternalFiles([new File(["png"], "before-switch.png", { type: "image/png" })]);
    const firstEpoch = bridge.stageAgentAttachments.mock.calls.at(-1)?.[0].epoch;

    await expect(controller.selectRuntime("claude")).resolves.toBe(true);
    expect(bridge.revokeAgentAttachments).toHaveBeenCalledWith({ rootPath: "/workspace", tokens: ["stage-token"] });
    expect(bridge.closeAgentSession).toHaveBeenCalledWith({
      rootPath: "/workspace",
      sessionId: "codex-session",
      removePersistence: false,
    });
    expect(bridge.discoverAgentRuntimes).toHaveBeenLastCalledWith({ rootPath: "/workspace", runtimeId: "claude", refresh: false });
    expect(controller.getSnapshot()).toMatchObject({
      selectedRuntimeId: "claude",
      selectedProviderId: null,
      selectedModel: "claude-sonnet",
      session: null,
    });
    expect(bridge.resumeAgentSession).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().references).toEqual([]);
    await controller.stageExternalFiles([new File(["png"], "after-switch.png", { type: "image/png" })]);
    expect(bridge.stageAgentAttachments.mock.calls.at(-1)?.[0].epoch).not.toBe(firstEpoch);
  });

  it("selects a detected runtime while keeping execution gated by its readiness", async () => {
    const bridge = bridgeFixture(() => {});
    const ready = { descriptor: { id: "codex", displayName: "Codex", iconKey: "codex" }, readiness: readinessFor("codex") };
    const unavailable = {
      descriptor: { id: "cursor", displayName: "Cursor Agent", iconKey: "cursor" },
      readiness: {
        runtimeId: "cursor",
        provider: "cursor",
        status: "protocol-unavailable" as const,
        version: "1.0.0",
        minimumVersion: null,
        message: "Native protocol unavailable",
        selectable: false,
      },
    };
    bridge.discoverAgentRuntimes
      .mockResolvedValueOnce({
        runtimes: [ready, unavailable],
        selectedRuntimeId: "codex",
        runtime: ready.descriptor,
        readiness: ready.readiness,
        account: null,
        providers: [],
        models: [{ id: "gpt-5", model: "gpt-5", displayName: "GPT-5", description: "", isDefault: true }],
        modes: [], commands: [], capabilities: capabilities(), warnings: [],
      })
      .mockResolvedValueOnce({
        runtimes: [ready, unavailable],
        selectedRuntimeId: "cursor",
        runtime: unavailable.descriptor,
        readiness: unavailable.readiness,
        account: null,
        providers: [], models: [], modes: [], commands: [], capabilities: capabilities(), warnings: [],
      });
    bridge.resumeAgentSession.mockResolvedValue(null);
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await controller.initialize();
    await expect(controller.selectRuntime("cursor")).resolves.toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      selectedRuntimeId: "cursor",
      phase: "ready",
      inspection: { readiness: { status: "protocol-unavailable" } },
    });
    expect(bridge.resumeAgentSession).toHaveBeenCalledTimes(1);
  });

  it("displays provider diagnostics without rewriting the discovered provider catalog", async () => {
    let eventListener: ((event: AgentEvent) => void) | null = null;
    const bridge = bridgeFixture((listener) => { eventListener = listener; });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();

    eventListener?.(event(2, "turn.started", { prompt: "Hello" }, "turn-auth"));
    eventListener?.(event(3, "provider.error", { message: "API key not valid. Please pass a valid API key." }, "turn-auth", "assistant-auth"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(controller.getSnapshot()).toMatchObject({ selectedProviderId: "openai", selectedModel: "openai/gpt-5" });
    expect(controller.getSnapshot().projection.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "error" }),
    ]));
  });

  it("reuses workspace Agent discovery on presentation remounts and lets Refresh bypass the cache", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.resumeAgentSession.mockResolvedValue(null);
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await controller.initialize();
    await controller.initialize();
    expect(bridge.discoverAgentRuntimes).toHaveBeenCalledTimes(1);

    await controller.initialize(true);
    expect(bridge.discoverAgentRuntimes).toHaveBeenCalledTimes(2);
    expect(bridge.discoverAgentRuntimes).toHaveBeenLastCalledWith({
      rootPath: "/workspace",
      runtimeId: "opencode",
      refresh: true,
    });
    expect(agentSessionControllerLimits.discoveryCacheTtlMs).toBe(5 * 60_000);
  });

  it("discovers local tools only when the Provider surface requests them", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.discoverLocalAgentConnections = vi.fn(async () => ({
      connections: [{
        id: "codex",
        displayName: "Codex CLI",
        installation: "detected",
        version: "0.144.1",
        authentication: "signed-in",
        integration: "bridge-required",
        capabilities: { versionProbe: true, authenticationProbe: true, protocolProbe: true },
        selectable: false,
        statusMessage: "Direct Codex sessions are not enabled.",
        actions: [{ id: "refresh", label: "Refresh" }],
        source: "user-installation",
      }],
      scannedAt: "2026-07-12T00:00:00.000Z",
      warnings: [],
    }));
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await controller.initialize();
    expect(bridge.discoverLocalAgentConnections).not.toHaveBeenCalled();

    await controller.discoverLocalConnections();
    expect(bridge.discoverLocalAgentConnections).toHaveBeenCalledWith({ rootPath: "/workspace", refresh: false });
    expect(controller.getSnapshot()).toMatchObject({
      localConnectionsPhase: "ready",
      localConnectionsScannedAt: "2026-07-12T00:00:00.000Z",
      localConnections: [expect.objectContaining({ id: "codex", selectable: false })],
    });

    await controller.discoverLocalConnections(true);
    expect(bridge.discoverLocalAgentConnections).toHaveBeenLastCalledWith({ rootPath: "/workspace", refresh: true });
  });

  it("delegates queue admission to the Main command transaction", async () => {
    let eventListener: ((event: AgentEvent) => void) | null = null;
    const bridge = bridgeFixture((listener) => { eventListener = listener; }, { queue: true });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    eventListener?.(event(2, "turn.started", { prompt: "Long task" }, "turn-queue"));
    await new Promise((resolve) => setTimeout(resolve, 45));

    await expect(controller.submit("Follow-up")).resolves.toBe(true);
    expect(bridge.startAgentTurn).toHaveBeenCalledOnce();
    expect(bridge.startAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Follow-up",
      commandId: expect.stringMatching(/^intent-/),
    }));
  });

  it("hands the local preview to Main's admitted input before the native start receipt", async () => {
    let eventListener: ((event: AgentEvent) => void) | null = null;
    let acceptTurn: ((value: { turnId: string }) => void) | null = null;
    const bridge = bridgeFixture((listener) => { eventListener = listener; });
    bridge.startAgentTurn.mockImplementationOnce(() => new Promise((resolve) => { acceptTurn = resolve; }));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    controller.setDraft("Explain the architecture");

    const submission = controller.submit("Explain the architecture");

    expect(controller.getSnapshot()).toMatchObject({
      draft: "",
      pendingPrompt: null,
      submitting: true,
      projection: { messages: [expect.objectContaining({text:"Explain the architecture",deliveryStatus:"dispatching"})] },
    });
    eventListener?.(event(2, "turn.started", { prompt: "Explain the architecture" }, "turn-live"));
    expect(controller.getSnapshot()).toMatchObject({
      pendingPrompt: null,
      projection: { runningTurnId: "turn-live" },
    });
    acceptTurn?.({ turnId: "turn-live" });
    await expect(submission).resolves.toBe(true);
    expect(controller.getSnapshot().submitting).toBe(false);
  });

  it("captures reference mention ranges in the immutable submission intent", async () => {
    const bridge = bridgeFixture(() => {});
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    await controller.addWorkspacePaths(["architecture.md"]);
    const reference = controller.getSnapshot().references[0]!;
    const prompt = "Explain @architecture.md";
    controller.setDraftDocument(prompt, [{ referenceId: reference.id, start: 8, end: 24 }]);

    await expect(controller.submit(prompt)).resolves.toBe(true);

    expect(bridge.startAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt,
      promptMentions: [{ referenceId: reference.id, start: 8, end: 24 }],
      references: [expect.objectContaining({ id: reference.id })],
    }));
    expect(controller.getSnapshot()).toMatchObject({ draft: "", draftMentions: [] });
  });

  it("shares one background session preparation with the first submit and exposes truthful transport stages", async () => {
    let eventListener: ((event: AgentEvent) => void) | null = null;
    let resolveCreate: ((value: AgentSessionSnapshot) => void) | null = null;
    let resolveStart: ((value: { turnId: string }) => void) | null = null;
    const bridge = bridgeFixture((listener) => { eventListener = listener; });
    bridge.resumeAgentSession.mockResolvedValueOnce(null);
    bridge.createAgentSession.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    bridge.startAgentTurn.mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve; }));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();

    const preparation = controller.prepareSession();
    const duplicatePreparation = controller.prepareSession();
    const submission = controller.submit("Inspect the first-turn path");
    await vi.waitFor(() => expect(controller.getSnapshot().sessionPreparation).toBe("preparing"));

    expect(bridge.createAgentSession).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      session: null,
      sessionPreparation: "preparing",
      pendingPrompt: "Inspect the first-turn path",
    });

    resolveCreate?.(snapshot("session-2", [event(1, "session.started", { title: "New" }, null, null, "session-2")]));
    await Promise.all([preparation, duplicatePreparation]);
    await Promise.resolve();
    expect(bridge.startAgentTurn).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      session: { id: "session-2" },
      sessionPreparation: "ready",
      pendingPrompt: null,
      projection: { messages: [expect.objectContaining({text:"Inspect the first-turn path",deliveryStatus:"dispatching"})] },
    });

    eventListener?.(event(2, "turn.started", { prompt: "Inspect the first-turn path" }, "turn-first", null, "session-2"));
    expect(controller.getSnapshot()).toMatchObject({
      pendingPrompt: null,
      projection: { runningTurnId: "turn-first" },
    });
    resolveStart?.({ turnId: "turn-first" });
    await expect(submission).resolves.toBe(true);
  });

  it("closes a prepared native session that resolves after renderer disposal", async () => {
    let resolveCreate: ((value: AgentSessionSnapshot) => void) | null = null;
    const bridge = bridgeFixture(() => {});
    bridge.resumeAgentSession.mockResolvedValueOnce(null);
    bridge.createAgentSession.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();

    const preparation = controller.prepareSession();
    await vi.waitFor(() => expect(controller.getSnapshot().sessionPreparation).toBe("preparing"));
    controller.dispose();
    resolveCreate?.(snapshot("session-stale", []));

    await expect(preparation).resolves.toBe(false);
    expect(bridge.closeAgentSession).toHaveBeenCalledWith({
      rootPath: "/workspace",
      sessionId: "session-stale",
      removePersistence: true,
    });
  });

  it("lets capability controls supersede an in-flight prewarm and closes the stale native session", async () => {
    const bridge = bridgeFixture(() => {});
    const models = [
      { id: "openai/gpt-5", model: "openai/gpt-5", providerId: "openai", displayName: "GPT-5", description: "", isDefault: true },
      { id: "openai/gpt-5-mini", model: "openai/gpt-5-mini", providerId: "openai", displayName: "GPT-5 Mini", description: "", isDefault: false },
    ];
    bridge.discoverAgentRuntimes.mockResolvedValueOnce({
      runtimes: [{ descriptor: { id: "opencode", displayName: "OpenCode" }, readiness: readiness() }],
      selectedRuntimeId: "opencode",
      runtime: { id: "opencode", displayName: "OpenCode" },
      readiness: readiness(),
      account: null,
      providers: [{ id: "openai", displayName: "OpenAI", defaultModel: "openai/gpt-5", modelCount: 2 }],
      models,
      modes: [
        { id: "build", displayName: "Build", description: "", isDefault: true },
        { id: "plan", displayName: "Plan", description: "", isDefault: false },
      ],
      commands: [],
      capabilities: capabilities(),
      warnings: [],
    });
    bridge.resumeAgentSession.mockResolvedValueOnce(null);
    const resolvers: Array<(value: AgentSessionSnapshot) => void> = [];
    bridge.createAgentSession.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();

    const firstPreparation = controller.prepareSession();
    await vi.waitFor(() => expect(controller.getSnapshot().sessionPreparation).toBe("preparing"));
    controller.selectModel("openai/gpt-5-mini");
    controller.selectMode("plan");
    expect(controller.getSnapshot()).toMatchObject({
      selectedModel: "openai/gpt-5-mini",
      selectedMode: "plan",
      sessionPreparation: "idle",
    });

    resolvers[0](snapshot("session-stale", []));
    await expect(firstPreparation).resolves.toBe(false);
    await vi.waitFor(() => expect(bridge.createAgentSession).toHaveBeenCalledTimes(2));
    expect(bridge.closeAgentSession).toHaveBeenCalledWith({
      rootPath: "/workspace",
      sessionId: "session-stale",
      removePersistence: true,
    });
    const latest = snapshot("session-latest", []);
    latest.models = models;
    latest.modes = [
      { id: "build", displayName: "Build", description: "", isDefault: true },
      { id: "plan", displayName: "Plan", description: "", isDefault: false },
    ];
    latest.session.selectedModel = "openai/gpt-5-mini";
    latest.session.selectedMode = "plan";
    resolvers[1](latest);

    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({
      session: { id: "session-latest" },
      selectedModel: "openai/gpt-5-mini",
      selectedMode: "plan",
      sessionPreparation: "ready",
    }));
    expect(bridge.createAgentSession.mock.calls[1][0]).toMatchObject({
      model: "openai/gpt-5-mini",
      mode: "plan",
    });
  });

  it("does not publish late asynchronous state after renderer disposal", async () => {
    const bridge = bridgeFixture(() => {});
    const inspection = await bridge.discoverAgentRuntimes();
    let resolveDiscovery: ((value: typeof inspection) => void) | null = null;
    bridge.discoverAgentRuntimes.mockImplementationOnce(() => new Promise((resolve) => { resolveDiscovery = resolve; }));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    const listener = vi.fn();
    controller.subscribe(listener);

    const initialize = controller.initialize();
    expect(listener).toHaveBeenCalledTimes(1);
    controller.dispose();
    resolveDiscovery?.(inspection);
    await initialize;

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("captures references inside the immutable command sent to Main", async () => {
    let eventListener: ((event: AgentEvent) => void) | null = null;
    const bridge = bridgeFixture((listener) => { eventListener = listener; }, { queue: true });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    eventListener?.(event(2, "turn.started", { prompt: "Long task" }, "turn-running"));
    await new Promise((resolve) => setTimeout(resolve, 45));

    await controller.addWorkspacePaths(["a.md"]);
    await expect(controller.submit("First queued")).resolves.toBe(true);
    expect(controller.getSnapshot().references).toEqual([]);
    expect(bridge.startAgentTurn.mock.calls[0][0]).toMatchObject({
      prompt: "First queued",
      references: [expect.objectContaining({ relativePath: "a.md" })],
    });
  });

  it("restores a rejected Main queue command without stranding its draft", async () => {
    let eventListener: ((event: AgentEvent) => void) | null = null;
    const bridge = bridgeFixture((listener) => { eventListener = listener; }, { queue: true });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    eventListener?.(event(2, "turn.started", { prompt: "Long task" }, "turn-running"));
    await new Promise((resolve) => setTimeout(resolve, 45));
    await controller.addWorkspacePaths(["queued.md"]);
    let rejectStart: ((error: Error) => void) | null = null;
    bridge.startAgentTurn.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStart = reject; }));
    const submission = controller.submit("Queued request");
    await vi.waitFor(() => expect(bridge.startAgentTurn).toHaveBeenCalledTimes(1));
    controller.setDraft("New draft");
    rejectStart?.(new Error("queued native start failed"));
    await expect(submission).resolves.toBe(false);
    await vi.waitFor(() => expect(controller.getSnapshot().pendingIntent).toBeNull());
    expect(controller.getSnapshot()).toMatchObject({
      draft: "Queued request\n\nNew draft",
      references: [expect.objectContaining({ relativePath: "queued.md" })],
    });
  });

  it("retains references when steer cannot carry them and restores the same intent after preparation failure", async () => {
    let eventListener: ((event: AgentEvent) => void) | null = null;
    const bridge = bridgeFixture((listener) => { eventListener = listener; }, {
      steer: true,
      referenceInputs: { ...referenceCapabilities(), steer: false },
    });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    eventListener?.(event(2, "turn.started", { prompt: "Running" }, "turn-running"));
    await new Promise((resolve) => setTimeout(resolve, 45));
    await controller.addWorkspacePaths(["keep.md"]);
    await expect(controller.submit("Do not lose this")).resolves.toBe(false);
    expect(bridge.steerAgentTurn).not.toHaveBeenCalled();
    expect(controller.getSnapshot().references).toEqual([expect.objectContaining({ relativePath: "keep.md" })]);

    const failedBridge = bridgeFixture(() => {});
    failedBridge.resumeAgentSession.mockResolvedValueOnce(null);
    failedBridge.createAgentSession.mockRejectedValueOnce(new Error("cannot create"));
    const failed = new AgentSessionController("/workspace", () => failedBridge as never);
    await failed.initialize();
    await failed.addWorkspacePaths(["restore.md"]);
    const restoreReference = failed.getSnapshot().references[0]!;
    const retryPrompt = "Retry with @restore.md";
    failed.setDraftDocument(retryPrompt, [{ referenceId: restoreReference.id, start: 11, end: 22 }]);
    await expect(failed.submit(retryPrompt)).resolves.toBe(false);
    expect(failed.getSnapshot()).toMatchObject({
      draft: retryPrompt,
      draftMentions: [{ referenceId: restoreReference.id, start: 11, end: 22 }],
      pendingIntent: null,
      references: [expect.objectContaining({ relativePath: "restore.md" })],
    });
    expect(failedBridge.startAgentTurn).not.toHaveBeenCalled();
  });

  it("merges a failed immutable intent with edits and references added while session preparation is pending", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.resumeAgentSession.mockResolvedValueOnce(null);
    let rejectPreparation: ((error: Error) => void) | null = null;
    bridge.createAgentSession.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectPreparation = reject;
    }));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    await controller.addWorkspacePaths(["original.md"]);

    const submission = controller.submit("Original request");
    await vi.waitFor(() => expect(controller.getSnapshot().pendingIntent).not.toBeNull());
    controller.setDraft("New edit while waiting");
    await controller.addWorkspacePaths(["new.md"]);
    rejectPreparation?.(new Error("cannot prepare"));

    await expect(submission).resolves.toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      draft: "Original request\n\nNew edit while waiting",
      pendingIntent: null,
      references: [
        expect.objectContaining({ relativePath: "original.md" }),
        expect.objectContaining({ relativePath: "new.md" }),
      ],
    });
  });

  it("revokes staged grants on removal and keeps external paths outside renderer state", async () => {
    const bridge = bridgeFixture(() => {});
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    const file = new File(["png"], "capture.png", { type: "image/png" });
    await expect(controller.stageExternalFiles([file])).resolves.toBe(1);
    const [reference] = controller.getSnapshot().references;
    expect(reference).toMatchObject({ kind: "staged-attachment", displayName: "capture.png", status: "ready" });
    expect(reference).not.toHaveProperty("path");
    await expect(controller.stageExternalFiles([file])).resolves.toBe(0);
    expect(controller.getSnapshot().references).toHaveLength(1);
    controller.removeReference(reference.id);
    await vi.waitFor(() => expect(bridge.revokeAgentAttachments).toHaveBeenCalledWith({
      rootPath: "/workspace",
      tokens: ["stage-token"],
    }));
  });

  it("keeps image previews renderer-local and revokes their object URLs on removal", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:agent-image-preview");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const bridge = bridgeFixture(() => {});
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();

    await expect(controller.stageExternalFiles([
      new File(["png"], "capture.png", { type: "image/png" }),
    ])).resolves.toBe(1);
    const [reference] = controller.getSnapshot().references;
    expect(controller.getReferencePreviewUrl(reference.id)).toBe("blob:agent-image-preview");
    expect(reference).not.toHaveProperty("previewUrl");

    controller.removeReference(reference.id);
    expect(controller.getReferencePreviewUrl(reference.id)).toBeNull();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:agent-image-preview");
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it("keeps valid entries from a partial external-file batch and exposes retryable errors for the rest", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.stageAgentAttachments
      .mockResolvedValueOnce([{
        id: "valid-image",
        kind: "staged-attachment",
        token: "valid-token",
        displayName: "valid.png",
        mime: "image/png",
        size: 3,
        status: "ready",
      }])
      .mockRejectedValueOnce(new Error("Only regular files can be attached."));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    await expect(controller.stageExternalFiles([
      new File(["png"], "valid.png", { type: "image/png" }),
      new File(["bad"], "folder", { type: "application/octet-stream" }),
    ])).resolves.toBe(1);
    expect(controller.getSnapshot().references).toEqual([
      expect.objectContaining({ id: "valid-image", status: "ready" }),
      expect.objectContaining({ displayName: "folder", status: "error" }),
    ]);
  });

  it("removes Electron IPC transport boilerplate from reference diagnostics", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.resolveAgentWorkspaceReferences.mockRejectedValueOnce(new Error(
      "Error invoking remote method 'agent:reference-resolve-workspace': Error: An Agent file reference no longer exists.",
    ));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();

    await expect(controller.addWorkspacePaths(["missing.md"])).resolves.toBe(0);
    expect(controller.getSnapshot().references).toEqual([
      expect.objectContaining({
        displayName: "missing.md",
        status: "error",
        error: {
          code: "workspace-resolution-failed",
          message: "An Agent file reference no longer exists.",
        },
      }),
    ]);
  });
});

function bridgeFixture(
  onEvent: (listener: (event: AgentEvent) => void) => void,
  capabilityOverrides: Partial<ReturnType<typeof capabilities>> = {},
) {
  return withDisplayFeed({
    discoverAgentRuntimes: vi.fn(async () => ({
      runtimes: [{ descriptor: { id: "opencode", displayName: "OpenCode", priority: 100 }, readiness: readiness() }],
      selectedRuntimeId: "opencode",
      runtime: { id: "opencode", displayName: "OpenCode" },
      readiness: readiness(),
      account: { account: { type: "opencode", email: null, planType: null }, requiresOpenaiAuth: false },
      providers: [{ id: "openai", displayName: "OpenAI", defaultModel: "openai/gpt-5", modelCount: 1 }],
      models: [{ id: "openai/gpt-5", model: "openai/gpt-5", providerId: "openai", displayName: "GPT-5", description: "OpenAI · GPT-5", isDefault: true }],
      modes: [{ id: "build", displayName: "Build", description: "", isDefault: true }],
      commands: [],
      capabilities: capabilities(capabilityOverrides),
      warnings: [],
    })),
    discoverLocalAgentConnections: vi.fn(async () => ({ connections: [], scannedAt: "2026-07-12T00:00:00.000Z", warnings: [] })),
    resumeAgentSession: vi.fn(async () => snapshot("session-1", [event(1, "session.resumed", { title: "Session" })], capabilityOverrides)),
    openAgentSession: vi.fn(async () => ({
      status: "opened" as const,
      snapshot: snapshot("session-1", [event(1, "session.resumed", { title: "Session" })], capabilityOverrides),
    })),
    createAgentSession: vi.fn(async () => snapshot("session-2", [event(1, "session.started", { title: "New" }, null, null, "session-2")], capabilityOverrides)),
    startAgentTurn: vi.fn(async () => ({ turnId: "turn-next" })),
    replayAgentSession: vi.fn(async () => snapshot("session-1", [event(4, "assistant.completed", { text: "Working" }, "turn-1", "message-1")], capabilityOverrides)),
    closeAgentSession: vi.fn(async () => ({ sessionId: "session-1", closed: true })),
    stageAgentAttachments: vi.fn(async () => [{
      id: "stage-reference",
      kind: "staged-attachment",
      token: "stage-token",
      displayName: "capture.png",
      mime: "image/png",
      size: 3,
      status: "ready",
    }]),
    revokeAgentAttachments: vi.fn(async ({ tokens }: { tokens: string[] }) => ({ revoked: tokens.length })),
    resolveAgentWorkspaceReferences: vi.fn(async ({ paths }: { paths: string[] }) => paths.map((referencePath, index) => ({
      id: `workspace-${index}-${referencePath.replace(/[^A-Za-z0-9]/g, "-")}`,
      kind: "workspace-entry",
      entryType: referencePath === "src" ? "directory" : "file",
      relativePath: referencePath,
      displayName: referencePath.split("/").at(-1) || referencePath,
      mime: "text/markdown",
      size: 4,
      status: "ready",
    }))),
    pickAgentWorkspaceReferences: vi.fn(async () => []),
    steerAgentTurn: vi.fn(async () => ({ sessionId: "session-1", turnId: "turn-running", steered: true })),
    listAgentSessions: vi.fn(async () => ({
      sessions: [],
      discovery: {
        runtimeId: null,
        status: "not-requested" as const,
        nextCursor: null,
        scanId: null,
        indexed: 0,
        warnings: [],
      },
      warnings: [],
    })),
  }, onEvent);
}

function snapshot(
  sessionId: string,
  events: AgentEvent[],
  capabilityOverrides: Partial<ReturnType<typeof capabilities>> = {},
): AgentSessionSnapshot {
  return {
    session: {
      id: sessionId,
      runtimeId: "opencode",
      runtime: { id: "opencode", displayName: "OpenCode" },
      provider: "opencode",
      providerSessionId: `native-${sessionId}`,
      workspaceRoot: "/workspace",
      title: "Session",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      terminalState: "idle",
      selectedModel: "openai/gpt-5",
      selectedMode: "build",
      activeTurnId: null,
      lastSequence: events.at(-1)?.sequence ?? 0,
    },
    account: { account: { type: "opencode", email: null, planType: null }, requiresOpenaiAuth: false },
    providers: [{ id: "openai", displayName: "OpenAI", defaultModel: "openai/gpt-5", modelCount: 1 }],
    models: [{ id: "openai/gpt-5", model: "openai/gpt-5", providerId: "openai", displayName: "GPT-5", description: "OpenAI · GPT-5", isDefault: true }],
    modes: [{ id: "build", displayName: "Build", description: "", isDefault: true }],
    commands: [],
    capabilities: capabilities(capabilityOverrides),
    events,
    partial: false,
    firstAvailableSequence: events[0]?.sequence ?? 1,
    lastSequence: events.at(-1)?.sequence ?? 0,
  };
}

function readiness() {
  return { runtimeId: "opencode", provider: "opencode", status: "ready" as const, version: "1.17.18", minimumVersion: "1.17.18", message: "ready" };
}

function readinessFor(runtimeId: string) {
  return { runtimeId, provider: runtimeId, status: "ready" as const, version: "1.0.0", minimumVersion: null, message: "ready", selectable: true };
}

function runtimeInspection(
  runtimes: Array<{ descriptor: { id: string; displayName: string; iconKey: string; distribution: string }; readiness: ReturnType<typeof readinessFor> }>,
  runtimeId: string,
  model: { id: string; model: string; displayName: string; description: string; isDefault: boolean },
) {
  const runtime = runtimes.find((entry) => entry.descriptor.id === runtimeId)!.descriptor;
  return {
    runtimes,
    selectedRuntimeId: runtimeId,
    runtime,
    readiness: readinessFor(runtimeId),
    account: null,
    providers: [],
    models: [model],
    modes: [],
    commands: [],
    capabilities: capabilities(),
    warnings: [],
  };
}

function runtimeSnapshot(
  sessionId: string,
  runtimeId: string,
  displayName: string,
  model: { id: string; model: string; displayName: string; description: string; isDefault: boolean },
): AgentSessionSnapshot {
  const base = snapshot(sessionId, []);
  const runtime = { id: runtimeId, displayName };
  return {
    ...base,
    session: {
      ...base.session,
      runtimeId,
      runtime,
      provider: runtimeId,
      selectedModel: model.model,
    },
    runtime,
    account: null,
    providers: [],
    models: [model],
    modes: [],
  };
}

function capabilities(overrides: Record<string, unknown> = {}) {
  return { streamingText: true, structuredToolEvents: true, commandOutputStreaming: true, fileChangeEvents: true, manualApprovals: true, structuredQuestions: true, resume: true, fork: true, steer: false, queue: false, attachments: true, contextReferences: true, modelSelection: true, modeSelection: true, slashCommands: true, sessionHistory: true, usage: true, accountState: true, mcp: true, skills: true, compaction: true, referenceInputs: referenceCapabilities(), ...overrides };
}

function referenceCapabilities() {
  return {
    schemaVersion: 1 as const,
    workspace: { files: true, directories: true },
    attachments: {
      image: { accepted: true, mimeTypes: ["image/png"] },
      text: { accepted: false },
      audio: { accepted: false },
      video: { accepted: false },
      binary: { accepted: false },
    },
    limits: {
      maxCount: 32,
      maxBytesPerReference: 25 * 1024 * 1024,
      maxTotalBytes: 25 * 1024 * 1024,
    },
    steer: false,
    attachmentOnly: false,
  };
}

function event(sequence: number, type: AgentEvent["type"], payload: Record<string, unknown>, turnId: string | null = null, itemId: string | null = null, sessionId = "session-1"): AgentEvent {
  return { schemaVersion: 1, sequence, sessionId, runtimeId: "opencode", provider: "opencode", providerSessionId: "native-1", turnId, itemId, emittedAt: new Date(sequence * 1_000).toISOString(), type, payload };
}
