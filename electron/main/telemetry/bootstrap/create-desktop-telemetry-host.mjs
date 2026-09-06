import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DESKTOP_STABLE_TELEMETRY_INGEST_URL } from "../../../../shared/desktop-telemetry-distribution-contract.mjs";
import {
  createDesktopTelemetryService,
  resolveTelemetryEligibility,
} from "../application/desktop-telemetry-service.mjs";
import { normalizeDesktopOsMajor } from "../domain/daily-active-event.mjs";
import { createTelemetryHttpTransport } from "../infrastructure/telemetry-http-transport.mjs";
import { createTelemetryIdentityStore } from "../infrastructure/telemetry-identity-store.mjs";
import { createTelemetryLifecycleStore } from "../infrastructure/telemetry-lifecycle-store.mjs";
import { createTelemetryPreferenceStore } from "../infrastructure/telemetry-preference-store.mjs";
import { createTelemetryQueueStore } from "../infrastructure/telemetry-queue-store.mjs";

export function createDesktopTelemetryHost({
  app,
  buildInfo,
  endpoint = DESKTOP_STABLE_TELEMETRY_INGEST_URL,
  fetchImpl = globalThis.fetch,
  fsModule = fs,
  getWindows,
  logger = console,
  systemVersion = readSystemVersion(),
  userDataPath = app.getPath("userData"),
}) {
  if (!app || typeof app.on !== "function" || typeof app.removeListener !== "function") {
    throw new TypeError("An Electron app event authority is required for telemetry.");
  }
  if (typeof getWindows !== "function") throw new TypeError("getWindows must be a function.");

  const eligibility = resolveTelemetryEligibility({ buildInfo, isPackaged: app.isPackaged });
  const storageRoot = path.join(userDataPath, "desktop-telemetry");
  const preferenceStore = createTelemetryPreferenceStore({
    defaultLevel: eligibility.defaultLevel,
    filePath: path.join(storageRoot, "preferences-v1.json"),
    fsModule,
  });
  const identityStore = createTelemetryIdentityStore({
    filePath: path.join(storageRoot, "identity-v1.json"),
    fsModule,
  });
  const lifecycleStore = createTelemetryLifecycleStore({
    filePath: path.join(storageRoot, "lifecycle-v1.json"),
    fsModule,
  });
  const queueStore = createTelemetryQueueStore({
    filePath: path.join(storageRoot, "queue-v1.json"),
    fsModule,
  });
  const transport = eligibility.eligible && endpoint
    ? createTelemetryHttpTransport({ endpoint, fetchImpl })
    : null;
  const service = createDesktopTelemetryService({
    architecture: process.arch,
    buildInfo,
    identityStore,
    isPackaged: app.isPackaged,
    lifecycleStore,
    logger,
    osMajor: normalizeDesktopOsMajor(systemVersion),
    platform: process.platform,
    preferenceStore,
    queueStore,
    transport,
  });

  let started = false;
  let stopStateBroadcast = null;
  const onForeground = () => {
    void service.noteForegroundActivity().catch((error) => {
      logger.warn?.("Unable to record bounded desktop activity telemetry.", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    });
  };
  const broadcast = (state) => {
    for (const window of getWindows()) {
      if (window?.isDestroyed?.() || window?.webContents?.isDestroyed?.()) continue;
      window.webContents.send("telemetry:state-changed", state);
    }
  };

  return Object.freeze({
    service,
    async start() {
      if (started) return service.initialize();
      started = true;
      const state = await service.start();
      stopStateBroadcast = service.onDidChange(broadcast);
      app.on("browser-window-focus", onForeground);
      return state;
    },
    dispose() {
      app.removeListener("browser-window-focus", onForeground);
      stopStateBroadcast?.();
      stopStateBroadcast = null;
      service.dispose();
    },
  });
}

function readSystemVersion() {
  try {
    if (typeof process.getSystemVersion === "function") return process.getSystemVersion();
  } catch {
    // Fall through to the OS release when Electron cannot expose the version.
  }
  return os.release();
}
