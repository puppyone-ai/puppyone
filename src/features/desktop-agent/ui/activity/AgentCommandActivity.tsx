import { useLocalization } from "@puppyone/localization/react";
import {
  commandForActivity,
  commandMetadata,
  commandPresentationForActivity,
  formatAgentDuration,
  outputForActivity,
  visibleCommandForActivity,
} from "../../domain/agent-activity-presentation";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { AgentActivityShell } from "./AgentActivityShell";
import { AgentToolGlyph } from "./AgentToolGlyph";
import { AgentToolEvidenceNode, AgentToolEvidenceTree } from "./AgentToolEvidenceTree";
import { AgentToolStepCode, agentToolStepVerb } from "./AgentToolStepText";
import { AgentToolTextEvidence } from "./AgentToolTextEvidence";
import { agentToolStepKind, isActiveToolStatus } from "./agent-tool-steps";

export function AgentCommandActivity({ activity }: { activity: AgentActivity }) {
  const { t, formatNumber } = useLocalization();
  const command = commandForActivity(activity);
  const output = outputForActivity(activity);
  const presentation = commandPresentationForActivity(activity);
  const stepKind = agentToolStepKind(activity);
  const visibleCommand = visibleCommandForActivity(activity) || activity.label;
  const { exitCode, durationMs } = commandMetadata(activity);
  const settled = !isActiveToolStatus(activity.status);
  // Only facts worth a glance: a non-zero exit, and runs long enough to notice.
  const facts = settled ? [
    exitCode !== null && exitCode !== 0 ? t("agent.toolStep.exitCode", { code: formatNumber(exitCode) }) : "",
    durationMs !== null && durationMs >= 1_000 ? formatAgentDuration(durationMs, t, formatNumber) : "",
  ].filter(Boolean) : [];
  return (
    <AgentActivityShell
      title={agentToolStepVerb(stepKind === "generic" ? "command" : stepKind, activity.status, t)}
      subject={visibleCommand ? <AgentToolStepCode text={visibleCommand} /> : undefined}
      metadata={facts.length ? <span className="desktop-agent-tool-facts">{facts.join(" · ")}</span> : undefined}
      status={activity.status}
      icon={<AgentToolGlyph tool={presentation.tool} status={activity.status} />}
      className={`desktop-agent-command is-${presentation.tool}`}
    >
      {(command || output) && (
        <AgentToolEvidenceTree>
          {command && (
            <AgentToolEvidenceNode kind="command" marker="$">
              <AgentToolTextEvidence text={command} className="desktop-agent-command-line" />
            </AgentToolEvidenceNode>
          )}
          {output && (
            <AgentToolEvidenceNode kind="result">
              <AgentToolTextEvidence text={output} className="desktop-agent-command-output" />
            </AgentToolEvidenceNode>
          )}
        </AgentToolEvidenceTree>
      )}
    </AgentActivityShell>
  );
}
