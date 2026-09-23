import { spawnSync } from "node:child_process";
import path from "node:path";
import updaterPackage from "electron-updater";
import log from "electron-log";
import {
  assertDesktopBuildInfo,
  toDesktopReleaseIdentity,
} from "../shared/desktop-build-identity.mjs";
import { resolveDesktopApplicationIdentity } from "../shared/desktop/application-identity.mjs";
import { createDesktopTargetFromNode } from "../shared/desktop/platform-contract.mjs";
import { evaluateDesktopUpdateCandidate } from "../shared/desktop/update-policy.mjs";

const UPDATE_STATE_CHANNEL = "updates:state";

export const BACKGROUND_UPDATE_INITIAL_DELAY_MS = 15 * 1000;
export const BACKGROUND_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const UPDATE_ACTION_STATES = new Set([
  "idle",
  "not-available",
  "available",
  "downloaded",
  "blocked",
  "error",
]);

const BACKGROUND_CHECK_STATES = new Set([
  "idle",
  "not-available",
  "error",
]);

const ACTIONABLE_UPDATE_STATES = new Set([
  "available",
  "downloading",
  "downloaded",
  "blocked",
  "installing",
]);

export function resolveDesktopUpdateConfiguration({
  buildInfo,
  environment = {},
  isPackaged,
  platform = process.platform,
  arch = process.arch,
}) {
  const identity = assertDesktopBuildInfo(buildInfo);
  // Match packaging's Application Identity; the legacy channel policy pins
  // its feed to macOS and must not override a Windows/Linux app-update.yml.
  const policy = resolveDesktopApplicationIdentity({
    releaseIdentity: toDesktopReleaseIdentity(identity),
    target: createDesktopTargetFromNode({ platform, arch }),
  });
  const developmentFeedUrl = !isPackaged && identity.channel === "dev"
    ? normalizeUpdateFeedUrl(environment.PUPPYONE_DESKTOP_DEV_UPDATE_URL)
    : null;
  const developmentOverrideEnabled = Boolean(developmentFeedUrl)
    && isTruthyEnvironmentValue(environment.PUPPYONE_DESKTOP_FORCE_DEV_UPDATE_CONFIG);

  return Object.freeze({
    channel: identity.channel,
    currentVersion: identity.version,
    updateChannel: policy.updateChannel ?? (developmentOverrideEnabled ? "dev" : null),
    feedUrl: policy.updateFeedUrl ?? (developmentOverrideEnabled ? developmentFeedUrl : null),
    allowDowngrade: false,
    allowPrerelease: identity.channel !== "stable",
    forceDevUpdateConfig: developmentOverrideEnabled,
  });
}

