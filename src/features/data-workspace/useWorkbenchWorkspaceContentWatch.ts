import { useEffect, useRef } from "react";
import { createWorkspaceContentChange, invalidateDocumentInputs, subscribeDocumentRetirements, type WorkspaceFolder } from "@puppyone/shared-ui";

export type WorkbenchWorkspaceContentChanged = (
  paths: readonly string[] | string | null,
  workspaceFolderId: string,
) => void;

type UseWorkbenchWorkspaceContentWatchOptions = Readonly<{
  folders: readonly WorkspaceFolder[];
  /** Stable composition identity; omitted by legacy presentation-only hosts. */
  storageIdentity?: string | null;
  onWorkspaceContentChanged: WorkbenchWorkspaceContentChanged;
  onWorkspaceActivity?: (folder: WorkspaceFolder) => void;
}>;

type Registration = {
  owners: Map<string, WorkspaceFolder>;
  stop: () => void;
};

/** Window-owned watches survive presentation changes, including the homepage. */
export function useWorkbenchWorkspaceContentWatch(options: UseWorkbenchWorkspaceContentWatchOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const registrations = useRef(new Map<string, Registration>());
  const sequence = useRef(0);

  useEffect(() => {
    const bridge = window.puppyoneDesktop;
    if (typeof bridge?.watchWorkspace !== "function") return;
    const owner = options.storageIdentity ?? "presentation";
    const desired = new Set(options.folders.filter((folder) => folder.capabilities.watch).map((folder) => folder.workspace.path));
    // Changes to one composition can detach its roots; navigating to another
    // composition does not retire the first composition's subscriptions.
    for (const [path, registration] of registrations.current) {
      if (!desired.has(path)) registration.owners.delete(owner);
      if (registration.owners.size === 0) { registration.stop(); registrations.current.delete(path); }
    }
    for (const folder of options.folders) {
      if (!folder.capabilities.watch) continue;
      const path = folder.workspace.path;
      let registration = registrations.current.get(path);
      if (!registration) {
        const entry: Registration = { owners: new Map(), stop: () => undefined };
        registrations.current.set(path, entry);
        const watch = bridge.watchWorkspace(path, (event) => {
          if (registrations.current.get(path) !== entry) return;
          if (event.error && !("recovered" in event && event.recovered)) return;
          const paths = event.paths ?? event.path ?? null;
          const eventSequence = ++sequence.current;
          for (const [identity, registeredFolder] of entry.owners) {
            if (identity === "presentation") continue;
            invalidateDocumentInputs(identity, createWorkspaceContentChange({
              sequence: eventSequence, rootUri: registeredFolder.uri, paths,
            }), "watch");
          }
          const visibleFolder = latest.current.folders.find((candidate) => candidate.workspace.path === path);
          if (visibleFolder) {
            latest.current.onWorkspaceContentChanged(paths, visibleFolder.id);
            latest.current.onWorkspaceActivity?.(visibleFolder);
          }
        });
        entry.stop = watch.stop;
        void watch.ready.catch((error) => {
          if (registrations.current.get(path) === entry) console.warn("Unable to watch Workspace Folder:", error);
        });
        registration = entry;
      }
      registration.owners.set(owner, folder);
    }
  }, [options.folders, options.storageIdentity]);

  useEffect(() => subscribeDocumentRetirements(({ storageIdentity, resource }) => {
    for (const [path, registration] of registrations.current) {
      if (registration.owners.get(storageIdentity)?.uri !== resource) continue;
      registration.owners.delete(storageIdentity);
      if (registration.owners.size === 0) { registration.stop(); registrations.current.delete(path); }
    }
  }), []);

  useEffect(() => () => {
    for (const registration of registrations.current.values()) registration.stop();
    registrations.current.clear();
  }, []);
}
