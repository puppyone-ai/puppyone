//! `protocols/pi-rpc/pi-event-normalizer.mjs`: Pi's native session event
//! stream in the shared adapter-event dialect.
use crate::agent::agent_events::{bound_renderer_value, redact_secret_text, redact_secrets};
use crate::agent::contract::js::{self, Obj};
use crate::agent::runtime::agent_file_change_evidence::create_agent_file_change_evidence;
use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

static SAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("pattern"));
static NAMESPACE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9-]{1,80}$").expect("pattern"));
static TOOL_SEPARATORS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\s_-]+").expect("pattern"));
static HUNK_HEADER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^@@(?:\s|$)").expect("pattern"));
static NUMBERED_CHANGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[+-]\s*\d+ ").expect("pattern"));
static NUMBERED_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([ +\-])\s*\d+ (.*)$").expect("pattern"));
static ELLIPSIS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s+\.\.\.$").expect("pattern"));

/// A tool's remembered metadata.
#[derive(Clone, Debug, Default)]
pub struct PiToolState {
    pub tool_name: String,
    pub args: Map<String, Value>,
    pub output: String,
}

/// `createPiEventState({ turnId, providerSessionId, namespace, runtimeLabel })`.
#[derive(Clone, Debug, Default)]
pub struct PiEventState {
    pub turn_id: Option<String>,
    pub provider_session_id: Option<String>,
    pub namespace: String,
    pub runtime_label: String,
    reasoning_blocks: HashSet<i64>,
    pub tools: HashMap<String, PiToolState>,
    pub terminal: bool,
    compaction_failure: Option<String>,
    assistant_failure: Option<String>,
    retry_failure: Option<String>,
    pub interrupt_requested: bool,
    /// `state.startAccepted` (the adapter's).
    pub start_accepted: bool,
    /// `state.clientUserMessageId` (the adapter's).
    pub client_user_message_id: Option<String>,
}

impl PiEventState {
    pub fn new(
        turn_id: Option<&str>,
        provider_session_id: Option<&str>,
        namespace: &str,
        runtime_label: &str,
    ) -> Self {
        let label = text(Some(&Value::from(runtime_label)));
        Self {
            turn_id: turn_id.map(str::to_string),
            provider_session_id: provider_session_id.map(str::to_string),
            namespace: safe_namespace(namespace),
            runtime_label: if label.is_empty() { "Pi".into() } else { label },
            ..Default::default()
        }
    }

    fn turn(&self) -> &str {
        self.turn_id
            .as_deref()
            .filter(|t| !t.is_empty())
            .unwrap_or("turn")
    }
}

fn safe_id(value: Option<&str>) -> Option<String> {
    value.filter(|v| SAFE_ID.is_match(v)).map(str::to_string)
}

fn safe_namespace(value: &str) -> String {
    if NAMESPACE.is_match(value) {
        value.to_string()
    } else {
        "pi".into()
    }
}

/// `text(value)`: a string, at most 32 KiB of UTF-16 units.
fn text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(|s| js::head16(s, 32 * 1024).to_string())
        .unwrap_or_default()
}