export function createUpdateService({
  app,
  buildInfo,
  ipcMain,
  getWindows,
  getRestartBlockers = () => [],
  confirmRestartWithBlockers = () => false,
  environment = process.env,
  platform = process.platform,
  arch = process.arch,
  autoUpdater,
  automaticallyDownloadUpdates = true,
  persistAutomaticallyDownloadUpdates = async () => {},
}) {
  const configuration = resolveDesktopUpdateConfiguration({
    buildInfo,
    environment,
    isPackaged: app.isPackaged,
    platform,
    arch,
  });
  const channel = configuration.channel;
  const currentVersion = configuration.currentVersion;
  const disabledReason = getDisabledReason(app, configuration, platform);
  const canUseUpdater = !disabledReason;
  // Reading electron-updater's getter constructs a platform updater. Disabled
  // builds must expose update status without initializing that native service.
  autoUpdater = canUseUpdater ? (autoUpdater ?? updaterPackage.autoUpdater) : null;

  let started = false;
  let disposed = false;
  let backgroundCheckTimer = null;
  let operationPromise = null;
  let latestUpdateInfo = null;
  let state = createInitialUpdateState({
    channel,
    currentVersion,
    disabledReason,
    automaticallyDownloadUpdates,
  });

  function start() {
    if (started) return;
    started = true;
    registerIpcHandlers();

    if (!canUseUpdater) {
      publishState({
        status: "disabled",
        reason: disabledReason,
      });
      return;
    }

    configureLogger();
    configureUpdater();
    registerUpdaterEvents();
    scheduleBackgroundCheck(BACKGROUND_UPDATE_INITIAL_DELAY_MS);
  }

  function dispose() {
    disposed = true;
    if (backgroundCheckTimer) clearTimeout(backgroundCheckTimer);
    backgroundCheckTimer = null;
  }

  function scheduleBackgroundCheck(delay) {
    if (disposed || !canUseUpdater || backgroundCheckTimer) return;
    backgroundCheckTimer = setTimeout(async () => {
      backgroundCheckTimer = null;
      if (BACKGROUND_CHECK_STATES.has(state.status)) await checkForUpdates();
      scheduleBackgroundCheck(BACKGROUND_UPDATE_INTERVAL_MS);
    }, delay);
    backgroundCheckTimer.unref?.();
  }

  function registerIpcHandlers() {
    ipcMain.handle("updates:get-state", () => state);
    ipcMain.handle("updates:check", () => checkForUpdates());
    ipcMain.handle("updates:download", () => downloadUpdate());
    ipcMain.handle("updates:update-now", () => updateNow());
    ipcMain.handle("updates:install", () => installDownloadedUpdate());
    ipcMain.handle("updates:set-automatically-download", (_event, request) => (
      setAutomaticallyDownloadUpdates(request?.enabled)
    ));
  }

  function configureLogger() {
    try {
      log.transports.file.level = "info";
      log.transports.console.level = environment.PUPPYONE_DESKTOP_UPDATE_LOG_CONSOLE === "1" ? "debug" : false;
      autoUpdater.logger = log;
    } catch (error) {
      console.warn("Unable to configure updater logger:", error);
    }
  }

  function configureUpdater() {
    // PuppyOne starts the download itself only after its channel and monotonic
    // version policy accepts the candidate. Enabling electron-updater's own
    // autoDownload would let the payload race ahead of that product guard.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = configuration.allowPrerelease;

    if (configuration.updateChannel) {
      autoUpdater.channel = configuration.updateChannel;
    }
    if (configuration.forceDevUpdateConfig) {
      autoUpdater.forceDevUpdateConfig = true;
    }
    if (configuration.feedUrl) {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: configuration.feedUrl,
        channel: configuration.updateChannel,
      });
    }

    // electron-updater's channel setter enables downgrades as a side effect.
    // Keep this assignment last so no configuration path can silently undo the
    // product invariant that installed versions only move forward.
    autoUpdater.allowDowngrade = configuration.allowDowngrade;
  }

  function registerUpdaterEvents() {
    autoUpdater.on("checking-for-update", () => {
      publishState({
        status: "checking",
        availableVersion: null,
        updateInfo: null,
        progress: null,
        error: null,
        blockers: [],
      });
    });

    autoUpdater.on("update-available", (info) => {
      publishAvailableCandidate(info, "available");
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
      if (state.status !== "downloading" || !hasActionableCandidate()) return;
      publishState({
        status: "downloading",
        progress: normalizeProgress(progress),
        error: null,
        blockers: [],
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      publishAvailableCandidate(info, "downloaded");
    });

    autoUpdater.on("error", (error) => {
      publishState({
        status: "error",
        availableVersion: null,
        updateInfo: null,
        error: normalizeError(error),
        progress: null,
      });
    });
  }

  async function checkForUpdates() {
    return runExclusive(async () => {
      if (!canUseUpdater) return state;
      if (state.status === "available") {
        await downloadAvailableUpdateInternal();
        return state;
      }
      if (ACTIONABLE_UPDATE_STATES.has(state.status)) return state;

      publishState({
        status: "checking",
        availableVersion: null,
        updateInfo: null,
        progress: null,
        error: null,
        blockers: [],
      });

      try {
        const result = await autoUpdater.checkForUpdates();
        reconcileCheckResult(result);
        await downloadAvailableUpdateInternal();
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
      if (state.status === "downloaded" || state.status === "blocked") return state;

      if (UPDATE_ACTION_STATES.has(state.status) && state.status !== "available") {
        await checkForUpdatesInternal();
      }

      if (state.status !== "available" || !hasActionableCandidate()) return state;

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
        return state;
      }

      if (state.status === "available") {
        await downloadUpdateInternal();
        return state;
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

  async function setAutomaticallyDownloadUpdates(enabled) {
    if (!canUseUpdater) return state;
    if (typeof enabled !== "boolean") {
      throw new TypeError("Automatic update download preference must be a boolean.");
    }
    if (state.automaticallyDownloadUpdates !== enabled) {
      await Promise.resolve(persistAutomaticallyDownloadUpdates(enabled));
      publishState({ automaticallyDownloadUpdates: enabled });
    }
    if (enabled) {
      return runExclusive(async () => {
        await downloadAvailableUpdateInternal();
        return state;
      });
    }
    return state;
  }

  async function checkForUpdatesInternal() {
    publishState({
      status: "checking",
      availableVersion: null,
      updateInfo: null,
      progress: null,
      error: null,
      blockers: [],
    });

    try {
      const result = await autoUpdater.checkForUpdates();
      reconcileCheckResult(result);
      await downloadAvailableUpdateInternal();
    } catch (error) {
      publishState({
        status: "error",
        error: normalizeError(error),
      });
    }
  }

  async function downloadUpdateInternal() {
    if (state.status !== "available" || !hasActionableCandidate()) return;
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

  async function downloadAvailableUpdateInternal() {
    if (!state.automaticallyDownloadUpdates || state.status !== "available") return;
    await downloadUpdateInternal();
  }

  async function installDownloadedUpdateInternal() {
    if (state.status !== "downloaded" && state.status !== "blocked") return;
    if (!hasActionableCandidate()) return;

    const blockers = normalizeRestartBlockers(await Promise.resolve(getRestartBlockers()));
    if (blockers.length > 0) {
      publishState({
        status: "blocked",
        blockers,
        error: null,
      });
      const confirmed = await Promise.resolve(confirmRestartWithBlockers({
        availableVersion: state.availableVersion,
        blockers,
        currentVersion,
      }));
      if (!confirmed) return;
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
    const nextState = enforceMonotonicUpdateState({
      ...state,
      ...patch,
      currentVersion,
      channel,
      updatedAt: new Date().toISOString(),
    });
    state = nextState;

    for (const window of getWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(UPDATE_STATE_CHANNEL, state);
    }
    return state;
  }

  function publishAvailableCandidate(info, status) {
    latestUpdateInfo = normalizeUpdateInfo(info);
    publishState({
      status,
      updateInfo: latestUpdateInfo,
      availableVersion: latestUpdateInfo?.version ?? null,
      progress: null,
      blockers: [],
      error: null,
    });
  }

  function reconcileCheckResult(result) {
    if (state.status !== "checking") return;
    if (result?.updateInfo) {
      publishAvailableCandidate(result.updateInfo, "available");
      return;
    }
    latestUpdateInfo = null;
    publishState({
      status: "not-available",
      updateInfo: null,
      availableVersion: null,
      progress: null,
      blockers: [],
      error: null,
      lastCheckedAt: new Date().toISOString(),
    });
  }

  function hasActionableCandidate() {
    const evaluation = evaluateDesktopUpdateCandidate({
      channel,
      currentVersion,
      candidateVersion: state.availableVersion,
    });
    if (evaluation.allowed) return true;
    publishRejectedCandidate(evaluation);
    return false;
  }

  function publishRejectedCandidate(evaluation) {
    latestUpdateInfo = null;
    const invalid = evaluation.relation === "invalid" || !evaluation.channelCompatible;
    const detail = invalid
      ? "The update feed returned an invalid or cross-channel version."
      : null;
    log.warn(
      `[desktop-updater] Rejected ${String(state.availableVersion)} for ${currentVersion} `
      + `on ${channel}: ${evaluation.relation}${evaluation.channelCompatible ? "" : ", wrong channel"}.`,
    );
    publishState({
      status: invalid ? "error" : "not-available",
      availableVersion: null,
      updateInfo: null,
      progress: null,
      blockers: [],
      error: detail,
      lastCheckedAt: new Date().toISOString(),
    });
  }

  function enforceMonotonicUpdateState(nextState) {
    if (!ACTIONABLE_UPDATE_STATES.has(nextState.status)) return nextState;
    const evaluation = evaluateDesktopUpdateCandidate({
      channel,
      currentVersion,
      candidateVersion: nextState.availableVersion,
    });
    if (evaluation.allowed) return nextState;

    latestUpdateInfo = null;
    const invalid = evaluation.relation === "invalid" || !evaluation.channelCompatible;
    log.warn(
      `[desktop-updater] Suppressed unsafe ${nextState.status} state for `
      + `${String(nextState.availableVersion)} from ${currentVersion} on ${channel}.`,
    );
    return {
      ...nextState,
      status: invalid ? "error" : "not-available",
      availableVersion: null,
      updateInfo: null,
      progress: null,
      blockers: [],
      error: invalid ? "The update feed returned an invalid or cross-channel version." : null,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  return {
    start,
    dispose,
    getState: () => state,
    checkForUpdates,
    downloadUpdate,
    updateNow,
    installDownloadedUpdate,
    setAutomaticallyDownloadUpdates,
  };
}

function createInitialUpdateState({
  channel,
  currentVersion,
  disabledReason,
  automaticallyDownloadUpdates,
}) {
  return {
    status: disabledReason ? "disabled" : "idle",
    currentVersion,
    channel,
    availableVersion: null,
    updateInfo: null,
    progress: null,
    blockers: [],
    error: null,
    reason: disabledReason,
    lastCheckedAt: null,
    updatedAt: new Date().toISOString(),
    automaticallyDownloadUpdates: automaticallyDownloadUpdates !== false,
  };
}

function shouldCheckBeforeUpdateNow(status) {
  return status === "idle"
    || status === "not-available"
    || status === "error";
}

function getDisabledReason(app, configuration, platform) {
  if (configuration.channel === "dev" && !configuration.forceDevUpdateConfig) {
    return "Auto updates are disabled for Development builds.";
  }
  if (!app.isPackaged && !configuration.forceDevUpdateConfig) {
    return "Auto updates are disabled outside a packaged release build.";
  }
  if (platform === "darwin" && !configuration.forceDevUpdateConfig) {
    const signatureStatus = getMacCodeSignatureStatus(app);
    if (!signatureStatus.canAutoUpdate) return signatureStatus.reason;
  }
  return null;
}

function getMacCodeSignatureStatus(app) {
  const appPath = getMacAppBundlePath(app);
  const result = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], {
    encoding: "utf8",
    timeout: 3000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.error) {
    return {
      canAutoUpdate: false,
      reason: `Auto updates are disabled because the macOS code signature could not be inspected: ${result.error.message}`,
    };
  }

  if (result.status !== 0) {
    return {
      canAutoUpdate: false,
      reason: "Auto updates are disabled because this macOS build is not code signed.",
    };
  }

  if (/Signature=adhoc/im.test(output)) {
    return {
      canAutoUpdate: false,
      reason: "Auto updates are disabled because this macOS build is ad-hoc signed.",
    };
  }

  const authorities = Array.from(output.matchAll(/^Authority=(.+)$/gim), (match) => match[1]?.trim() ?? "");
  const hasReleaseAuthority = authorities.some((authority) => (
    /^Developer ID Application:/i.test(authority)
      || /^Apple Distribution:/i.test(authority)
      || /^3rd Party Mac Developer Application:/i.test(authority)
  ));

  if (hasReleaseAuthority) {
    return {
      canAutoUpdate: true,
      reason: null,
    };
  }

  return {
    canAutoUpdate: false,
    reason: "Auto updates are disabled because this macOS build is not signed with a release certificate.",
  };
}

function getMacAppBundlePath(app) {
  const executablePath = app.getPath("exe");
  const appBundlePath = path.dirname(path.dirname(path.dirname(executablePath)));
  return appBundlePath.toLowerCase().endsWith(".app") ? appBundlePath : executablePath;
}

function normalizeUpdateFeedUrl(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  return normalized.replace(/\/+$/, "");
}

function isTruthyEnvironmentValue(value) {
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
