import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHostSshServer } from "../../../../electron/host-service/ssh/host-ssh-server.mjs";
import { createHostFileService } from "../../../../electron/main/hosts/host-file-service.mjs";
import { createHostSshClient } from "../../../../electron/main/hosts/ssh/host-ssh-client.mjs";
import { createRemoteHostClient } from "../../../../electron/main/hosts/remote-host-client.mjs";
import { createRemoteExecClient } from "../../../../electron/main/hosts/remote-exec-client.mjs";
import {
  ED25519_CERT, ed25519PublicBlob, ed25519Raw, openSshPrivateKey, parseCertificate, parsePublicKeyLine,
  rawEd25519PublicKey, verifyUserCertificate,
} from "../../../../electron/main/hosts/ssh/openssh.mjs";

const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const deviceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const folderId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherFolder = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const apiBase = "https://api.puppyone.ai/api/v1";

const u32 = (value) => { const out = Buffer.alloc(4); out.writeUInt32BE(value); return out; };
const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64BE(BigInt(value)); return out; };
const str = (value) => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); return Buffer.concat([u32(bytes.length), bytes]); };

/** What the Cloud's authority issues (asyncssh in production): an Ed25519 user certificate. */
function issue(ca, userPublicLine, { keyId = `user:${account}`, principals = [deviceId], validAfter, validBefore, critical = [] } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const caBlob = ed25519PublicBlob(ed25519Raw(ca).publicKey);
  const body = Buffer.concat([str(ED25519_CERT), str(crypto.randomBytes(32)), str(rawEd25519PublicKey(parsePublicKeyLine(userPublicLine))),
    u64(1), u32(1), str(keyId), str(Buffer.concat(principals.map((item) => str(item)))),
    u64(validAfter ?? now - 60), u64(validBefore ?? now + 300),
    str(Buffer.concat(critical.flatMap(([name, data]) => [str(name), str(str(data))]))),
    str(Buffer.concat([str("permit-pty"), str("")])), str(""), str(caBlob)]);
  const signature = crypto.sign(null, body, ca);
  return `${ED25519_CERT} ${Buffer.concat([body, str(Buffer.concat([str("ssh-ed25519"), str(signature)]))]).toString("base64")}`;
}

function pair() {
  let left, right;
  // Like a socket, bytes arrive on a later turn of the event loop.
  const make = (other) => new Duplex({ read() {},
    write(chunk, _e, cb) { setImmediate(() => other().push(chunk)); cb(); },
    final(cb) { setImmediate(() => other().push(null)); cb(); } });
  left = make(() => right); right = make(() => left);
  return [left, right];
}

/** A tunnel socket as Main sees it: `ready`, then binary messages carrying the host's SSH bytes. */
function tunnelSocketTo(server, folder, refusal = null) {
  return class TunnelSocket {
    constructor() {
      this.readyState = 1; this.listeners = { message: new Set(), close: new Set(), error: new Set() };
      const [client, host] = pair();
      this.stream = client;
      client.on("data", (chunk) => this.emit("message", { data: new Uint8Array(chunk).buffer }));
      client.on("end", () => this.close());
      setTimeout(async () => {
        if (refusal) { this.emit("message", { data: JSON.stringify({ type: "error", code: refusal }) }); return; }
        this.emit("message", { data: JSON.stringify({ type: "ready" }) });
        await server.accept(host, { folderId: folder });
      }, 0);
    }
    addEventListener(type, fn) { this.listeners[type]?.add(fn); }
    removeEventListener(type, fn) { this.listeners[type]?.delete(fn); }
    emit(type, event) { for (const fn of [...this.listeners[type]]) fn(event); }
    send(data) { this.stream.write(Buffer.from(data)); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.stream.end(); this.emit("close", {}); }
  };
}

