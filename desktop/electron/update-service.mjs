import updaterPackage from "electron-updater";
import log from "electron-log";

const UPDATE_STATE_CHANNEL = "updates:state";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 15 * 1000;

const UPDATE_ACTION_STATES = new Set([
  "idle",
  "not-available",
  "available",
  "downloaded",
  "blocked",
  "error",
]);

export function createUpdateService({
  app,
  ipcMain,
  getWindows,
  getRestartBlockers,
}) {
  const { autoUpdater } = updaterPackage;
  const channel = normalizeUpdateChannel(process.env.PUPPYONE_DESKTOP_UPDATE_CHANNEL);
  const feedUrl = normalizeUpdateFeedUrl(process.env.PUPPYONE_DESKTOP_UPDATE_URL);
  const devFeedUrl = normalizeUpdateFeedUrl(process.env.PUPPYONE_DESKTOP_DEV_UPDATE_URL);
  const forceDevUpdateConfig = isTruthyEnv(process.env.PUPPYONE_DESKTOP_FORCE_DEV_UPDATE_CONFIG) || Boolean(devFeedUrl);
  const disabledReason = getDisabledReason(app, forceDevUpdateConfig);
  const canUseUpdater = !disabledReason;

  let startupCheckTimer = null;
  let intervalTimer = null;
  let operationPromise = null;
  let latestUpdateInfo = null;
  let state = createInitialUpdateState({
    app,
    channel,
    disabledReason,
  });

  function start() {
    configureLogger();
    configureUpdater();
    registerUpdaterEvents();
    registerIpcHandlers();

    if (!canUseUpdater) {
      publishState({
        status: "disabled",
        reason: disabledReason,
      });
      return;
    }

    startupCheckTimer = setTimeout(() => {
      void checkForUpdates({ silent: true });
    }, STARTUP_CHECK_DELAY_MS);
    intervalTimer = setInterval(() => {
      void checkForUpdates({ silent: true });
    }, CHECK_INTERVAL_MS);
  }

  function dispose() {
    if (startupCheckTimer) clearTimeout(startupCheckTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    startupCheckTimer = null;
    intervalTimer = null;
  }

  function registerIpcHandlers() {
    ipcMain.handle("updates:get-state", () => state);
    ipcMain.handle("updates:check", () => checkForUpdates({ silent: false }));
    ipcMain.handle("updates:download", () => downloadUpdate());
    ipcMain.handle("updates:update-now", () => updateNow());
    ipcMain.handle("updates:install", () => installDownloadedUpdate());
  }

  function configureLogger() {
    try {
      log.transports.file.level = "info";
      log.transports.console.level = process.env.PUPPYONE_DESKTOP_UPDATE_LOG_CONSOLE === "1" ? "debug" : false;
      autoUpdater.logger = log;
    } catch (error) {
      console.warn("Unable to configure updater logger:", error);
    }
  }

  function configureUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.channel = channel;
    autoUpdater.allowPrerelease = channel !== "stable";

    if (forceDevUpdateConfig) {
      autoUpdater.forceDevUpdateConfig = true;
    }

    const overrideFeedUrl = devFeedUrl ?? feedUrl;
    if (overrideFeedUrl) {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: overrideFeedUrl,
        channel,
      });
    }
  }

  function registerUpdaterEvents() {
    autoUpdater.on("checking-for-update", () => {
      publishState({
        status: "checking",
        error: null,
        blockers: [],
      });
    });

    autoUpdater.on("update-available", (info) => {
      latestUpdateInfo = normalizeUpdateInfo(info);
      publishState({
        status: "available",
        updateInfo: latestUpdateInfo,
        availableVersion: latestUpdateInfo.version,
        error: null,
        blockers: [],
        progress: null,
      });
    });

    autoUpdater.on("update-not-available", (info) => {
      latestUpdateInfo = null;
      publishState({
        status: "not-available",
        updateInfo: normalizeUpdateInfo(info),
        availableVersion: null,
        progress: null,
        blockers: [],
        error: null,
        lastCheckedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      publishState({
        status: "downloading",
        progress: normalizeProgress(progress),
        error: null,
        blockers: [],
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      latestUpdateInfo = normalizeUpdateInfo(info);
      publishState({
        status: "downloaded",
        updateInfo: latestUpdateInfo,
        availableVersion: latestUpdateInfo.version,
        progress: null,
        blockers: [],
        error: null,
      });
    });

    autoUpdater.on("error", (error) => {
      publishState({
        status: "error",
        error: normalizeError(error),
        progress: null,
      });
    });
  }

  async function checkForUpdates({ silent }) {
    return runExclusive(async () => {
      if (!canUseUpdater) return state;
      publishState({
        status: "checking",
        error: null,
        blockers: [],
        ...(silent ? { silent: true } : {}),
      });

      try {
        const result = await autoUpdater.checkForUpdates();
        if (!result?.updateInfo && state.status === "checking") {
          publishState({
            status: "not-available",
            lastCheckedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        publishState({
          status: "error",
          error: normalizeError(error),
        });
      }
      return state;
    });
  }

  async function downloadUpdate() {
    return runExclusive(async () => {
      if (!canUseUpdater) return state;
      if (state.status === "downloaded") return state;

      if (UPDATE_ACTION_STATES.has(state.status) && state.status !== "available") {
        await checkForUpdatesInternal();
      }

      if (state.status !== "available") return state;

      try {
        publishState({
          status: "downloading",
          progress: state.progress ?? createEmptyProgress(),
          error: null,
          blockers: [],
        });
        await autoUpdater.downloadUpdate();
      } catch (error) {
        publishState({
          status: "error",
          error: normalizeError(error),
          progress: null,
        });
      }
      return state;
    });
  }

  async function updateNow() {
    return runExclusive(async () => {
      if (!canUseUpdater) return state;

      if (shouldCheckBeforeUpdateNow(state.status)) {
        await checkForUpdatesInternal();
      }

      if (state.status === "available") {
        await downloadUpdateInternal();
      }

      if (state.status === "downloaded" || state.status === "blocked") {
        await installDownloadedUpdateInternal();
      }

      return state;
    });
  }

  async function installDownloadedUpdate() {
    return runExclusive(async () => {
      await installDownloadedUpdateInternal();
      return state;
    });
  }

  async function checkForUpdatesInternal() {
    publishState({
      status: "checking",
      error: null,
      blockers: [],
    });

    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.updateInfo && state.status === "checking") {
        publishState({
          status: "not-available",
          lastCheckedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      publishState({
        status: "error",
        error: normalizeError(error),
      });
    }
  }

  async function downloadUpdateInternal() {
    try {
      publishState({
        status: "downloading",
        progress: state.progress ?? createEmptyProgress(),
        error: null,
        blockers: [],
      });
      await autoUpdater.downloadUpdate();
    } catch (error) {
      publishState({
        status: "error",
        error: normalizeError(error),
        progress: null,
      });
    }
  }

  async function installDownloadedUpdateInternal() {
    if (state.status !== "downloaded" && state.status !== "blocked") return;

    const blockers = normalizeRestartBlockers(await Promise.resolve(getRestartBlockers()));
    if (blockers.length > 0) {
      publishState({
        status: "blocked",
        blockers,
        error: null,
      });
      return;
    }

    publishState({
      status: "installing",
      blockers: [],
      error: null,
    });
    autoUpdater.quitAndInstall(false, true);
  }

  async function runExclusive(operation) {
    if (operationPromise) {
      await operationPromise;
      return state;
    }

    operationPromise = operation()
      .catch((error) => {
        publishState({
          status: "error",
          error: normalizeError(error),
        });
        return state;
      })
      .finally(() => {
        operationPromise = null;
      });

    return operationPromise;
  }

  function publishState(patch) {
    state = {
      ...state,
      ...patch,
      currentVersion: app.getVersion(),
      channel,
      updatedAt: new Date().toISOString(),
    };

    for (const window of getWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(UPDATE_STATE_CHANNEL, state);
    }
    return state;
  }

  return {
    start,
    dispose,
    getState: () => state,
    checkForUpdates,
    downloadUpdate,
    updateNow,
    installDownloadedUpdate,
  };
}

function createInitialUpdateState({ app, channel, disabledReason }) {
  return {
    status: disabledReason ? "disabled" : "idle",
    currentVersion: app.getVersion(),
    channel,
    availableVersion: null,
    updateInfo: null,
    progress: null,
    blockers: [],
    error: null,
    reason: disabledReason,
    lastCheckedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

function shouldCheckBeforeUpdateNow(status) {
  return status === "idle"
    || status === "not-available"
    || status === "error"
    || status === "blocked";
}

function getDisabledReason(app, forceDevUpdateConfig) {
  if (!app.isPackaged && !forceDevUpdateConfig) {
    return "Auto updates are disabled in development builds.";
  }
  return null;
}

function normalizeUpdateChannel(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "beta" || normalized === "internal") return normalized;
  return "stable";
}

function normalizeUpdateFeedUrl(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  return normalized.replace(/\/+$/, "");
}

function isTruthyEnv(value) {
  return value === "1" || value === "true" || value === "yes";
}

function normalizeUpdateInfo(info) {
  if (!info || typeof info !== "object") return null;
  return {
    version: typeof info.version === "string" ? info.version : null,
    releaseName: typeof info.releaseName === "string" ? info.releaseName : null,
    releaseDate: typeof info.releaseDate === "string" ? info.releaseDate : null,
    releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : null,
  };
}

function normalizeProgress(progress) {
  if (!progress || typeof progress !== "object") return createEmptyProgress();
  return {
    percent: normalizeNumber(progress.percent),
    bytesPerSecond: normalizeNumber(progress.bytesPerSecond),
    transferred: normalizeNumber(progress.transferred),
    total: normalizeNumber(progress.total),
  };
}

function createEmptyProgress() {
  return {
    percent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0,
  };
}

function normalizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeRestartBlockers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((blocker) => ({
      id: typeof blocker?.id === "string" ? blocker.id : "unknown",
      label: typeof blocker?.label === "string" ? blocker.label : "Update is blocked",
      detail: typeof blocker?.detail === "string" ? blocker.detail : null,
    }))
    .filter((blocker) => blocker.label);
}

function normalizeError(error) {
  if (!error) return "Unknown update error.";
  if (error instanceof Error) return error.message;
  return String(error);
}
