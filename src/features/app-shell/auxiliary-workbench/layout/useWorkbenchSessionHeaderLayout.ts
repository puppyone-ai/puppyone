import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  resolveWorkbenchSessionHeaderLayout,
  WORKBENCH_SESSION_HEADER_METRICS,
} from "./workbenchSessionHeaderLayout";

/** Measures Header capacity, never the content-sized rail it controls. */
export function useWorkbenchSessionHeaderLayout(
  sessionIds: readonly string[],
  activeSessionId: string | null,
  trailingControlCount = 1,
) {
  const capacityRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [visibleWindow, setVisibleWindow] = useState<readonly string[]>([]);

  useLayoutEffect(() => {
    const capacity = capacityRef.current;
    if (!capacity) return undefined;
    const measure = () => {
      const headerWidth = Math.floor(capacity.getBoundingClientRect().width);
      const nextWidth = Math.max(
        0,
        headerWidth
          - WORKBENCH_SESSION_HEADER_METRICS.createControl * trailingControlCount
          - WORKBENCH_SESSION_HEADER_METRICS.gap,
      );
      setAvailableWidth((current) => current === nextWidth ? current : nextWidth);
    };
    measure();
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(measure)
      : null;
    observer?.observe(capacity);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [trailingControlCount]);

  const layout = useMemo(() => resolveWorkbenchSessionHeaderLayout({
    sessionIds,
    activeSessionId,
    availableWidth,
    preferredVisibleSessionIds: visibleWindow,
  }), [activeSessionId, availableWidth, sessionIds, visibleWindow]);

  useLayoutEffect(() => {
    setVisibleWindow((current) => arraysEqual(current, layout.visibleSessionIds)
      ? current
      : layout.visibleSessionIds);
  }, [layout.visibleSessionIds]);

  return { capacityRef, layout };
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
