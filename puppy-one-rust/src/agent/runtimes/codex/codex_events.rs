//! `runtimes/codex/codex-events.mjs`: Codex app-server notifications as
//! adapter events (`{ type, providerSessionId, turnId, itemId?, payload }`).
use super::codex_native_values::{string_or_null, string_or_null_value, to_iso_from_seconds};
use crate::agent::agent_events::{bound_renderer_value, redact_secret_text, redact_secrets};
use crate::agent::contract::js::{self, Obj};
use crate::agent::runtime::agent_file_change_evidence::create_agent_file_change_evidence;
use crate::text;
use serde_json::{Value, json};

/// An event without an item identity.
fn event(kind: &str, thread_id: &Value, turn_id: &Value, payload: Value) -> Value {
    json!({ "type": kind, "providerSessionId": thread_id, "turnId": turn_id, "payload": payload })
}

/// An item-scoped event.
fn item_event(
    kind: &str,
    thread_id: &Value,
    turn_id: &Value,
    item_id: &Value,
    payload: Value,
) -> Value {
    json!({
        "type": kind,
        "providerSessionId": thread_id,
        "turnId": turn_id,
        "itemId": item_id,
        "payload": payload,
    })
}

/// `value || fallback`.
fn or_value(value: Option<&Value>, fallback: impl Into<Value>) -> Value {
    value
        .filter(|v| js::truthy(v))
        .cloned()
        .unwrap_or_else(|| fallback.into())
}

/// `value ?? fallback`.
fn coalesce(value: Option<&Value>, fallback: impl Into<Value>) -> Value {
    value
        .filter(|v| !v.is_null())
        .cloned()
        .unwrap_or_else(|| fallback.into())
}

/// `str.slice(-limit)` in UTF-16 units.
fn last16(value: &str, limit: usize) -> &str {
    text::tail16(value, text::len16(value).saturating_sub(limit))
}

