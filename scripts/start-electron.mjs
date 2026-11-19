import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultElectronBin } from "./electron-runtime.mjs";
import { repairNodePtyPermissions } from "./node-pty-permissions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
repairNodePtyPermissions(desktopRoot);
const electronExecutable = getDefaultElectronBin(desktopRoot);
const electronArgs = [".", ...process.argv.slice(2)];

const electron = spawn(electronExecutable, electronArgs, {
  cwd: desktopRoot,
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!electron.killed) electron.kill(signal);
  });
}

electron.on("exit", (code) => {
  process.exit(code ?? 0);
});
