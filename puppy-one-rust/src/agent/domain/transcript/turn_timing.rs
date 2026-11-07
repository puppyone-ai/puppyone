//! `transcript/turn-timing.mjs`.
use crate::agent::contract::js;
use crate::clock;
use serde_json::Value;

const MAX_TURN_DURATION_MS: i64 = 30 * 24 * 60 * 60 * 1_000;

/// `parseAgentEventTime(value)`.
pub fn parse_agent_event_time(value: Option<&Value>) -> Option<i64> {
    clock::date_parse(value?.as_str()?)
}

/// `readAgentTurnDurationMs(value, startedAtMs, emittedAt)`.
pub fn read_agent_turn_duration_ms(
    value: Option<&Value>,
    started_at_ms: Option<i64>,
    emitted_at: Option<&Value>,
) -> Option<i64> {
    if let Some(native) = value.and_then(js::finite_number).filter(|n| *n >= 0.0) {
        return Some(MAX_TURN_DURATION_MS.min(native.round() as i64));
    }
    let completed_at_ms = parse_agent_event_time(emitted_at)?;
    let started_at_ms = started_at_ms?;
    if completed_at_ms < started_at_ms {
        return None;
    }
    Some(MAX_TURN_DURATION_MS.min(completed_at_ms - started_at_ms))
}
