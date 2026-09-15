import { evaluateDesktopUpdateCandidate } from "../../shared/desktop/update-policy.mjs";

export function createNativeUpdateMenuAction({
  appName,
  dialog,
  getOwnerWindow,
  getUpdateService,
  t,
}) {
  if (typeof appName !== "string" || !appName.trim()) {
    throw new TypeError("A non-empty application name is required.");
  }
  if (!dialog || typeof dialog.showMessageBox !== "function") {
    throw new TypeError("The Electron dialog authority is required.");
  }
  if (typeof getOwnerWindow !== "function") throw new TypeError("getOwnerWindow must be a function.");
  if (typeof getUpdateService !== "function") throw new TypeError("getUpdateService must be a function.");
  if (typeof t !== "function") throw new TypeError("A native menu translator is required.");

  const showMessageBox = async (options) => {
    const owner = getOwnerWindow();
    return owner
      ? dialog.showMessageBox(owner, options)
      : dialog.showMessageBox(options);
  };

  return async function checkForUpdatesFromNativeMenu() {
    const updateService = getUpdateService();
    if (!updateService || typeof updateService.checkForUpdates !== "function") {
      await showMessageBox(createUnavailableDialog({ appName, t }));
      return null;
    }

    const state = await updateService.checkForUpdates();
    if (isPassiveUpdateState(state?.status)) return state;

    const presentation = createUpdateCheckPresentation({ appName, state, t });
    const result = await showMessageBox(presentation.options);

    if (presentation.updateAction && result.response === presentation.updateAction.response) {
      await updateService.updateNow();
    }
    return state;
  };
}

function isPassiveUpdateState(status) {
  return status === "available"
    || status === "downloading"
    || status === "downloaded"
    || status === "blocked"
    || status === "installing";
}

export function createUpdateCheckPresentation({ appName, state, t }) {
  const normalizedState = enforceMonotonicPresentationState(
    state && typeof state === "object" ? state : {},
  );
  const currentVersion = normalizeVersion(normalizedState.currentVersion, t("native.update.manual.unknownVersion"));
  const availableVersion = normalizeVersion(
    normalizedState.availableVersion ?? normalizedState.updateInfo?.version,
    t("native.update.manual.unknownVersion"),
  );

  if (normalizedState.status === "available") {
    return createActionablePresentation({
      options: {
        type: "info",
        title: t("native.update.manual.available.title"),
        message: t("native.update.manual.available.message", { appName, version: availableVersion }),
        detail: t("native.update.manual.available.detail", { currentVersion }),
      },
      actionLabel: t("native.update.manual.updateNow"),
      cancelLabel: t("native.update.manual.notNow"),
    });
  }

  if (normalizedState.status === "downloaded" || normalizedState.status === "blocked") {
    return createActionablePresentation({
      options: {
        type: "info",
        title: t("native.update.manual.ready.title"),
        message: t("native.update.manual.ready.message", { appName, version: availableVersion }),
        detail: t("native.update.manual.ready.detail"),
      },
      actionLabel: t("native.update.manual.restart"),
      cancelLabel: t("native.update.manual.notNow"),
    });
  }

  if (normalizedState.status === "not-available") {
    return {
      options: {
        type: "info",
        buttons: [t("native.update.manual.ok")],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: t("native.update.manual.current.title"),
        message: t("native.update.manual.current.message", { appName }),
        detail: t("native.update.manual.current.detail", { version: currentVersion }),
      },
      updateAction: null,
    };
  }

  if (normalizedState.status === "error") {
    return {
      options: {
        type: "error",
        buttons: [t("native.update.manual.ok")],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: t("native.update.manual.failed.title"),
        message: t("native.update.manual.failed.message", { appName }),
        detail: normalizeDetail(normalizedState.error, t("native.update.manual.failed.detail")),
      },
      updateAction: null,
    };
  }

  return {
    options: createUnavailableDialog({ appName, t }),
    updateAction: null,
  };
}

function enforceMonotonicPresentationState(state) {
  if (![
    "available",
    "downloading",
    "downloaded",
    "blocked",
    "installing",
  ].includes(state.status)) return state;

  const candidateVersion = state.availableVersion ?? state.updateInfo?.version;
  const evaluation = evaluateDesktopUpdateCandidate({
    channel: state.channel,
    currentVersion: state.currentVersion,
    candidateVersion,
  });
  if (evaluation.allowed) return state;
  const invalid = evaluation.relation === "invalid" || !evaluation.channelCompatible;
  return {
    ...state,
    status: invalid ? "error" : "not-available",
    availableVersion: null,
    updateInfo: null,
    error: invalid ? "The update feed returned an invalid or cross-channel version." : null,
  };
}

function createActionablePresentation({ actionLabel, cancelLabel, options }) {
  return {
    options: {
      ...options,
      buttons: [cancelLabel, actionLabel],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    },
    updateAction: { response: 1 },
  };
}

function createUnavailableDialog({ appName, t }) {
  return {
    type: "info",
    buttons: [t("native.update.manual.ok")],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: t("native.update.manual.unavailable.title"),
    message: t("native.update.manual.unavailable.message", { appName }),
    detail: t("native.update.manual.unavailable.detail"),
  };
}

function normalizeVersion(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeDetail(value, fallback) {
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
