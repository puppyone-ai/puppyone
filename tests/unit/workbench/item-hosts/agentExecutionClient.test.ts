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
  const create = vi.fn(async (_input: unknown) => snapshot);
  const terminate = vi.fn(async (request: ItemExecutionRequest) => receipt(request));
  const client = createManagedAgentClient({ createAgentSession: create } as unknown as AgentClientPort,
    { terminateItemExecution: terminate, listItemExecutions: async () => [], retryItemExecutionCleanup: terminate }, projectContext, "agent-item");
  return { client, create, terminate };
}

describe("Agent adaptation of shared item management", () => {
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
