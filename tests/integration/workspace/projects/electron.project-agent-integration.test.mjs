import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectSessionHost } from "../../../../electron/main/bootstrap/create-project-session-host.mjs";
import { registerAgentIpcHandlers } from "../../../../electron/main/ipc/agent-ipc.mjs";
import { createServiceHarness, createSender } from "../../../support/agent/agentServiceHarness.mjs";

const disposals = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); });
const folder = (id) => ({ path: `/projects/${id}`, workspace: { id } });
const context = (record) => ({ projectId: record.projectId, generation: record.generation, rootPath: record.rootPath });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function harness() {
  const main = createServiceHarness();
  const owner = createSender(501);
  const projects = createProjectSessionHost({ agentService: main.service, terminalService: { closeSessionsForWorkspaceRoot: async () => {} }, getSender: () => owner, closeProjectServices: async () => {} });
  const handlers = new Map();
  registerAgentIpcHandlers({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, agentService: main.service,
    authorizeWorkspaceRoot: async (_event, root) => root, projectSessions: projects });
  disposals.push(() => main.service.closeAll());
  const call = (channel, project, request = {}, sender = owner) => handlers.get(channel)({ sender }, { rootPath: project.rootPath, projectContext: context(project), ...request });
  return { ...main, owner, projects, handlers, call };
}

