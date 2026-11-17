//! `shared/agent-contract/display-state.mjs`: process-neutral display data
//! operations. They never interpret Harness events.
use super::display_types::{AgentDisplay, Entry, same};
use super::js::{self, Obj};
use super::validation::{Contract, type_error};
use crate::text;
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// `DISPLAY_COLLECTION_KEYS`: each collection and its identity field.
pub const DISPLAY_COLLECTION_KEYS: &[(&str, &str)] = &[
    ("messages", "id"),
    ("activities", "id"),
    ("approvals", "requestId"),
    ("questions", "requestId"),
    ("turns", "id"),
    ("parts", "id"),
    ("rows", "id"),
];

pub const DISPLAY_VALUE_KEYS: &[&str] = &[
    "sessionState",
    "lastSequence",
    "history",
    "displayWindow",
    "missingRanges",
    "connectionStatus",
    "runningTurnId",
    "terminalState",
    "usage",
    "presentation",
];

const APPENDABLE: &[&str] = &["text", "output", "label"];

/// The identity field of a display collection.
pub fn collection_identity(key: &str) -> Option<&'static str> {
    DISPLAY_COLLECTION_KEYS
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, identity)| *identity)
}

/// `createEmptyAgentDisplay()`.
pub fn create_empty_agent_display() -> AgentDisplay {
    AgentDisplay::from_value(&json!({
        "schemaVersion": 1, "sessionState": "empty", "lastSequence": 0,
        "history": { "coverage": "not-requested", "reason": null }, "displayWindow": { "truncated": false },
        "missingRanges": [], "messages": [], "activities": [], "approvals": [], "questions": [],
        "turns": [], "parts": [], "rows": [], "connectionStatus": null, "runningTurnId": null,
        "terminalState": null, "usage": null,
        "presentation": { "phase": "ready", "terminalState": "idle", "pendingPrompt": null, "submitting": false, "stopping": false },
    }))
    .expect("the empty display is well formed")
}

fn identity_of<'a>(entry: &'a Value, identity: &str) -> &'a str {
    js::str_or_empty(entry.get(identity))
}

/// `createAgentDisplayPatch(previous, next)`: Main computes structural
/// changes; a replica only applies these committed changes.
pub fn create_agent_display_patch(previous: &AgentDisplay, next: &AgentDisplay) -> Value {
    let mut values = Map::new();
    for key in DISPLAY_VALUE_KEYS {
        if previous.get(key) != next.get(key) {
            values.insert((*key).into(), next.get(key).cloned().unwrap_or(Value::Null));
        }
    }
    let mut collections = Map::new();
    for (key, identity) in DISPLAY_COLLECTION_KEYS {
        if let Some(delta) =
            collection_delta(previous.collection(key), next.collection(key), identity)
        {
            collections.insert((*key).into(), delta);
        }
    }
    json!({ "schemaVersion": 1, "values": values, "collections": collections })
}

fn collection_delta(
    before_entries: &[Entry],
    after_entries: &[Entry],
    identity: &str,
) -> Option<Value> {
    // Unchanged collections share every entry: nothing to compare.
    if before_entries.len() == after_entries.len()
        && before_entries
            .iter()
            .zip(after_entries)
            .all(|(a, b)| Arc::ptr_eq(a, b))
    {
        return None;
    }
    let before: HashMap<&str, &Entry> = before_entries
        .iter()
        .map(|entry| (identity_of(entry, identity), entry))
        .collect();
    let after: HashSet<&str> = after_entries
        .iter()
        .map(|entry| identity_of(entry, identity))
        .collect();
    let remove: Vec<&str> = before_entries
        .iter()
        .map(|entry| identity_of(entry, identity))
        .filter(|id| !after.contains(id))
        .collect();
    let mut upsert = Vec::new();
    let mut update = Vec::new();
    for entry in after_entries {
        let id = identity_of(entry, identity);
        let Some(old) = before.get(id) else {
            upsert.push((**entry).clone());
            continue;
        };
        if same(old, entry) {
            continue;
        }
        let mut changes = Map::new();
        let mut append = Map::new();
        let empty = Map::new();
        let entry_map = entry.as_object().unwrap_or(&empty);
        for (field, value) in entry_map {
            let old_value = old.get(field);
            if old_value == Some(value) {
                continue;
            }
            match (old_value.and_then(Value::as_str), value.as_str()) {
                (Some(old_text), Some(text))
                    if APPENDABLE.contains(&field.as_str())
                        && text::len16(old_text) > 128
                        && text.starts_with(old_text) =>
                {
                    append.insert(
                        field.clone(),
                        json!({ "offset": text::len16(old_text), "text": &text[old_text.len()..] }),
                    );
                }
                _ => {
                    changes.insert(field.clone(), value.clone());
                }
            }
        }
        let unset: Vec<&String> = old
            .as_object()
            .map(|map| map.keys().filter(|f| !entry_map.contains_key(*f)).collect())
            .unwrap_or_default();
        update.push(json!({ "id": id, "changes": changes, "append": append, "unset": unset }));
    }
    if remove.is_empty() && upsert.is_empty() && update.is_empty() {
        return None;
    }
    let old_order: Vec<&str> = before_entries
        .iter()
        .map(|e| identity_of(e, identity))
        .collect();
    let new_order: Vec<&str> = after_entries
        .iter()
        .map(|e| identity_of(e, identity))
        .collect();
    let mut delta = Obj::new()
        .set("remove", remove)
        .set("upsert", upsert)
        .set("update", update);
    if old_order != new_order {
        delta.insert("order", new_order);
    }
    Some(delta.build())
}

