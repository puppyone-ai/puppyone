import { useEffect, useState } from "react";
import type { AgentTurn } from "../domain/agent-projection-types";

const MAX_VISIBLE_RUN_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
export const AGENT_RUN_ELAPSED_LABEL_THRESHOLD_MS = 5_000;

/**
 * Derives active Agent work time from event timestamps. The interval that
 * invalidates the view is never the clock authority, so background throttling
 * and a remount cannot make the displayed duration drift.
 */
export function agentRunActiveElapsedMs(turn: AgentTurn | null, nowMs: number) {
  if (!turn || turn.status !== "running" || turn.startedAtMs === null) return null;
  const wallDurationMs = Math.max(0, nowMs - turn.startedAtMs);
  const settledUserWaitMs = Math.max(0, turn.userWaitDurationMs ?? 0);
  const openUserWaitMs = turn.userWaitStartedAtMs == null
    ? 0
    : Math.max(0, nowMs - turn.userWaitStartedAtMs);
  return Math.min(
    MAX_VISIBLE_RUN_DURATION_MS,
    Math.max(0, wallDurationMs - settledUserWaitMs - openUserWaitMs),
  );
}

export function useAgentRunActiveElapsed(turn: AgentTurn | null, enabled: boolean) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const turnId = turn?.id ?? null;
  const startedAtMs = turn?.startedAtMs ?? null;
  const turnStatus = turn?.status ?? null;
  const userWaitDurationMs = turn?.userWaitDurationMs ?? 0;
  const userWaitStartedAtMs = turn?.userWaitStartedAtMs ?? null;
  const ticking = enabled && turnStatus === "running" && startedAtMs !== null;

  useEffect(() => {
    if (!ticking) return undefined;
    const refresh = () => setNowMs(Date.now());
    refresh();
    const intervalId = window.setInterval(refresh, 1_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [
    ticking,
    turnId,
    startedAtMs,
    turnStatus,
    userWaitDurationMs,
    userWaitStartedAtMs,
  ]);

  return enabled ? agentRunActiveElapsedMs(turn, nowMs) : null;
}
