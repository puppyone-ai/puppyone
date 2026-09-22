import path from "node:path";
import { connectionError } from "../../../../../shared/model-connections/schema.mjs";
import { createManagedAgentProcess, terminateManagedAgentProcess } from "../../transports/managed-agent-process.mjs";
import { buildPuppyOneAgentEnvironment } from "./puppyone-agent-environment.mjs";
import { spawnWithModelConfiguration } from "./model-connection-binding.mjs";

/** Explicit synthetic inference test. No project content and no actual tool execution. */
export function createPuppyOneModelVerifier({ appPath, userDataPath, executablePath = process.execPath }) {
  return (configuration, { signal } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(connectionError("CANCELLED")); return; }
    const handle = createManagedAgentProcess({
      spawn: spawnWithModelConfiguration(configuration), executablePath,
      args: [path.join(appPath, "electron/main/agent/runtimes/puppyone-agent/worker/main.mjs"), "--verify-model"],
      options: { cwd: appPath, env: buildPuppyOneAgentEnvironment(process.env, { profilePath: path.join(userDataPath, "agent-runtime/puppyone-agent") }), windowsHide: true },
    });
    let output = "";
    let cancelled = false;
    let killTimer;
    const stop = () => {
      cancelled = true;
      terminateManagedAgentProcess(handle);
      killTimer ??= setTimeout(() => terminateManagedAgentProcess(handle, "SIGKILL"), 2000);
      killTimer.unref?.();
    };
    const timer = setTimeout(stop, 65_000);
    timer.unref?.();
    signal?.addEventListener("abort", stop, { once: true });
    handle.child.stdout.on("data", (chunk) => { output += String(chunk); if (output.length > 1024) stop(); });
    handle.child.stderr.resume(); // Drain but never log supplier errors or credentials.
    handle.child.once("error", stop);
    handle.child.once("close", (code) => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener("abort", stop);
      if (!cancelled && code === 0 && output.trim() === '{"verified":true}') resolve();
      else reject(connectionError(cancelled ? "CANCELLED" : "VERIFICATION_FAILED"));
    });
  });
}
