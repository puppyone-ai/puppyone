export type DocumentAutoSaveScheduler = Readonly<{
  schedule: () => void;
  cancel: () => void;
  dispose: () => void;
}>;

/**
 * Product policy: coalesce edits produced in one JavaScript turn, then ask the
 * Working Copy to save. The scheduler owns timing only; it cannot inspect or
 * mutate document state and therefore cannot bypass conflict semantics.
 */
export function createImmediateAutoSaveScheduler(
  requestSave: () => void,
): DocumentAutoSaveScheduler {
  let scheduled = false;
  let generation = 0;
  let disposed = false;

  return Object.freeze({
    schedule() {
      if (disposed || scheduled) return;
      scheduled = true;
      const scheduledGeneration = ++generation;
      queueMicrotask(() => {
        if (disposed || !scheduled || scheduledGeneration !== generation) return;
        scheduled = false;
        requestSave();
      });
    },
    cancel() {
      scheduled = false;
      generation += 1;
    },
    dispose() {
      disposed = true;
      scheduled = false;
      generation += 1;
    },
  });
}
