//! `transcript/provider-notice-policy.mjs`.
use super::transcript_indexes::Projection;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use crate::text;
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

static NON_DIAGNOSTIC: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?-u:\b)thread entered a system error state\.?$").expect("status pattern")
});
static RECONNECT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?-u:\b)reconnect(?:ing|ion)?(?-u:\b)").expect("reconnect pattern")
});
static FALLBACK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?-u:\b)falling back(?-u:\b).*(?-u:\b)transport(?-u:\b)")
        .expect("fallback pattern")
});
static FRACTION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?-u:\b)(\d+)\s*/\s*(\d+)(?-u:\b)").expect("fraction pattern"));
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("space pattern"));

/// The identity a provider notice takes (`{ id, turnId }`).
pub struct NoticeIdentity {
    pub id: String,
    pub turn_id: Value,
}

/// `providerActivityIdentity(projection, event, label)`: correlates retry
/// warnings and terminal failures without merging separate turns.
pub fn provider_activity_identity(
    projection: &Projection,
    event: &Value,
    label: &str,
) -> NoticeIdentity {
    let turn_id = correlated_provider_turn_id(projection, event);
    let fingerprint = provider_message_fingerprint(label);
    let activities = &projection.d.activities;
    let first_candidate = activities.len().saturating_sub(64);
    for activity in activities[first_candidate..].iter().rev() {
        let kind = activity.get("kind").and_then(Value::as_str);
        if !matches!(kind, Some("warning" | "error"))
            || provider_message_fingerprint(js::str_or_empty(activity.get("label"))) != fingerprint
        {
            continue;
        }
        let activity_turn = activity
            .get("turnId")
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty());
        if let (Some(turn), Some(activity_turn)) = (turn_id.as_deref(), activity_turn)
            && turn != activity_turn
        {
            continue;
        }
        let activity_sequence = activity
            .get("sequence")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if (turn_id.is_none() || activity_turn.is_none())
            && event.sequence() - activity_sequence > 16
        {
            continue;
        }
        return NoticeIdentity {
            id: js::str_or_empty(activity.get("id")).to_string(),
            turn_id: match &turn_id {
                Some(turn) => Value::from(turn.as_str()),
                None => activity.get("turnId").cloned().unwrap_or(Value::Null),
            },
        };
    }
    let scope = turn_id
        .clone()
        .or_else(|| event.item_id().map(str::to_string))
        .unwrap_or_else(|| "session".into());
    NoticeIdentity {
        id: provider_notice_id(&scope, &fingerprint),
        turn_id: turn_id.map_or(Value::Null, Value::from),
    }
}

/// `isNonDiagnosticProviderStatusMessage(value)`: hides persisted
/// lifecycle-only notices emitted by older adapters.
pub fn is_non_diagnostic_provider_status_message(value: &str) -> bool {
    NON_DIAGNOSTIC.is_match(text::trim(value))
}

/// `legacyProviderConnectionUpdate(event, label)`: replay migration for
/// events produced before `provider.connection.updated` existed. New
/// adapters must emit the structured event; UI code must never repeat these
/// provider-specific heuristics.
pub fn legacy_provider_connection_update(event: &Value, label: &str) -> Option<Value> {
    if event.event_type() != "provider.warning" {
        return None;
    }
    let fraction = retry_fraction(label);
    let attempt = positive_integer(event.field("attempt")).or(fraction.map(|f| f.0));
    let max_attempts = positive_integer(event.field("maxAttempts"))
        .or_else(|| positive_integer(event.field("maxRetries")))
        .or(fraction.map(|f| f.1));
    // `recoverable` describes diagnostic severity, not transport state. Only a
    // legacy retry-shaped notice may be migrated, and callers additionally gate
    // this helper to snapshot hydration rather than the live event path.
    if RECONNECT.is_match(label) && (attempt.is_some() || fraction.is_some()) {
        return Some(
            Obj::new()
                .set("state", "reconnecting")
                .set("attempt", attempt)
                .set("maxAttempts", max_attempts)
                .build(),
        );
    }
    if FALLBACK.is_match(label) {
        return Some(
            Obj::new()
                .set("state", "fallback")
                .set("attempt", Value::Null)
                .set("maxAttempts", Value::Null)
                .build(),
        );
    }
    None
}

fn correlated_provider_turn_id(projection: &Projection, event: &Value) -> Option<String> {
    if let Some(turn) = event.turn_id().filter(|t| !t.is_empty()) {
        return Some(turn.into());
    }
    if let Some(turn) = projection.d.running_turn_id().filter(|t| !t.is_empty()) {
        return Some(turn.into());
    }
    let recent = projection.d.turns.last()?;
    let completed = recent.get("completedAtSequence").and_then(Value::as_i64)?;
    (event.sequence() - completed <= 16).then(|| js::str_or_empty(recent.get("id")).to_string())
}

fn provider_message_fingerprint(value: &str) -> String {
    let lower = text::trim(value).to_lowercase();
    text::head16(&SPACES.replace_all(&lower, " "), 2_048).to_string()
}

fn provider_notice_id(scope: &str, fingerprint: &str) -> String {
    let mut hash: u32 = 2_166_136_261;
    for unit in fingerprint.encode_utf16() {
        hash = (hash ^ unit as u32).wrapping_mul(16_777_619);
    }
    format!("provider-notice:{scope}:{}", base36(hash))
}

fn base36(mut value: u32) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("base36 digits")
}

fn positive_integer(value: Option<&Value>) -> Option<i64> {
    value.and_then(js::safe_integer).filter(|n| *n > 0)
}

fn retry_fraction(value: &str) -> Option<(i64, i64)> {
    let captures = FRACTION.captures(value)?;
    let attempt: i64 = captures[1].parse().ok()?;
    let max_attempts: i64 = captures[2].parse().ok()?;
    (attempt > 0
        && max_attempts > 0
        && attempt <= js::MAX_SAFE_INTEGER
        && max_attempts <= js::MAX_SAFE_INTEGER)
        .then_some((attempt, max_attempts))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn notice_ids_hash_like_the_product() {
        // `(Math.imul(2166136261 ^ 97, 16777619) >>> 0).toString(36)` for "a".
        assert_eq!(provider_notice_id("s", "a"), "provider-notice:s:1r9wi7g");
        assert_eq!(base36(35), "z");
    }
}
