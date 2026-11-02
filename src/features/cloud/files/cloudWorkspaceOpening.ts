/** Observable request stages; progress never triggers network traffic. */
export type CloudWorkspaceOpeningPhase = "checking" | "connecting" | "files";
export type CloudWorkspaceOpeningProgress = Readonly<{
  getSnapshot: () => CloudWorkspaceOpeningPhase;
  subscribe: (listener: () => void) => () => void;
}>;

/** Compute comes up first; these server phases mean the wait is now for the files. */
export function cloudWorkspaceOpeningPhase(operation?: Readonly<{ phase: string | null }>): CloudWorkspaceOpeningPhase {
  return operation?.phase === "initializing" || operation?.phase === "checking_files" ? "files" : "connecting";
}

export function createCloudWorkspaceOpeningProgress() {
  let phase: CloudWorkspaceOpeningPhase = "checking";
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => phase,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set: (next: CloudWorkspaceOpeningPhase) => {
      if (phase === next) return;
      phase = next;
      for (const listener of listeners) listener();
    },
  };
}
