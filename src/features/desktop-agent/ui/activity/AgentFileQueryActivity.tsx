import { useLocalization } from "@puppyone/localization/react";
import {
  agentActivityToolId,
  formatAgentToolName,
  outputForActivity,
} from "../../domain/agent-activity-presentation";
import { collectAgentToolResultLines } from "../../domain/agent-tool-evidence";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { AgentActivityShell } from "./AgentActivityShell";
import { AgentToolGlyph } from "./AgentToolGlyph";
import { AgentToolEvidenceNode, AgentToolEvidenceTree } from "./AgentToolEvidenceTree";
import { AgentToolTextEvidence } from "./AgentToolTextEvidence";

export function AgentFileQueryActivity({ activity, onOpenFile }: { activity: AgentActivity; onOpenFile?: (path: string) => void }) {
  const { t } = useLocalization();
  const tool = agentActivityToolId(activity);
  const output = outputForActivity(activity);
  const results = collectAgentToolResultLines(output);
  const searchable = ["grep", "glob", "search", "list"].includes(tool);
  return (
    <AgentActivityShell
      title={formatAgentToolName(tool, t)}
      status={activity.status}
      icon={<AgentToolGlyph tool={tool} status={activity.status} />}
      className={`desktop-agent-file-query is-${tool}`}
    >
      {output && (
        <AgentToolEvidenceTree>
          <AgentToolEvidenceNode kind="result">
            {searchable
              ? <SearchResults results={results} onOpenFile={onOpenFile} />
              : <AgentToolTextEvidence text={output} dir="ltr" />}
          </AgentToolEvidenceNode>
        </AgentToolEvidenceTree>
      )}
    </AgentActivityShell>
  );
}

function SearchResults({ results, onOpenFile }: { results: ReturnType<typeof collectAgentToolResultLines>; onOpenFile?: (path: string) => void }) {
  const { t, formatNumber } = useLocalization();
  return (
    <div className="desktop-agent-search-results" data-po-scrollbar="content" dir="ltr" data-source-lines={results.totalLines}>
      {results.lines.length === 0 && <span className="desktop-agent-tool-empty">{t("agent.activity.noResults")}</span>}
      {results.lines.map((line, index) => {
        const path = resultPath(line);
        return path && onOpenFile
          ? <button type="button" data-po-interaction="navigation" key={`${index}:${line}`} title={line} onClick={() => onOpenFile(path)}>{line}</button>
          : <span key={`${index}:${line}`} title={line}>{line}</span>;
      })}
      {results.omittedLines > 0 && <small>{t("agent.activity.moreResults", { count: results.omittedLines, value: formatNumber(results.omittedLines) })}</small>}
    </div>
  );
}

function resultPath(line: string) {
  const numbered = line.match(/^(.+?):\d+(?::\d+)?:/u)?.[1];
  if (numbered) return numbered;
  const plain = line.trim();
  return plain && !plain.includes("\0") && !/^https?:\/\//iu.test(plain) ? plain : "";
}