/// `normalizeCodexNotification(message)`.
pub fn normalize_codex_notification(message: &Value) -> Vec<Value> {
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let empty = json!({});
    let params = message
        .get("params")
        .filter(|p| !p.is_null())
        .unwrap_or(&empty);
    let thread_id = string_or_null_value(params.get("threadId"));
    let turn_id = string_or_null_value(
        params
            .get("turnId")
            .filter(|t| !t.is_null())
            .or_else(|| params.get("turn").and_then(|t| t.get("id"))),
    );
    let item = params.get("item").filter(|i| i.is_object());
    let item_id = string_or_null_value(
        params
            .get("itemId")
            .filter(|i| !i.is_null())
            .or_else(|| item.and_then(|i| i.get("id"))),
    );
    let delta = || js::string_or_empty(params.get("delta"));
    match method {
        "thread/started" => {
            let thread = params
                .get("thread")
                .filter(|t| !t.is_null())
                .unwrap_or(&empty);
            let title = ["name", "preview"]
                .iter()
                .filter_map(|key| thread.get(*key))
                .find(|v| js::truthy(v))
                .cloned()
                .unwrap_or_else(|| Value::from("Codex session"));
            vec![json!({
                "type": "session.started",
                "providerSessionId": string_or_null_value(thread.get("id")),
                "payload": {
                    "title": title,
                    "createdAt": to_iso_from_seconds(thread.get("createdAt")),
                    "updatedAt": to_iso_from_seconds(thread.get("updatedAt")),
                },
            })]
        }
        // Runtime status is lifecycle state, not a diagnostic. The accompanying
        // failed-turn payload carries the actionable message exactly once.
        "thread/status/changed" => Vec::new(),
        "turn/started" => vec![event(
            "turn.started",
            &thread_id,
            &turn_id,
            json!({ "status": "running" }),
        )],
        "turn/completed" => {
            let turn = params.get("turn");
            let status = turn.and_then(|t| t.get("status")).and_then(Value::as_str);
            let kind = match status {
                Some("interrupted") => "turn.interrupted",
                Some("failed") => "turn.failed",
                _ => "turn.completed",
            };
            let native_message = turn
                .and_then(|t| t.get("error"))
                .and_then(|e| e.get("message"))
                .filter(|m| js::truthy(m));
            let message = native_message
                .map(|m| format_codex_error_message(Some(m), None))
                .unwrap_or_default();
            let payload = Obj::new()
                .set("status", normalize_turn_status(status))
                .opt("message", (!message.is_empty()).then(|| message.clone()))
                .build();
            let terminal = event(kind, &thread_id, &turn_id, payload);
            if status == Some("failed") && !message.is_empty() {
                vec![
                    terminal,
                    event(
                        "provider.error",
                        &thread_id,
                        &turn_id,
                        json!({ "message": message, "recoverable": true }),
                    ),
                ]
            } else {
                vec![terminal]
            }
        }
        "item/started" => normalize_item_lifecycle(item, "started", &thread_id, &turn_id),
        "item/completed" => normalize_item_lifecycle(item, "completed", &thread_id, &turn_id),
        "item/agentMessage/delta" => vec![item_event(
            "assistant.delta",
            &thread_id,
            &turn_id,
            &item_id,
            json!({ "delta": delta() }),
        )],
        "item/reasoning/summaryTextDelta" => vec![item_event(
            "reasoning.summary.delta",
            &thread_id,
            &turn_id,
            &item_id,
            json!({
                "delta": delta(),
                "summaryIndex": coalesce(params.get("summaryIndex"), 0),
                "updateMode": "append",
            }),
        )],
        // This is a section boundary, not hidden chain-of-thought content. It
        // is enough to surface the native working state before readable
        // summary text arrives without leaking raw reasoning tokens.
        "item/reasoning/summaryPartAdded" => vec![item_event(
            "reasoning.summary.delta",
            &thread_id,
            &turn_id,
            &item_id,
            json!({
                "delta": "",
                "summaryIndex": coalesce(params.get("summaryIndex"), 0),
                "boundary": true,
            }),
        )],
        "turn/plan/updated" => vec![event(
            "plan.updated",
            &thread_id,
            &turn_id,
            json!({
                "explanation": string_or_null_value(params.get("explanation")),
                "steps": normalize_plan(params.get("plan")),
            }),
        )],
        "item/plan/delta" => vec![item_event(
            "plan.updated",
            &thread_id,
            &turn_id,
            &item_id,
            json!({ "text": delta(), "streaming": true, "updateMode": "append" }),
        )],
        "item/commandExecution/outputDelta" => vec![item_event(
            "command.output.delta",
            &thread_id,
            &turn_id,
            &item_id,
            json!({ "delta": delta() }),
        )],
        "item/fileChange/outputDelta" => vec![item_event(
            "tool.progress",
            &thread_id,
            &turn_id,
            &item_id,
            json!({ "delta": delta() }),
        )],
        "item/fileChange/patchUpdated" => vec![item_event(
            "file.change.updated",
            &thread_id,
            &turn_id,
            &item_id,
            json!({ "changes": summarize_file_changes(params.get("changes")) }),
        )],
        "item/mcpToolCall/progress" => vec![item_event(
            "tool.progress",
            &thread_id,
            &turn_id,
            &item_id,
            bound_renderer_value(&redact_secrets(params)),
        )],
        "thread/tokenUsage/updated" => vec![event(
            "usage.updated",
            &thread_id,
            &turn_id,
            bound_renderer_value(&coalesce(params.get("tokenUsage"), json!({}))),
        )],
        "error" => {
            let will_retry = js::truthy_opt(params.get("willRetry"));
            let payload = if will_retry {
                Obj::new()
                    .set("state", "reconnecting")
                    .set(
                        "message",
                        format_codex_error_message(
                            params.get("error"),
                            Some("Codex is reconnecting."),
                        ),
                    )
                    .opt(
                        "attempt",
                        params
                            .get("attempt")
                            .filter(|a| js::is_safe_integer(a))
                            .cloned(),
                    )
                    .opt(
                        "maxAttempts",
                        params
                            .get("maxAttempts")
                            .filter(|a| js::is_safe_integer(a))
                            .cloned(),
                    )
                    .build()
            } else {
                json!({
                    "message": format_codex_error_message(params.get("error"), Some("Codex reported an error.")),
                    "recoverable": false,
                })
            };
            let kind = if will_retry {
                "provider.connection.updated"
            } else {
                "provider.error"
            };
            vec![event(kind, &thread_id, &turn_id, payload)]
        }
        "warning" => vec![event(
            "provider.connection.updated",
            &thread_id,
            &turn_id,
            json!({ "state": "fallback", "message": format_provider_warning(params) }),
        )],
        "configWarning" => vec![event(
            "provider.warning",
            &thread_id,
            &turn_id,
            json!({ "message": format_provider_warning(params) }),
        )],
        // App-server migration diagnostics are for the integration owner. They
        // must never become user-authored or assistant-authored transcript rows.
        "deprecationNotice" => Vec::new(),
        _ => Vec::new(),
    }
}