describe("host SSH: certificate login, files, terminals and commands, end to end", () => {
  let root, ca, hostKey, folders, server, sshOptions, terminalsSeen, makeServer, tunnelsOpened;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "host-ssh-")));
    await fs.writeFile(path.join(root, "note.md"), "# note\n");
    ca = crypto.generateKeyPairSync("ed25519").privateKey;
    hostKey = crypto.generateKeyPairSync("ed25519").privateKey;
    folders = new Map([[folderId, { rootPath: root, state: "active", capabilities: ["folder.read", "folder.write"] }]]);
    const resolveFolder = async (id) => folders.get(id) ?? null;
    terminalsSeen = [];
    const sessions = new Map();
    // The host's terminal service: an echoing terminal is enough to prove the plumbing.
    const execService = {
      receive(message, emit) {
        if (message.type === "exec_open") {
          terminalsSeen.push({ kind: message.kind, launcher: message.launcher, cols: message.cols, rows: message.rows });
          sessions.set(message.session, emit);
          emit({ type: "exec_opened", session: message.session });
          emit({ type: "exec_output", session: message.session, data: Buffer.from("$ ").toString("base64") });
        } else if (message.type === "exec_input") {
          const text = Buffer.from(message.data, "base64").toString();
          const emitTo = sessions.get(message.session);
          if (text.trim() === "exit") { sessions.delete(message.session); emitTo?.({ type: "exec_exit", session: message.session, status: 0 }); }
          else emitTo?.({ type: "exec_output", session: message.session, data: Buffer.from(`you said ${text}`).toString("base64") });
        } else if (message.type === "exec_close") sessions.delete(message.session);
        return true;
      },
      enforce: async () => {},
    };
    makeServer = (overrides = {}) => createHostSshServer({
      hostKey: async () => openSshPrivateKey(hostKey),
      authorities: async () => [ed25519PublicBlob(ed25519Raw(ca).publicKey)],
      active: () => ({ accountId: account, deviceId }),
      resolveFolder, fileService: createHostFileService({ resolveFolder }), execService,
      executionPolicy: async () => ({ tier: "folder", sandbox: { mechanism: "bubblewrap", path: "/usr/bin/bwrap" }, appDataDirs: [] }),
      // The test runs the command itself; the sandbox wrapping is covered by the sandbox tests.
      spawn: (_file, args, options) => spawn("/bin/sh", ["-c", args.at(-1)], options),
      logger: { warn() {} },
      ...overrides,
    });
    server = makeServer();
    sshOptions = { tunnelFolder: folderId, refusal: null, hostKeyLine: `ssh-ed25519 ${ed25519PublicBlob(ed25519Raw(hostKey).publicKey).toString("base64")}`,
      certificate: (line) => issue(ca, line) };
  });

  afterEach(async () => { server.closeAll(); await fs.rm(root, { recursive: true, force: true }); });

  function client({ target = server, timeouts = {} } = {}) {
    const auth = {
      async requestSessionApi(_base, route, init) {
        if (route === "/hosts") return { devices: [{ id: deviceId, online: true, folders: [{ id: folderId }, { id: otherFolder }] }] };
        if (route === `/hosts/devices/${deviceId}/ssh-certificate`) {
          return { certificate: sshOptions.certificate(JSON.parse(init.body).public_key), host_key: sshOptions.hostKeyLine,
            gateway_url: "https://api.puppyone.ai" };
        }
        throw new Error(`unexpected ${route}`);
      },
      async openHostTunnelSocket(_base, url, _expected, WebSocketImpl) {
        expect(url).toMatch(/^wss:\/\/api\.puppyone\.ai\/api\/v1\/hosts\/folders\/[0-9a-f-]{36}\/tunnel$/);
        tunnelsOpened = (tunnelsOpened ?? 0) + 1;
        return new WebSocketImpl(url);
      },
    };
    tunnelsOpened = 0;
    const ssh = createHostSshClient({ auth, apiBase, logger: { warn() {} }, timeouts,
      WebSocketImpl: tunnelSocketTo(target, sshOptions.tunnelFolder, sshOptions.refusal) });
    return { ssh, files: createRemoteHostClient({ auth, apiBase, ssh, retryDelays: [] }), terminals: createRemoteExecClient({ auth, apiBase, ssh }) };
  }

  it("serves the file protocol inside SSH: list, read, conditional write, conflict, watch", async () => {
    const { files, ssh } = client();
    const listed = await files.request(folderId, { action: "list", path: "" });
    expect(listed).toMatchObject({ ok: true });
    expect(listed.result.entries.map((entry) => entry.name)).toEqual(["note.md"]);
    const read = await files.request(folderId, { action: "read", path: "note.md" });
    expect(Buffer.from(read.result.content_base64, "base64").toString()).toBe("# note\n");
    const saved = await files.request(folderId, { action: "write", path: "note.md",
      content_base64: Buffer.from("edited\n").toString("base64"), expected_revision: read.result.revision });
    expect(saved).toMatchObject({ ok: true });
    expect(await fs.readFile(path.join(root, "note.md"), "utf8")).toBe("edited\n");
    const stale = await files.request(folderId, { action: "write", path: "note.md",
      content_base64: Buffer.from("stale\n").toString("base64"), expected_revision: read.result.revision });
    expect(stale).toEqual({ ok: false, status: 409, code: "conflict", outcomeUnknown: false });
    const escaped = await files.request(folderId, { action: "read", path: "../outside" });
    expect(escaped).toMatchObject({ ok: false, code: "invalid_path" });

    const events = [];
    const controller = new AbortController();
    void files.watch(folderId, null, async (event) => { events.push(event); }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fs.writeFile(path.join(root, "new.md"), "x");
    const sawNew = () => events.some((event) => event.type === "change" && (event.reset || event.paths.includes("new.md")));
    for (let i = 0; i < 50 && !sawNew(); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sawNew(), JSON.stringify(events)).toBe(true);
    controller.abort();
    ssh.closeAll();
  });

  it("refuses view-only writes on the host itself", async () => {
    folders.get(folderId).capabilities = ["folder.read"];
    const { files, ssh } = client();
    const result = await files.request(folderId, { action: "write", path: "note.md", content_base64: "eA==", expected_revision: null });
    expect(result).toMatchObject({ ok: false, code: "folder_unavailable" });
    ssh.closeAll();
  });

  it.each([
    ["another computer's certificate", (line) => issue(ca, line, { principals: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"] })],
    ["another account's certificate", (line) => issue(ca, line, { keyId: "user:ffffffff-ffff-4fff-8fff-ffffffffffff" })],
    ["an expired certificate", (line) => issue(ca, line, { validAfter: 1, validBefore: 2 })],
    ["a certificate with critical options", (line) => issue(ca, line, { critical: [["force-command", "/bin/true"]] })],
    ["a certificate from another authority", (line) => issue(crypto.generateKeyPairSync("ed25519").privateKey, line)],
  ])("refuses %s", async (_name, certificate) => {
    sshOptions.certificate = certificate;
    const { ssh } = client();
    await expect(ssh.get(folderId)).rejects.toMatchObject({ code: "folder_unavailable" });
  });

  it("refuses a login for a folder other than the one the tunnel was admitted for", async () => {
    sshOptions.tunnelFolder = otherFolder;
    folders.set(otherFolder, { rootPath: root, state: "active", capabilities: ["folder.read"] });
    const { ssh } = client();
    await expect(ssh.get(folderId)).rejects.toMatchObject({ code: "folder_unavailable" });
  });

  it("refuses a host whose key is not the device's registered key", async () => {
    sshOptions.hostKeyLine = `ssh-ed25519 ${ed25519PublicBlob(ed25519Raw(crypto.generateKeyPairSync("ed25519").privateKey).publicKey).toString("base64")}`;
    const { ssh } = client();
    await expect(ssh.get(folderId)).rejects.toMatchObject({ status: 0 });
  });

  it("reports a refused tunnel with the Cloud's reason", async () => {
    sshOptions.refusal = "device_offline";
    const { ssh } = client();
    await expect(ssh.get(folderId)).rejects.toMatchObject({ code: "device_offline", status: 503 });
  });

  it("runs a terminal only with this computer's consent, with a pty, and reports its exit", async () => {
    const { terminals, ssh } = client();
    const denied = [];
    await terminals.open({ id: "t1", folderId, kind: "shell", launcher: "shell", cols: 100, rows: 30 }, (event) => denied.push(event));
    expect(denied).toEqual([{ type: "error", code: "not_allowed" }]);

    folders.get(folderId).capabilities.push("folder.shell");
    const events = [];
    let output = "";
    await terminals.open({ id: "t2", folderId, kind: "shell", launcher: "shell", cols: 100, rows: 30 }, (event) => {
      if (event.type === "output") output += event.data; else events.push(event);
    });
    expect(events).toEqual([{ type: "started" }]);
    expect(terminalsSeen).toEqual([{ kind: "shell", launcher: "shell", cols: 100, rows: 30 }]);
    expect(terminals.input("t2", "hello\n")).toBe(true);
    for (let i = 0; i < 50 && !output.includes("you said hello"); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(output).toContain("you said hello");
    terminals.input("t2", "exit\n");
    for (let i = 0; i < 50 && events.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.at(-1)).toEqual({ type: "exit", status: 0 });
    // An Agent needs its own consent.
    const agent = [];
    await terminals.open({ id: "t3", folderId, kind: "agent", launcher: "codex", cols: 80, rows: 24 }, (event) => agent.push(event));
    expect(agent).toEqual([{ type: "error", code: "not_allowed" }]);
    ssh.closeAll();
  });

  it("runs one command binary safe with its exit status, and nothing without consent", async () => {
    const { ssh } = client();
    const connection = await ssh.get(folderId);
    const run = (command) => new Promise((resolve) => connection.client.exec(command, (error, channel) => {
      if (error) { resolve({ refused: true }); return; }
      const chunks = []; let status = null;
      channel.on("data", (chunk) => chunks.push(chunk));
      channel.on("exit", (code) => { status = code; });
      channel.on("close", () => resolve({ bytes: Buffer.concat(chunks), status }));
    }));
    expect(await run("printf x")).toEqual({ refused: true });
    folders.get(folderId).capabilities.push("folder.shell");
    const result = await run("printf '\\000\\377\\n'; exit 7");
    expect(result.bytes.toString("hex")).toBe("00ff0a");
    expect(result.status).toBe(7);
    ssh.closeAll();
  });

  it("opens no SFTP, no port forwarding, and ends sessions when the folder stops being shared", async () => {
    const { ssh } = client();
    const connection = await ssh.get(folderId);
    await expect(new Promise((resolve, reject) => connection.client.sftp((error) => (error ? reject(error) : resolve()))))
      .rejects.toThrow();
    await expect(new Promise((resolve, reject) => connection.client.forwardOut("127.0.0.1", 1, "127.0.0.1", 22,
      (error) => (error ? reject(error) : resolve())))).rejects.toThrow();
    folders.delete(folderId);
    await server.enforce(folderId);
    for (let i = 0; i < 50 && !connection.closed; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(connection.closed).toBe(true);
  });
  it("a read that gets no answer times out, and a write without an answer is reported as uncertain", async () => {
    const silent = makeServer({ fileService: { run: () => new Promise(() => {}), watch: async () => () => {} } });
    const { files, ssh } = client({ target: silent, timeouts: { read: 150, write: 250 } });
    expect(await files.request(folderId, { action: "read", path: "note.md" }))
      .toEqual({ ok: false, status: 504, code: "device_timeout", outcomeUnknown: false });
    expect(await files.request(folderId, { action: "write", path: "note.md", content_base64: "eA==", expected_revision: null }))
      .toEqual({ ok: false, status: 504, code: "device_timeout", outcomeUnknown: true });
    ssh.closeAll();
    silent.closeAll();
  });

  it("a connection that ends is replaced by a new one on the next request", async () => {
    const { files, ssh } = client();
    expect((await files.request(folderId, { action: "list", path: "" })).ok).toBe(true);
    const first = await ssh.get(folderId);
    server.closeAll();
    for (let i = 0; i < 50 && !first.closed; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(first.closed).toBe(true);
    expect((await files.request(folderId, { action: "list", path: "" })).ok).toBe(true);
    expect(tunnelsOpened).toBe(2);
    ssh.closeAll();
  });

  it("consent widened on this computer applies to the open connection once the host is told", async () => {
    // Like the real registry: every lookup is a new object.
    const state = { capabilities: ["folder.read", "folder.write"] };
    const resolveFolder = async (id) => (id === folderId ? { rootPath: root, state: "active", capabilities: [...state.capabilities] } : null);
    const host = makeServer({ resolveFolder, fileService: createHostFileService({ resolveFolder }) });
    const { terminals, ssh } = client({ target: host });
    const open = async (id) => {
      const events = [];
      await terminals.open({ id, folderId, kind: "shell", launcher: "shell", cols: 80, rows: 24 }, (event) => events.push(event));
      return events[0];
    };
    expect(await open("t1")).toEqual({ type: "error", code: "not_allowed" });
    state.capabilities.push("folder.shell");
    // Not yet: the connection decides on its own view until enforce() refreshes it.
    expect(await open("t2")).toEqual({ type: "error", code: "not_allowed" });
    await host.enforce(folderId);
    expect(await open("t3")).toEqual({ type: "started" });
    ssh.closeAll();
    host.closeAll();
  });

  it("a session that fails to start ends on its own and the host keeps serving", async () => {
    folders.get(folderId).capabilities.push("folder.shell");
    const broken = makeServer({ execService: { receive() { throw new Error("terminal service down"); }, enforce: async () => {} } });
    const { terminals, files, ssh } = client({ target: broken });
    const events = [];
    await terminals.open({ id: "t1", folderId, kind: "shell", launcher: "shell", cols: 80, rows: 24 }, (event) => events.push(event));
    for (let i = 0; i < 50 && !events.some((event) => ["exit", "closed"].includes(event.type)); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(events.at(-1)).toEqual({ type: "exit", status: 1 });
    expect((await files.request(folderId, { action: "list", path: "" })).ok).toBe(true);
    ssh.closeAll();
    broken.closeAll();
  });
});

describe("OpenSSH certificates", () => {
  it("parses and verifies what an authority signs, and nothing else", () => {
    const ca = crypto.generateKeyPairSync("ed25519").privateKey;
    const user = crypto.generateKeyPairSync("ed25519").privateKey;
    const line = issue(ca, `ssh-ed25519 ${ed25519PublicBlob(ed25519Raw(user).publicKey).toString("base64")}`);
    const blob = parsePublicKeyLine(line, ED25519_CERT);
    const authorities = [ed25519PublicBlob(ed25519Raw(ca).publicKey)];
    const certificate = verifyUserCertificate(blob, { authorities, principal: deviceId });
    expect(certificate.keyId).toBe(`user:${account}`);
    expect(certificate.extensions).toEqual(["permit-pty"]);
    expect(Buffer.from(certificate.publicKey).equals(ed25519Raw(user).publicKey)).toBe(true);
    const tampered = Buffer.from(blob);
    tampered[60] ^= 1;
    expect(() => verifyUserCertificate(tampered, { authorities, principal: deviceId })).toThrow();
    expect(() => parseCertificate(Buffer.alloc(20000))).toThrow();
  });
});
