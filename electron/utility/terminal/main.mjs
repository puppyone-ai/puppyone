import { createTerminalService } from "../../main/terminal-service.mjs";
import { runItemHost } from "../item-host-runtime.mjs";
import { createTerminalDisplayStream } from "./terminal-display-stream.mjs";
import { reportNativeProcess } from "../../native-process-ownership.mjs";
import { createHostRpc } from "../../../shared/item-host-contract/rpc.mjs";

runItemHost({
  methods: new Set(["create", "input", "resize", "appearance", "close"]),
  createService({ identity, callMain, emit }) {
    let stream = null;
    const service = createTerminalService({
      appVersion: identity.appVersion,
      initializeWorkspaceEditReview: (root) => callMain("initializeWorkspaceEditReview", [root]),
      terminalAgentActivityHost: {
        prepareTerminalSession: (request) => callMain("prepareTerminalSession", [request]),
        closeTerminalSession: (id) => { void callMain("closeTerminalSession", [id]).catch(() => {}); },
      },
      createOutputTransport(session) {
        const reportExit = reportNativeProcess(session.terminal, { grouped: process.platform !== "win32", subscribeExit: false });
        session.terminal.onExit(reportExit);
        stream = createTerminalDisplayStream({ session, onFailure: emit });
        return stream;
      },
    });
    return { ...service,
      attachDisplay: (port, binding) => stream?.attach(port, binding),
      async closeAll() { await service.closeAll(); stream?.dispose(); },
    };
  },
  onDisplay({ service, owner, port, binding }) {
    const rpc = createHostRpc({ generation: binding.connection, send: (message) => port.postMessage(message),
      maxMessageBytes: 256 * 1024, maxPendingBytes: 512 * 1024, maxPending: 4,
      handle: async (method, args) => {
        if (!["input", "resize", "appearance"].includes(method)) throw new Error("Unsupported terminal display control.");
        const request = args[0];
        if (request?.id !== binding.id || request?.instanceId !== binding.instanceId) throw new Error("Stale terminal display control.");
        return service[method](owner, request);
      },
    });
    port.on("message", ({ data }) => { if (data?.type !== "terminal-ack") void rpc.receive(data).catch(() => port.close()); });
    port.on("close", () => rpc.close());
    service.attachDisplay(port, binding);
  },
});
