import { useCallback, useEffect, useRef } from "react";

/**
 * Suppresses only the browser click derived from a completed pointer drag.
 * The guard expires in the next task so a missing derived click can never
 * consume a later, intentional activation.
 */
export function useWorkbenchDerivedDragClickSuppression() {
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    suppressClickRef.current = false;
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = null;
    }
  }, []);

  const suppressDerivedDragClick = useCallback(() => {
    clear();
    suppressClickRef.current = true;
    suppressClickTimerRef.current = window.setTimeout(clear, 0);
  }, [clear]);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    clear();
    return true;
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { consumeSuppressedClick, suppressDerivedDragClick } as const;
}
