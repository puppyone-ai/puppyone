import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type ProjectTarget =
  | Readonly<{ kind: "local"; path: string }>
  | Readonly<{ kind: "cloud"; projectId: string }>
  /** A folder dropped on the Homepage: opened on the drop's own grant, not by path. */
  | Readonly<{ kind: "dropped"; folder: File }>;

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
 */
export type WindowProject = Readonly<{
  /** The project this window is entering. The one it leaves stays mounted until this one arrives. */
  opening: ProjectTarget | null;
  /** Why the last open did not arrive, until the user dismisses it. */
  failure: ProjectOpenFailure | null;
}>;

export const INITIAL_WINDOW_PROJECT: WindowProject = { opening: null, failure: null };

export const windowProjectStore = createStore<WindowProject>(() => INITIAL_WINDOW_PROJECT);

export function useWindowProject<T>(selector: (project: WindowProject) => T): T {
  return useStore(windowProjectStore, selector);
}
