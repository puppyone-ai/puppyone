import { createNativeProcessHandle } from "../../platform/common/native-process-handle.mjs";
import { resolveProcessInvocation } from "../../platform/windows/process-invocation.mjs";

export { terminateNativeProcess as terminateManagedAgentProcess,
  afterNativeProcessTermination as afterManagedAgentTermination } from "../../platform/common/native-process-handle.mjs";

/** Launches one native Agent as an isolated POSIX process group when available. */
export function createManagedAgentProcess({
  spawn,
  executablePath,
  args,
  options,
  platform = process.platform,
}) {
  const grouped = platform !== "win32";
  const invocation = resolveProcessInvocation(executablePath, args, { env: options?.env, platform });
  const child = spawn(invocation.file, invocation.args, {
    ...options,
    shell: false,
    detached: grouped,
    ...invocation.options,
  });
  return createNativeProcessHandle(child, { grouped, platform });
}

/** Disposal is complete only after the operating system reports process exit. */
export async function waitForManagedAgentExit(connection, { timeoutMs = 3500 } = {}) {
  const info = connection.exitInfo ?? await new Promise((resolve, reject) => {
    const done = (info) => { clearTimeout(timer); resolve(info); };
    const timer = setTimeout(() => {
      connection.removeListener("exit", done);
      reject(new Error("Native Agent process exit could not be confirmed."));
    }, timeoutMs);
    timer.unref?.();
    connection.once("exit", done);
  });
  if (connection.processHandle?.termination && !await connection.processHandle.termination) {
    throw new Error("Native Agent process tree exit could not be confirmed.");
  }
  return info;
}
