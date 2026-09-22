import type { TerminalCreateRequest, TerminalCreateResult, TerminalExitEvent } from "../../../types/electron";
import type { TerminalBridge, TerminalDisplayData } from "./terminalRuntime";
import { unwrapProjectSessionResult } from "../../../../shared/project-session-contract/schema.mjs";
import { receiveSessionPort } from "../../session-transport/sessionPorts";
import { createHostRpc, type HostRpc } from "../../../../shared/item-host-contract/rpc.mjs";
import { TerminalControlQueue } from "./TerminalControlQueue";
import { handOffItemExecution } from "../../session-transport/itemLifecycleClient";

/** A terminal screen consumes its utility's canonical output through one port. */
export function createTerminalSessionBridge(base: NonNullable<Window["puppyoneDesktop"]>): TerminalBridge {
  const dataListeners = new Set<(event: TerminalDisplayData) => void>();
  const exitListeners = new Set<(event: TerminalExitEvent) => void>();
  const errorListeners = new Set<(message: string) => void>();
  let port: MessagePort | null = null;
  let rpc: HostRpc | null = null;
  let disposed = false;
  let session: TerminalCreateResult | null = null;
  let creation: Promise<TerminalCreateResult> | null = null;
  let creationRequest: TerminalCreateRequest | null = null;
  const creationId = crypto.randomUUID();
  let terminating = false;
  const reportError = (error: Error) => errorListeners.forEach(listener => listener(error.message));
  const controls = new TerminalControlQueue(async (method, request) => {
    // Input typed during startup is bounded by the existing queue, then sent once.
    if (!creation) throw new Error("Terminal session has not started.");
    const receipt = await creation;
    if (terminating || disposed) throw new Error("Terminal input was cancelled by execution termination.");
    if (!rpc) throw new Error("Terminal connection is unavailable. Input was not retried.");
    // Startup input predates the receipt; bind every command to this session.
    return rpc.call(method, [{
      ...(request as Record<string, unknown>),
      id: receipt.id,
      instanceId: receipt.instanceId,
    }]);
  }, reportError);
  const unsubscribeFailure = base.onSessionRuntimeFailure(failure => {
    if (failure.kind === "terminal" && failure.id === session?.id && failure.instanceId === session.instanceId) {
      reportError(new Error(failure.message));
      dispose();
    }
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribeFailure();
    controls.close();
    rpc?.close();
    port?.close();
    rpc = null;
    port = null;
    dataListeners.clear();
    exitListeners.clear();
    errorListeners.clear();
  }

  async function startSession(request: TerminalCreateRequest): Promise<TerminalCreateResult> {
    if (disposed || session) throw new Error("Terminal connection is already used or released.");
    creationRequest = request;
    try {
      const receipt: TerminalCreateResult = unwrapProjectSessionResult(await base.createTerminal({ ...request, creationId }));
      session = receipt;
      if (disposed || terminating) throw new Error("Terminal execution was closed during startup.");
      if (!request.projectContext || !receipt.instanceId) throw new Error("Terminal session identity is unavailable.");
      const binding = await base.connectTerminalSession({ id: receipt.id, instanceId: receipt.instanceId, projectContext: request.projectContext });
      const received = await receiveSessionPort(binding);
      if (disposed) {
        received.close();
        throw new Error("Terminal connection was released.");
      }
      port = received;
      const transport = createHostRpc({ generation: binding.connection, send: message => received.postMessage(message), timeoutMs: 5000 });
      rpc = transport;
      let lastSequence = 0;
      let parsing = false;
      received.onmessage = ({ data }) => {
        if (data?.type !== "terminal-frame") {
          void transport.receive(data);
          return;
        }
        if (disposed || data.connection !== binding.connection) return;
        if (data.sequence !== lastSequence + 1 || parsing || !Array.isArray(data.entries) || data.entries.length > 2048) {
          reportError(new Error("Terminal output sequence was interrupted."));
          dispose();
          return;
        }
        parsing = true;
        void (async () => {
          for (const entry of data.entries as Array<{ data?: string; reset?: boolean; cols?: number; rows?: number; checkpointState?: unknown; exit?: TerminalExitEvent }>) {
            if (disposed) return;
            if (entry.exit) {
              exitListeners.forEach(listener => listener(entry.exit!));
              continue;
            }
            await new Promise<void>(resolve => {
              if (!dataListeners.size) {
                resolve();
                return;
              }
              dataListeners.forEach(listener => listener({
                id: receipt.id,
                instanceId: receipt.instanceId,
                data: entry.data ?? "",
                reset: entry.reset,
                cols: entry.cols,
                rows: entry.rows,
                checkpointState: entry.checkpointState,
                acknowledge: resolve,
              }));
            });
          }
          lastSequence = data.sequence;
          parsing = false;
          if (!disposed) received.postMessage({ type: "terminal-ack", connection: binding.connection, sequence: lastSequence });
        })().catch(error => {
          reportError(error);
          dispose();
        });
      };
      received.addEventListener("close", () => {
        if (disposed) return;
        reportError(new Error("Terminal output connection closed."));
        dispose();
      });
      received.start();
      return receipt;
    } catch (error) {
      dispose();
      // Creation and connection are one operation: failed attachment must not leak a PTY.
      if (session) {
        unwrapProjectSessionResult(await base.closeTerminal({ id: session.id, instanceId: session.instanceId, projectContext: request.projectContext }));
        session = null;
      }
      throw error;
    }
  }

  return {
    canonicalOutput: true,
    createTerminal(request) {
      if (creation) return Promise.reject(new Error("Terminal startup was already requested."));
      creation = startSession(request);
      return creation;
    },
    writeTerminal: request => controls.enqueue("input", request),
    resizeTerminal: request => controls.enqueue("resize", request),
    updateTerminalAppearance: request => controls.enqueue("appearance", request),
    terminateExecution: async () => {
      terminating = true;
      controls.close();
      if (!creationRequest) { dispose(); return { kind: "released" }; }
      dispose();
      const projectContext = creationRequest.projectContext;
      if (!projectContext) throw new Error("Terminal project identity is unavailable.");
      const result = await handOffItemExecution(base, { kind: "terminal", itemId: creationRequest.id!, creationId,
        operationId: `terminate-${creationId}`, projectContext });
      dispose();
      return result;
    },
    openExternalUrl: href => base.openExternalUrl(href),
    async closeTerminal(request) {
      // A failed connection may still own a PTY if rollback itself failed.
      // Retain its receipt until Main confirms closure, so the user can retry.
      if (session) {
        const projectContext = typeof request === "string" ? undefined : request.projectContext;
        unwrapProjectSessionResult(await base.closeTerminal({ id: session.id, instanceId: session.instanceId, projectContext }));
        session = null;
      }
      dispose();
      return true;
    },
    dispose,
    onTerminalData(listener) {
      dataListeners.add(listener);
      return () => { dataListeners.delete(listener); };
    },
    onTerminalExit(listener) {
      exitListeners.add(listener);
      return () => { exitListeners.delete(listener); };
    },
    onTerminalError(listener) {
      errorListeners.add(listener);
      return () => { errorListeners.delete(listener); };
    },
  };
}
