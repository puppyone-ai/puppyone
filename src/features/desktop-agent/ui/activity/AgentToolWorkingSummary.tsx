import { useLocalization } from "@puppyone/localization/react";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { agentActivitySummary, pathForActivity, visibleCommandForActivity } from "../../domain/agent-activity-presentation";
import { agentToolStepKind, isActiveToolStatus } from "./agent-tool-steps";
import { AgentToolStepPath, AgentToolStepText, agentToolStepVerb } from "./AgentToolStepText";

/** Keep one readable line even when a provider leaves older tools pending. */
export function AgentToolWorkingSummary({ parts }: Readonly<{ parts: readonly AgentActivity[] }>) {
  const { t, formatNumber } = useLocalization();
  const latest = parts.findLast(part => isActiveToolStatus(part.status));
  const kind = latest ? agentToolStepKind(latest) : "generic";
  const path = latest && ["read", "list", "edit", "write"].includes(kind) ? pathForActivity(latest) : "";
  const summary = latest?.kind === "command" ? visibleCommandForActivity(latest) : latest && agentActivitySummary(latest);
  return <>
    <strong className="desktop-agent-tool-name">
      {t("agent.toolStep.count", { count: parts.length, value: formatNumber(parts.length) })}
    </strong>
    {latest && kind !== "generic" && <span className="desktop-agent-tool-summary desktop-agent-tool-live-summary">
      <span aria-hidden="true">·</span>
      <span className="desktop-agent-tool-live-verb">{agentToolStepVerb(kind, latest.status, t)}</span>
      {path ? <AgentToolStepPath path={path} /> : summary && <AgentToolStepText text={summary} />}
    </span>}
  </>;
}
