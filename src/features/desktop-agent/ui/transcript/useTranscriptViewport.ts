import type { AgentViewportGeometry } from "../../domain/agent-ui-state";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { subscribeTypographyChanges } from "@puppyone/shared-ui";
import type { TimelineRow } from "../../domain/agent-projection-types";
import { agentTimelineSpacing, buildAgentTimelineLayout, visibleAgentTimelineRange, type AgentTimelineSpacing } from "./transcript-layout";
import { captureAgentTimelineScrollAnchor, resolveAgentTimelineScrollAnchor, type AgentTimelineScrollAnchor } from "./transcript-viewport";

const MAX_MEASUREMENTS = 1_000;
const BOTTOM_EPSILON = 1;

/** One owner for row measurements, canvas geometry and outer-transcript scrolling. */
export function useTranscriptViewport({ rows, scrollRef, initialScrollTop, initialMeasurements, initialPinned, initialGeometry, onViewportChange }: {
  rows: readonly TimelineRow[];
  scrollRef: RefObject<HTMLDivElement>;
  initialScrollTop: number;
  initialMeasurements: Record<string, number>;
  initialPinned: boolean;
  initialGeometry?: AgentViewportGeometry;
  onViewportChange?: (scrollTop: number, measurements: Record<string, number>, pinned: boolean, geometry: AgentViewportGeometry) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const [measurements, setMeasurements] = useState(() => boundedMeasurements(initialMeasurements));
  const measurementsRef = useRef(measurements);
  const [spacing, setSpacing] = useState(agentTimelineSpacing);
  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const [viewportHeight, setViewportHeight] = useState(640);
  const [contentWidth, setContentWidth] = useState(640);
  const [scrollEdgeState, setScrollEdgeState] = useState({ atTop: true, topFade: 0 });
  const [pinned, setPinned] = useState(initialPinned);
  const pinnedRef = useRef(initialPinned);
  const scrollTopRef = useRef(initialScrollTop);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const observerRef = useRef<ResizeObserver | null>(null);
  const pending = useRef(new Map<string, number>());
  const layout = useMemo(() => buildAgentTimelineLayout(rows, measurements, spacing), [rows, measurements, spacing]);
  const current = useRef({ rows, layout });
  const committed = useRef({ rows, layout });
  const readingAnchor = useRef<AgentTimelineScrollAnchor | null>(initialGeometry?.anchor ?? null);
  const signature = useRef(initialGeometry?.layoutSignature ?? "");
  const alive = useRef(true);
  const initialized = useRef(false);
  const programmaticScroll = useRef<number | null>(null);
  const callback = useRef(onViewportChange);
  const lastPublished = useRef<{ top: number; measurements: Record<string, number>; pinned: boolean; signature: string } | null>(null);
  current.current = { rows, layout };
  callback.current = onViewportChange;

  const publish = useCallback(() => {
    const next = { top: scrollTopRef.current, measurements: measurementsRef.current, pinned: pinnedRef.current, signature: signature.current };
    const last = lastPublished.current;
    if (last && Math.abs(last.top - next.top) < 0.5 && last.measurements === next.measurements && last.pinned === next.pinned && last.signature === next.signature) return;
    lastPublished.current = next;
    callback.current?.(next.top, next.measurements, next.pinned, { layoutSignature: signature.current, anchor: readingAnchor.current });
  }, []);

  const captureReadingPosition = useCallback(() => {
    if (pinnedRef.current) { readingAnchor.current = null; return; }
    readingAnchor.current = captureAgentTimelineScrollAnchor(
      committed.current.rows, committed.current.layout, scrollTopRef.current, canvasRef.current?.offsetTop ?? 0,
    );
  }, []);

  const flushMeasurements = useCallback(() => {
    if (!alive.current || pending.current.size === 0) return false;
    const validRows = new Map(current.current.rows.map(row => [row.id, row]));
    let next: Record<string, number> | null = null;
    for (const [id, height] of pending.current) {
      const row = validRows.get(id);
      if (!row || !Number.isFinite(height) || height <= 0) continue;
      if (Math.abs((measurementsRef.current[id] ?? row.estimatedHeight) - height) < 0.5) continue;
      next ??= { ...measurementsRef.current };
      next[id] = height;
    }
    pending.current.clear();
    if (!next) return false;
    // Read the previous committed layout, before any new row ordering or sizes.
    if (!readingAnchor.current) captureReadingPosition();
    next = boundedMeasurements(next, new Set(rowElements.current.keys()), new Set(validRows.keys()));
    measurementsRef.current = next;
    setMeasurements(next);
    return true;
  }, [captureReadingPosition]);

  const commitMeasurement = useCallback((id: string, height: number) => {
    if (!alive.current) return;
    pending.current.set(id, height);
    // Called from a child layout effect: React batches this before painting.
    flushMeasurements();
  }, [flushMeasurements]);

  const observeMeasuredRow = useCallback((id: string, element: HTMLDivElement | null) => {
    const previous = rowElements.current.get(id);
    if (previous === element) return;
    if (previous) observerRef.current?.unobserve(previous);
    if (!element) { rowElements.current.delete(id); pending.current.delete(id); return; }
    rowElements.current.set(id, element);
    observerRef.current?.observe(element, { box: "border-box" });
    pending.current.set(id, element.getBoundingClientRect().height);
  }, []);

  const observeTail = useCallback((element: HTMLDivElement | null) => {
    if (tailRef.current) observerRef.current?.unobserve(tailRef.current);
    tailRef.current = element;
    if (element) observerRef.current?.observe(element, { box: "border-box" });
  }, []);

  const updateEdges = useCallback((element: HTMLElement) => {
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
    const top = Math.max(0, Math.min(element.scrollTop, maximum));
    const next = { atTop: maximum <= 1 || top <= 1, topFade: maximum <= 1 ? 0 : Math.min(1, top / 24) };
    setScrollEdgeState(previous => previous.atTop === next.atTop && Math.abs(previous.topFade - next.topFade) < 0.01 ? previous : next);
  }, []);

  const writeScroll = useCallback((target: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const clamped = Math.max(0, Math.min(target, element.scrollHeight - element.clientHeight));
    if (Math.abs(element.scrollTop - clamped) >= 0.5) {
      element.scrollTop = clamped;
      programmaticScroll.current = element.scrollTop;
    }
    scrollTopRef.current = element.scrollTop;
    setScrollTop(element.scrollTop);
    updateEdges(element);
  }, [scrollRef, updateEdges]);

  const settleViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element || !alive.current) return;
    if (pinnedRef.current) writeScroll(element.scrollHeight);
    else if (readingAnchor.current) {
      const { rows: nextRows, layout: nextLayout } = current.current;
      const nextTop = resolveAgentTimelineScrollAnchor(readingAnchor.current, nextLayout,
        new Map(nextRows.map((row, index) => [row.id, index])), canvasRef.current?.offsetTop ?? 0,
        committed.current.rows, committed.current.layout);
      writeScroll(nextTop ?? scrollTopRef.current);
    }
    committed.current = current.current;
    captureReadingPosition();
    publish();
  }, [captureReadingPosition, publish, scrollRef, writeScroll]);

  const readGeometry = useCallback((force = false) => {
    const element = scrollRef.current;
    if (!element || element.clientWidth <= 0 || element.clientHeight <= 0) return;
    const css = getComputedStyle(element);
    const properties = ["--agent-conversation-font-size", "--agent-conversation-line-height", "--agent-response-line-height", "--agent-meta-line-height", "--agent-control-size", "--agent-message-turn-gap", "--agent-work-handoff-gap"];
    const nextSignature = [element.clientWidth, css.fontFamily, css.fontSize, css.lineHeight,
      ...properties.map(property => css.getPropertyValue(property))].join("|");
    if (force || (signature.current !== nextSignature && (signature.current || Object.keys(measurementsRef.current).length > 0))) {
      if (!readingAnchor.current) captureReadingPosition();
      measurementsRef.current = {};
      setMeasurements({});
      for (const [id, row] of rowElements.current) pending.current.set(id, row.getBoundingClientRect().height);
    }
    signature.current = nextSignature;
    const nextSpacing = {
      ...agentTimelineSpacing,
      workHandoff: cssPixels(css, "--agent-work-handoff-gap", agentTimelineSpacing.workHandoff),
      turnHandoff: Math.max(cssPixels(css, "--agent-message-turn-gap", agentTimelineSpacing.turnHandoff),
        cssPixels(css, "--agent-meta-line-height", 19) + 4),
    };
    setSpacing(previous => previous.workHandoff === nextSpacing.workHandoff && previous.turnHandoff === nextSpacing.turnHandoff ? previous : nextSpacing);
    setViewportHeight(element.clientHeight);
    const nextContentWidth = canvasRef.current?.getBoundingClientRect().width ?? element.clientWidth;
    setContentWidth(previous => Math.abs(previous - nextContentWidth) < 0.5 ? previous : nextContentWidth);
  }, [captureReadingPosition, scrollRef]);

  useLayoutEffect(() => {
    alive.current = true;
    const element = scrollRef.current;
    if (!element) return;
    const pendingMeasurements = pending.current;
    if (!initialized.current) {
      initialized.current = true;
      writeScroll(initialScrollTop);
      if (!readingAnchor.current) captureReadingPosition();
    }
    readGeometry();
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(entries => {
      if (!alive.current) return;
      // Native observer delivery is outside React. Commit one bounded batch
      // before paint, rather than postponing corrected geometry to another RAF.
      flushSync(() => {
        readGeometry();
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.rowId;
          if (!id || rowElements.current.get(id) !== entry.target) continue;
          const box = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize;
          const height = box?.blockSize ?? entry.target.getBoundingClientRect().height;
          pending.current.set(id, height);
        }
        flushMeasurements();
      });
      settleViewport();
    }) : null;
    observerRef.current = resize;
    // Observe independent sizes only. Observing the virtual canvas as well
    // would report our own layout writes back into the same observer cycle.
    resize?.observe(element, { box: "border-box" });
    if (tailRef.current) resize?.observe(tailRef.current, { box: "border-box" });
    for (const row of rowElements.current.values()) resize?.observe(row, { box: "border-box" });
    const refresh = (force = false) => {
      if (!alive.current) return;
      flushSync(() => { readGeometry(force); flushMeasurements(); });
      settleViewport();
    };
    const typographyChanged = () => refresh();
    const fontsLoaded = () => refresh(true);
    const unsubscribe = subscribeTypographyChanges(document, typographyChanged);
    const mutation = typeof MutationObserver === "function" ? new MutationObserver(typographyChanged) : null;
    // Observe only the ancestry that owns theme/typography, not row style writes.
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      mutation?.observe(ancestor, { attributes: true, attributeFilter: ["class", "style", "data-interface-style", "data-sub-theme-id", "data-theme-mode", "data-typography-scale"] });
    }
    document.fonts?.addEventListener("loadingdone", fontsLoaded);
    window.addEventListener("resize", typographyChanged);
    return () => {
      alive.current = false;
      observerRef.current = null;
      resize?.disconnect();
      mutation?.disconnect();
      unsubscribe();
      document.fonts?.removeEventListener("loadingdone", fontsLoaded);
      window.removeEventListener("resize", typographyChanged);
      pendingMeasurements.clear();
    };
  }, [captureReadingPosition, flushMeasurements, initialScrollTop, readGeometry, scrollRef, settleViewport, writeScroll]);

  useLayoutEffect(() => {
    readGeometry();
    if (flushMeasurements()) return;
    settleViewport();
  });

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const top = element.scrollTop;
    if (programmaticScroll.current !== null && Math.abs(top - programmaticScroll.current) < 0.5) {
      programmaticScroll.current = null;
      return;
    }
    programmaticScroll.current = null;
    // Following is user intent, not proximity: even a small upward gesture
    // leaves the live tail. Only scrolling back to the bottom (or Latest)
    // reattaches. Otherwise each render would undo a gentle trackpad scroll.
    const movedUp = top < scrollTopRef.current - 0.5;
    pinnedRef.current = !movedUp && element.scrollHeight - top - element.clientHeight <= BOTTOM_EPSILON;
    scrollTopRef.current = top;
    setScrollTop(top);
    updateEdges(element);
    setPinned(pinnedRef.current);
    captureReadingPosition();
    publish();
  }, [captureReadingPosition, publish, scrollRef, updateEdges]);

  const jumpToLatest = useCallback(() => {
    pinnedRef.current = true;
    setPinned(true);
    readingAnchor.current = null;
    settleViewport();
  }, [settleViewport]);
  const range = useMemo(() => {
    // Select rows at the position this layout will restore, not at the old
    // pixel offset. Invalidating font/width measurements can otherwise unmount
    // the visible reading row before the layout effect restores its anchor.
    const top = !pinned && readingAnchor.current
      ? resolveAgentTimelineScrollAnchor(readingAnchor.current, layout,
        new Map(rows.map((row, index) => [row.id, index])), canvasRef.current?.offsetTop ?? 0,
        committed.current.rows, committed.current.layout) ?? scrollTop
      : scrollTop;
    return visibleAgentTimelineRange(layout.offsets, rows.length, top, viewportHeight);
  }, [layout, rows, scrollTop, viewportHeight, pinned]);
  return { canvasRef, observeTail, contentWidth, scrollEdgeState, layout, range, pinned, observeMeasuredRow, commitMeasurement, handleScroll, jumpToLatest };
}

function boundedMeasurements(input: Record<string, number>, mounted = new Set<string>(), valid?: Set<string>) {
  const entries = Object.entries(input).filter(([id, height]) => (!valid || valid.has(id)) && Number.isFinite(height) && height > 0);
  if (entries.length <= MAX_MEASUREMENTS) return Object.fromEntries(entries);
  const protectedEntries = entries.filter(([id]) => mounted.has(id));
  return Object.fromEntries([...entries.filter(([id]) => !mounted.has(id)).slice(-(MAX_MEASUREMENTS - protectedEntries.length)), ...protectedEntries]);
}

function cssPixels(style: CSSStyleDeclaration, property: string, fallback: number) {
  const value = Number.parseFloat(style.getPropertyValue(property));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
