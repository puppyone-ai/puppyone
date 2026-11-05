//! `runtimes/claude/claude-events.mjs`: Agent SDK messages as normalized
//! Agent events. Hidden extended thinking is surfaced only as a working
//! boundary, never republished.
use crate::agent::agent_events::{bound_renderer_value, redact_secret_text, redact_secrets};
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::native_session_id::native_session_id;
use crate::agent::runtime::agent_file_change_evidence::create_agent_file_change_evidence;
use regex::Regex;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

static SAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("pattern"));
static TOOL_SEPARATORS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\s_-]+").expect("pattern"));

/// `createClaudeEventState({ turnId, resumed })`.
#[derive(Clone, Debug, Default)]
pub struct ClaudeEventState {
    pub turn_id: Option<String>,
    pub resumed: bool,
    pub lifecycle_emitted: bool,
    pub reasoning_started: bool,
    pub assistant_message_id: Option<String>,
    pub streamed_text: HashSet<String>,
    pub started_tools: HashSet<String>,
    /// `toolMetadata`: `{ name, input }` per tool id.
    pub tool_metadata: HashMap<String, (String, Value)>,
    pub terminal: bool,
}

impl ClaudeEventState {
    pub fn new(turn_id: Option<&str>, resumed: bool) -> Self {
        Self {
            turn_id: turn_id.map(str::to_string),
            resumed,
            ..Self::default()
        }
    }
}

fn safe_id(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|id| SAFE_ID.is_match(id))
        .map(str::to_string)
}

fn safe_id_str(value: Option<&str>) -> Option<String> {
    value.filter(|id| SAFE_ID.is_match(id)).map(str::to_string)
}

/// `text(value)`.
fn text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(|s| js::head16(s, 32_768).to_string())
        .unwrap_or_default()
}

fn as_array(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn record(value: Option<&Value>) -> Value {
    value
        .filter(|v| v.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}))
}

/// `Math.max(0, Number(value) || 0)`.
fn non_negative(value: Option<&Value>) -> f64 {
    let number = js::to_number(value);
    if number.is_finite() && number >= 0.0 {
        number
    } else {
        0.0
    }
}

/// `Number(value) || 0`.
fn number_or_zero(value: Option<&Value>) -> Value {
    let number = js::to_number(value);
    js::number(if number.is_nan() { 0.0 } else { number })
}

fn event(
    kind: &str,
    provider_session_id: Option<&str>,
    turn_id: Option<&str>,
    item_id: Option<&str>,
    payload: Value,
) -> Value {
    json!({
        "type": kind,
        "providerSessionId": native_session_id(provider_session_id.map(Value::from).as_ref()),
        "turnId": safe_id_str(turn_id),
        "itemId": safe_id_str(item_id),
        "payload": payload,
    })
}

