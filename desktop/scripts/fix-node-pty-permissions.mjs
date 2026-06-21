import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const helperPaths = [
  path.join(desktopRoot, "node_modules", "node-pty", "prebuilds", "darwin-arm64", "spawn-helper"),
  path.join(desktopRoot, "node_modules", "node-pty", "prebuilds", "darwin-x64", "spawn-helper"),
];

for (const helperPath of helperPaths) {
  if (!existsSync(helperPath)) continue;
  chmodSync(helperPath, 0o755);
}
