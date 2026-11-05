import path from "node:path";

/** The argument that starts this program as the host service instead of the App. */
export const HOST_SERVICE_ARGUMENT = "--puppyone-host";

/**
 * The host service keeps its own state (device key, registry, control socket)
 * beside the App's, never inside it: the two processes do not share Chromium
 * profile files or the single-instance lock.
 */
export function hostServiceStateDir(appUserData) {
  return path.join(appUserData, "host-service");
}
