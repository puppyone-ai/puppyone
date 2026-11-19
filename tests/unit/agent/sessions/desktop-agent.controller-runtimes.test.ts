import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../../../src/features/desktop-agent/agentTypes";
import { AgentSessionController, agentSessionControllerLimits } from "../../../../src/features/desktop-agent/application/AgentSessionController";
import { bridgeFixture, capabilities, event, readiness, readinessFor, runtimeInspection, runtimeSnapshot, snapshot } from "../../../support/agent/agentSessionControllerFixture";

describe("AgentSessionController: Agents, models and runtimes", () => {
  it("recovers the bound model after a temporary empty catalog without authorizing new models", async () => {
    const bridge = bridgeFixture(() => {}, { modelConnections: true });
    const available = await bridge.discoverAgentRuntimes();
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      controller.setDraft("Keep this draft through the wallet refresh");
      const session = controller.getSnapshot().session;
      bridge.resumeAgentSession.mockClear();
      bridge.discoverAgentRuntimes.mockResolvedValueOnce({ ...available, models: [] });
      await controller.refreshModelConnections();
      expect(controller.getSnapshot().inspection?.models).toEqual([]);
      expect(controller.getSnapshot().selectedModel).toBe("openai/gpt-5");
      const added = { ...available.models[0], id: "openai/new-model", model: "openai/new-model" };
      bridge.discoverAgentRuntimes.mockResolvedValueOnce({ ...available, models: [...available.models, added] });
      await controller.refreshModelConnections();
      expect(controller.getSnapshot().inspection?.models).toEqual(available.models);
      expect(controller.getSnapshot().session).toEqual(session);
      expect(controller.getSnapshot().draft).toBe("Keep this draft through the wallet refresh");
      expect(bridge.resumeAgentSession).not.toHaveBeenCalled();
      expect(await controller.submit(controller.getSnapshot().draft)).toBe(true);
      expect(bridge.startAgentTurn).toHaveBeenCalledOnce();
    } finally { controller.dispose(); }
  });

  it("updates model inspection without forcing executable discovery or replacing the session", async () => {
    const bridge = bridgeFixture(() => {}, { modelConnections: true });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      const session = controller.getSnapshot().session;
      bridge.resumeAgentSession.mockClear();
      await controller.refreshModelConnections();
      expect(bridge.discoverAgentRuntimes).toHaveBeenLastCalledWith({
        rootPath: "/workspace", runtimeId: controller.getSnapshot().selectedRuntimeId, refresh: false,
      });
      expect(controller.getSnapshot().session).toEqual(session);
      expect(bridge.resumeAgentSession).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it("requires a fresh conversation for a model connection change and clears old drafts", async () => {
    const bridge = bridgeFixture(() => {}, { modelConnections: true });
    const first = snapshot("session-1", [], { modelConnections: true });
    const secondModel = { id: "local/test", model: "local/test", connectionId: "local", providerId: "local", displayName: "Local test", description: "", isDefault: false };
    first.models.push(secondModel);
    bridge.resumeAgentSession.mockResolvedValueOnce(first);
    const next = snapshot("session-2", [], { modelConnections: true });
    next.session.selectedModel = secondModel.model; next.models = first.models;
    bridge.createAgentSession.mockResolvedValueOnce(next);
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize(); controller.setDraft("private old draft");
      expect(controller.requiresNewModelConnectionSession(secondModel.model)).toBe(true);
      controller.selectModel(secondModel.model);
      expect(controller.getSnapshot().selectedModel).toBe("openai/gpt-5");
      await controller.startNewModelConnection(secondModel.model);
      expect(bridge.closeAgentSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1", removePersistence: false }));
      expect(bridge.createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ model: secondModel.model }));
      expect(controller.getSnapshot()).toMatchObject({ draft: "", references: [], selectedModel: secondModel.model, submitting: false });
      expect(bridge.startAgentTurn).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it("preserves an unavailable model route instead of choosing a different connection", async () => {
    const bridge = bridgeFixture(() => {}, { modelConnections: true });
    const saved = snapshot("session-1", [], { modelConnections: true });
    saved.session.selectedModel = "deleted/model";
    bridge.resumeAgentSession.mockResolvedValueOnce(saved);
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      expect(controller.getSnapshot().selectedModel).toBe("deleted/model");
    } finally { controller.dispose(); }
  });

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
    let resolveDiscovery: ((value: typeof inspection) => void) | undefined;
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
      { descriptor: { id: "opencode", displayName: "Built-in Agent", iconKey: "built-in-agent" }, readiness: readinessFor("opencode") },
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
        status: "protocol-unavailable" as const, code: "PROTOCOL_UNAVAILABLE" as const,
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
    let eventListener: ((event: AgentEvent) => void) | undefined;
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
});
