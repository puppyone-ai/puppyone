/**
 * Utility process for terminals and Agents that the owner's other computers run
 * in a shared folder. The PTYs live here, never in Main. Main sends the folder
 * root it resolved from this computer's own consent; output goes back to Main,
 * which relays it over the device socket.
 */
import { createTerminalService } from "../../main/terminal-service.mjs";

const port = process.parentPort;
const HOST_SENDER = Object.freeze({ id: 2 ** 31 + 7, isDestroyed: () => false, send() {} });
let terminals = null;

function service(appVersion) {
  terminals ??= createTerminalService({
    appVersion,
    initializeWorkspaceEditReview: async () => {},
    logger: { warn() {}, error() {}, info() {} },
    createOutputTransport: (session) => ({
      write: (data) => port.postMessage({ type: "output", session: session.id, data: String(data) }),
      exit: ({ code }) => port.postMessage({ type: "exit", session: session.id, code: Number.isInteger(code) ? code : null }),
      resize() {},
    }),
  });
  return terminals;
}

port.on("message", async ({ data: message }) => {
  if (!message || typeof message !== "object") return;
  try {
    if (message.type === "open") {
      await service(message.appVersion).create(HOST_SENDER, { id: message.session, launcherId: message.launcher,
        cols: message.cols, rows: message.rows }, message.root);
      port.postMessage({ type: "opened", session: message.session });
    } else if (message.type === "input") {
      terminals?.input(HOST_SENDER, { id: message.session, data: message.data });
    } else if (message.type === "resize") {
      terminals?.resize(HOST_SENDER, { id: message.session, cols: message.cols, rows: message.rows });
    } else if (message.type === "close") {
      await terminals?.close(HOST_SENDER, { id: message.session }).catch(() => {});
    }
  } catch (error) {
    if (message.type === "open") {
      port.postMessage({ type: "failed", session: message.session, message: String(error?.message ?? error) });
    }
  }
});

process.on("uncaughtException", () => process.exit(70));
port.postMessage({ type: "ready" });
