import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentPart } from "../domain/agent-projection-types";
import {
  AGENT_TOOL_RAIL_GAP,
  AGENT_TOOL_RAIL_GROUP_INSET,
  AGENT_TOOL_RAIL_ITEM_WIDTH,
  AGENT_TOOL_RAIL_OVERFLOW_WIDTH,
  agentToolRailVisibleCount,
} from "./agent-tool-group-presentation";
import { agentToolRailGeometry } from "./agent-runtime-geometry";
import { AgentPartRenderer } from "./AgentPartRenderer";
import { AgentToolGroupContext } from "./AgentToolGroupContext";

type AgentToolActivityGroupProps = Readonly<{
  parts: readonly AgentPart[];
  rowId: string;
  runtimeLabel: string;
  availableWidth: number;
  onOpenFile?: (path: string) => void;
  onRowHeightChange: (rowId: string, height: number) => void;
}>;

function AgentToolActivityGroupView({
  parts,
  rowId,
  runtimeLabel,
  availableWidth,
  onOpenFile,
  onRowHeightChange,
}: AgentToolActivityGroupProps) {
  const { t, formatNumber } = useLocalization();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [detailHost, setDetailHost] = useState<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const overflowId = useId();
  const partIds = useMemo(() => new Set(parts.map((part) => part.id)), [parts]);
  const visibleCount = useMemo(() => agentToolRailVisibleCount({
    total: parts.length,
    width: Math.max(0, availableWidth - AGENT_TOOL_RAIL_GROUP_INSET),
    itemWidth: AGENT_TOOL_RAIL_ITEM_WIDTH,
    gap: AGENT_TOOL_RAIL_GAP,
    overflowWidth: AGENT_TOOL_RAIL_OVERFLOW_WIDTH,
  }), [availableWidth, parts.length]);
  const visibleParts = useMemo(() => parts.slice(0, visibleCount), [parts, visibleCount]);
  const hiddenParts = useMemo(() => parts.slice(visibleCount), [parts, visibleCount]);
  const visiblePartIds = useMemo(
    () => new Set(visibleParts.map((part) => part.id)),
    [visibleParts],
  );
  const selectItem = useCallback((itemId: string | null) => {
    setOverflowOpen(false);
    setExpandedId(itemId);
  }, []);

  useEffect(() => {
    if (expandedId && !partIds.has(expandedId)) setExpandedId(null);
  }, [expandedId, partIds]);

  useEffect(() => {
    if (expandedId && !visiblePartIds.has(expandedId) && !overflowOpen) setExpandedId(null);
  }, [expandedId, overflowOpen, visiblePartIds]);

  useEffect(() => {
    if (hiddenParts.length === 0) setOverflowOpen(false);
  }, [hiddenParts.length]);

  useLayoutEffect(() => {
    const row = groupRef.current?.closest<HTMLElement>(".desktop-agent-virtual-row");
    if (row) onRowHeightChange(rowId, row.getBoundingClientRect().height);
  }, [expandedId, onRowHeightChange, overflowOpen, parts.length, rowId, visibleCount]);

  return (
    <div ref={groupRef} className="desktop-agent-tool-group" style={agentToolRailGeometry({
      itemWidth: AGENT_TOOL_RAIL_ITEM_WIDTH,
      gap: AGENT_TOOL_RAIL_GAP,
      overflowWidth: AGENT_TOOL_RAIL_OVERFLOW_WIDTH,
      groupInset: AGENT_TOOL_RAIL_GROUP_INSET,
    })}>
      <div className="desktop-agent-tool-rail">
        {visibleParts.map((part) => (
          <div
            key={part.id}
            className={`desktop-agent-tool-group-item${expandedId === part.id ? " is-selected" : ""}`}
          >
            <AgentToolGroupContext.Provider value={{
              itemId: part.id,
              expandedId,
              detailHost,
              setExpandedId: selectItem,
            }}>
              <AgentPartRenderer part={part} runtimeLabel={runtimeLabel} onOpenFile={onOpenFile} />
            </AgentToolGroupContext.Provider>
          </div>
        ))}
        {hiddenParts.length > 0 && (
          <button
            type="button"
            className="desktop-agent-tool-overflow"
            aria-expanded={overflowOpen}
            aria-controls={overflowId}
            aria-label={t("agent.activity.moreTools", {
              count: hiddenParts.length,
              value: formatNumber(hiddenParts.length),
            })}
            title={t("agent.activity.moreTools", {
              count: hiddenParts.length,
              value: formatNumber(hiddenParts.length),
            })}
            onClick={() => {
              setExpandedId(null);
              setOverflowOpen((value) => !value);
            }}
          >
            +{formatNumber(hiddenParts.length)}
          </button>
        )}
      </div>
      {overflowOpen && (
        <div id={overflowId} className="desktop-agent-tool-overflow-panel">
          {hiddenParts.map((part) => (
            <div key={part.id} className="desktop-agent-tool-overflow-item">
              <AgentToolGroupContext.Provider value={{
                itemId: part.id,
                expandedId,
                detailHost,
                setExpandedId,
              }}>
                <AgentPartRenderer
                  part={part}
                  runtimeLabel={runtimeLabel}
                  onOpenFile={onOpenFile}
                />
              </AgentToolGroupContext.Provider>
            </div>
          ))}
        </div>
      )}
      <div ref={setDetailHost} className="desktop-agent-tool-group-detail" />
    </div>
  );
}

export const AgentToolActivityGroup = memo(AgentToolActivityGroupView);
