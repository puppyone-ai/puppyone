import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  STANDARD_CONTROL_SIZE,
  useCssPixelCustomProperty,
  useScrollEdgeState,
} from "@puppyone/shared-ui";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { ArrowDown, CircleAlert } from "lucide-react";
import { InlineLoading, PageLoading } from "../../../components/loading";
import type { AgentSubmissionStage } from "../application/agent-controller-state";
import { formatAgentDuration, outputForActivity } from "../domain/agent-activity-presentation";
import type { AgentDraftReference, AgentPromptReferenceMention, AgentReferenceDisplay } from "../domain/agent-contract";
import type { AgentPart, AgentProjection } from "../domain/agent-projection-types";
import { AgentConnectionStatus } from "./AgentConnectionStatus";
import { AgentMessagePart } from "./AgentMessagePart";
import { AgentPartRenderer } from "./AgentPartRenderer";
import { AgentToolActivityGroup } from "./AgentToolActivityGroup";
import {
  agentTimelineLimits,
  buildAgentTimelineLayout,
  visibleAgentTimelineRange,
} from "./agent-timeline-layout";
import {
  captureAgentTimelineScrollAnchor,
  resolveAgentTimelineScrollAnchor,
  type AgentTimelineScrollAnchor,
} from "./agent-timeline-viewport";
import { buildAgentTimeline } from "./agent-timeline-presentation";
import { groupAgentToolRows } from "./agent-tool-group-presentation";
import {
  agentTranscriptFadeGeometry,
  agentVirtualCanvasGeometry,
  agentVirtualRowGeometry,
} from "./agent-runtime-geometry";
import {
  AGENT_RUN_ELAPSED_LABEL_THRESHOLD_MS,
  useAgentRunActiveElapsed,
} from "./useAgentRunActiveElapsed";

type AgentTranscriptProps = {
  projection: AgentProjection;
  loading: boolean;
  pendingPrompt?: string | null;
  pendingPromptMentions?: AgentPromptReferenceMention[];
  pendingReferences?: AgentDraftReference[];
  submissionStage?: AgentSubmissionStage;
  working?: boolean;
  runtimeLabel?: string;
  emptyState?: ReactNode;
  initialScrollTop?: number;
  initialMeasurements?: Record<string, number>;
  initialPinned?: boolean;
  onViewportChange?: (scrollTop: number, measurements: Record<string, number>, pinned: boolean) => void;
  onOpenFile?: (path: string) => void;
};

const DEFAULT_VIEWPORT_HEIGHT = 640;

