/**
 * The host's SSH server: the end of the encrypted session inside a Cloud
 * tunnel. The Cloud only moved the bytes and admitted the tunnel for one
 * folder; everything here is decided on this computer:
 *
 * - Client identity: an Ed25519 user certificate from the Cloud's SSH
 *   authority, for this device (principal), for this computer's account (key
 *   id `user:<account>`), valid now. No passwords, no plain keys.
 * - Host identity: this device's registered key, which the client checks
 *   against the host directory.
 * - The SSH user name is the folder; it must be the folder the tunnel was
 *   admitted for, and still shared here.
 * - Channels: the `puppyone-files` subsystem (file protocol v1: the editor),
 *   shell and pty (terminals and Agents, in the folder sandbox) and exec
 *   (one command, binary safe, with its exit status). No forwarding of any
 *   kind, no X11, no agent, no SFTP.
 *
 * Every operation re-reads this computer's own consent for the folder.
 */
import crypto from "node:crypto";
import os from "node:os";
import { spawn as spawnProcess } from "node:child_process";
import { createRequire } from "node:module";
import { ED25519_CERT, verifyEd25519, verifyUserCertificate } from "../../main/hosts/ssh/openssh.mjs";
import { wrapInSandbox } from "../sandbox.mjs";

const require = createRequire(import.meta.url);
const { Server } = require("ssh2");

