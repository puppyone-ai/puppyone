import { describe, expect, it, vi } from "vitest";
import { createAgentProcessService } from "../../../../electron/main/item-hosts/agent-process-service.mjs";

const snapshot = (id = "session", instanceId = "instance") => ({ session: { id, instanceId, runtimeId: "codex" } });
function fixture() {
  const hosts = [];
  const createHost = vi.fn((options) => {
    const host = { options, generation: `host-${hosts.length}`, pid: 100 + hosts.length, exited: false,
      call: vi.fn(async (method) => method === "openSession" ? { snapshot: snapshot() } : snapshot()),
      close: vi.fn(async () => { host.exited = true; }), attachPort: vi.fn(), diagnostics: () => ({}) };
    hosts.push(host);
    return host;
  });
  const service = createAgentProcessService({ createHost, catalogService: { hasRuntimeResources: () => false }, conversationCatalog: {}, attachmentStore: {} });
  return { service, hosts, createHost, sender: { id: 1, hostItemId: "item" }, request: { rootPath: "/project", projectContext: { projectId: "project" } } };
}

describe("per-session Agent process ownership", () => {
  it("releases an unavailable resumed conversation so the item can start a new one", async () => {
    const { service, hosts, sender, request } = fixture();
    await service.createSession(sender, request, "/project");
    hosts[0].call.mockResolvedValueOnce(null);
    expect(await service.resumeSession(sender, { sessionId: "session", instanceId: "instance" }, "/project")).toBeNull();
    expect(hosts[0].close).toHaveBeenCalledOnce();
    await service.closeSession(sender, { sessionId: "session", instanceId: "instance" }, "/project");
    await service.createSession(sender, request, "/project");
    expect(hosts).toHaveLength(2);
    await service.closeItem(1, "item");
  });

  it("rebinds a resumed runtime instance and rejects commands from before recovery", async () => {
    const { service, hosts, sender, request } = fixture();
    await service.createSession(sender, request, "/project");
    hosts[0].call.mockResolvedValueOnce(snapshot("session", "recovered-instance"));
    await service.resumeSession(sender, { sessionId: "session", instanceId: "instance" }, "/project");
    expect(hosts).toHaveLength(1);
    expect(service.findItemSession(1, "item").instanceId).toBe("recovered-instance");
    expect(() => service.startTurn(sender, { sessionId: "session", instanceId: "instance" }, "/project")).toThrow(/owned/);
    await service.startTurn(sender, { sessionId: "session", instanceId: "recovered-instance" }, "/project");
    await service.closeItem(1, "item");
  });

  it("does not resurrect an item closed while resume is pending", async () => {
    const { service, hosts, sender, request } = fixture();
    await service.createSession(sender, request, "/project");
    const pending = Promise.withResolvers();
    hosts[0].call.mockReturnValueOnce(pending.promise);
    const resumed = service.resumeSession(sender, { sessionId: "session", instanceId: "instance" }, "/project");
    await service.closeItem(1, "item");
    pending.resolve(snapshot("session", "recovered-instance"));
    await expect(resumed).rejects.toThrow(/owned/);
    expect(service.findItemSession(1, "item")).toBeNull();
    expect(service.getSessionCount()).toBe(0);
  });

  it("keeps one utility per item and rejects cross-item/session/project commands", async () => {
    const { service, hosts, sender, request } = fixture();
    await service.createSession(sender, request, "/project");
    await expect(service.createSession(sender, request, "/project")).rejects.toThrow(/already owns/);
    const command = { sessionId: "session", instanceId: "instance" };
    expect(() => service.startTurn({ id: 2 }, command, "/project")).toThrow(/owned/);
    expect(() => service.startTurn({ ...sender, hostItemId: "other" }, command, "/project")).toThrow(/owned/);
    expect(() => service.startTurn(sender, command, "/other")).toThrow(/owned/);
    expect(() => service.startTurn(sender, { ...command, instanceId: "stale" }, "/project")).toThrow(/owned/);
    await service.startTurn(sender, command, "/project");
    expect(hosts[0].call).toHaveBeenLastCalledWith("startTurn", [command, "/project"]);
    await service.closeItem(1, "item");
    expect(service.getSessionCount()).toBe(0);
  });

  it("retains failed cleanup ownership and retries only cleanup, not commands", async () => {
    const { service, hosts, sender, request } = fixture();
    await service.createSession(sender, request, "/project");
    hosts[0].close.mockRejectedValueOnce(new Error("exit unconfirmed"));
    await expect(service.closeItem(1, "item")).rejects.toThrow(/incomplete/);
    expect(service.getRetainedSessionCount()).toBe(1);
    await service.closeItem(1, "item");
    expect(service.getRetainedSessionCount()).toBe(0);
    expect(hosts[0].call).toHaveBeenCalledTimes(1);
  });

  it("reserves native history before asynchronous open, including another item", async () => {
    const { service, hosts, sender, request } = fixture();
    const creation = service.openSession(sender, { ...request, sessionId: "session" }, "/project");
    await expect(service.openSession({ ...sender, hostItemId: "other" }, { ...request, sessionId: "session" }, "/project")).rejects.toThrow(/already opening/);
    await creation;
    expect(hosts).toHaveLength(1);
    await service.closeItem(1, "item");
  });

  it("rebinds a fork's native identity without allowing stale commands", async () => {
    const { service, hosts, sender, request } = fixture();
    await service.createSession(sender, request, "/project");
    hosts[0].call.mockResolvedValueOnce(snapshot("fork", "fork-instance"));
    await service.forkSession(sender, { sessionId: "session", instanceId: "instance" }, "/project");
    expect(() => service.assertSessionInstance(sender, { sessionId: "session", instanceId: "instance" }, "/project")).toThrow(/owned/);
    expect(service.findItemSession(1, "item").instanceId).toBe("fork-instance");
    await service.closeItem(1, "item");
  });

  it("closes late native startup when the project generation is no longer current", async () => {
    const { service, hosts, sender, request } = fixture();
    const assertCurrent = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error("project closed"); });
    await expect(service.createSession(sender, request, "/project", { assertCurrent })).rejects.toThrow(/project closed/);
    expect(hosts[0].close).toHaveBeenCalledOnce();
    expect(service.getSessionCount()).toBe(0);
  });
});
