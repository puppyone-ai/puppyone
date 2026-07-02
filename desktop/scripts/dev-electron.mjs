import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareElectronAppRuntime } from "./electron-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const devUrl = "http://127.0.0.1:5173";
const electronDevAppPath = path.join("/private/tmp", "puppyone-electron-dev", "puppyone.app");
const desktopDevAppIconPath = path.join(desktopRoot, "src-tauri", "icons", "icon.icns");
const mainWatchPaths = [
  path.join(desktopRoot, "electron"),
  path.join(desktopRoot, "local-api"),
  path.join(desktopRoot, "public", "logo-square.png"),
  path.join(desktopRoot, "src-tauri", "icons", "icon.icns"),
];

const renderer = spawn("npm", ["run", "dev:renderer"], {
  cwd: desktopRoot,
  stdio: "inherit",
  env: process.env,
});

let electronStarted = false;
let healthCheckInFlight = false;
let electron = null;
let electronRestarting = false;
let restartTimer = null;
const watchers = [];
const healthCheck = setInterval(async () => {
  if (electronStarted || healthCheckInFlight) return;
  healthCheckInFlight = true;

  try {
    const response = await fetch(devUrl);
    if (!response.ok) return;
  } catch {
    return;
  } finally {
    healthCheckInFlight = false;
  }

  if (electronStarted) return;
  electronStarted = true;
  clearInterval(healthCheck);

  startElectron();
  startMainWatchers();
}, 250);

function startElectron() {
  const electronExecutable = prepareElectronDevRuntime();

  electron = spawn(electronExecutable, ["."], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PUPPYONE_DESKTOP_DEV_URL: devUrl,
    },
  });

  electron.on("exit", (code) => {
    electron = null;
    if (electronRestarting) {
      electronRestarting = false;
      startElectron();
      return;
    }

    stopMainWatchers();
    renderer.kill("SIGTERM");
    process.exit(code ?? 0);
  });
}

function prepareElectronDevRuntime() {
  return prepareElectronAppRuntime({
    desktopRoot,
    targetAppPath: electronDevAppPath,
    appName: "puppyone",
    displayName: "puppyone",
    bundleIdentifier: "ai.puppyone.desktop.dev",
    iconPath: desktopDevAppIconPath,
  });
}

function scheduleElectronRestart() {
  if (!electronStarted || !electron) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (!electron) {
      startElectron();
      return;
    }
    electronRestarting = true;
    electron.kill("SIGTERM");
  }, 120);
}

function startMainWatchers() {
  for (const watchPath of mainWatchPaths) {
    const watcher = watch(watchPath, { recursive: true }, (_eventType, fileName) => {
      const changedFile = String(fileName ?? "");
      if (changedFile.endsWith("~") || changedFile.includes(".swp")) return;
      scheduleElectronRestart();
    });
    watchers.push(watcher);
  }
}

function stopMainWatchers() {
  for (const watcher of watchers) {
    watcher.close();
  }
  watchers.length = 0;
}

renderer.on("exit", (code) => {
  clearInterval(healthCheck);
  stopMainWatchers();
  if (electron) electron.kill("SIGTERM");
  if (!electronStarted) process.exit(code ?? 0);
});
