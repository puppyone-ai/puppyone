import type { AgentClientPort } from "../../application/AgentClientPort";
import type { AgentSessionFrame } from "../../domain/agent-contract";
import type { ItemHostBootstrap } from "../../../../../shared/item-host-contract/types";
import { createHostRpc, type HostRpc } from "../../../../../shared/item-host-contract/rpc.mjs";
import { receiveDisplayPort } from "../../../app-shell/auxiliary-workbench/host/displayPorts";

/** Session snapshots and feeds travel directly between this page and its utility. */
export function createHostedAgentClient(base: AgentClientPort, bootstrap: ItemHostBootstrap): AgentClientPort {
  const listeners = new Set<(frame: AgentSessionFrame) => void>();
  const instances = new Map<string, string>();
  if (bootstrap.session) instances.set(bootstrap.session.sessionId, bootstrap.session.instanceId);
  let active: { key: string; promise: Promise<HostRpc>; port?: MessagePort } | null = null;
  const connect = (request: { sessionId: string; instanceId?: string }) => {
    const instanceId = request.instanceId ?? instances.get(request.sessionId);
    if (!instanceId) return Promise.reject(new Error("Agent instance identity is unavailable."));
    const key = `${request.sessionId}:${instanceId}`;
    if (active?.key === key) return active.promise;
    active?.port?.close();
    const entry: NonNullable<typeof active> = { key, promise: Promise.resolve(null as unknown as HostRpc) };
    entry.promise = (async () => {
      const binding = await window.puppyoneItemHost!.connectAgent({ sessionId: request.sessionId, instanceId });
      const { port } = await receiveDisplayPort(binding);
      entry.port = port;
      const rpc = createHostRpc({ generation: binding.connection, send: (message) => port.postMessage(message) });
      port.onmessage = ({ data }) => {
        if (data?.type === "event" && data.generation === binding.hostGeneration && data.channel === "agent:session-frame") {
          listeners.forEach((listener) => listener(data.payload));
        } else void rpc.receive(data);
      };
      port.addEventListener("close", () => { rpc.close(); if (active === entry) active = null; });
      port.start();
      return rpc;
    })();
    active = entry;
    void entry.promise.catch(() => { if (active === entry) active = null; });
    return entry.promise;
  };
  const native = Object.fromEntries(Object.entries(base).map(([name, method]) => [name,
    typeof method === "function" && !name.startsWith("on") ? async (request: Record<string, unknown>) => {
      const result = await method(request);
      const snapshot = result?.snapshot ?? result;
      if (snapshot?.session?.instanceId) instances.set(snapshot.session.id, snapshot.session.instanceId);
      return result;
    } : method,
  ]));
  const direct = Object.fromEntries([
    ["attachAgentSession", "attachSession"], ["acknowledgeAgentSession", "acknowledgeSession"],
    ["readAgentSessionWatermark", "readSessionWatermark"], ["detachAgentSession", "detachSession"], ["replayAgentSession", "replay"],
  ].map(([name, method]) => [name, async (request: { sessionId: string; instanceId?: string }) => {
    const rpc = await connect(request);
    return rpc.call(method!, [{ ...request, instanceId: request.instanceId ?? instances.get(request.sessionId) }]);
  }]));
  return { ...native, ...direct, onAgentSessionFrame: (listener: (frame: AgentSessionFrame) => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } } as unknown as AgentClientPort;
}
