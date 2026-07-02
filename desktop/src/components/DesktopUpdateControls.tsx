import { AlertTriangle, CheckCircle2, Download, RefreshCw, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DesktopUpdateState, DesktopUpdateStatus } from "../types/electron";

const FALLBACK_UPDATE_STATE: DesktopUpdateState = {
  status: "disabled",
  currentVersion: "0.0.0",
  channel: "stable",
  availableVersion: null,
  updateInfo: null,
  progress: null,
  blockers: [],
  error: null,
  reason: "Desktop update bridge is unavailable.",
  lastCheckedAt: null,
  updatedAt: new Date(0).toISOString(),
};

type DesktopUpdatesController = {
  state: DesktopUpdateState;
  checkForUpdates: () => Promise<void>;
  updateNow: () => Promise<void>;
};

export function useDesktopUpdates(): DesktopUpdatesController {
  const [state, setState] = useState<DesktopUpdateState>(FALLBACK_UPDATE_STATE);

  useEffect(() => {
    const bridge = window.puppyoneDesktop;
    if (!bridge?.getUpdateState) return undefined;

    let cancelled = false;
    bridge.getUpdateState()
      .then((nextState) => {
        if (!cancelled) setState(normalizeUpdateState(nextState));
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            ...FALLBACK_UPDATE_STATE,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    const unsubscribe = bridge.onUpdateStateChanged?.((nextState) => {
      setState(normalizeUpdateState(nextState));
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    const bridge = window.puppyoneDesktop;
    if (!bridge?.checkForUpdates) return;
    setState(normalizeUpdateState(await bridge.checkForUpdates()));
  }, []);

  const updateNow = useCallback(async () => {
    const bridge = window.puppyoneDesktop;
    if (!bridge?.updateNow) return;
    setState(normalizeUpdateState(await bridge.updateNow()));
  }, []);

  return { state, checkForUpdates, updateNow };
}

export function DesktopUpdateTitlebarButton({
  state,
  onUpdateNow,
}: {
  state: DesktopUpdateState;
  onUpdateNow: () => void;
}) {
  const visible = state.status === "available"
    || state.status === "downloading"
    || state.status === "downloaded"
    || state.status === "blocked"
    || state.status === "error";

  if (!visible) return null;

  const Icon = getUpdateIcon(state.status);
  const busy = state.status === "checking" || state.status === "downloading" || state.status === "installing";

  return (
    <button
      className={`desktop-titlebar-action desktop-update-titlebar-action ${state.status}`}
      type="button"
      title={getUpdateTitle(state)}
      aria-label={getUpdateTitle(state)}
      disabled={busy}
      onClick={onUpdateNow}
    >
      <Icon size={15} className={busy ? "spin" : undefined} />
      {state.status === "available" && <span className="desktop-update-dot" aria-hidden />}
    </button>
  );
}

export function DesktopUpdateSettingsRow({
  state,
  onCheckForUpdates,
  onUpdateNow,
}: {
  state: DesktopUpdateState;
  onCheckForUpdates: () => void;
  onUpdateNow: () => void;
}) {
  const action = getSettingsAction(state);
  const Icon = getUpdateIcon(state.status);
  const detail = getUpdateDetail(state);

  return (
    <div className="desktop-settings-row desktop-settings-row-control desktop-update-settings-row">
      <span className="desktop-settings-label-stack">
        <strong>App updates</strong>
        <small>{detail}</small>
        {state.blockers.length > 0 && (
          <small className="desktop-update-blocker">{state.blockers[0]?.detail ?? state.blockers[0]?.label}</small>
        )}
        {state.error && (
          <small className="desktop-update-blocker">{state.error}</small>
        )}
      </span>
      <button
        className={`desktop-settings-action ${action.primary ? "primary" : ""}`}
        type="button"
        disabled={action.disabled}
        onClick={action.kind === "check" ? onCheckForUpdates : onUpdateNow}
      >
        <Icon size={14} className={action.spinning ? "spin" : undefined} />
        <span>{action.label}</span>
      </button>
    </div>
  );
}

function normalizeUpdateState(value: DesktopUpdateState | null | undefined): DesktopUpdateState {
  if (!value || typeof value !== "object") return FALLBACK_UPDATE_STATE;
  return {
    ...FALLBACK_UPDATE_STATE,
    ...value,
    blockers: Array.isArray(value.blockers) ? value.blockers : [],
  };
}

function getUpdateIcon(status: DesktopUpdateStatus) {
  if (status === "downloaded" || status === "installing") return RotateCw;
  if (status === "checking" || status === "downloading") return RefreshCw;
  if (status === "error" || status === "blocked") return AlertTriangle;
  if (status === "not-available") return CheckCircle2;
  return Download;
}

function getSettingsAction(state: DesktopUpdateState): {
  kind: "check" | "update";
  label: string;
  disabled: boolean;
  spinning: boolean;
  primary: boolean;
} {
  if (state.status === "disabled") {
    return { kind: "check", label: "Unavailable", disabled: true, spinning: false, primary: false };
  }
  if (state.status === "checking") {
    return { kind: "check", label: "Checking", disabled: true, spinning: true, primary: false };
  }
  if (state.status === "downloading") {
    return {
      kind: "update",
      label: formatDownloadProgress(state),
      disabled: true,
      spinning: true,
      primary: true,
    };
  }
  if (state.status === "installing") {
    return { kind: "update", label: "Restarting", disabled: true, spinning: true, primary: true };
  }
  if (state.status === "downloaded") {
    return { kind: "update", label: "Restart to update", disabled: false, spinning: false, primary: true };
  }
  if (state.status === "available" || state.status === "blocked") {
    return { kind: "update", label: "Update now", disabled: false, spinning: false, primary: true };
  }
  if (state.status === "error") {
    return { kind: "update", label: "Try again", disabled: false, spinning: false, primary: false };
  }
  return { kind: "check", label: "Check for updates", disabled: false, spinning: false, primary: false };
}

function getUpdateTitle(state: DesktopUpdateState): string {
  if (state.status === "available") return `Update ${state.availableVersion ?? ""} available`.trim();
  if (state.status === "downloaded") return "Restart to update";
  if (state.status === "downloading") return `Downloading update ${formatDownloadProgress(state)}`;
  if (state.status === "blocked") return state.blockers[0]?.label ?? "Update blocked";
  if (state.status === "error") return state.error ?? "Update failed";
  return "App update";
}

function getUpdateDetail(state: DesktopUpdateState): string {
  if (state.status === "disabled") return state.reason ?? "Auto updates are unavailable in this build.";
  if (state.status === "idle") return `Version ${state.currentVersion} on ${state.channel}.`;
  if (state.status === "checking") return "Checking the update feed.";
  if (state.status === "not-available") return `Version ${state.currentVersion} is up to date.`;
  if (state.status === "available") return `Version ${state.availableVersion ?? "new"} is ready to download.`;
  if (state.status === "downloading") return `Downloading ${formatDownloadProgress(state)}.`;
  if (state.status === "downloaded") return `Version ${state.availableVersion ?? "new"} is ready to install.`;
  if (state.status === "installing") return "Restarting to install the update.";
  if (state.status === "blocked") return "Update downloaded. Restart is waiting on active work.";
  if (state.status === "error") return "The last update operation failed.";
  return "App update status is unknown.";
}

function formatDownloadProgress(state: DesktopUpdateState): string {
  const percent = Math.max(0, Math.min(100, Math.round(state.progress?.percent ?? 0)));
  return `${percent}%`;
}
