import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHostExecService } from "../../../../electron/main/hosts/host-exec-service.mjs";
import { createHostGitService } from "../../../../electron/main/hosts/host-git-service.mjs";
import { createPolicySpawner, detectSandbox } from "../../../../electron/host-service/sandbox.mjs";
import { createSandboxedGit } from "../../../../electron/host-service/sandboxed-git.mjs";

const SEATBELT = { mechanism: "seatbelt", path: "/usr/bin/sandbox-exec" };
import { createRemoteExecClient } from "../../../../electron/main/hosts/remote-exec-client.mjs";
import { HostSshError } from "../../../../electron/main/hosts/ssh/host-ssh-client.mjs";

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

// This computer's real folder sandbox. CI sets PUPPYONE_REQUIRE_SANDBOX so a missing one fails instead of skipping.
const realSandbox = await detectSandbox().catch(() => null);
if (process.env.PUPPYONE_REQUIRE_SANDBOX === "1" && !realSandbox) throw new Error("This runner has no folder sandbox.");

describe("host execution service", () => {
  it("runs only what this computer allows, in the folder, and relays output and exit", async () => {
    let capabilities = ["folder.read", "folder.write", "folder.shell"];
    const terminals = fakeTerminals();
    const changes = [];
    const service = createHostExecService({ createTerminalService: terminals.factory, logger: { warn() {} },
      resolveFolder: async (id) => id === folderId ? { rootPath: "/shared/Work", capabilities } : null,
      executionPolicy: async ({ launcher, rootPath }) => ({ tier: "folder", sandbox: SEATBELT, root: rootPath, launcher }),
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
    // The session carries this computer's execution policy to the PTY process.
    expect(terminals.calls[0]).toMatchObject({ type: "create", root: "/shared/Work",
      request: { id: session, launcherId: "shell", cols: 100, rows: 30,
        policy: { tier: "folder", sandbox: SEATBELT, root: "/shared/Work", launcher: "shell" } } });
    expect(service.list()).toMatchObject([{ session, folderId, kind: "shell", launcher: "shell", tier: "folder" }]);
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
      executionPolicy: async ({ rootPath }) => ({ tier: "folder", sandbox: SEATBELT, root: rootPath }),
      resolveFolder: async () => ({ rootPath: "/shared", capabilities: ["folder.read", "folder.write", "folder.agent"] }) });
    const frames = [];
    service.receive({ type: "exec_open", session, folder_id: folderId, kind: "agent", launcher: "claude" }, (frame) => frames.push(frame));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frames).toEqual([{ type: "exec_failed", session, error: "launcher_unavailable" }]);
    expect(service.list()).toEqual([]);
  });
});