/// `normalizeClaudeMessage(message, state)`.
pub fn normalize_claude_message(message: &Value, state: &mut ClaudeEventState) -> Vec<Value> {
    if !message.is_object() {
        return Vec::new();
    }
    let session = native_session_id(message.get("session_id"));
    let session_id = session.as_deref();
    let turn_id = state.turn_id.clone();
    let turn = turn_id.as_deref();
    let kind = message.get("type").and_then(Value::as_str).unwrap_or("");
    let subtype = message.get("subtype").and_then(Value::as_str);
    match (kind, subtype) {
        ("system", Some("init")) => {
            if state.lifecycle_emitted {
                return Vec::new();
            }
            state.lifecycle_emitted = true;
            vec![event(
                if state.resumed {
                    "session.resumed"
                } else {
                    "session.started"
                },
                session_id,
                turn,
                None,
                json!({
                    "title": if state.resumed { "Claude Code session" } else { "New Claude Code session" },
                    "model": text(message.get("model")),
                    "permissionMode": text(message.get("permissionMode")),
                    "version": text(message.get("claude_code_version")),
                }),
            )]
        }
        ("stream_event", _) => normalize_stream_event(message, state, session_id),
        ("assistant", _) => normalize_assistant(message, state, session_id),
        ("user", _) => normalize_tool_results(message, state, session_id),
        ("tool_progress", _) => {
            let tool_id = safe_id(message.get("tool_use_id"));
            let metadata = tool_id
                .as_ref()
                .and_then(|id| state.tool_metadata.get(id))
                .cloned();
            let name = message
                .get("tool_name")
                .filter(|n| js::truthy(n))
                .map(|n| js::to_js_string(Some(n)))
                .or_else(|| metadata.as_ref().map(|(name, _)| name.clone()));
            let input = metadata.map_or_else(|| json!({}), |(_, input)| input);
            let payload = Obj::from(&tool_payload(name.as_deref(), &input, "running"))
                .set(
                    "elapsedMs",
                    js::number(non_negative(message.get("elapsed_time_seconds")) * 1_000.0),
                )
                .build();
            vec![event(
                "tool.progress",
                session_id,
                turn,
                tool_id.as_deref(),
                payload,
            )]
        }
        ("result", _) => normalize_result(message, state, session_id),
        ("system", Some("api_retry")) => vec![event(
            "provider.connection.updated",
            session_id,
            turn,
            None,
            json!({
                "state": "reconnecting",
                "message": redact_secret_text(&truthy_text(message.get("error"))
                    .unwrap_or_else(|| "Claude Code is retrying the provider request.".into())),
                "attempt": number_or_zero(message.get("attempt")),
                "maxAttempts": number_or_zero(message.get("max_retries")),
                "retryDelayMs": number_or_zero(message.get("retry_delay_ms")),
            }),
        )],
        ("system", Some("permission_denied")) => {
            let tool_name = message.get("tool_name").and_then(Value::as_str);
            vec![event(
                "tool.completed",
                session_id,
                turn,
                safe_id(message.get("tool_use_id")).as_deref(),
                json!({
                    "kind": tool_kind(tool_name.unwrap_or("")),
                    "label": tool_label(tool_name, &json!({})),
                    "status": "declined",
                    "error": redact_secret_text(&truthy_text(message.get("decision_reason"))
                        .unwrap_or_else(|| "Permission denied.".into())),
                }),
            )]
        }
        ("system", Some("files_persisted")) => {
            let failed = as_array(message.get("failed"));
            let changes: Vec<Value> = as_array(message.get("files"))
                .iter()
                .chain(failed)
                .take(200)
                .map(|file| {
                    json!({
                        "path": js::head16(&text(file.get("filename")), 4_096),
                        "status": if js::truthy_opt(file.get("error")) { "failed" } else { "updated" },
                    })
                })
                .filter(|change| change["path"].as_str().is_some_and(|p| !p.is_empty()))
                .collect();
            vec![event(
                "file.change.updated",
                session_id,
                turn,
                Some("claude:files"),
                json!({
                    "status": if failed.is_empty() { "completed" } else { "failed" },
                    "changes": changes,
                }),
            )]
        }
        ("system", Some("local_command_output")) if !text(message.get("content")).is_empty() => {
            vec![event(
                "assistant.completed",
                session_id,
                turn,
                safe_id(message.get("uuid")).as_deref(),
                json!({ "text": message.get("content") }),
            )]
        }
        ("auth_status", _) => {
            let error = truthy_text(message.get("error"));
            let output = as_array(message.get("output"))
                .iter()
                .map(|line| match line {
                    Value::Null => String::new(),
                    line => js::to_js_string(Some(line)),
                })
                .collect::<Vec<_>>()
                .join("\n");
            let status = if error.is_none() && js::truthy_opt(message.get("isAuthenticating")) {
                "running"
            } else if error.is_some() {
                "failed"
            } else {
                "completed"
            };
            let text = error
                .clone()
                .or_else(|| (!output.is_empty()).then_some(output))
                .unwrap_or_else(|| "Claude Code authentication is in progress.".into());
            vec![event(
                "provider.activity",
                session_id,
                None,
                Some("claude:authentication"),
                json!({
                    "category": "authentication",
                    "message": redact_secret_text(&text),
                    "status": status,
                }),
            )]
        }
        _ => Vec::new(),
    }
}

/// `String(value)` when `value` is truthy.
fn truthy_text(value: Option<&Value>) -> Option<String> {
    value
        .filter(|v| js::truthy(v))
        .map(|v| js::to_js_string(Some(v)))
}

