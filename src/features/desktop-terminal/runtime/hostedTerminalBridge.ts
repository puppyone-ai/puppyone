import type { TerminalCreateResult, TerminalExitEvent } from "../../../types/electron";
import type { ItemHostBootstrap } from "../../../../shared/item-host-contract/types";
import type { TerminalBridge, TerminalDisplayData } from "./terminalRuntime";
import { receiveDisplayPort } from "../../app-shell/auxiliary-workbench/host/displayPorts";
import { createHostRpc, type HostRpc } from "../../../../shared/item-host-contract/rpc.mjs";
import { TerminalControlQueue } from "./TerminalControlQueue";

export function createHostedTerminalBridge(bootstrap: ItemHostBootstrap): TerminalBridge {
  const base = window.puppyoneDesktop!;
  const dataListeners = new Set<(event: TerminalDisplayData) => void>();
  const exitListeners = new Set<(event: TerminalExitEvent) => void>();
  let port: MessagePort | null = null;
  let receipt: TerminalCreateResult;
  let rpc: HostRpc | null = null;
  let connected!: () => void;
  const ready = new Promise<void>((resolve) => { connected = resolve; });
  const controls = new TerminalControlQueue(async (method, request) => {
    await ready;
    if (!rpc) throw new Error("Terminal display disconnected. Input was not retried.");
    return rpc.call(method, [request]);
  }, (error) => window.puppyoneItemHost!.publish("display-error", error.message));
  return {
    canonicalOutput: true,
    async createTerminal() {
      const result = await window.puppyoneItemHost!.connectTerminal() as TerminalCreateResult & { connection: string; hostGeneration: string };
      receipt = result;
      const connection = await receiveDisplayPort(result);
      port = connection.port;
      const displayPort = port;
      rpc = createHostRpc({ generation: result.connection, send: (message) => displayPort.postMessage(message), timeoutMs: 5000 });
      connected();
      let lastSequence = 0;
      let parsing = false;
      port.onmessage = ({ data }) => {
        if (data?.type !== "terminal-frame") { void rpc?.receive(data); return; }
        if (data?.type !== "terminal-frame" || data.connection !== result.connection || data.sequence !== lastSequence + 1 || parsing) return;
        if (!Array.isArray(data.entries) || data.entries.length > 2048) { port?.close(); return; }
        parsing = true;
        void (async () => {
          for (const entry of data.entries as Array<{ data?: string; reset?: boolean; cols?: number; rows?: number; checkpointState?: unknown; exit?: TerminalExitEvent }>) {
            if (entry.exit) { exitListeners.forEach((listener) => listener(entry.exit!)); continue; }
            await new Promise<void>((resolve) => {
              if (!dataListeners.size) return;
              dataListeners.forEach((listener) => listener({ id: bootstrap.itemId, instanceId: receipt.instanceId,
                data: entry.data ?? "", reset: entry.reset, cols: entry.cols, rows: entry.rows, checkpointState: entry.checkpointState, acknowledge: resolve }));
            });
          }
          lastSequence = data.sequence;
          parsing = false;
          port?.postMessage({ type: "terminal-ack", connection: result.connection, sequence: lastSequence });
        })();
      };
      port.start();
      return result;
    },
    writeTerminal: (request) => controls.enqueue("input", request),
    resizeTerminal: (request) => controls.enqueue("resize", request),
    updateTerminalAppearance: (request) => controls.enqueue("appearance", request),
    openExternalUrl: (href) => base.openExternalUrl(href),
    // Display disposal never owns execution shutdown. The Shell closes the
    // utility explicitly and then releases this Renderer.
    closeTerminal: async () => { controls.close(); rpc?.close(); rpc = null; connected(); port?.close(); port = null; return true; },
    onTerminalData: (listener) => { dataListeners.add(listener); return () => { dataListeners.delete(listener); }; },
    onTerminalExit: (listener) => { exitListeners.add(listener); return () => { exitListeners.delete(listener); }; },
  };
}
