import { fileURLToPath } from "node:url";
import { resolveNpmInvocation, spawnManagedChild, terminateManagedChild } from "./managed-child-process.mjs";

const apiBase = "https://qubits-api.puppyone.ai/api/v1";
const webOrigin = "https://qubits-try.puppyone.ai";
const desktopRoot = fileURLToPath(new URL("..", import.meta.url));

try {
  const response = await fetch(`${apiBase}/ai/catalog`, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Agent catalog returned HTTP ${response.status}.`);
  const catalog = await response.json();
  if (catalog.sandbox !== true || !catalog.packs?.length || !catalog.models?.length) {
    throw new Error("The Agent catalog must explicitly identify an available sandbox.");
  }
  console.info(`[agent-sandbox] Cloud API: ${apiBase}`);
  console.info(`[agent-sandbox] Email sign-in: ${webOrigin}`);
  console.info(`[agent-sandbox] Polar sandbox confirmed (${catalog.version}). Model calls use real provider credit.`);
  if (!process.argv.includes("--check")) {
    const npm = resolveNpmInvocation();
    const child = spawnManagedChild(npm.command, [...npm.argsPrefix, "run", "dev"], {
      cwd: desktopRoot, stdio: "inherit",
      env: { ...process.env, VITE_DESKTOP_CLOUD_API_URL: apiBase, VITE_DESKTOP_CLOUD_WEB_URL: webOrigin },
    });
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => terminateManagedChild(child, signal));
    child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
    child.once("exit", (code) => { process.exitCode = code ?? 1; });
  }
} catch (error) {
  console.error(`[agent-sandbox] ${error.message}`);
  process.exitCode = 1;
}