/// `normalizeItemLifecycle(item, phase, threadId, turnId)`.
pub fn normalize_item_lifecycle(
    item: Option<&Value>,
    phase: &str,
    thread_id: &Value,
    turn_id: &Value,
) -> Vec<Value> {
    let Some(item) = item.filter(|i| i.is_object()) else {
        return Vec::new();
    };
    let item_id = string_or_null_value(item.get("id"));
    let completed = phase == "completed";
    let item_type = item.get("type").and_then(Value::as_str);
    match item_type {
        Some("userMessage") => {
            if !completed {
                return Vec::new();
            }
            let payload = Obj::new()
                .set("text", read_codex_user_message_text(Some(item)))
                .opt(
                    "clientUserMessageId",
                    string_or_null(item.get("clientId")).map(str::to_string),
                )
                .build();
            return vec![item_event(
                "user.message",
                thread_id,
                turn_id,
                &item_id,
                payload,
            )];
        }
        Some("agentMessage") => {
            if !completed {
                return Vec::new();
            }
            return vec![item_event(
                "assistant.completed",
                thread_id,
                turn_id,
                &item_id,
                json!({ "text": js::string_or_empty(item.get("text")) }),
            )];
        }
        Some("plan") => {
            return vec![item_event(
                "plan.updated",
                thread_id,
                turn_id,
                &item_id,
                json!({
                    "text": js::string_or_empty(item.get("text")),
                    "completed": completed,
                    "updateMode": "replace",
                }),
            )];
        }
        Some("reasoning") => {
            let summary = item
                .get("summary")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            return summary
                .iter()
                .enumerate()
                .map(|(index, summary)| {
                    item_event(
                        "reasoning.summary.delta",
                        thread_id,
                        turn_id,
                        &item_id,
                        json!({
                            "delta": js::to_js_string(Some(summary)),
                            "summaryIndex": index,
                            "completed": completed,
                            "updateMode": "replace",
                        }),
                    )
                })
                .collect();
        }
        Some("fileChange") => {
            let changes = summarize_file_changes(item.get("changes"));
            let path = if changes.len() == 1 {
                coalesce(changes[0].get("path"), Value::Null)
            } else {
                Value::Null
            };
            let label = if changes.len() > 1 {
                format!("Edit {} files", changes.len())
            } else if let Some(path) = path.as_str().filter(|p| !p.is_empty()) {
                format!("Edit {path}")
            } else {
                "Edit files".into()
            };
            let status = normalize_tool_status(item.get("status"), phase);
            let kind = if completed {
                "tool.completed"
            } else {
                "tool.started"
            };
            return vec![
                item_event(
                    kind,
                    thread_id,
                    turn_id,
                    &item_id,
                    json!({
                        "kind": "file-change",
                        "tool": "edit",
                        "label": label,
                        "changes": changes,
                        "input": { "changes": changes },
                        "path": path,
                        "status": status,
                    }),
                ),
                item_event(
                    "file.change.updated",
                    thread_id,
                    turn_id,
                    &item_id,
                    json!({ "changes": changes, "status": status }),
                ),
            ];
        }
        Some("contextCompaction") => {
            return vec![item_event(
                "provider.activity",
                thread_id,
                turn_id,
                &item_id,
                json!({
                    "category": "compaction",
                    "status": if completed { "completed" } else { "running" },
                }),
            )];
        }
        _ => {}
    }
    if let Some(tool) = summarize_tool_item(item, phase) {
        let kind = if completed {
            "tool.completed"
        } else {
            "tool.started"
        };
        return vec![item_event(kind, thread_id, turn_id, &item_id, tool)];
    }
    match item_type {
        Some(item_type) if completed => vec![item_event(
            "provider.warning",
            thread_id,
            turn_id,
            &item_id,
            json!({
                "message": format!("Codex returned an unsupported content item ({item_type})."),
                "recoverable": true,
            }),
        )],
        _ => Vec::new(),
    }
}