describe("project authority through Agent IPC, service and feed", () => {
  it("keeps background output in A and closes A without stopping B", async () => {
    const h = harness();
    const a = h.projects.open(h.owner.id, folder("a"));
    const first = await h.call("agent:session-create", a, { runtimeId: "codex" });
    const b = h.projects.open(h.owner.id, folder("b"));
    const second = await h.call("agent:session-create", b, { runtimeId: "codex" });
    expect(first.session.instanceId).not.toBe(second.session.instanceId);
    const aRequest = { sessionId: first.session.id, instanceId: first.session.instanceId };
    const receipt = await h.call("agent:session-attach", a, aRequest);
    await h.call("agent:session-feed-ack", a, { ...aRequest, subscriptionId: receipt.subscriptionId, ...receipt.snapshot.cursor });
    h.adapters[0].emit({ type: "assistant.completed", providerSessionId: "thread-1", itemId: "answer", payload: { text: "A finished in the background" } });
    expect(h.owner.send.mock.calls.some(([name, frame]) => name === "agent:session-frame" && frame.session?.id === first.session.id)).toBe(true);
    expect(h.adapters.every((adapter) => adapter.disposeNative.mock.calls.length === 0)).toBe(true);
    await h.projects.close(h.owner.id, a);
    expect(h.adapters[0].disposed).toBe(true);
    expect(h.adapters[1].disposed).toBe(false);
    expect(h.projects.roots(h.owner.id)).toEqual([b.rootPath]);
    expect(await h.call("agent:session-attach", b, { sessionId: second.session.id, instanceId: second.session.instanceId })).toHaveProperty("snapshot.session.id", second.session.id);
    expect(h.adapters.flatMap((adapter) => adapter.startTurn.mock.calls)).toHaveLength(0);
  });

  it("rejects forged roots, generations, windows and runtime instances", async () => {
    const h = harness(); const a = h.projects.open(h.owner.id, folder("a"));
    const first = await h.call("agent:session-create", a, { runtimeId: "codex" });
    const request = { sessionId: first.session.id, instanceId: first.session.instanceId };
    for (const [project, payload, sender] of [
      [a, { ...request, rootPath: "/other" }, h.owner],
      [{ ...a, generation: "obsolete" }, request, h.owner],
      [a, request, createSender(502)],
      [a, { ...request, instanceId: "obsolete" }, h.owner],
    ]) {
      expect(await h.call("agent:session-close", project, payload, sender)).toHaveProperty("agentFailure");
    }
    expect(h.adapters[0].disposeNative).not.toHaveBeenCalled();
    expect(await h.handlers.get("agent:session-close")({ sender: h.owner }, { rootPath: a.rootPath, ...request })).toHaveProperty("agentFailure");
  });

  it("keeps a background approval and provider failure out of B's control state", async () => {
    const h = harness();
    const a = h.projects.open(h.owner.id, folder("a"));
    const b = h.projects.open(h.owner.id, folder("b"));
    const first = await h.call("agent:session-create", a, { runtimeId: "codex" });
    const second = await h.call("agent:session-create", b, { runtimeId: "codex" });
    const aRequest = { sessionId: first.session.id, instanceId: first.session.instanceId };
    const bRequest = { sessionId: second.session.id, instanceId: second.session.instanceId };
    await h.call("agent:turn-start", a, { ...aRequest, prompt: "Run the fixture task" });
    h.adapters[0].emit({
      type: "approval.requested", providerSessionId: "thread-1", turnId: "turn-1", itemId: "tool-a",
      payload: { requestId: "approval-a", kind: "command", availableDecisions: ["accept", "decline"] },
    });
    const aView = await h.call("agent:session-attach", a, aRequest);
    const bView = await h.call("agent:session-attach", b, bRequest);
    expect(aView.snapshot.control.interaction.approvals).toHaveLength(1);
    expect(bView.snapshot.control.interaction.approvals).toEqual([]);
    expect(h.adapters[0].resolveApproval).not.toHaveBeenCalled();
    h.adapters[0].exit({ expected: false, diagnostics: "fixture provider exit" });
    await vi.waitFor(() => expect(h.adapters[0].disposed).toBe(true));
    expect(h.adapters[1].disposed).toBe(false);
    const after = await h.call("agent:session-attach", b, bRequest);
    expect(after.snapshot.control.interaction.approvals).toEqual([]);
    expect(after.snapshot.session.id).toBe(second.session.id);
    expect(h.adapters[1].startTurn).not.toHaveBeenCalled();
  });

  it("fences a pending runtime discovery before it allocates an adapter", async () => {
    const h = harness(); const a = h.projects.open(h.owner.id, folder("a"));
    const wait = deferred(); const started = deferred();
    const discover = h.runtimeRegistry.discover.bind(h.runtimeRegistry);
    vi.spyOn(h.runtimeRegistry, "discover").mockImplementation(async (...args) => { started.resolve(); await wait.promise; return discover(...args); });
    const creating = h.call("agent:session-create", a, { runtimeId: "codex" });
    await started.promise;
    const closing = h.projects.close(h.owner.id, a);
    wait.resolve();
    expect(await creating).toHaveProperty("agentFailure.code", "PROJECT_STALE");
    expect(await closing).toEqual({ closed: true });
    expect(h.adapters).toHaveLength(0);
    expect(h.service.getSessionCount()).toBe(0);
  });

  it("shares duplicate close and protects a resumed conversation from its old close receipt", async () => {
    const h = harness(); const a = h.projects.open(h.owner.id, folder("a"));
    const first = await h.call("agent:session-create", a, { runtimeId: "codex" });
    const old = { sessionId: first.session.id, instanceId: first.session.instanceId };
    const wait = deferred(); h.adapters[0].disposeNative.mockImplementationOnce(() => wait.promise);
    const closing = h.call("agent:session-close", a, old);
    const duplicate = h.call("agent:session-close", a, old);
    await vi.waitFor(() => expect(h.adapters[0].disposeNative).toHaveBeenCalledOnce());
    wait.resolve();
    expect(await closing).toMatchObject({ closed: true });
    expect(await duplicate).toMatchObject({ closed: true });
    const resumed = await h.call("agent:session-resume", a, { sessionId: first.session.id, runtimeId: "codex" });
    expect(resumed.session.id).toBe(first.session.id);
    expect(resumed.session.instanceId).not.toBe(first.session.instanceId);
    expect(await h.call("agent:session-close", a, old)).toMatchObject({ closed: true });
    expect(h.adapters[1].disposeNative).not.toHaveBeenCalled();
    expect(await h.call("agent:session-attach", a, { sessionId: resumed.session.id, instanceId: resumed.session.instanceId })).toHaveProperty("snapshot");
  });

  it("retains a failed native close and retries it", async () => {
    const h = harness(); const a = h.projects.open(h.owner.id, folder("a"));
    await h.call("agent:session-create", a, { runtimeId: "codex" });
    h.adapters[0].disposeNative.mockRejectedValue(new Error("adapter still stopping"));
    expect(await h.projects.close(h.owner.id, a)).toMatchObject({ closed: false });
    expect(h.projects.snapshot(h.owner.id).projects[0].state).toBe("closing");
    h.adapters[0].disposeNative.mockResolvedValue(undefined);
    expect(await h.projects.close(h.owner.id, a)).toEqual({ closed: true });
    expect(h.service.getSessionCount()).toBe(0);
  });

  it("cancels a pending History scan and prevents its late catalog submission", async () => {
    const h = harness(); const a = h.projects.open(h.owner.id, folder("a"));
    const wait = deferred(); const started = deferred();
    const create = h.runtimeRegistry.createAdapter.bind(h.runtimeRegistry);
    vi.spyOn(h.runtimeRegistry, "createAdapter").mockImplementation((...args) => {
      const adapter = create(...args);
      adapter.discoverSessions.mockImplementation(() => { started.resolve(); return wait.promise; });
      return adapter;
    });
    const listing = h.call("agent:sessions-list", a, { runtimeId: "codex", discoverNative: true });
    await started.promise;
    expect(await h.projects.close(h.owner.id, a)).toEqual({ closed: true });
    expect(h.adapters[0].disposed).toBe(true);
    expect(await listing).toHaveProperty("agentFailure.code", "PROJECT_STALE");
    wait.resolve({ supported: true, sessions: [{ providerSessionId: "late", workspaceRoot: a.rootPath, title: "late" }], nextCursor: null });
    await Promise.resolve(); await Promise.resolve();
    expect(h.persistence.upsertNative).not.toHaveBeenCalled();
  });
});
