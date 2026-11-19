export type DocumentAutoSaveScheduler = Readonly<{
  schedule: () => void;
  /** Run a pending save now, for example when the window loses focus. */
  flush: () => void;
  cancel: () => void;
  dispose: () => void;
}>;

/** Quiet period after the last edit before auto-save fires. */
export const AUTO_SAVE_IDLE_MS = 800;
/** Upper bound so continuous typing still persists periodically. */
export const AUTO_SAVE_MAX_WAIT_MS = 2000;

/**
 * Product policy: wait until typing pauses, then ask the Working Copy to save.
 * Saving on every keystroke made typing and file creation stutter. Close,
 * switch and app-quit drains flush independently, so the delay cannot drop
 * edits. The scheduler owns timing only; it cannot inspect or mutate document
 * state and therefore cannot bypass conflict semantics.
 */
export function createIdleAutoSaveScheduler(
  requestSave: () => void,
  { idleMs = AUTO_SAVE_IDLE_MS, maxWaitMs = AUTO_SAVE_MAX_WAIT_MS } = {},
): DocumentAutoSaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstScheduledAt: number | null = null;
  let disposed = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    firstScheduledAt = null;
  };

  return Object.freeze({
    schedule() {
      if (disposed) return;
      const now = Date.now();
      firstScheduledAt ??= now;
      if (timer !== null) clearTimeout(timer);
      const delay = Math.max(0, Math.min(idleMs, firstScheduledAt + maxWaitMs - now));
      timer = setTimeout(() => {
        clear();
        if (!disposed) requestSave();
      }, delay);
    },
    flush() {
      if (disposed || timer === null) return;
      clear();
      requestSave();
    },
    cancel: clear,
    dispose() {
      disposed = true;
      clear();
    },
  });
}
