//! `runtimes/codex/codex-interactions.mjs`: native request correlation and
//! response serialization for the Codex adapter.
use super::codex_app_server_adapter::Inner;
use super::codex_native_values::{
    codex_question_answers, is_approval_decision, normalize_codex_questions,
    normalize_network_approval_context,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::{bound_renderer_value, redact_secrets};
use crate::agent::contract::js;
use serde_json::{Value, json};

/// One pending native approval request.
#[derive(Clone)]
pub struct PendingApproval {
    pub rpc_id: Value,
    pub request_id: String,
    pub kind: &'static str,
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub available_decisions: Vec<String>,
}

/// One pending native question.
#[derive(Clone)]
pub struct PendingQuestion {
    pub rpc_id: Value,
    pub request_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub questions: Vec<Value>,
}

fn field<'a>(request: &'a Value, key: &str) -> Option<&'a str> {
    request.get(key).and_then(Value::as_str)
}

/// `codexResolveApproval(adapter, { requestId, decision, threadId, turnId })`.
pub fn codex_resolve_approval(adapter: &Inner, request: &Value) -> AgentResult<()> {
    let request_id = field(request, "requestId");
    let pending = adapter
        .pending_approvals
        .borrow()
        .iter()
        .find(|p| Some(p.request_id.as_str()) == request_id)
        .cloned()
        .ok_or_else(|| AgentError::new("This approval is no longer pending."))?;
    if Some(pending.thread_id.as_str()) != field(request, "threadId")
        || Some(pending.turn_id.as_str()) != field(request, "turnId")
        || Some(&pending.thread_id) != adapter.thread_id.borrow().as_ref()
    {
        return Err(AgentError::new(
            "Approval correlation did not match the active Codex turn.",
        ));
    }
    let decision = field(request, "decision");
    if !pending
        .available_decisions
        .iter()
        .any(|d| Some(d.as_str()) == decision)
    {
        return Err(AgentError::new(
            "Codex did not offer that approval decision.",
        ));
    }
    adapter
        .require_connection()?
        .respond(pending.rpc_id.clone(), json!({ "decision": decision }))?;
    adapter
        .pending_approvals
        .borrow_mut()
        .retain(|p| p.request_id != pending.request_id);
    Ok(())
}

/// `codexResolveQuestion(adapter, { requestId, answers, rejected, turnId })`.
pub fn codex_resolve_question(adapter: &Inner, request: &Value) -> AgentResult<()> {
    let request_id = field(request, "requestId");
    let pending = adapter
        .pending_questions
        .borrow()
        .iter()
        .find(|p| Some(p.request_id.as_str()) == request_id)
        .cloned()
        .filter(|p| {
            Some(&p.thread_id) == adapter.thread_id.borrow().as_ref()
                && Some(p.turn_id.as_str()) == field(request, "turnId")
        })
        .ok_or_else(|| {
            AgentError::new("Question correlation did not match the active Codex turn.")
        })?;
    adapter
        .pending_questions
        .borrow_mut()
        .retain(|p| p.request_id != pending.request_id);
    let answers = if js::truthy_opt(request.get("rejected")) {
        json!({})
    } else {
        codex_question_answers(&pending.questions, request.get("answers"))
    };
    adapter
        .require_connection()?
        .respond(pending.rpc_id, json!({ "answers": answers }))
}

/// `typeof value === "string" ? value : null`.
fn string_value(value: Option<&Value>) -> Value {
    value
        .filter(|v| v.is_string())
        .cloned()
        .unwrap_or(Value::Null)
}

/// The native session ownership every interaction must carry.
fn owned_identity(adapter: &Inner, params: &Value) -> Option<(String, String, String)> {
    let thread_id = field(params, "threadId")?;
    if Some(thread_id) != adapter.thread_id.borrow().as_deref() {
        return None;
    }
    Some((
        thread_id.to_string(),
        field(params, "turnId")?.to_string(),
        field(params, "itemId")?.to_string(),
    ))
}

