import { useLocalization } from "@puppyone/localization/react";
import {
  agentActivityToolId,
  formatAgentToolName,
  isContextCompactionActivity,
  outputForActivity,
  structuredInputForActivity,
} from "../../domain/agent-activity-presentation";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { AgentActivityShell } from "./AgentActivityShell";
import { AgentToolGlyph } from "./AgentToolGlyph";
import { AgentToolEvidenceNode, AgentToolEvidenceTree } from "./AgentToolEvidenceTree";
import { AgentToolTextEvidence } from "./AgentToolTextEvidence";

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
  return (
    <AgentActivityShell
      title={formatAgentToolName(tool, t)}
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
