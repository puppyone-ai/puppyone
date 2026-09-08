import type { AgentActivity } from "./agent-projection-types";
import type { LocaleFormatters, MessageFormatter } from "@puppyone/localization/core";
import { stringifyAgentToolInput } from "./agent-tool-evidence";

export type AgentFileChangeSummary = {
  path: string;
  additions: number | null;
  deletions: number | null;
  diff: string;
  blocks: { removed?: string; added?: string }[];
  truncated: boolean;
};

export type AgentActivityToolId = "bash" | "read" | "write" | "edit" | "glob" | "grep" | "search" | "list" | "fetch" | "thinking" | "plan" | "tool" | string;

export function agentActivityToolId(activity: AgentActivity): AgentActivityToolId {
  const tool = text(activity.detail.tool || activity.kind).toLowerCase();
  const known: Record<string, AgentActivityToolId> = {
    bash: "bash",
    shell: "bash",
    command: "bash",
    read: "read",
    write: "write",
    edit: "edit",
    apply_patch: "edit",
    patch: "edit",
    glob: "glob",
    grep: "grep",
    search: "search",
    list: "list",
    webfetch: "fetch",
    websearch: "search",
    reasoning: "thinking",
    plan: "plan",
    "file-change": "edit",
  };
  return known[tool] || tool || "tool";
}

/** Legacy English presentation retained for domain-classification tests. Product UI uses formatAgentToolName. */
export function agentActivityToolName(activity: AgentActivity) {
  const id = agentActivityToolId(activity);
  const known: Record<string, string> = {
    bash: "Bash", read: "Read", write: "Write", edit: "Edit", glob: "Glob",
    grep: "Grep", search: "Search", list: "List", fetch: "Fetch", thinking: "Thinking", plan: "Plan", tool: "Tool",
  };
  return known[id] || titleCase(id);
}

export function formatAgentToolName(tool: AgentActivityToolId, t: MessageFormatter) {
  const known = new Set(["bash", "read", "write", "edit", "glob", "grep", "search", "list", "fetch", "thinking", "plan", "tool"]);
  return known.has(tool) ? t(`agent.tool.${tool}`) : titleCase(tool);
}

export function formatAgentActivityLabel(activity: AgentActivity, t: MessageFormatter) {
  if (activity.label) return activity.label;
  if (activity.labelCode === "file-changes") {
    const count = Array.isArray(activity.detail.changes) ? activity.detail.changes.length : 0;
    return t("agent.activity.fileChanges", { count });
  }
  return t(`agent.activity.${activity.labelCode ?? "tool-activity"}`);
}

export function agentActivitySummary(activity: AgentActivity) {
  if (activity.kind === "command") return commandForActivity(activity) || activity.label;
  if (activity.kind === "file-change") return pathForActivity(activity) || activity.label;
  const input = record(activity.detail.input);
  const tool = agentActivityToolId(activity);
  if (["grep", "glob", "search"].includes(tool)) {
    return firstText(input.pattern, activity.detail.query, input.query, activity.detail.path, input.path, activity.label);
  }
  return firstText(
    activity.detail.description,
    activity.detail.path,
    input.path,
    input.file,
    input.file_path,
    input.filePath,
    activity.detail.query,
    input.query,
    input.pattern,
    activity.label,
  );
}

export function isContextCompactionActivity(activity: AgentActivity) {
  const input = record(activity.detail.input);
  const values = [
    activity.detail.tool,
    activity.detail.kind,
    activity.detail.description,
    input.action,
    activity.label,
  ].map(text).filter(Boolean);
  return values.some((value) => /^(?:compaction|context-compaction)$/u.test(value.toLowerCase())
    || /(?:compact(?:ed|ing|ion)?\s+(?:the\s+)?context|context\s+compact)/iu.test(value));
}

