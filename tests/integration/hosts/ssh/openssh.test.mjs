/**
 * The host's SSH server against the real OpenSSH client, as an external Agent
 * (`puppyone hosts ssh`) uses it, with this computer's real folder sandbox.
 *
 * OpenSSH without a terminal sends EOF right after its exec request; the host
 * once crashed on exactly that. Also: certificate login only, binary-safe
 * output and exit status, piped input, no port forwarding, no SFTP, and the
 * sandbox (writes only inside the folder, the App's data hidden).
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { createHostSshServer } from "../../../../electron/host-service/ssh/host-ssh-server.mjs";
import { detectSandbox } from "../../../../electron/host-service/sandbox.mjs";
import { createHostFileService } from "../../../../electron/main/hosts/host-file-service.mjs";
import { ed25519PublicBlob, ed25519Raw, openSshPrivateKey, parsePublicKeyLine } from "../../../../electron/main/hosts/ssh/openssh.mjs";

const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const deviceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const folderId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const hasOpenSsh = ["ssh", "ssh-keygen"].every((tool) => spawnSync("which", [tool]).status === 0);
const sandbox = await detectSandbox().catch(() => null);
// CI sets PUPPYONE_REQUIRE_SANDBOX so a missing sandbox fails instead of skipping the sandboxed cases.
if (process.env.PUPPYONE_REQUIRE_SANDBOX === "1" && !sandbox) throw new Error("This runner has no folder sandbox.");

describe.skipIf(!hasOpenSsh)("host SSH server with the OpenSSH client", () => {
  let work, root, appData, server, tcp, port, ssh;

  beforeAll(async () => {
    work = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "host-openssh-")));
    root = path.join(work, "Shared");
    appData = path.join(work, "AppData");
    await fs.mkdir(root);
    await fs.mkdir(appData);
    await fs.writeFile(path.join(root, "note.md"), "# note\n");
    await fs.writeFile(path.join(appData, "device-key"), "SECRET-DEVICE-KEY");
    // The Cloud's authority and a user certificate for this device, as asyncssh issues them.
    const keygen = (...args) => execFileSync("ssh-keygen", ["-q", ...args], { cwd: work });
    keygen("-t", "ed25519", "-N", "", "-f", "ca");
    keygen("-t", "ed25519", "-N", "", "-f", "user");
    keygen("-s", "ca", "-I", `user:${account}`, "-n", deviceId, "-V", "-1m:+5m", "user.pub");
    const hostKey = crypto.generateKeyPairSync("ed25519").privateKey;
    const capabilities = ["folder.read", "folder.write", "folder.shell"];
    const resolveFolder = async (id) => (id === folderId ? { rootPath: root, state: "active", capabilities: [...capabilities] } : null);
    server = createHostSshServer({
      hostKey: async () => openSshPrivateKey(hostKey),
      authorities: async () => [parsePublicKeyLine(await fs.readFile(path.join(work, "ca.pub"), "utf8"))],
      active: () => ({ accountId: account, deviceId }),
      resolveFolder, fileService: createHostFileService({ resolveFolder }),
      execService: { receive: () => true, enforce: async () => {} },
      executionPolicy: sandbox ? async () => ({ tier: "folder", sandbox, appDataDirs: [appData] }) : null,
      logger: { warn() {} },
    });
    tcp = net.createServer((socket) => { void server.accept(socket, { folderId }); });
    await new Promise((resolve) => tcp.listen(0, "127.0.0.1", resolve));
    port = tcp.address().port;
    const hostLine = `ssh-ed25519 ${ed25519PublicBlob(ed25519Raw(hostKey).publicKey).toString("base64")}`;
    await fs.writeFile(path.join(work, "known_hosts"), `[127.0.0.1]:${port} ${hostLine}\n`);
    ssh = (args, { input = null, user = folderId } = {}) => new Promise((resolve) => {
      const child = spawn("ssh", ["-F", "/dev/null", "-p", String(port), "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
        "-o", `IdentityFile=${path.join(work, "user")}`, "-o", `CertificateFile=${path.join(work, "user-cert.pub")}`,
        "-o", `UserKnownHostsFile=${path.join(work, "known_hosts")}`, "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=10", ...args.slice(0, -1), `${user}@127.0.0.1`, args.at(-1)],
      { stdio: ["pipe", "pipe", "pipe"] });
      const out = []; const err = [];
      child.stdout.on("data", (chunk) => out.push(chunk));
      child.stderr.on("data", (chunk) => err.push(chunk));
      child.on("close", (status) => resolve({ status, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }));
      if (input !== null) child.stdin.end(input); else child.stdin.end();
    });
  });

  afterAll(async () => {
    server?.closeAll();
    await new Promise((resolve) => tcp?.close(resolve));
    if (work) await fs.rm(work, { recursive: true, force: true });
  });

  it.skipIf(!sandbox)("runs a command whose input is already closed, binary safe, with its exit status", async () => {
    const result = await ssh(["printf '\\000\\377\\n'; exit 7"]);
    expect(result.stdout.toString("hex")).toBe("00ff0a");
    expect(result.status).toBe(7);
    // The host keeps serving after it.
    expect((await ssh(["cat note.md"])).stdout.toString()).toBe("# note\n");
  }, 60_000);

  it.skipIf(!sandbox)("passes piped input through and runs in the folder", async () => {
    const result = await ssh(["cat > piped.txt; pwd; wc -c < piped.txt"], { input: "piped-input\n" });
    expect(result.stdout.toString().trim().split("\n").map((line) => line.trim()), result.stderr).toEqual([root, "12"]);
    expect(await fs.readFile(path.join(root, "piped.txt"), "utf8")).toBe("piped-input\n");
  }, 60_000);

  it.skipIf(!sandbox)("the sandbox keeps writes inside the folder and hides the App's data", async () => {
    // Temporary directories stay writable for toolchains; the person's home does not.
    const outside = path.join(os.homedir(), `.puppyone-sandbox-probe-${crypto.randomUUID()}`);
    onTestFinished(() => fs.rm(outside, { force: true }));
    const result = await ssh([`touch '${outside}'; echo touch=$?; cat '${path.join(appData, "device-key")}'; echo cat=$?`]);
    const output = result.stdout.toString();
    expect(output).toMatch(/touch=[1-9]/);
    expect(output).toMatch(/cat=[1-9]/);
    expect(output).not.toContain("SECRET-DEVICE-KEY");
    await expect(fs.access(outside)).rejects.toThrow();
  }, 60_000);

  it("logs in only with a certificate for this folder", async () => {
    const other = await ssh(["true"], { user: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
    expect(other.status).toBe(255);
    expect(other.stderr).toMatch(/Permission denied/);
  }, 60_000);

  it("opens no port forwarding and no SFTP", async () => {
    const forwarded = await ssh(["-o", "ExitOnForwardFailure=yes", "-W", "127.0.0.1:22", "unused"]);
    expect(forwarded.status).toBe(255);
    const sftp = await ssh(["-s", "sftp"]);
    expect(sftp.status).not.toBe(0);
  }, 60_000);
});
