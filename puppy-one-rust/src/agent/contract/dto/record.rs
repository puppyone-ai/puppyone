//! Open records (`Record<string, unknown>`): provider detail the contract
//! carries without shaping it — a tool's input, its metadata, a usage
//! report. They are read by key into plain values with the product's JS
//! reading rules (a string is text, `Boolean(value)`, `Number.isFinite`);
//! their JSON never leaves the contract.
use super::super::js;
use crate::text;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// An open record.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Record(Map<String, Value>);

/// A borrowed open record: a field of a [`Record`], or one entry of its
/// lists.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RecordRef<'a>(&'a Map<String, Value>);

static EMPTY: std::sync::LazyLock<Map<String, Value>> = std::sync::LazyLock::new(Map::new);

impl Record {
    pub fn view(&self) -> RecordRef<'_> {
        RecordRef(&self.0)
    }
    /// The record of a JSON object (an empty one for anything else).
    pub(in crate::agent) fn from_value(value: Value) -> Self {
        match value {
            Value::Object(map) => Self(map),
            _ => Self::default(),
        }
    }
}

macro_rules! delegate {
    ($($(#[$meta:meta])* fn $name:ident(&self $(, $arg:ident: $ty:ty)*) -> $ret:ty;)*) => {
        impl Record {
            $($(#[$meta])* pub fn $name(&self $(, $arg: $ty)*) -> $ret { self.view().$name($($arg),*) })*
        }
    };
}

delegate! {
    /// `record[key]` when it is a string.
    fn text(&self, key: &str) -> Option<&str>;
    /// `Boolean(record[key])`.
    fn truthy(&self, key: &str) -> bool;
    /// `record[key] === true`.
    fn is_true(&self, key: &str) -> bool;
    /// `record[key]` when it is an object.
    fn record(&self, key: &str) -> Option<RecordRef<'_>>;
    /// The objects of the list `record[key]` (nothing when it is not a list).
    fn records(&self, key: &str) -> Vec<RecordRef<'_>>;
    /// The length of the list `record[key]`, when it is one.
    fn list_len(&self, key: &str) -> Option<usize>;
}

impl<'a> RecordRef<'a> {
    /// An empty record.
    pub fn empty<'b>() -> RecordRef<'b> {
        RecordRef(&EMPTY)
    }
    fn get(&self, key: &str) -> Option<&'a Value> {
        self.0.get(key)
    }
    pub fn has(&self, key: &str) -> bool {
        self.0.contains_key(key)
    }
    pub fn text(&self, key: &str) -> Option<&'a str> {
        self.get(key).and_then(Value::as_str)
    }
    pub fn truthy(&self, key: &str) -> bool {
        js::truthy_opt(self.get(key))
    }
    pub fn is_true(&self, key: &str) -> bool {
        self.get(key) == Some(&Value::Bool(true))
    }
    pub fn finite(&self, key: &str) -> Option<f64> {
        self.get(key).and_then(js::finite_number)
    }
    pub fn record(&self, key: &str) -> Option<RecordRef<'a>> {
        self.get(key).and_then(Value::as_object).map(RecordRef)
    }
    pub fn records(&self, key: &str) -> Vec<RecordRef<'a>> {
        self.get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .map(|item| item.as_object().map_or(RecordRef(&EMPTY), RecordRef))
                    .collect()
            })
            .unwrap_or_default()
    }
    pub fn list_len(&self, key: &str) -> Option<usize> {
        self.get(key).and_then(Value::as_array).map(Vec::len)
    }
    pub fn display(&self, key: &str) -> Option<String> {
        self.get(key)
            .filter(|value| !value.is_null())
            .map(|value| js::to_js_string(Some(value)))
    }
    pub fn pretty(&self, key: &str) -> Option<String> {
        self.get(key)
            .and_then(|value| serde_json::to_string_pretty(value).ok())
    }
    /// A copy of these fields, keeping only those `keep` accepts (in
    /// order, at most `limit`).
    pub fn filtered(&self, limit: usize, keep: impl Fn(&str) -> bool) -> Record {
        Record(
            self.0
                .iter()
                .filter(|(key, _)| keep(key))
                .take(limit)
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        )
    }
}

/// How much of an open record [`RecordRef::bounded_json`] writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JsonBudget {
    /// UTF-16 units of string content, in all.
    pub text: usize,
    /// Values, in all.
    pub nodes: usize,
    /// Entries of one list or record.
    pub collection: usize,
    /// Nesting below the record.
    pub depth: usize,
    /// UTF-16 units of one string.
    pub string: usize,
    /// UTF-16 units of one key.
    pub key: usize,
    /// UTF-16 units of the result.
    pub output: usize,
}

impl RecordRef<'_> {
    /// `JSON.stringify(bounded, null, 2)`: the record written within
    /// `budget` — long strings end in `…`, values past a budget read
    /// `"[truncated]"`. `None` when nothing remains of it.
    pub fn bounded_json(&self, budget: JsonBudget) -> Option<String> {
        struct State {
            chars: usize,
            nodes: usize,
        }
        fn bound(value: &Value, budget: &JsonBudget, state: &mut State, depth: usize) -> Value {
            if state.nodes == 0 || state.chars == 0 || depth > budget.depth {
                return Value::from("[truncated]");
            }
            state.nodes -= 1;
            match value {
                Value::String(string) => {
                    let length16 = text::len16(string);
                    let length = length16.min(state.chars).min(budget.string);
                    state.chars -= length;
                    if length16 > length {
                        Value::from(format!(
                            "{}…",
                            text::head16(string, length.saturating_sub(1))
                        ))
                    } else {
                        value.clone()
                    }
                }
                Value::Array(entries) => Value::Array(
                    entries
                        .iter()
                        .take(budget.collection)
                        .map(|entry| bound(entry, budget, state, depth + 1))
                        .collect(),
                ),
                Value::Object(entries) => {
                    let mut next = Map::new();
                    for (key, entry) in entries.iter().take(budget.collection) {
                        if state.nodes == 0 || state.chars == 0 {
                            next.insert("…".into(), Value::from("[truncated]"));
                            break;
                        }
                        next.insert(
                            text::head16(key, budget.key).to_string(),
                            bound(entry, budget, state, depth + 1),
                        );
                    }
                    Value::Object(next)
                }
                _ => value.clone(),
            }
        }
        let mut state = State {
            chars: budget.text,
            nodes: budget.nodes,
        };
        let bounded = bound(&Value::Object(self.0.clone()), &budget, &mut state, 0);
        let object = bounded.as_object()?;
        if object.is_empty() {
            return None;
        }
        let serialized = serde_json::to_string_pretty(&bounded).ok()?;
        Some(text::head16(&serialized, budget.output).to_string())
    }
}
