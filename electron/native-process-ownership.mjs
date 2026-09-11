/** Report native children to the external utility supervisor, not a Renderer. */
export function reportNativeProcess(child, { grouped = false, subscribeExit = true } = {}) {
  const parent = process.parentPort;
  if (!parent || !Number.isSafeInteger(child?.pid) || child.pid <= 0) return () => {};
  const generation = process.argv.at(-1);
  const pid = child.pid;
  parent.postMessage({ type: "native-process", generation, action: "spawn", pid, grouped });
  const exited = () => parent.postMessage({ type: "native-process", generation, action: "exit", pid, grouped });
  if (subscribeExit) child.once("exit", exited);
  return exited;
}
