"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * An iframe load event means navigation completed, not that Chromium painted
 * the child document. Visible-first Viewers wait two compositor frames before
 * releasing the shared document transition.
 */
export function useVisibleFrameReadiness(frameKey: string | null) {
  const [readyFrameKey, setReadyFrameKey] = useState<string | null>(null);
  const frameRef = useRef<number | null>(null);

  const cancelScheduledFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  useEffect(() => cancelScheduledFrame, [cancelScheduledFrame, frameKey]);

  const onFrameLoad = useCallback(() => {
    if (!frameKey) return;
    cancelScheduledFrame();
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        setReadyFrameKey(frameKey);
      });
    });
  }, [cancelScheduledFrame, frameKey]);

  return {
    ready: Boolean(frameKey && readyFrameKey === frameKey),
    onFrameLoad,
  };
}
