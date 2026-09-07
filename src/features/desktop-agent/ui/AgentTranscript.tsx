import type { AgentViewportGeometry } from "../domain/agent-ui-state";
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  STANDARD_CONTROL_SIZE,
  useCssPixelCustomProperty,
} from "@puppyone/shared-ui";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { ArrowDown, CircleAlert } from "lucide-react";
import { InlineLoading, PageLoading } from "../../../components/loading";
import type { AgentSubmissionStage } from "../application/agent-controller-state";
import { formatAgentDuration, outputForActivity } from "../domain/agent-activity-presentation";
import type { AgentDraftReference, AgentPromptReferenceMention } from "../domain/agent-contract";
import type { AgentPart, AgentProjection } from "../domain/agent-projection-types";
import { AgentConnectionStatus } from "./AgentConnectionStatus";
import { AgentPartRenderer } from "./AgentPartRenderer";
import { AgentToolActivityGroup } from "./AgentToolActivityGroup";
import { TranscriptRow } from "./transcript/TranscriptRow";
import { useTranscriptViewport } from "./transcript/useTranscriptViewport";
import { buildAgentTimeline } from "./transcript/transcript-rows";
import { groupAgentToolRows } from "./agent-tool-group-presentation";
import {
  agentTranscriptFadeGeometry,
  agentVirtualCanvasGeometry,
} from "./agent-runtime-geometry";
import {
  AGENT_RUN_ELAPSED_LABEL_THRESHOLD_MS,
  useAgentRunActiveElapsed,
} from "./useAgentRunActiveElapsed";

type AgentTranscriptProps = {
  projection: AgentProjection;
  loading: boolean;
  pendingPrompt?: string | null;
  pendingSubmissionId?: string | null;
  pendingPromptMentions?: AgentPromptReferenceMention[];
  pendingReferences?: AgentDraftReference[];
  submissionStage?: AgentSubmissionStage;
  working?: boolean;
  runtimeLabel?: string;
  emptyState?: ReactNode;
  initialScrollTop?: number;
  initialMeasurements?: Record<string, number>;
  initialPinned?: boolean;
  initialGeometry?: AgentViewportGeometry;
  onViewportChange?: (scrollTop: number, measurements: Record<string, number>, pinned: boolean, geometry: AgentViewportGeometry) => void;
  onOpenFile?: (path: string) => void;
};

const EMPTY_REFERENCES: AgentDraftReference[] = [];
const EMPTY_MENTIONS: AgentPromptReferenceMention[] = [];

function AgentTranscriptView({
  projection,
  loading,
  pendingPrompt = null,
  pendingSubmissionId = null,
  pendingPromptMentions = EMPTY_MENTIONS,
  pendingReferences = EMPTY_REFERENCES,
  submissionStage = null,
  working = false,
  runtimeLabel: runtimeLabelProp,
  emptyState = null,
  initialScrollTop = 0,
  initialMeasurements = {},
  initialPinned = true,
  initialGeometry,
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
  const fallbackSubmissionId = useId();
  const seenPartIdsRef = useRef(new Set<string>());
  const seededPartIdsRef = useRef(false);
  const previousTimelineRef = useRef({ rows: 0, sequence: 0 });
  const [unreadCount, setUnreadCount] = useState(0);
  const sourceTimeline = useMemo(
    () => buildAgentTimeline(projection, compactRowHeight,
      pendingPrompt || pendingReferences.length > 0 ? {
        id: pendingSubmissionId ?? fallbackSubmissionId, prompt: pendingPrompt || "",
        references: pendingReferences, promptMentions: pendingPromptMentions,
      } : null),
    [compactRowHeight, projection, pendingSubmissionId, fallbackSubmissionId, pendingPrompt, pendingReferences, pendingPromptMentions],
  );
  const timeline = useMemo(() => ({
    parts: sourceTimeline.parts,
    rows: groupAgentToolRows(sourceTimeline.rows, sourceTimeline.parts, compactRowHeight),
  }), [compactRowHeight, sourceTimeline]);
  const { canvasRef, observeTail, layout, range, pinned, observeMeasuredRow, commitMeasurement,
    handleScroll, jumpToLatest, scrollEdgeState } = useTranscriptViewport({ rows: timeline.rows, scrollRef,
      initialScrollTop, initialMeasurements, initialPinned, initialGeometry, onViewportChange });
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
  const hasLiveTail = Boolean(projection.connectionStatus)
    || Boolean(workingStatus);
  const showEmptyState = Boolean(emptyState)
    && !loading
    && timeline.rows.length === 0
    && !hasLiveTail
    && !projection.partialHistory;

  if (!seededPartIdsRef.current) {
    for (const row of timeline.rows) seenPartIdsRef.current.add(row.partId);
    seededPartIdsRef.current = true;
    previousTimelineRef.current = { rows: timeline.rows.length, sequence: latestSequence };
  }
  useEffect(() => {
    const previous = previousTimelineRef.current;
    if (pinned) setUnreadCount(0);
    else if (latestSequence > previous.sequence || timeline.rows.length > previous.rows) {
      setUnreadCount(value => Math.min(99, value + Math.max(1, timeline.rows.length - previous.rows)));
    }
    previousTimelineRef.current = { rows: timeline.rows.length, sequence: latestSequence };
  }, [pinned, latestSequence, timeline.rows.length]);

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
                <TranscriptRow
                  key={row.id}
                  rowId={row.id}
                  kind={part.kind}
                  top={layout.offsets[index]}
                  gapAfter={layout.gaps[index]}
                  animate={animate}
                  parts={parts}
                  onMeasureElement={observeMeasuredRow}
                  onContentSizeChange={commitMeasurement}
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
                </TranscriptRow>
              );
            })}
          </div>
        )}
        {hasLiveTail && (
          <div ref={observeTail} className="desktop-agent-live-tail">
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
        <button className="desktop-agent-jump-latest" type="button" onClick={() => { jumpToLatest(); setUnreadCount(0); }} aria-label={unreadCount
          ? t("agent.transcript.jumpLatestUnread", { count: unreadCount })
          : t("agent.transcript.jumpLatest")} title={t("agent.transcript.jumpLatest")}><ArrowDown size={15} /></button>
      )}
    </div>
  );
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

/** Presentation only: never fabricates model content or Harness history. */
export function shouldShowAgentThinking(projection: AgentProjection, working: boolean) {
  return agentRunStatusCode(projection, working) === "thinking";
}

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

export { agentTimelineLimits } from "./transcript/transcript-layout";