function AgentTranscriptView({
  projection,
  loading,
  pendingPrompt = null,
  pendingPromptMentions = [],
  pendingReferences = [],
  submissionStage = null,
  working = false,
  runtimeLabel: runtimeLabelProp,
  emptyState = null,
  initialScrollTop = 0,
  initialMeasurements = {},
  initialPinned = true,
  onViewportChange,
  onOpenFile,
}: AgentTranscriptProps) {
  const { t, formatNumber } = useLocalization();
  const runtimeLabel = runtimeLabelProp || t("agent.name");
  const scrollRef = useRef<HTMLDivElement>(null);
  const compactRowHeight = useCssPixelCustomProperty(
    scrollRef,
    "--agent-control-size",
    STANDARD_CONTROL_SIZE,
  );
  const [measurements, setMeasurements] = useState<Record<string, number>>(() => ({ ...initialMeasurements }));
  const measurementsRef = useRef(measurements);
  const scrollTopRef = useRef(initialScrollTop);
  const pinnedRef = useRef(initialPinned);
  const seenPartIdsRef = useRef(new Set<string>());
  const seededPartIdsRef = useRef(false);
  const previousTimelineRef = useRef({ rows: 0, sequence: 0 });
  const rowMetaRef = useRef(new Map<string, { index: number; estimatedHeight: number }>());
  const rowIndexRef = useRef(new Map<string, number>());
  const onViewportChangeRef = useRef(onViewportChange);
  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
  const [pinned, setPinned] = useState(initialPinned);
  const [unreadCount, setUnreadCount] = useState(0);
  const sourceTimeline = useMemo(
    () => buildAgentTimeline(projection, compactRowHeight),
    [compactRowHeight, projection],
  );
  const timeline = useMemo(() => ({
    parts: sourceTimeline.parts,
    rows: groupAgentToolRows(sourceTimeline.rows, sourceTimeline.parts, compactRowHeight),
  }), [compactRowHeight, sourceTimeline]);
  const layout = useMemo(
    () => buildAgentTimelineLayout(timeline.rows, measurements),
    [measurements, timeline.rows],
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  const timelineRowsRef = useRef(timeline.rows);
  const rowElementsRef = useRef(new Map<string, HTMLDivElement>());
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const pendingMeasurementsRef = useRef(new Map<string, number>());
  const measurementFrameRef = useRef<number | null>(null);
  const pendingScrollAnchorRef = useRef<AgentTimelineScrollAnchor | null>(null);
  const measuredCompactRowHeightRef = useRef(compactRowHeight);
  const range = useMemo(
    () => visibleAgentTimelineRange(layout.offsets, timeline.rows.length, scrollTop, viewportHeight),
    [layout.offsets, scrollTop, timeline.rows.length, viewportHeight],
  );
  const visibleRows = timeline.rows.slice(range.start, range.end);
  // Ledger freshness and visual order are separate axes. A completion event
  // revises an existing row without moving it, but still counts as new work.
  const latestSequence = projection.lastSequence;
  const submissionStatus = agentSubmissionStatusLabel(submissionStage, runtimeLabel, t);
  const runStatus = !projection.connectionStatus && !submissionStatus
    ? agentRunStatusCode(projection, working)
    : null;
  const showThinking = runStatus === "thinking";
  const runningTurn = projection.turns.find((turn) => turn.id === projection.runningTurnId) ?? null;
  const runElapsedMs = useAgentRunActiveElapsed(runningTurn, runStatus !== null);
  const runDuration = runElapsedMs !== null && runElapsedMs >= AGENT_RUN_ELAPSED_LABEL_THRESHOLD_MS
    ? formatAgentDuration(Math.floor(runElapsedMs / 1_000) * 1_000, t, formatNumber)
    : null;
  const runStatusLabel = runStatus === "thinking"
    ? t("agent.activity.thinking")
    : runStatus === "working" ? t("agent.activity.working") : null;
  const liveReasoningSummary = runStatus === "thinking"
    ? currentAgentReasoningSummary(projection)
    : null;
  const workingStatus = projection.connectionStatus
    ? null
    : submissionStatus
      || (runStatusLabel && runDuration
        ? t("agent.transcript.runElapsed", { status: runStatusLabel, duration: runDuration })
        : runStatusLabel);
  const hasLiveTail = Boolean(pendingPrompt)
    || pendingReferences.length > 0
    || Boolean(projection.connectionStatus)
    || Boolean(workingStatus);
  const showEmptyState = Boolean(emptyState)
    && !loading
    && timeline.rows.length === 0
    && !hasLiveTail
    && !projection.partialHistory;
  const scrollEdgeState = useScrollEdgeState(scrollRef, {
    revision: `${timeline.rows.length}:${layout.totalHeight}:${hasLiveTail ? "live" : "settled"}`,
  });

  useLayoutEffect(() => {
    if (measuredCompactRowHeightRef.current === compactRowHeight) return;
    measuredCompactRowHeightRef.current = compactRowHeight;
    pendingMeasurementsRef.current.clear();
    measurementsRef.current = {};
    setMeasurements({});
  }, [compactRowHeight]);
  if (!seededPartIdsRef.current) {
    for (const row of timeline.rows) seenPartIdsRef.current.add(row.partId);
    seededPartIdsRef.current = true;
    previousTimelineRef.current = { rows: timeline.rows.length, sequence: latestSequence };
  }
  layoutRef.current = layout;
  timelineRowsRef.current = timeline.rows;
  rowMetaRef.current = new Map(timeline.rows.map((row, index) => [row.id, { index, estimatedHeight: row.estimatedHeight }]));
  rowIndexRef.current = new Map(timeline.rows.map((row, index) => [row.id, index]));
  onViewportChangeRef.current = onViewportChange;

  const flushMeasurements = useCallback(() => {
    measurementFrameRef.current = null;
    const pending = pendingMeasurementsRef.current;
    pendingMeasurementsRef.current = new Map();
    let nextMeasurements: Record<string, number> | null = null;

    for (const [rowId, height] of pending) {
      const meta = rowMetaRef.current.get(rowId);
      if (!meta) continue;
      const previousHeight = measurementsRef.current[rowId] ?? meta.estimatedHeight;
      if (!Number.isFinite(height) || height <= 0 || Math.abs(previousHeight - height) < 1) continue;
      nextMeasurements ??= { ...measurementsRef.current };
      nextMeasurements[rowId] = height;
    }

    if (!nextMeasurements) return;
    const element = scrollRef.current;
    if (element && !pinnedRef.current) {
      pendingScrollAnchorRef.current = captureAgentTimelineScrollAnchor(
        timelineRowsRef.current,
        layoutRef.current,
        scrollTopRef.current,
        canvasRef.current?.offsetTop ?? 0,
      );
    }
    measurementsRef.current = nextMeasurements;
    setMeasurements(nextMeasurements);
  }, []);

  const queueMeasurement = useCallback((rowId: string, height: number) => {
    pendingMeasurementsRef.current.set(rowId, height);
    if (measurementFrameRef.current !== null) return;
    measurementFrameRef.current = window.requestAnimationFrame(flushMeasurements);
  }, [flushMeasurements]);

  const commitMeasurement = useCallback((rowId: string, height: number) => {
    pendingMeasurementsRef.current.set(rowId, height);
    if (measurementFrameRef.current !== null) {
      window.cancelAnimationFrame(measurementFrameRef.current);
      measurementFrameRef.current = null;
    }
    flushMeasurements();
  }, [flushMeasurements]);

  const observeMeasuredRow = useCallback((rowId: string, element: HTMLDivElement | null) => {
    const previous = rowElementsRef.current.get(rowId);
    if (previous === element) return;
    if (previous) rowObserverRef.current?.unobserve(previous);
    if (!element) {
      rowElementsRef.current.delete(rowId);
      pendingMeasurementsRef.current.delete(rowId);
      return;
    }
    rowElementsRef.current.set(rowId, element);
    rowObserverRef.current?.observe(element, { box: "border-box" });
    queueMeasurement(rowId, element.getBoundingClientRect().height);
  }, [queueMeasurement]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    element.scrollTop = initialScrollTop;
    scrollTopRef.current = element.scrollTop;
    pinnedRef.current = initialPinned;
    setScrollTop(element.scrollTop);
    setPinned(initialPinned);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(([entry]) => {
      if (entry?.contentRect.height > 0) setViewportHeight(entry.contentRect.height);
    }) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [initialPinned, initialScrollTop]);

  useEffect(() => {
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rowId = (entry.target as HTMLElement).dataset.rowId;
        if (rowId) queueMeasurement(rowId, resizeObserverBorderBoxHeight(entry));
      }
    });
    rowObserverRef.current = observer;
    for (const element of rowElementsRef.current.values()) {
      observer.observe(element, { box: "border-box" });
    }
    return () => {
      observer.disconnect();
      if (rowObserverRef.current === observer) rowObserverRef.current = null;
    };
  }, [queueMeasurement]);

  useEffect(() => () => {
    if (measurementFrameRef.current !== null) {
      window.cancelAnimationFrame(measurementFrameRef.current);
      measurementFrameRef.current = null;
    }
    pendingMeasurementsRef.current.clear();
  }, []);

  useLayoutEffect(() => {
    if (pendingMeasurementsRef.current.size === 0) return;
    // A newly committed row replaces the optimistic live-tail message. Resolve
    // its real geometry before paint so the virtual canvas never exposes its
    // coarse estimate for one frame and moves the working indicator afterward.
    if (measurementFrameRef.current !== null) {
      window.cancelAnimationFrame(measurementFrameRef.current);
      measurementFrameRef.current = null;
    }
    flushMeasurements();
  }, [flushMeasurements, timeline.rows.length]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (pinnedRef.current) {
      element.scrollTop = element.scrollHeight;
    } else if (pendingScrollAnchorRef.current) {
      const nextScrollTop = resolveAgentTimelineScrollAnchor(
        pendingScrollAnchorRef.current,
        layout,
        rowIndexRef.current,
        canvasRef.current?.offsetTop ?? 0,
      );
      pendingScrollAnchorRef.current = null;
      if (nextScrollTop !== null) element.scrollTop = nextScrollTop;
    } else {
      return;
    }
    scrollTopRef.current = element.scrollTop;
    setScrollTop(element.scrollTop);
    onViewportChangeRef.current?.(element.scrollTop, measurementsRef.current, pinnedRef.current);
  }, [layout, pendingPrompt, projection.approvals.length, projection.questions.length, workingStatus]);

  useEffect(() => {
    const previous = previousTimelineRef.current;
    if (latestSequence <= previous.sequence && timeline.rows.length <= previous.rows) return;
    if (pinnedRef.current) setUnreadCount(0);
    else {
      const addedRows = Math.max(0, timeline.rows.length - previous.rows);
      setUnreadCount((current) => Math.min(99, current + Math.max(1, addedRows)));
    }
    previousTimelineRef.current = { rows: timeline.rows.length, sequence: latestSequence };
  }, [latestSequence, timeline.rows.length]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const nextScrollTop = element.scrollTop;
    const nextPinned = element.scrollHeight - nextScrollTop - element.clientHeight < 80;
    scrollTopRef.current = nextScrollTop;
    pinnedRef.current = nextPinned;
    setScrollTop(nextScrollTop);
    setPinned(nextPinned);
    if (nextPinned) setUnreadCount(0);
    onViewportChangeRef.current?.(nextScrollTop, measurementsRef.current, nextPinned);
  };

  return (
    <div
      className="desktop-agent-transcript-wrap"
      data-scroll-at-top={scrollEdgeState.atTop ? "true" : "false"}
      style={agentTranscriptFadeGeometry(scrollEdgeState.topFade)}
    >
      <div
        className="desktop-agent-transcript"
        data-po-scrollbar="content"
        ref={scrollRef}
        onScroll={handleScroll}
        aria-label={t("agent.transcript.conversation", { agent: bidiIsolate(runtimeLabel) })}
        tabIndex={0}
      >
        {projection.partialHistory && (
          <div className="desktop-agent-history-warning" role="status">
            <CircleAlert size={14} /> {t("agent.transcript.partialHistory")}
          </div>
        )}
        {loading && timeline.rows.length === 0 && !hasLiveTail && (
          <PageLoading
            variant="fill"
            label={null}
            ariaLabel={t("agent.transcript.preparing", { agent: bidiIsolate(runtimeLabel) })}
            className="desktop-agent-startup-loading"
          />
        )}
        {showEmptyState && emptyState}
        {timeline.rows.length > 0 && (
          <div ref={canvasRef} className="desktop-agent-virtual-canvas" style={agentVirtualCanvasGeometry(layout.totalHeight)}>
            {visibleRows.map((row, relativeIndex) => {
              const index = range.start + relativeIndex;
              const parts = row.partIds
                .map((partId) => timeline.parts.get(partId))
                .filter((part): part is AgentPart => Boolean(part));
              const part = parts[0];
              if (!part) return null;
              // User prompts are already shown optimistically. Animating their
              // committed replacement makes the same message visibly enter
              // twice during the first-turn handoff.
              const animate = part.kind !== "user" && !seenPartIdsRef.current.has(part.id);
              for (const visiblePart of parts) seenPartIdsRef.current.add(visiblePart.id);
              return (
                <MeasuredRow
                  key={row.id}
                  rowId={row.id}
                  kind={part.kind}
                  top={layout.offsets[index]}
                  gapAfter={layout.gaps[index]}
                  animate={animate}
                  onMeasureElement={observeMeasuredRow}
                >
                  {row.toolGroup
                    ? <AgentToolActivityGroup
                        parts={parts}
                        rowId={row.id}
                        runtimeLabel={runtimeLabel}
                        onOpenFile={onOpenFile}
                        onRowHeightChange={commitMeasurement}
                      />
                    : <MemoAgentPartRenderer part={part} runtimeLabel={runtimeLabel} onOpenFile={onOpenFile} />}
                </MeasuredRow>
              );
            })}
          </div>
        )}
        {hasLiveTail && (
          <div className="desktop-agent-live-tail">
            {(pendingPrompt || pendingReferences.length > 0) && <AgentMessagePart part={{
              id: "optimistic:user",
              kind: "user",
              turnId: null,
              itemId: null,
              text: pendingPrompt || "",
              references: pendingReferences.map(draftReferenceDisplay),
              promptMentions: pendingPromptMentions,
              streaming: false,
              terminalState: null,
              sequence: Number.MAX_SAFE_INTEGER,
            }} runtimeLabel={runtimeLabel} />}
            {projection.connectionStatus && <AgentConnectionStatus status={projection.connectionStatus} />}
            {workingStatus && (
              <AgentRunStatus
                key={liveReasoningSummary?.id ?? projection.runningTurnId ?? "run-status"}
                label={workingStatus}
                ariaLabel={showThinking
                    ? t("agent.transcript.thinkingAria", { agent: bidiIsolate(runtimeLabel) })
                    : workingStatus}
                reasoningSummary={liveReasoningSummary?.text ?? null}
              />
            )}
          </div>
        )}
        <div className="desktop-agent-announcer" aria-live="polite" aria-atomic="true">
          {projection.terminalState
            ? t("agent.transcript.turnEnded", {
                agent: bidiIsolate(runtimeLabel),
                status: t(`agent.turn.status.${projection.terminalState}`),
              })
            : ""}
        </div>
      </div>
      {!pinned && timeline.rows.length > 0 && (
        <button className="desktop-agent-jump-latest" type="button" onClick={() => {
          const element = scrollRef.current;
          if (element) element.scrollTop = element.scrollHeight;
          pinnedRef.current = true;
          setPinned(true);
          setUnreadCount(0);
        }} aria-label={unreadCount
          ? t("agent.transcript.jumpLatestUnread", { count: unreadCount })
          : t("agent.transcript.jumpLatest")} title={t("agent.transcript.jumpLatest")}><ArrowDown size={15} /></button>
      )}
    </div>
  );
}

