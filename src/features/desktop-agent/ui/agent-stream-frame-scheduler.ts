export type AgentStreamFlushScheduler = (callback: () => void) => () => void;

const STREAM_FRAME_MS = 16;

/** Renderer adapter: align live text commits to paint without coupling the application service to DOM globals. */
export const scheduleAgentStreamFrame: AgentStreamFlushScheduler = (callback) => {
  if (
    typeof window !== "undefined"
    && typeof window.requestAnimationFrame === "function"
    && (typeof document === "undefined" || document.visibilityState !== "hidden")
  ) {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frame);
  }
  const timer = setTimeout(callback, STREAM_FRAME_MS);
  return () => clearTimeout(timer);
};

export const agentStreamFrameSchedulerLimits = Object.freeze({ frameMs: STREAM_FRAME_MS });
