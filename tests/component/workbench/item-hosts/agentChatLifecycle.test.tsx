/** @vitest-environment happy-dom */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPiEventState, normalizePiRpcEvent } from "../../../../electron/main/agent/protocols/pi-rpc/pi-event-normalizer.mjs";
import { agentSessionReplicaLimits } from "../../../../src/features/desktop-agent/application/AgentSessionReplica";
import { createAgentWorkbenchLifecycleHarness } from "../../../support/agent/agentWorkbenchLifecycleHarness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Harness = Awaited<ReturnType<typeof createAgentWorkbenchLifecycleHarness>>;
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(async () => {
  for (const dispose of cleanups.splice(0)) await dispose();
  document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks();
});
async function open(options = {}) {
  const h = await createAgentWorkbenchLifecycleHarness(options);
  cleanups.push(h.dispose);
  return h;
}
function assertRemoved(h: Harness, item = h.itemId) {
  expect(h.project.getSnapshot().topology.items.some(entry => entry.id === item)).toBe(false);
  expect(h.container.querySelector(`[data-terminal-session-pane-id="${item}"]`)).toBeNull();
  expect(document.querySelector(".desktop-workbench-close-dialog")).toBeNull();
  expect(h.container.querySelector('.desktop-terminal-workbench-create-failure[role="alert"]')).toBeNull();
  expect(document.body.textContent).not.toContain("This session could not be closed");
}
async function firstOutput(h: Harness) {
  await h.send();
  await act(async () => { h.emit("assistant.delta", { delta: "First response" }, "answer-1"); });
  expect(h.controller.getSnapshot().projection.messages.at(-1)?.text).toBe("First response");
  expect(h.container.textContent).toContain("First response");
}
async function holdRecovery(h: Harness, operation: "attach" | "ack" = "attach") {
  const port = h.ports.get(h.itemId)!;
  const method = operation === "attach" ? port.attachAgentSession : port.acknowledgeAgentSession;
  const invoke = method.getMockImplementation()!;
  const late = Promise.withResolvers<unknown>();
  let receipt: unknown;
  method.mockImplementationOnce(async request => {
    receipt = await invoke(request);
    return late.promise;
  });
  let repair!: Promise<void>;
  h.setTransform(frame => ({ ...frame, displayPatch: { schemaVersion: 2 } }) as unknown as typeof frame);
  await act(async () => { h.emit("assistant.delta", { delta: "!" }, "answer-1"); });
  h.setTransform(frame => frame);
  await act(async () => { repair = h.controller.retryDisplayRecovery(); });
  expect(h.controller.getSnapshot().replicaStatus).not.toBe("live");
  return { repair, release: () => late.resolve(receipt) };
}

