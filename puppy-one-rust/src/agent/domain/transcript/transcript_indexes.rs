//! `transcript/transcript-indexes.mjs`: a projection under revision and its
//! lazily rebuilt positional indexes.
use crate::agent::contract::display_types::{AgentDisplay, Entry};
use crate::agent::contract::js;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Default)]
pub struct Indexes {
    pub messages: HashMap<String, usize>,
    pub messages_by_turn: HashMap<String, Vec<usize>>,
    pub activities: HashMap<String, usize>,
    pub turns: HashMap<String, usize>,
    pub parts: HashMap<String, usize>,
    pub rows: HashMap<String, usize>,
}

/// `cloneAgentProjection(value)` and the non-serializable indexes the
/// product hangs on it: a revision of a display that is being reduced.
pub struct Projection {
    pub d: AgentDisplay,
    indexes: Option<Indexes>,
}

fn id_of(entry: &Value) -> String {
    js::str_or_empty(entry.get("id")).to_string()
}

impl Projection {
    /// `cloneAgentProjection(value)`: collections are copied, entries shared.
    pub fn new(display: &AgentDisplay) -> Self {
        Self {
            d: display.clone(),
            indexes: None,
        }
    }

    pub fn into_display(self) -> AgentDisplay {
        self.d
    }

    /// `projectionIndexes(projection)`.
    pub fn indexes(&mut self) -> &mut Indexes {
        self.split().1
    }

    /// The display and its indexes, both writable.
    pub fn split(&mut self) -> (&mut AgentDisplay, &mut Indexes) {
        if self.indexes.is_none() {
            let d = &self.d;
            let mut messages_by_turn: HashMap<String, Vec<usize>> = HashMap::new();
            for (index, message) in d.messages.iter().enumerate() {
                if let Some(turn) = message
                    .get("turnId")
                    .and_then(Value::as_str)
                    .filter(|t| !t.is_empty())
                {
                    messages_by_turn
                        .entry(turn.to_string())
                        .or_default()
                        .push(index);
                }
            }
            let positions = |entries: &[Entry]| {
                entries
                    .iter()
                    .enumerate()
                    .map(|(index, entry)| (id_of(entry), index))
                    .collect::<HashMap<_, _>>()
            };
            self.indexes = Some(Indexes {
                messages: positions(&d.messages),
                messages_by_turn,
                activities: positions(&d.activities),
                turns: positions(&d.turns),
                parts: positions(&d.parts),
                rows: positions(&d.rows),
            });
        }
        (
            &mut self.d,
            self.indexes.as_mut().expect("indexes are built"),
        )
    }

    /// `invalidateProjectionIndexes(projection)`.
    pub fn invalidate(&mut self) {
        self.indexes = None;
    }
}

/// `{ ...entry, ...changes }` as a new shared entry.
pub fn revise(entry: &Entry, change: impl FnOnce(&mut serde_json::Map<String, Value>)) -> Entry {
    let mut map = entry.as_object().cloned().unwrap_or_default();
    change(&mut map);
    Arc::new(Value::Object(map))
}

/// A new shared entry.
pub fn entry(value: Value) -> Entry {
    Arc::new(value)
}
