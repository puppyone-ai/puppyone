//! `runtimes/claude/claude-interactions.mjs`: native permission and
//! question requests correlated to the active turn, and their responses.
use super::claude_agent_sdk::PermissionOptions;
use super::claude_native_values::{as_array, bounded, humanize, safe_id};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::{bound_renderer_value, redact_secrets};
use crate::agent::contract::js;
use futures_util::future::LocalBoxFuture;
use serde_json::{Map, Value, json};
use std::cell::RefCell;
use std::rc::Rc;
use tokio::sync::oneshot;

struct PendingApproval {
    request_id: String,
    turn_id: String,
    input: Value,
    suggestions: Option<Value>,
    resolve: oneshot::Sender<Value>,
}

struct PendingQuestion {
    request_id: String,
    turn_id: String,
    input: Value,
    questions: Vec<Value>,
    resolve: oneshot::Sender<Value>,
}

/// `adapter.pendingApprovals` and `adapter.pendingQuestions`.
#[derive(Default)]
pub struct ClaudePendingInteractions {
    approvals: RefCell<Vec<PendingApproval>>,
    questions: RefCell<Vec<PendingQuestion>>,
}

impl ClaudePendingInteractions {
    pub fn len(&self) -> usize {
        self.approvals.borrow().len() + self.questions.borrow().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn take_approval(&self, request_id: &str) -> Option<PendingApproval> {
        let mut approvals = self.approvals.borrow_mut();
        let index = approvals.iter().position(|p| p.request_id == request_id)?;
        Some(approvals.remove(index))
    }

    fn take_question(&self, request_id: &str) -> Option<PendingQuestion> {
        let mut questions = self.questions.borrow_mut();
        let index = questions.iter().position(|p| p.request_id == request_id)?;
        Some(questions.remove(index))
    }
}

/// What the interaction functions read from the adapter.
pub trait ClaudeInteractionHost {
    fn disposed(&self) -> bool;
    fn active_turn_id(&self) -> Option<String>;
    fn session_id(&self) -> Option<String>;
    fn emit(&self, event: Value);
    fn pending(&self) -> Rc<ClaudePendingInteractions>;
}

fn field<'a>(request: &'a Value, key: &str) -> Option<&'a str> {
    request.get(key).and_then(Value::as_str)
}

/// `claudeResolveApproval(adapter, { requestId, decision, turnId })`.
pub fn claude_resolve_approval(
    host: &dyn ClaudeInteractionHost,
    request: &Value,
) -> AgentResult<()> {
    let pending = host.pending();
    let request_id = field(request, "requestId").unwrap_or("");
    let turn_id = field(request, "turnId");
    let matches = pending.approvals.borrow().iter().any(|p| {
        p.request_id == request_id
            && Some(p.turn_id.as_str()) == turn_id
            && turn_id.map(str::to_string) == host.active_turn_id()
    });
    if !matches {
        return Err(AgentError::new(
            "Approval correlation did not match the active Claude Code turn.",
        ));
    }
    let Some(approval) = pending.take_approval(request_id) else {
        return Ok(());
    };
    let decision = field(request, "decision").unwrap_or("");
    if matches!(decision, "accept" | "acceptForSession") {
        let updated: Vec<Value> = if decision == "acceptForSession" {
            as_array(approval.suggestions.as_ref())
                .iter()
                .filter(|s| s.get("destination").and_then(Value::as_str) == Some("session"))
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        let mut result = json!({ "behavior": "allow", "updatedInput": approval.input });
        if !updated.is_empty() {
            result["updatedPermissions"] = Value::Array(updated);
        }
        let _ = approval.resolve.send(result);
        return Ok(());
    }
    let cancel = decision == "cancel";
    let _ = approval.resolve.send(json!({
        "behavior": "deny",
        "message": if cancel { "User interrupted." } else { "User denied this action." },
        "interrupt": cancel,
    }));
    Ok(())
}

/// `claudeResolveQuestion(adapter, { requestId, answers, rejected, turnId })`.
pub fn claude_resolve_question(
    host: &dyn ClaudeInteractionHost,
    request: &Value,
) -> AgentResult<()> {
    let pending = host.pending();
    let request_id = field(request, "requestId").unwrap_or("");
    let turn_id = field(request, "turnId");
    let matches = pending.questions.borrow().iter().any(|p| {
        p.request_id == request_id
            && Some(p.turn_id.as_str()) == turn_id
            && turn_id.map(str::to_string) == host.active_turn_id()
    });
    if !matches {
        return Err(AgentError::new(
            "Question correlation did not match the active Claude Code turn.",
        ));
    }
    let Some(question) = pending.take_question(request_id) else {
        return Ok(());
    };
    if js::truthy_opt(request.get("rejected")) {
        let _ = question.resolve.send(json!({
            "behavior": "deny",
            "message": "User declined to answer.",
            "interrupt": true,
        }));
        return Ok(());
    }
    let answers = question_answer_map(&question.questions, request.get("answers"));
    let updated_input = js::with(&record(&question.input), "answers", answers);
    let _ = question
        .resolve
        .send(json!({ "behavior": "allow", "updatedInput": updated_input }));
    Ok(())
}

fn record(value: &Value) -> Value {
    if value.is_object() {
        value.clone()
    } else {
        json!({})
    }
}

fn deny(message: &str) -> Value {
    json!({ "behavior": "deny", "message": message, "interrupt": true })
}

/// Resolves when the response arrives (a dropped request denies).
fn await_response(
    receiver: oneshot::Receiver<Value>,
) -> LocalBoxFuture<'static, AgentResult<Value>> {
    Box::pin(async move {
        Ok(receiver
            .await
            .unwrap_or_else(|_| deny("Claude Code query closed before the request was resolved.")))
    })
}

