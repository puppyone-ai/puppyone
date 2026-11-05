//! `protocols/acp/acp-interactions.mjs`: native request correlation and
//! response serialization for the ACP adapter.
use super::acp_native_values::{array, event, record, safe_id_value, text};
use super::acp_runtime_adapter::Inner;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::{bound_renderer_value, redact_secret_text, redact_secrets};
use crate::agent::contract::js;
use futures_util::future::LocalBoxFuture;
use serde_json::{Map, Value, json};
use std::cell::RefCell;
use tokio::sync::oneshot;

/// One permission request awaiting the user.
pub struct PendingApproval {
    pub request_id: String,
    pub turn_id: String,
    pub options: Vec<Value>,
    pub resolve: RefCell<Option<oneshot::Sender<Value>>>,
}

/// One extension question awaiting the user.
pub struct PendingQuestion {
    pub request_id: String,
    pub turn_id: String,
    pub questions: Vec<Value>,
    pub resolve: RefCell<Option<oneshot::Sender<Value>>>,
}

fn settle(resolve: &RefCell<Option<oneshot::Sender<Value>>>, value: Value) {
    if let Some(resolve) = resolve.borrow_mut().take() {
        let _ = resolve.send(value);
    }
}

fn active_turn_id(adapter: &Inner) -> Option<String> {
    adapter
        .active_turn
        .borrow()
        .as_ref()
        .map(|turn| turn.turn_id.clone())
}

/// `acpResolveApproval(adapter, { requestId, decision, turnId })`.
pub fn acp_resolve_approval(adapter: &Inner, request: &Value) -> AgentResult<()> {
    let request_id = js::str_or_empty(request.get("requestId"));
    let turn_id = request.get("turnId").and_then(Value::as_str);
    let index = adapter
        .pending_approvals
        .borrow()
        .iter()
        .position(|pending| {
            pending.request_id == request_id && Some(pending.turn_id.as_str()) == turn_id
        });
    let Some(index) = index.filter(|_| active_turn_id(adapter).as_deref() == turn_id) else {
        return Err(AgentError::new(format!(
            "Approval correlation did not match the active {} turn.",
            adapter.display_name()
        )));
    };
    let pending = adapter.pending_approvals.borrow_mut().remove(index);
    let response = match select_permission_option(
        &pending.options,
        request.get("decision").and_then(Value::as_str),
    ) {
        Some(option) => {
            json!({ "outcome": { "outcome": "selected", "optionId": option["optionId"] } })
        }
        None => json!({ "outcome": { "outcome": "cancelled" } }),
    };
    settle(&pending.resolve, response);
    Ok(())
}

