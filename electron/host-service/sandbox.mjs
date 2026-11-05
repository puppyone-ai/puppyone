/**
 * The "run inside the folder" execution tier: what the owner's other computers
 * start in a shared folder runs inside an operating-system sandbox.
 *
 * Writes are confined to the folder, temporary directories and the caches and
 * Agent state directories declared below; credentials (SSH and GPG keys, the
 * keychain, cloud CLI credentials, browser data, PuppyOne's own app data) can
 * be neither read nor written. System directories and tool chains stay
 * readable so builds and tests work, and the network is not restricted (the
 * network policy is a separate decision). Every child process inherits the
 * sandbox, including Git hooks and package-manager scripts.
 *
 * macOS uses Seatbelt (sandbox-exec), Linux uses bubblewrap. Where neither is
 * available (Windows, or Linux without bubblewrap or user namespaces), there
 * is no folder tier: running anything is the whole-computer tier, which the
 * owner must turn on separately on this computer.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const SEATBELT = "/usr/bin/sandbox-exec";
const BWRAP_CANDIDATES = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"];

/** Credentials nothing in the folder tier may read or write, relative to home. */
const PROTECTED_HOME_PATHS = Object.freeze([
  ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config/gcloud", ".config/gh", ".netrc",
  ".git-credentials", ".npmrc", ".pypirc", ".password-store",
  "Library/Keychains", "Library/Cookies", "Library/Application Support/Google/Chrome",
  "Library/Application Support/Firefox", "Library/Application Support/BraveSoftware",
  "Library/Application Support/Microsoft Edge", "Library/Safari", "Library/Mail", "Library/Messages",
  ".mozilla", ".config/google-chrome", ".config/chromium", ".config/BraveSoftware", ".local/share/keyrings",
]);

/** Caches tool chains write to, relative to home. */
const CACHE_HOME_PATHS = Object.freeze([
  ".cache", "Library/Caches", ".npm", ".pnpm-store", ".yarn", ".bun", ".cargo/registry", ".cargo/git",
  ".gradle/caches", ".m2/repository", "go/pkg/mod", ".local/share/pnpm", ".deno",
]);

/** State each Agent keeps for its own sessions; the Agent's own credential lives here. */
const AGENT_HOME_PATHS = Object.freeze({
  claude: [".claude", ".claude.json", ".config/claude"],
  codex: [".codex"],
  cursor: [".cursor", ".config/cursor"],
  opencode: [".config/opencode", ".local/share/opencode", ".local/state/opencode"],
  pi: [".pi"],
  hermes: [".hermes"],
});

export function agentStatePaths(launcher, home) {
  return (AGENT_HOME_PATHS[launcher] ?? []).map((relative) => path.join(home, relative));
}

function sbplString(value) {
  if (/[\0\n\r]/.test(value)) throw new Error("Unsupported path for the sandbox.");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function realOrSelf(value) {
  try { return fs.realpathSync(value); } catch { return value; }
}

/**
 * A Seatbelt profile for one session. Later rules take precedence, so the
 * protected paths come last and win over every allowance.
 */
export function seatbeltProfile({ root, home, appDataDirs = [], writable = [], tempDirs = [] }) {
  const allowWrite = [realOrSelf(root), ...tempDirs.map(realOrSelf), ...writable.map(realOrSelf),
    ...CACHE_HOME_PATHS.map((relative) => path.join(home, relative))];
  const protectedPaths = [...PROTECTED_HOME_PATHS.map((relative) => path.join(home, relative)), ...appDataDirs];
  const subpaths = (paths) => paths.map((item) => `  (subpath ${sbplString(item)})`).join("\n");
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    "(allow file-write*",
    subpaths(allowWrite),
    '  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (literal "/dev/ptmx")',
    '  (regex #"^/dev/tty") (regex #"^/dev/fd/"))',
    "(deny file-read* file-write*",
    subpaths(protectedPaths.map(realOrSelf)),
    ")",
    // Keychain items are served by securityd, not read from files.
    '(deny mach-lookup (global-name "com.apple.SecurityServer"))',
    "",
  ].join("\n");
}

