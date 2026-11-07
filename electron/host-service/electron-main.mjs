/**
 * Electron entry for the host service: the same signed program as the App,
 * started with --puppyone-host, with no windows and no Dock icon. Using the
 * App's own binary keeps the OS key store (safeStorage), code signing and
 * updates identical to the App's.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, powerMonitor, safeStorage, utilityProcess } from "electron";
import { hostServiceStateDir } from "./paths.mjs";
import { runHostService } from "./runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
app.setPath("userData", hostServiceStateDir(app.getPath("userData")));
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.dock?.hide();
  // There are never windows; nothing should quit the service but a shutdown.
  app.on("window-all-closed", () => {});
  // Never a top-level await: Electron emits "ready" only after the main module has loaded.
  app.whenReady().then(async () => {
    const host = await runHostService({
      stateDir: app.getPath("userData"),
      secureStorage: safeStorage,
      utilityProcess,
      fileServiceModulePath: path.join(here, "..", "utility", "host-file-service", "main.mjs"),
      hostExecModulePath: path.join(here, "..", "utility", "host-exec", "main.mjs"),
      appVersion: app.getVersion(),
      onShutdown: () => app.quit(),
    });
    powerMonitor.on("suspend", () => host.service.suspend());
    powerMonitor.on("resume", () => host.service.wake());
    powerMonitor.on("unlock-screen", () => host.service.wake());
    app.on("before-quit", () => { void host.close(); });
  }).catch((error) => {
    console.error("PuppyOne Host failed to start:", error?.message ?? error);
    app.exit(1);
  });
}
