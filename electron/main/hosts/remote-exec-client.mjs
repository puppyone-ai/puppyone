import { resolveCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9-]{1,100}$/;
const LAUNCHERS = new Set(["shell", "codex", "claude", "cursor", "opencode", "pi", "hermes"]);
const MAX_INPUT_BYTES = 64 * 1024;

/**
 * Access side of a terminal or Agent running on another of the owner's
 * computers. One WebSocket per terminal, opened by Main with the account's
 * token; the renderer sends keystrokes and receives output by terminal id.
 */
export function createRemoteExecClient({ auth, apiBase, WebSocketImpl = globalThis.WebSocket }) {
  const deployment = resolveCloudApiBaseUrl(apiBase);
  const terminals = new Map();

  async function socketUrl(folderId, expectedSession) {
    const catalog = await auth.requestSessionApi(deployment, "/hosts", { method: "GET" }, expectedSession);
    const base = typeof catalog?.gateway_url === "string" && catalog.gateway_url ? catalog.gateway_url
      : new URL(deployment).origin;
    const url = new URL(`/api/v1/hosts/folders/${folderId}/exec`, base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  /** Start a terminal; `emit` receives {type: started|output|exit|error|closed, ...}. */
  async function open({ id, folderId, kind, launcher, cols, rows, expectedSession }, emit) {
    if (!ID.test(id) || !UUID.test(folderId) || !["shell", "agent"].includes(kind) || !LAUNCHERS.has(launcher) ||
        (kind === "agent") === (launcher === "shell")) throw new Error("Invalid terminal request.");
    if (terminals.has(id)) throw new Error("This terminal is already open.");
    const ws = await auth.openHostExecSocket(deployment, await socketUrl(folderId, expectedSession),
      expectedSession, WebSocketImpl);
    const terminal = { ws, ended: false };
    terminals.set(id, terminal);
    const end = (event) => {
      if (terminal.ended) return;
      terminal.ended = true;
      terminals.delete(id);
      emit(event);
    };
    const start = () => ws.send(JSON.stringify({ type: "start", kind, launcher,
      cols: Number.isInteger(cols) ? cols : 80, rows: Number.isInteger(rows) ? rows : 24 }));
    // The socket may already be open by the time it reaches us.
    if (ws.readyState === WebSocketImpl.OPEN) start();
    else ws.addEventListener("open", start, { once: true });
    ws.addEventListener("message", (event) => {
      let frame;
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      if (frame?.type === "output" && typeof frame.data === "string") emit({ type: "output", data: frame.data });
      else if (frame?.type === "started") emit({ type: "started" });
      else if (frame?.type === "exit") end({ type: "exit", status: Number.isInteger(frame.status) ? frame.status : null });
      else if (frame?.type === "error") end({ type: "error", code: typeof frame.code === "string" ? frame.code : "start_failed" });
    });
    ws.addEventListener("close", () => end({ type: "closed" }));
    ws.addEventListener("error", () => end({ type: "error", code: "device_disconnected" }));
    return { id };
  }

  function send(id, frame) {
    const terminal = terminals.get(id);
    if (!terminal || terminal.ws.readyState !== WebSocketImpl.OPEN) return false;
    terminal.ws.send(JSON.stringify(frame));
    return true;
  }

  return Object.freeze({
    open,
    input(id, data) {
      if (typeof data !== "string" || !data) return false;
      const bytes = Buffer.from(data, "utf8");
      if (bytes.length > MAX_INPUT_BYTES) return false;
      return send(id, { type: "input", data: bytes.toString("base64") });
    },
    resize(id, cols, rows) {
      return Number.isInteger(cols) && Number.isInteger(rows) && send(id, { type: "resize", cols, rows });
    },
    interrupt(id) { return send(id, { type: "signal", signal: "INT" }); },
    close(id) {
      const terminal = terminals.get(id);
      if (!terminal) return false;
      send(id, { type: "close" });
      terminal.ws.close();
      return true;
    },
    closeAll() { for (const id of [...terminals.keys()]) this.close(id); },
  });
}
