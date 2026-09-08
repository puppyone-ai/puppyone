import type { ResourceDragPreview } from "./resourceDragSession";

/** Preview is never authority: each drop must independently claim its native payload. */
export function createResourceDragPreviewStore() {
  let preview: ResourceDragPreview | null = null;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (value: ResourceDragPreview | null) => {
    if (value === preview) return;
    preview = value;
    for (const listener of listeners) listener();
  };
  const start = () => {
    const bridge = window.puppyoneDesktop;
    if (!bridge?.resourceDragSessionSupported) return () => undefined;
    let generation = 0;
    let pending = false;
    let resolved = false;
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => { generation += 1; pending = false; resolved = false; set(null); };
    const unsubscribe = bridge.onResourceDragState((state) => {
      if (!state.entries && preview && preview.id !== state.id) return;
      reset();
      if (state.entries) { resolved = true; set({ id: state.id, entries: state.entries }); }
    });
    const enter = (event: DragEvent) => {
      clearTimeout(leaveTimer);
      if (resolved || pending || !event.dataTransfer?.types.includes("Files")) return;
      pending = true;
      const epoch = generation;
      void bridge.previewResourceDrag().then((state) => {
        if (epoch !== generation) return;
        resolved = true;
        set(state);
      }).catch(() => { /* Drop admission reports authorization errors. */ }).finally(() => {
        if (epoch === generation) pending = false;
      });
    };
    const over = () => clearTimeout(leaveTimer);
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) { clearTimeout(leaveTimer); leaveTimer = setTimeout(reset, 80); }
    };
    window.addEventListener("dragenter", enter, true);
    window.addEventListener("dragover", over, true);
    window.addEventListener("dragleave", leave, true);
    window.addEventListener("drop", reset, true);
    window.addEventListener("dragend", reset, true);
    return () => {
      reset();
      clearTimeout(leaveTimer);
      unsubscribe();
      window.removeEventListener("dragenter", enter, true);
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("dragleave", leave, true);
      window.removeEventListener("drop", reset, true);
      window.removeEventListener("dragend", reset, true);
    };
  };
  return {
    getSnapshot: () => preview,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) stop = start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) { stop?.(); stop = undefined; }
      };
    },
  };
}

export const resourceDragPreviewStore = createResourceDragPreviewStore();
