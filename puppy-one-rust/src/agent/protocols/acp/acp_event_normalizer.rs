//! `protocols/acp/acp-event-normalizer.mjs`: ACP `session/update`
//! notifications as adapter events.
use crate::agent::agent_events::{bound_renderer_value, redact_secret_text, redact_secrets};
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::native_session_id::native_session_id;
use crate::agent::runtime::agent_file_change_evidence::create_agent_file_change_evidence;
use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

const MESSAGE_LIMIT: usize = 512 * 1024;
static SAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("pattern"));
static TITLE_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([a-z][a-z0-9_-]*)").expect("pattern"));
static TOKEN_SEPARATORS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[_-]+").expect("pattern"));
static GLOB_TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"glob|files?").expect("pattern"));
static GREP_TITLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"grep|search|find").expect("pattern"));

#[derive(Clone, Debug)]
struct MessageState {
    role: &'static str,
    text: String,
    truncated: bool,
}

#[derive(Clone, Debug)]
struct ToolState {
    started: bool,
    output: String,
    status: String,
    locations: Vec<Value>,
    changes: Vec<Value>,
    kind: String,
    tool: String,
    label: String,
    input: Map<String, Value>,
}

impl Default for ToolState {
    fn default() -> Self {
        Self {
            started: false,
            output: String::new(),
            status: "pending".into(),
            locations: Vec::new(),
            changes: Vec::new(),
            kind: "tool".into(),
            tool: "tool".into(),
            label: "Tool".into(),
            input: Map::new(),
        }
    }
}

/// `new AcpEventNormalizer({ turnId })`.
#[derive(Clone, Debug, Default)]
pub struct AcpEventNormalizer {
    turn_id: Option<String>,
    messages: Vec<(String, MessageState)>,
    thoughts: HashSet<String>,
    tools: HashMap<String, ToolState>,
}

/// `text(value, limit)` (untrimmed).
fn text(value: Option<&Value>, limit: usize) -> String {
    value
        .and_then(Value::as_str)
        .map(|s| js::head16(s, limit).to_string())
        .unwrap_or_default()
}

fn safe_id(value: Option<&str>) -> Option<String> {
    value.filter(|v| SAFE_ID.is_match(v)).map(str::to_string)
}

fn array(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}

/// `record(value)`: an object, `{}` for an absent value, else `{ value }`.
fn record(value: Option<&Value>) -> Map<String, Value> {
    match value {
        Some(Value::Object(map)) => map.clone(),
        None => Map::new(),
        Some(other) => {
            let mut map = Map::new();
            map.insert("value".into(), other.clone());
            map
        }
    }
}

/// `number(value)`: finite and non-negative, else 0.
fn number(value: Option<&Value>) -> Value {
    let parsed = js::to_number(value);
    js::number(if parsed.is_finite() {
        parsed.max(0.0)
    } else {
        0.0
    })
}

fn event(
    kind: &str,
    provider_session_id: &Value,
    turn_id: Option<&str>,
    item_id: Option<&str>,
    payload: Value,
) -> Value {
    json!({
        "type": kind,
        "providerSessionId": provider_session_id,
        "turnId": safe_id(turn_id),
        "itemId": safe_id(item_id),
        "payload": if payload.is_null() { json!({}) } else { payload },
    })
}

/// `appendBounded(current, incoming, limit)` in UTF-16 units.
fn append_bounded(current: &str, incoming: &str, limit: usize) -> String {
    let remaining = limit.saturating_sub(js::len16(current));
    if remaining > 0 {
        format!("{current}{}", js::head16(incoming, remaining))
    } else {
        js::head16(current, limit).to_string()
    }
}

/// `str.slice(-limit)` in UTF-16 units.
fn last16(value: &str, limit: usize) -> &str {
    js::tail16(value, js::len16(value).saturating_sub(limit))
}

/// `value || fallback` over text properties.
fn first_text(content: &Value, keys: &[&str], limit: usize) -> String {
    let value = keys
        .iter()
        .filter_map(|key| content.get(*key))
        .find(|value| js::truthy(value));
    text(value, limit)
}

/// `renderContent(content, limit)`; `None` is unbounded.
fn render_content(content: Option<&Value>, limit: Option<usize>) -> String {
    let Some(content) = content.filter(|c| c.is_object() || c.is_array()) else {
        return String::new();
    };
    let limit = limit.unwrap_or(usize::MAX);
    match content.get("type").and_then(Value::as_str) {
        Some("text") => text(content.get("text"), limit),
        Some("resource")
            if content
                .get("resource")
                .and_then(|r| r.get("text"))
                .is_some_and(Value::is_string) =>
        {
            text(content["resource"].get("text"), limit)
        }
        Some("resource_link") => first_text(content, &["title", "name", "uri"], 4_096),
        Some("image") => {
            if js::truthy_opt(content.get("uri")) {
                format!("[image: {}]", text(content.get("uri"), 4_096))
            } else {
                format!("[image: {}]", text(content.get("mimeType"), 160))
            }
        }
        Some("audio") => format!("[audio: {}]", text(content.get("mimeType"), 160)),
        _ => String::new(),
    }
}

