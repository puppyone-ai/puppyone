import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
type ActivateOptions = {
  focus?: boolean;
};

type UseWorkbenchSessionHeaderControllerOptions = {
  onActivate: (sessionId: string) => void;
  sessionIds: readonly string[];
  tabId: (sessionId: string) => string;
};

/** Owns roving-tab focus; layout motion belongs to the measured Header. */
export function useWorkbenchSessionHeaderController({
  onActivate,
  sessionIds,
  tabId,
}: UseWorkbenchSessionHeaderControllerOptions) {
  const focusFrameRef = useRef<number | null>(null);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  const activate = useCallback((sessionId: string, options: ActivateOptions = {}) => {
    onActivateRef.current(sessionId);
    if (!options.focus) return;
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      document.getElementById(tabId(sessionId))?.focus({ preventScroll: true });
    });
  }, [tabId]);

  const handleKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (sessionIds.length < 2) return;
    const isRtl = document.documentElement.dir === "rtl";
    let nextIndex: number | null = null;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = sessionIds.length - 1;
    if (event.key === "ArrowRight") {
      nextIndex = (index + (isRtl ? -1 : 1) + sessionIds.length) % sessionIds.length;
    }
    if (event.key === "ArrowLeft") {
      nextIndex = (index + (isRtl ? 1 : -1) + sessionIds.length) % sessionIds.length;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const sessionId = sessionIds[nextIndex];
    if (sessionId) activate(sessionId, { focus: true });
  }, [activate, sessionIds]);

  useEffect(() => () => {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
  }, []);

  return { activate, handleKeyDown };
}