/// `applyAgentDisplayPatch(previous, patch)`.
pub fn apply_agent_display_patch(previous: &AgentDisplay, patch: &Value) -> Contract<AgentDisplay> {
    let mut next = previous.clone();
    if let Some(values) = patch.get("values").and_then(Value::as_object) {
        for (key, value) in values {
            next.values.insert(key.clone(), value.clone());
        }
    }
    let Some(collections) = patch.get("collections").and_then(Value::as_object) else {
        return Ok(next);
    };
    for (key, delta) in collections {
        let identity = collection_identity(key)
            .ok_or_else(|| type_error("Unknown Agent display collection."))?;
        let applied = apply_collection_delta(previous.collection(key), delta, identity)?;
        *next.collection_mut(key) = applied;
    }
    Ok(next)
}

fn apply_collection_delta(
    previous: &[Entry],
    delta: &Value,
    identity: &str,
) -> Contract<Vec<Entry>> {
    // `new Map(previous[key])`: ids in first-seen order, later entries
    // replacing earlier ones in place.
    let mut order: Vec<String> = Vec::new();
    let mut map: HashMap<String, Entry> = HashMap::new();
    for entry in previous {
        let id = identity_of(entry, identity).to_string();
        if map.insert(id.clone(), entry.clone()).is_none() {
            order.push(id);
        }
    }
    let list = |name: &str| {
        delta
            .get(name)
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
    };
    let removed: HashSet<&str> = list("remove").iter().filter_map(Value::as_str).collect();
    if !removed.is_empty() {
        order.retain(|id| !removed.contains(id.as_str()));
        map.retain(|id, _| !removed.contains(id.as_str()));
    }
    for entry in list("upsert") {
        let id = identity_of(entry, identity).to_string();
        if map.insert(id.clone(), Arc::new(entry.clone())).is_none() {
            order.push(id);
        }
    }
    for update in list("update") {
        let id = js::str_or_empty(update.get("id"));
        let Some(old) = map.get(id) else {
            return Err(type_error("Agent display update target is missing."));
        };
        let mut entry = old.as_object().cloned().unwrap_or_default();
        if let Some(changes) = update.get("changes").and_then(Value::as_object) {
            for (field, value) in changes {
                entry.insert(field.clone(), value.clone());
            }
        }
        for field in update
            .get("unset")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(field) = field.as_str() {
                entry.shift_remove(field);
            }
        }
        if let Some(appends) = update.get("append").and_then(Value::as_object) {
            for (field, suffix) in appends {
                let offset = suffix.get("offset").and_then(js::safe_integer);
                let Some(old_text) = old
                    .get(field)
                    .and_then(Value::as_str)
                    .filter(|t| Some(text::len16(t) as i64) == offset)
                else {
                    return Err(type_error("Agent display text revision is stale."));
                };
                let text = js::str_or_empty(suffix.get("text"));
                entry.insert(field.clone(), Value::String(format!("{old_text}{text}")));
            }
        }
        map.insert(id.to_string(), Arc::new(Value::Object(entry)));
    }
    match delta.get("order").and_then(Value::as_array) {
        Some(new_order) => {
            let ids: Vec<&str> = new_order
                .iter()
                .map(|id| js::str_or_empty(Some(id)))
                .collect();
            let unique: HashSet<&str> = ids.iter().copied().collect();
            if ids.len() != map.len() || unique.len() != map.len() {
                return Err(type_error("Invalid Agent display order."));
            }
            ids.iter()
                .map(|id| {
                    map.remove(*id)
                        .ok_or_else(|| type_error("Agent display order target is missing."))
                })
                .collect()
        }
        None => Ok(order.into_iter().filter_map(|id| map.remove(&id)).collect()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn display(messages: Value) -> AgentDisplay {
        let mut value = create_empty_agent_display().to_value();
        value["messages"] = messages;
        AgentDisplay::from_value(&value).unwrap()
    }

    #[test]
    fn patches_carry_appends_removals_and_order() {
        let long = "x".repeat(200);
        let previous = display(json!([
            {"id": "a", "text": long, "streaming": true, "sequence": 1},
            {"id": "b", "text": "b", "streaming": false, "sequence": 2, "extra": 1},
        ]));
        let mut next = display(json!([
            {"id": "c", "text": "c", "streaming": false, "sequence": 3},
            {"id": "a", "text": format!("{long}yz"), "streaming": false, "sequence": 1},
        ]));
        next.set("lastSequence", 3);
        let patch = create_agent_display_patch(&previous, &next);
        assert_eq!(patch["values"], json!({"lastSequence": 3}));
        let delta = &patch["collections"]["messages"];
        assert_eq!(delta["remove"], json!(["b"]));
        assert_eq!(
            delta["update"][0]["append"]["text"],
            json!({"offset": 200, "text": "yz"})
        );
        assert_eq!(delta["update"][0]["changes"], json!({"streaming": false}));
        assert_eq!(delta["order"], json!(["c", "a"]));
        assert_eq!(apply_agent_display_patch(&previous, &patch).unwrap(), next);
    }

    #[test]
    fn stale_appends_are_rejected() {
        let long = "x".repeat(200);
        let previous = display(json!([{"id": "a", "text": long}]));
        let next = display(json!([{"id": "a", "text": format!("{long}!")}]));
        let patch = create_agent_display_patch(&previous, &next);
        let stale = display(json!([{"id": "a", "text": "short"}]));
        assert_eq!(
            apply_agent_display_patch(&stale, &patch).unwrap_err().0,
            "Agent display text revision is stale."
        );
        assert_eq!(apply_agent_display_patch(&previous, &patch).unwrap(), next);
    }

    #[test]
    fn shared_entries_are_not_compared() {
        let previous = display(json!([{"id": "a", "text": "a"}]));
        let next = previous.clone();
        let patch = create_agent_display_patch(&previous, &next);
        assert_eq!(patch["collections"], json!({}));
    }
}