fn render_tool_output(content: Option<&Value>, raw_output: Option<&Value>) -> String {
    let rendered = array(content)
        .iter()
        .map(|part| match part.get("type").and_then(Value::as_str) {
            Some("content") => render_content(part.get("content"), Some(128 * 1024)),
            // File evidence has its own canonical field; don't add a second path-only result.
            Some("diff") => String::new(),
            Some("terminal") => format!("Terminal: {}", text(part.get("terminalId"), 512)),
            _ => String::new(),
        })
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if !rendered.is_empty() {
        return rendered;
    }
    match raw_output {
        Some(Value::String(output)) => js::head16(output, 256 * 1024).to_string(),
        None => String::new(),
        Some(output) => serde_json::to_string_pretty(output)
            .map(|json| js::head16(&json, 256 * 1024).to_string())
            .unwrap_or_else(|_| "[unserializable tool output]".into()),
    }
}

fn normalize_tool_kind(value: Option<&Value>) -> String {
    match text(value, 80).to_lowercase().as_str() {
        "execute" => "command",
        "edit" | "delete" | "move" => "file-change",
        "read" => "read",
        "search" => "search",
        "fetch" => "network",
        _ => "tool",
    }
    .into()
}

fn infer_acp_tool_name(
    kind: &str,
    label: &str,
    input: &Map<String, Value>,
    previous: &str,
) -> String {
    let title = js::head16(label, 300).trim().to_lowercase();
    let title_token = TITLE_TOKEN
        .captures(&title)
        .and_then(|captures| captures.get(1))
        .map(|token| {
            TOKEN_SEPARATORS
                .replace_all(token.as_str(), "")
                .into_owned()
        })
        .unwrap_or_default();
    for tool in [
        "bash",
        "shell",
        "read",
        "write",
        "edit",
        "grep",
        "glob",
        "webfetch",
        "websearch",
        "skill",
        "task",
    ] {
        if title_token == tool {
            return match tool {
                "shell" => "bash",
                "task" => "agent",
                other => other,
            }
            .into();
        }
    }
    let previous_named = (!previous.is_empty() && previous != "tool").then(|| previous.to_string());
    match kind {
        "command" => "bash".into(),
        "read" => "read".into(),
        "network" => "webfetch".into(),
        "file-change" => {
            if input.get("oldString").is_some_and(Value::is_string)
                || input.get("old_string").is_some_and(Value::is_string)
            {
                "edit".into()
            } else if input.get("content").is_some_and(Value::is_string) {
                "write".into()
            } else {
                previous_named.unwrap_or_else(|| "edit".into())
            }
        }
        "search" => {
            if GLOB_TITLE.is_match(&title) {
                "glob".into()
            } else if GREP_TITLE.is_match(&title) {
                "grep".into()
            } else {
                previous_named.unwrap_or_else(|| "search".into())
            }
        }
        _ => {
            if previous.is_empty() {
                "tool".into()
            } else {
                previous.into()
            }
        }
    }
}

fn tool_path(locations: &[Value], input: &Map<String, Value>) -> Value {
    let location = locations.first().and_then(|l| l.get("path"));
    let candidate = std::iter::once(location)
        .chain(
            ["path", "file_path", "filePath", "filepath"]
                .iter()
                .map(|key| input.get(*key)),
        )
        .flatten()
        .find(|value| js::truthy(value));
    let path = text(candidate, 4_096);
    if path.is_empty() {
        Value::Null
    } else {
        Value::from(path)
    }
}

fn normalize_plan_status(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_str) {
        Some("completed") => "completed",
        Some("in_progress") => "in_progress",
        _ => "pending",
    }
}

fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed")
}

impl AcpEventNormalizer {
    pub fn new(turn_id: Option<&str>) -> Self {
        Self {
            turn_id: turn_id.map(str::to_string),
            ..Default::default()
        }
    }

    /// `normalizer.reset(turnId)`.
    pub fn reset(&mut self, turn_id: Option<&str>) {
        *self = Self::new(turn_id);
    }

    fn turn(&self) -> Option<&str> {
        self.turn_id.as_deref()
    }

