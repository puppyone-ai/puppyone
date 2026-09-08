import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AgentPart } from "../../domain/agent-projection-types";
import { agentVirtualRowGeometry } from "../agent-runtime-geometry";

/** Stable row ownership is independent of provider identity and delivery status. */
export function TranscriptRow({ rowId, kind, top, gapAfter, animate, parts, onMeasureElement, onContentSizeChange, children }: {
  rowId: string;
  kind: AgentPart["kind"];
  top: number;
  gapAfter: number;
  animate: boolean;
  parts: readonly AgentPart[];
  onMeasureElement: (rowId: string, element: HTMLDivElement | null) => void;
  onContentSizeChange: (rowId: string, height: number) => void;
  children: ReactNode;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const previousParts = useRef<readonly AgentPart[]>([]);
  const [entering, setEntering] = useState(animate);
  const registerElement = useCallback((element: HTMLDivElement | null) => {
    elementRef.current = element;
    onMeasureElement(rowId, element);
  }, [onMeasureElement, rowId]);
  useEffect(() => setEntering(animate), [animate, rowId]);
  useLayoutEffect(() => {
    const previous = previousParts.current;
    previousParts.current = parts;
    if (parts.length === previous.length && parts.every((part, index) => part === previous[index])) return;
    const element = elementRef.current;
    if (element) onContentSizeChange(rowId, element.getBoundingClientRect().height);
  });
  return <div ref={registerElement}
    className={`desktop-agent-virtual-row${entering ? " is-new" : ""}`}
    data-row-id={rowId} data-kind={kind} data-gap-after={gapAfter}
    style={agentVirtualRowGeometry(top)} onAnimationEnd={() => setEntering(false)}
  >{children}</div>;
}
