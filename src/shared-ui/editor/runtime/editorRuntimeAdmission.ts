let holds = 0;
let generation = 0;
const listeners = new Set<() => void>();
export const getEditorRuntimeGeneration = () => generation;
export const subscribeEditorRuntimeGeneration = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Window retirement blocks asynchronous allocations, including tasks whose
 * fetch completed after the close barrier took its task snapshot. */
export function holdEditorRuntimeAdmission(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true; holds--;
    if (!holds) { generation++; listeners.forEach((listener) => listener()); }
  };
}

export function assertEditorRuntimeAdmission(): void {
  if (holds) throw new DOMException("The editor window is closing.", "AbortError");
}
