import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentPart } from "../domain/agent-projection-types";
import { AgentPartRenderer } from "./AgentPartRenderer";
import { AgentToolGroupContext } from "./AgentToolGroupContext";
import { agentToolStepSegments, isActiveToolStatus, type AgentToolStepSegment } from "./activity/agent-tool-steps";
import { isAgentToolActivity } from "../../../../shared/agent-contract/activity-semantics.mjs";
import { AgentToolWorkingSummary } from "./activity/AgentToolWorkingSummary";

type AgentToolActivityGroupProps = Readonly<{
  parts: readonly AgentPart[];
  rowId: string;
  runtimeLabel: string;
  onOpenFile?: (path: string) => void;
  onRowHeightChange: (rowId: string, height: number) => void;
}>;

/**
 * One quiet summary per run. Active details stay inline with its count;
 * finished runs collapse, and original tool details remain available on demand.
 */
function AgentToolActivityGroupView({
  parts,
  rowId,
  runtimeLabel,
  onOpenFile,
  onRowHeightChange,
}: AgentToolActivityGroupProps) {
  const { t, formatNumber, formatList } = useLocalization();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(() => new Set());
  const groupRef = useRef<HTMLDivElement>(null);
  const segments = useMemo(() => agentToolStepSegments(parts), [parts]);
  const active = parts.some(part => isAgentToolActivity(part) && isActiveToolStatus(part.status));
  const wasActive = useRef(active);
  useLayoutEffect(() => {
    if (wasActive.current && !active) {
      setOpenFolds(new Set());
      setExpandedId(null);
    }
    wasActive.current = active;
  }, [active]);
  const partIds = useMemo(() => new Set(parts.map((part) => part.id)), [parts]);
  const toggleFold = useCallback((foldId: string) => {
    setOpenFolds((current) => {
      const next = new Set(current);
      if (!next.delete(foldId)) next.add(foldId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (expandedId && !partIds.has(expandedId)) setExpandedId(null);
  }, [expandedId, partIds]);

  useLayoutEffect(() => {
    const row = groupRef.current?.closest<HTMLElement>(".desktop-agent-virtual-row");
    if (row) onRowHeightChange(rowId, row.getBoundingClientRect().height);
  }, [expandedId, onRowHeightChange, openFolds, rowId, segments]);

  const renderStep = (part: AgentPart) => (
    <div
      key={part.id}
      className={`desktop-agent-tool-group-item${expandedId === part.id ? " is-selected" : ""}`}
    >
      <AgentToolGroupContext.Provider value={{ itemId: part.id, expandedId, setExpandedId }}>
        <AgentPartRenderer part={part} runtimeLabel={runtimeLabel} onOpenFile={onOpenFile} />
      </AgentToolGroupContext.Provider>
    </div>
  );

  const explorationSummary = (segment: Extract<AgentToolStepSegment, { type: "explored" }>) => formatList([
    segment.files ? t("agent.toolStep.files", { count: segment.files, value: formatNumber(segment.files) }) : "",
    segment.searches ? t("agent.toolStep.searches", { count: segment.searches, value: formatNumber(segment.searches) }) : "",
  ].filter(Boolean));

  return (
    <div ref={groupRef} className="desktop-agent-tool-group">
      {segments.map((segment) => {
        if (segment.type === "step") return renderStep(segment.part);
        const open = openFolds.has(segment.id);
        return (
          <div key={segment.id} className={`desktop-agent-tool-fold${open ? " is-open" : ""}`}>
            <button
              type="button"
              className="desktop-agent-tool-row desktop-agent-tool-fold-row"
              aria-expanded={open}
              onClick={() => toggleFold(segment.id)}
            >
              <span className="desktop-agent-tool-icon" aria-hidden="true">
                <ChevronRight className="desktop-agent-tool-fold-chevron" size={13} strokeWidth={2} />
              </span>
              {segment.type === "working" && <AgentToolWorkingSummary parts={segment.parts} />}
              {segment.type === "explored" && (
                <>
                  <strong className="desktop-agent-tool-name">{t("agent.toolStep.explored")}</strong>
                  <span className="desktop-agent-tool-summary">
                    <span className="desktop-agent-tool-subject">
                      <span className="desktop-agent-tool-subject-context">{explorationSummary(segment)}</span>
                    </span>
                  </span>
                </>
              )}
              {segment.type === "settled" && (
                <strong className="desktop-agent-tool-name">
                  {t("agent.toolStep.settled", { count: segment.steps, value: formatNumber(segment.steps) })}
                </strong>
              )}
            </button>
            {open && <div className="desktop-agent-tool-fold-body">{segment.parts.map(renderStep)}</div>}
          </div>
        );
      })}
    </div>
  );
}

export const AgentToolActivityGroup = memo(AgentToolActivityGroupView);