/// `normalizeClaudeHistory(messages, providerSessionId)`.
pub fn normalize_claude_history(messages: &[Value], provider_session_id: &str) -> Vec<Value> {
    let mut events = Vec::new();
    let mut turn: Option<(String, ClaudeEventState)> = None;
    for message in messages {
        let content = as_array(message.pointer("/message/content"));
        let is_user = message.get("type").and_then(Value::as_str) == Some("user");
        let has_tool_result = content
            .iter()
            .any(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"));
        let human_text = if is_user && !has_tool_result {
            content
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .map(|block| text(block.get("text")))
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            String::new()
        };
        let next_turn_id = |events: &Vec<Value>| {
            format!(
                "claude:history:{}",
                safe_id(message.get("uuid")).unwrap_or_else(|| (events.len() + 1).to_string())
            )
        };
        if !human_text.is_empty() {
            // A history page/group ending is not evidence that the native
            // turn succeeded.
            let turn_id = next_turn_id(&events);
            events.push(event(
                "turn.started",
                Some(provider_session_id),
                Some(&turn_id),
                None,
                json!({ "status": "running", "prompt": human_text, "restored": true }),
            ));
            turn = Some((turn_id.clone(), ClaudeEventState::new(Some(&turn_id), true)));
            continue;
        }
        if turn.is_none() {
            let turn_id = next_turn_id(&events);
            events.push(event(
                "turn.started",
                Some(provider_session_id),
                Some(&turn_id),
                None,
                json!({ "status": "running", "restored": true }),
            ));
            turn = Some((turn_id.clone(), ClaudeEventState::new(Some(&turn_id), true)));
        }
        if let Some((_, state)) = turn.as_mut() {
            let message = js::with(message, "session_id", provider_session_id);
            events.extend(normalize_claude_message(&message, state));
        }
    }
    events
}

fn normalize_stream_event(
    message: &Value,
    state: &mut ClaudeEventState,
    session_id: Option<&str>,
) -> Vec<Value> {
    let native = record(message.get("event"));
    let kind = native.get("type").and_then(Value::as_str).unwrap_or("");
    if kind == "message_start" {
        if let Some(id) = safe_id(native.pointer("/message/id")) {
            state.assistant_message_id = Some(id);
        }
        return Vec::new();
    }
    let item_id = assistant_segment_id(state, native.get("index"));
    let turn = state.turn_id.clone();
    let delta_type = native.pointer("/delta/type").and_then(Value::as_str);
    if kind == "content_block_delta" && delta_type == Some("text_delta") {
        state.streamed_text.insert(item_id.clone());
        let delta = native
            .pointer("/delta/text")
            .and_then(Value::as_str)
            .unwrap_or("");
        return vec![event(
            "assistant.delta",
            session_id,
            turn.as_deref(),
            Some(&item_id),
            json!({ "delta": delta }),
        )];
    }
    if kind == "content_block_delta" && delta_type == Some("thinking_delta") {
        if state.reasoning_started {
            return Vec::new();
        }
        state.reasoning_started = true;
        // The native SDK may expose extended-thinking tokens. PuppyOne
        // surfaces a working-state boundary but never republishes hidden
        // chain-of-thought.
        return vec![event(
            "reasoning.summary.delta",
            session_id,
            turn.as_deref(),
            Some(&item_id),
            json!({ "delta": "", "boundary": true }),
        )];
    }
    if kind == "content_block_start"
        && native
            .pointer("/content_block/type")
            .and_then(Value::as_str)
            == Some("tool_use")
    {
        return start_tool(&native["content_block"], state, session_id);
    }
    if kind == "message_delta" && native.get("usage").is_some_and(js::truthy) {
        return vec![event(
            "usage.updated",
            session_id,
            turn.as_deref(),
            None,
            normalize_claude_usage(native.get("usage")),
        )];
    }
    Vec::new()
}

fn normalize_assistant(
    message: &Value,
    state: &mut ClaudeEventState,
    session_id: Option<&str>,
) -> Vec<Value> {
    let mut result = Vec::new();
    let message_id =
        safe_id(message.pointer("/message/id")).or_else(|| state.assistant_message_id.clone());
    if let Some(id) = message_id.as_ref() {
        state.assistant_message_id = Some(id.clone());
    }
    let turn = state.turn_id.clone();
    for (index, block) in as_array(message.pointer("/message/content"))
        .iter()
        .enumerate()
    {
        let item_id = assistant_segment_id(state, Some(&Value::from(index)));
        let block_type = block.get("type").and_then(Value::as_str);
        if block_type == Some("text") && !text(block.get("text")).is_empty() {
            result.push(event(
                "assistant.completed",
                session_id,
                turn.as_deref(),
                Some(&item_id),
                json!({ "text": block["text"] }),
            ));
        } else if block_type == Some("thinking") && !text(block.get("thinking")).is_empty() {
            if !state.reasoning_started {
                state.reasoning_started = true;
                result.push(event(
                    "reasoning.summary.delta",
                    session_id,
                    turn.as_deref(),
                    Some(&item_id),
                    json!({ "delta": "", "boundary": true }),
                ));
            }
        } else if block_type == Some("tool_use") {
            result.extend(start_tool(block, state, session_id));
        } else if let Some(block_type) = block_type {
            result.push(event(
                "provider.warning",
                session_id,
                turn.as_deref(),
                Some(&item_id),
                json!({
                    "message": format!("Claude Code returned an unsupported content block ({block_type})."),
                    "recoverable": true,
                }),
            ));
        }
    }
    if let Some(error) = message.get("error").filter(|e| js::truthy(e)) {
        let code = js::to_js_string(Some(error));
        result.push(event(
            "provider.error",
            session_id,
            turn.as_deref(),
            message_id.as_deref(),
            json!({
                "message": redact_secret_text(&format!("Claude Code assistant error: {code}")),
                "code": code,
                "recoverable": true,
            }),
        ));
    }
    result
}

/// `assistantSegmentId(state, index)`.
fn assistant_segment_id(state: &ClaudeEventState, index: Option<&Value>) -> String {
    let message_id = state.assistant_message_id.clone().unwrap_or_else(|| {
        format!(
            "claude:assistant:{}",
            state.turn_id.as_deref().unwrap_or("null")
        )
    });
    let block = index
        .and_then(js::safe_integer)
        .filter(|index| *index >= 0)
        .unwrap_or(0);
    format!("{message_id}:block:{block}")
}

/// `normalizeClaudeUsage(value)`.
fn normalize_claude_usage(value: Option<&Value>) -> Value {
    let usage = record(value);
    let pick = |snake: &str, camel: &str| {
        let value = usage
            .get(snake)
            .filter(|v| !v.is_null())
            .or(usage.get(camel));
        non_negative(value)
    };
    let input = pick("input_tokens", "inputTokens");
    let output = pick("output_tokens", "outputTokens");
    let cached = pick("cache_read_input_tokens", "cacheReadInputTokens")
        + pick("cache_creation_input_tokens", "cacheCreationInputTokens");
    bound_renderer_value(&json!({
        "inputTokens": js::number(input),
        "outputTokens": js::number(output),
        "totalTokens": js::number(input + output),
        "cachedTokens": js::number(cached),
    }))
}

fn start_tool(block: &Value, state: &mut ClaudeEventState, session_id: Option<&str>) -> Vec<Value> {
    let tool_id = safe_id(block.get("id"))
        .unwrap_or_else(|| format!("claude:tool:{}", state.started_tools.len() + 1));
    let previous = state.tool_metadata.get(&tool_id).cloned();
    let name = Some(text(block.get("name")))
        .filter(|n| !n.is_empty())
        .or_else(|| previous.as_ref().map(|(name, _)| name.clone()))
        .unwrap_or_else(|| "Tool".into());
    let block_input = record(block.get("input"));
    let input = if block_input.as_object().is_some_and(|m| !m.is_empty()) {
        block_input
    } else {
        previous.map_or_else(|| json!({}), |(_, input)| input)
    };
    state
        .tool_metadata
        .insert(tool_id.clone(), (name.clone(), input.clone()));
    let turn = state.turn_id.clone();
    let kind = if state.started_tools.contains(&tool_id) {
        "tool.progress"
    } else {
        state.started_tools.insert(tool_id.clone());
        "tool.started"
    };
    vec![event(
        kind,
        session_id,
        turn.as_deref(),
        Some(&tool_id),
        tool_payload(Some(&name), &input, "running"),
    )]
}

fn normalize_tool_results(
    message: &Value,
    state: &mut ClaudeEventState,
    session_id: Option<&str>,
) -> Vec<Value> {
    let turn = state.turn_id.clone();
    as_array(message.pointer("/message/content"))
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
        .map(|block| {
            let content: Vec<Value> = match block.get("content") {
                Some(Value::String(text)) => {
                    vec![json!({ "type": "text", "text": redact_secret_text(text) })]
                }
                value => as_array(value)
                    .iter()
                    .map(|part| {
                        if part.get("type").and_then(Value::as_str) == Some("text") {
                            json!({ "type": "text", "text": redact_secret_text(&text(part.get("text"))) })
                        } else {
                            json!({ "type": "json", "value": bound_renderer_value(&redact_secrets(part)) })
                        }
                    })
                    .collect(),
            };
            let texts: Vec<&str> = content
                .iter()
                .filter(|part| part["type"] == "text")
                .filter_map(|part| part["text"].as_str())
                .collect();
            let output = texts.join("\n");
            let failed = js::truthy_opt(block.get("is_error"));
            let error = if failed && !output.is_empty() {
                Value::from(output.clone())
            } else {
                Value::Null
            };
            let result = json!({
                "content": content,
                "error": error,
                "success": !failed,
                "truncated": false,
            });
            let tool_id = safe_id(block.get("tool_use_id"));
            let metadata = tool_id
                .as_ref()
                .and_then(|id| state.tool_metadata.get(id))
                .cloned();
            let (name, input) = metadata.unwrap_or_else(|| ("Tool".into(), json!({})));
            let name = if name.is_empty() { "Tool".to_string() } else { name };
            let redacted = redact_secret_text(&output);
            let start = js::len16(&redacted).saturating_sub(16 * 1024);
            let payload = Obj::from(&tool_payload(
                Some(&name),
                &input,
                if failed { "failed" } else { "completed" },
            ))
            .set("result", result)
            .set("outputPreview", js::tail16(&redacted, start))
            .build();
            event(
                "tool.completed",
                session_id,
                turn.as_deref(),
                tool_id.as_deref(),
                payload,
            )
        })
        .collect()
}

fn normalize_result(
    message: &Value,
    state: &mut ClaudeEventState,
    session_id: Option<&str>,
) -> Vec<Value> {
    if state.terminal {
        return Vec::new();
    }
    state.terminal = true;
    let turn = state.turn_id.clone();
    let mut result = Vec::new();
    if message.get("usage").is_some_and(js::truthy) {
        let usage = Obj::from(&normalize_claude_usage(message.get("usage")))
            .set(
                "cost",
                js::number(non_negative(message.get("total_cost_usd"))),
            )
            .build();
        result.push(event(
            "usage.updated",
            session_id,
            turn.as_deref(),
            None,
            usage,
        ));
    }
    let failed = message.get("subtype").and_then(Value::as_str) != Some("success")
        || message.get("is_error") == Some(&Value::Bool(true));
    if failed {
        let errors: Vec<String> = as_array(message.get("errors"))
            .iter()
            .map(|e| text(Some(e)))
            .filter(|e| !e.is_empty())
            .collect();
        let error = if errors.is_empty() {
            "Claude Code turn failed.".to_string()
        } else {
            errors.join("\n")
        };
        result.push(event(
            "provider.error",
            session_id,
            turn.as_deref(),
            None,
            json!({ "message": redact_secret_text(&error), "recoverable": true }),
        ));
    }
    let stop_reason = Some(text(message.get("stop_reason"))).filter(|r| !r.is_empty());
    result.push(event(
        if failed {
            "turn.failed"
        } else {
            "turn.completed"
        },
        session_id,
        turn.as_deref(),
        None,
        json!({
            "status": if failed { "failed" } else { "completed" },
            "durationMs": js::number(non_negative(message.get("duration_ms"))),
            "stopReason": stop_reason,
            "numTurns": number_or_zero(message.get("num_turns")),
        }),
    ));
    result
}

fn tool_payload(name: Option<&str>, input: &Value, status: &str) -> Value {
    let safe_input = bound_renderer_value(&redact_secrets(input));
    let tool = canonical_tool_name(name.unwrap_or(""));
    let field = |key: &str| input.get(key).filter(|v| !v.is_null()).cloned();
    let mut payload = Obj::new()
        .set("kind", tool_kind(&tool))
        .set("tool", tool.as_str())
        .set("label", tool_label(name, &safe_input))
        .set("status", status);
    if tool == "edit" || tool == "write" {
        let edits = input.get("edits").and_then(Value::as_array);
        let fragments = edits.map(|edits| {
            Value::Array(
                edits
                    .iter()
                    .take(101)
                    .map(|edit| {
                        Obj::new()
                            .opt("before", edit.get("old_string").cloned())
                            .opt("after", edit.get("new_string").cloned())
                            .build()
                    })
                    .collect(),
            )
        });
        let replace_all = |value: &Value| value.get("replace_all") == Some(&Value::Bool(true));
        let path = field("file_path")
            .filter(js::truthy)
            .or_else(|| field("path"));
        let evidence = Obj::new()
            .opt("path", path)
            .opt("before", field("old_string"))
            .opt(
                "after",
                if tool == "write" {
                    field("content")
                } else {
                    field("new_string")
                },
            )
            .opt("fragments", fragments)
            .set("scope", "fragment")
            .set("basis", "request")
            .set(
                "unknownMultiplicity",
                replace_all(input) || edits.is_some_and(|edits| edits.iter().any(replace_all)),
            )
            .build();
        payload = payload.set("changes", create_agent_file_change_evidence(&[evidence]));
    }
    let path = safe_input
        .get("file_path")
        .filter(|p| js::truthy(p))
        .or(safe_input.get("path"));
    payload
        .set("input", safe_input.clone())
        .set("path", Some(text(path)).filter(|p| !p.is_empty()))
        .set(
            "command",
            Some(text(safe_input.get("command"))).filter(|c| !c.is_empty()),
        )
        .build()
}

fn tool_kind(name: &str) -> &'static str {
    let normalized = canonical_tool_name(name);
    match normalized.as_str() {
        "bash" => "command",
        "read" => "read",
        "glob" | "grep" => "search",
        "write" | "edit" => "file-change",
        name if name.contains("web") => "network",
        _ => "tool",
    }
}

