import { FilePenLine } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import {
  agentActivityToolId, formatAgentToolName, fileChangesForActivity, fileChangeTotals, pathForActivity, outputForActivity,
} from "../../domain/agent-activity-presentation";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { AgentActivityShell } from "./AgentActivityShell";
import { AgentToolEvidenceNode, AgentToolEvidenceTree } from "./AgentToolEvidenceTree";
import { AgentToolTextEvidence } from "./AgentToolTextEvidence";

export function AgentFileChangeActivity({ activity, onOpenFile }: { activity: AgentActivity; onOpenFile?: (path: string) => void }) {
  const { t, formatNumber } = useLocalization();
  const changes = fileChangesForActivity(activity);
  const totals = fileChangeTotals(changes);
  const path = pathForActivity(activity);
  const output = outputForActivity(activity);
  if (!changes.length && !path && !output) return null;
  const files = changes.length ? changes : path ? [{ path, diff: "", truncated: false }] : [];
  return (
    <AgentActivityShell
      title={formatAgentToolName(agentActivityToolId(activity), t)}
      status={activity.status}
      icon={<FilePenLine size={13} />}
      metadata={totals && <span className="desktop-agent-tool-diff-stats" dir="ltr">
        <span className="is-addition">+{formatNumber(totals.additions)}</span>
        <span className="is-deletion">−{formatNumber(totals.deletions)}</span>
      </span>}
      className="desktop-agent-file-change"
    >
      <AgentToolEvidenceTree>
        {files.map((file, index) => (
          <AgentToolEvidenceNode key={`${index}:${file.path}`} kind="result">
            <div className="desktop-agent-tool-file-path" dir="ltr">
              {onOpenFile
                ? <button type="button" data-po-interaction="navigation" title={file.path} onClick={() => onOpenFile(file.path)}>{file.path}</button>
                : <span>{file.path}</span>}
            </div>
            {file.diff && <AgentToolTextEvidence text={file.diff} dir="ltr" />}
            {file.truncated && <span className="desktop-agent-tool-empty">{t("agent.activity.diffPartial")}</span>}
          </AgentToolEvidenceNode>
        ))}
        {output && (
          <AgentToolEvidenceNode kind="result"><AgentToolTextEvidence text={output} dir="ltr" /></AgentToolEvidenceNode>
        )}
      </AgentToolEvidenceTree>
    </AgentActivityShell>
  );
}
