import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { CloudWorkspaceFiles } from "./cloudWorkspaceFiles";
import type { CloudWorkspaceSession } from "./cloudWorkspaceSession";

/** Workspace-relative paths that changed, or null when the scope is unknown. */
export type CloudWorkspaceChange = readonly string[] | null;

/**
 * Subscribes to the workbench's file events through Main. Each event first
 * drops the caches it names, then tells the workbench which paths changed.
 */
export function watchCloudWorkspace({ workspace, files, session, projectId, apiBaseUrl, assertCurrent }: {
  workspace: CloudWorkspaceSession;
  files: CloudWorkspaceFiles;
  session: DesktopCloudSession;
  projectId: string;
  apiBaseUrl: string;
  assertCurrent: () => void;
}, onChange: (paths: CloudWorkspaceChange) => void, onError: (error: Error) => void) {
  const bridge = window.puppyoneDesktop;
  let stopped = false;
  const id = crypto.randomUUID();
  let off: (() => void) | undefined;
  let release: (() => void) | undefined;
  const failed = (error: unknown) => {
    release?.(); release = undefined;
    if (!stopped) onError(error instanceof Error ? error : new Error(String(error)));
  };
  void workspace.ensure().then(async row => {
    if (stopped) return;
    if (!bridge?.watchCloudWorkspace || !bridge.onCloudWorkspaceEvent) throw new Error("Cloud file notifications are unavailable. Restart the desktop app.");
    off = bridge.onCloudWorkspaceEvent(event => {
      if (stopped || event.id !== id) return;
      try {
        assertCurrent();
        if (event.type === "change" && event.generation === row.generation) {
          const paths = event.paths?.length ? event.paths : null;
          if (paths) files.invalidatePaths(paths); else files.invalidate();
          onChange(paths);
        } else if (event.type === "reconnecting") files.invalidate();
        else if (event.type === "unavailable") failed(new Error(event.message || "Cloud workspace connection interrupted. Retry to reconnect."));
      } catch (error) { failed(error); }
    });
    release = files.retain();
    await bridge.watchCloudWorkspace({ id, apiBaseUrl, projectId, generation: row.generation,
      expectedSession: { userId: session.user_id, generation: session.session_generation } });
    if (stopped) await bridge.stopCloudWorkspaceWatch({ id });
  }).catch(failed);
  return () => {
    stopped = true;
    release?.(); release = undefined;
    off?.();
    void bridge?.stopCloudWorkspaceWatch?.({ id }).catch(() => {});
  };
}
