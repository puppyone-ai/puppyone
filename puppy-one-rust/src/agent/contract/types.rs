//! `shared/agent-contract/types.ts`: reading the canonical shapes. Events,
//! controls and display entries are plain JSON; these accessors read them
//! the way the product's property reads do (`event.turnId ?? …`).
use super::js;
use serde_json::{Map, Value};
use std::sync::LazyLock;

static EMPTY: LazyLock<Value> = LazyLock::new(|| Value::Object(Map::new()));

/// An `AgentEvent` (or a partial one an adapter reports).
pub trait AgentEventView {
    /// `event.type`.
    fn event_type(&self) -> &str;
    /// `event.sequence`.
    fn sequence(&self) -> i64;
    /// `event.turnId` when it is a string.
    fn turn_id(&self) -> Option<&str>;
    /// `event.itemId` when it is a string.
    fn item_id(&self) -> Option<&str>;
    /// `event.payload` (`{}` when absent).
    fn payload(&self) -> &Value;
    /// `event.payload[key]`.
    fn field(&self, key: &str) -> Option<&Value>;
    /// `readString(event.payload[key])`.
    fn text(&self, key: &str) -> &str;
    /// `event.turnId` as a JSON value (`null` when absent).
    fn turn_value(&self) -> Value;
    /// `event.itemId` as a JSON value (`null` when absent).
    fn item_value(&self) -> Value;
}

impl AgentEventView for Value {
    fn event_type(&self) -> &str {
        js::str_or_empty(self.get("type"))
    }
    fn sequence(&self) -> i64 {
        self.get("sequence").and_then(js::safe_integer).unwrap_or(0)
    }
    fn turn_id(&self) -> Option<&str> {
        self.get("turnId").and_then(Value::as_str)
    }
    fn item_id(&self) -> Option<&str> {
        self.get("itemId").and_then(Value::as_str)
    }
    fn payload(&self) -> &Value {
        self.get("payload")
            .filter(|p| p.is_object())
            .unwrap_or(&EMPTY)
    }
    fn field(&self, key: &str) -> Option<&Value> {
        self.payload().get(key)
    }
    fn text(&self, key: &str) -> &str {
        js::str_or_empty(self.field(key))
    }
    fn turn_value(&self) -> Value {
        self.turn_id().map_or(Value::Null, Value::from)
    }
    fn item_value(&self) -> Value {
        self.item_id().map_or(Value::Null, Value::from)
    }
}
