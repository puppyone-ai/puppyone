import { useLocalization } from "@puppyone/localization/react";
import {
  commandForActivity,
  commandPresentationForActivity,
  formatAgentToolName,
  outputForActivity,
} from "../../domain/agent-activity-presentation";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { AgentActivityShell } from "./AgentActivityShell";
import { AgentToolGlyph } from "./AgentToolGlyph";
import { AgentToolEvidenceNode, AgentToolEvidenceTree } from "./AgentToolEvidenceTree";
import { AgentToolTextEvidence } from "./AgentToolTextEvidence";

export function AgentCommandActivity({ activity }: { activity: AgentActivity }) {
  const { t } = useLocalization();
  const command = commandForActivity(activity);
  const output = outputForActivity(activity);
  const presentation = commandPresentationForActivity(activity);
  return (
    <AgentActivityShell
      title={formatAgentToolName(presentation.tool, t)}
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