fn record(value: Option<&Value>) -> Map<String, Value> {
    value
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn as_array(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn positive_integer(value: Option<&Value>) -> i64 {
    value
        .and_then(js::safe_integer)
        .filter(|n| *n > 0)
        .unwrap_or(0)
}

fn non_negative_number(value: Option<&Value>) -> f64 {
    let number = js::to_number(value);
    if number.is_finite() && number >= 0.0 {
        number
    } else {
        0.0
    }
}

/// `str.slice(-limit)` in UTF-16 units.
fn last16(value: &str, limit: usize) -> String {
    js::tail16(value, js::len16(value).saturating_sub(limit)).to_string()
}

fn event(kind: &str, state: &PiEventState, item_id: Option<&str>, payload: Value) -> Value {
    json!({
        "type": kind,
        "providerSessionId": safe_id(state.provider_session_id.as_deref()),
        "turnId": safe_id(state.turn_id.as_deref()),
        "itemId": safe_id(item_id),
        "payload": if payload.is_null() { json!({}) } else { payload },
    })
}

/// `normalizePiRpcEvent(message, state)`.
pub fn normalize_pi_rpc_event(message: &Value, state: &mut PiEventState) -> Vec<Value> {
    if !message.is_object() || state.terminal {
        return Vec::new();
    }
    let field = |key: &str| message.get(key);
    match field("type").and_then(Value::as_str) {
        Some("message_update") => normalize_message_update(message, state),
        Some("message_end") => normalize_message_end(field("message"), state),
        Some("tool_execution_start") => start_tool(
            field("toolCallId").and_then(Value::as_str),
            field("toolName"),
            field("args"),
            state,
        ),
        Some("tool_execution_update") => update_tool(message, state),
        Some("tool_execution_end") => finish_tool(message, state),
        Some("auto_retry_start") => vec![event(
            "provider.connection.updated",
            state,
            None,
            json!({
                "state": "reconnecting",
                "message": format!("{} is retrying the model request.", state.runtime_label),
                "attempt": positive_integer(field("attempt")),
                "maxAttempts": positive_integer(field("maxAttempts")),
                "retryDelayMs": js::number(non_negative_number(field("delayMs"))),
                "diagnostic": redact_secret_text(&text(field("errorMessage"))),
            }),
        )],
        Some("auto_retry_end") => {
            if field("success") == Some(&Value::Bool(true)) {
                state.retry_failure = None;
                return vec![event(
                    "provider.connection.updated",
                    state,
                    None,
                    json!({ "state": "connected" }),
                )];
            }
            let failure = text(field("finalError"));
            let failure = if failure.is_empty() {
                format!("{} exhausted its automatic retries.", state.runtime_label)
            } else {
                failure
            };
            state.retry_failure = Some(failure.clone());
            vec![event(
                "provider.error",
                state,
                None,
                json!({ "message": redact_secret_text(&failure), "recoverable": true }),
            )]
        }
        Some("compaction_start") => vec![event(
            "provider.activity",
            state,
            Some(&format!("{}:compaction", state.namespace)),
            json!({
                "category": "compaction",
                "label": "Compacting context",
                "status": "running",
                "reason": text(field("reason")),
            }),
        )],
        Some("compaction_end") => {
            if js::truthy_opt(field("errorMessage")) {
                state.compaction_failure = Some(text(field("errorMessage")));
            }
            let status = if js::truthy_opt(field("aborted")) {
                "cancelled"
            } else if js::truthy_opt(field("errorMessage")) {
                "failed"
            } else {
                "completed"
            };
            vec![event(
                "provider.activity",
                state,
                Some(&format!("{}:compaction", state.namespace)),
                json!({
                    "category": "compaction",
                    "label": "Compacting context",
                    "status": status,
                    "reason": text(field("reason")),
                }),
            )]
        }
        Some("extension_error") => {
            let error = text(field("error"));
            let message = if error.is_empty() {
                format!("A {} extension failed.", state.runtime_label)
            } else {
                error
            };
            vec![event(
                "provider.warning",
                state,
                None,
                json!({
                    "message": redact_secret_text(&message),
                    "extension": safe_path_label(field("extensionPath")),
                    "recoverable": true,
                }),
            )]
        }
        Some("agent_end") => {
            let last = as_array(field("messages"))
                .iter()
                .rfind(|m| m.get("role").and_then(Value::as_str) == Some("assistant"))
                .cloned();
            remember_assistant_outcome(last.as_ref(), state);
            Vec::new()
        }
        Some("agent_settled") => settle_turn(state),
        _ => Vec::new(),
    }
}

/// `normalizePiHistory(messages, providerSessionId, { namespace, runtimeLabel })`.
pub fn normalize_pi_history(
    messages: &[Value],
    provider_session_id: Option<&str>,
    namespace: Option<&str>,
    runtime_label: Option<&str>,
) -> Vec<Value> {
    let namespace = safe_namespace(namespace.unwrap_or("pi"));
    let label = runtime_label
        .map(|l| text(Some(&Value::from(l))))
        .filter(|l| !l.is_empty());
    let label = label.unwrap_or_else(|| "Pi".into());
    let mut events = Vec::new();
    let mut turn_id: Option<String> = None;
    let mut turn_number = 0;
    let mut tools: HashMap<String, PiToolState> = HashMap::new();
    let open = |turn: &str| PiEventState::new(Some(turn), provider_session_id, &namespace, &label);
    for message in messages {
        let role = message.get("role").and_then(Value::as_str);
        if role == Some("user") {
            // Snapshot grouping has no native execution-outcome evidence.
            tools.clear();
            turn_number += 1;
            let id = format!("{namespace}:history:{turn_number}");
            events.push(event(
                "turn.started",
                &open(&id),
                None,
                json!({ "status": "running", "prompt": message_text(message), "restored": true }),
            ));
            turn_id = Some(id);
            continue;
        }
        let id = match turn_id.clone() {
            Some(id) => id,
            None => {
                turn_number += 1;
                let id = format!("{namespace}:history:{turn_number}");
                events.push(event(
                    "turn.started",
                    &open(&id),
                    None,
                    json!({ "status": "running", "restored": true }),
                ));
                turn_id = Some(id.clone());
                id
            }
        };
        let mut state = open(&id);
        state.tools = std::mem::take(&mut tools);
        match role {
            Some("assistant") => {
                events.extend(
                    normalize_message_end(Some(message), &mut state)
                        .into_iter()
                        .map(|mut historical| {
                            historical["payload"] =
                                js::with(&historical["payload"], "restored", true);
                            historical
                        }),
                );
            }
            Some("toolResult") => {
                let tool_call_id = safe_id(message.get("toolCallId").and_then(Value::as_str))
                    .unwrap_or_else(|| format!("{namespace}:history:tool:{}", events.len() + 1));
                let metadata =
                    state
                        .tools
                        .get(&tool_call_id)
                        .cloned()
                        .unwrap_or_else(|| PiToolState {
                            tool_name: Some(text(message.get("toolName")))
                                .filter(|n| !n.is_empty())
                                .unwrap_or_else(|| "tool".into()),
                            ..Default::default()
                        });
                let status = if js::truthy_opt(message.get("isError")) {
                    "failed"
                } else {
                    "completed"
                };
                let payload = Obj::from(&tool_payload(&metadata.tool_name, &metadata.args, status))
                    .set(
                        "outputPreview",
                        last16(&result_text(Some(message)), 32 * 1024),
                    )
                    .set("restored", true)
                    .build();
                events.push(event(
                    "tool.completed",
                    &state,
                    Some(&tool_call_id),
                    payload,
                ));
            }
            _ => {}
        }
        tools = state.tools;
    }
    events
}

fn normalize_message_update(message: &Value, state: &mut PiEventState) -> Vec<Value> {
    let empty = json!({});
    let update = message
        .get("assistantMessageEvent")
        .filter(|u| !u.is_null())
        .unwrap_or(&empty);
    let index = update
        .get("contentIndex")
        .and_then(js::safe_integer)
        .unwrap_or(0);
    let kind = update.get("type").and_then(Value::as_str).unwrap_or("");
    let item_id = format!("{}:assistant:{}:{index}", state.namespace, state.turn());
    let mut result = Vec::new();
    if kind == "text_delta"
        && let Some(delta) = update
            .get("delta")
            .and_then(Value::as_str)
            .filter(|d| !d.is_empty())
    {
        result.push(event(
            "assistant.delta",
            state,
            Some(&item_id),
            json!({ "delta": delta }),
        ));
    }
    if matches!(kind, "thinking_start" | "thinking_delta") && state.reasoning_blocks.insert(index) {
        // Pi may expose hidden provider reasoning. The shared renderer
        // receives a working boundary, never raw chain-of-thought tokens.
        let reasoning = format!(
            "{}:reasoning:{}:{index}",
            state.namespace,
            state.turn_id.clone().unwrap_or_else(|| "null".into())
        );
        result.push(event(
            "reasoning.summary.delta",
            state,
            Some(&reasoning),
            json!({ "delta": "", "boundary": true }),
        ));
    }
    if matches!(kind, "text_end" | "thinking_end" | "toolcall_end")
        && js::truthy_opt(message.get("usage"))
    {
        result.push(event(
            "usage.updated",
            state,
            None,
            normalize_usage(message.get("usage")),
        ));
    }
    result
}

fn normalize_message_end(message: Option<&Value>, state: &mut PiEventState) -> Vec<Value> {
    let Some(message) =
        message.filter(|m| m.get("role").and_then(Value::as_str) == Some("assistant"))
    else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for (index, block) in as_array(message.get("content")).iter().enumerate() {
        let index = index as i64;
        match block.get("type").and_then(Value::as_str) {
            Some("text") if !text(block.get("text")).is_empty() => {
                result.push(event(
                    "assistant.completed",
                    state,
                    Some(&format!(
                        "{}:assistant:{}:{index}",
                        state.namespace,
                        state.turn()
                    )),
                    json!({ "text": block["text"] }),
                ));
            }
            Some("thinking") if !state.reasoning_blocks.contains(&index) => {
                state.reasoning_blocks.insert(index);
                result.push(event(
                    "reasoning.summary.delta",
                    state,
                    Some(&format!(
                        "{}:reasoning:{}:{index}",
                        state.namespace,
                        state.turn()
                    )),
                    json!({ "delta": "", "boundary": true }),
                ));
            }
            Some("toolCall") => result.extend(start_tool(
                block.get("id").and_then(Value::as_str),
                block.get("name"),
                block.get("arguments"),
                state,
            )),
            _ => {}
        }
    }
    if js::truthy_opt(message.get("usage")) {
        result.push(event(
            "usage.updated",
            state,
            None,
            normalize_usage(message.get("usage")),
        ));
    }
    remember_assistant_outcome(Some(message), state);
    result
}

fn start_tool(
    tool_call_id: Option<&str>,
    tool_name: Option<&Value>,
    args: Option<&Value>,
    state: &mut PiEventState,
) -> Vec<Value> {
    let id = safe_id(tool_call_id)
        .unwrap_or_else(|| format!("{}:tool:{}", state.namespace, state.tools.len() + 1));
    let previous = state.tools.get(&id).cloned();
    let name = Some(text(tool_name)).filter(|n| !n.is_empty());
    let tool_name = name
        .or_else(|| previous.as_ref().map(|p| p.tool_name.clone()))
        .unwrap_or_else(|| "tool".into());
    let args = record(args);
    let args = if !args.is_empty() {
        args
    } else {
        previous
            .as_ref()
            .map(|p| p.args.clone())
            .unwrap_or_default()
    };
    let output = previous
        .as_ref()
        .map(|p| p.output.clone())
        .unwrap_or_default();
    state.tools.insert(
        id.clone(),
        PiToolState {
            tool_name: tool_name.clone(),
            args: args.clone(),
            output,
        },
    );
    let kind = if previous.is_some() {
        "tool.progress"
    } else {
        "tool.started"
    };
    vec![event(
        kind,
        state,
        Some(&id),
        tool_payload(&tool_name, &args, "running"),
    )]
}

fn update_tool(message: &Value, state: &mut PiEventState) -> Vec<Value> {
    let Some(id) = safe_id(message.get("toolCallId").and_then(Value::as_str)) else {
        return Vec::new();
    };
    let previous = state
        .tools
        .get(&id)
        .cloned()
        .unwrap_or_else(|| PiToolState {
            tool_name: Some(text(message.get("toolName")))
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "tool".into()),
            args: record(message.get("args")),
            output: String::new(),
        });
    let output = result_text(message.get("partialResult"));
    let delta = output
        .strip_prefix(previous.output.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| output.clone());
    state.tools.insert(
        id.clone(),
        PiToolState {
            output: output.clone(),
            ..previous.clone()
        },
    );
    let mut result = vec![event(
        "tool.progress",
        state,
        Some(&id),
        Obj::from(&tool_payload(
            &previous.tool_name,
            &previous.args,
            "running",
        ))
        .set("outputPreview", last16(&output, 32 * 1024))
        .build(),
    )];
    if canonical_tool_name(&previous.tool_name) == "bash" && !delta.is_empty() {
        result.push(event(
            "command.output.delta",
            state,
            Some(&id),
            json!({ "delta": last16(&delta, 32 * 1024) }),
        ));
    }
    result
}

fn finish_tool(message: &Value, state: &mut PiEventState) -> Vec<Value> {
    let id = safe_id(message.get("toolCallId").and_then(Value::as_str))
        .unwrap_or_else(|| format!("{}:tool:{}", state.namespace, state.tools.len() + 1));
    let previous = state
        .tools
        .get(&id)
        .cloned()
        .unwrap_or_else(|| PiToolState {
            tool_name: Some(text(message.get("toolName")))
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "tool".into()),
            args: record(message.get("args")),
            output: String::new(),
        });
    let output = result_text(message.get("result"));
    state.tools.remove(&id);
    let status = if js::truthy_opt(message.get("isError")) {
        "failed"
    } else {
        "completed"
    };
    let mut payload = tool_payload(&previous.tool_name, &previous.args, status);
    let path = tool_path(&previous.args);
    let native_diff = pi_edit_patch(message.get("result").and_then(|r| r.get("details")));
    if payload["kind"] == "file-change"
        && let (Some(path), Some(diff)) = (path.as_ref(), native_diff)
    {
        payload["changes"] = Value::Array(create_agent_file_change_evidence(&[json!({
            "path": path, "diff": diff, "basis": "native",
        })]));
    }
    let changes = payload.get("changes").cloned();
    let mut result = vec![event(
        "tool.completed",
        state,
        Some(&id),
        Obj::from(&payload)
            .set("outputPreview", last16(&output, 32 * 1024))
            .build(),
    )];
    if path.is_some()
        && matches!(
            canonical_tool_name(&previous.tool_name).as_str(),
            "edit" | "write"
        )
    {
        result.push(event(
            "file.change.updated",
            state,
            Some(&id),
            Obj::new()
                .set("status", status)
                .opt("changes", changes)
                .build(),
        ));
    }
    result
}

