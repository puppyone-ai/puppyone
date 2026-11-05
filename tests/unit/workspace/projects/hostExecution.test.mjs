import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHostExecService } from "../../../../electron/main/hosts/host-exec-service.mjs";
import { createHostGitService } from "../../../../electron/main/hosts/host-git-service.mjs";
import { createRemoteExecClient } from "../../../../electron/main/hosts/remote-exec-client.mjs";

const folderId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const session = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function fakeTerminals({ fail = null } = {}) {
  const calls = [];
  let transport;
  const live = new Map();
  return {
    calls, live,
    factory: ({ createOutputTransport }) => ({
      async create(sender, request, root) {
        calls.push({ type: "create", sender: sender.id, request, root });
        if (fail) throw new Error(fail);
        transport = createOutputTransport({ id: request.id });
        live.set(request.id, transport);
      },
      input: (_sender, request) => calls.push({ type: "input", ...request }),
      resize: (_sender, request) => calls.push({ type: "resize", ...request }),
      async close(_sender, request) { calls.push({ type: "close", id: request.id }); live.get(request.id)?.exit({ code: 130 }); },
    }),
    output: (id, text) => live.get(id).write(text),
    exit: (id, code) => live.get(id).exit({ code }),
  };
}

describe("host execution service", () => {
  it("runs only what this computer allows, in the folder, and relays output and exit", async () => {
    let capabilities = ["folder.read", "folder.write", "folder.shell"];
    const terminals = fakeTerminals();
    const changes = [];
    const service = createHostExecService({ createTerminalService: terminals.factory, logger: { warn() {} },
      resolveFolder: async (id) => id === folderId ? { rootPath: "/shared/Work", capabilities } : null,
      onChange: (running) => changes.push(running.length) });
    const frames = [];
    const emit = (frame) => frames.push(frame);
    expect(service.receive({ type: "exec_open", session, folder_id: folderId, kind: "agent", launcher: "claude" }, emit)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frames.pop()).toEqual({ type: "exec_failed", session, error: "not_allowed" });
    service.receive({ type: "exec_open", session, folder_id: folderId, kind: "shell", launcher: "rm -rf /" }, emit);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frames.pop()).toEqual({ type: "exec_failed", session, error: "not_allowed" });

    service.receive({ type: "exec_open", session, folder_id: folderId, kind: "shell", launcher: "shell", cols: 100, rows: 30 }, emit);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frames.pop()).toEqual({ type: "exec_opened", session });
    expect(terminals.calls[0]).toMatchObject({ type: "create", root: "/shared/Work",
      request: { id: session, launcherId: "shell", cols: 100, rows: 30 } });
    expect(service.list()).toMatchObject([{ session, folderId, kind: "shell", launcher: "shell" }]);
    terminals.output(session, "héllo");
    expect(frames.pop()).toEqual({ type: "exec_output", session, data: Buffer.from("héllo").toString("base64") });
    service.receive({ type: "exec_input", session, data: Buffer.from("ls\n").toString("base64") }, emit);
    service.receive({ type: "exec_signal", session, signal: "INT" }, emit);
    expect(terminals.calls.filter((call) => call.type === "input").map((call) => call.data)).toEqual(["ls\n", "\u0003"]);

    // Withdrawn consent ends the running terminal.
    capabilities = ["folder.read", "folder.write"];
    await service.enforce(folderId);
    expect(frames.pop()).toEqual({ type: "exec_exit", session, status: 130 });
    expect(service.list()).toEqual([]);
    expect(changes.at(-1)).toBe(0);
  });

  it("reports a missing Agent instead of starting something else", async () => {
    const terminals = fakeTerminals({ fail: "TERMINAL_AGENT_START_FAILED: claude not found" });
    const service = createHostExecService({ createTerminalService: terminals.factory, logger: { warn() {} },
      resolveFolder: async () => ({ rootPath: "/shared", capabilities: ["folder.read", "folder.write", "folder.agent"] }) });
    const frames = [];
    service.receive({ type: "exec_open", session, folder_id: folderId, kind: "agent", launcher: "claude" }, (frame) => frames.push(frame));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frames).toEqual([{ type: "exec_failed", session, error: "launcher_unavailable" }]);
    expect(service.list()).toEqual([]);
  });
});

