/**
 * Utility process for terminals and Agents that the owner's other computers run
 * in a shared folder. The PTYs live here, never in Main. Main sends the folder
 * root it resolved from this computer's own consent, and the execution policy:
 * the folder tier runs inside the OS sandbox, the whole-computer tier as this
 * user. A session without a policy never starts. Output goes back to Main,
 * which relays it to the computer that asked.
 */
import pty from "node-pty";
import { createTerminalService } from "../../main/terminal-service.mjs";
import { createPolicySpawner } from "../../host-service/sandbox.mjs";

const port = process.parentPort;
const HOST_SENDER = Object.freeze({ id: 2 ** 31 + 7, isDestroyed: () => false, send() {} });
let terminals = null;
// Opens run one at a time, so the policy set for an open is the one its spawn uses.
let opening = Promise.resolve();
let pendingPolicy = null;

function service(appVersion) {
  terminals ??= createTerminalService({
    appVersion,
    initializeWorkspaceEditReview: async () => {},
    logger: { warn() {}, error() {}, info() {} },
    ptyService: createPolicySpawner({ spawn: pty.spawn, takePolicy: () => { const policy = pendingPolicy; pendingPolicy = null; return policy; } }),
    createOutputTransport: (session) => ({
      write: (data) => port.postMessage({ type: "output", session: session.id, data: String(data) }),
      exit: ({ code }) => port.postMessage({ type: "exit", session: session.id, code: Number.isInteger(code) ? code : null }),
      resize() {},
    }),
  });
  return terminals;
}

async function open(message) {
  const policy = message.policy;
  if (!policy || (policy.tier === "folder" && policy.root !== message.root)) {
    throw new Error("No execution policy for this session.");
  }
  pendingPolicy = policy;
  try {
    await service(message.appVersion).create(HOST_SENDER, { id: message.session, launcherId: message.launcher,
      cols: message.cols, rows: message.rows }, message.root);
  } finally {
    pendingPolicy = null;
  }
}

if (port) {
  port.on("message", async ({ data: message }) => {
    if (!message || typeof message !== "object") return;
    try {
      if (message.type === "open") {
        const current = opening.catch(() => {}).then(() => open(message));
        opening = current;
        await current;
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
}
