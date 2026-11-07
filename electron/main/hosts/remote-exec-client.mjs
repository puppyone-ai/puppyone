import { createHostSshClient, normalize } from "./ssh/host-ssh-client.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9-]{1,100}$/;
const LAUNCHERS = new Set(["shell", "codex", "claude", "cursor", "opencode", "pi", "hermes"]);
const MAX_INPUT_BYTES = 64 * 1024;

/**
 * Access side of a terminal or Agent running on another of the owner's
 * computers: an SSH shell (or `puppyone-agent <launcher>`) with a pty, inside
 * the folder's SSH session (./ssh/host-ssh-client.mjs). The renderer sends
 * keystrokes and receives output by terminal id; the Cloud cannot read either.
 */
export function createRemoteExecClient({ auth, apiBase, ssh = createHostSshClient({ auth, apiBase }) }) {
  const terminals = new Map();

  /** Start a terminal; `emit` receives {type: started|output|exit|error|closed, ...}. */
  async function open({ id, folderId, kind, launcher, cols, rows, expectedSession }, emit) {
    if (!ID.test(id) || !UUID.test(folderId) || !["shell", "agent"].includes(kind) || !LAUNCHERS.has(launcher) ||
        (kind === "agent") === (launcher === "shell")) throw new Error("Invalid terminal request.");
    if (terminals.has(id)) throw new Error("This terminal is already open.");
    const terminal = { channel: null, ended: false };
    terminals.set(id, terminal);
    const end = (event) => {
      if (terminal.ended) return;
      terminal.ended = true;
      terminals.delete(id);
      emit(event);
    };
    try {
      const connection = await ssh.get(folderId, expectedSession);
      const channel = await connection.terminal({ launcher, cols: Number.isInteger(cols) ? cols : 80,
        rows: Number.isInteger(rows) ? rows : 24 });
      if (terminal.ended) { channel.close(); return { id }; }
      terminal.channel = channel;
      let status = null;
      emit({ type: "started" });
      const output = (data) => emit({ type: "output", data: Buffer.from(data).toString("utf8") });
      channel.on("data", output);
      channel.stderr?.on("data", output);
      channel.on("exit", (code) => { status = Number.isInteger(code) ? code : null; });
      channel.on("close", () => end(status === null ? { type: "closed" } : { type: "exit", status }));
    } catch (error) {
      const known = normalize(error);
      end({ type: "error", code: known.code === "network_unavailable" ? "device_disconnected" : known.code });
    }
    return { id };
  }

  const channelOf = (id) => {
    const channel = terminals.get(id)?.channel;
    return channel && channel.writable ? channel : null;
  };

  return Object.freeze({
    open,
    input(id, data) {
      const bytes = Buffer.from(String(data ?? ""), "utf8");
      const channel = channelOf(id);
      if (!channel || bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) return false;
      channel.write(bytes);
      return true;
    },
    resize(id, cols, rows) {
      const channel = channelOf(id);
      if (!channel || !Number.isInteger(cols) || !Number.isInteger(rows)) return false;
      channel.setWindow(rows, cols, 0, 0);
      return true;
    },
    interrupt(id) {
      const channel = channelOf(id);
      if (!channel) return false;
      channel.write("\u0003");
      return true;
    },
    close(id) {
      const terminal = terminals.get(id);
      if (!terminal) return false;
      if (terminal.channel) terminal.channel.close();
      else { terminal.ended = true; terminals.delete(id); }
      return true;
    },
  });
}
