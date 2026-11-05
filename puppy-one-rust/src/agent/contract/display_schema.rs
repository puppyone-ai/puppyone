//! `shared/agent-contract/display-schema.mjs`: the display snapshot and
//! patch a Renderer replica accepts.
use super::display_metrics::{entry_metrics, mark_validated};
use super::display_state::{DISPLAY_COLLECTION_KEYS, DISPLAY_VALUE_KEYS, collection_identity};
use super::display_types::AgentDisplay;
use super::js;
use super::validation::{
    Contract, StringRule, assert_array, assert_record, contract_error, enum_value,
    non_negative_integer, required_string, required_string_with,
};
use serde_json::{Map, Value};
use std::collections::HashSet;

/// `agentDisplayLimits`.
pub mod limits {
    pub const MAX_ENTRIES: usize = 2_000;
    pub const MAX_NODES: usize = 100_000;
    pub const MAX_BYTES: usize = 8 * 1024 * 1024;
    pub const MAX_TEXT: usize = 128 * 1024;
}

const PART_KINDS: &[&str] = &[
    "user",
    "assistant",
    "turn-summary",
    "tool",
    "command",
    "file-change",
    "plan",
    "reasoning",
    "warning",
    "error",
    "notification",
    "system",
    "usage",
    "permission",
    "question",
    "unknown",
];
pub const ACTIVITY_STATUSES: &[&str] = &[
    "queued",
    "running",
    "pending",
    "in-progress",
    "waiting-for-user",
    "completed",
    "succeeded",
    "failed",
    "warning",
    "blocked",
    "cancelled",
    "interrupted",
    "unknown",
];
const DELIVERY_STATUSES: &[&str] = &[
    "queued",
    "dispatching",
    "accepted",
    "rejected",
    "cancelled",
    "outcome-unknown",
];
const UNSAFE_KEYS: &[&str] = &["__proto__", "constructor", "prototype"];

/// `assertAgentDisplay(value)` of a display in transport form.
pub fn assert_agent_display(value: &Value) -> Contract<()> {
    assert_record(Some(value), "Agent display")?;
    assert_display(&AgentDisplay::from_value(value)?)
}

/// `assertAgentDisplay(display)`.
pub fn assert_display(display: &AgentDisplay) -> Contract<()> {
    if display.get("schemaVersion") != Some(&Value::from(1)) {
        return Err(contract_error(
            "Agent display.schemaVersion",
            "must equal 1",
        ));
    }
    validate_values(&display.values, true)?;
    let mut nodes = 1;
    let mut bytes = 2;
    for (key, value) in &display.values {
        check_key(key)?;
        walk(value, 1, &mut nodes)?;
        bytes += key.len() + 4 + js::json_byte_length(value);
    }
    for (key, identity) in DISPLAY_COLLECTION_KEYS {
        let entries = display.collection(key);
        if entries.len() > limits::MAX_ENTRIES {
            return Err(contract_error(key, "exceeds the display window"));
        }
        nodes += 1;
        bytes += key.len() + 5;
        let mut ids = HashSet::new();
        for entry in entries {
            let metrics = entry_metrics(entry);
            if metrics.validated_for != Some(*key) {
                validate_entry(key, entry)?;
                mark_validated(entry, key);
            }
            if !ids.insert(js::str_or_empty(entry.get(*identity))) {
                return Err(contract_error(key, "contains duplicate identities"));
            }
            nodes += metrics.nodes;
            if nodes > limits::MAX_NODES || metrics.depth + 2 > 18 {
                return Err(contract_error("display", "exceeds the structural budget"));
            }
            if metrics.unsafe_key {
                return Err(contract_error("display", "contains an unsafe key"));
            }
            if metrics.non_finite {
                return Err(contract_error("display", "must contain JSON data"));
            }
            if metrics.longest_text > limits::MAX_TEXT {
                return Err(contract_error(
                    "display text",
                    &format!("exceeds {} characters", limits::MAX_TEXT),
                ));
            }
            bytes += metrics.bytes + 1;
        }
    }
    let part_ids: HashSet<&str> = display
        .parts
        .iter()
        .map(|part| js::str_or_empty(part.get("id")))
        .collect();
    for row in &display.rows {
        if !part_ids.contains(js::str_or_empty(row.get("partId"))) {
            return Err(contract_error(
                "rows.partId",
                "must reference a retained part",
            ));
        }
    }
    if bytes > limits::MAX_BYTES {
        return Err(contract_error("display", "exceeds the byte budget"));
    }
    Ok(())
}