export function commandForActivity(activity: AgentActivity) {
  const input = record(activity.detail.input);
  const metadata = record(activity.detail.metadata);
  return firstText(activity.detail.command, input.command, input.cmd, metadata.command, typeof activity.detail.input === "string" ? activity.detail.input : "");
}

export type AgentCommandPresentation = {
  tool: "bash" | "read" | "grep" | "glob" | "list";
  title: "Bash" | "Read" | "Grep" | "Glob" | "List";
  summary: string;
  viaShell: boolean;
};

export function commandPresentationForActivity(activity: AgentActivity): AgentCommandPresentation {
  const command = commandForActivity(activity);
  const visibleCommand = unwrapLoginShell(command);
  const executable = readShellExecutable(visibleCommand);
  const simpleReadOnlyShell = !/[;&|<>`\n\r]/u.test(visibleCommand) && !/\$\(/u.test(visibleCommand);
  if (!simpleReadOnlyShell) {
    return { tool: "bash", title: "Bash", summary: command || activity.label, viaShell: false };
  }
  if (executable === "rg") {
    if (/(?:^|\s)--pre(?:-glob)?(?:\s|=|$)/u.test(visibleCommand)) {
      return { tool: "bash", title: "Bash", summary: command || activity.label, viaShell: false };
    }
    const filesOnly = /(?:^|\s)--files(?:\s|$)/u.test(visibleCommand);
    return { tool: filesOnly ? "glob" : "grep", title: filesOnly ? "Glob" : "Grep", summary: visibleCommand, viaShell: true };
  }
  if (executable === "grep" || executable === "git-grep") {
    return { tool: "grep", title: "Grep", summary: visibleCommand, viaShell: true };
  }
  if (executable === "find" || executable === "fd") {
    if (executable === "find" && /(?:^|\s)-(?:delete|exec|execdir|ok|okdir|fprint|fprintf|fls)(?:\s|$)/u.test(visibleCommand)) {
      return { tool: "bash", title: "Bash", summary: command || activity.label, viaShell: false };
    }
    return { tool: "glob", title: "Glob", summary: visibleCommand, viaShell: true };
  }
  if (executable === "ls") {
    return { tool: "list", title: "List", summary: visibleCommand, viaShell: true };
  }
  if (["cat", "head", "tail", "bat", "sed-read", "nl-read"].includes(executable)) {
    return { tool: "read", title: "Read", summary: visibleCommand, viaShell: true };
  }
  return { tool: "bash", title: "Bash", summary: command || activity.label, viaShell: false };
}

export function pathForActivity(activity: AgentActivity) {
  const input = record(activity.detail.input);
  const firstChange = fileChangesForActivity(activity)[0];
  return firstText(activity.detail.path, input.path, input.file, input.filepath, input.file_path, input.filePath, firstChange?.path);
}

export function outputForActivity(activity: AgentActivity) {
  return firstText(
    activity.output,
    activity.detail.outputPreview,
    canonicalToolResultText(activity.detail.result),
    activity.detail.content,
    activity.detail.error,
    typeof activity.detail.detail === "string" ? activity.detail.detail : "",
  );
}

function canonicalToolResultText(value: unknown) {
  const result = record(value);
  const content = Array.isArray(result.content) ? result.content : [];
  const rendered = content.slice(0, 100).flatMap((entry) => {
    const item = record(entry);
    if (item.type === "text") return [text(item.text)];
    if (item.type === "artifact") return [firstText(item.text, item.uri)];
    if (item.type === "json" && item.value !== undefined) {
      try {
        return [JSON.stringify(item.value, null, 2)];
      } catch {
        return [];
      }
    }
    return [];
  }).filter(Boolean).join("\n");
  return firstText(rendered, result.error);
}

export function commandMetadata(activity: AgentActivity) {
  const metadata = record(activity.detail.metadata);
  const exitCode = finiteNumber(activity.detail.exitCode, metadata.exitCode, metadata.exit, metadata.code);
  const durationMs = finiteNumber(activity.detail.duration, activity.detail.durationMs, activity.detail.elapsedMs, metadata.duration, metadata.durationMs, metadata.elapsed);
  return {
    exitCode,
    durationMs,
  };
}

export function formatAgentDuration(
  value: number,
  t: MessageFormatter,
  formatNumber: LocaleFormatters["formatNumber"],
) {
  const bounded = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (bounded < 1_000) return t("agent.duration.lessThanSecond");
  let seconds = Math.max(1, Math.round(bounded / 1_000));
  const days = Math.floor(seconds / 86_400);
  seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds %= 3_600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  return [
    days ? t("agent.duration.days", { value: formatNumber(days) }) : "",
    hours ? t("agent.duration.hours", { value: formatNumber(hours) }) : "",
    minutes ? t("agent.duration.minutes", { value: formatNumber(minutes) }) : "",
    seconds || (!days && !hours && !minutes)
      ? t("agent.duration.seconds", { value: formatNumber(seconds) })
      : "",
  ].filter(Boolean).join(" ");
}

export function fileChangesForActivity(activity: AgentActivity): AgentFileChangeSummary[] {
  if (!Array.isArray(activity.detail.changes)) return [];
  return activity.detail.changes.slice(0, 100).flatMap((entry) => {
    const value = record(entry);
    const path = firstText(value.path, value.file, value.filepath);
    if (!path) return [];
    return [{
      path: path.slice(0, 4_096),
      additions: typeof value.additions === "number" && Number.isFinite(value.additions) ? boundedCount(value.additions) : null,
      deletions: typeof value.deletions === "number" && Number.isFinite(value.deletions) ? boundedCount(value.deletions) : null,
      diff: typeof value.diff === "string" ? value.diff : "",
      blocks: Array.isArray(value.blocks) ? value.blocks.slice(0, 100).flatMap(block => {
        const item = record(block);
        return typeof item.removed === "string" || typeof item.added === "string" ? [{
          ...(typeof item.removed === "string" ? { removed: item.removed } : {}),
          ...(typeof item.added === "string" ? { added: item.added } : {}),
        }] : [];
      }) : [],
      truncated: value.truncated === true,
    }];
  });
}

export function fileChangeTotals(changes: AgentFileChangeSummary[]) {
  if (!changes.length || changes.some(change => change.additions === null || change.deletions === null)) return null;
  return changes.reduce((totals, change) => ({
    additions: totals.additions + (change.additions ?? 0),
    deletions: totals.deletions + (change.deletions ?? 0),
  }), { additions: 0, deletions: 0 });
}

export function structuredInputForActivity(activity: AgentActivity) {
  const input = activity.detail.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const visible = Object.fromEntries(Object.entries(input as Record<string, unknown>)
    .filter(([key]) => !["command", "cmd", "patch", "diff", "content"].includes(key))
    .slice(0, 20));
  return stringifyAgentToolInput(visible);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 64 * 1024);
  }
  return "";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(...values: unknown[]) {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function boundedCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1_000_000, Math.trunc(value))) : 0;
}

function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function unwrapLoginShell(command: string) {
  const match = command.trim().match(/^(?:\/[^\s]+\/)?(?:zsh|bash|sh)\s+-lc\s+(["'])([\s\S]*)\1$/u);
  return (match?.[2] || command).trim();
}

function readShellExecutable(command: string) {
  const source = command.trim();
  if (!source) return "";
  if (/^(?:command\s+)?git\s+grep(?:\s|$)/u.test(source)) return "git-grep";
  const match = source.match(/^(?:command\s+)?(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*(?:\/[^\s]+\/)?([A-Za-z0-9._+-]+)(?:\s|$)/u);
  const executable = match?.[1]?.toLowerCase() || "";
  if (executable === "sed" && /(?:^|\s)-n(?:\s|$)/u.test(source)) return "sed-read";
  if (executable === "nl" && /(?:^|\s)-ba(?:\s|$)/u.test(source)) return "nl-read";
  return executable;
}
