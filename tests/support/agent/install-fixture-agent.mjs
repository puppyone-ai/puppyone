import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { utilityProcess } from "electron";

/** Replace provider discovery/execution only. Main, IPC, hosts and UI stay real. */
export function installFixtureAgent(repo) {
  const url = relative => pathToFileURL(path.join(repo, relative)).href;
  const replacements = new Map([
    [url("electron/main/agent/bootstrap/create-agent-runtime-host.mjs"),
      `export { createFixtureAgentRuntime as createDefaultAgentRuntimeHost } from ${JSON.stringify(url("tests/fixtures/agent/runtimes/item-agent-runtime.mjs"))};`],
    [url("electron/main/terminal-agent/terminal-agent-locator.mjs"),
      `export function createTerminalAgentLocator() { return { locate: async () => ({availableAgentIds:['codex'],scannedAt:new Date().toISOString(),source:'scan'}), dispose() {} }; }`],
    [url("electron/main/agent/connections/local-agent-inventory.mjs"),
      `import { deriveLocalConnection } from ${JSON.stringify(url("electron/main/agent/connections/local-agent-connection-policy.mjs"))};
       export function createLocalAgentInventory() { return { dispose() {}, discover: async () => ({
         connections:[deriveLocalConnection({id:'codex',displayName:'Codex',installation:'detected',authentication:'signed-in',version:'0.144.1',protocolCompatible:true,hasModels:true})],
         scannedAt:new Date().toISOString(),warnings:[] }) }; }`],
  ]);
  const hook = registerHooks({ load(target, context, next) {
    return replacements.has(target) ? { format: "module", source: replacements.get(target), shortCircuit: true } : next(target, context);
  } });
  const fork = utilityProcess.fork.bind(utilityProcess);
  utilityProcess.fork = (modulePath, ...args) => fork(
    modulePath === path.join(repo, "electron/utility/agent/main.mjs")
      ? path.join(repo, "tests/fixtures/agent/runtimes/item-agent-utility.mjs") : modulePath, ...args);
  return () => { hook.deregister(); utilityProcess.fork = fork; };
}
