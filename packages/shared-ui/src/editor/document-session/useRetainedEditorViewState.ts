import { useLayoutEffect, useState, type RefObject } from "react";
import { useDocumentModelOwner } from "./DocumentModelOwner";

/** Small format-owned position/preferences; never DOM, tasks, or document bytes. */
export function useRetainedEditorViewState<T>(role: string, initial: T) {
  const owner = useDocumentModelOwner();
  const [restored] = useState(() => owner?.readViewState<T>(role) !== undefined);
  const [state, setState] = useState<T>(() => owner?.readViewState<T>(role) ?? initial);
  useLayoutEffect(() => { owner?.writeViewState(role, state); }, [owner, role, state]);
  return [state, setState, restored] as const;
}

export function useRetainedEditorScroll(role: string, ref: RefObject<HTMLElement | null>): void {
  const owner = useDocumentModelOwner();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !owner) return;
    const saved = owner.readViewState<{ top: number; left: number }>(role);
    const capture = () => owner.writeViewState(role, { top: element.scrollTop, left: element.scrollLeft });
    // Virtualized tables establish their spacer geometry in their layout work.
    const frame = requestAnimationFrame(() => {
      if (saved) { element.scrollTop = saved.top; element.scrollLeft = saved.left; }
      element.addEventListener("scroll", capture, { passive: true });
    });
    return () => { cancelAnimationFrame(frame); capture(); element.removeEventListener("scroll", capture); };
  }, [owner, ref, role]);
}
