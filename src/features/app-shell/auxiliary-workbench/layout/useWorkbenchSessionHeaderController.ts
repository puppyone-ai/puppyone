import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { WORKBENCH_SESSION_HEADER_METRICS } from "./workbenchSessionHeaderLayout";

export const WORKBENCH_SESSION_ACTIVATION_MOTION_MS =
  WORKBENCH_SESSION_HEADER_METRICS.activationMotionMs;

type ActivateOptions = {
  focus?: boolean;
};

type UseWorkbenchSessionHeaderControllerOptions = {
  activeSessionId: string | null;
  motionEligibleSessionIds: readonly string[];
  onActivate: (sessionId: string) => void;
  sessionIds: readonly string[];
  tabId: (sessionId: string) => string;
};

/** Owns roving-tab focus and short-lived, activation-only geometry motion. */
export function useWorkbenchSessionHeaderController({
  activeSessionId,
  motionEligibleSessionIds,
  onActivate,
  sessionIds,
  tabId,
}: UseWorkbenchSessionHeaderControllerOptions) {
  const [activationMotionActive, setActivationMotionActive] = useState(false);
  const motionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  const motionEligibleSessionIdsRef = useRef(new Set(motionEligibleSessionIds));
  const onActivateRef = useRef(onActivate);
  activeSessionIdRef.current = activeSessionId;
  motionEligibleSessionIdsRef.current = new Set(motionEligibleSessionIds);
  onActivateRef.current = onActivate;

  const activate = useCallback((sessionId: string, options: ActivateOptions = {}) => {
    if (
      sessionId !== activeSessionIdRef.current
      && motionEligibleSessionIdsRef.current.has(sessionId)
    ) {
      setActivationMotionActive(true);
      if (motionTimerRef.current !== null) clearTimeout(motionTimerRef.current);
      motionTimerRef.current = setTimeout(() => {
        motionTimerRef.current = null;
        setActivationMotionActive(false);
      }, WORKBENCH_SESSION_ACTIVATION_MOTION_MS);
    }

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
    if (motionTimerRef.current !== null) clearTimeout(motionTimerRef.current);
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
  }, []);

  return { activate, activationMotionActive, handleKeyDown };
}
