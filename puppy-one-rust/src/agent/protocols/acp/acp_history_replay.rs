//! `protocols/acp/acp-history-replay.mjs`: captures `session/load` replay
//! without creating a second ACP content mapper.
//!
//! Replay owns historical turn boundaries, ordering and bounds. Every native
//! content update is still translated by the same [`AcpEventNormalizer`] used
//! by live turns. This object is process-local and has no persistence path.
use super::acp_event_normalizer::AcpEventNormalizer;
use crate::agent::contract::js::{self, Obj};
use regex::Regex;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

const MAX_HISTORY_TURNS: usize = 128;
const MAX_HISTORY_CONTENT_EVENTS: usize = 9_000;
const MAX_HISTORY_PROMPT_LENGTH: usize = 32 * 1024;
const MAX_EVENTS: usize = 10_000;

static SAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("pattern"));

struct Turn {
    id: String,
    user_message_id: Option<String>,
    prompt: String,
    events: Vec<Value>,
    normalizer: AcpEventNormalizer,
}

/// `new AcpHistoryReplay()`.
#[derive(Default)]
pub struct AcpHistoryReplay {
    turns: Vec<Turn>,
    /// `replay.truncated`.
    pub truncated: bool,
    current: Option<usize>,
    user_turns: HashMap<String, usize>,
    turn_ids: HashSet<String>,
    accepting_anonymous_user_chunks: bool,
    content_event_count: usize,
}

fn safe_id(value: Option<&str>) -> Option<String> {
    value.filter(|v| SAFE_ID.is_match(v)).map(str::to_string)
}

impl AcpHistoryReplay {
    pub fn new() -> Self {
        Self::default()
    }

    /// `replay.accept(notification)`.
    pub fn accept(&mut self, notification: &Value) {
        let Some(update) = notification
            .get("update")
            .filter(|u| u.is_object() || u.is_array())
        else {
            return;
        };
        if update.get("sessionUpdate").and_then(Value::as_str) == Some("user_message_chunk") {
            self.accept_user_chunk(update);
            return;
        }
        self.accepting_anonymous_user_chunks = false;
        let turn = match self.current {
            Some(turn) => Some(turn),
            None => self.create_turn(None),
        };
        let Some(turn) = turn else { return };
        let events = self.turns[turn].normalizer.normalize(notification);
        self.append_events(turn, events);
    }

    /// `replay.events(providerSessionId)`.
    pub fn events(&mut self, provider_session_id: Option<&str>) -> Vec<Value> {
        let session = provider_session_id.map_or(Value::Null, Value::from);
        let mut result: Vec<Value> = Vec::new();
        let mut truncated = false;
        'turns: for turn in &self.turns {
            let started = json!({
                "type": "turn.started",
                "providerSessionId": session,
                "turnId": turn.id,
                "itemId": null,
                "payload": Obj::new()
                    .set("prompt", turn.prompt.as_str())
                    .set("restored", true)
                    .opt("userMessageId", turn.user_message_id.clone())
                    .build(),
            });
            if !append_bounded_event(&mut result, started) {
                truncated = true;
                break;
            }
            for historical in &turn.events {
                if !append_bounded_event(&mut result, historical.clone()) {
                    truncated = true;
                    break;
                }
            }
            if result.len() >= MAX_EVENTS {
                break;
            }
            for completion in turn.normalizer.complete_assistant(provider_session_id) {
                if !append_bounded_event(&mut result, completion) {
                    truncated = true;
                    break;
                }
            }
            if result.len() >= MAX_EVENTS {
                break 'turns;
            }
        }
        self.truncated = self.truncated || truncated;
        result
    }

    fn accept_user_chunk(&mut self, update: &Value) {
        let native_message_id = safe_id(update.get("messageId").and_then(Value::as_str));
        let mut turn = native_message_id
            .as_ref()
            .and_then(|id| self.user_turns.get(id).copied());
        if turn.is_none() && native_message_id.is_none() && self.accepting_anonymous_user_chunks {
            turn = self.current;
        }
        let turn = match turn {
            Some(turn) => turn,
            None => {
                let Some(turn) = self.create_turn(native_message_id.clone()) else {
                    return;
                };
                if let Some(id) = native_message_id.clone() {
                    self.user_turns.insert(id, turn);
                }
                turn
            }
        };
        self.current = Some(turn);
        self.accepting_anonymous_user_chunks = native_message_id.is_none();
        let delta = content_text(update.get("content"));
        let prompt = &mut self.turns[turn].prompt;
        if js::len16(prompt) + js::len16(&delta) > MAX_HISTORY_PROMPT_LENGTH {
            self.truncated = true;
        }
        *prompt = append_bounded(prompt, &delta, MAX_HISTORY_PROMPT_LENGTH);
    }

    fn create_turn(&mut self, native_message_id: Option<String>) -> Option<usize> {
        if self.turns.len() >= MAX_HISTORY_TURNS {
            self.truncated = true;
            return None;
        }
        let base = format!(
            "history-{}",
            native_message_id
                .clone()
                .unwrap_or_else(|| (self.turns.len() + 1).to_string())
        );
        let id = unique_id(&base, &self.turn_ids);
        self.turn_ids.insert(id.clone());
        self.turns.push(Turn {
            normalizer: AcpEventNormalizer::new(Some(&id)),
            id,
            user_message_id: native_message_id,
            prompt: String::new(),
            events: Vec::new(),
        });
        let index = self.turns.len() - 1;
        self.current = Some(index);
        Some(index)
    }

    fn append_events(&mut self, turn: usize, events: Vec<Value>) {
        let remaining = MAX_HISTORY_CONTENT_EVENTS.saturating_sub(self.content_event_count);
        if remaining == 0 {
            if !events.is_empty() {
                self.truncated = true;
            }
            return;
        }
        let total = events.len();
        let accepted: Vec<Value> = events.into_iter().take(remaining).collect();
        self.content_event_count += accepted.len();
        if accepted.len() != total {
            self.truncated = true;
        }
        self.turns[turn].events.extend(accepted);
    }
}

fn content_text(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };
    match content.get("type").and_then(Value::as_str) {
        Some("text") => content
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        Some("resource") => content
            .get("resource")
            .and_then(|r| r.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        Some("resource_link") => {
            let value = ["title", "name", "uri"]
                .iter()
                .filter_map(|key| content.get(*key))
                .find(|value| js::truthy(value));
            value
                .and_then(Value::as_str)
                .map(|s| js::head16(s, 4_096).to_string())
                .unwrap_or_default()
        }
        _ => String::new(),
    }
}

fn unique_id(base: &str, used: &HashSet<String>) -> String {
    let safe_base = safe_id(Some(base)).unwrap_or_else(|| format!("history-{}", used.len() + 1));
    if !used.contains(&safe_base) {
        return safe_base;
    }
    let mut suffix = 2;
    while used.contains(&format!("{safe_base}-{suffix}")) {
        suffix += 1;
    }
    format!("{safe_base}-{suffix}")
}

fn append_bounded(previous: &str, delta: &str, limit: usize) -> String {
    let remaining = limit.saturating_sub(js::len16(previous));
    if remaining > 0 {
        format!("{previous}{}", js::head16(delta, remaining))
    } else {
        js::head16(previous, limit).to_string()
    }
}

fn append_bounded_event(events: &mut Vec<Value>, value: Value) -> bool {
    if events.len() >= MAX_EVENTS {
        return false;
    }
    events.push(value);
    true
}
