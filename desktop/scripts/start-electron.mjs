import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareElectronAppRuntime } from "./electron-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const electronStartAppPath = path.join("/private/tmp", "puppyone-electron-start", "puppyone.app");
const desktopAppIconPath = path.join(desktopRoot, "src-tauri", "icons", "icon.icns");

const electronExecutable = prepareElectronAppRuntime({
  desktopRoot,
  targetAppPath: electronStartAppPath,
  appName: "puppyone",
  displayName: "puppyone",
  bundleIdentifier: "ai.puppyone.desktop.local",
  iconPath: desktopAppIconPath,
});

const electron = spawn(electronExecutable, ["."], {
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