fn settle_turn(state: &mut PiEventState) -> Vec<Value> {
    if state.terminal {
        return Vec::new();
    }
    state.terminal = true;
    if state.interrupt_requested {
        return vec![event(
            "turn.interrupted",
            state,
            None,
            json!({ "status": "interrupted" }),
        )];
    }
    let failure = [
        &state.compaction_failure,
        &state.retry_failure,
        &state.assistant_failure,
    ]
    .into_iter()
    .flatten()
    .find(|failure| !failure.is_empty())
    .cloned();
    if let Some(failure) = failure {
        let message = redact_secret_text(&failure);
        return vec![
            event(
                "provider.error",
                state,
                None,
                json!({ "message": message, "recoverable": true }),
            ),
            event(
                "turn.failed",
                state,
                None,
                json!({ "status": "failed", "message": message }),
            ),
        ];
    }
    vec![event(
        "turn.completed",
        state,
        None,
        json!({ "status": "completed" }),
    )]
}

/// A retry replaces the model result. It cannot erase an unrelated
/// compaction failure, and `auto_retry_end` alone cannot prove the latest
/// assistant succeeded.
fn remember_assistant_outcome(assistant: Option<&Value>, state: &mut PiEventState) {
    let Some(assistant) = assistant else { return };
    let stop_reason = text(assistant.get("stopReason")).to_lowercase();
    let failed = js::truthy_opt(assistant.get("errorMessage"))
        || matches!(stop_reason.as_str(), "error" | "aborted");
    state.assistant_failure = failed.then(|| {
        let message = text(assistant.get("errorMessage"));
        if message.is_empty() {
            format!("{} stopped with {stop_reason}.", state.runtime_label)
        } else {
            message
        }
    });
}