/// `readCodexUserMessageText(item)`.
pub fn read_codex_user_message_text(item: Option<&Value>) -> String {
    let text = item
        .and_then(|i| i.get("content"))
        .and_then(Value::as_array)
        .map(|content| {
            content
                .iter()
                .filter(|c| c.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|c| c.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    text::head16(&text, 128 * 1024).to_string()
}

fn finite(value: Option<&Value>) -> Value {
    value
        .filter(|v| js::finite_number(v).is_some())
        .cloned()
        .unwrap_or(Value::Null)
}

/// `summarizeToolItem(item, phase)`.
pub fn summarize_tool_item(item: &Value, phase: &str) -> Option<Value> {
    let completed = phase == "completed";
    let lifecycle = if completed { "completed" } else { "running" };
    match item.get("type").and_then(Value::as_str) {
        Some("commandExecution") => {
            let command = item.get("command");
            let integer_exit = item
                .get("exitCode")
                .filter(|c| {
                    c.as_f64()
                        .is_some_and(|n| n.is_finite() && n.fract() == 0.0)
                })
                .cloned()
                .unwrap_or(Value::Null);
            let output_preview = item
                .get("aggregatedOutput")
                .filter(|o| completed && js::truthy(o))
                .map(|o| last16(&js::to_js_string(Some(o)), 16 * 1024).to_string());
            Some(bound_renderer_value(
                &Obj::new()
                    .set("kind", "command")
                    .set("tool", "bash")
                    .set("label", or_value(command, "Command"))
                    .set("command", or_value(command, ""))
                    .set(
                        "input",
                        json!({
                            "command": or_value(command, ""),
                            "cwd": or_value(item.get("cwd"), Value::Null),
                        }),
                    )
                    .set("cwd", or_value(item.get("cwd"), Value::Null))
                    .set("status", normalize_tool_status(item.get("status"), phase))
                    .set("exitCode", integer_exit)
                    .set("durationMs", finite(item.get("durationMs")))
                    .opt("outputPreview", output_preview)
                    .build(),
            ))
        }
        Some(kind @ ("mcpToolCall" | "dynamicToolCall")) => {
            let mcp = kind == "mcpToolCall";
            let result = normalize_canonical_tool_result(item);
            let tool_name = js::to_js_string(Some(&or_value(
                item.get("tool"),
                if mcp { "mcp" } else { "tool" },
            )));
            let label = if mcp {
                Some(Value::from(format!(
                    "{}.{}",
                    js::to_js_string(item.get("server")),
                    js::to_js_string(item.get("tool"))
                )))
            } else {
                item.get("tool").cloned()
            };
            let mut summary = Obj::new()
                .set("kind", if mcp { "mcp" } else { "tool" })
                .set("tool", text::trim(&tool_name).to_lowercase())
                .opt("label", label)
                .set("status", normalize_tool_status(item.get("status"), phase))
                .set("input", coalesce(item.get("arguments"), Value::Null))
                .set("durationMs", finite(item.get("durationMs")));
            if let Some(result) = result {
                let preview = canonical_tool_result_text(&result);
                summary = summary.set("result", result).set("outputPreview", preview);
            }
            Some(bound_renderer_value(&redact_secrets(&summary.build())))
        }
        Some("webSearch") => {
            let query = item.get("query");
            Some(json!({
                "kind": "search",
                "tool": "websearch",
                "label": or_value(query, "Web search"),
                "query": or_value(query, ""),
                "input": { "query": or_value(query, "") },
                "status": lifecycle,
            }))
        }
        Some("imageView") => {
            let path = item.get("path");
            Some(json!({
                "kind": "read",
                "tool": "read",
                "label": format!("Viewed {}", js::to_js_string(Some(&or_value(path, "image")))),
                "path": or_value(path, Value::Null),
                "input": { "path": or_value(path, Value::Null) },
                "status": lifecycle,
            }))
        }
        _ => None,
    }
}

/// `summarizeFileChanges(changes)`.
pub fn summarize_file_changes(changes: Option<&Value>) -> Vec<Value> {
    let Some(changes) = changes.and_then(Value::as_array) else {
        return Vec::new();
    };
    let entries: Vec<Value> = changes
        .iter()
        .take(100)
        .map(|change| {
            let kind = match change.get("kind") {
                Some(Value::String(kind)) => Value::from(kind.as_str()),
                kind => or_value(kind.and_then(|k| k.get("type")), "update"),
            };
            Obj::new()
                .opt("path", change.get("path").cloned())
                .set("kind", kind)
                .opt("diff", change.get("diff").cloned())
                .set("basis", "native")
                .build()
        })
        .collect();
    create_agent_file_change_evidence(&entries)
}

/// `normalizePlan(plan)`.
pub fn normalize_plan(plan: Option<&Value>) -> Vec<Value> {
    let Some(plan) = plan.and_then(Value::as_array) else {
        return Vec::new();
    };
    plan.iter()
        .take(100)
        .map(|entry| {
            let status = entry.get("status");
            let status = match status.and_then(Value::as_str) {
                Some(known @ ("pending" | "inProgress" | "completed")) => known.to_string(),
                _ => match status.filter(|s| !s.is_null()) {
                    Some(other) => js::to_js_string(Some(other)),
                    None => "pending".into(),
                },
            };
            json!({ "step": js::string_or_empty(entry.get("step")), "status": status })
        })
        .collect()
}

/// `normalizeTurnStatus(status)`.
pub fn normalize_turn_status(status: Option<&str>) -> &'static str {
    match status {
        Some("interrupted") => "interrupted",
        Some("failed") => "failed",
        Some("inProgress") => "running",
        _ => "completed",
    }
}

/// `normalizeCanonicalToolResult(item)`.
pub fn normalize_canonical_tool_result(item: &Value) -> Option<Value> {
    let mut content: Vec<Value> = Vec::new();
    let mut append = |entry: &Value| match entry {
        Value::String(text) if !text.is_empty() => {
            content.push(json!({ "type": "text", "text": text }));
        }
        Value::Object(_) | Value::Array(_) => {
            let text = entry.get("text").and_then(Value::as_str);
            let resource = entry.get("resource").filter(|r| r.is_object());
            match entry.get("type").and_then(Value::as_str) {
                Some("text") if text.is_some() => {
                    content.push(json!({ "type": "text", "text": text }));
                }
                Some("resource") if resource.is_some() => {
                    let resource = resource.expect("checked");
                    let field = |key: &str| resource.get(key).filter(|v| v.is_string()).cloned();
                    content.push(json!({
                        "type": "artifact",
                        "uri": field("uri").unwrap_or_else(|| Value::from("")),
                        "mimeType": field("mimeType").unwrap_or(Value::Null),
                        "text": field("text").unwrap_or(Value::Null),
                    }));
                }
                _ => content.push(json!({ "type": "json", "value": entry })),
            }
        }
        _ => {}
    };
    let native_result = item.get("result");
    match native_result
        .and_then(|r| r.get("content"))
        .and_then(Value::as_array)
    {
        Some(entries) => entries.iter().for_each(&mut append),
        None => {
            if let Some(result) = native_result.filter(|r| !r.is_null()) {
                append(result);
            }
        }
    }
    if let Some(entries) = item.get("contentItems").and_then(Value::as_array) {
        entries.iter().for_each(&mut append);
    }
    let error = match item.get("error") {
        None | Some(Value::Null) => Value::Null,
        Some(Value::String(text)) => Value::from(text.as_str()),
        Some(error) => match error.get("message").and_then(Value::as_str) {
            Some(message) => Value::from(message),
            None => Value::from(js::stringify(error)),
        },
    };
    if content.is_empty() && !js::truthy(&error) && item.get("success").is_none() {
        return None;
    }
    Some(json!({
        "content": content,
        "error": error,
        "success": item.get("success").filter(|s| s.is_boolean()).cloned().unwrap_or(Value::Null),
        "truncated": false,
    }))
}

/// `canonicalToolResultText(result)`.
pub fn canonical_tool_result_text(result: &Value) -> String {
    let mut pieces: Vec<String> = Vec::new();
    for entry in result["content"].as_array().into_iter().flatten() {
        match entry.get("type").and_then(Value::as_str) {
            Some("text") => pieces.push(js::to_js_string(entry.get("text"))),
            Some("artifact") if js::truthy_opt(entry.get("text")) => {
                pieces.push(js::to_js_string(entry.get("text")));
            }
            Some("json") => pieces.push(js::stringify(entry.get("value").unwrap_or(&Value::Null))),
            _ => {}
        }
    }
    if js::truthy_opt(result.get("error")) {
        pieces.push(js::to_js_string(result.get("error")));
    }
    last16(&pieces.join("\n"), 16 * 1024).to_string()
}

/// `normalizeToolStatus(status, phase)`.
pub fn normalize_tool_status(status: Option<&Value>, phase: &str) -> &'static str {
    match status.and_then(Value::as_str) {
        _ if phase == "started" => "running",
        Some("inProgress") => "running",
        Some("declined") => "declined",
        Some("failed") => "failed",
        _ => "completed",
    }
}

/// `formatCodexErrorMessage(value, fallback)`.
pub fn format_codex_error_message(value: Option<&Value>, fallback: Option<&str>) -> String {
    let text = extract_codex_error_text(value, 0);
    let text = if text.is_empty() {
        fallback.unwrap_or("Codex reported an error.").to_string()
    } else {
        text
    };
    redact_secret_text(&text)
}

/// `extractCodexErrorText(value, depth)`.
pub fn extract_codex_error_text(value: Option<&Value>, depth: usize) -> String {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return String::new();
    };
    if depth > 4 {
        return String::new();
    }
    match value {
        Value::String(text) => {
            let text = text::trim(text);
            if text.is_empty() {
                return String::new();
            }
            if (text.starts_with('{') && text.ends_with('}'))
                || (text.starts_with('[') && text.ends_with(']'))
            {
                // Keep the bounded provider text when it only resembles JSON.
                if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                    let nested = extract_codex_error_text(Some(&parsed), depth + 1);
                    if !nested.is_empty() {
                        return nested;
                    }
                }
            }
            text::head16(text, 32_768).to_string()
        }
        Value::Object(_) => {
            let nested = |candidate: Option<&Value>| extract_codex_error_text(candidate, depth + 1);
            [
                nested(value.get("error").and_then(|e| e.get("message"))),
                nested(value.get("message")),
                nested(value.get("error")),
            ]
            .into_iter()
            .find(|text| !text.is_empty())
            .unwrap_or_default()
        }
        _ => String::new(),
    }
}

/// `formatProviderWarning(params)`.
pub fn format_provider_warning(params: &Value) -> String {
    let text = |key: &str| params.get(key).and_then(Value::as_str);
    let summary = text("message")
        .or_else(|| text("summary"))
        .unwrap_or("Codex warning");
    let path = text("path").map(|path| format!("({path})"));
    let parts: Vec<&str> = [Some(summary), text("details"), path.as_deref()]
        .into_iter()
        .flatten()
        .filter(|part| !part.is_empty())
        .collect();
    redact_secret_text(&parts.join(" "))
}
