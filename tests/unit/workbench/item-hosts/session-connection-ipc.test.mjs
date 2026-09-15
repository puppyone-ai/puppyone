import { describe, expect, it, vi } from "vitest";
import { registerSessionConnectionIpcHandlers, sendSessionRuntimeFailure } from "../../../../electron/main/ipc/session-connection-ipc.mjs";

function setup() {
  const handlers = new Map();
  const frame = { url:"file:///app/index.html", isDestroyed:vi.fn(() => false), postMessage:vi.fn() };
  const sender = { id:1, mainFrame:frame, isDestroyed:vi.fn(() => false), send:vi.fn() };
  const context = { projectId:"a", generation:"generation-a", rootPath:"/project/a" };
  const request = { projectContext:context, instanceId:"instance-a", id:"terminal-a", sessionId:"agent-a" };
  const operation = { assertCurrent:vi.fn() };
  const ports = [];
  const service = { assertSessionInstance:vi.fn(), attachDisplay:vi.fn(async () => ({ hostGeneration:"host-a" })) };
  const projectSessions = {
    run:vi.fn(async (owner, value, action) => {
      if (owner !== 1 || value !== context) throw new Error("stale project");
      return action(operation);
    }),
    require:vi.fn(() => context),
  };
  class Channel {
    constructor() {
      this.port1 = { close:vi.fn() }; this.port2 = { close:vi.fn() };
      ports.push(this.port1, this.port2);
    }
  }
  registerSessionConnectionIpcHandlers({ ipcMain:{handle:(name, fn) => handlers.set(name, fn)}, MessageChannelMain:Channel,
    projectSessions, agentService:service, terminalService:service });
  return { handlers, frame, sender, request, operation, ports, service };
}

describe("project-owned session connections", () => {
  it.each(["agent:session-connect", "terminal:connect"])("%s binds an existing instance to the originating frame", async channel => {
    const f = setup();
    const result = await f.handlers.get(channel)({ sender:f.sender, senderFrame:f.frame }, f.request);
    expect(f.service.assertSessionInstance).toHaveBeenCalledWith(f.sender, f.request, "/project/a");
    expect(f.frame.postMessage).toHaveBeenCalledWith("session:port", result, [f.ports[1]]);
    expect(result).toEqual({ connection:expect.any(String), hostGeneration:"host-a" });
  });
  it("rejects a stale project before allocating a port", async () => {
    const f = setup();
    await expect(f.handlers.get("terminal:connect")({sender:f.sender, senderFrame:f.frame}, {...f.request, projectContext:{}})).rejects.toThrow("stale project");
    expect(f.ports).toHaveLength(0);
  });
  it("rejects stale session identity before allocating a port", async () => {
    const f = setup();
    f.service.assertSessionInstance.mockImplementation(() => { throw new Error("stale session"); });
    await expect(f.handlers.get("terminal:connect")({sender:f.sender, senderFrame:f.frame}, f.request)).rejects.toThrow("stale session");
    expect(f.ports).toHaveLength(0);
  });
  it.each(["project-close", "page-navigation", "window-close", "attachment-failure"])("releases both ends after %s during connection", async condition => {
    const f = setup();
    f.service.attachDisplay.mockImplementation(async () => {
      if (condition === "project-close") f.operation.assertCurrent.mockImplementation(() => { throw new Error("closed project"); });
      if (condition === "page-navigation") f.frame.url = "file:///other.html";
      if (condition === "window-close") f.sender.isDestroyed.mockReturnValue(true);
      if (condition === "attachment-failure") throw new Error("attachment failed");
      return {hostGeneration:"host-a"};
    });
    await expect(f.handlers.get("terminal:connect")({sender:f.sender, senderFrame:f.frame}, f.request)).rejects.toThrow();
    expect(f.frame.postMessage).not.toHaveBeenCalled();
    f.ports.forEach(port => expect(port.close).toHaveBeenCalledOnce());
  });
  it("reports unexpected runtime failure with instance identity, without treating normal close as a crash", () => {
    const f = setup();
    const record = {id:"terminal-a", instanceId:"instance-a"};
    sendSessionRuntimeFailure(f.sender, "terminal", record, {type:"host-exited", expected:true});
    expect(f.sender.send).not.toHaveBeenCalled();
    sendSessionRuntimeFailure(f.sender, "terminal", record, {type:"host-exited", expected:false});
    expect(f.sender.send).toHaveBeenCalledWith("session:failure", expect.objectContaining({kind:"terminal", ...record}));
  });
});
