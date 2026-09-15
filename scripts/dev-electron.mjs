import { watch, watchFile, unwatchFile } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultElectronBin } from "./electron-runtime.mjs";
import { watchInterfaceStyleGraph } from "./interface-style-graph-watcher.mjs";
import {
  isLoopbackHostname,
  loadDesktopDevelopmentEnvironment,
  parseConfiguredHttpUrl,
  prepareLocalCloudDevServices,
  resolveLocalCloudDevConfig,
} from "./local-cloud-dev.mjs";
import {
  resolveNpmInvocation,
  spawnManagedChild,
  terminateManagedChild,
} from "./managed-child-process.mjs";
import { probeViteDevServer } from "./vite-client-health.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const mainWatchPaths = [
  path.join(desktopRoot, "electron"),
  path.join(desktopRoot, "local-api"),
  path.join(desktopRoot, "locales", "native"),
  path.join(desktopRoot, "locales", "manifest.json"),
  path.join(desktopRoot, "assets", "brand", "puppy", "puppy-app-image.png"),
  path.join(desktopRoot, "assets", "brand", "puppy", "puppy-app-image-dev.png"),
];
const rendererDependencyWatchPaths = [
  path.join(desktopRoot, "package.json"),
  path.join(desktopRoot, "package-lock.json"),
  path.join(desktopRoot, "node_modules", "vite", "package.json"),
  path.join(desktopRoot, "node_modules", "vite", "dist", "client", "client.mjs"),
  path.join(desktopRoot, "src", "styles", "interface-styles.generated.css"),
];
const rendererStyleGraphRoot = path.join(desktopRoot, "src", "styles", "interfaces");

let renderer = null;
let rendererHost = null;
let rendererPort = null;
let devUrl = null;
let desktopCloudWebUrl = null;
let healthCheckInFlight = false;
let healthCheck = null;
let electron = null;
let electronRestarting = false;
let electronRestartTimer = null;
let environmentRestartTimer = null;
let rendererRestartTimer = null;
let rendererStyleGraphWatcher = null;
let environmentRestarting = false;
let rendererStartedDuringEnvironmentRestart = false;
let shuttingDown = false;
let exitCode = 0;
let localCloudServices = null;
let localCloudHealthCheck = null;
let localCloudHealthCheckInFlight = false;
let localCloudFailureCount = 0;
const watchers = [];
let lastEnvironmentRestartReason = "renderer dependency changed";

void startDevelopmentEnvironment();

async function startDevelopmentEnvironment() {
  try {
    const developmentEnvironment = loadDesktopDevelopmentEnvironment({ desktopRoot });
    const rendererUrl = parseConfiguredHttpUrl(
      developmentEnvironment.PUPPYONE_DESKTOP_RENDERER_URL,
      "PUPPYONE_DESKTOP_RENDERER_URL",
    );
    if (
      rendererUrl.protocol !== "http:"
      || !isLoopbackHostname(rendererUrl.hostname)
      || rendererUrl.pathname !== "/"
      || rendererUrl.search
      || rendererUrl.hash
    ) {
      throw new Error("PUPPYONE_DESKTOP_RENDERER_URL must use an HTTP loopback origin.");
    }
    parseConfiguredHttpUrl(
      developmentEnvironment.VITE_DESKTOP_CLOUD_API_URL,
      "VITE_DESKTOP_CLOUD_API_URL",
    );
    const cloudWebUrl = parseConfiguredHttpUrl(
      developmentEnvironment.VITE_DESKTOP_CLOUD_WEB_URL,
      "VITE_DESKTOP_CLOUD_WEB_URL",
    );
    rendererHost = rendererUrl.hostname === "localhost"
      ? "127.0.0.1"
      : rendererUrl.hostname.replace(/^\[|\]$/g, "");
    rendererPort = rendererUrl.port ? Number(rendererUrl.port) : 80;
    devUrl = rendererUrl.origin;

    const localCloudConfig = resolveLocalCloudDevConfig({
      desktopRoot,
      environment: developmentEnvironment,
    });
    desktopCloudWebUrl = cloudWebUrl.toString().replace(/\/+$/, "");
    if (localCloudConfig) {
      localCloudServices = await prepareLocalCloudDevServices(localCloudConfig);
      for (const { child, name } of localCloudServices.ownedProcesses) {
        child.on("exit", (code, signal) => {
          if (shuttingDown) {
            maybeExit();
            return;
          }
          console.error(
            `[desktop-dev] Local Cloud ${name} exited unexpectedly (${signal ?? code ?? "unknown"}).`,
          );
          beginShutdown(typeof code === "number" && code !== 0 ? code : 1);
        });
      }
      startLocalCloudHealthCheck();
    }

    startRenderer();
    startRendererDependencyWatchers();
    startRendererStyleGraphWatcher();
    startRendererHealthCheck();
  } catch (error) {
    console.error(
      "[desktop-dev] Unable to prepare the development environment:",
      error instanceof Error ? error.message : String(error),
    );
    beginShutdown(1);
  }
}