fn tool_payload(name: &str, args: &Map<String, Value>, status: &str) -> Value {
    let args_value = Value::Object(args.clone());
    let safe_input = bound_renderer_value(&redact_secrets(&args_value));
    let tool = canonical_tool_name(name);
    let mut payload = Obj::new()
        .set("kind", tool_kind(&tool))
        .set("tool", tool.as_str())
        .set("label", tool_label(name, &safe_input))
        .set("status", status);
    if matches!(tool.as_str(), "edit" | "write") {
        let after = if tool == "write" {
            args.get("content").cloned()
        } else {
            args.get("newText").cloned()
        };
        let fragments = (tool == "edit")
            .then(|| args.get("edits").and_then(Value::as_array))
            .flatten()
            .map(|edits| {
                Value::Array(
                    edits
                        .iter()
                        .take(101)
                        .map(|edit| {
                            Obj::new()
                                .opt("before", edit.get("oldText").cloned())
                                .opt("after", edit.get("newText").cloned())
                                .build()
                        })
                        .collect(),
                )
            });
        let entry = Obj::new()
            .opt("path", tool_path(args))
            .opt("before", args.get("oldText").cloned())
            .opt("after", after)
            .opt("fragments", fragments)
            .set("scope", "fragment")
            .set("basis", "request")
            .build();
        payload = payload.set("changes", create_agent_file_change_evidence(&[entry]));
    }
    let command = text(safe_input.get("command"));
    let safe_record = safe_input.as_object().cloned().unwrap_or_default();
    payload
        .set("input", safe_input)
        .set("path", tool_path(&safe_record))
        .set(
            "command",
            if command.is_empty() {
                Value::Null
            } else {
                Value::from(command)
            },
        )
        .build()
}