/// `claudeRequestPermission(adapter, toolName, input, options)`: the SDK's
/// `canUseTool`.
pub fn claude_request_permission(
    host: &dyn ClaudeInteractionHost,
    tool_name: String,
    input: Value,
    options: PermissionOptions,
) -> LocalBoxFuture<'static, AgentResult<Value>> {
    let Some(turn_id) = host.active_turn_id().filter(|_| !host.disposed()) else {
        return Box::pin(async {
            Ok(json!({
                "behavior": "deny",
                "message": "No active Claude Code session owns this request.",
            }))
        });
    };
    if tool_name == "AskUserQuestion" {
        return claude_request_question(host, turn_id, input, options);
    }
    let tool_use_id = safe_id(options.tool_use_id.as_ref());
    let request_id = format!(
        "claude:{}",
        tool_use_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
    );
    let (resolve, receiver) = oneshot::channel();
    let pending = host.pending();
    pending.approvals.borrow_mut().push(PendingApproval {
        request_id: request_id.clone(),
        turn_id: turn_id.clone(),
        input: if input.is_null() {
            json!({})
        } else {
            input.clone()
        },
        suggestions: options.suggestions.clone(),
        resolve,
    });
    listen_for_abort(&options, &pending, request_id.clone(), |pending, id| {
        pending
            .take_approval(id)
            .map(|approval| approval.resolve)
            .map(|resolve| (resolve, deny("Approval request was cancelled.")))
    });
    let title = Some(bounded(options.title.as_ref(), 300))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| format!("Allow {}", humanize(&tool_name)));
    let description = Some(bounded(options.description.as_ref(), 2_000))
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| bounded(options.decision_reason.as_ref(), 2_000));
    let display_name = Some(bounded(options.display_name.as_ref(), 160))
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| humanize(&tool_name));
    host.emit(json!({
        "type": "approval.requested",
        "providerSessionId": host.session_id(),
        "turnId": turn_id,
        "itemId": tool_use_id,
        "payload": {
            "requestId": request_id,
            "title": title,
            "description": description,
            "displayName": display_name,
            "kind": permission_kind(&tool_name),
            "toolName": bounded(Some(&Value::from(tool_name.as_str())), 160),
            "input": bound_renderer_value(&redact_secrets(&input)),
            "availableDecisions": ["accept", "acceptForSession", "decline", "cancel"],
        },
    }));
    await_response(receiver)
}

