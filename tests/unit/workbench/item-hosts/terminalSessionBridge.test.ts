import { describe, expect, it, vi } from "vitest";
import { createTerminalSessionBridge } from "../../../../src/features/desktop-terminal/runtime/terminalSessionBridge";
import type { TerminalDisplayData } from "../../../../src/features/desktop-terminal/runtime/terminalRuntime";
import type { SessionRuntimeFailure } from "../../../../shared/session-transport/types";
import type { TerminalCreateRequest, TerminalCreateResult } from "../../../../src/types/electron";

const { receivePort } = vi.hoisted(() => ({ receivePort:vi.fn() }));
vi.mock("../../../../src/features/session-transport/sessionPorts", () => ({receiveSessionPort:receivePort}));

function setup() {
  const port = {onmessage:null as ((event: {data:unknown}) => void) | null, postMessage:vi.fn(), start:vi.fn(), close:vi.fn(), addEventListener:vi.fn()};
  receivePort.mockResolvedValue(port);
  let failureListener: (failure:SessionRuntimeFailure) => void = () => {};
  const unsubscribe = vi.fn();
  const receipt: TerminalCreateResult = {id:"terminal-a", instanceId:"instance-a", pid:null, shell:"/bin/sh", inputShell:"/bin/sh", cwd:"/a"};
  const base = {
    createTerminal:vi.fn(async () => receipt),
    connectTerminalSession:vi.fn(async () => ({connection:"connection-a", hostGeneration:"host-a"})),
    closeTerminal:vi.fn(async () => true),
    onSessionRuntimeFailure: (listener:typeof failureListener) => {failureListener=listener; return unsubscribe;},
  };
  const bridge = createTerminalSessionBridge(base as unknown as NonNullable<Window["puppyoneDesktop"]>);
  const request: TerminalCreateRequest = {id:receipt.id, rootPath:"/a", cwd:"/a", cols:80, rows:24, projectContext:{projectId:"a", rootPath:"/a", generation:"project-a"}};
  return {bridge, base, port, request, unsubscribe, fail:(failure:SessionRuntimeFailure) => failureListener(failure)};
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("DOM terminal session transport", () => {
  it("queues early input until the session connection is ready without retrying it", async () => {
    const f=setup();
    let finishStartup!: (receipt:Awaited<ReturnType<typeof f.base.createTerminal>>) => void;
    f.base.createTerminal.mockImplementation(() => new Promise(resolve => {finishStartup=resolve;}));
    const errors=vi.fn();
    f.bridge.onTerminalError?.(errors);
    const startup=f.bridge.createTerminal(f.request);
    f.bridge.writeTerminal({...f.request,data:"early input"});
    await flush();
    expect(f.port.postMessage).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    finishStartup({id:"terminal-a",instanceId:"instance-a",pid:null,shell:"/bin/sh",inputShell:"/bin/sh",cwd:"/a"});
    await startup;
    await flush();
    const call=f.port.postMessage.mock.calls[0]?.[0];
    expect(call).toMatchObject({type:"request",method:"input",args:[expect.objectContaining({id:"terminal-a",instanceId:"instance-a",data:"early input"})]});
    f.port.onmessage?.({data:{...call,type:"result",value:true}});
    await flush();
    expect(f.port.postMessage).toHaveBeenCalledOnce();
    f.bridge.dispose?.();
  });
  it("acknowledges canonical output only after the terminal has parsed it", async () => {
    const f=setup();
    const writes:TerminalDisplayData[]=[];
    f.bridge.onTerminalData?.(event => writes.push(event));
    await f.bridge.createTerminal(f.request);
    f.port.onmessage?.({data:{type:"terminal-frame",connection:"connection-a",sequence:1,entries:[{data:"hello"}]}});
    await flush();
    expect(writes[0]?.data).toBe("hello");
    expect(f.port.postMessage).not.toHaveBeenCalled();
    writes[0]?.acknowledge?.();
    await flush();
    expect(f.port.postMessage).toHaveBeenCalledWith({type:"terminal-ack",connection:"connection-a",sequence:1});
    f.bridge.dispose?.();
  });
  it("releases the local screen connection without closing project-owned execution", async () => {
    const f=setup();
    await f.bridge.createTerminal(f.request);
    f.bridge.dispose?.();
    expect(f.port.close).toHaveBeenCalledOnce();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(f.base.closeTerminal).not.toHaveBeenCalled();
  });
  it("closes a newly created PTY when connection setup fails", async () => {
    const f=setup();
    f.base.connectTerminalSession.mockRejectedValue(new Error("connection failed"));
    await expect(f.bridge.createTerminal(f.request)).rejects.toThrow("connection failed");
    expect(f.base.closeTerminal).toHaveBeenCalledWith({id:"terminal-a",instanceId:"instance-a",projectContext:f.request.projectContext});
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
  it("unsubscribes after failed creation without closing an unrelated session", async () => {
    const f=setup();
    f.base.createTerminal.mockRejectedValue(new Error("capacity exceeded"));
    await expect(f.bridge.createTerminal(f.request)).rejects.toThrow("capacity exceeded");
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(f.base.closeTerminal).not.toHaveBeenCalled();
  });
  it("retains the receipt for explicit close when connection rollback fails", async () => {
    const f=setup();
    f.base.connectTerminalSession.mockRejectedValue(new Error("connection failed"));
    f.base.closeTerminal.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(f.bridge.createTerminal(f.request)).rejects.toThrow("cleanup failed");
    await f.bridge.closeTerminal({id:"terminal-a", projectContext:f.request.projectContext});
    expect(f.base.closeTerminal).toHaveBeenLastCalledWith({id:"terminal-a",instanceId:"instance-a",projectContext:f.request.projectContext});
    expect(f.base.closeTerminal).toHaveBeenCalledTimes(2);
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
  it("ignores failures from other instances and surfaces its own runtime failure", async () => {
    const f=setup();
    const fail=vi.fn();
    f.bridge.onTerminalError?.(fail);
    await f.bridge.createTerminal(f.request);
    f.fail({kind:"terminal",id:"terminal-a",instanceId:"old-instance",message:"old failure"});
    expect(fail).not.toHaveBeenCalled();
    f.fail({kind:"terminal",id:"terminal-a",instanceId:"instance-a",message:"runtime failed"});
    expect(fail).toHaveBeenCalledWith("runtime failed");
    expect(f.port.close).toHaveBeenCalledOnce();
  });
  it("fails visibly instead of accepting a skipped output sequence", async () => {
    const f=setup();
    const fail=vi.fn();
    f.bridge.onTerminalError?.(fail);
    await f.bridge.createTerminal(f.request);
    f.port.onmessage?.({data:{type:"terminal-frame",connection:"connection-a",sequence:2,entries:[]}});
    expect(fail).toHaveBeenCalledWith("Terminal output sequence was interrupted.");
    expect(f.port.close).toHaveBeenCalledOnce();
  });
});
