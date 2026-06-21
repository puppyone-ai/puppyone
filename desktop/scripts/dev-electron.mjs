import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const devUrl = "http://127.0.0.1:5173";
const defaultElectronBin = process.platform === "win32"
  ? path.join(desktopRoot, "node_modules", ".bin", "electron.cmd")
  : path.join(desktopRoot, "node_modules", ".bin", "electron");
const electronSourceAppPath = path.join(
  desktopRoot,
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
);
const electronDevAppPath = path.join("/private/tmp", "puppyone-electron-dev", "puppyone.app");
const electronDevAppExecutablePath = path.join(electronDevAppPath, "Contents", "MacOS", "Electron");
const electronDevAppIconPath = path.join(
  electronDevAppPath,
  "Contents",
  "Resources",
  "electron.icns",
);
const electronDevInfoPlistPath = path.join(
  electronDevAppPath,
  "Contents",
  "Info.plist",
);
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
  if (process.platform !== "darwin") return defaultElectronBin;

  try {
    if (!existsSync(electronDevAppExecutablePath)) {
      rmSync(electronDevAppPath, { recursive: true, force: true });
      copyAppBundle(electronSourceAppPath, electronDevAppPath);
    }

    if (existsSync(desktopDevAppIconPath) && existsSync(electronDevAppIconPath)) {
      copyFileSync(desktopDevAppIconPath, electronDevAppIconPath);
    }
    if (existsSync(electronDevInfoPlistPath)) {
      setPlistValue("CFBundleName", "puppyone");
      setPlistValue("CFBundleDisplayName", "puppyone");
      setPlistValue("CFBundleIdentifier", "ai.puppyone.desktop.dev");
      setPlistValue("CFBundleExecutable", "Electron");
      setPlistValue("CFBundleIconFile", "electron.icns");
    }
    return electronDevAppExecutablePath;
  } catch (error) {
    console.warn("Unable to prepare puppyone dev app:", error);
    return defaultElectronBin;
  }
}

function copyAppBundle(sourcePath, targetPath) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const result = spawnSync("/bin/cp", ["-R", sourcePath, targetPath], {
    stdio: "ignore",
  });
  if (result.status !== 0) {
    throw new Error(`Failed to copy Electron app bundle from ${sourcePath}`);
  }
}

function setPlistValue(key, value) {
  spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, electronDevInfoPlistPath], {
    stdio: "ignore",
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