/// `acpResolveQuestion(adapter, { requestId, answers, rejected, turnId })`.
pub fn acp_resolve_question(adapter: &Inner, request: &Value) -> AgentResult<()> {
    let request_id = js::str_or_empty(request.get("requestId"));
    let turn_id = request.get("turnId").and_then(Value::as_str);
    let index = adapter
        .pending_questions
        .borrow()
        .iter()
        .position(|pending| {
            pending.request_id == request_id && Some(pending.turn_id.as_str()) == turn_id
        });
    let Some(index) = index.filter(|_| active_turn_id(adapter).as_deref() == turn_id) else {
        return Err(AgentError::new(format!(
            "Question correlation did not match the active {} turn.",
            adapter.display_name()
        )));
    };
    let pending = adapter.pending_questions.borrow_mut().remove(index);
    let response = if js::truthy_opt(request.get("rejected")) {
        json!({ "outcome": "cancelled" })
    } else {
        json!({ "outcome": "answered", "answers": question_answer_map(&pending.questions, request.get("answers")) })
    };
    settle(&pending.resolve, response);
    Ok(())
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// `acpRequestPermission(adapter, request)`.
pub fn acp_request_permission(
    adapter: &Inner,
    request: &Value,
) -> LocalBoxFuture<'static, AgentResult<Value>> {
    let cancelled = || -> LocalBoxFuture<'static, AgentResult<Value>> {
        Box::pin(async { Ok(json!({ "outcome": { "outcome": "cancelled" } })) })
    };
    let Some(turn_id) = active_turn_id(adapter) else {
        return cancelled();
    };
    let session_id = adapter.session_id.borrow().clone();
    if request.get("sessionId").and_then(Value::as_str) != session_id.as_deref()
        || session_id.is_none()
    {
        return cancelled();
    }
    let options: Vec<Value> = array(request.get("options"))
        .iter()
        .filter(|option| safe_id_value(option.get("optionId")).is_some())
        .cloned()
        .collect();
    let tool_call = request.get("toolCall");
    let tool_call_id = safe_id_value(tool_call.and_then(|t| t.get("toolCallId")));
    let request_id = format!(
        "{}:{}:{}",
        adapter.runtime_id(),
        tool_call_id.clone().unwrap_or_else(uuid),
        uuid()
    );
    let input = Value::Object(record(tool_call.and_then(|t| t.get("rawInput"))).clone());
    let (resolve, response) = oneshot::channel();
    adapter
        .pending_approvals
        .borrow_mut()
        .push(PendingApproval {
            request_id: request_id.clone(),
            turn_id: turn_id.clone(),
            options: options.clone(),
            resolve: RefCell::new(Some(resolve)),
        });
    let title = text(tool_call.and_then(|t| t.get("title")), 300);
    let reason = text(tool_call.and_then(|t| t.get("title")), 2_000);
    let command = text(input.get("command"), 8_192);
    adapter.emit(event(
        "approval.requested",
        session_id.as_deref(),
        Some(&turn_id),
        tool_call_id.as_deref(),
        json!({
            "requestId": request_id,
            "title": if title.is_empty() { "Approval required".to_string() } else { title },
            "kind": approval_kind(tool_call.and_then(|t| t.get("kind")).and_then(Value::as_str)),
            "command": if command.is_empty() { Value::Null } else { Value::from(command) },
            "reason": if reason.is_empty() { Value::Null } else { Value::from(reason) },
            "availableDecisions": available_decisions(&options),
            "arguments": bound_renderer_value(&redact_secrets(&input)),
        }),
    ));
    Box::pin(async move {
        Ok(response
            .await
            .unwrap_or_else(|_| json!({ "outcome": { "outcome": "cancelled" } })))
    })
}

/// `acpHandleExtensionRequest(adapter, method, request)`: `None` when the
/// method is not one of the runtime's question methods.
pub fn acp_handle_extension_request(
    adapter: &Inner,
    method: &str,
    request: &Value,
) -> Option<LocalBoxFuture<'static, AgentResult<Value>>> {
    if !adapter.question_methods.contains(method) {
        return None;
    }
    let Some(turn_id) = active_turn_id(adapter) else {
        return Some(Box::pin(async { Ok(json!({ "outcome": "cancelled" })) }));
    };
    let questions = normalize_questions(request.get("questions"));
    let tool_call_id = safe_id_value(request.get("toolCallId"));
    let request_id = format!(
        "{}:question:{}:{}",
        adapter.runtime_id(),
        tool_call_id.clone().unwrap_or_else(uuid),
        uuid()
    );
    let (resolve, response) = oneshot::channel();
    adapter
        .pending_questions
        .borrow_mut()
        .push(PendingQuestion {
            request_id: request_id.clone(),
            turn_id: turn_id.clone(),
            questions: questions.clone(),
            resolve: RefCell::new(Some(resolve)),
        });
    let session_id = adapter.session_id.borrow().clone();
    adapter.emit(event(
        "question.requested",
        session_id.as_deref(),
        Some(&turn_id),
        tool_call_id.as_deref(),
        json!({ "requestId": request_id, "questions": questions }),
    ));
    Some(Box::pin(async move {
        Ok(response
            .await
            .unwrap_or_else(|_| json!({ "outcome": "cancelled" })))
    }))
}

