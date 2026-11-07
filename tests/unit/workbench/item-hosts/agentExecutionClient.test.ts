import { afterEach, describe, expect, it, vi } from "vitest";
import { createManagedAgentClient } from "../../../../src/features/desktop-agent/infrastructure/electron/agentExecutionClient";
import type { AgentClientPort } from "../../../../src/features/desktop-agent/application/AgentClientPort";
import type { ItemExecutionRequest, ItemExecutionSummary } from "../../../../shared/item-host-contract/lifecycle";
import { handOffItemExecution } from "../../../../src/features/session-transport/itemLifecycleClient";

const projectContext = { projectId: "project", generation: "generation", rootPath: "/project" };
const snapshot = { session: { id: "conversation", instanceId: "instance" } };
const receipt = (request: ItemExecutionRequest): ItemExecutionSummary => ({ ...request, executionId: "execution",
  desiredLifecycle: "terminated", observedLifecycle: "stopping", cleanup: "running", revision: 1, errorCode: null });
afterEach(() => vi.useRealTimers());
function fixture() {
  const discover = vi.fn(async (_input: unknown) => ({ readiness: { status: "ready" } }));
  const create = vi.fn(async (_input: unknown) => snapshot);
  const resume = vi.fn(async (_input: unknown) => snapshot);
  const fork = vi.fn(async (_input: unknown) => ({ session: { ...snapshot.session, id: "fork" } }));
  const terminate = vi.fn(async (request: ItemExecutionRequest) => receipt(request));
  const client = createManagedAgentClient({ discoverAgentRuntimes: discover, createAgentSession: create, resumeAgentSession: resume, forkAgentSession: fork } as unknown as AgentClientPort,
    { terminateItemExecution: terminate, listItemExecutions: async () => [], retryItemExecutionCleanup: terminate }, projectContext, "agent-item");
  return { client, create, resume, fork, terminate, discover };
}

