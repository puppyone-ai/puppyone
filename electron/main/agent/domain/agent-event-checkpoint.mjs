import {
  agentEventContentUpdate,
  applyAgentEventContentUpdate,
} from "../../../../shared/agent-contract/event-content-update.mjs";

const MAX_CHECKPOINT_EVENTS_PER_TURN = 512;
const MAX_ASSISTANT_TEXT = 128 * 1024;
const MAX_ACTIVITY_TEXT = 64 * 1024;
const TRUNCATION_MARKER = "\n… earlier output truncated …\n";

const CHECKPOINT_TYPES = new Set([
  "turn.started",
  "assistant.delta", "assistant.completed", "reasoning.summary.delta", "plan.updated",
  "tool.started", "tool.progress", "tool.completed", "command.output.delta",
  "file.change.updated", "usage.updated", "approval.requested", "approval.resolved",
  "question.requested", "question.resolved", "provider.activity", "provider.warning", "provider.error",
]);

/**
 * Materializes the evicted prefix of a turn into bounded canonical events.
 * This keeps an in-flight response reconstructable without retaining every
 * token delta or pretending the bounded timeline is complete history.
 */
export function foldAgentEventCheckpoint(previous, event) {
  if (!event?.turnId || !CHECKPOINT_TYPES.has(event.type)) return previous;
  const events = previous.map(clonePlain);
  if (!materializeObjectTextUpdate(events, event)) {
    const last = events.at(-1);
    const merged = mergeAdjacentTextDelta(last, event);
    if (merged) events[events.length - 1] = merged;
    else events.push(clonePlain(event));
  }
  if (events.length <= MAX_CHECKPOINT_EVENTS_PER_TURN) return events;

  const started = events.find((entry) => entry.type === "turn.started") ?? null;
  const material = events.filter((entry) => entry.itemId !== `checkpoint-truncated:${event.turnId}` && entry !== started);
  const retained = material.slice(-(MAX_CHECKPOINT_EVENTS_PER_TURN - (started ? 2 : 1)));
  const warning = checkpointWarning(event, events[0]?.sequence ?? event.sequence);
  return [...(started ? [started] : []), warning, ...retained];
}

/**
 * Reasoning summaries and plans are mutable logical objects, not neighboring
 * log lines. Collapse every checkpoint fragment for that object so a later
 * replace invalidates older text even when unrelated events interleaved it.
 */
function materializeObjectTextUpdate(events, event) {
  if (event.type !== "reasoning.summary.delta" && event.type !== "plan.updated") return false;
  const identity = checkpointIdentity(event);
  const matchingIndexes = events.flatMap((candidate, index) => (
    candidate.type === event.type
      && candidate.turnId === event.turnId
      && checkpointIdentity(candidate) === identity
      ? [index]
      : []
  ));
  if (matchingIndexes.length === 0) return false;
  const firstIndex = matchingIndexes[0];
  const first = events[firstIndex];
  let text = "";
  let truncated = false;
  let payload = {};
  for (const candidate of [...matchingIndexes.map((index) => events[index]), event]) {
    const mutation = applyAgentEventContentUpdate(text, candidate, MAX_ACTIVITY_TEXT);
    if (!mutation) continue;
    text = mutation.text;
    truncated = mutation.mode === "replace" ? mutation.truncated : truncated || mutation.truncated;
    payload = { ...payload, ...clonePlain(candidate.payload), [mutation.field]: text, updateMode: "replace" };
  }
  if (truncated) payload.truncated = true;
  else delete payload.truncated;
  const materialized = {
    ...clonePlain(event),
    sequence: first.sequence,
    emittedAt: first.emittedAt,
    payload,
  };
  for (const index of [...matchingIndexes].reverse()) events.splice(index, 1);
  events.splice(firstIndex, 0, materialized);
  return true;
}

function mergeAdjacentTextDelta(previous, event) {
  if (!previous || previous.type !== event.type || previous.turnId !== event.turnId || checkpointIdentity(previous) !== checkpointIdentity(event)) {
    return null;
  }
  const update = agentEventContentUpdate(event);
  if (!update) return null;
  const { field, mode } = update;
  const limit = event.type === "assistant.delta" ? MAX_ASSISTANT_TEXT : MAX_ACTIVITY_TEXT;
  const current = typeof previous.payload?.[field] === "string" ? previous.payload[field] : "";
  const incoming = typeof event.payload?.[field] === "string" ? event.payload[field] : "";
  const combined = mode === "replace" ? incoming : `${current}${incoming}`;
  const wasTruncated = mode === "append" && previous.payload?.truncated === true;
  const truncated = wasTruncated || combined.length > limit;
  const text = event.type === "command.output.delta"
    ? truncated ? `${TRUNCATION_MARKER}${combined.slice(-(limit - TRUNCATION_MARKER.length))}` : combined
    : wasTruncated ? current : combined.length > limit
      ? `${combined.slice(0, limit - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
      : combined;
  const payload = {
    ...clonePlain(previous.payload),
    ...clonePlain(event.payload),
    [field]: text,
  };
  if (truncated) payload.truncated = true;
  else delete payload.truncated;
  return {
    ...clonePlain(event),
    payload,
  };
}

function checkpointIdentity(event) {
  if (event.type === "reasoning.summary.delta") {
    return `${event.itemId ?? event.turnId}:${event.payload?.summaryIndex ?? 0}`;
  }
  if (event.type === "plan.updated") return event.itemId ?? "current-plan";
  return event.itemId ?? event.turnId;
}

function checkpointWarning(event, firstDroppedSequence) {
  return {
    ...clonePlain(event),
    sequence: Math.max(firstDroppedSequence, event.sequence - MAX_CHECKPOINT_EVENTS_PER_TURN),
    itemId: `checkpoint-truncated:${event.turnId}`,
    type: "provider.warning",
    payload: {
      message: "Part of this unusually large live turn is outside the in-memory display window.",
      recoverable: true,
      diagnostic: "live-turn-checkpoint-truncated",
    },
  };
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clonePlain(entry)]));
}

export const agentEventCheckpointLimits = Object.freeze({
  maxEventsPerTurn: MAX_CHECKPOINT_EVENTS_PER_TURN,
  maxAssistantText: MAX_ASSISTANT_TEXT,
  maxActivityText: MAX_ACTIVITY_TEXT,
});
