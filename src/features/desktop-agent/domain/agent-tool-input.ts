import type { AgentActivity } from "./agent-projection-types";

/** Provider arguments may be structured or a completed JSON string. Do not
 * guess at partial JSON or evaluate code; leave the original event untouched. */
export function inputForActivity(activity: AgentActivity): Record<string, unknown> {
  return inputRecord(activity.detail.input ?? activity.detail.arguments);
}

function inputRecord(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 2) return {};
  if (typeof value === "string") {
    if (value.length > 64 * 1024) return {};
    try { return inputRecord(JSON.parse(value), depth + 1); } catch { return {}; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  // ACP preserves non-object rawInput in a single value field.
  if (Object.keys(input).length === 1 && typeof input.value === "string") return inputRecord(input.value, depth + 1);
  return input;
}

export function purposeForActivity(activity: AgentActivity) {
  const input = inputForActivity(activity);
  return firstSummary(input.title, input.description, activity.detail.description);
}

export function genericToolSummary(activity: AgentActivity) {
  const input = inputForActivity(activity);
  return purposeForActivity(activity) || firstSummary(
    input.objective, input.task, input.task_name, input.question,
    input.command, input.cmd, input.queries, input.query, activity.detail.query,
    input.pattern, input.url, input.uri, activity.detail.url,
    input.file_path, input.path, activity.detail.path, input.target, input.action,
  );
}

export function informativeToolLabel(activity: AgentActivity) {
  const label = activity.label?.trim() ?? "";
  return /^(?:tool|mcp(?::\s*tool)?|command|bash|shell|run command|tool activity)$/iu.test(label) ? "" : label;
}

function firstSummary(...values: unknown[]) {
  for (const value of values) {
    const text = Array.isArray(value) && value.every(entry => typeof entry === "string")
      ? value.slice(0, 8).join(", ") : value;
    if (typeof text === "string" && text.trim()) return text.slice(0, 512).replace(/\s+/gu, " ").trim();
  }
  return "";
}
