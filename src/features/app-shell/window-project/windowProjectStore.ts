import type { WorkbenchWorkspace } from "@puppyone/shared-ui";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { HostFolderSelection } from "../../hosts";
import type { WorkspaceEntryIntent } from "../workspaceEntryBootstrap";

export type { HostFolderSelection };

export type ProjectTarget =
  | Readonly<{ kind: "local"; path: string }>
  | Readonly<{ kind: "cloud"; projectId: string }>
  /** A folder dropped on the Homepage: opened on the drop's own grant, not by path. */
  | Readonly<{ kind: "dropped"; folder: File }>
  /** A registered folder on another computer: identified by IDs, never by its host path. */
  | Readonly<{ kind: "host"; hostId: string; folderId: string; selection: HostFolderSelection }>;

export type ProjectOpenFailure = Readonly<{
  target: ProjectTarget;
  message: string;
  recovery: "retry" | "account" | "none";
}>;

/**
 * What this window is doing with projects. Each renderer is one window, so
 * there is one of these. Everything a surface shows about opening a project is
 * computed from here, whichever entry started it. (A project's own workbench
 * sessions are something else: see ../project-sessions.)
 *
 * What a project's arrival changes changes in one update, so no render can see
 * half of it. A Cloud project's own data stays with the Cloud; `shown` says when
 * the window is showing it.
 */
export type WindowProject = Readonly<{
  /** The folders open in this window. They stay open behind a Cloud project. */
  folders: WorkbenchWorkspace | null;
  /** Which project the window shows: its folders, a Cloud project, or another computer's folder. */
  shown: "local" | "cloud" | "host";
  /** The other computer's folder this window shows when `shown` is "host". Local folders stay open behind it. */
  host: HostFolderSelection | null;
  /** The first document of the folders just opened, still on its way to the editor. */
  entry: WorkspaceEntryIntent | null;
  /** The project this window is entering. The one it leaves stays mounted until this one arrives. */
  opening: ProjectTarget | null;
  /** Why the last open did not arrive, until the user dismisses it. */
  failure: ProjectOpenFailure | null;
}>;

export const INITIAL_WINDOW_PROJECT: WindowProject = { folders: null, shown: "local", host: null, entry: null, opening: null, failure: null };

export const windowProjectStore = createStore<WindowProject>(() => INITIAL_WINDOW_PROJECT);

export function showWindowProject(shown: Exclude<WindowProject["shown"], "host">) {
  windowProjectStore.setState({ shown, host: null });
}

/** Show another computer's folder in this window, in one update. */
export function showHostFolder(selection: HostFolderSelection) {
  windowProjectStore.setState({ shown: "host", host: selection, opening: null, failure: null });
}

/** Leave another computer's folder; the window returns to its own folders. */
export function closeHostFolder() {
  if (windowProjectStore.getState().shown === "host") windowProjectStore.setState({ shown: "local", host: null });
}

export function hostFolderTarget(selection: HostFolderSelection): ProjectTarget {
  return { kind: "host", hostId: selection.ref.deviceId, folderId: selection.ref.folderId, selection };
}

export function useWindowProject<T>(selector: (project: WindowProject) => T): T {
  return useStore(windowProjectStore, selector);
}
