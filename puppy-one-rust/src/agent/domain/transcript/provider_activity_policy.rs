//! `transcript/provider-activity-policy.mjs`.
use super::content_readers::normalize_agent_activity_status;
use super::transcript_indexes::Projection;
pub use crate::agent::contract::activity_semantics::is_agent_transcript_activity as is_transcript_activity;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use crate::text;
use serde_json::Value;
use std::collections::HashSet;

pub const MAX_PROVIDER_ACTIVITIES: usize = 32;

/// `classifyProviderActivity(event)`: normalize native status and extension
/// notices once, before display projection.
pub fn classify_provider_activity(event: &Value) -> Value {
    let legacy_notice = event.event_type() == "provider.activity"
        && event.item_id().unwrap_or("").contains(":extension:");
    let first_truthy = |a: &str, b: &str| {
        [event.field(a), event.field(b)]
            .into_iter()
            .flatten()
            .find(|v| js::truthy(v))
    };
    let label = text::head16(js::str_or_empty(first_truthy("message", "label")), 4_000).to_string();
    if event.event_type() == "provider.notification" || legacy_notice {
        let severity = event
            .field("severity")
            .and_then(Value::as_str)
            .filter(|s| matches!(*s, "warning" | "error"))
            .unwrap_or("info");
        let status = match severity {
            "error" => "failed",
            "warning" => "warning",
            _ => "completed",
        };
        return Obj::new()
            .set("kind", "notification")
            .set("label", label)
            .set("status", status)
            .set(
                "detail",
                Obj::new()
                    .set("message", text::head16(event.text("message"), 4_000))
                    .set("severity", severity)
                    .set(
                        "source",
                        text::head16(js::str_or_empty(first_truthy("source", "label")), 200),
                    )
                    .build(),
            )
            .build();
    }
    // Compatibility belongs here, never in a provider-specific React component.
    let category = match event.field("category").filter(|v| !v.is_null()) {
        Some(category) => category.clone(),
        None if event.item_id().unwrap_or("").ends_with(":compaction") => Value::from("compaction"),
        None => Value::from("status"),
    };
    Obj::new()
        .set("kind", "system")
        .set("label", label)
        .set("labelCode", "agent-activity")
        .set(
            "status",
            normalize_agent_activity_status(event.field("status"), "unknown"),
        )
        .set(
            "detail",
            Obj::from(event.payload()).set("category", category).build(),
        )
        .build()
}

/// `pruneProviderActivities(projection, event)`: bounded live metadata
/// shares the existing snapshot/patch transport, not history.
pub fn prune_provider_activities(projection: &mut Projection, event: &Value) {
    if !matches!(
        event.event_type(),
        "provider.notification" | "provider.activity"
    ) {
        return;
    }
    let order = |activity: &Value| {
        activity
            .get("updatedSequence")
            .filter(|v| !v.is_null())
            .or(activity.get("sequence"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    let mut auxiliary: Vec<&Value> = projection
        .d
        .activities
        .iter()
        .map(|a| &**a)
        .filter(|activity| !is_transcript_activity(activity))
        .collect();
    if auxiliary.len() <= MAX_PROVIDER_ACTIVITIES {
        return;
    }
    auxiliary.sort_by(|a, b| order(a).total_cmp(&order(b)));
    let removed: HashSet<String> = auxiliary[..auxiliary.len() - MAX_PROVIDER_ACTIVITIES]
        .iter()
        .map(|activity| js::str_or_empty(activity.get("id")).to_string())
        .collect();
    let keep = |entry: &Value| !removed.contains(js::str_or_empty(entry.get("id")));
    projection.d.activities.retain(|a| keep(a));
    projection.d.parts.retain(|p| keep(p));
    projection.invalidate();
}

/// `normalizeLegacyProviderActivity(event)`: older Codex journals described
/// native compaction as a system-shaped tool.
pub fn normalize_legacy_provider_activity(event: &Value) -> Value {
    if event.event_type().starts_with("tool.")
        && event.field("kind") == Some(&Value::from("system"))
        && event.field("tool") == Some(&Value::from("compaction"))
    {
        let payload = Obj::from(event.payload())
            .set("category", "compaction")
            .build();
        return js::with(
            &js::with(event, "type", "provider.activity"),
            "payload",
            payload,
        );
    }
    event.clone()
}
