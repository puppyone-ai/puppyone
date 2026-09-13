import assert from "node:assert/strict";
import fs from "node:fs";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// UI belongs to the workbench DOM. Only execution belongs to utility processes.
const main = read("electron/main.mjs");
for (const name of ["createTerminalProcessService", "createAgentProcessService", "registerSessionConnectionIpcHandlers", "createItemHostBudget"]) {
  assert(main.includes(name), `Missing session runtime composition: ${name}`);
}
assert(!/createItemDisplayManager|createItemRendererAuthority|item-preload/.test(main), "Session UI must not allocate native child views.");
assert(!/from ["'](?:node-pty|\.\/main\/terminal-service\.mjs)["']/.test(main), "Main must not own PTYs or terminal parsing.");
assert(!read("vite.config.ts").includes("item-host.html"), "Session UI must use the application's renderer entry point.");

for (const file of [
  "src/features/desktop-terminal/workbench/TerminalWorkbenchContribution.tsx",
  "src/features/desktop-agent/workbench/AgentChatWorkbenchItem.tsx",
  "src/features/desktop-terminal/runtime/terminalSessionBridge.ts",
  "src/features/desktop-agent/infrastructure/electron/agentSessionClient.ts",
  "electron/main/ipc/session-connection-ipc.mjs",
]) {
  assert(!/WebContentsView|useNativeSurfaceGeometry|setBounds|HostedItemView/.test(read(file)), `${file}: session UI and transport must not synchronize native geometry.`);
}
const terminal = read("src/features/desktop-terminal/workbench/TerminalWorkbenchContribution.tsx");
assert(terminal.includes("<TerminalSessionView") && terminal.includes("projectTerminalRuntimes"), "Terminal UI must consume its project-owned runtime in the DOM.");
assert(read("src/features/desktop-agent/lazy.ts").includes('import("./workbench/AgentChatWorkbenchItem")'), "Agent UI must render its existing React component.");
assert(!read("src/features/desktop-terminal/runtime/terminalRuntime.ts").includes("closest(\".desktop-right-sidebar\")"), "Terminal fitting must depend on its own container, not a sidebar ancestor.");
assert(!/width|height|bounds|visible/.test(read("shared/session-transport/types.ts")), "Session connection contracts must not carry layout state.");

const manifest = JSON.parse(read("package.json"));
for (const dependency of ["@xterm/headless", "@xterm/addon-serialize", "@xterm/addon-unicode11"]) {
  assert(/^\d+\.\d+\.\d+$/.test(manifest.dependencies[dependency]), `${dependency} must be a pinned production dependency.`);
}
console.log("DOM session UI and isolated execution boundaries verified.");