/// `assertAgentDisplayPatch(value)`.
pub fn assert_agent_display_patch(value: &Value) -> Contract<()> {
    let patch = assert_record(Some(value), "Agent display patch")?;
    if patch.get("schemaVersion") != Some(&Value::from(1)) {
        return Err(contract_error(
            "Agent display patch.schemaVersion",
            "must equal 1",
        ));
    }
    let values = assert_record(patch.get("values"), "display patch values")?;
    for key in values.keys() {
        if !DISPLAY_VALUE_KEYS.contains(&key.as_str()) {
            return Err(contract_error(key, "is not a display value"));
        }
    }
    validate_values(values, false)?;
    for (key, delta) in assert_record(patch.get("collections"), "display collections")? {
        let Some(identity) = collection_identity(key) else {
            return Err(contract_error(key, "is not a display collection"));
        };
        let delta = assert_record(Some(delta), key)?;
        for id in bounded_array(delta.get("remove"), key)? {
            id_value(Some(id))?;
        }
        for entry in bounded_array(delta.get("upsert"), key)? {
            validate_entry(key, entry)?;
        }
        for update in bounded_array(delta.get("update"), key)? {
            let update = assert_record(Some(update), key)?;
            id_value(update.get("id"))?;
            let changes = assert_record(update.get("changes"), key)?;
            if changes.contains_key(identity) {
                return Err(contract_error(key, "cannot change an identity"));
            }
            for field in bounded_array(update.get("unset"), key)? {
                id_value(Some(field))?;
                if field.as_str() == Some(identity) {
                    return Err(contract_error(key, "cannot remove an identity"));
                }
            }
            for (field, append) in assert_record(update.get("append"), key)? {
                if !["text", "output", "label"].contains(&field.as_str()) {
                    return Err(contract_error(field, "is not an appendable display field"));
                }
                let append = assert_record(Some(append), field)?;
                non_negative_integer(append.get("offset"), field)?;
                text_value(append.get("text"), field)?;
            }
        }
        if delta.contains_key("order") {
            for id in bounded_array(delta.get("order"), key)? {
                id_value(Some(id))?;
            }
        }
    }
    assert_safe_json(value)
}

fn validate_values(value: &Map<String, Value>, complete: bool) -> Contract<()> {
    let has = |key: &str| complete || value.contains_key(key);
    if has("presentation") {
        let view = assert_record(value.get("presentation"), "presentation")?;
        enum_value(
            view.get("phase"),
            "presentation.phase",
            &["ready", "creating", "running", "waiting", "runtime-exited"],
        )?;
        enum_value(
            view.get("terminalState"),
            "presentation.terminalState",
            &[
                "idle",
                "running",
                "outcome-unknown",
                "provider-exited",
                "completed",
                "failed",
                "interrupted",
            ],
        )?;
        if view.get("pendingPrompt") != Some(&Value::Null) {
            text_value(view.get("pendingPrompt"), "presentation.pendingPrompt")?;
        }
        for key in ["submitting", "stopping"] {
            if !view.get(key).is_some_and(Value::is_boolean) {
                return Err(contract_error(key, "must be boolean"));
            }
        }
    }
    if has("sessionState") {
        enum_value(
            value.get("sessionState"),
            "sessionState",
            &["empty", "active", "closed"],
        )?;
    }
    if has("lastSequence") {
        non_negative_integer(value.get("lastSequence"), "lastSequence")?;
    }
    if has("history") {
        let history = assert_record(value.get("history"), "history")?;
        let coverage = enum_value(
            history.get("coverage"),
            "history.coverage",
            &["not-requested", "complete", "partial", "unknown"],
        )?;
        if history.get("reason") != Some(&Value::Null) {
            enum_value(
                history.get("reason"),
                "history.reason",
                &[
                    "read-limit",
                    "replay-unverified",
                    "unsupported",
                    "unverified",
                ],
            )?;
            if matches!(coverage, "not-requested" | "complete") {
                return Err(contract_error(
                    "history.reason",
                    "must be null for complete or unrequested history",
                ));
            }
        }
    }
    if has("displayWindow") {
        let window = assert_record(value.get("displayWindow"), "displayWindow")?;
        if !window.get("truncated").is_some_and(Value::is_boolean) {
            return Err(contract_error("displayWindow.truncated", "must be boolean"));
        }
    }
    if has("runningTurnId") && value.get("runningTurnId") != Some(&Value::Null) {
        id_value(value.get("runningTurnId"))?;
    }
    if has("terminalState") && value.get("terminalState") != Some(&Value::Null) {
        enum_value(
            value.get("terminalState"),
            "terminalState",
            &["completed", "failed", "interrupted"],
        )?;
    }
    if has("missingRanges") {
        for range in bounded_array(value.get("missingRanges"), "missingRanges")? {
            let from = non_negative_integer(js::get(range, "from"), "missingRanges.from")?;
            let to = non_negative_integer(js::get(range, "to"), "missingRanges.to")?;
            if to < from {
                return Err(contract_error("missingRanges", "must be ordered"));
            }
        }
    }
    if has("connectionStatus") && value.get("connectionStatus") != Some(&Value::Null) {
        let status = assert_record(value.get("connectionStatus"), "connectionStatus")?;
        enum_value(
            status.get("state"),
            "connectionStatus.state",
            &["reconnecting", "fallback"],
        )?;
        text_value(status.get("message"), "connectionStatus.message")?;
    }
    Ok(())
}