/** bubblewrap arguments for one session; the program and its arguments follow "--". */
export function bubblewrapArgs({ root, home, appDataDirs = [], writable = [], exists = fs.existsSync, isDirectory }) {
  const directory = isDirectory ?? ((value) => { try { return fs.statSync(value).isDirectory(); } catch { return false; } });
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp",
    "--die-with-parent", "--bind", root, root];
  for (const item of [...CACHE_HOME_PATHS.map((relative) => path.join(home, relative)), ...writable]) {
    if (exists(item)) args.push("--bind", item, item);
  }
  for (const item of [...PROTECTED_HOME_PATHS.map((relative) => path.join(home, relative)), ...appDataDirs]) {
    if (!exists(item)) continue;
    if (directory(item)) args.push("--tmpfs", item);
    else args.push("--ro-bind", "/dev/null", item);
  }
  args.push("--chdir", root);
  return args;
}

/** Which sandbox this computer has for the folder tier, or null. */
export async function detectSandbox({ platform = process.platform, exists = fs.existsSync, probe = run } = {}) {
  if (platform === "darwin") {
    if (!exists(SEATBELT)) return null;
    try { await probe(SEATBELT, ["-p", "(version 1)(allow default)", "/usr/bin/true"]); return { mechanism: "seatbelt", path: SEATBELT }; }
    catch { return null; }
  }
  if (platform === "linux") {
    const bwrap = BWRAP_CANDIDATES.find((candidate) => exists(candidate));
    if (!bwrap) return null;
    // Unprivileged user namespaces can be disabled; then bubblewrap cannot run.
    try { await probe(bwrap, ["--ro-bind", "/", "/", "--dev", "/dev", "/bin/true"]); return { mechanism: "bubblewrap", path: bwrap }; }
    catch { return null; }
  }
  return null;
}

/**
 * Wraps a program for the folder tier. `sandbox` comes from detectSandbox;
 * a missing sandbox is a refusal, never an unsandboxed fallback.
 */
export function wrapInSandbox({ sandbox, file, args = [], root, home, appDataDirs = [], writable = [], tempDirs = [] }) {
  if (!sandbox) throw Object.assign(new Error("This computer has no sandbox for running in a folder."), { code: "sandbox_unavailable" });
  if (!path.isAbsolute(root) || !path.isAbsolute(home)) throw new Error("Sandbox paths must be absolute.");
  if (sandbox.mechanism === "seatbelt") {
    return { file: sandbox.path, args: ["-p", seatbeltProfile({ root, home, appDataDirs, writable, tempDirs }), file, ...args] };
  }
  if (sandbox.mechanism === "bubblewrap") {
    return { file: sandbox.path, args: [...bubblewrapArgs({ root, home, appDataDirs, writable }), "--", file, ...args] };
  }
  throw Object.assign(new Error("Unknown sandbox."), { code: "sandbox_unavailable" });
}

/** Spawns only with the policy of the session being opened. */
export function createPolicySpawner({ spawn, home = os.homedir(), tempDirs = [os.tmpdir(), "/private/tmp", "/tmp"],
  takePolicy }) {
  return {
    spawn(file, args, options) {
      const policy = takePolicy();
      if (!policy) throw new Error("No execution policy for this session.");
      if (policy.tier === "computer") return spawn(file, args, options);
      if (policy.tier !== "folder") throw new Error("Unknown execution tier.");
      const wrapped = wrapInSandbox({ sandbox: policy.sandbox, file, args, root: policy.root, home,
        appDataDirs: policy.appDataDirs ?? [], writable: agentStatePaths(policy.launcher, home), tempDirs });
      // Shell history stays out of the owner's own history file.
      const env = { ...options.env, HISTFILE: path.join(os.tmpdir(), `puppyone-host-${process.pid}.history`) };
      return spawn(wrapped.file, wrapped.args, { ...options, env });
    },
  };
}
