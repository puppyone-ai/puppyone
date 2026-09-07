import { useMemo } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentProjection } from "../domain/agent-projection-types";

type AgentChangesControlProps = {
  projection: AgentProjection;
  onViewChanges?: () => void;
};

export type AgentChangeSummary = {
  additions: number;
  deletions: number;
  files: number;
};

export function AgentChangesControl({ projection, onViewChanges }: AgentChangesControlProps) {
  const { t } = useLocalization();
  const summary = useMemo(() => summarizeAgentChanges(projection), [projection]);
  if (summary.files === 0) return null;

  return (
    <div className="desktop-agent-changes-control-wrap">
      <button
        type="button"
        className="desktop-agent-changes-control"
        data-po-interaction="navigation"
        aria-label={t("agent.changes.ariaLabel", { additions: summary.additions, deletions: summary.deletions })}
        disabled={!onViewChanges}
        onClick={onViewChanges}
      >
        <strong className="is-addition">+{summary.additions}</strong>
        <strong className="is-deletion">-{summary.deletions}</strong>
      </button>
    </div>
  );
}

export function summarizeAgentChanges(projection: AgentProjection): AgentChangeSummary {
  const projectedChanges = projection.parts.flatMap((part) => part.kind === "file-change" ? [part] : []);
  const candidates = projectedChanges.length > 0
    ? projectedChanges
    : projection.activities.flatMap((activity) => activity.kind === "file-change" ? [activity] : []);
  let additions = 0;
  let deletions = 0;
  let files = 0;

  for (const candidate of candidates) {
    if (!["completed", "succeeded"].includes(candidate.status)) continue;
    const changes = Array.isArray(candidate.detail.changes) ? candidate.detail.changes : [];
    if (changes.length === 0) {
      const directAdditions = boundedCount(candidate.detail.additions);
      const directDeletions = boundedCount(candidate.detail.deletions);
      if (directAdditions > 0 || directDeletions > 0) {
        additions += directAdditions;
        deletions += directDeletions;
        files += 1;
      }
      continue;
    }
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = change as Record<string, unknown>;
      additions += boundedCount(value.additions);
      deletions += boundedCount(value.deletions);
      files += 1;
    }
  }

  return { additions, deletions, files };
}

function boundedCount(value: unknown) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? Math.min(count, 99_999_999) : 0;
}
