import { isAgentTranscriptActivity } from "../../../../../shared/agent-contract/activity-semantics.mjs";
import { normalizeAgentActivityStatus, readString } from "./content-readers.mjs";
import { invalidateProjectionIndexes } from "./transcript-indexes.mjs";

export { isAgentTranscriptActivity as isTranscriptActivity };
export const MAX_PROVIDER_ACTIVITIES = 32;

/** Normalize native status and extension notices once, before display projection. */
export function classifyProviderActivity(event) {
  const payload = event.payload;
  const legacyNotice = event.type === "provider.activity" && /:extension:/u.test(event.itemId ?? "");
  if (event.type === "provider.notification" || legacyNotice) {
    const severity = ["warning", "error"].includes(payload.severity) ? payload.severity : "info";
    return {
      kind: "notification",
      label: readString(payload.message || payload.label).slice(0, 4_000),
      status: { error: "failed", warning: "warning", info: "completed" }[severity],
      detail: { message: readString(payload.message).slice(0, 4_000), severity, source: readString(payload.source || payload.label).slice(0, 200) },
    };
  }
  // Compatibility belongs here, never in a provider-specific React component.
  const category = payload.category ?? ((event.itemId ?? "").endsWith(":compaction") ? "compaction" : "status");
  return {
    kind: "system",
    label: readString(payload.message || payload.label).slice(0, 4_000),
    labelCode: "agent-activity",
    status: normalizeAgentActivityStatus(payload.status),
    detail: { ...payload, category },
  };
}

/** Bounded live metadata shares the existing snapshot/patch transport, not history. */
export function pruneProviderActivities(projection, event) {
  if (event.type !== "provider.notification" && event.type !== "provider.activity") return;
  const auxiliary = projection.activities.filter(activity => !isAgentTranscriptActivity(activity))
    .sort((left, right) => (left.updatedSequence ?? left.sequence) - (right.updatedSequence ?? right.sequence));
  if (auxiliary.length <= MAX_PROVIDER_ACTIVITIES) return;
  const removed = new Set(auxiliary.slice(0, -MAX_PROVIDER_ACTIVITIES).map(activity => activity.id));
  projection.activities = projection.activities.filter(activity => !removed.has(activity.id));
  projection.parts = projection.parts.filter(part => !removed.has(part.id));
  invalidateProjectionIndexes(projection);
}

/** Older Codex journals described native compaction as a system-shaped tool. */
export function normalizeLegacyProviderActivity(event) {
  if (event.type.startsWith("tool.") && event.payload.kind === "system" && event.payload.tool === "compaction") {
    return { ...event, type: "provider.activity", payload: { ...event.payload, category: "compaction" } };
  }
  return event;
}