fn validate_entry(key: &str, entry: &Value) -> Contract<()> {
    let record = assert_record(Some(entry), key)?;
    id_value(record.get(collection_identity(key).unwrap_or("id")))?;
    let label = |field: &str| format!("{key}.{field}");
    if key == "messages" || key == "parts" {
        if record.get("truncated").is_some_and(|t| !t.is_boolean()) {
            return Err(contract_error(&label("truncated"), "must be boolean"));
        }
        if record.contains_key("deliveryStatus") {
            enum_value(
                record.get("deliveryStatus"),
                &label("deliveryStatus"),
                DELIVERY_STATUSES,
            )?;
        }
    }
    if key != "turns" {
        non_negative_integer(record.get("sequence"), &label("sequence"))?;
    }
    match key {
        "messages" => {
            enum_value(record.get("role"), "message.role", &["user", "assistant"])?;
            text_value(record.get("text"), "message.text")?;
            if !record.get("streaming").is_some_and(Value::is_boolean) {
                return Err(contract_error(key, "requires streaming"));
            }
        }
        "parts" | "rows" => {
            let kind = enum_value(record.get("kind"), &label("kind"), PART_KINDS)?;
            if key == "rows" {
                id_value(record.get("partId"))?;
                if !record
                    .get("estimatedHeight")
                    .and_then(js::finite_number)
                    .is_some_and(|h| h >= 0.0)
                {
                    return Err(contract_error(key, "requires a valid height"));
                }
            } else if kind == "user" || kind == "assistant" {
                text_value(record.get("text"), "part.text")?;
            }
        }
        "activities" => {
            enum_value(
                record.get("kind"),
                "activity.kind",
                &[
                    "tool",
                    "command",
                    "file-change",
                    "plan",
                    "reasoning",
                    "warning",
                    "error",
                    "notification",
                    "system",
                ],
            )?;
            enum_value(record.get("status"), "activity.status", ACTIVITY_STATUSES)?;
            text_value(record.get("output"), "activity.output")?;
        }
        "approvals" | "questions" => {
            if !js::nullish(record.get("replyStatus")) {
                enum_value(
                    record.get("replyStatus"),
                    &label("replyStatus"),
                    DELIVERY_STATUSES,
                )?;
            }
        }
        "turns" => validate_turn(record)?,
        _ => {}
    }
    Ok(())
}

fn validate_turn(turn: &Map<String, Value>) -> Contract<()> {
    enum_value(
        turn.get("status"),
        "turn.status",
        &[
            "running",
            "outcome-unknown",
            "completed",
            "failed",
            "interrupted",
        ],
    )?;
    if turn.contains_key("recoveryOfTurnId") {
        id_value(turn.get("recoveryOfTurnId"))?;
    }
    for id in bounded_array(turn.get("partIds"), "turn.partIds")? {
        id_value(Some(id))?;
    }
    if turn.contains_key("completionQuality") {
        enum_value(
            turn.get("completionQuality"),
            "turn.completionQuality",
            &["complete", "degraded"],
        )?;
    }
    let degraded = turn.get("completionQuality") == Some(&Value::from("degraded"));
    if turn.contains_key("recovery") {
        if !degraded {
            return Err(contract_error(
                "turn.recovery",
                "requires degraded completion quality",
            ));
        }
        let recovery = assert_record(turn.get("recovery"), "turn.recovery")?;
        enum_value(
            recovery.get("kind"),
            "turn.recovery.kind",
            &["degraded-completion"],
        )?;
        enum_value(
            recovery.get("failureScope"),
            "turn.recovery.failureScope",
            &["child-task", "tool", "upstream-request", "turn"],
        )?;
        required_string(recovery.get("code"), "turn.recovery.code", 160)?;
        if !matches!(
            recovery.get("retryable"),
            Some(Value::Null | Value::Bool(_))
        ) {
            return Err(contract_error(
                "turn.recovery.retryable",
                "must be boolean or null",
            ));
        }
        enum_value(
            recovery.get("transportHealth"),
            "turn.recovery.transportHealth",
            &["healthy", "recovering", "exited", "unknown"],
        )?;
        enum_value(
            recovery.get("sideEffects"),
            "turn.recovery.sideEffects",
            &["none", "possible", "confirmed", "unknown"],
        )?;
        if recovery.contains_key("diagnostic") {
            required_string(
                recovery.get("diagnostic"),
                "turn.recovery.diagnostic",
                2_000,
            )?;
        }
    }
    if degraded && !turn.contains_key("recovery") {
        return Err(contract_error(
            "turn.recovery",
            "is required for degraded completion",
        ));
    }
    Ok(())
}

