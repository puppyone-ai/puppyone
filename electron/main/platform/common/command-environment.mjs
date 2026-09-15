import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { runBoundedProcessProbe } from "./bounded-process-probe.mjs";
import { resolveDefaultDesktopShell } from "../shell-policy.mjs";
import { readWindowsCommandEnvironment } from "../windows/command-environment.mjs";

export const commandEnvironmentPolicy = Object.freeze({ timeoutMs: 4_000, maxOutputBytes: 256 * 1024 });

/** One fresh, private environment per scan. No completed environment cache. */
export async function readUserCommandEnvironment({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
  signal,
  runProbe = runBoundedProcessProbe,
  timeoutMs = commandEnvironmentPolicy.timeoutMs,
} = {}) {
  signal?.throwIfAborted();
  const inherited = normalizeEnvironment(env, platform);
  try {
    const environment = platform === "win32"
      ? await readWindowsCommandEnvironment({ env: inherited, homedir, signal, runProbe, timeoutMs })
      : await readPosixCommandEnvironment({ env: inherited, platform, homedir, signal, runProbe, timeoutMs });
    signal?.throwIfAborted();
    return Object.freeze({ environment: Object.freeze(environment), complete: true,
      source: platform === "win32" ? "windows-environment" : "shell-environment" });
  } catch {
    signal?.throwIfAborted();
    return Object.freeze({ environment: Object.freeze(inherited), complete: false,
      source: "inherited-environment", reasonCode: "environment-unavailable" });
  }
}

async function readPosixCommandEnvironment({ env, platform, homedir, signal, runProbe, timeoutMs }) {
  const shell = resolveDefaultDesktopShell({ platform, environment: env });
  const name = path.posix.basename(shell);
  if (!path.posix.isAbsolute(shell) || !["zsh", "bash", "fish", "sh", "dash", "ksh"].includes(name)) {
    throw new Error("Unsupported environment shell.");
  }
  const marker = `puppyone-env-${randomUUID()}`;
  const begin = `${marker}-begin`;
  const end = `${marker}-end`;
  // Never interpolate paths, CLI names or environment values into shell source.
  const command = `printf '\\0${begin}\\0'; /usr/bin/env -0; printf '\\0${end}\\0'`;
  const args = name === "fish" ? ["--login", "--interactive", "--command", command] : ["-ilc", command];
  const result = await runProbe(shell, args, {
    env: { ...env, PUPPYONE_RESOLVING_ENVIRONMENT: "1", DISABLE_AUTO_UPDATE: "true" },
    cwd: homedir, signal, timeoutMs, maxOutputBytes: commandEnvironmentPolicy.maxOutputBytes,
    label: "Desktop command environment",
    isolatedProcessGroup: true,
  });
  if (result.code !== 0) throw new Error("Shell environment failed.");
  const start = result.stdout.indexOf(`\0${begin}\0`);
  const finish = result.stdout.indexOf(`\0${end}\0`, start + begin.length + 2);
  if (start < 0 || finish < 0) throw new Error("Shell environment framing failed.");
  const parsed = Object.create(null);
  for (const entry of result.stdout.slice(start + begin.length + 2, finish).split("\0")) {
    const separator = entry.indexOf("=");
    if (separator > 0) parsed[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  const environment = normalizeEnvironment(parsed, platform);
  if (typeof environment.PATH !== "string") throw new Error("Shell environment has no PATH.");
  for (const key of ["PUPPYONE_RESOLVING_ENVIRONMENT", "DISABLE_AUTO_UPDATE"]) {
    if (key in env) environment[key] = env[key];
    else delete environment[key];
  }
  return environment;
}

export function normalizeEnvironment(env, platform = process.platform) {
  const result = {};
  for (const [rawKey, value] of Object.entries(env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(rawKey) || typeof value !== "string" || value.includes("\0")) continue;
    const key = platform === "win32" && /^(?:path|pathext)$/iu.test(rawKey) ? rawKey.toUpperCase() : rawKey;
    Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
  }
  return result;
}
