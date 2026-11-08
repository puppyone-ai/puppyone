import { describe, expect, it, vi } from "vitest";
import { createAgentProcessService } from "../../../../electron/main/item-hosts/agent-process-service.mjs";
import type { createUtilityHost } from "../../../../electron/main/item-hosts/utility-host.mjs";
import type { AgentEvent, AgentSessionSnapshot } from "../../../../src/features/desktop-agent/agentTypes";
import { AgentSessionController } from "../../../../src/features/desktop-agent/application/AgentSessionController";
import { bridgeFixture, capabilities, event, readiness, snapshot } from "../../../support/agent/agentSessionControllerFixture";

describe("AgentSessionController: a conversation's lifecycle", () => {
  it("retries the owned conversation through Main without allocating another host", async () => {
    const bridge = bridgeFixture(() => {});
    const saved = await bridge.createAgentSession({ rootPath: "/workspace" });
    const createHost = vi.fn((): ReturnType<typeof createUtilityHost> => ({ generation: "00000000-0000-0000-0000-000000000001", ready: Promise.resolve(), exit: Promise.resolve(), pid: 1, attachPort: vi.fn(), diagnostics: vi.fn<ReturnType<typeof createUtilityHost>["diagnostics"]>(), call: vi.fn(async () => saved), close: vi.fn(async () => {}), exited: false }));
    const service = createAgentProcessService({ utilityProcess: undefined, modulePath: undefined, budget: undefined, appVersion: undefined, createHost, catalogService: {}, conversationCatalog: {}, attachmentStore: {} });
    const sender = { id: 1, hostItemId: "chat-tab" };
    bridge.resumeAgentSession.mockImplementation(request => service.resumeSession(sender, request, "/workspace"));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      await controller.initialize(true);
      expect(controller.getSnapshot().error).toBeNull();
      expect(bridge.resumeAgentSession).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: saved.session.id }));
      expect(createHost).toHaveBeenCalledOnce();
      expect(controller.getSnapshot().session?.id).toBe(saved.session.id);
    } finally { controller.dispose(); await service.closeItem(sender.id, sender.hostItemId); }
  });

  it("preparation failure releases submission state and allows retry", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.resumeAgentSession.mockResolvedValueOnce(null);
    bridge.createAgentSession.mockRejectedValueOnce(new Error("cannot create"));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      controller.setDraft("retry this message");
      expect(await controller.submit("retry this message")).toBe(false);
      expect(controller.getSnapshot().draft).toBe("retry this message");
      expect(controller.getSnapshot().submitting).toBe(false);
      expect(await controller.submit("retry this message")).toBe(true);
    } finally { controller.dispose(); }
  });

  it("reports an unavailable owned conversation without silently creating another", async () => {
    const bridge = bridgeFixture(() => {});
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      bridge.resumeAgentSession.mockResolvedValueOnce(null);
      await controller.initialize(true);
      expect(controller.getSnapshot().sessionPreparation).toBe("failed");
      expect(controller.getSnapshot().error).not.toBeNull();
      expect(bridge.createAgentSession).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it("ignores receipts and new submissions after disposal", async () => {
    let emit: (event: AgentEvent) => void = () => {};
    const bridge = bridgeFixture(listener => { emit = listener; }, { steer: true });
    const receipt = Promise.withResolvers<{ sessionId: string; turnId: string; steered: boolean }>();
    bridge.steerAgentTurn.mockReturnValueOnce(receipt.promise);
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    emit(event(2, "turn.started", { prompt: "Running" }, "turn-running"));
    const pending = controller.submit("old instruction");
    controller.dispose();
    const disposedState = controller.getSnapshot();
    receipt.reject(new Error("late rejection"));
    expect(await pending).toBe(false);
    expect(await controller.submit("after dispose")).toBe(false);
    expect(controller.getSnapshot()).toBe(disposedState);
    expect(bridge.steerAgentTurn).toHaveBeenCalledOnce();
  });

  it("renders Main display revisions and preserves the old locator on New Chat", async () => {
    let eventListener: ((event: AgentEvent) => void) | undefined;
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

  it("allows confirmed tab closure even while the displayed turn is running", async () => {
    let eventListener: ((event: AgentEvent) => void) | undefined;
    const bridge = bridgeFixture((listener) => { eventListener = listener; });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    eventListener?.(event(2, "turn.started", { prompt: "Keep going" }, "turn-1"));

    await expect(controller.closeTabSession()).resolves.toBe(true);
    expect(bridge.closeAgentSession).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().error?.code).not.toBe("active-turn");
  });

  it("shares one background session preparation with the first submit and exposes truthful transport stages", async () => {
    let eventListener: ((event: AgentEvent) => void) | undefined;
    let resolveCreate: ((value: AgentSessionSnapshot) => void) | undefined;
    let resolveStart: ((value: { sessionId: string; turnId: string }) => void) | undefined;
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
    resolveStart?.({ sessionId: "session-1", turnId: "turn-first" });
    await expect(submission).resolves.toBe(true);
  });

  it("closes a prepared native session that resolves after renderer disposal", async () => {
    let resolveCreate: ((value: AgentSessionSnapshot) => void) | undefined;
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
    let resolveDiscovery: ((value: typeof inspection) => void) | undefined;
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
});