/// `codexHandleServerRequest(adapter, message)`.
pub fn codex_handle_server_request(adapter: &Inner, message: &Value) {
    let method = js::str_or_empty(message.get("method"));
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let empty = json!({});
    let params = message
        .get("params")
        .filter(|p| p.is_object())
        .unwrap_or(&empty);
    let Some(connection) = adapter.connection() else {
        return;
    };
    if method == "item/tool/requestUserInput" {
        codex_handle_question_request(adapter, id, params);
        return;
    }
    if method != "item/commandExecution/requestApproval"
        && method != "item/fileChange/requestApproval"
    {
        let _ = connection.respond_error(
            id,
            -32601,
            &format!("Unsupported Codex server request: {method}"),
        );
        adapter.emit(json!({
            "type": "provider.warning",
            "turnId": string_value(params.get("turnId")),
            "itemId": string_value(params.get("itemId")),
            "payload": {
                "message": format!("Codex requested unsupported input ({method}); it was denied."),
            },
        }));
        return;
    }
    let Some((thread_id, turn_id, item_id)) = owned_identity(adapter, params) else {
        let _ = connection.respond(id, json!({ "decision": "cancel" }));
        adapter.emit(json!({
            "type": "provider.error",
            "payload": {
                "message": "A Codex approval had impossible session ownership and was cancelled.",
                "recoverable": false,
            },
        }));
        return;
    };
    let explicit: Vec<String> = params
        .get("availableDecisions")
        .and_then(Value::as_array)
        .map(|decisions| {
            decisions
                .iter()
                .filter(|d| is_approval_decision(d))
                .filter_map(|d| d.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let available_decisions = if explicit.is_empty() {
        vec!["accept".into(), "decline".into(), "cancel".into()]
    } else {
        explicit
    };
    let request_id = format!("codex:{}", js::to_js_string(Some(&id)));
    let kind = if method.contains("commandExecution") {
        "command"
    } else {
        "file-change"
    };
    let network_approval_context =
        normalize_network_approval_context(params.get("networkApprovalContext"));
    adapter
        .pending_approvals
        .borrow_mut()
        .push(PendingApproval {
            rpc_id: id,
            request_id: request_id.clone(),
            kind,
            thread_id: thread_id.clone(),
            turn_id: turn_id.clone(),
            item_id: item_id.clone(),
            available_decisions: available_decisions.clone(),
        });
    let title = if !network_approval_context.is_null() {
        "Allow network access"
    } else if kind == "command" {
        "Run command"
    } else {
        "Apply file changes"
    };
    let array_or_empty = |key: &str| {
        params
            .get(key)
            .filter(|v| v.is_array())
            .cloned()
            .unwrap_or_else(|| json!([]))
    };
    let payload = json!({
        "requestId": request_id,
        "kind": kind,
        "title": title,
        "command": string_value(params.get("command")),
        "cwd": string_value(params.get("cwd")),
        "commandActions": array_or_empty("commandActions"),
        "networkApprovalContext": network_approval_context,
        "reason": string_value(params.get("reason")),
        "grantRoot": string_value(params.get("grantRoot")),
        "proposedExecpolicyAmendment": params
            .get("proposedExecpolicyAmendment")
            .cloned()
            .unwrap_or(Value::Null),
        "proposedNetworkPolicyAmendments": array_or_empty("proposedNetworkPolicyAmendments"),
        "availableDecisions": available_decisions,
        "startedAtMs": params
            .get("startedAtMs")
            .filter(|v| js::finite_number(v).is_some())
            .cloned()
            .unwrap_or_else(|| Value::from(js::now_ms())),
    });
    adapter.emit(json!({
        "type": "approval.requested",
        "providerSessionId": thread_id,
        "turnId": turn_id,
        "itemId": item_id,
        "payload": bound_renderer_value(&redact_secrets(&payload)),
    }));
}

/// `codexHandleQuestionRequest(adapter, { id, params })`.
pub fn codex_handle_question_request(adapter: &Inner, id: Value, params: &Value) {
    let Some(connection) = adapter.connection() else {
        return;
    };
    let Some((thread_id, turn_id, item_id)) = owned_identity(adapter, params) else {
        let _ = connection.respond(id, json!({ "answers": {} }));
        adapter.emit(json!({
            "type": "provider.error",
            "payload": {
                "message": "A Codex question had impossible session ownership and was cancelled.",
                "recoverable": false,
            },
        }));
        return;
    };
    let questions = normalize_codex_questions(params.get("questions"));
    let request_id = format!("codex:question:{}", js::to_js_string(Some(&id)));
    adapter
        .pending_questions
        .borrow_mut()
        .push(PendingQuestion {
            rpc_id: id,
            request_id: request_id.clone(),
            thread_id: thread_id.clone(),
            turn_id: turn_id.clone(),
            item_id: item_id.clone(),
            questions: questions.clone(),
        });
    let public: Vec<Value> = questions
        .iter()
        .map(|question| {
            let mut question = question.clone();
            js::delete(&mut question, "id");
            question
        })
        .collect();
    adapter.emit(json!({
        "type": "question.requested",
        "providerSessionId": thread_id,
        "turnId": turn_id,
        "itemId": item_id,
        "payload": { "requestId": request_id, "questions": public },
    }));
}

fn resolved_event(pending: &PendingApproval, decision: &str, reason: &str) -> Value {
    json!({
        "type": "approval.resolved",
        "providerSessionId": pending.thread_id,
        "turnId": pending.turn_id,
        "itemId": pending.item_id,
        "payload": { "requestId": pending.request_id, "decision": decision, "reason": reason },
    })
}

/// `codexHandleServerRequestResolved(adapter, params)`.
pub fn codex_handle_server_request_resolved(adapter: &Inner, params: &Value) {
    let Some(provider_request_id) = params
        .get("requestId")
        .filter(|id| id.is_string() || id.is_number())
    else {
        return;
    };
    let provider_request_id = js::to_js_string(Some(provider_request_id));
    let normalized = provider_request_id
        .strip_prefix("codex:")
        .unwrap_or(&provider_request_id)
        .to_string();
    let pending = adapter
        .pending_approvals
        .borrow()
        .iter()
        .find(|entry| {
            js::to_js_string(Some(&entry.rpc_id)) == normalized
                || entry.request_id == provider_request_id
        })
        .cloned();
    let Some(pending) = pending else { return };
    adapter
        .pending_approvals
        .borrow_mut()
        .retain(|p| p.request_id != pending.request_id);
    adapter.emit(resolved_event(&pending, "cancel", "provider-resolved"));
}

/// Answers a native request while the provider can still receive it.
fn respond_if_open(adapter: &Inner, id: &Value, result: Value) {
    if let Some(connection) = adapter.connection().filter(|c| !c.closed()) {
        // A closed provider cannot execute an unapproved action or keep
        // waiting for user input.
        let _ = connection.respond(id.clone(), result);
    }
}

/// `codexClearPendingApprovalsForTurn(adapter, turnId, reason, respond)`.
pub fn codex_clear_pending_approvals_for_turn(
    adapter: &Inner,
    turn_id: Option<&str>,
    reason: &str,
    respond: bool,
) {
    let Some(turn_id) = turn_id.filter(|t| !t.is_empty()) else {
        return;
    };
    let pending: Vec<PendingApproval> = adapter
        .pending_approvals
        .borrow()
        .iter()
        .filter(|p| p.turn_id == turn_id)
        .cloned()
        .collect();
    for pending in pending {
        if respond {
            respond_if_open(adapter, &pending.rpc_id, json!({ "decision": "cancel" }));
        }
        adapter
            .pending_approvals
            .borrow_mut()
            .retain(|p| p.request_id != pending.request_id);
        adapter.emit(resolved_event(&pending, "cancel", reason));
    }
}

/// `codexClearPendingApprovals(adapter, decision, respond)`.
pub fn codex_clear_pending_approvals(adapter: &Inner, decision: &str, respond: bool) {
    let pending = std::mem::take(&mut *adapter.pending_approvals.borrow_mut());
    for pending in pending {
        if respond {
            respond_if_open(adapter, &pending.rpc_id, json!({ "decision": decision }));
        }
        adapter.emit(resolved_event(&pending, decision, "adapter-closed"));
    }
}

/// `codexClearPendingQuestionsForTurn(adapter, turnId, respond)`.
pub fn codex_clear_pending_questions_for_turn(adapter: &Inner, turn_id: &str, respond: bool) {
    let pending: Vec<PendingQuestion> = adapter
        .pending_questions
        .borrow()
        .iter()
        .filter(|p| p.turn_id == turn_id)
        .cloned()
        .collect();
    for pending in pending {
        if respond {
            respond_if_open(adapter, &pending.rpc_id, json!({ "answers": {} }));
        }
        adapter
            .pending_questions
            .borrow_mut()
            .retain(|p| p.request_id != pending.request_id);
    }
}

/// `codexClearPendingQuestions(adapter, respond)`.
pub fn codex_clear_pending_questions(adapter: &Inner, respond: bool) {
    let pending = std::mem::take(&mut *adapter.pending_questions.borrow_mut());
    if respond {
        for pending in pending {
            respond_if_open(adapter, &pending.rpc_id, json!({ "answers": {} }));
        }
    }
}
