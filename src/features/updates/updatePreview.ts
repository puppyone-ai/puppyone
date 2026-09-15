import type { DesktopUpdateState } from "../../types/electron";
import { FALLBACK_UPDATE_STATE } from "./updateModel";

export const DESKTOP_UPDATE_PREVIEW_QUERY_PARAMETER = "desktop-update-preview";

type DesktopUpdatePreviewOptions = {
  isDevelopment: boolean;
  requestedStatus?: string | null;
  version?: string | null;
};

/**
 * Creates a renderer-only visual fixture for the update affordance. The
 * explicit development gate keeps preview state out of packaged behavior;
 * production update authority remains entirely in Electron main.
 */
export function createDesktopUpdatePreviewState({
  isDevelopment,
  requestedStatus,
  version,
}: DesktopUpdatePreviewOptions): DesktopUpdateState | null {
  if (!isDevelopment || requestedStatus?.trim().toLowerCase() !== "downloaded") {
    return null;
  }

  const availableVersion = version?.trim() || "0.3.0-preview.1";
  return {
    ...FALLBACK_UPDATE_STATE,
    status: "downloaded",
    currentVersion: "0.2.1-dev.preview",
    channel: "dev",
    availableVersion,
    updateInfo: {
      version: availableVersion,
      releaseName: "PuppyOne update preview",
      releaseDate: null,
      releaseNotes: null,
    },
    reason: "development-preview",
  };
}

export function readDesktopUpdatePreviewRequest({
  environmentStatus,
  locationSearch,
}: {
  environmentStatus?: string | null;
  locationSearch?: string | null;
}) {
  const environmentRequest = environmentStatus?.trim();
  if (environmentRequest) return environmentRequest;
  return new URLSearchParams(locationSearch ?? "").get(
    DESKTOP_UPDATE_PREVIEW_QUERY_PARAMETER,
  );
}
