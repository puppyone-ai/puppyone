import { describe, expect, it, vi } from "vitest";
import { createItemLifecycleSupervisor } from "../../../../electron/main/item-hosts/item-lifecycle-supervisor.mjs";
import { createAgentProcessService } from "../../../../electron/main/item-hosts/agent-process-service.mjs";
import { createTerminalProcessService } from "../../../../electron/main/item-hosts/terminal-process-service.mjs";
import { registerItemLifecycleIpc } from "../../../../electron/main/ipc/item-lifecycle-ipc.mjs";

const projectContext = { projectId: "project", generation: "generation-1", rootPath: "/project" };
const identity = (kind = "agent", creationId = "creation-a") => ({ ownerId: 1, root: "/project", projectContext,
  kind, itemId: `${kind}-item`, creationId });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe("shared item lifecycle authority", () => {
  it("starts the cleanup deadline at acceptance and records observed exit independently", async () => {
    const lifecycle = createItemLifecycleSupervisor();
    const record = lifecycle.reserve(identity());
    const close = vi.fn(async () => {});
    lifecycle.attach(record, { host: { close } });
    lifecycle.observeExit(record);
    expect(lifecycle.summary(record)).toMatchObject({ observedLifecycle: "exited", desiredLifecycle: "active" });
    const before = performance.now();
    lifecycle.terminate(identity(), "terminate-a");
    const after = performance.now();
    await flush();
    const [{ startedAt }] = close.mock.calls[0];
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);
  });
  it("accepts termination without waiting for a hung host and seals new work", async () => {
    const lifecycle = createItemLifecycleSupervisor();
    const record = lifecycle.reserve(identity());
    const pending = Promise.withResolvers();
    const release = vi.fn();
    lifecycle.attach(record, { host: { close: () => pending.promise }, release });
    const receipt = lifecycle.terminate(identity(), "terminate-a");
    expect(receipt).toMatchObject({ desiredLifecycle: "terminated", operationId: "terminate-a", cleanup: "running" });
    expect(() => lifecycle.assertActive(record)).toThrow(/terminated/);
    expect(release).not.toHaveBeenCalled();
    pending.resolve();
    await flush();
    expect(lifecycle.summary(record).cleanup).toBe("confirmed");
    expect(release).toHaveBeenCalledOnce();
  });

  it.each(["agent", "terminal"])("fences a %s create overtaken by close IPC", async kind => {
    const lifecycle = createItemLifecycleSupervisor();
    lifecycle.terminate(identity(kind), "terminate-before-start");
    await flush();
    expect(() => lifecycle.reserve(identity(kind))).toThrow(/terminated/);
    expect(lifecycle.list()[0].cleanup).toBe("confirmed");
  });

  it("retains failed resources and retries only cleanup with the same receipt", async () => {
    const lifecycle = createItemLifecycleSupervisor();
    const record = lifecycle.reserve(identity());
    const close = vi.fn().mockRejectedValueOnce(new Error("unconfirmed")).mockResolvedValue(undefined);
    const release = vi.fn();
    lifecycle.attach(record, { host: { close }, release });
    lifecycle.terminate(identity(), "same-operation");
    await flush();
    expect(lifecycle.summary(record)).toMatchObject({ cleanup: "unconfirmed", desiredLifecycle: "terminated" });
    expect(release).not.toHaveBeenCalled();
    lifecycle.terminate(identity(), "same-operation");
    expect(close).toHaveBeenCalledOnce();
    lifecycle.terminate(identity(), "same-operation", { retry: true });
    await flush();
    expect(close).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledOnce();
    expect(lifecycle.summary(record).operationId).toBe("same-operation");
  });

  it("deduplicates repeat clicks and rejects operation identity reuse on a different target", async () => {
    const lifecycle = createItemLifecycleSupervisor();
    const record = lifecycle.reserve(identity());
    const close = vi.fn(async () => {});
    lifecycle.attach(record, { host: { close } });
    lifecycle.terminate(identity(), "operation-a");
    lifecycle.terminate(identity(), "operation-a");
    expect(() => lifecycle.terminate(identity("terminal"), "operation-a")).toThrow(/another execution/);
    await flush();
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not terminate a replacement generation or block a Terminal sibling", async () => {
    const lifecycle = createItemLifecycleSupervisor();
    const hung = lifecycle.reserve(identity());
    lifecycle.attach(hung, { host: { close: () => new Promise(() => {}) } });
    lifecycle.terminate(identity(), "close-old");
    const replacement = lifecycle.reserve(identity("agent", "creation-b"));
    const sibling = lifecycle.reserve(identity("terminal"));
    lifecycle.attach(sibling, { host: { close: async () => {} } });
    lifecycle.terminate(identity(), "close-old");
    await lifecycle.close(sibling);
    expect(lifecycle.summary(replacement).desiredLifecycle).toBe("active");
    expect(lifecycle.summary(sibling).cleanup).toBe("confirmed");
    expect(lifecycle.summary(hung).cleanup).toBe("running");
  });
});

