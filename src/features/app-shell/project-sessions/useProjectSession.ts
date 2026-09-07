import { useSyncExternalStore } from "react";
import type { ProjectSessionManager } from "./ProjectSessionManager";

export function useProjectSession(manager: ProjectSessionManager, root: string | null) {
  useSyncExternalStore(manager.store.subscribe, manager.store.getSnapshot, manager.store.getSnapshot);
  return root ? manager.getProject(root) : null;
}
