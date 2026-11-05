import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  agentStatePaths,
  bubblewrapArgs,
  detectSandbox,
  seatbeltProfile,
  wrapInSandbox,
} from "../../../../electron/host-service/sandbox.mjs";

const run = promisify(execFile);
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function layout() {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-sandbox-")));
  roots.push(base);
  const home = path.join(base, "home");
  const root = path.join(home, "work", "Notes");
  const appData = path.join(home, "Library", "Application Support", "PuppyOne");
  for (const dir of [root, path.join(home, ".ssh"), appData, path.join(home, ".claude"), path.join(home, "Documents")]) {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(path.join(home, ".ssh", "id_ed25519"), "PRIVATE KEY");
  await fs.writeFile(path.join(appData, "session.json"), "TOKEN");
  await fs.writeFile(path.join(home, "Documents", "taxes.txt"), "readable");
  return { base, home, root, appData };
}

describe("folder-tier sandbox", () => {
  it("never falls back to running unsandboxed", () => {
    expect(() => wrapInSandbox({ sandbox: null, file: "/bin/sh", root: "/r", home: "/h" }))
      .toThrow(expect.objectContaining({ code: "sandbox_unavailable" }));
  });

  it("puts protected paths after every allowance so they always win", () => {
    const profile = seatbeltProfile({ root: "/Users/me/Notes", home: "/Users/me",
      appDataDirs: ["/Users/me/Library/Application Support/PuppyOne"], writable: ["/Users/me/.claude"] });
    expect(profile.indexOf("(deny file-write*)")).toBeLessThan(profile.indexOf("(allow file-write*"));
    expect(profile.indexOf("(allow file-write*")).toBeLessThan(profile.indexOf("(deny file-read* file-write*"));
    expect(profile).toContain('(subpath "/Users/me/Notes")');
    expect(profile).toContain('(subpath "/Users/me/.ssh")');
    expect(profile).toContain('(subpath "/Users/me/Library/Application Support/PuppyOne")');
    expect(profile).toContain('(global-name "com.apple.SecurityServer")');
    expect(() => seatbeltProfile({ root: "/a\n(allow default)", home: "/h" })).toThrow("Unsupported path");
    expect(seatbeltProfile({ root: '/a"b', home: "/h" })).toContain('(subpath "/a\\"b")');
  });

  it("builds bubblewrap with the folder writable and credentials hidden", () => {
    const present = new Set(["/home/me/.ssh", "/home/me/.netrc", "/home/me/.cache", "/home/me/.codex"]);
    const args = bubblewrapArgs({ root: "/home/me/Notes", home: "/home/me", writable: ["/home/me/.codex"],
      exists: (item) => present.has(item), isDirectory: (item) => !item.endsWith(".netrc") });
    expect(args.slice(0, 4)).toEqual(["--ro-bind", "/", "/", "--dev"]);
    const pairs = args.join(" ");
    expect(pairs).toContain("--bind /home/me/Notes /home/me/Notes");
    expect(pairs).toContain("--bind /home/me/.cache /home/me/.cache");
    expect(pairs).toContain("--bind /home/me/.codex /home/me/.codex");
    expect(pairs).toContain("--tmpfs /home/me/.ssh");
    expect(pairs).toContain("--ro-bind /dev/null /home/me/.netrc");
    expect(args.at(-2)).toBe("--chdir");
    const wrapped = wrapInSandbox({ sandbox: { mechanism: "bubblewrap", path: "/usr/bin/bwrap" }, file: "/bin/bash",
      args: ["-l"], root: "/home/me/Notes", home: "/home/me" });
    expect(wrapped.file).toBe("/usr/bin/bwrap");
    expect(wrapped.args.slice(-3)).toEqual(["--", "/bin/bash", "-l"]);
  });

  it("knows where each Agent keeps its own state", () => {
    expect(agentStatePaths("claude", "/h")).toEqual(["/h/.claude", "/h/.claude.json", "/h/.config/claude"]);
    expect(agentStatePaths("shell", "/h")).toEqual([]);
  });

  it("reports no sandbox where the platform has none", async () => {
    expect(await detectSandbox({ platform: "win32" })).toBeNull();
    expect(await detectSandbox({ platform: "linux", exists: () => false })).toBeNull();
    expect(await detectSandbox({ platform: "linux", exists: (item) => item === "/usr/bin/bwrap",
      probe: async () => { throw new Error("user namespaces disabled"); } })).toBeNull();
    expect(await detectSandbox({ platform: "linux", exists: (item) => item === "/usr/bin/bwrap", probe: async () => ({}) }))
      .toEqual({ mechanism: "bubblewrap", path: "/usr/bin/bwrap" });
  });

  it.runIf(process.platform === "darwin")("confines a real shell on macOS: the folder only, no credentials", async () => {
    const sandbox = await detectSandbox();
    expect(sandbox?.mechanism).toBe("seatbelt");
    const { home, root, appData } = await layout();
    const script = [
      "echo made > inside.txt && echo 'write inside: ok'",
      "mkdir -p sub && (cd sub && sh -c 'echo nested > child.txt') && echo 'child process: ok'",
      `(echo x > "${home}/Documents/new.txt") 2>/dev/null && echo 'write outside: ALLOWED' || echo 'write outside: denied'`,
      `cat "${home}/Documents/taxes.txt" >/dev/null && echo 'read outside: ok'`,
      `cat "${home}/.ssh/id_ed25519" >/dev/null 2>&1 && echo 'ssh key: ALLOWED' || echo 'ssh key: denied'`,
      `cat "${appData}/session.json" >/dev/null 2>&1 && echo 'app data: ALLOWED' || echo 'app data: denied'`,
      `(echo y > "${home}/.claude/state.json") 2>/dev/null && echo 'agent state: ok' || echo 'agent state: denied'`,
      "git --version >/dev/null && echo 'tools: ok'",
    ].join("; ");
    const wrapped = wrapInSandbox({ sandbox, file: "/bin/sh", args: ["-c", script], root, home,
      appDataDirs: [appData], writable: agentStatePaths("claude", home) });
    const { stdout } = await run(wrapped.file, wrapped.args, { cwd: root });
    expect(stdout.trim().split("\n")).toEqual(["write inside: ok", "child process: ok", "write outside: denied",
      "read outside: ok", "ssh key: denied", "app data: denied", "agent state: ok", "tools: ok"]);
    expect(await fs.readFile(path.join(root, "sub", "child.txt"), "utf8")).toBe("nested\n");
    await expect(fs.access(path.join(home, "Documents", "new.txt"))).rejects.toThrow();
  });
});