describe("host Git service", () => {
  async function repository() {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-git-")));
    roots.push(root);
    const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "host@example.invalid");
    git("config", "user.name", "Host");
    await fs.writeFile(path.join(root, "note.md"), "hello\n");
    return { root, git };
  }

  it("runs named operations with this computer's Git only when allowed", async () => {
    const { root, git } = await repository();
    let capabilities = ["folder.read", "folder.write", "folder.git"];
    const service = createHostGitService({ resolveFolder: async (id) => id === folderId ? { rootPath: root, capabilities } : null });
    const status = await service.run({ folder_id: folderId, op: "status" });
    expect(JSON.stringify(status)).toContain("note.md");
    await service.run({ folder_id: folderId, op: "stage", paths: ["note.md"] });
    await service.run({ folder_id: folderId, op: "commit", message: "From another computer" });
    expect(git("log", "--format=%s").toString().trim()).toBe("From another computer");
    await expect(service.run({ folder_id: folderId, op: "stage", paths: ["../outside"] })).rejects.toMatchObject({ code: "invalid_path" });
    await expect(service.run({ folder_id: folderId, op: "stage", paths: [".git/config"] })).rejects.toMatchObject({ code: "invalid_path" });
    await expect(service.run({ folder_id: folderId, op: "config" })).rejects.toMatchObject({ code: "file_operation_failed" });
    await expect(service.run({ folder_id: folderId, op: "commit", message: "  " })).rejects.toMatchObject({ code: "invalid_content" });
    capabilities = ["folder.read", "folder.write"];
    await expect(service.run({ folder_id: folderId, op: "status" })).rejects.toMatchObject({ code: "folder_unavailable" });
  });
});

describe("remote terminal client", () => {
  class FakeSocket {
    static OPEN = 1;
    static last;
    constructor(url, protocols) {
      this.url = url; this.protocols = protocols; this.readyState = 1; this.sent = []; this.listeners = {};
      FakeSocket.last = this;
      queueMicrotask(() => this.emit("open", {}));
    }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    emit(type, event) { this.listeners[type]?.(event); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.emit("close", {}); }
  }

  it("starts by launcher, relays input as bytes, and reports how it ended", async () => {
    const opened = [];
    const auth = {
      requestSessionApi: async () => ({ gateway_url: "https://devices.puppyone.ai" }),
      openHostExecSocket: async (base, url, expected, WebSocketImpl) => {
        opened.push({ base, url, expected });
        return new WebSocketImpl(url, ["version.bearer.token"]);
      },
    };
    const client = createRemoteExecClient({ auth, apiBase: "https://api.puppyone.ai/api/v1", WebSocketImpl: FakeSocket });
    const events = [];
    const expectedSession = { userId: "u", generation: "g" };
    await expect(client.open({ id: "t1", folderId, kind: "shell", launcher: "bash -c x", expectedSession }, () => {}))
      .rejects.toThrow("Invalid terminal request");
    await client.open({ id: "t1", folderId, kind: "agent", launcher: "codex", cols: 90, rows: 25, expectedSession },
      (event) => events.push(event));
    expect(opened[0].url).toBe(`wss://devices.puppyone.ai/api/v1/hosts/folders/${folderId}/exec`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = FakeSocket.last;
    expect(socket.sent[0]).toEqual({ type: "start", kind: "agent", launcher: "codex", cols: 90, rows: 25 });
    expect(client.input("t1", "ä")).toBe(true);
    expect(socket.sent.at(-1)).toEqual({ type: "input", data: Buffer.from("ä").toString("base64") });
    expect(client.input("other", "x")).toBe(false);
    socket.emit("message", { data: JSON.stringify({ type: "started", session }) });
    socket.emit("message", { data: JSON.stringify({ type: "output", data: "b2s=" }) });
    socket.emit("message", { data: JSON.stringify({ type: "error", code: "not_allowed" }) });
    socket.close();
    expect(events).toEqual([{ type: "started" }, { type: "output", data: "b2s=" }, { type: "error", code: "not_allowed" }]);
    expect(client.input("t1", "x")).toBe(false);
  });
});