    /// `normalizer.normalize(notification)`.
    pub fn normalize(&mut self, notification: &Value) -> Vec<Value> {
        let session_id =
            native_session_id(notification.get("sessionId")).map_or(Value::Null, Value::from);
        let Some(update) = notification
            .get("update")
            .filter(|u| u.is_object() || u.is_array())
        else {
            return Vec::new();
        };
        match update.get("sessionUpdate").and_then(Value::as_str) {
            Some("agent_message_chunk") => self.message_chunk("assistant", &session_id, update),
            Some("agent_thought_chunk") => self.thought_boundary(&session_id, update),
            Some("user_message_chunk") => Vec::new(),
            Some("tool_call" | "tool_call_update") => self.tool_update(&session_id, update),
            Some("plan") => {
                let steps: Vec<Value> = array(update.get("entries"))
                    .iter()
                    .take(100)
                    .map(|entry| {
                        json!({
                            "step": text(entry.get("content"), 4_000),
                            "status": normalize_plan_status(entry.get("status")),
                            "priority": text(entry.get("priority"), 40),
                        })
                    })
                    .filter(|entry| entry["step"].as_str().is_some_and(|s| !s.is_empty()))
                    .collect();
                vec![event(
                    "plan.updated",
                    &session_id,
                    self.turn(),
                    Some("current-plan"),
                    json!({ "steps": steps }),
                )]
            }
            Some("usage_update") => vec![event(
                "usage.updated",
                &session_id,
                self.turn(),
                None,
                bound_renderer_value(
                    &Obj::new()
                        .set(
                            "contextWindow",
                            json!({ "size": number(update.get("size")), "used": number(update.get("used")) }),
                        )
                        .opt("cost", update.get("cost").filter(|c| js::truthy(c)).cloned())
                        .build(),
                ),
            )],
            Some("session_info_update") => {
                let title = text(update.get("title"), 300);
                vec![event(
                    "session.updated",
                    &session_id,
                    self.turn(),
                    None,
                    json!({
                        "title": if title.is_empty() { Value::Null } else { Value::from(title) },
                        "updatedAt": super::acp_native_values::normalize_date(update.get("updatedAt")),
                    }),
                )]
            }
            _ => Vec::new(),
        }
    }

    /// `normalizer.completeAssistant(sessionId)`.
    pub fn complete_assistant(&self, session_id: Option<&str>) -> Vec<Value> {
        let session = native_session_id(session_id.map(Value::from).as_ref())
            .map_or(Value::Null, Value::from);
        self.messages
            .iter()
            .filter(|(_, state)| state.role == "assistant" && !state.text.is_empty())
            .map(|(item_id, state)| {
                event(
                    "assistant.completed",
                    &session,
                    self.turn(),
                    Some(item_id),
                    Obj::new()
                        .set("text", state.text.as_str())
                        .opt("truncated", state.truncated.then_some(true))
                        .build(),
                )
            })
            .collect()
    }

    fn message_chunk(
        &mut self,
        role: &'static str,
        session_id: &Value,
        update: &Value,
    ) -> Vec<Value> {
        let item_id = safe_id(update.get("messageId").and_then(Value::as_str))
            .unwrap_or_else(|| format!("{role}:{}", self.turn().unwrap_or("turn")));
        let delta = render_content(update.get("content"), None);
        if delta.is_empty() {
            return Vec::new();
        }
        let index = match self.messages.iter().position(|(id, _)| *id == item_id) {
            Some(index) => index,
            None => {
                self.messages.push((
                    item_id.clone(),
                    MessageState {
                        role,
                        text: String::new(),
                        truncated: false,
                    },
                ));
                self.messages.len() - 1
            }
        };
        let current = &mut self.messages[index].1;
        current.truncated =
            current.truncated || js::len16(&current.text) + js::len16(&delta) > MESSAGE_LIMIT;
        current.text = append_bounded(&current.text, &delta, MESSAGE_LIMIT);
        let kind = if role == "assistant" {
            "assistant.delta"
        } else {
            "reasoning.summary.delta"
        };
        vec![event(
            kind,
            session_id,
            self.turn(),
            Some(&item_id),
            json!({ "delta": delta }),
        )]
    }

    fn thought_boundary(&mut self, session_id: &Value, update: &Value) -> Vec<Value> {
        let item_id = safe_id(update.get("messageId").and_then(Value::as_str))
            .unwrap_or_else(|| format!("reasoning:{}", self.turn().unwrap_or("turn")));
        if !self.thoughts.insert(item_id.clone()) {
            return Vec::new();
        }
        // ACP thought chunks may contain hidden chain-of-thought. The UI
        // receives only a working-state boundary, never the private text.
        vec![event(
            "reasoning.summary.delta",
            session_id,
            self.turn(),
            Some(&item_id),
            json!({ "delta": "", "boundary": true, "status": "working" }),
        )]
    }