/// Pi exposes both a unified patch and a terminal-oriented diff with
/// line-number columns. Its native display format is decoded here, never in
/// the common Renderer.
fn pi_edit_patch(details: Option<&Value>) -> Option<String> {
    let details = details?;
    if let Some(patch) = details.get("patch").and_then(Value::as_str) {
        return Some(patch.to_string());
    }
    let diff = details.get("diff").and_then(Value::as_str)?;
    if HUNK_HEADER.is_match(diff) {
        return Some(diff.to_string());
    }
    let lines: Vec<&str> = diff
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();
    if !lines.iter().any(|line| NUMBERED_CHANGE.is_match(line)) {
        return Some(diff.to_string());
    }
    Some(
        lines
            .iter()
            .map(|line| match NUMBERED_LINE.captures(line) {
                Some(captures) => format!("{}{}", &captures[1], &captures[2]),
                None if ELLIPSIS.is_match(line) => "@@".into(),
                None => line.to_string(),
            })
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

fn tool_kind(name: &str) -> &'static str {
    match name {
        "bash" => "command",
        "read" => "read",
        "find" | "grep" | "ls" => "search",
        "edit" | "write" => "file-change",
        _ => "tool",
    }
}

fn tool_label(name: &str, args: &Value) -> String {
    let normalized = canonical_tool_name(name);
    if normalized == "bash" {
        let command = js::head16(&text(args.get("command")), 240).to_string();
        return if command.is_empty() {
            "Run command".into()
        } else {
            command
        };
    }
    let label = text(Some(&Value::from(name)));
    let label = if label.is_empty() {
        "Tool".to_string()
    } else {
        label
    };
    match tool_path(&args.as_object().cloned().unwrap_or_default()) {
        Some(filename) => format!("{label} {filename}"),
        None => label,
    }
}

fn canonical_tool_name(value: &str) -> String {
    let normalized = TOOL_SEPARATORS
        .replace_all(&text(Some(&Value::from(value))).trim().to_lowercase(), "")
        .into_owned();
    match normalized.as_str() {
        "shell" | "powershell" => "bash".into(),
        "multiedit" => "edit".into(),
        "list" => "ls".into(),
        "search" => "grep".into(),
        "" => "tool".into(),
        _ => normalized,
    }
}

fn tool_path(value: &Map<String, Value>) -> Option<String> {
    let candidate = ["path", "filePath", "file_path"]
        .iter()
        .filter_map(|key| value.get(*key))
        .find(|value| js::truthy(value));
    Some(text(candidate)).filter(|path| !path.is_empty())
}

fn result_text(value: Option<&Value>) -> String {
    if let Some(Value::String(text_value)) = value {
        return redact_secret_text(text_value);
    }
    let parts: Vec<String> = as_array(value.and_then(|v| v.get("content")))
        .iter()
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
        .map(|part| text(part.get("text")))
        .collect();
    redact_secret_text(&parts.join("\n"))
}

fn message_text(message: &Value) -> String {
    if let Some(Value::String(content)) = message.get("content") {
        return text(Some(&Value::from(content.as_str())));
    }
    as_array(message.get("content"))
        .iter()
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
        .map(|part| text(part.get("text")))
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_usage(value: Option<&Value>) -> Value {
    let field = |key: &str| value.and_then(|v| v.get(key));
    bound_renderer_value(&json!({
        "inputTokens": js::number(non_negative_number(field("input"))),
        "outputTokens": js::number(non_negative_number(field("output"))),
        "cachedTokens": js::number(non_negative_number(field("cacheRead")) + non_negative_number(field("cacheWrite"))),
        "totalTokens": js::number(non_negative_number(field("totalTokens"))),
        "cost": field("cost").cloned().unwrap_or(Value::Null),
    }))
}

fn safe_path_label(value: Option<&Value>) -> Value {
    text(value)
        .split(['\\', '/'])
        .rfind(|segment| !segment.is_empty())
        .map_or(Value::Null, Value::from)
}