describe("Agent adaptation of shared item management", () => {
  it("keeps the same execution identity from preparation through creation", async () => {
    const f = fixture();
    await f.client.discoverAgentRuntimes({ rootPath: "/project", runtimeId: "cursor", prepareSession: true } as never);
    await f.client.createAgentSession({ rootPath: "/project", runtimeId: "cursor" });
    const discovery = f.discover.mock.calls[0][0] as { creationId: string };
    expect(discovery.creationId).toBeTruthy();
    expect(f.create.mock.calls[0][0]).toMatchObject({ itemId: "agent-item", creationId: discovery.creationId });
  });
  it("seals prepared ownership when creation fails and allocates a fresh retry identity", async () => {
    const f = fixture();
    await f.client.discoverAgentRuntimes({ rootPath: "/project", runtimeId: "cursor", prepareSession: true });
    f.create.mockRejectedValueOnce(new Error("invalid native selection"));
    await expect(f.client.createAgentSession({ rootPath: "/project", runtimeId: "cursor" })).rejects.toThrow(/invalid native/);
    expect(f.terminate).toHaveBeenCalledOnce();
    await f.client.createAgentSession({ rootPath: "/project", runtimeId: "cursor" });
    expect((f.create.mock.calls[1][0] as { creationId: string }).creationId).not.toBe((f.discover.mock.calls[0][0] as { creationId: string }).creationId);
  });
  it("releases preparation before switching runtimes or opening history", async () => {
    const f = fixture();
    await f.client.discoverAgentRuntimes({ rootPath: "/project", runtimeId: "cursor", prepareSession: true });
    await f.client.discoverAgentRuntimes({ rootPath: "/project", runtimeId: "codex", prepareSession: true });
    expect(f.terminate).toHaveBeenCalledOnce();
    await f.client.resumeAgentSession({ rootPath: "/project", runtimeId: "codex", sessionId: "saved" });
    expect(f.terminate).toHaveBeenCalledTimes(2);
  });
  it("rejects concurrent creation without terminating the first claimed preparation", async () => {
    const f = fixture();
    await f.client.discoverAgentRuntimes({ rootPath: "/project", runtimeId: "cursor", prepareSession: true });
    const pending = Promise.withResolvers<typeof snapshot>();
    f.create.mockReturnValueOnce(pending.promise);
    const first = f.client.createAgentSession({ rootPath: "/project", runtimeId: "cursor" });
    await expect(f.client.createAgentSession({ rootPath: "/project", runtimeId: "cursor" })).rejects.toThrow(/already starting/);
    expect(f.terminate).not.toHaveBeenCalled();
    pending.resolve(snapshot);
    await first;
  });
  it("does not terminate an existing execution after a failed resume request", async () => {
    const f = fixture();
    await f.client.createAgentSession({ rootPath: "/project" });
    f.resume.mockRejectedValueOnce(new Error("temporary request failure"));
    await expect(f.client.resumeAgentSession({ rootPath: "/project", sessionId: "conversation" })).rejects.toThrow(/temporary/);
    expect(f.terminate).not.toHaveBeenCalled();
    await f.client.resumeAgentSession({ rootPath: "/project", sessionId: "conversation" });
    await f.client.terminateAgentExecution?.();
    expect(f.terminate).toHaveBeenCalledOnce();
  });
  it("retains execution identity when a native fork changes its conversation", async () => {
    const f = fixture();
    await f.client.createAgentSession({ rootPath: "/project" });
    await f.client.forkAgentSession({ rootPath: "/project", sessionId: "conversation" });
    await f.client.resumeAgentSession({ rootPath: "/project", sessionId: "fork" });
    const created = f.create.mock.calls[0][0] as { creationId: string };
    expect(f.resume.mock.calls[0][0]).toMatchObject({ creationId: created.creationId });
  });
  it("binds creation before awaiting native readiness and hands off without waiting", async () => {
    const f = fixture();
    let finish!: (value: typeof snapshot) => void;
    f.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const starting = f.client.createAgentSession({ rootPath: "/project" });
    const rejected = expect(starting).rejects.toThrow(/ended during startup/);
    expect(await f.client.terminateAgentExecution?.()).toMatchObject({ kind: "handed-off" });
    expect(f.terminate.mock.calls[0][0]).toMatchObject({ itemId: "agent-item", kind: "agent", projectContext });
    expect(f.create.mock.calls[0][0]).toMatchObject({ creationId: f.terminate.mock.calls[0][0].creationId });
    finish(snapshot);
    await rejected;
    expect(f.create).toHaveBeenCalledOnce();
  });
  it("blocks delayed preparation after closing a tab that has no native session yet", async () => {
    const f = fixture();
    expect(await f.client.terminateAgentExecution?.()).toEqual({ kind: "released" });
    await expect(f.client.createAgentSession({ rootPath: "/project" })).rejects.toThrow(/terminated/);
    expect(f.create).not.toHaveBeenCalled();
  });
  it("seals a failed create before an explicit retry uses a new generation", async () => {
    const f = fixture();
    f.create.mockRejectedValueOnce(new Error("native startup failed"));
    await expect(f.client.createAgentSession({ rootPath: "/project" })).rejects.toThrow(/native startup failed/);
    expect(f.terminate).toHaveBeenCalledOnce();
    await f.client.createAgentSession({ rootPath: "/project" });
    const first = f.create.mock.calls[0][0] as { creationId: string };
    const second = f.create.mock.calls[1][0] as { creationId: string };
    expect(second.creationId).not.toBe(first.creationId);
  });
  it("keeps the same termination identity after a lost receipt", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.client.createAgentSession({ rootPath: "/project" });
    f.terminate.mockImplementationOnce(() => new Promise(() => {}));
    const rejected = expect(f.client.terminateAgentExecution?.()).rejects.toThrow(/unconfirmed/);
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    await f.client.terminateAgentExecution?.();
    expect(f.terminate.mock.calls[1][0]).toEqual(f.terminate.mock.calls[0][0]);
  });
  it("does not remove a view using a receipt from another project generation", async () => {
    const request: ItemExecutionRequest = { kind: "agent", itemId: "item", creationId: "create", operationId: "close", projectContext };
    await expect(handOffItemExecution({ terminateItemExecution: async () => ({ ...receipt(request),
      projectContext: { ...projectContext, generation: "other" } }) }, request)).rejects.toThrow(/does not match/);
  });
});
