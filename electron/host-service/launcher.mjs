/**
 * Desktop's side of the host service: find it, and start it when the person
 * here shares a folder. The host service shows its status in the App and is
 * stopped from there.
 */
import { spawn as spawnProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { connectControlClient } from "./control.mjs";
import { HOST_SERVICE_ARGUMENT } from "./paths.mjs";

const START_WAIT_MS = 15_000;
const START_POLL_MS = 150;

/** The command that starts the host service from this installation. */
export function hostServiceCommand({ execPath, appPath, isPackaged }) {
  return { command: execPath, args: isPackaged ? [HOST_SERVICE_ARGUMENT] : [appPath, HOST_SERVICE_ARGUMENT] };
}

export function createHostServiceLauncher({ stateDir, execPath, appPath, isPackaged, spawn = spawnProcess,
  connect = connectControlClient, env = process.env, logger = console }) {
  const { command, args } = hostServiceCommand({ execPath, appPath, isPackaged });

  async function tryConnect(options) {
    try { return await connect({ stateDir, role: "desktop", logger, ...options }); } catch { return null; }
  }

  return Object.freeze({
    stateDir,
    tryConnect,
    /** True once this computer has shared something (the host service has state). */
    async hasState() {
      try { await fs.access(path.join(stateDir, "host-sharing.json")); return true; } catch { return false; }
    },
    async ensure(options = {}) {
      const running = await tryConnect(options);
      if (running) return running;
      // Never as a Node script: the host service needs the App's own OS key store.
      const childEnv = { ...env };
      delete childEnv.ELECTRON_RUN_AS_NODE;
      const child = spawn(command, args, { detached: true, stdio: "ignore", env: childEnv });
      child.unref?.();
      const deadline = Date.now() + START_WAIT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
        const peer = await tryConnect(options);
        if (peer) return peer;
      }
      throw new Error("PuppyOne Host did not start.");
    },
  });
}