/// `claudeRequestQuestion(adapter, input, options)`.
fn claude_request_question(
    host: &dyn ClaudeInteractionHost,
    turn_id: String,
    input: Value,
    options: PermissionOptions,
) -> LocalBoxFuture<'static, AgentResult<Value>> {
    let tool_use_id = safe_id(options.tool_use_id.as_ref());
    let request_id = format!(
        "claude:{}",
        tool_use_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
    );
    let questions = normalize_questions(input.get("questions"));
    let (resolve, receiver) = oneshot::channel();
    let pending = host.pending();
    pending.questions.borrow_mut().push(PendingQuestion {
        request_id: request_id.clone(),
        turn_id: turn_id.clone(),
        input: if input.is_null() { json!({}) } else { input },
        questions: questions.clone(),
        resolve,
    });
    listen_for_abort(&options, &pending, request_id.clone(), |pending, id| {
        pending
            .take_question(id)
            .map(|question| (question.resolve, deny("Question request was cancelled.")))
    });
    host.emit(json!({
        "type": "question.requested",
        "providerSessionId": host.session_id(),
        "turnId": turn_id,
        "itemId": tool_use_id,
        "payload": { "requestId": request_id, "questions": questions },
    }));
    await_response(receiver)
}

/// `listenForAbort(signal, callback)`.
fn listen_for_abort(
    options: &PermissionOptions,
    pending: &Rc<ClaudePendingInteractions>,
    request_id: String,
    take: impl Fn(&ClaudePendingInteractions, &str) -> Option<(oneshot::Sender<Value>, Value)> + 'static,
) {
    let Some(signal) = options.signal.clone() else {
        return;
    };
    let pending = Rc::downgrade(pending);
    let cancel = move || {
        let Some(pending) = pending.upgrade() else {
            return;
        };
        if let Some((resolve, response)) = take(&pending, &request_id) {
            let _ = resolve.send(response);
        }
    };
    if signal.is_cancelled() {
        cancel();
    } else {
        signal.on_cancel(cancel);
    }
}

/// `claudeResolvePending(adapter, message)`: every open request is denied.
pub fn claude_resolve_pending(pending: &ClaudePendingInteractions, message: &str) {
    let approvals: Vec<PendingApproval> = pending.approvals.borrow_mut().drain(..).collect();
    let questions: Vec<PendingQuestion> = pending.questions.borrow_mut().drain(..).collect();
    for approval in approvals {
        let _ = approval.resolve.send(deny(message));
    }
    for question in questions {
        let _ = question.resolve.send(deny(message));
    }
}

fn normalize_questions(value: Option<&Value>) -> Vec<Value> {
    as_array(value)
        .iter()
        .take(8)
        .map(|question| {
            let options: Vec<Value> = as_array(question.get("options"))
                .iter()
                .take(20)
                .map(|option| match option {
                    Value::String(_) => {
                        json!({ "label": bounded(Some(option), 120), "description": "" })
                    }
                    option => json!({
                        "label": bounded(option.get("label"), 120),
                        "description": bounded(option.get("description"), 1_000),
                    }),
                })
                .collect();
            json!({
                "header": bounded(question.get("header"), 80),
                "question": bounded(question.get("question"), 4_000),
                "multiple": question.get("multiSelect") == Some(&Value::Bool(true)),
                "custom": question.get("isOther") != Some(&Value::Bool(false)),
                "options": options,
            })
        })
        .filter(|question| question["question"].as_str().is_some_and(|q| !q.is_empty()))
        .collect()
}

fn question_answer_map(questions: &[Value], answers: Option<&Value>) -> Value {
    let mut map = Map::new();
    for (index, question) in questions.iter().enumerate() {
        let row: Vec<String> = as_array(answers.and_then(|a| a.get(index)))
            .iter()
            .map(|answer| bounded(Some(answer), 4_000))
            .filter(|answer| !answer.is_empty())
            .collect();
        let value = if question["multiple"] == Value::Bool(true) {
            json!(row)
        } else {
            json!(row.first().cloned().unwrap_or_default())
        };
        map.insert(js::to_js_string(question.get("question")), value);
    }
    Value::Object(map)
}

fn permission_kind(tool_name: &str) -> &'static str {
    let name = tool_name.to_lowercase();
    match name.as_str() {
        "bash" => "command",
        "write" | "edit" | "multiedit" | "notebookedit" => "file-change",
        name if name.contains("web") => "network",
        _ => "tool",
    }
}
