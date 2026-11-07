//! `shared/agent-contract/display-types.ts`: the Agent display a session
//! projects and a Renderer replica holds.
//!
//! Collection entries are shared (`Arc`), as the product's are shared
//! object references: a revision rebuilds only the entries an event touched,
//! and comparing two revisions skips every entry they still share.
use super::display_state::DISPLAY_COLLECTION_KEYS;
use super::validation::{Contract, contract_error};
use serde_json::{Map, Value};
use std::sync::Arc;

/// One display entity: a message, activity, approval, question, turn, part
/// or row.
pub type Entry = Arc<Value>;

/// `AgentProjection`.
#[derive(Clone, Debug, Default)]
pub struct AgentDisplay {
    /// `schemaVersion` and the display values (`DISPLAY_VALUE_KEYS`), plus
    /// anything else the product keeps on the object.
    pub values: Map<String, Value>,
    pub messages: Vec<Entry>,
    pub activities: Vec<Entry>,
    pub approvals: Vec<Entry>,
    pub questions: Vec<Entry>,
    pub turns: Vec<Entry>,
    pub parts: Vec<Entry>,
    pub rows: Vec<Entry>,
}

impl PartialEq for AgentDisplay {
    fn eq(&self, other: &Self) -> bool {
        self.values == other.values
            && DISPLAY_COLLECTION_KEYS.iter().all(|(key, _)| {
                let (a, b) = (self.collection(key), other.collection(key));
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
            })
    }
}

/// `a === b || JSON.stringify(a) === JSON.stringify(b)` of two entries.
pub fn same(a: &Entry, b: &Entry) -> bool {
    Arc::ptr_eq(a, b) || a == b
}

impl AgentDisplay {
    /// The entries of collection `key`.
    pub fn collection(&self, key: &str) -> &Vec<Entry> {
        match key {
            "messages" => &self.messages,
            "activities" => &self.activities,
            "approvals" => &self.approvals,
            "questions" => &self.questions,
            "turns" => &self.turns,
            "parts" => &self.parts,
            "rows" => &self.rows,
            _ => panic!("unknown Agent display collection {key}"),
        }
    }

    pub fn collection_mut(&mut self, key: &str) -> &mut Vec<Entry> {
        match key {
            "messages" => &mut self.messages,
            "activities" => &mut self.activities,
            "approvals" => &mut self.approvals,
            "questions" => &mut self.questions,
            "turns" => &mut self.turns,
            "parts" => &mut self.parts,
            "rows" => &mut self.rows,
            _ => panic!("unknown Agent display collection {key}"),
        }
    }

    /// A display value (`display[key]`).
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.values.get(key)
    }

    /// `display[key] = value`.
    pub fn set(&mut self, key: &str, value: impl Into<Value>) {
        self.values.insert(key.into(), value.into());
    }

    /// `display.lastSequence`.
    pub fn last_sequence(&self) -> i64 {
        self.get("lastSequence")
            .and_then(Value::as_i64)
            .unwrap_or(0)
    }

    /// `display.runningTurnId`.
    pub fn running_turn_id(&self) -> Option<&str> {
        self.get("runningTurnId").and_then(Value::as_str)
    }

    /// The display as plain JSON (snapshot transport, checks, tests).
    pub fn to_value(&self) -> Value {
        let mut map = Map::new();
        let put = |key: &str, map: &mut Map<String, Value>| {
            if let Some(value) = self.values.get(key) {
                map.insert(key.into(), value.clone());
            }
        };
        for key in [
            "schemaVersion",
            "sessionState",
            "lastSequence",
            "history",
            "displayWindow",
            "missingRanges",
        ] {
            put(key, &mut map);
        }
        for (key, _) in DISPLAY_COLLECTION_KEYS {
            map.insert(
                (*key).into(),
                Value::Array(self.collection(key).iter().map(|e| (**e).clone()).collect()),
            );
        }
        for (key, value) in &self.values {
            if !map.contains_key(key) {
                map.insert(key.clone(), value.clone());
            }
        }
        Value::Object(map)
    }

    /// A display from plain JSON; every collection must be an array.
    pub fn from_value(value: &Value) -> Contract<Self> {
        let Some(object) = value.as_object() else {
            return Err(contract_error("Agent display", "must be an object"));
        };
        let mut display = AgentDisplay::default();
        for (key, entry) in object {
            if DISPLAY_COLLECTION_KEYS.iter().any(|(name, _)| name == key) {
                let Some(entries) = entry.as_array() else {
                    return Err(contract_error(key, "must be an array"));
                };
                *display.collection_mut(key) = entries.iter().cloned().map(Arc::new).collect();
            } else {
                display.values.insert(key.clone(), entry.clone());
            }
        }
        for (key, _) in DISPLAY_COLLECTION_KEYS {
            if !object.contains_key(*key) {
                return Err(contract_error(key, "must be an array"));
            }
        }
        Ok(display)
    }
}