    fn tool_update(&mut self, session_id: &Value, update: &Value) -> Vec<Value> {
        let item_id = safe_id(update.get("toolCallId").and_then(Value::as_str))
            .unwrap_or_else(|| format!("acp-tool:{}", self.tools.len() + 1));
        let previous = self.tools.get(&item_id).cloned().unwrap_or_default();
        let has = |key: &str| update.get(key).is_some();
        // ACP updates are field-presence patches. Never normalize an already
        // normalized kind, or treat an empty replacement as an omitted field.
        let kind = if has("kind") {
            normalize_tool_kind(update.get("kind"))
        } else {
            previous.kind.clone()
        };
        let label = if has("title") {
            text(update.get("title"), 300)
        } else {
            previous.label.clone()
        };
        let input = if has("rawInput") {
            record(update.get("rawInput"))
        } else {
            previous.input.clone()
        };
        let tool = infer_acp_tool_name(&kind, &label, &input, &previous.tool);
        let output = if has("content") || has("rawOutput") {
            render_tool_output(update.get("content"), update.get("rawOutput"))
        } else {
            previous.output.clone()
        };
        let status = if has("status") {
            text(update.get("status"), 40)
        } else {
            previous.status.clone()
        };
        let locations = if has("locations") {
            array(update.get("locations"))
        } else {
            previous.locations.clone()
        };
        let changes = if has("content") {
            let entries: Vec<Value> = array(update.get("content"))
                .iter()
                .filter(|part| part.get("type").and_then(Value::as_str) == Some("diff"))
                .take(100)
                .map(|part| {
                    let added = part.get("oldText") == Some(&Value::Null);
                    Obj::new()
                        .opt("path", part.get("path").cloned())
                        .set("kind", if added { "add" } else { "update" })
                        .opt(
                            "before",
                            if added {
                                Some(Value::from(""))
                            } else {
                                part.get("oldText").cloned()
                            },
                        )
                        .opt("after", part.get("newText").cloned())
                        .set("basis", "native")
                        .build()
                })
                .collect();
            create_agent_file_change_evidence(&entries)
        } else {
            previous.changes.clone()
        };
        let canonical_status = match status.as_str() {
            "failed" => "failed",
            "completed" => "completed",
            "pending" => "pending",
            _ => "running",
        };
        let input_value = Value::Object(input.clone());
        let command = if kind == "command" {
            let command = text(input.get("command"), 8_192);
            if command.is_empty() {
                Value::Null
            } else {
                Value::from(command)
            }
        } else {
            Value::Null
        };
        let payload = Obj::new()
            .set("kind", kind.as_str())
            .set("tool", tool.as_str())
            .set("label", label.as_str())
            .set("status", canonical_status)
            .opt(
                "changes",
                (kind == "file-change" || !changes.is_empty()).then(|| changes.clone()),
            )
            .set("input", bound_renderer_value(&redact_secrets(&input_value)))
            .set("path", tool_path(&locations, &input))
            .set("command", command)
            .set(
                "outputPreview",
                last16(&redact_secret_text(&output), 16 * 1024),
            )
            .build();
        let mut result = Vec::new();
        let turn = self.turn().map(str::to_string);
        if !is_terminal(&status) {
            let kind = if previous.started {
                "tool.progress"
            } else {
                "tool.started"
            };
            result.push(event(
                kind,
                session_id,
                turn.as_deref(),
                Some(&item_id),
                payload.clone(),
            ));
        }
        if kind == "command" && output != previous.output {
            result.push(event(
                "command.output.delta",
                session_id,
                turn.as_deref(),
                Some(&item_id),
                json!({ "delta": redact_secret_text(&output), "updateMode": "replace" }),
            ));
        }
        if !changes.is_empty() || !previous.changes.is_empty() {
            result.push(event(
                "file.change.updated",
                session_id,
                turn.as_deref(),
                Some(&item_id),
                json!({ "status": canonical_status, "changes": changes }),
            ));
        }
        if is_terminal(&status) {
            result.push(event(
                "tool.completed",
                session_id,
                turn.as_deref(),
                Some(&item_id),
                payload,
            ));
        }
        self.tools.insert(
            item_id,
            ToolState {
                started: true,
                output,
                status,
                locations,
                changes,
                kind,
                tool,
                label,
                input,
            },
        );
        result
    }
}

/// `normalizeAcpPromptUsage(value)`.
pub fn normalize_acp_prompt_usage(value: Option<&Value>) -> Option<Value> {
    let value = value.filter(|v| v.is_object() || v.is_array())?;
    Some(bound_renderer_value(&json!({
        "inputTokens": number(value.get("inputTokens")),
        "outputTokens": number(value.get("outputTokens")),
        "totalTokens": number(value.get("totalTokens")),
        "cachedReadTokens": number(value.get("cachedReadTokens")),
        "cachedWriteTokens": number(value.get("cachedWriteTokens")),
        "thoughtTokens": number(value.get("thoughtTokens")),
    })))
}