describe("Chat lifecycle through production Actor, feed, replica, UI and Main supervision", () => {
  it("opens a prepared empty Chat and closes before the first input without a failure popup", async () => {
    const h = await open();
    expect(h.processService.getSessionCount()).toBe(1);
    expect(h.adapter().startTurn).not.toHaveBeenCalled();
    await h.close();
    assertRemoved(h);
    expect(h.management.terminateItemExecution).toHaveBeenCalledOnce();
    expect(h.subscribers.size).toBe(0);
  });

  it("sends, displays content, repairs a lost final frame, continues once, and closes", async () => {
    const h = await open();
    await firstOutput(h);
    act(() => h.controller.setDraft("Draft kept during reconnect"));
    await act(async () => { h.emit("assistant.completed", { text: "First response complete" }, "answer-1"); });
    h.setTransform(() => null);
    await act(async () => { h.emit("turn.completed"); });
    expect(h.controller.getSnapshot().projection.runningTurnId).toBe("turn-1");
    h.setTransform(frame => frame);
    await act(async () => { await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.watermarkIdleMs); });
    expect(h.controller.getSnapshot().replicaStatus).toBe("live");
    expect(h.controller.getSnapshot().projection.runningTurnId).toBeNull();
    expect(h.controller.getSnapshot().draft).toBe("Draft kept during reconnect");
    expect(h.container.textContent).toContain("First response complete");
    expect(h.adapter().startTurn).toHaveBeenCalledOnce();
    await h.send("Second request");
    await act(async () => { h.emit("assistant.completed", { text: "Second response" }, "answer-2", "turn-2"); h.emit("turn.completed", {}, null, "turn-2"); });
    expect(h.container.textContent).toContain("Second response");
    expect(h.adapter().startTurn).toHaveBeenCalledTimes(2);
    const created = h.ports.get(h.itemId)!.createAgentSession.mock.calls.length;
    await h.close();
    assertRemoved(h);
    expect(h.ports.get(h.itemId)!.createAgentSession).toHaveBeenCalledTimes(created);
    expect(h.management.terminateItemExecution).toHaveBeenCalledOnce();
  });

  it.each(["streaming", "provider-retrying", "silent", "reconnecting", "degraded", "paused", "exhausted", "ack-pending", "approval", "runtime-exited", "completed"] as const)(
    "accepts closing a Chat in %s without waiting for recovery or OS cleanup", async stage => {
      const h = await open();
      await firstOutput(h);
      const adapter = h.adapter();
      const port = h.ports.get(h.itemId)!;
      let late: Awaited<ReturnType<typeof holdRecovery>> | undefined;
      if (["silent", "reconnecting", "degraded", "paused", "ack-pending"].includes(stage)) {
        late = await holdRecovery(h, stage === "ack-pending" ? "ack" : "attach");
        if (stage === "degraded") await act(async () => { await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.recoveryDegradedDelayMs); });
        if (stage === "paused") act(() => h.controller.pauseDisplayRecovery());
        if (stage === "reconnecting") await act(async () => { await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.recoveryReconnectingDelayMs); });
        if (stage !== "ack-pending") expect(h.controller.getSnapshot().displayRecovery?.stage).toBe(stage === "paused" ? "action-required" : stage);
      } else if (stage === "exhausted") {
        port.attachAgentSession.mockRejectedValue(new Error("Fixture feed unavailable"));
        await act(async () => { void h.controller.retryDisplayRecovery(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
        expect(h.controller.getSnapshot().displayRecovery?.policy).toBe("exhausted");
      } else if (stage === "provider-retrying") {
        await act(async () => { h.emit("provider.connection.updated", { state: "reconnecting", attempt: 1, maxAttempts: 3, message: "Retrying model request" }); });
        expect(h.controller.getSnapshot().projection.connectionStatus?.state).toBe("reconnecting");
      } else if (stage === "approval") {
        await act(async () => { h.emit("approval.requested", { requestId: "approval-1", type: "command", title: "Run fixture command", command: "fixture" }, "approval-1"); });
        expect(h.controller.getSnapshot().projection.approvals).toHaveLength(1);
      } else if (stage === "runtime-exited") {
        await act(async () => { adapter.exit({ reason: "fixture-exit" }); });
        expect(h.controller.getSnapshot().phase).toBe("runtime-exited");
      } else if (stage === "completed") {
        await act(async () => { h.emit("turn.completed"); });
        expect(h.controller.getSnapshot().projection.runningTurnId).toBeNull();
      }
      const attachments = port.attachAgentSession.mock.calls.length;
      const beforeClose = Date.now();
      await h.close();
      expect(Date.now()).toBe(beforeClose);
      assertRemoved(h);
      expect(h.management.terminateItemExecution).toHaveBeenCalledOnce();
      expect(h.lifecycle.list()[0]).toMatchObject({ kind: "agent", desiredLifecycle: "terminated", cleanup: "running" });
      expect(h.native().exited).toBe(false);
      expect(h.controller.getSnapshot().displayRecovery).toBeUndefined();
      late?.release();
      await act(async () => { await late?.repair; await h.controller.retryDisplayRecovery(); await vi.advanceTimersByTimeAsync(120_000); });
      assertRemoved(h);
      expect(port.attachAgentSession).toHaveBeenCalledTimes(attachments);
      expect(adapter.startTurn).toHaveBeenCalledOnce();
      expect(port.closeAgentSession).not.toHaveBeenCalled();
      expect(port.resolveAgentApproval).not.toHaveBeenCalled();
      expect(h.subscribers.size).toBe(0);
      h.native().cleanup.resolve();
      await h.processService.closeAll();
      expect(h.processService.getSessionCount()).toBe(0);
      expect(h.lifecycle.list()[0].cleanup).toBe("confirmed");
    },
  );

  it("shows native retry recovery as successful content and closes without a stale failure card", async () => {
    const h = await open(); await h.send();
    const state = createPiEventState({ turnId: "turn-1", providerSessionId: "thread-1" });
    const answer = { role: "assistant", content: [{ type: "text", text: "Recovered response" }], stopReason: "stop" };
    await act(async () => {
      for (const raw of [
        { type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed", content: [] } },
        { type: "auto_retry_start", attempt: 1, maxAttempts: 3 },
        { type: "message_end", message: answer }, { type: "auto_retry_end", success: true },
        { type: "agent_end", messages: [answer] }, { type: "agent_settled" },
      ]) for (const event of normalizePiRpcEvent(raw, state)) h.adapter().emit(event);
    });
    expect(h.container.textContent).toContain("Recovered response");
    expect(h.container.textContent).not.toContain("fetch failed");
    expect(h.controller.getSnapshot().projection.terminalState).toBe("completed");
    expect(h.controller.getSnapshot().projection.connectionStatus).toBeNull();
    await h.close(); assertRemoved(h);
  });

  it("cancels the running-task confirmation while reconnecting and leaves the same execution usable", async () => {
    const h = await open(); await firstOutput(h);
    const late = await holdRecovery(h);
    await h.close(h.itemId, false);
    expect(h.management.terminateItemExecution).not.toHaveBeenCalled();
    const cancel = document.querySelector<HTMLButtonElement>(".desktop-workbench-close-dialog .desktop-dialog-footer button:first-child")!;
    await act(async () => { cancel.click(); });
    late.release();
    await act(async () => { await late.repair; });
    expect(h.controller.getSnapshot().replicaStatus).toBe("live");
    expect(h.project.getSnapshot().topology.items.some(item => item.id === h.itemId)).toBe(true);
    expect(h.adapter().startTurn).toHaveBeenCalledOnce();
    await h.close(); assertRemoved(h);
  });

  it("closes before the first display snapshot arrives and releases the late subscription", async () => {
    const h = await open({ holdFirstAttach: true });
    const port = h.ports.get(h.itemId)!;
    expect(port.attachAgentSession).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().replicaStatus).toBe("subscribing");
    await h.close(); assertRemoved(h);
    h.initialAttachGate!.resolve();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(port.detachAgentSession).toHaveBeenCalled();
    expect(port.attachAgentSession).toHaveBeenCalledOnce();
    expect(port.startAgentTurn).not.toHaveBeenCalled();
    expect(h.subscribers.size).toBe(0);
    assertRemoved(h);
  });

  it("closes during native creation before any session ID and rejects the late startup", async () => {
    const h = await open({ holdCreation: true }); const gate = h.creationGate!;
    act(() => h.controller.setDraft("Pending startup"));
    let submitted!: Promise<boolean>;
    await act(async () => { submitted = h.controller.submit("Pending startup"); });
    expect(h.processService.getSessionCount()).toBe(1);
    expect(h.controller.getSnapshot().session).toBeNull();
    await h.close(); assertRemoved(h);
    expect(h.management.terminateItemExecution).toHaveBeenCalledOnce();
    const replacement = await h.addChat();
    await h.send("New Chat while old creation is pending", replacement);
    act(() => h.registry.get(replacement).setDraft("Replacement draft"));
    expect(h.adapter(replacement).startTurn).toHaveBeenCalledOnce();
    gate.resolve(); h.native().cleanup.resolve();
    await act(async () => { await submitted; });
    expect(h.processService.getSessionCount()).toBe(1);
    expect(h.ports.get(h.itemId)!.attachAgentSession).not.toHaveBeenCalled();
    expect(h.native().native.adapters.every(adapter => adapter.startTurn.mock.calls.length === 0)).toBe(true);
    expect(h.registry.get(replacement).getSnapshot().draft).toBe("Replacement draft");
    assertRemoved(h);
  });

  it("seals queued input when closing and ignores late native completion", async () => {
    const h = await open(); await firstOutput(h);
    const adapter = h.adapter();
    await act(async () => { await h.controller.submit("Queued follow-up"); });
    expect(h.controller.getSnapshot().control?.queue).toHaveLength(1);
    expect(adapter.startTurn).toHaveBeenCalledOnce();
    await h.close(); assertRemoved(h);
    await act(async () => {
      adapter.emit({ type: "turn.completed", turnId: "turn-1", providerSessionId: "thread-1", payload: {} });
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(adapter.startTurn).toHaveBeenCalledOnce();
    assertRemoved(h);
  });

  it("keeps a sibling Chat responsive while a termination receipt is lost, then retries the fixed intent", async () => {
    const h = await open(); await firstOutput(h);
    const first = h.adapter();
    const accepted = h.management.terminateItemExecution.getMockImplementation()!;
    h.management.terminateItemExecution.mockImplementationOnce(async request => {
      await accepted(request); // Main accepts; only the outbound receipt is lost.
      return new Promise(() => {});
    });
    await h.close();
    expect(h.lifecycle.list()[0].desiredLifecycle).toBe("terminated");
    expect(h.project.getSnapshot().topology.items.some(item => item.id === h.itemId)).toBe(true);
    const sibling = await h.addChat();
    await h.send("Sibling request", sibling);
    expect(h.adapter(sibling).startTurn).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(h.controller.getSnapshot().error?.detail).toContain("Termination acceptance is unconfirmed");
    expect(h.controller.getSnapshot().displayRecovery).toBeUndefined();
    await h.close();
    assertRemoved(h);
    expect(h.management.terminateItemExecution.mock.calls[1][0]).toEqual(h.management.terminateItemExecution.mock.calls[0][0]);
    expect(first.startTurn).toHaveBeenCalledOnce();
    expect(h.processService.getSessionCount()).toBe(2); // Both pending OS-exit gates retain their resource owners.
    expect(h.registry.get(sibling).getSnapshot().projection.runningTurnId).toBe("turn-1");
    await h.close(sibling);
    assertRemoved(h, sibling);
  });
});