describe("host execution policy", () => {
  it("starts nothing without a policy, and nothing where this computer has no sandbox", async () => {
    const resolveFolder = async () => ({ rootPath: "/shared", capabilities: ["folder.read", "folder.write", "folder.shell"] });
    for (const executionPolicy of [null, async () => { throw Object.assign(new Error("none"), { code: "sandbox_unavailable" }); }]) {
      const terminals = fakeTerminals();
      const service = createHostExecService({ createTerminalService: terminals.factory, logger: { warn() {} },
        resolveFolder, executionPolicy });
      const frames = [];
      service.receive({ type: "exec_open", session, folder_id: folderId, kind: "shell", launcher: "shell" }, (frame) => frames.push(frame));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(frames).toEqual([{ type: "exec_failed", session, error: "sandbox_unavailable" }]);
      expect(terminals.calls).toEqual([]);
    }
  });

  it("wraps every spawn in the folder sandbox and runs nothing else", () => {
    const spawned = [];
    const policies = [{ tier: "folder", sandbox: SEATBELT, root: "/Users/me/Notes", launcher: "codex", appDataDirs: ["/Users/me/Library/Application Support/PuppyOne"] },
      { tier: "computer" }, null, { tier: "everything" }];
    const spawner = createPolicySpawner({ spawn: (file, args, options) => spawned.push({ file, args, options }),
      home: "/Users/me", tempDirs: ["/private/tmp"], takePolicy: () => policies.shift() });
    spawner.spawn("/bin/zsh", ["-l"], { cwd: "/Users/me/Notes", env: { PATH: "/usr/bin" } });
    expect(spawned[0].file).toBe("/usr/bin/sandbox-exec");
    expect(spawned[0].args[0]).toBe("-p");
    expect(spawned[0].args[1]).toContain('(subpath "/Users/me/Notes")');
    expect(spawned[0].args[1]).toContain('(subpath "/Users/me/.codex")');
    expect(spawned[0].args[1]).toContain('(subpath "/Users/me/Library/Application Support/PuppyOne")');
    expect(spawned[0].args.slice(2)).toEqual(["/bin/zsh", "-l"]);
    expect(spawned[0].options.env.HISTFILE).toMatch(/puppyone-host-\d+\.history$/);
    // There is no unsandboxed tier: anything else is refused before a process starts.
    expect(() => spawner.spawn("/bin/zsh", ["-l"], { cwd: "/Users/me/Notes", env: {} })).toThrow("Unknown execution tier");
    expect(() => spawner.spawn("/bin/zsh", [], { env: {} })).toThrow("No execution policy");
    expect(() => spawner.spawn("/bin/zsh", [], { env: {} })).toThrow("Unknown execution tier");
    expect(spawned).toHaveLength(1);
  });

  it.runIf(realSandbox)("runs Git and its hooks inside the folder sandbox", async () => {
    // bubblewrap puts an empty /tmp over the session; keep the test's home outside it.
    const scratch = process.platform === "linux" ? os.homedir() : os.tmpdir();
    const base = await fs.realpath(await fs.mkdtemp(path.join(scratch, ".puppyone-sandboxed-git-")));
    roots.push(base);
    const home = path.join(base, "home");
    const root = path.join(home, "Notes");
    await fs.mkdir(path.join(home, "Documents"), { recursive: true });
    await fs.mkdir(root, { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "host@example.invalid");
    git("config", "user.name", "Host");
    await fs.writeFile(path.join(root, "a.md"), "a\n");
    // A hook someone with folder access planted: it tries to write outside the folder.
    const hook = path.join(root, ".git", "hooks", "pre-commit");
    await fs.writeFile(hook, `#!/bin/sh\necho escaped > "${home}/Documents/escaped.txt" 2>/dev/null\necho ran > hook-ran.txt\nexit 0\n`);
    await fs.chmod(hook, 0o755);
    const sandboxed = createSandboxedGit({ sandbox: realSandbox, root, home, nodePath: process.execPath, tempDirs: [] });
    const service = createHostGitService({ resolveFolder: async () => ({ rootPath: root,
      capabilities: ["folder.read", "folder.write", "folder.git"] }), gitFor: async () => sandboxed });
    expect(await service.run({ folder_id: folderId, op: "status" })).toBeTypeOf("object");
    await service.run({ folder_id: folderId, op: "stage_all" });
    await service.run({ folder_id: folderId, op: "commit", message: "From another computer" });
    expect(git("log", "--format=%s").toString().trim()).toBe("From another computer");
    expect(await fs.readFile(path.join(root, "hook-ran.txt"), "utf8")).toBe("ran\n");
    await expect(fs.access(path.join(home, "Documents", "escaped.txt"))).rejects.toThrow();
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
  /** An SSH channel with a pty, as ssh2 gives it. */
  function fakeChannel() {
    const listeners = new Map();
    const channel = {
      writable: true, written: [], window: null, stderr: { on() {} },
      on(type, fn) { listeners.set(type, fn); return channel; },
      emit(type, ...args) { listeners.get(type)?.(...args); },
      write(data) { channel.written.push(Buffer.from(data).toString()); return true; },
      setWindow(rows, cols) { channel.window = { rows, cols }; },
      close() { channel.writable = false; channel.emit("close"); },
    };
    return channel;
  }

  it("starts a shell or an Agent by launcher inside SSH, relays input as bytes, and reports how it ended", async () => {
    const asked = [];
    let channel;
    const ssh = { get: async (id, expected) => ({ terminal: async (request) => {
      asked.push({ id, expected, ...request });
      if (request.launcher === "cursor") throw new HostSshError("not_allowed");
      channel = fakeChannel();
      return channel;
    } }) };
    const client = createRemoteExecClient({ auth: {}, apiBase: "https://api.puppyone.ai/api/v1", ssh });
    const events = [];
    const expectedSession = { userId: "u", generation: "g" };
    await expect(client.open({ id: "t1", folderId, kind: "shell", launcher: "bash -c x", expectedSession }, () => {}))
      .rejects.toThrow("Invalid terminal request");
    await client.open({ id: "t1", folderId, kind: "agent", launcher: "codex", cols: 90, rows: 25, expectedSession },
      (event) => events.push(event));
    expect(asked).toEqual([{ id: folderId, expected: expectedSession, launcher: "codex", cols: 90, rows: 25 }]);
    expect(client.input("t1", "ä")).toBe(true);
    expect(channel.written).toEqual(["ä"]);
    expect(client.input("other", "x")).toBe(false);
    expect(client.resize("t1", 100, 40)).toBe(true);
    expect(channel.window).toEqual({ rows: 40, cols: 100 });
    expect(client.interrupt("t1")).toBe(true);
    expect(channel.written.at(-1)).toBe("\u0003");
    channel.emit("data", Buffer.from("ok"));
    channel.emit("exit", 0);
    channel.emit("close");
    expect(events).toEqual([{ type: "started" }, { type: "output", data: "ok" }, { type: "exit", status: 0 }]);
    expect(client.input("t1", "x")).toBe(false);

    const refused = [];
    await client.open({ id: "t2", folderId, kind: "agent", launcher: "cursor", expectedSession }, (event) => refused.push(event));
    expect(refused).toEqual([{ type: "error", code: "not_allowed" }]);
  });
});
