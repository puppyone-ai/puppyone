import { describe, expect, it, vi } from "vitest";
import { projectAgentControlView } from "../../../../electron/main/agent/domain/agent-control-view.mjs";
import { createAgentSessionControl, reduceAgentSessionControl } from "../../../../electron/main/agent/domain/agent-session-control.mjs";
import type { AgentControllerState } from "../../../../src/features/desktop-agent/application/agent-controller-state";
import type { AgentClientPort } from "../../../../src/features/desktop-agent/application/AgentClientPort";
import { AgentReferenceDraftManager } from "../../../../src/features/desktop-agent/application/AgentReferenceDraftManager";
import { AgentSessionController } from "../../../../src/features/desktop-agent/application/AgentSessionController";
import { AgentTurnSubmissionCoordinator } from "../../../../src/features/desktop-agent/application/AgentTurnSubmissionCoordinator";

describe("Shared Agent submission lifecycle", () => {
  it.each(["queued", "dispatching", "accepted", "outcome-unknown"])("does not restore or redispatch %s input after losing the RPC receipt", async (status) => {
    const h = harness();
    const receipt = Promise.withResolvers<void>();
    h.start.mockReturnValueOnce(receipt.promise);
    h.patch({ draft: "submitted" });
    const pending = h.coordinator.submit("submitted");
    const commandId = h.state().pendingIntent!.id;
    const control = reduceAgentSessionControl(createAgentSessionControl(), {
      type: "command.received", command: { commandId, kind: "start", status, intentFingerprint: commandId },
    });
    h.patch({ draft: "new unsent text", control: projectAgentControlView(control) });
    receipt.reject(new Error("IPC receipt lost"));
    expect(await pending).toBe(false);
    expect(h.state()).toMatchObject({ draft: "new unsent text", submitting: false, pendingIntent: null });
    expect(h.start).toHaveBeenCalledOnce();
  });

  it("releases ownership and restores input after a synchronous bridge failure", async () => {
    const h = harness();
    h.start.mockImplementationOnce(() => { throw new Error("bridge closed"); });
    expect(await h.coordinator.submit("retryable input")).toBe(false);
    expect(h.state()).toMatchObject({ draft: "retryable input", submitting: false, pendingIntent: null });
    expect(await h.coordinator.submit(h.state().draft)).toBe(true);
  });

  it("does not let an old receipt release a newer conversation's submission lock", async () => {
    const h = harness();
    const oldReceipt = Promise.withResolvers<void>();
    const newReceipt = Promise.withResolvers<void>();
    h.start.mockReturnValueOnce(oldReceipt.promise).mockReturnValueOnce(newReceipt.promise);
    const old = h.coordinator.submit("old input");
    h.coordinator.invalidate();
    h.patch({ session: { ...h.state().session!, id: "new-session" } });
    const next = h.coordinator.submit("new input");
    oldReceipt.reject(new Error("late failure"));
    expect(await old).toBe(false);
    expect(h.state()).toMatchObject({ submitting: true, pendingIntent: { prompt: "new input" }, error: null });
    expect(await h.coordinator.submit("duplicate input")).toBe(false);
    newReceipt.resolve();
    expect(await next).toBe(true);
    expect(h.state()).toMatchObject({ submitting: false, pendingIntent: null });
    expect(h.start).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch after preparation completes for an invalidated conversation", async () => {
    const h = harness();
    const preparation = Promise.withResolvers<boolean>();
    h.patch({ session: null });
    h.prepare.mockReturnValueOnce(preparation.promise);
    const pending = h.coordinator.submit("old preparation input");
    h.coordinator.invalidate();
    h.patch({ draft: "new conversation draft" });
    preparation.resolve(false);
    expect(await pending).toBe(false);
    expect(h.state()).toMatchObject({ draft: "new conversation draft", submitting: false, pendingIntent: null, error: null });
    expect(h.start).not.toHaveBeenCalled();
  });
});

function harness() {
  const controller = new AgentSessionController("/workspace", () => undefined);
  let state = controller.getSnapshot();
  controller.dispose();
  state = { ...state, session: { id: "session" } as NonNullable<AgentControllerState["session"]> };
  const patch = (value: Partial<AgentControllerState>) => { state = { ...state, ...value }; };
  const start = vi.fn(async () => {});
  const prepare = vi.fn(async () => true);
  const bridge = { startAgentTurn: start } as unknown as AgentClientPort;
  const references = new AgentReferenceDraftManager({ workspaceRoot: "/workspace", bridgeProvider: () => bridge, readState: () => state, patch, appendText: () => {} });
  const coordinator = new AgentTurnSubmissionCoordinator({
    workspaceRoot: "/workspace", bridgeProvider: () => bridge, references,
    readState: () => state, patch, prepareSession: prepare, writeDraft: vi.fn(),
  });
  return { state: () => state, patch, coordinator, start, prepare };
}