export const FILES_SUBSYSTEM = "puppyone-files";
const AGENT_COMMAND = /^puppyone-agent ([a-z]+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LINE_BYTES = 12 * 1024 * 1024;
const MAX_INFLIGHT = 16;
const MAX_CONNECTIONS = 16;
const MAX_WATCHES_PER_CHANNEL = 4;
const MAX_COMMAND_BYTES = 64 * 1024;
// File protocol v1 error codes, passed to the client as they are; anything else is file_operation_failed.
const FILE_ERRORS = new Set(["invalid_path", "not_found", "already_exists", "not_empty", "folder_unavailable",
  "root_changed", "unsupported_file", "too_many_entries", "invalid_content", "revision_required", "conflict",
  "not_allowed", "too_large", "unsupported", "file_operation_failed"]);
const SAFE_ENV = /^(TERM|LANG|LC_[A-Z]+|COLORTERM)$/;

export function createHostSshServer({ hostKey, authorities, active, resolveFolder, fileService, gitService = null,
  execService = null, executionPolicy = null, spawn = spawnProcess, logger = console, onChange = () => {},
  now = Date.now }) {
  const connections = new Set();
  const commands = new Map();

  function notify() { try { onChange(); } catch { /* observers only */ } }

  async function admitted(folderId, capability) {
    const folder = await resolveFolder(folderId);
    if (!folder || folder.state !== "active" || !folder.rootPath) return null;
    if (capability && !folder.capabilities?.includes(capability)) return null;
    return folder;
  }

  /** Serve one tunnel. `folderId` is the folder the Cloud admitted it for. */
  async function accept(stream, { folderId }) {
    const identity = active();
    if (!identity || !UUID.test(folderId) || connections.size >= MAX_CONNECTIONS || !await admitted(folderId)) {
      stream.destroy();
      return false;
    }
    const key = await hostKey(identity);
    const server = new Server({ hostKeys: [key], ident: "PuppyOne-Host" });
    // `folder` is this connection's view of the folder's sharing and consent, refreshed by enforce():
    // channel requests are decided on it synchronously, before the client's next packet.
    const record = { folderId, folder: null, client: null, channels: new Set(), openedAt: new Date(now()).toISOString() };
    server.on("connection", (client) => {
      record.client = client;
      connections.add(record);
      notify();
      client.on("authentication", (ctx) => void authenticate(ctx, identity, record));
      client.on("ready", () => client.on("session", (acceptSession) => session(acceptSession(), record)));
      // No port forwarding, no Unix socket forwarding, no other global requests.
      client.on("request", (_accept, reject) => reject?.());
      client.on("tcpip", (_accept, reject) => reject());
      client.on("openssh.streamlocal", (_accept, reject) => reject());
      client.on("error", () => {});
      client.on("close", () => { connections.delete(record); notify(); });
    });
    server.injectSocket(stream);
    return true;
  }

  async function authenticate(ctx, identity, record) {
    const { folderId } = record;
    if (ctx.method !== "publickey" || ctx.key?.algo !== ED25519_CERT) return ctx.reject(["publickey"]);
    if (ctx.username !== folderId) return ctx.reject();
    try {
      let trusted = await authorities();
      let certificate;
      try {
        certificate = verifyUserCertificate(ctx.key.data, { authorities: trusted, principal: identity.deviceId, now: now() });
      } catch (error) {
        // A rotated authority: refresh the trusted keys once.
        if (!/Unknown certificate authority/.test(error.message)) throw error;
        trusted = await authorities({ refresh: true });
        certificate = verifyUserCertificate(ctx.key.data, { authorities: trusted, principal: identity.deviceId, now: now() });
      }
      if (certificate.keyId !== `user:${identity.accountId}`) throw new Error("Certificate is for another account.");
      if (ctx.signature && !verifyEd25519(certificate.publicKey, ctx.blob, ctx.signature)) throw new Error("Bad signature.");
      record.folder = await admitted(folderId);
      if (!record.folder) throw new Error("Folder unavailable.");
      ctx.accept();
    } catch (error) {
      logger.warn?.("SSH login refused", { reason: error?.message });
      ctx.reject();
    }
  }

  function session(sessionChannel, record) {
    const folderId = record.folderId;
    let pty = null;
    const env = {};
    const allows = (capability) => record.folder?.state === "active" &&
      (!capability || record.folder.capabilities?.includes(capability) === true);
    // ssh2 calls these synchronously; a throw must end only this channel, never the host service.
    const guard = (handler) => (...args) => {
      try { handler(...args); } catch (error) { logger.warn?.("SSH channel request failed", { reason: error?.message }); args[1]?.(); }
    };
    sessionChannel.on("pty", guard((accept, _reject, info) => {
      pty = { cols: info.cols || 80, rows: info.rows || 24, term: info.term };
      accept?.();
    }));
    sessionChannel.on("env", guard((accept, reject, info) => {
      if (SAFE_ENV.test(info.key) && String(info.val).length < 256) { env[info.key] = String(info.val); accept?.(); }
      else reject?.();
    }));
    for (const refused of ["x11", "auth-agent", "sftp"]) sessionChannel.on(refused, (_accept, reject) => reject?.());
    sessionChannel.on("subsystem", guard((accept, reject, info) => {
      if (info.name !== FILES_SUBSYSTEM || !allows("folder.read")) return reject?.();
      const channel = accept();
      if (!channel) return;
      track(record, channel);
      serveFiles(channel, folderId);
    }));
    sessionChannel.on("shell", guard((accept, reject) => {
      if (!pty || !execService || !allows("folder.shell")) return reject?.();
      const channel = accept();
      if (channel) terminal({ channel, folderId, kind: "shell", launcher: "shell", pty, record });
    }));
    sessionChannel.on("exec", guard((accept, reject, info) => {
      const command = String(info.command ?? "");
      const agent = AGENT_COMMAND.exec(command);
      if (agent) {
        if (!pty || !execService || !allows("folder.agent")) return reject?.();
        const channel = accept();
        if (channel) terminal({ channel, folderId, kind: "agent", launcher: agent[1], pty, record });
        return;
      }
      if (!executionPolicy || !command || Buffer.byteLength(command) > MAX_COMMAND_BYTES || !allows("folder.shell")) {
        return reject?.();
      }
      const channel = accept();
      if (channel) void runCommand({ channel, folderId, command, env, record }).catch(() => fail(channel, 1));
    }));
  }

  function track(record, channel) {
    record.channels.add(channel);
    channel.on("close", () => record.channels.delete(channel));
  }

  function fail(channel, status, message = null) {
    if (!channel.writable) return;
    if (message) channel.stderr.write(`PuppyOne: ${message}\r\n`);
    channel.exit(status);
    channel.end();
  }

  // --- puppyone-files: file protocol v1, one JSON object per line ------------
  function serveFiles(channel, folderId) {
    let buffered = Buffer.alloc(0);
    let inflight = 0;
    const watches = new Map();
    const send = (value) => { if (channel.writable) channel.write(`${JSON.stringify(value)}\n`); };
    channel.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > MAX_LINE_BYTES) { channel.close(); return; }
      for (let end = buffered.indexOf(10); end >= 0; end = buffered.indexOf(10)) {
        const line = buffered.subarray(0, end);
        buffered = buffered.subarray(end + 1);
        let message;
        try { message = JSON.parse(line.toString("utf8")); } catch { channel.close(); return; }
        handle(message);
      }
    });
    channel.on("close", () => { for (const stop of watches.values()) stop(); watches.clear(); });

    async function handle(message) {
      const id = message?.id;
      if (!Number.isSafeInteger(id)) { channel.close(); return; }
      if (message.op === "unwatch") { watches.get(id)?.(); watches.delete(id); return; }
      if (message.op === "watch") {
        if (watches.size >= MAX_WATCHES_PER_CHANNEL || !await admitted(folderId, "folder.read")) {
          send({ watch: id, paths: [], reset: true, ended: true }); return;
        }
        try {
          const stop = await fileService.watch(folderId, (event) => send({ watch: id, paths: event.paths, reset: event.reset }),
            () => send({ watch: id, paths: [], reset: true, ended: true }));
          if (!channel.writable) { stop(); return; }
          watches.set(id, stop);
          send({ id, result: { watching: true } });
        } catch { send({ watch: id, paths: [], reset: true, ended: true }); }
        return;
      }
      if (message.op !== "request" || typeof message.request?.action !== "string") { send({ id, error: "unsupported" }); return; }
      if (inflight >= MAX_INFLIGHT) { send({ id, error: "too_large" }); return; }
      inflight++;
      try {
        const request = { ...message.request, folder_id: folderId };
        if (!await admitted(folderId)) throw Object.assign(new Error("folder"), { code: "folder_unavailable" });
        if (request.action === "git" && !gitService) throw Object.assign(new Error("git"), { code: "folder_unavailable" });
        const result = request.action === "git" ? await gitService.run(request) : await fileService.run(request);
        send({ id, result });
      } catch (error) {
        send({ id, error: FILE_ERRORS.has(error?.code) ? error.code : "file_operation_failed" });
      } finally { inflight--; }
    }
  }

  // --- shell and Agents: the host's terminal service, in the folder sandbox ---
  function terminal({ channel, folderId, kind, launcher, pty, record }) {
    track(record, channel);
    const id = `ssh-${crypto.randomUUID()}`;
    let opened = false;
    execService.receive({ type: "exec_open", session: id, folder_id: folderId, kind, launcher, cols: pty.cols, rows: pty.rows },
      (frame) => {
        if (frame.type === "exec_opened") opened = true;
        else if (frame.type === "exec_output") { if (channel.writable) channel.write(Buffer.from(frame.data, "base64")); }
        else if (frame.type === "exec_exit") fail(channel, Number.isInteger(frame.status) ? frame.status : 1);
        else if (frame.type === "exec_failed") fail(channel, 1, frame.error);
      });
    channel.on("data", (data) => execService.receive({ type: "exec_input", session: id, data: Buffer.from(data).toString("base64") }));
    channel.on("window-change", (_accept, _reject, info) => {
      execService.receive({ type: "exec_resize", session: id, cols: info.cols, rows: info.rows });
    });
    channel.on("signal", (_accept, _reject, info) => {
      execService.receive({ type: "exec_signal", session: id, signal: info?.name === "INT" ? "INT" : "TERM" });
    });
    channel.on("close", () => { if (opened) execService.receive({ type: "exec_close", session: id }); });
  }

  // --- exec: one command, binary safe, in the folder sandbox -----------------
  async function runCommand({ channel, folderId, command, env, record }) {
    track(record, channel);
    // Re-read this computer's consent now that the channel exists.
    const folder = await admitted(folderId, "folder.shell");
    if (!folder) { fail(channel, 126, "not_allowed"); return; }
    let wrapped;
    try {
      const policy = await executionPolicy({ folderId, launcher: "shell", rootPath: folder.rootPath });
      wrapped = wrapInSandbox({ sandbox: policy.sandbox, file: "/bin/sh", args: ["-c", command], root: folder.rootPath,
        home: os.homedir(), appDataDirs: policy.appDataDirs ?? [], tempDirs: [os.tmpdir(), "/private/tmp", "/tmp"] });
    } catch { fail(channel, 126, "sandbox_unavailable"); return; }
    if (!channel.writable) return;
    const child = spawn(wrapped.file, wrapped.args, { cwd: folder.rootPath, stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: os.homedir(), USER: os.userInfo().username, LANG: process.env.LANG ?? "C.UTF-8", ...env } });
    const id = crypto.randomUUID();
    commands.set(id, { folderId, child });
    notify();
    child.stdout?.pipe(channel, { end: false });
    child.stderr?.pipe(channel.stderr, { end: false });
    if (child.stdin) {
      child.stdin.on("error", () => {});
      channel.pipe(child.stdin);
    }
    child.on("error", () => { commands.delete(id); notify(); fail(channel, 127); });
    child.on("close", (code, signal) => {
      commands.delete(id); notify();
      if (!channel.writable) return;
      if (signal) { channel.exit(signal.replace(/^SIG/, ""), false, ""); channel.end(); }
      else fail(channel, Number.isInteger(code) ? code : 1);
    });
    channel.on("signal", (_accept, _reject, info) => { child.kill(`SIG${info?.name === "INT" ? "INT" : "TERM"}`); });
    channel.on("close", () => { if (child.exitCode === null) child.kill("SIGTERM"); });
  }

  /** A folder whose sharing or consent changed: end what it no longer allows. */
  async function enforce(folderId) {
    const folder = await resolveFolder(folderId);
    const shared = folder?.state === "active";
    for (const record of connections) {
      if (record.folderId !== folderId) continue;
      record.folder = folder;
      if (!shared) record.client?.end();
    }
    if (!folder?.capabilities?.includes("folder.shell")) {
      for (const [id, command] of commands) if (command.folderId === folderId) { command.child.kill("SIGTERM"); commands.delete(id); }
    }
    await execService?.enforce(folderId);
  }

  function closeAll() {
    for (const record of connections) record.client?.end();
    for (const [, command] of commands) command.child.kill("SIGTERM");
    commands.clear();
  }

  function list() {
    return [...connections].map(({ folderId, openedAt, channels }) => ({ folderId, openedAt, channels: channels.size }));
  }

  return Object.freeze({ accept, enforce, closeAll, list });
}
