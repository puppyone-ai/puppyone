import { Check, Circle, CircleAlert, CircleSlash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentActivityStatus } from "../../domain/agent-projection-types";
import { useAgentToolGroupDisclosure } from "../AgentToolGroupContext";

type AgentActivityShellProps = {
  title: string;
  summary?: string;
  metadata?: ReactNode;
  status: AgentActivityStatus;
  icon: ReactNode;
  children?: ReactNode;
  className?: string;
  defaultExpanded?: boolean;
};

export function AgentActivityShell({
  title,
  summary,
  metadata,
  status,
  icon,
  children,
  className = "",
  defaultExpanded = false,
}: AgentActivityShellProps) {
  const groupDisclosure = useAgentToolGroupDisclosure();
  const [standaloneExpanded, setStandaloneExpanded] = useState(defaultExpanded);
  const expanded = groupDisclosure
    ? groupDisclosure.expandedId === groupDisclosure.itemId
    : standaloneExpanded;
  const hasDetail = children !== undefined && children !== null && children !== false && children !== "";
  const visibleSummary = summary?.slice(0, 2_048);
  const compactLabel = groupDisclosure
    ? visibleSummary ? `${title}: ${visibleSummary}` : title
    : undefined;
  const toggleExpanded = () => {
    if (!hasDetail) return;
    if (groupDisclosure) {
      groupDisclosure.setExpandedId(expanded ? null : groupDisclosure.itemId);
      return;
    }
    setStandaloneExpanded((value) => !value);
  };
  const detail = expanded && hasDetail
    ? <div className="desktop-agent-tool-branch">{children}</div>
    : null;
  return (
    <div className={`desktop-agent-tool-call is-${status}${hasDetail ? " has-detail" : ""}${expanded ? " is-expanded" : ""} ${className}`.trim()}>
      <div className="desktop-agent-tool-header">
        <button
          type="button"
          className={`desktop-agent-tool-row${metadata ? " has-metadata" : ""}`}
          disabled={!hasDetail}
          aria-label={compactLabel}
          title={compactLabel}
          aria-expanded={hasDetail ? expanded : undefined}
          onClick={toggleExpanded}
        >
          <span className="desktop-agent-tool-icon" aria-hidden="true">{icon}</span>
          <strong className="desktop-agent-tool-name">{title}</strong>
          {metadata && <span className="desktop-agent-tool-metadata">{metadata}</span>}
          {visibleSummary && <span className="desktop-agent-tool-summary">{visibleSummary}</span>}
          <StatusIcon status={status} />
        </button>
      </div>
      {detail && groupDisclosure?.detailHost
        ? createPortal(detail, groupDisclosure.detailHost)
        : detail}
    </div>
  );
}

function StatusIcon({ status }: { status: AgentActivityStatus }) {
  const { t } = useLocalization();
  if (["running", "pending", "in-progress"].includes(status)) {
    // Semantic tool glyphs may use restrained action motion while work runs.
    // Do not add a second generic spinner for the same native activity.
    return null;
  }
  if (["failed", "warning", "blocked"].includes(status)) {
    return <CircleAlert className="desktop-agent-tool-status is-failed" size={12} aria-label={t(`agent.status.${status === "warning" ? "warning" : "failed"}`)} />;
  }
  if (status === "completed" || status === "succeeded") {
    return <Check className="desktop-agent-tool-status is-completed" size={12} aria-label={t("agent.status.completed")} />;
  }
  if (status === "cancelled" || status === "interrupted") {
    return <CircleSlash2 className="desktop-agent-tool-status" size={12} aria-label={t("agent.status.stopped")} />;
  }
  const label = status === "queued"
    ? t("agent.status.queued")
    : status === "waiting-for-user"
      ? t("agent.status.waitingForUser")
      : t("agent.status.unknown");
  return <Circle className="desktop-agent-tool-status" size={12} aria-label={label} />;
}
