import type { AgentEvent } from "./agent-contract";
import type {
  AgentActivity,
  AgentActivityLabelCode,
  AgentActivityStatus,
  AgentApproval,
  AgentQuestionPrompt,
} from "./agent-projection-types";

const ACTIVITY_STATUS_ALIASES: Readonly<Record<string, AgentActivityStatus>> = Object.freeze({
  queued: "queued",
  running: "running",
  pending: "pending",
  "in-progress": "in-progress",
  in_progress: "in-progress",
  working: "running",
  "waiting-for-user": "waiting-for-user",
  waiting_for_user: "waiting-for-user",
  completed: "completed",
  complete: "completed",
  done: "completed",
  success: "succeeded",
  succeeded: "succeeded",
  failed: "failed",
  failure: "failed",
  error: "failed",
  warning: "warning",
  blocked: "blocked",
  cancelled: "cancelled",
  canceled: "cancelled",
  interrupted: "interrupted",
});

export function normalizeAgentActivityStatus(value: unknown, fallback: AgentActivityStatus = "unknown") {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return fallback;
  return ACTIVITY_STATUS_ALIASES[normalized] ?? "unknown";
}

export function readQuestions(value: unknown): AgentQuestionPrompt[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const question = readString(record.question).slice(0, 2_000);
    if (!question) return [];
    const options = Array.isArray(record.options) ? record.options.slice(0, 20).flatMap((option) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) return [];
      const item = option as Record<string, unknown>;
      const label = readString(item.label).slice(0, 200);
      return label ? [{ label, description: readString(item.description).slice(0, 600) }] : [];
    }) : [];
    return [{
      header: readString(record.header).slice(0, 80),
      question,
      multiple: Boolean(record.multiple),
      custom: record.custom !== false,
      options,
    }];
  });
}

export function pickUsage(payload: Record<string, unknown>) {
  const usage: Record<string, unknown> = {};
  for (const key of ["inputTokens", "outputTokens", "cachedTokens", "cost", "contextWindow", "tokens"]) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) usage[key] = value;
  }
  return usage;
}

export function pickSafeActivityDetail(payload: Record<string, unknown>) {
  const detail: Record<string, unknown> = {};
  for (const key of ["command", "cwd", "delta", "text", "updateMode", "summaryIndex", "status", "kind", "tool", "description", "path", "query", "changes", "steps", "title", "message", "input", "result", "outputPreview", "error", "content", "detail", "metadata", "recoverable", "truncated", "exitCode", "duration", "durationMs", "elapsedMs", "diff", "patch", "outputPaths"]) {
    if (!(key in payload)) continue;
    detail[key] = boundProjectionValue(payload[key]);
  }
  // Older adapters emitted structured tool arguments under `arguments`.
  // Normalize that compatibility shape into the canonical `input` field.
  if (!("input" in detail) && "arguments" in payload) {
    detail.input = boundProjectionValue(payload.arguments);
  }
  return detail;
}

export function activityId(event: AgentEvent) {
  const nativeIdentity = event.itemId ?? event.turnId ?? event.type;
  return event.type === "reasoning.summary.delta"
    ? `activity:${nativeIdentity}:summary:${Number.isSafeInteger(event.payload.summaryIndex) ? event.payload.summaryIndex : 0}`
    : `activity:${nativeIdentity}`;
}

export function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** Makes already-persisted provider errors readable without trusting raw HTML or object shapes. */
export function readProviderMessage(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        const nested = readProviderMessage(JSON.parse(text), depth + 1);
        if (nested) return nested;
      } catch {
        // Preserve non-JSON provider text below.
      }
    }
    return text.slice(0, 32_768);
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return readProviderMessage((record.error as Record<string, unknown> | undefined)?.message, depth + 1)
    || readProviderMessage(record.message, depth + 1)
    || readProviderMessage(record.error, depth + 1);
}

export function nullableString(value: unknown) {
  const text = readString(value);
  return text || null;
}

export function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => (
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
  )).slice(0, 20);
}

export function readNetworkApprovalContext(value: unknown): AgentApproval["networkApprovalContext"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const host = readString(record.host).trim();
  const protocol = readString(record.protocol).trim();
  return host && protocol ? { host, protocol } : null;
}

export function defaultToolLabelCode(kind: AgentActivity["kind"]): AgentActivityLabelCode {
  if (kind === "command") return "command";
  if (kind === "file-change") return "file-changes";
  return "tool-activity";
}

export function fileChangeLabelCode(_payload: Record<string, unknown>): AgentActivityLabelCode {
  return "file-changes";
}

export function readApprovalDecisions(value: unknown): AgentApproval["availableDecisions"] {
  if (!Array.isArray(value)) return ["accept", "decline", "cancel"];
  const decisions = value.filter((entry): entry is AgentApproval["availableDecisions"][number] => (
    entry === "accept" || entry === "acceptForSession" || entry === "decline" || entry === "cancel"
  ));
  return decisions.length > 0 ? decisions : ["accept", "decline", "cancel"];
}

function boundProjectionValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return value.slice(0, 64 * 1024);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => boundProjectionValue(entry, depth + 1));
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([key, entry]) => [
    key.slice(0, 100),
    boundProjectionValue(entry, depth + 1),
  ]));
}