/// `acpResolvePending(adapter, message)`.
pub fn acp_resolve_pending(adapter: &Inner, message: &str) {
    let approvals = std::mem::take(&mut *adapter.pending_approvals.borrow_mut());
    let questions = std::mem::take(&mut *adapter.pending_questions.borrow_mut());
    for pending in &approvals {
        settle(
            &pending.resolve,
            json!({ "outcome": { "outcome": "cancelled" } }),
        );
    }
    for pending in &questions {
        settle(&pending.resolve, json!({ "outcome": "cancelled" }));
    }
    if !approvals.is_empty() || !questions.is_empty() {
        adapter.warn(&redact_secret_text(message));
    }
}

fn option_kind(option: &Value) -> Option<&str> {
    option.get("kind").and_then(Value::as_str)
}

pub(crate) fn select_permission_option<'a>(
    options: &'a [Value],
    decision: Option<&str>,
) -> Option<&'a Value> {
    if decision == Some("acceptForSession")
        && let Some(session_scoped) = options
            .iter()
            .find(|option| option.get("optionId").and_then(Value::as_str) == Some("allow_session"))
    {
        return Some(session_scoped);
    }
    let desired: &[&str] = match decision {
        Some("acceptForSession") => &["allow_always", "allow_once"],
        Some("accept") => &["allow_once", "allow_always"],
        Some("decline") => &["reject_once", "reject_always"],
        _ => &[],
    };
    desired.iter().find_map(|kind| {
        options
            .iter()
            .find(|option| option_kind(option) == Some(kind))
    })
}

fn available_decisions(options: &[Value]) -> Vec<&'static str> {
    let has = |kinds: &[&str]| {
        options
            .iter()
            .any(|option| option_kind(option).is_some_and(|k| kinds.contains(&k)))
    };
    let mut decisions = Vec::new();
    if has(&["allow_once", "allow_always"]) {
        decisions.push("accept");
    }
    if has(&["allow_always"]) {
        decisions.push("acceptForSession");
    }
    if has(&["reject_once", "reject_always"]) {
        decisions.push("decline");
    }
    decisions.push("cancel");
    decisions
}

fn approval_kind(kind: Option<&str>) -> &'static str {
    match kind {
        Some("edit" | "delete" | "move") => "file-change",
        Some("execute") => "command",
        _ => "tool",
    }
}

fn first_text(value: &Value, keys: &[&str], limit: usize) -> String {
    keys.iter()
        .map(|key| text(value.get(*key), limit))
        .find(|text| !text.is_empty())
        .unwrap_or_default()
}

fn normalize_questions(value: Option<&Value>) -> Vec<Value> {
    array(value)
        .iter()
        .take(16)
        .enumerate()
        .map(|(index, question)| {
            let header = first_text(question, &["header", "title"], 160);
            let prompt = first_text(question, &["question", "prompt"], 2_000);
            let options: Vec<Value> = array(question.get("options"))
                .iter()
                .take(64)
                .map(|option| {
                    json!({
                        "id": safe_id_value(option.get("id")).or_else(|| safe_id_value(option.get("value"))),
                        "label": first_text(option, &["label", "name", "value"], 300),
                        "description": text(option.get("description"), 1_000),
                    })
                })
                .filter(|option| option["label"].as_str().is_some_and(|l| !l.is_empty()))
                .collect();
            json!({
                "id": safe_id_value(question.get("id")).unwrap_or_else(|| format!("question-{}", index + 1)),
                "header": if header.is_empty() { format!("Question {}", index + 1) } else { header },
                "question": if prompt.is_empty() { "Input required".to_string() } else { prompt },
                "multiple": js::truthy_opt(question.get("multiple")) || js::truthy_opt(question.get("multiSelect")),
                "custom": question.get("custom") != Some(&Value::Bool(false)),
                "options": options,
            })
        })
        .collect()
}

fn question_answer_map(questions: &[Value], answers: Option<&Value>) -> Value {
    let mut map = Map::new();
    for (index, question) in questions.iter().enumerate() {
        let values: Vec<Value> = array(answers.and_then(|a| a.get(index)))
            .iter()
            .map(|answer| text(Some(answer), 2_000))
            .filter(|answer| !answer.is_empty())
            .map(Value::from)
            .collect();
        map.insert(js::to_js_string(question.get("id")), Value::Array(values));
    }
    Value::Object(map)
}
