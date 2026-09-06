import type { AgentEvent } from "./agent-contract";
import type { AgentProjection } from "./agent-projection-types";

type LegacyProviderConnectionUpdate = {
  state: "reconnecting" | "fallback";
  attempt: number | null;
  maxAttempts: number | null;
};

/** Correlates retry warnings and terminal failures without merging separate turns. */
export function providerActivityIdentity(projection: AgentProjection, event: AgentEvent, label: string) {
  const turnId = correlatedProviderTurnId(projection, event);
  const fingerprint = providerMessageFingerprint(label);
  const firstCandidate = Math.max(0, projection.activities.length - 64);
  for (let index = projection.activities.length - 1; index >= firstCandidate; index -= 1) {
    const activity = projection.activities[index];
    if ((activity.kind !== "warning" && activity.kind !== "error")
      || providerMessageFingerprint(activity.label) !== fingerprint) continue;
    if (turnId && activity.turnId && activity.turnId !== turnId) continue;
    if ((!turnId || !activity.turnId) && event.sequence - activity.sequence > 16) continue;
    return { id: activity.id, turnId: turnId ?? activity.turnId };
  }
  return {
    id: providerNoticeId(turnId ?? event.itemId ?? "session", fingerprint),
    turnId,
  };
}

/** Hides persisted lifecycle-only notices emitted by older adapters. */
export function isNonDiagnosticProviderStatusMessage(value: string) {
  return /\bthread entered a system error state\.?$/i.test(value.trim());
}

/**
 * Replay migration for events produced before `provider.connection.updated`
 * existed. New adapters must emit the structured event; UI code must never
 * repeat these provider-specific heuristics.
 */
export function legacyProviderConnectionUpdate(event: AgentEvent, label: string): LegacyProviderConnectionUpdate | null {
  if (event.type !== "provider.warning") return null;
  const fraction = retryFraction(label);
  const attempt = positiveInteger(event.payload.attempt) ?? fraction?.attempt ?? null;
  const maxAttempts = positiveInteger(event.payload.maxAttempts)
    ?? positiveInteger(event.payload.maxRetries)
    ?? fraction?.maxAttempts
    ?? null;
  // `recoverable` describes diagnostic severity, not transport state. Only a
  // legacy retry-shaped notice may be migrated, and callers additionally gate
  // this helper to snapshot hydration rather than the live event path.
  if (/\breconnect(?:ing|ion)?\b/i.test(label) && (attempt !== null || fraction !== null)) {
    return { state: "reconnecting", attempt, maxAttempts };
  }
  if (/\bfalling back\b.*\btransport\b/i.test(label)) {
    return { state: "fallback", attempt: null, maxAttempts: null };
  }
  return null;
}

function correlatedProviderTurnId(projection: AgentProjection, event: AgentEvent) {
  if (event.turnId) return event.turnId;
  if (projection.runningTurnId) return projection.runningTurnId;
  const recentTurn = projection.turns.at(-1);
  if (recentTurn?.completedAtSequence !== null
    && recentTurn?.completedAtSequence !== undefined
    && event.sequence - recentTurn.completedAtSequence <= 16) return recentTurn.id;
  return null;
}

function providerMessageFingerprint(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 2_048);
}

function providerNoticeId(scope: string, fingerprint: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash = Math.imul(hash ^ fingerprint.charCodeAt(index), 16_777_619);
  }
  return `provider-notice:${scope}:${(hash >>> 0).toString(36)}`;
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function retryFraction(value: string) {
  const match = value.match(/\b(\d+)\s*\/\s*(\d+)\b/);
  if (!match) return null;
  const attempt = Number(match[1]);
  const maxAttempts = Number(match[2]);
  if (!Number.isSafeInteger(attempt) || !Number.isSafeInteger(maxAttempts) || attempt <= 0 || maxAttempts <= 0) return null;
  return { attempt, maxAttempts };
}
