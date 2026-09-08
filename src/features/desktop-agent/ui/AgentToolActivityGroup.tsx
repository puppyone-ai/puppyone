import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentPart } from "../domain/agent-projection-types";
import { AgentPartRenderer } from "./AgentPartRenderer";
import { AgentToolGroupContext } from "./AgentToolGroupContext";

type AgentToolActivityGroupProps = Readonly<{
  parts: readonly AgentPart[];
  rowId: string;
  runtimeLabel: string;
  onOpenFile?: (path: string) => void;
  onRowHeightChange: (rowId: string, height: number) => void;
}>;

function AgentToolActivityGroupView({
  parts,
  rowId,
  runtimeLabel,
  onOpenFile,
  onRowHeightChange,
}: AgentToolActivityGroupProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailHost, setDetailHost] = useState<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const partIds = useMemo(() => new Set(parts.map((part) => part.id)), [parts]);

  useEffect(() => {
    if (expandedId && !partIds.has(expandedId)) setExpandedId(null);
  }, [expandedId, partIds]);

  useLayoutEffect(() => {
    const row = groupRef.current?.closest<HTMLElement>(".desktop-agent-virtual-row");
    if (row) onRowHeightChange(rowId, row.getBoundingClientRect().height);
  }, [expandedId, onRowHeightChange, parts.length, rowId]);

  return (
    <div ref={groupRef} className="desktop-agent-tool-group">
      {parts.map((part) => (
        <div
          key={part.id}
          className={`desktop-agent-tool-group-item${expandedId === part.id ? " is-selected" : ""}`}
        >
          <AgentToolGroupContext.Provider value={{
            itemId: part.id,
            expandedId,
            detailHost,
            setExpandedId,
          }}>
            <AgentPartRenderer part={part} runtimeLabel={runtimeLabel} onOpenFile={onOpenFile} />
          </AgentToolGroupContext.Provider>
        </div>
      ))}
      <div ref={setDetailHost} className="desktop-agent-tool-group-detail" />
    </div>
  );
}

export const AgentToolActivityGroup = memo(AgentToolActivityGroupView);
