import { Fragment } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  agentActivityToolId, formatAgentToolName, fileChangesForActivity, fileChangeTotals, pathForActivity, outputForActivity,
} from "../../domain/agent-activity-presentation";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { AgentActivityShell } from "./AgentActivityShell";
import { AgentToolGlyph } from "./AgentToolGlyph";
import { AgentToolEvidenceNode, AgentToolEvidenceTree } from "./AgentToolEvidenceTree";
import { AgentToolTextEvidence } from "./AgentToolTextEvidence";

export function AgentFileChangeActivity({ activity, onOpenFile }: { activity: AgentActivity; onOpenFile?: (path: string) => void }) {
  const { t, formatNumber } = useLocalization();
  const changes = fileChangesForActivity(activity);
  const tool = agentActivityToolId(activity);
  const totals = fileChangeTotals(changes);
  const path = pathForActivity(activity);
  const output = outputForActivity(activity);
  if (!changes.length && !path && !output) return null;
  const files = changes.length ? changes : path ? [{ path, diff: "", blocks: [], truncated: false }] : [];
  return (
    <AgentActivityShell
      title={formatAgentToolName(tool, t)}
      status={activity.status}
      icon={<AgentToolGlyph tool={tool} status={activity.status} />}
      metadata={totals && <span className="desktop-agent-tool-diff-stats" dir="ltr">
        <span className="is-addition">+{formatNumber(totals.additions)}</span>
        <span className="is-deletion">−{formatNumber(totals.deletions)}</span>
      </span>}
      className="desktop-agent-file-change"
    >
      <AgentToolEvidenceTree>
        {files.map((file, index) => (
          <Fragment key={`${index}:${file.path}`}>
            <AgentToolEvidenceNode kind="result">
              <div className="desktop-agent-tool-file-path" dir="ltr">
                {onOpenFile
                  ? <button type="button" data-po-interaction="navigation" title={file.path} onClick={() => onOpenFile(file.path)}>{file.path}</button>
                  : <span>{file.path}</span>}
              </div>
            </AgentToolEvidenceNode>
            {file.blocks.map((block, blockIndex) => (
              <Fragment key={blockIndex}>
                {block.removed !== undefined && <AgentToolEvidenceNode kind="result" marker="−" tone="deletion" label={t("agent.activity.removedLines")}>
                  <AgentToolTextEvidence text={block.removed} dir="ltr" />
                </AgentToolEvidenceNode>}
                {block.added !== undefined && <AgentToolEvidenceNode kind="result" marker="+" tone="addition" label={t("agent.activity.addedLines")}>
                  <AgentToolTextEvidence text={block.added} dir="ltr" />
                </AgentToolEvidenceNode>}
              </Fragment>
            ))}
            {!file.blocks.length && file.diff && <AgentToolEvidenceNode kind="result">
              <AgentToolTextEvidence text={file.diff} dir="ltr" />
            </AgentToolEvidenceNode>}
            {file.truncated && <AgentToolEvidenceNode kind="result">
              <span className="desktop-agent-tool-empty">{t("agent.activity.diffPartial")}</span>
            </AgentToolEvidenceNode>}
          </Fragment>
        ))}
        {output && (
          <AgentToolEvidenceNode kind="result"><AgentToolTextEvidence text={output} dir="ltr" /></AgentToolEvidenceNode>
        )}
      </AgentToolEvidenceTree>
    </AgentActivityShell>
  );
}
