import { describe, expect, it, vi } from "vitest";
import { createAgentSessionClient } from "../../../../src/features/desktop-agent/infrastructure/electron/agentSessionClient";
import type { AgentClientPort } from "../../../../src/features/desktop-agent/application/AgentClientPort";
import type { SessionRuntimeFailure } from "../../../../shared/session-transport/types";

const { receivePort } = vi.hoisted(() => ({receivePort:vi.fn()}));
vi.mock("../../../../src/features/session-transport/sessionPorts", () => ({receiveSessionPort:receivePort}));

function setup() {
  const request = {rootPath:"/a", sessionId:"agent-a", instanceId:"instance-a"};
  const calls:unknown[]=[];
  const port = {
    onmessage:null as ((event:{data:unknown}) => void) | null,
    start:vi.fn(), close:vi.fn(), addEventListener:vi.fn(),
    postMessage(message:{id:number;version:number;generation:string;method:string}) {
      calls.push(message);
      queueMicrotask(() => port.onmessage?.({data:{...message, type:"result", value:{subscriptionId:"feed-a"}}}));
    },
  };
  receivePort.mockResolvedValue(port);
  const connect=vi.fn(async () => ({connection:"connection-a",hostGeneration:"host-a"}));
  let failureListener: (failure:SessionRuntimeFailure) => void = () => {};
  const base = {startAgentTurn:vi.fn(async () => ({sessionId:"agent-a",turnId:"turn-a"}))};
  const client=createAgentSessionClient(base as unknown as AgentClientPort,
    {rootPath:"/a", projectId:"a", generation:"project-a"}, connect,
    listener => {failureListener=listener; return vi.fn();});
  return {client,connect,port,calls,request,base,fail:(failure:SessionRuntimeFailure) => failureListener(failure)};
}

describe("project controller transcript connection", () => {
  it("reuses one port for a session and keeps commands on the authorized client", async () => {
    const f=setup();
    const release=f.client.onAgentSessionFrame!(vi.fn());
    await f.client.attachAgentSession!(f.request);
    await f.client.readAgentSessionWatermark!({...f.request,subscriptionId:"feed-a"});
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.calls).toHaveLength(2);
    expect(f.client.startAgentTurn).toBe(f.base.startAgentTurn);
    release();
    await f.client.detachAgentSession!({...f.request,subscriptionId:"feed-a"});
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.port.close).toHaveBeenCalledOnce();
  });
  it("accepts only current-host frames and reports failures only for the current instance", async () => {
    const f=setup();
    const frame=vi.fn(), failed=vi.fn();
    const release=f.client.onAgentSessionFrame!(frame);
    f.client.onAgentSessionFailure!(failed);
    await f.client.attachAgentSession!(f.request);
    f.port.onmessage?.({data:{type:"event",generation:"old-host",channel:"agent:session-frame",payload:{revision:1}}});
    expect(frame).not.toHaveBeenCalled();
    f.port.onmessage?.({data:{type:"event",generation:"host-a",channel:"agent:session-frame",payload:{revision:2}}});
    expect(frame).toHaveBeenCalledWith({revision:2});
    f.fail({kind:"agent",id:"agent-a",instanceId:"old-instance",message:"old failure"});
    expect(failed).not.toHaveBeenCalled();
    f.fail({kind:"agent",id:"agent-a",instanceId:"instance-a",message:"runtime stopped"});
    expect(failed).toHaveBeenCalledWith("runtime stopped");
    release();
  });
});
