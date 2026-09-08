const MAX_TURN_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
export function parseAgentEventTime(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}
export function readAgentTurnDurationMs(value, startedAtMs, emittedAt) {
    const nativeDuration = typeof value === "number" ? value : NaN;
    if (Number.isFinite(nativeDuration) && nativeDuration >= 0) {
        return Math.min(MAX_TURN_DURATION_MS, Math.round(nativeDuration));
    }
    const completedAtMs = parseAgentEventTime(emittedAt);
    if (startedAtMs === null || completedAtMs === null || completedAtMs < startedAtMs)
        return null;
    return Math.min(MAX_TURN_DURATION_MS, completedAtMs - startedAtMs);
}