function startRendererHealthCheck() {
  healthCheck = setInterval(async () => {
    if (shuttingDown || !renderer || healthCheckInFlight) return;
    healthCheckInFlight = true;
    const probedRenderer = renderer;

    let result;
    try {
      result = await probeViteDevServer(devUrl, {
        signal: AbortSignal.timeout(2_000),
      });
    } finally {
      healthCheckInFlight = false;
    }

    if (renderer !== probedRenderer) return;

    if (!result.ready) {
      if (
        result.reason === "unresolved-client-placeholders" &&
        !environmentRestarting
      ) {
        const placeholders = result.placeholders.join(", ");
        scheduleEnvironmentRestart(`stale Vite client (${placeholders})`, 0);
      }
      return;
    }

    if (environmentRestarting) {
      if (!rendererStartedDuringEnvironmentRestart) return;
      environmentRestarting = false;
      rendererStartedDuringEnvironmentRestart = false;
      console.info("[desktop-dev] Renderer environment is healthy again.");
    }

    if (!electron) {
      startElectron();
      startMainWatchers();
    }
  }, 500);
}

function startLocalCloudHealthCheck() {
  localCloudHealthCheck = setInterval(async () => {
    if (shuttingDown || !localCloudServices || localCloudHealthCheckInFlight) return;
    localCloudHealthCheckInFlight = true;
    try {
      const results = await localCloudServices.probeAll();
      const unhealthy = results.filter((result) => !result.ready);
      if (unhealthy.length === 0) {
        localCloudFailureCount = 0;
        return;
      }

      localCloudFailureCount += 1;
      const detail = unhealthy
        .map((result) => `${result.name}: ${result.detail}`)
        .join("; ");
      if (localCloudFailureCount < 2) {
        console.warn(`[desktop-dev] Local Cloud health check failed; retrying (${detail}).`);
        return;
      }

      console.error(`[desktop-dev] Local Cloud became unhealthy (${detail}).`);
      beginShutdown(1);
    } finally {
      localCloudHealthCheckInFlight = false;
    }
  }, 30_000);
}

function startRenderer() {
  if (shuttingDown || renderer) return;

  const npm = resolveNpmInvocation();
  const child = spawnManagedChild(npm.command, [
    ...npm.argsPrefix,
    "run",
    "dev:renderer",
    "--",
    "--host",
    rendererHost,
    "--port",
    String(rendererPort),
    "--strictPort",
  ], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: process.env,
  });
  renderer = child;
  if (environmentRestarting) {
    rendererStartedDuringEnvironmentRestart = true;
  }

  child.on("exit", (code) => {
    if (renderer !== child) return;
    renderer = null;

    if (shuttingDown) {
      maybeExit();
      return;
    }

    if (environmentRestarting) {
      scheduleRendererStart();
      return;
    }

    beginShutdown(code ?? 0);
  });
}

function scheduleRendererStart() {
  if (rendererRestartTimer) clearTimeout(rendererRestartTimer);
  rendererRestartTimer = setTimeout(() => {
    rendererRestartTimer = null;
    startRenderer();
  }, 600);
}

