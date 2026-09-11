import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const visited = new Set();
function visit(relative) {
  if (visited.has(relative)) return;
  visited.add(relative);
  assert(!/desktop-terminal\/runtime\/(?:terminalRuntime|TerminalRuntimePool)|desktop-agent\/(?:ui\/|application\/AgentSessionController)/.test(relative),
    `Shell contribution loads an isolated content runtime: ${relative}`);
  const source = ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true);
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
    if (node.isTypeOnly || node.importClause?.isTypeOnly || !node.moduleSpecifier) continue;
    const bindings = node.importClause?.namedBindings ?? node.exportClause;
    if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
      && bindings.elements.length && bindings.elements.every((item) => item.isTypeOnly)) continue;
    const specifier = node.moduleSpecifier.text;
    assert(!specifier.startsWith("@xterm/"), `Shell contribution loads xterm: ${relative}`);
    if (!specifier.startsWith(".") || specifier.endsWith(".css")) continue;
    const base = path.resolve(root, path.dirname(relative), specifier);
    const resolved = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"]
      .map((suffix) => base + suffix).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (resolved) visit(path.relative(root, resolved));
  }
}
visit("src/features/desktop-terminal/workbench/TerminalWorkbenchContribution.tsx");
visit("src/features/desktop-agent/workbench/HostedAgentWorkbenchItem.tsx");
const main = read("electron/main.mjs");
assert(!/from ["'](?:node-pty|\.\/main\/terminal-service\.mjs)["']/.test(main), "Main cannot own a PTY parser or process service.");
for (const text of ["createTerminalProcessService", "createAgentProcessService", "createItemDisplayManager", "createItemHostBudget"]) assert(main.includes(text), `Missing production composition: ${text}`);
const display = read("electron/main/item-hosts/display-manager.mjs");
for (const text of ["new WebContentsView", "getOSProcessId", "budget.reserve", "contextIsolation: true", "sandbox: true", "processAlive", "closeRequested"]) assert(display.includes(text), `Missing display safety boundary: ${text}`);
const preload = read("electron/item-preload.cjs");
assert(!/require\(["'](?:node:|fs|child_process)/.test(preload), "Child preload must not expose Node authority.");
assert(!/readFile|execCommand|item-host:create/.test(preload), "Child preload contains Shell-only authority.");
const manifest = JSON.parse(read("package.json"));
for (const dependency of ["@xterm/headless", "@xterm/addon-serialize", "@xterm/addon-unicode11"]) {
  assert(/^\d+\.\d+\.\d+$/.test(manifest.dependencies[dependency]), `${dependency} must be a pinned production dependency.`);
}
assert(read("vite.config.ts").includes("item-host.html"), "Isolated Renderer is missing from the production build.");
console.log(`Item host isolation architecture passed (${visited.size} Shell dependency modules checked).`);
