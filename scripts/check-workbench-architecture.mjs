import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import postcss from "postcss";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const sources = ["src/features/app-shell/auxiliary-workbench/layout", "src/components/brand"];
const forbidden = ["src/features/desktop-terminal", "src/features/desktop-agent"].map((name) => path.join(root, name));
const visited = new Set();
const errors = [];
const inside = (file, directory) => file === directory || file.startsWith(`${directory}${path.sep}`);
const relative = (file) => path.relative(root, file);

// Follow imports, re-exports and stylesheet imports so a forwarding module
// cannot hide a dependency from shared chrome back into a concrete feature.
function inspect(file, chain = []) {
  if (forbidden.some((directory) => inside(file, directory))) {
    errors.push([...chain, file].map(relative).join(" -> "));
    return;
  }
  if (visited.has(file)) return;
  visited.add(file);
  // Global Electron bridge declarations describe every feature's IPC; they
  // do not load feature implementations into shared display components.
  if (file.endsWith(".d.ts")) return;
  const source = readFileSync(file, "utf8");
  const imports = file.endsWith(".css") ? cssImports(source) : ts.preProcessFile(source, true, true).importedFiles.map((entry) => entry.fileName);
  for (const specifier of imports) {
    const direct = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
    const target = direct && existsSync(direct) && statSync(direct).isFile()
      ? direct : ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
    if (target && inside(target, root) && !target.includes(`${path.sep}node_modules${path.sep}`)) inspect(target, [...chain, file]);
  }
}

function cssImports(source) {
  const imports = [];
  postcss.parse(source).walkAtRules("import", (rule) => {
    const match = rule.params.match(/^(?:url\(\s*)?["']([^"']+)["']/);
    if (match) imports.push(match[1]);
  });
  return imports;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : /\.(?:ts|tsx|mjs|css)$/.test(file) ? [file] : [];
  });
}

for (const directory of sources) for (const file of walk(path.join(root, directory))) inspect(file);
if (errors.length) {
  console.error("Shared Workbench chrome must not depend on Terminal or Agent feature implementations:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log("Shared Workbench chrome and brand dependency check passed.");
import "./check-item-host-architecture.mjs";
