import { useEffect, useRef, useState } from "react";
import type { AgentStreamFlushScheduler } from "./agent-stream-frame-scheduler";
import { nextAgentStreamText } from "../domain/agent-stream-presentation";
import { scheduleAgentStreamFrame } from "./agent-stream-frame-scheduler";

/** Renderer-only smoothing. Provider text remains authoritative and terminal updates flush immediately. */
export function useAgentStreamPresentation(
  authoritativeText: string,
  streaming: boolean,
  scheduleFrame: AgentStreamFlushScheduler = scheduleAgentStreamFrame,
) {
  const [displayedText, setDisplayedText] = useState(authoritativeText);
  const latestRef = useRef(authoritativeText);
  const cancelFrameRef = useRef<(() => void) | null>(null);
  latestRef.current = authoritativeText;

  const compatible = authoritativeText.startsWith(displayedText);
  const visibleText = !streaming || !compatible ? authoritativeText : displayedText;

  useEffect(() => {
    if (!streaming || !authoritativeText.startsWith(displayedText)) {
      cancelFrameRef.current?.();
      cancelFrameRef.current = null;
      setDisplayedText(authoritativeText);
      return;
    }
    if (displayedText === authoritativeText || cancelFrameRef.current) return;
    cancelFrameRef.current = scheduleFrame(() => {
      cancelFrameRef.current = null;
      setDisplayedText((current) => nextAgentStreamText(current, latestRef.current));
    });
  }, [authoritativeText, displayedText, scheduleFrame, streaming]);

  useEffect(() => () => {
    cancelFrameRef.current?.();
    cancelFrameRef.current = null;
  }, []);

  return visibleText;
}
