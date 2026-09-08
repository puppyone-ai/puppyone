import { useLayoutEffect, useRef, useState } from "react";
import type { ExplorerVisibleRow } from "./explorerVisibleModel";
import {
  createExplorerMotionPlan,
  type ExplorerMotionPlan,
} from "./explorerMotionPlan";
import { EXPLORER_MOTION_DURATION_MS } from "./explorerMotionAnimation";

export { EXPLORER_MOTION_DURATION_MS } from "./explorerMotionAnimation";

export type ActiveExplorerMotionPlan = ExplorerMotionPlan & {
  generation: number;
};

type CommittedLayout = {
  rows: readonly ExplorerVisibleRow[];
  mountedRows: readonly ExplorerVisibleRow[];
  startIndex: number;
  endIndex: number;
};

export function useExplorerMotion({
  rows,
  mountedRows,
  startIndex,
  endIndex,
  rowSize,
  maxMountedRows,
}: {
  rows: readonly ExplorerVisibleRow[];
  mountedRows: readonly ExplorerVisibleRow[];
  startIndex: number;
  endIndex: number;
  rowSize: number;
  maxMountedRows: number;
}): ActiveExplorerMotionPlan | null {
  const committedRef = useRef<CommittedLayout | null>(null);
  const generationRef = useRef(0);
  const clearTimerRef = useRef<number | null>(null);
  const [activePlan, setActivePlan] = useState<ActiveExplorerMotionPlan | null>(null);

  useLayoutEffect(() => {
    const previous = committedRef.current;
    const current = { rows, mountedRows, startIndex, endIndex };
    committedRef.current = current;

    if (!previous) return;
    if (previous.rows === rows) {
      if (previous.startIndex !== startIndex || previous.endIndex !== endIndex) {
        if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
        setActivePlan(null);
      }
      return;
    }

    // The first filesystem snapshot is hydration, not a user disclosure.
    // Animating every arriving row makes a Project switch look like the whole
    // Sidebar collapsed and expanded again.
    if (previous.rows.length === 0) {
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
      setActivePlan(null);
      return;
    }

    const plan = createExplorerMotionPlan({
      previousRows: previous.rows,
      nextRows: rows,
      previousMountedRows: previous.mountedRows,
      nextMountedRows: mountedRows,
      rowSize,
      maxMountedRows,
    });
    const generation = ++generationRef.current;
    setActivePlan({ ...plan, generation });
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      setActivePlan((currentPlan) => (
        currentPlan?.generation === generation ? null : currentPlan
      ));
    }, EXPLORER_MOTION_DURATION_MS + 40);
  }, [endIndex, maxMountedRows, mountedRows, rowSize, rows, startIndex]);

  useLayoutEffect(() => () => {
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
  }, []);

  return activePlan;
}
