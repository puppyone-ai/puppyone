import type { AgentClientPort } from "../../application/AgentClientPort";
import type { AgentSessionFrame } from "../../domain/agent-contract";
import type { AgentConnectionRequest, SessionConnection, SessionRuntimeFailure } from "../../../../../shared/session-transport/types";
import { createHostRpc, type HostRpc } from "../../../../../shared/item-host-contract/rpc.mjs";
import { receiveSessionPort } from "../../../session-transport/sessionPorts";
import type { ProjectSessionContext } from "../../../../../shared/project-session-contract/types";

/** One controller's transcript connection. Commands retain Main's authorization. */
export function createAgentSessionClient(
  base: AgentClientPort,
  projectContext: ProjectSessionContext,
  connectSession: (request: AgentConnectionRequest) => Promise<SessionConnection>,
  subscribeFailure: (listener: (failure: SessionRuntimeFailure) => void) => () => void,
): AgentClientPort {
  const listeners = new Set<(frame: AgentSessionFrame) => void>();
  let connection: { key: string; ready: Promise<HostRpc>; close: () => void } | null = null;

  function connect(request: { sessionId: string; instanceId?: string }) {
    if (!request.instanceId) return Promise.reject(new Error("Agent instance identity is unavailable."));
    const key = `${request.sessionId}:${request.instanceId}`;
    if (connection?.key === key) return connection.ready;
    connection?.close();
    let disposed = false;
    let port: MessagePort | null = null;
    let rpc: HostRpc | null = null;
    const ready = (async () => {
      const binding = await connectSession({ sessionId: request.sessionId, instanceId: request.instanceId!, projectContext });
      const received = await receiveSessionPort(binding);
      if (disposed) {
        received.close();
        throw new Error("Agent connection was released.");
      }
      port = received;
      const transport = createHostRpc({ generation: binding.connection, send: message => received.postMessage(message) });
      rpc = transport;
      received.onmessage = ({ data }) => {
        if (data?.type === "event" && data.generation === binding.hostGeneration && data.channel === "agent:session-frame") {
          listeners.forEach(listener => listener(data.payload));
        } else void transport.receive(data);
      };
      received.addEventListener("close", () => {
        transport.close();
        if (connection === entry) connection = null;
      });
      received.start();
      return transport;
    })();
    const entry = {
      key,
      ready,
      close() {
        disposed = true;
        rpc?.close();
        port?.close();
      },
    };
    connection = entry;
    void ready.catch(() => { if (connection === entry) connection = null; });
    return ready;
  }

  async function call<T>(method: string, request: { sessionId: string; instanceId?: string }): Promise<T> {
    const rpc = await connect(request);
    return rpc.call(method, [request]) as Promise<T>;
  }
  return {
    ...base,
    attachAgentSession: request => call("attachSession", request),
    acknowledgeAgentSession: request => call("acknowledgeSession", request),
    readAgentSessionWatermark: request => call("readSessionWatermark", request),
    // Cleanup must never open a new connection after its controller is disposed.
    detachAgentSession: request => connection?.key === `${request.sessionId}:${request.instanceId}`
      ? call("detachSession", request)
      : Promise.resolve({ subscriptionId: request.subscriptionId, detached: true }),
    replayAgentSession: request => call("replay", request),
    onAgentSessionFrame(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          connection?.close();
          connection = null;
        }
      };
    },
    onAgentSessionFailure(listener) {
      return subscribeFailure(failure => {
        if (failure.kind === "agent" && connection?.key === `${failure.id}:${failure.instanceId}`) {
          connection.close();
          connection = null;
          listener(failure.message);
        }
      });
    },
  };
}
