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
  const service = createAgentProcessService({ createHost, catalogService: { hasRuntimeResources: () => false, closeAll: async () => {} }, conversationCatalog: {}, attachmentStore: {} });
  return { service, hosts, createHost, sender: { id: 1, hostItemId: "item" }, request: { rootPath: "/project", projectContext: { projectId: "project" } } };
}

describe("per-session Agent process ownership", () => {
  it("releases a crashed item when its native history no longer exists", async () => {
    const { service, hosts, sender, request, createHost } = fixture();
    await service.createSession(sender, request, "/project");
    hosts[0].exited = true;
    const create = createHost.getMockImplementation();
    createHost.mockImplementationOnce(options => {
      const host = create(options);
      host.call.mockResolvedValue(null);
      return host;
    });
    const result = await service.openSession(sender, { ...request, sessionId: "session", instanceId: "instance" }, "/project");
    expect(result).toMatchObject({ status: "failed", error: { code: "SESSION_NOT_FOUND" } });
    expect(service.getSessionCount()).toBe(0);
    expect(hosts[1].exited).toBe(true);
  });
  it("replaces a crashed host once, preserves the conversation, and fences its old instance", async () => {
    const { service, hosts, sender, request, createHost } = fixture();
    await service.createSession(sender, request, "/project");
    hosts[0].exited = true;
    hosts[0].options.onExit({ expected: false });
    const replacement = createHost.getMockImplementation();
    createHost.mockImplementationOnce(options => {
      const host = replacement(options);
      host.call.mockResolvedValue(snapshot("session", "replacement"));
      return host;
    });
    const resume = { ...request, sessionId: "session", instanceId: "instance" };
    const results = await Promise.all([service.resumeSession(sender, resume, "/project"), service.openSession(sender, resume, "/project")]);
    expect(results[0].session.instanceId).toBe("replacement");
    expect(results[1].snapshot.session.id).toBe("session");
    expect(hosts).toHaveLength(2);
    expect(hosts[1].call).toHaveBeenCalledTimes(1);
    expect(hosts[1].call.mock.calls[0][0]).toBe("resumeSession");
    expect(() => service.startTurn(sender, resume, "/project")).toThrow(/owned/);
    hosts[0].options.onExit({ expected: false });
    expect(service.diagnostics()[0].lifecycle.observedLifecycle).toBe("live");
    await service.closeAll();
  });

  it("does not replace a crashed host before cleanup confirmation, and lets close win", async () => {
    const { service, hosts, sender, request } = fixture();
    await service.createSession(sender, request, "/project");
    hosts[0].exited = true;
    const cleanup = Promise.withResolvers();
    hosts[0].close.mockReturnValue(cleanup.promise);
    const resume = service.resumeSession(sender, { ...request, sessionId: "session", instanceId: "instance" }, "/project");
    const rejected = expect(resume).rejects.toMatchObject({ code: "SESSION_STALE" });
    const closed = service.closeItem(1, "item");
    expect(hosts).toHaveLength(1);
    cleanup.resolve();
    await Promise.all([closed, rejected]);
    expect(hosts).toHaveLength(1);
    expect(service.getSessionCount()).toBe(0);
  });

  it("retains ownership after unconfirmed crash cleanup and retries recovery safely", async () => {
    const { service, hosts, sender, request } = fixture();
    await service.createSession(sender, request, "/project");
    hosts[0].exited = true;
    hosts[0].close.mockRejectedValueOnce(Object.assign(new Error("cleanup pending"), { code: "HOST_CLOSE_UNCONFIRMED" }));
    const resume = { ...request, sessionId: "session", instanceId: "instance" };
    await expect(service.resumeSession(sender, resume, "/project")).rejects.toMatchObject({ code: "HOST_CLOSE_UNCONFIRMED" });
    expect(hosts).toHaveLength(1);
    expect(service.getSessionCount()).toBe(1);
    await service.resumeSession(sender, resume, "/project");
    expect(hosts).toHaveLength(2);
    await service.closeAll();
  });

  it("closes a replacement that finishes native startup after its item was closed", async () => {
    const { service, hosts, sender, request, createHost } = fixture();
    await service.createSession(sender, request, "/project");
    hosts[0].exited = true;
    const opened = Promise.withResolvers();
    const replacement = createHost.getMockImplementation();
    createHost.mockImplementationOnce(options => {
      const host = replacement(options);
      host.call.mockReturnValue(opened.promise);
      return host;
    });
    const recovery = service.resumeSession(sender, { ...request, sessionId: "session", instanceId: "instance" }, "/project");
    const rejected = expect(recovery).rejects.toMatchObject({ code: "SESSION_STALE" });
    await vi.waitFor(() => expect(hosts).toHaveLength(2));
    await service.closeItem(1, "item");
    opened.resolve(snapshot("session", "late-instance"));
    await rejected;
    expect(hosts[1].exited).toBe(true);
    expect(service.findItemSession(1, "item")).toBeNull();
  });

  it.each(["createSession", "openSession"])("terminates an item while %s is stalled, before any session identity is published", async method => {
    const { service, hosts, sender, request, createHost } = fixture();
    const pending = Promise.withResolvers();
    const create = createHost.getMockImplementation();
    createHost.mockImplementationOnce(options => {
      const host = create(options);
      host.call.mockReturnValueOnce(pending.promise);
      return host;
    });
    const opening = service[method](sender, { ...request, ...(method === "openSession" ? { sessionId: "saved-session" } : {}) }, "/project");
    expect(service.getSessionCount()).toBe(1);
    expect(service.findItemSession(sender.id, sender.hostItemId)).toBeNull();
    await service.closeItem(sender.id, sender.hostItemId);
    expect(hosts[0].close).toHaveBeenCalledOnce();
    pending.resolve(method === "openSession" ? { status: "opened", snapshot: snapshot("saved-session") } : snapshot());
    await expect(opening).rejects.toMatchObject({ code: "SESSION_STALE" });
    expect(service.findItemSession(sender.id, sender.hostItemId)).toBeNull();
    expect(service.getSessionCount()).toBe(0);
    expect(hosts[0].call).toHaveBeenCalledTimes(1);
  });

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
