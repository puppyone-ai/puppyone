/**
 * The Git functions the host Git service calls, each run in its own process
 * inside the folder sandbox (see git-worker.mjs). Used for the folder tier.
 */
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GIT_OPERATIONS } from "./git-operations.mjs";
import { wrapInSandbox } from "./sandbox.mjs";

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "git-worker.mjs");
const MAX_OUTPUT = 32 * 1024 * 1024;
const TIMEOUT_MS = 10 * 60_000;

export function createSandboxedGit({ sandbox, root, appDataDirs = [], nodePath = process.execPath,
  home = os.homedir(), tempDirs = [os.tmpdir(), "/private/tmp", "/tmp"], env = process.env, execFileImpl = execFile }) {
  const run = (fn, args) => new Promise((resolve, reject) => {
    const wrapped = wrapInSandbox({ sandbox, file: nodePath, args: [WORKER, JSON.stringify({ fn, root, args })],
      root, home, appDataDirs, tempDirs });
    // Electron's own binary runs the worker as plain Node.
    execFileImpl(wrapped.file, wrapped.args, { cwd: root, maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" } }, (error, stdout) => {
      let reply = null;
      try { reply = JSON.parse(String(stdout).trim().split("\n").at(-1)); } catch { reply = null; }
      if (reply?.ok) { resolve(reply.result); return; }
      reject(Object.assign(new Error(reply?.message ?? error?.message ?? "Git failed."), { code: reply?.code ?? null }));
    });
  });
  return Object.freeze(Object.fromEntries(GIT_OPERATIONS.map((fn) => [fn, (_root, ...args) => run(fn, args)])));
}