function draftReferenceDisplay(reference: AgentDraftReference): AgentReferenceDisplay {
  return {
    id: reference.id,
    kind: reference.kind === "staged-attachment"
      ? "attachment"
      : reference.entryType === "directory" ? "workspace-directory" : "workspace-file",
    displayName: reference.displayName,
    ...(reference.kind === "workspace-entry" ? { relativePath: reference.relativePath } : {}),
    ...(reference.kind === "staged-attachment" ? { mime: reference.mime, size: reference.size } : {}),
  };
}

export const AgentTranscript = memo(AgentTranscriptView);
AgentTranscript.displayName = "AgentTranscript";

const MemoAgentPartRenderer = memo(AgentPartRenderer);

function AgentRunStatus({ label, ariaLabel, reasoningSummary }: {
  label: string;
  ariaLabel: string;
  reasoningSummary: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const indicator = (
    <InlineLoading
      className="desktop-agent-working-indicator"
      size="xs"
      tone="neutral"
      label={label}
      ariaLabel={ariaLabel}
    />
  );
  if (!reasoningSummary) return indicator;
  return (
    <div className={`desktop-agent-run-status${expanded ? " is-expanded" : ""}`}>
      <button
        className="desktop-agent-run-status-toggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {indicator}
      </button>
      {expanded && (
        <div className="desktop-agent-run-summary-preview" dir="auto">
          {reasoningSummary}
        </div>
      )}
    </div>
  );
}

export function currentAgentReasoningSummary(projection: AgentProjection) {
  const turnId = projection.runningTurnId;
  if (!turnId) return null;
  const parts = projection.parts.length > 0
    ? projection.parts
    : projection.activities.map((activity): AgentPart => ({ ...activity }));
  const reasoning = parts
    .filter((part): part is Extract<AgentPart, { kind: "reasoning" }> => (
      part.kind === "reasoning" && part.turnId === turnId
    ))
    .sort((left, right) => (
      (left.updatedSequence ?? left.sequence) - (right.updatedSequence ?? right.sequence)
    ))
    .at(-1);
  if (!reasoning) return null;
  const text = (typeof reasoning.detail.delta === "string"
    ? reasoning.detail.delta
    : outputForActivity(reasoning)).trim().slice(0, 2_048);
  return text ? { id: reasoning.id, text } : null;
}

function MeasuredRow({ rowId, kind, top, gapAfter, animate, onMeasureElement, children }: {
  rowId: string;
  kind: AgentPart["kind"];
  top: number;
  gapAfter: number;
  animate: boolean;
  onMeasureElement: (rowId: string, element: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const [entering, setEntering] = useState(animate);
  const registerElement = useCallback((element: HTMLDivElement | null) => {
    onMeasureElement(rowId, element);
  }, [onMeasureElement, rowId]);
  useEffect(() => setEntering(animate), [animate, rowId]);
  return <div
    ref={registerElement}
    className={`desktop-agent-virtual-row${entering ? " is-new" : ""}`}
    data-row-id={rowId}
    data-kind={kind}
    data-gap-after={gapAfter}
    style={agentVirtualRowGeometry(top)}
    onAnimationEnd={() => setEntering(false)}
  >{children}</div>;
}

function resizeObserverBorderBoxHeight(entry: ResizeObserverEntry) {
  const borderBox = Array.isArray(entry.borderBoxSize)
    ? entry.borderBoxSize[0]
    : entry.borderBoxSize;
  return borderBox?.blockSize || entry.target.getBoundingClientRect().height;
}

/** Presentation-only working state; never fabricates or persists model text. */
export function shouldShowAgentThinking(
  projection: AgentProjection,
  working: boolean,
) {
  return agentRunStatusCode(projection, working) === "thinking";
}

/**
 * Provider-neutral, presentation-only pulse for an accepted native turn.
 * It never becomes transcript content and therefore never enters a Harness
 * continuation. Event semantics decide the label; silence never fabricates a
 * model message or a fake tool result.
 */
export function agentRunStatusCode(
  projection: AgentProjection,
  working: boolean,
): "thinking" | "working" | null {
  if (!working || projection.approvals.length > 0 || projection.questions.length > 0) return null;
  const turnId = projection.runningTurnId;
  if (!turnId) return null;
  const typedParts = projection.parts.length > 0
    ? projection.parts
    : [
      ...projection.messages.map((message): AgentPart => ({ ...message, kind: message.role })),
      ...projection.activities.map((activity): AgentPart => ({ ...activity })),
    ];
  const visible = typedParts
    .filter((part) => part.turnId === turnId && !["user", "usage", "permission", "question"].includes(part.kind))
    .sort((left, right) => (
      (left.updatedSequence ?? left.sequence) - (right.updatedSequence ?? right.sequence)
    ));
  const latest = visible.at(-1);
  if (!latest) return "thinking";
  if (latest.kind === "assistant") return latest.streaming ? null : "working";
  if (latest.kind === "error" || latest.kind === "warning") return null;
  if ("status" in latest && ["running", "pending", "in-progress", "waiting-for-user", "blocked"].includes(latest.status)) {
    return latest.kind === "reasoning" ? "thinking" : "working";
  }
  // A completed tool/reasoning item while the turn is still active means the
  // native harness has resumed work and needs a fresh, non-persistent pulse.
  return "working";
}

export function agentSubmissionStatusLabel(
  stage: AgentSubmissionStage,
  runtimeLabel: string,
  t: MessageFormatter,
) {
  if (stage === "preparing-session") {
    return t("agent.transcript.preparing", { agent: bidiIsolate(runtimeLabel) });
  }
  if (stage === "starting-turn") return t("agent.transcript.startingTurn");
  return null;
}

export { agentTimelineLimits } from "./agent-timeline-layout";