fn id_value(value: Option<&Value>) -> Contract<()> {
    required_string(value, "display identity", 1_024).map(drop)
}

fn text_value(value: Option<&Value>, label: &str) -> Contract<()> {
    required_string_with(value, label, limits::MAX_TEXT, StringRule::VERBATIM).map(drop)
}

fn bounded_array<'a>(value: Option<&'a Value>, label: &str) -> Contract<&'a Vec<Value>> {
    let entries = assert_array(value, label)?;
    if entries.len() > limits::MAX_ENTRIES {
        return Err(contract_error(label, "exceeds the display window"));
    }
    Ok(entries)
}

fn check_key(key: &str) -> Contract<()> {
    if UNSAFE_KEYS.contains(&key) {
        return Err(contract_error("display", "contains an unsafe key"));
    }
    Ok(())
}

fn walk(entry: &Value, depth: usize, nodes: &mut usize) -> Contract<()> {
    *nodes += 1;
    if *nodes > limits::MAX_NODES || depth > 18 {
        return Err(contract_error("display", "exceeds the structural budget"));
    }
    match entry {
        Value::String(_) => text_value(Some(entry), "display text"),
        Value::Null | Value::Bool(_) => Ok(()),
        Value::Number(n) => {
            if n.as_f64().is_some_and(f64::is_finite) {
                Ok(())
            } else {
                Err(contract_error("display", "must contain JSON data"))
            }
        }
        Value::Array(items) => items
            .iter()
            .try_for_each(|item| walk(item, depth + 1, nodes)),
        Value::Object(map) => map.iter().try_for_each(|(key, item)| {
            check_key(key)?;
            walk(item, depth + 1, nodes)
        }),
    }
}

fn assert_safe_json(value: &Value) -> Contract<()> {
    let mut nodes = 0;
    walk(value, 0, &mut nodes)?;
    if js::json_byte_length(value) > limits::MAX_BYTES {
        return Err(contract_error("display", "exceeds the byte budget"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::contract::display_state::create_empty_agent_display;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn displays_are_validated_structurally() {
        let mut display = create_empty_agent_display().to_value();
        assert!(assert_agent_display(&display).is_ok());
        display["parts"] = json!([{"id": "p", "kind": "assistant", "text": "x", "sequence": 1}]);
        display["rows"] = json!([{"id": "r", "partId": "missing", "kind": "assistant", "sequence": 1, "estimatedHeight": 10}]);
        assert!(
            assert_agent_display(&display)
                .unwrap_err()
                .0
                .contains("retained part")
        );
        display["rows"][0]["partId"] = json!("p");
        assert!(assert_agent_display(&display).is_ok());
        display["history"] = json!({"coverage": "complete", "reason": "read-limit"});
        assert!(assert_agent_display(&display).is_err());
        display["history"] = json!({"coverage": "partial", "reason": "read-limit"});
        display["turns"] = json!([{"id": "t", "status": "completed", "partIds": [], "completionQuality": "degraded"}]);
        assert!(
            assert_agent_display(&display)
                .unwrap_err()
                .0
                .contains("turn.recovery")
        );
    }

    #[test]
    fn patches_cannot_touch_identities() {
        let patch = json!({"schemaVersion": 1, "values": {}, "collections": {
            "parts": {"remove": [], "upsert": [], "update": [{"id": "p", "changes": {"id": "q"}, "append": {}, "unset": []}]}
        }});
        assert!(
            assert_agent_display_patch(&patch)
                .unwrap_err()
                .0
                .contains("identity")
        );
        let patch = json!({"schemaVersion": 1, "values": {"bogus": 1}, "collections": {}});
        assert!(assert_agent_display_patch(&patch).is_err());
    }
}
