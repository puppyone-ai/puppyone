import { useLocalization } from "@puppyone/localization/react";
import {
  agentActivitySummary,
  agentActivityToolId,
  isContextCompactionActivity,
  outputForActivity,
  structuredInputForActivity,
} from "../../domain/agent-activity-presentation";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { AgentActivityShell } from "./AgentActivityShell";
import { AgentToolGlyph } from "./AgentToolGlyph";
import { AgentToolEvidenceNode, AgentToolEvidenceTree } from "./AgentToolEvidenceTree";
import { AgentToolStepCode, AgentToolStepText, agentToolStepVerb } from "./AgentToolStepText";
import { AgentToolTextEvidence } from "./AgentToolTextEvidence";
import { agentToolStepKind } from "./agent-tool-steps";
import { genericToolSummary, informativeToolLabel, inputForActivity } from "../../domain/agent-tool-input";

export function AgentGenericActivity({ activity }: { activity: AgentActivity }) {
  const { t } = useLocalization();
  if (isContextCompactionActivity(activity)) {
    return (
      <div className="desktop-agent-context-divider" role="status" aria-label={t("agent.activity.contextCompacted")}>
        <span aria-hidden="true" />
        <small>{t("agent.activity.contextCompacted")}</small>
        <span aria-hidden="true" />
      </div>
    );
  }
  const tool = agentActivityToolId(activity);
  const output = outputForActivity(activity);
  const input = structuredInputForActivity(activity);
  const detail = output || input;
  const stepKind = agentToolStepKind(activity);
  const structured = inputForActivity(activity);
  const target = [structured.url, structured.uri, activity.detail.url, structured.query, activity.detail.query]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const title = agentToolStepVerb(stepKind, activity.status, t);
  // A provider label that only repeats the tool name adds nothing to the line.
  const summary = agentActivitySummary(activity);
  const informativeSummary = summary && ![title, tool, activity.detail.tool]
    .some((value) => typeof value === "string" && value.trim().toLowerCase() === summary.trim().toLowerCase());
  const identity = informativeToolLabel(activity) || (tool === "tool" ? "" : tool);
  const purpose = genericToolSummary(activity);
  const genericSummary = purpose || identity || t("agent.activity.detailsNotProvided");
  return (
    <AgentActivityShell
      title={title}
      subject={stepKind === "generic"
        ? <AgentToolStepText text={genericSummary} context={purpose && identity && purpose !== identity ? identity : undefined} />
        : genericSubject(target, informativeSummary ? summary : "")}
      status={activity.status}
      icon={<AgentToolGlyph tool={tool} status={activity.status} />}
      className="desktop-agent-generic-tool"
    >
      {detail && (
        <AgentToolEvidenceTree>
          {input && (
            <AgentToolEvidenceNode kind="request">
              <AgentToolTextEvidence text={input} />
            </AgentToolEvidenceNode>
          )}
          {output && (
            <AgentToolEvidenceNode kind="result">
              <AgentToolTextEvidence text={output} />
            </AgentToolEvidenceNode>
          )}
        </AgentToolEvidenceTree>
      )}
    </AgentActivityShell>
  );
}

function genericSubject(target: string | undefined, summary: string) {
  if (target) return <AgentToolStepCode text={target} />;
  return summary ? <AgentToolStepText text={summary} /> : undefined;
}