function startElectron() {
  if (shuttingDown || electron) return;
  const electronExecutable = getDefaultElectronBin(desktopRoot);

  const child = spawnManagedChild(electronExecutable, ["."], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PUPPYONE_DESKTOP_DEV_URL: devUrl,
      ...(desktopCloudWebUrl
        ? { VITE_DESKTOP_CLOUD_WEB_URL: desktopCloudWebUrl }
        : {}),
    },
  });
  electron = child;

  child.on("exit", (code) => {
    if (electron !== child) return;
    electron = null;

    if (shuttingDown) {
      maybeExit();
      return;
    }

    if (environmentRestarting) return;

    if (electronRestarting) {
      electronRestarting = false;
      startElectron();
      return;
    }

    beginShutdown(code ?? 0);
  });
}

function scheduleElectronRestart() {
  if (shuttingDown || environmentRestarting || !electron) return;
  if (electronRestartTimer) clearTimeout(electronRestartTimer);
  electronRestartTimer = setTimeout(() => {
    electronRestartTimer = null;
    if (!electron) {
      startElectron();
      return;
    }
    electronRestarting = true;
    terminateManagedChild(electron);
  }, 120);
}

function startMainWatchers() {
  if (watchers.length > 0) return;

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

function startRendererDependencyWatchers() {
  for (const watchPath of rendererDependencyWatchPaths) {
    watchFile(watchPath, { interval: 500 }, (current, previous) => {
      const unchanged =
        current.ino === previous.ino &&
        current.size === previous.size &&
        current.mtimeMs === previous.mtimeMs;
      if (unchanged) return;

      const relativePath = path.relative(desktopRoot, watchPath);
      scheduleEnvironmentRestart(`${relativePath} changed`, 700);
    });
  }
}

function stopRendererDependencyWatchers() {
  for (const watchPath of rendererDependencyWatchPaths) {
    unwatchFile(watchPath);
  }
}

function startRendererStyleGraphWatcher() {
  if (rendererStyleGraphWatcher) return;
  rendererStyleGraphWatcher = watchInterfaceStyleGraph(
    rendererStyleGraphRoot,
    ({ fileName }) => {
      scheduleEnvironmentRestart(`Interface Style import graph changed (${fileName})`, 300);
    },
  );
}

function stopRendererStyleGraphWatcher() {
  rendererStyleGraphWatcher?.close();
  rendererStyleGraphWatcher = null;
}

function scheduleEnvironmentRestart(reason, delayMs) {
  if (shuttingDown) return;
  lastEnvironmentRestartReason = reason;
  if (environmentRestartTimer) clearTimeout(environmentRestartTimer);
  environmentRestartTimer = setTimeout(() => {
    environmentRestartTimer = null;
    restartEnvironment(lastEnvironmentRestartReason);
  }, delayMs);
}

function restartEnvironment(reason) {
  if (shuttingDown) return;
  environmentRestarting = true;
  rendererStartedDuringEnvironmentRestart = false;
  electronRestarting = false;

  if (electronRestartTimer) {
    clearTimeout(electronRestartTimer);
    electronRestartTimer = null;
  }

  console.warn(`[desktop-dev] ${reason}; restarting renderer and Electron.`);
  if (electron) terminateManagedChild(electron);
  if (renderer) {
    terminateManagedChild(renderer);
  } else {
    scheduleRendererStart();
  }
}

function beginShutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  stopMainWatchers();
  stopRendererDependencyWatchers();
  stopRendererStyleGraphWatcher();
  if (healthCheck) clearInterval(healthCheck);
  if (localCloudHealthCheck) clearInterval(localCloudHealthCheck);
  if (electronRestartTimer) clearTimeout(electronRestartTimer);
  if (environmentRestartTimer) clearTimeout(environmentRestartTimer);
  if (rendererRestartTimer) clearTimeout(rendererRestartTimer);
  if (electron) terminateManagedChild(electron);
  if (renderer) terminateManagedChild(renderer);
  localCloudServices?.stop();
  maybeExit();
}

function maybeExit() {
  if (!shuttingDown || electron || renderer) return;
  const localCloudProcessRunning = localCloudServices?.ownedProcesses.some(
    ({ child }) => child.exitCode === null && child.signalCode === null,
  );
  if (localCloudProcessRunning) return;
  process.exit(exitCode);
}

process.once("SIGINT", () => beginShutdown(130));
process.once("SIGTERM", () => beginShutdown(143));
