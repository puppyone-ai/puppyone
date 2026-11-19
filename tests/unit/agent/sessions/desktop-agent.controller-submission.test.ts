import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../../../src/features/desktop-agent/agentTypes";
import type { AgentClientPort } from "../../../../src/features/desktop-agent/application/AgentClientPort";
import { AgentSessionController } from "../../../../src/features/desktop-agent/application/AgentSessionController";
import { bridgeFixture, event, referenceCapabilities } from "../../../support/agent/agentSessionControllerFixture";

describe("AgentSessionController: sending, steering and stopping", () => {
  it("steer receipt must preserve a newer draft", async () => {
    let emit: any;
    const bridge = bridgeFixture(listener => { emit = listener; }, { steer: true });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      emit(event(2, "turn.started", { prompt: "Running" }, "turn-running"));
      expect(controller.getSnapshot().projection.runningTurnId).toBe("turn-running");
      let resolveSteer: any;
      bridge.steerAgentTurn.mockImplementationOnce(() => new Promise(resolve => { resolveSteer = resolve; }));
      controller.setDraft("first instruction");
      const pending = controller.submit("first instruction");
      await vi.waitFor(() => expect(bridge.steerAgentTurn).toHaveBeenCalledTimes(1));
      controller.setDraft("newer unsent draft");
      resolveSteer({ steered: true });
      await pending;
      expect(controller.getSnapshot().draft).toBe("newer unsent draft");
    } finally { controller.dispose(); }
  });

  it("repeated send while the same steer is pending has one dispatch", async () => {
    let emit: any;
    const bridge = bridgeFixture(listener => { emit = listener; }, { steer: true });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      emit(event(2, "turn.started", { prompt: "Running" }, "turn-running"));
      const receipts: Array<(v: Awaited<ReturnType<AgentClientPort["steerAgentTurn"]>>) => void> = [];
      bridge.steerAgentTurn.mockImplementation(() => new Promise(resolve => receipts.push(resolve)));
      controller.setDraft("single instruction");
      const first = controller.submit("single instruction");
      const second = controller.submit("single instruction");
      for (const resolve of receipts) resolve({ sessionId: "session-1", turnId: "turn-1", steered: true });
      await Promise.all([first, second]);
      expect(bridge.steerAgentTurn).toHaveBeenCalledTimes(1);
    } finally { controller.dispose(); }
  });

  it("keeps Stop feedback independent of the display and retries the same command identity", async () => {
    vi.useFakeTimers();
    let emit: ((event: AgentEvent) => void) | undefined;
    const bridge = { ...bridgeFixture(listener => { emit = listener; }),
      interruptAgentTurn: vi.fn<AgentClientPort["interruptAgentTurn"]>(async request => ({ sessionId: request.sessionId, turnId: request.turnId, interruptRequested: true })) };
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      emit?.(event(2, "turn.started", { prompt: "Running" }, "turn-1"));
      bridge.interruptAgentTurn.mockImplementationOnce(() => new Promise(() => {}));
      const stopping = controller.stop();
      expect(controller.getSnapshot().stopping).toBe(true);
      await controller.stop();
      expect(bridge.interruptAgentTurn).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(5000); await stopping;
      expect(controller.getSnapshot().stopRequest?.status).toBe("unconfirmed");
      expect(controller.getSnapshot().stopping).toBe(false);
      await controller.stop();
      expect(bridge.interruptAgentTurn.mock.calls[1]?.[0]).toEqual(bridge.interruptAgentTurn.mock.calls[0]?.[0]);
    } finally { controller.dispose(); vi.useRealTimers(); }
  });

  it.each([true, false])("keeps newer steer drafts, references and mentions on receipt (accepted=%s)", async (accepted) => {
    let emit: (event: AgentEvent) => void = () => {};
    const bridge = bridgeFixture(listener => { emit = listener; }, {
      steer: true, referenceInputs: { ...referenceCapabilities(), steer: true },
    });
    const receipt = Promise.withResolvers<{ sessionId: string; turnId: string; steered: boolean }>();
    bridge.steerAgentTurn.mockReturnValueOnce(receipt.promise);
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      emit(event(2, "turn.started", { prompt: "Running" }, "turn-running"));
      await controller.addWorkspacePaths(["a.md"]);
      const firstReference = controller.getSnapshot().references[0]!;
      controller.setDraftDocument("@a.md", [{ referenceId: firstReference.id, start: 0, end: 5 }]);
      const pending = controller.submit("@a.md");
      expect(controller.getSnapshot()).toMatchObject({ submitting: true, draft: "", references: [] });
      await controller.addWorkspacePaths(["b.md"]);
      const newerReference = controller.getSnapshot().references[0]!;
      controller.setDraftDocument("@b.md", [{ referenceId: newerReference.id, start: 0, end: 5 }]);
      if (accepted) receipt.resolve({ sessionId: "session-1", turnId: "turn-running", steered: true });
      else receipt.reject(new Error("native rejected instruction"));
      expect(await pending).toBe(accepted);
      const next = controller.getSnapshot();
      expect(next.submitting).toBe(false);
      expect(next.pendingIntent).toBeNull();
      expect(next.draft).toBe(accepted ? "@b.md" : "@a.md\n\n@b.md");
      expect(next.references.map(reference => reference.id)).toEqual(accepted ? [newerReference.id] : [firstReference.id, newerReference.id]);
      expect(next.draftMentions.at(-1)).toEqual({ referenceId: newerReference.id, start: accepted ? 0 : 7, end: accepted ? 5 : 12 });
      if (!accepted) expect(await controller.submit(next.draft)).toBe(true);
    } finally { controller.dispose(); }
  });

  it.each([true, false])("keeps attachment-only steer submissions busy until acknowledgement (accepted=%s)", async (accepted) => {
    let emit: (event: AgentEvent) => void = () => {};
    const bridge = bridgeFixture(listener => { emit = listener; }, {
      steer: true, referenceInputs: { ...referenceCapabilities(), steer: true, attachmentOnly: true },
    });
    const receipt = Promise.withResolvers<{ sessionId: string; turnId: string; steered: boolean }>();
    bridge.steerAgentTurn.mockReturnValueOnce(receipt.promise);
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      emit(event(2, "turn.started", { prompt: "Running" }, "turn-running"));
      await controller.addWorkspacePaths(["a.md"]);
      const pending = controller.submit("");
      expect(controller.getSnapshot().submitting).toBe(true);
      expect(await controller.submit("repeated Enter")).toBe(false);
      controller.setDraft("new draft");
      if (accepted) receipt.resolve({ sessionId: "session-1", turnId: "turn-running", steered: true });
      else receipt.reject(new Error("attachment rejected"));
      expect(await pending).toBe(accepted);
      expect(controller.getSnapshot().draft).toBe("new draft");
      expect(controller.getSnapshot().references).toHaveLength(accepted ? 0 : 1);
      expect(controller.getSnapshot().submitting).toBe(false);
    } finally { controller.dispose(); }
  });

  it("does not restore a late rejected steer into a replacement conversation", async () => {
    let emit: (event: AgentEvent) => void = () => {};
    const bridge = bridgeFixture(listener => { emit = listener; }, { steer: true });
    const receipt = Promise.withResolvers<{ sessionId: string; turnId: string; steered: boolean }>();
    bridge.steerAgentTurn.mockReturnValueOnce(receipt.promise);
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    try {
      await controller.initialize();
      emit(event(2, "turn.started", { prompt: "Running" }, "turn-running"));
      const pending = controller.submit("old instruction");
      emit(event(3, "turn.completed", {}, "turn-running"));
      await controller.newSession();
      controller.setDraft("new conversation draft");
      receipt.reject(new Error("late rejection"));
      expect(await pending).toBe(false);
      expect(controller.getSnapshot()).toMatchObject({ draft: "new conversation draft", error: null, submitting: false, pendingIntent: null });
    } finally { controller.dispose(); }
  });

  it("delegates queue admission to the Main command transaction", async () => {
    let eventListener: ((event: AgentEvent) => void) | undefined;
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
    let eventListener: ((event: AgentEvent) => void) | undefined;
    let acceptTurn: ((value: { sessionId: string; turnId: string }) => void) | undefined;
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
    acceptTurn?.({ sessionId: "session-1", turnId: "turn-live" });
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

  it("captures references inside the immutable command sent to Main", async () => {
    let eventListener: ((event: AgentEvent) => void) | undefined;
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
    let eventListener: ((event: AgentEvent) => void) | undefined;
    const bridge = bridgeFixture((listener) => { eventListener = listener; }, { queue: true });
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    eventListener?.(event(2, "turn.started", { prompt: "Long task" }, "turn-running"));
    await new Promise((resolve) => setTimeout(resolve, 45));
    await controller.addWorkspacePaths(["queued.md"]);
    let rejectStart: ((error: Error) => void) | undefined;
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
    let eventListener: ((event: AgentEvent) => void) | undefined;
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
    let rejectPreparation: ((error: Error) => void) | undefined;
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
});