fn tool_label(name: Option<&str>, input: &Value) -> String {
    if canonical_tool_name(name.unwrap_or("")) == "bash" {
        let description = text(input.get("description"));
        if !description.is_empty() {
            return description;
        }
        let command = text(input.get("command"));
        let command = js::head16(&command, 240);
        return if command.is_empty() {
            "Run command".into()
        } else {
            command.to_string()
        };
    }
    let path = input
        .get("file_path")
        .filter(|p| js::truthy(p))
        .or(input.get("path"));
    let path = text(path);
    let name = name.filter(|n| !n.is_empty());
    if !path.is_empty() {
        return format!("{} {path}", name.unwrap_or("Tool"));
    }
    name.map(|n| js::head16(n, 32_768).to_string())
        .unwrap_or_else(|| "Tool".into())
}

fn canonical_tool_name(name: &str) -> String {
    let text = js::head16(name, 32_768);
    let normalized = TOOL_SEPARATORS
        .replace_all(&js::trim(text).to_lowercase(), "")
        .into_owned();
    let known = match normalized.as_str() {
        "bash" | "shell" => Some("bash"),
        "read" => Some("read"),
        "write" => Some("write"),
        "edit" | "multiedit" | "notebookedit" => Some("edit"),
        "glob" => Some("glob"),
        "grep" => Some("grep"),
        "ls" => Some("list"),
        "webfetch" => Some("webfetch"),
        "websearch" => Some("websearch"),
        "todowrite" => Some("todo"),
        "task" | "agent" => Some("agent"),
        "skill" => Some("skill"),
        "askuserquestion" => Some("question"),
        _ => None,
    };
    match known {
        Some(known) => known.into(),
        None if normalized.is_empty() => "tool".into(),
        None => normalized,
    }
}
