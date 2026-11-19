import { useLocalization } from "@puppyone/localization/react";
import type { ReactNode } from "react";
import type { MessageFormatter } from "@puppyone/localization/core";
import {
  agentActivitySummary,
  agentActivityToolId,
  outputForActivity,
  pathForActivity,
} from "../../domain/agent-activity-presentation";
import { collectAgentToolResultLines } from "../../domain/agent-tool-evidence";
import type { AgentActivity } from "../../domain/agent-projection-types";
import { AgentActivityShell } from "./AgentActivityShell";
import { AgentToolGlyph } from "./AgentToolGlyph";
import { AgentToolEvidenceNode, AgentToolEvidenceTree } from "./AgentToolEvidenceTree";
import { AgentToolStepCode, AgentToolStepPath, AgentToolStepText, agentToolStepVerb } from "./AgentToolStepText";
import { AgentToolTextEvidence } from "./AgentToolTextEvidence";
import { agentToolStepKind, isActiveToolStatus } from "./agent-tool-steps";

const NO_RESULTS = /^no (?:matches|files|results)(?: found)?\.?$/iu;

export function AgentFileQueryActivity({ activity, onOpenFile }: { activity: AgentActivity; onOpenFile?: (path: string) => void }) {
  const { t, formatNumber } = useLocalization();
  const tool = agentActivityToolId(activity);
  const output = outputForActivity(activity);
  const results = collectAgentToolResultLines(output);
  const searchable = ["grep", "glob", "search", "list"].includes(tool);
  const stepKind = agentToolStepKind(activity);
  // Line counts are only meaningful for local match listings, not web search prose.
  const countable = (tool === "grep" || tool === "glob") && !isActiveToolStatus(activity.status) && Boolean(output);
  const resultCount = countable ? countedResults(output, results.totalLines) : null;
  return (
    <AgentActivityShell
      title={agentToolStepVerb(stepKind === "generic" ? "search" : stepKind, activity.status, t)}
      subject={fileQuerySubject(activity, stepKind, t)}
      metadata={resultCount === null ? undefined : (
        <span className="desktop-agent-tool-facts">
          {resultCount === 0
            ? t("agent.activity.noResults")
            : t("agent.toolStep.results", { count: resultCount, value: formatNumber(resultCount) })}
        </span>
      )}
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

function fileQuerySubject(activity: AgentActivity, stepKind: string, t: MessageFormatter): ReactNode {
  const input = activity.detail.input && typeof activity.detail.input === "object" && !Array.isArray(activity.detail.input)
    ? activity.detail.input as Record<string, unknown>
    : {};
  if (stepKind === "search") {
    const pattern = firstText(input.pattern, activity.detail.query, input.query, input.glob);
    const scope = firstText(input.path, activity.detail.path);
    if (pattern) return <AgentToolStepCode text={pattern} context={scope ? t("agent.toolStep.searchScope", { path: scope }) : undefined} />;
  }
  const path = pathForActivity(activity);
  if (path) return <AgentToolStepPath path={path} />;
  const summary = agentActivitySummary(activity);
  return summary ? <AgentToolStepText text={summary} /> : undefined;
}

function countedResults(output: string, lines: number) {
  return NO_RESULTS.test(output.trim()) ? 0 : lines;
}

function firstText(...values: unknown[]) {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function SearchResults({ results, onOpenFile }: { results: ReturnType<typeof collectAgentToolResultLines>; onOpenFile?: (path: string) => void }) {
  const { t, formatNumber } = useLocalization();
  return (
    <div className="desktop-agent-search-results" data-po-scrollbar="content" dir="ltr" data-source-lines={results.totalLines}>
      {results.lines.length === 0 && <span className="desktop-agent-tool-empty">{t("agent.activity.noResults")}</span>}
      {results.lines.map((line, index) => {
        const path = resultPath(line);
        return path && onOpenFile
          ? <button key={`${index}:${line}`} type="button" data-po-interaction="navigation" onClick={() => onOpenFile(path)}>{line}</button>
          : <span key={`${index}:${line}`}>{line}</span>;
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
