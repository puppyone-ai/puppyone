import type { DesktopUpdateState } from "../../types/electron";
import { evaluateDesktopUpdateCandidate } from "../../../shared/desktop/update-policy.mjs";

export const FALLBACK_UPDATE_STATE: DesktopUpdateState = {
  status: "disabled",
  currentVersion: "0.0.0-dev.local",
  channel: "dev",
  automaticallyDownloadUpdates: true,
  availableVersion: null,
  updateInfo: null,
  progress: null,
  blockers: [],
  error: null,
  reason: null,
  lastCheckedAt: null,
  updatedAt: new Date(0).toISOString(),
};

export type DesktopUpdateTitlebarState = {
  kind: "available" | "ready" | "installing";
  interactive: boolean;
  version: string | null;
};

export function normalizeDesktopUpdateState(
  value: DesktopUpdateState | null | undefined,
): DesktopUpdateState {
  if (!value || typeof value !== "object") return FALLBACK_UPDATE_STATE;
  const normalized = {
    ...FALLBACK_UPDATE_STATE,
    ...value,
    blockers: Array.isArray(value.blockers) ? value.blockers : [],
  };
  if (!isActionableStatus(normalized.status)) return normalized;

  const evaluation = evaluateDesktopUpdateCandidate({
    channel: normalized.channel,
    currentVersion: normalized.currentVersion,
    candidateVersion: normalized.availableVersion,
  });
  if (evaluation.allowed) return normalized;

  const invalid = evaluation.relation === "invalid" || !evaluation.channelCompatible;
  return {
    ...normalized,
    status: invalid ? "error" : "not-available",
    availableVersion: null,
    updateInfo: null,
    progress: null,
    blockers: [],
    error: invalid ? "The update feed returned an invalid or cross-channel version." : null,
  };
}

/**
 * The titlebar is intentionally quieter than Settings. It becomes visible
 * only after the updater has downloaded a newer version. Availability stays
 * quiet while automatic downloads are enabled, but becomes a manual download
 * action after the user opts out. Download progress remains in Settings.
 */
export function getDesktopUpdateTitlebarState(
  value: DesktopUpdateState | null | undefined,
): DesktopUpdateTitlebarState | null {
  const state = normalizeDesktopUpdateState(value);
  if (state.status === "available" && !state.automaticallyDownloadUpdates) {
    return {
      kind: "available",
      interactive: true,
      version: state.availableVersion,
    };
  }
  if (state.status === "downloaded" || state.status === "blocked") {
    return {
      kind: "ready",
      interactive: true,
      version: state.availableVersion,
    };
  }
  if (state.status === "installing") {
    return {
      kind: "installing",
      interactive: false,
      version: state.availableVersion,
    };
  }
  return null;
}

function isActionableStatus(status: DesktopUpdateState["status"]) {
  return status === "available"
    || status === "downloading"
    || status === "downloaded"
    || status === "blocked"
    || status === "installing";
}
