//! `migrations/legacy-session-format.mjs`.
use crate::agent::contract::js::{self, Obj};
use crate::agent::runtimes::puppyone_agent::puppyone_agent_public_identity::BUILT_IN_AGENT_DISPLAY_NAME;
use crate::agent::runtimes::workbuddy::workbuddy_channels::{
    WORKBUDDY_CHINA_CHANNEL, WORKBUDDY_INTERNATIONAL_CHANNEL,
};
use crate::agent::runtimes::workbuddy::workbuddy_history_source::legacy_work_buddy_runtime_id_for_source_scope;
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

const LEGACY_RUNTIME_ID: &str = "codex";
static RUNTIME_ID_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9-]{1,39}$").expect("runtime id"));

/// `resolvePersistedRuntimeId(record, requestedRuntimeId)`: session journal
/// v1 predated runtime selection and therefore omitted a runtime id. Keep
/// that historical default at the persistence edge instead of leaking a
/// concrete runtime into the application service or domain model.
pub fn resolve_persisted_runtime_id(record: &Value, requested_runtime_id: Option<&str>) -> String {
    let environment = |key: &str| std::env::var(key).ok();
    let home = std::env::var("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    let candidates = [
        record.get("runtimeId").and_then(Value::as_str),
        record.get("provider").and_then(Value::as_str),
        requested_runtime_id,
    ];
    for value in candidates.into_iter().flatten() {
        if !RUNTIME_ID_PATTERN.is_match(value) {
            continue;
        }
        if value == "workbuddy" {
            return legacy_work_buddy_runtime_id_for_source_scope(
                record.get("sourceScopeId").and_then(Value::as_str),
                &environment,
                &home,
            )
            .or_else(|| work_buddy_channel_runtime_id(requested_runtime_id))
            .unwrap_or(WORKBUDDY_INTERNATIONAL_CHANNEL.id)
            .to_string();
        }
        return canonical_runtime_id(value).to_string();
    }
    LEGACY_RUNTIME_ID.to_string()
}

/// `migratedRuntimeDescriptor(record, runtimeId)`.
pub fn migrated_runtime_descriptor(record: &Value, runtime_id: &str) -> Value {
    let previous = record
        .get("runtime")
        .filter(|r| r.is_object())
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let field = |key: &str| previous.get(key).filter(|v| js::truthy(v)).cloned();
    let base = Obj::from(&previous).set("id", runtime_id);
    if runtime_id == "puppyone-agent" {
        return base
            .set("displayName", BUILT_IN_AGENT_DISPLAY_NAME)
            .set("kind", "managed-harness")
            .build();
    }
    if runtime_id == WORKBUDDY_CHINA_CHANNEL.id || runtime_id == WORKBUDDY_INTERNATIONAL_CHANNEL.id
    {
        let channel = if runtime_id == WORKBUDDY_CHINA_CHANNEL.id {
            WORKBUDDY_CHINA_CHANNEL
        } else {
            WORKBUDDY_INTERNATIONAL_CHANNEL
        };
        return base
            .set("displayName", channel.display_name)
            .set("kind", field("kind").unwrap_or(Value::from("native-cli")))
            .build();
    }
    if runtime_id == LEGACY_RUNTIME_ID {
        return base
            .set(
                "displayName",
                field("displayName").unwrap_or(Value::from("Codex")),
            )
            .set("kind", field("kind").unwrap_or(Value::from("native-cli")))
            .build();
    }
    base.set(
        "displayName",
        field("displayName").unwrap_or_else(|| Value::from(humanize_runtime_id(runtime_id))),
    )
    .set("kind", field("kind").unwrap_or(Value::from("native-cli")))
    .build()
}

/// `canonicalRuntimeId(value)`.
pub fn canonical_runtime_id(value: &str) -> &str {
    match value {
        // Before ADR-005, `opencode` meant PuppyOne's managed product runtime.
        // User-owned OpenCode sessions have the distinct `opencode-native` id and
        // must never pass through this alias.
        "opencode" => "puppyone-agent",
        // Context-free compatibility (for the process-local recovery cache) follows
        // the old desktop-app precedence. Durable records use source-scope inference.
        "workbuddy" => WORKBUDDY_INTERNATIONAL_CHANNEL.id,
        other => other,
    }
}

fn work_buddy_channel_runtime_id(value: Option<&str>) -> Option<&'static str> {
    match value {
        Some(id) if id == WORKBUDDY_CHINA_CHANNEL.id => Some(WORKBUDDY_CHINA_CHANNEL.id),
        Some(id) if id == WORKBUDDY_INTERNATIONAL_CHANNEL.id => {
            Some(WORKBUDDY_INTERNATIONAL_CHANNEL.id)
        }
        _ => None,
    }
}

/// `humanizeRuntimeId(value)`.
pub fn humanize_runtime_id(value: &str) -> String {
    let spaced = Regex::new(r"[-_.]+")
        .expect("separators")
        .replace_all(value, " ");
    Regex::new(r"\b\w")
        .expect("word starts")
        .replace_all(&spaced, |c: &regex::Captures| c[0].to_uppercase())
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn legacy_records_resolve_to_canonical_runtimes() {
        assert_eq!(resolve_persisted_runtime_id(&json!({}), None), "codex");
        assert_eq!(
            resolve_persisted_runtime_id(&json!({"provider": "opencode"}), None),
            "puppyone-agent"
        );
        assert_eq!(
            resolve_persisted_runtime_id(&json!({"runtimeId": "BAD"}), Some("claude")),
            "claude"
        );
        assert_eq!(
            resolve_persisted_runtime_id(
                &json!({"runtimeId": "workbuddy"}),
                Some("workbuddy-china")
            ),
            "workbuddy-china"
        );
        assert_eq!(
            migrated_runtime_descriptor(&json!({}), "my-agent")["displayName"],
            "My Agent"
        );
        assert_eq!(
            migrated_runtime_descriptor(&json!({}), "puppyone-agent")["displayName"],
            "Built-in Agent"
        );
    }

    #[test]
    fn restores_both_former_managed_labels_to_the_current_public_identity() {
        for label in ["PuppyOne Agent", "Workspace Agent"] {
            let record = json!({"runtimeId": "puppyone-agent", "runtime": {
                "id": "puppyone-agent", "displayName": label, "kind": "managed-harness",
            }});
            assert_eq!(
                resolve_persisted_runtime_id(&record, None),
                "puppyone-agent"
            );
            assert_eq!(
                migrated_runtime_descriptor(&record, "puppyone-agent"),
                json!({
                    "id": "puppyone-agent", "displayName": "Built-in Agent", "kind": "managed-harness",
                })
            );
        }
    }

    #[test]
    fn restores_each_legacy_workbuddy_channel_from_its_native_history_scope() {
        use crate::agent::runtimes::workbuddy::workbuddy_history_source::work_buddy_history_source;
        let home = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default());
        for channel in [WORKBUDDY_CHINA_CHANNEL, WORKBUDDY_INTERNATIONAL_CHANNEL] {
            let scope = work_buddy_history_source(&channel, &|key| std::env::var(key).ok(), &home);
            let record = json!({"runtimeId": "workbuddy", "sourceScopeId": scope, "runtime": {
                "id": "workbuddy", "displayName": "WorkBuddy", "kind": "native-cli",
            }});
            assert_eq!(resolve_persisted_runtime_id(&record, None), channel.id);
            assert_eq!(
                migrated_runtime_descriptor(&record, channel.id),
                json!({
                    "id": channel.id, "displayName": channel.display_name, "kind": "native-cli",
                })
            );
        }
    }
}