describe("domain service integration with the shared supervisor", () => {
  function fixture() {
    const lifecycle = createItemLifecycleSupervisor();
    const hosts = [];
    const createHost = vi.fn(options => {
      const host = { generation: `host-${hosts.length}`, ready: Promise.resolve(), exited: false,
        call: vi.fn(async method => method === "create" ? { id: "terminal-item", instanceId: "pty-instance" }
          : { session: { id: "session", instanceId: "agent-instance", runtimeId: "fixture" } }),
        close: vi.fn(async () => { host.exited = true; }), diagnostics: () => ({}), options };
      hosts.push(host); return host;
    });
    return { lifecycle, hosts, createHost };
  }
  it("uses identical supervision for Agent and Terminal, without an Agent close RPC prerequisite", async () => {
    const f = fixture();
    const agent = createAgentProcessService({ ...f, catalogService: {} });
    const terminal = createTerminalProcessService(f);
    const sender = { id: 1 };
    await agent.createSession(sender, { itemId: "agent-item", creationId: "creation-a", projectContext }, "/project");
    await terminal.create(sender, { id: "terminal-item", creationId: "creation-a", projectContext }, "/project");
    f.hosts[0].close.mockRejectedValueOnce(new Error("host exit pending"));
    f.lifecycle.terminate(identity(), "close-agent");
    f.lifecycle.terminate(identity("terminal"), "close-terminal");
    expect(() => agent.startTurn(sender, { sessionId: "session", instanceId: "agent-instance" }, "/project")).toThrow(/terminated/);
    expect(() => terminal.input(sender, { id: "terminal-item", instanceId: "pty-instance" })).toThrow(/terminated/);
    await flush();
    expect(agent.getRetainedSessionCount()).toBe(1);
    expect(terminal.getSessionCount()).toBe(0);
    expect(f.hosts[0].call).toHaveBeenCalledTimes(1);
    f.lifecycle.terminate(identity(), "close-agent", { retry: true });
    await flush();
    expect(agent.getRetainedSessionCount()).toBe(0);
  });
  it("registers Agent ownership before asynchronous catalog lookup and rejects its late result", async () => {
    const f = fixture();
    const catalog = Promise.withResolvers();
    const agent = createAgentProcessService({ ...f, catalogService: {}, modelConnections: { releaseScope() {} },
      conversationCatalog: { findById: () => catalog.promise } });
    const create = agent.openSession({ id: 1 }, { sessionId: "session", itemId: "agent-item", creationId: "creation-a", projectContext }, "/project");
    expect(f.lifecycle.list()).toHaveLength(1);
    f.lifecycle.terminate(identity(), "close-during-catalog");
    catalog.resolve(null);
    await expect(create).rejects.toThrow(/terminated/);
    expect(f.createHost).not.toHaveBeenCalled();
    expect(agent.getRetainedSessionCount()).toBe(0);
  });
});

describe("management IPC authorization", () => {
  it("uses project generation authorization even while closing, without a live session requirement", async () => {
    const handlers = new Map();
    const lifecycle = createItemLifecycleSupervisor();
    const requireProject = vi.fn((owner, context) => {
      if (owner !== 1 || context?.generation !== projectContext.generation) throw new Error("unauthorized project");
      return projectContext;
    });
    registerItemLifecycleIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, lifecycle,
      projectSessions: { require: requireProject }, manage: vi.fn() });
    const request = { kind: "agent", itemId: "agent-item", creationId: "creation-a", operationId: "close-a", projectContext };
    const terminate = handlers.get("item-execution:terminate");
    expect(await terminate({ sender: { id: 2 } }, request)).toHaveProperty("projectFailure");
    expect(await terminate({ sender: { id: 1 } }, { ...request, projectContext: { ...projectContext, generation: "stale" } })).toHaveProperty("projectFailure");
    expect(lifecycle.list()).toHaveLength(0);
    expect(await terminate({ sender: { id: 1 } }, request)).toMatchObject({ desiredLifecycle: "terminated" });
    expect(requireProject).toHaveBeenLastCalledWith(1, projectContext, { allowClosing: true, allowClosed: true });
  });
});
