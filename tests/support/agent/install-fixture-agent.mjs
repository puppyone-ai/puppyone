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
    [url("electron/main/local-agent-installation/index.mjs"),
      `export function createLocalAgentInstallationService() { return { discover: async () => ({schemaVersion:1,generation:1,scanId:'local-agent-scan:1',requestedAt:new Date().toISOString(),completedAt:new Date().toISOString(),source:'scan',availableAgentIds:['codex'],results:[{agentId:'codex',displayName:'Codex',status:'found',source:'fixture'}]}), dispose() {} }; }`],
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
