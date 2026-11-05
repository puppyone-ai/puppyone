//! `application/turn/agent-turn-coordinator.mjs`: user-driven turn and
//! blocking-interaction commands for live sessions.
use super::super::agent_input_policy::{
    normalize_approval_decision, normalize_optional_string, normalize_question_answers,
    normalize_required_id, normalize_sequence, require_matching_workspace,
};
use super::super::agent_reference_policy::{
    OperationIdentity, abandon_agent_steer_references, accept_agent_steer_references,
    begin_agent_steer_references, prepare_agent_steer_reference_input,
    prepare_agent_turn_reference_input, release_agent_reference_lease,
};
use super::super::session::agent_session_runtime::AgentSessionRuntime;
use super::agent_command_outcome_policy::is_agent_delivery_outcome_unknown;
use super::agent_command_policy::{
    command_fingerprint, command_identity, command_receipt, operation_identity, repeated_command,
    require_command_preconditions, start_command_intent,
};
use super::agent_start_transaction::{StartContext, execute_agent_start_transaction};
use super::agent_turn_queue::{AgentTurnQueue, MAX_QUEUED_TURNS};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use crate::agent::domain::agent_session_model::{
    SessionRef, require_connected_session, session_metadata,
};
use crate::agent::sender::Sender;
use serde_json::{Value, json};
use std::rc::Rc;

#[derive(Clone)]
pub struct AgentTurnCoordinator {
    runtime: AgentSessionRuntime,
    queue: AgentTurnQueue,
}

fn delivery_for(session: &SessionRef) -> impl Fn(&Value) -> Option<&'static str> {
    let adapter = session
        .adapter()
        .filter(|a| a.implements("referenceMentionDelivery"));
    move |reference: &Value| {
        adapter
            .as_ref()
            .and_then(|a| a.reference_mention_delivery(reference))
    }
}

impl AgentTurnCoordinator {
    /// `createAgentTurnCoordinator({ runtimeSession, emit, persistSoon, attachmentStore })`.
    pub fn new(runtime: AgentSessionRuntime) -> Self {
        let queue = AgentTurnQueue::new(runtime.attachments().cloned());
        let coordinator = Self {
            runtime: runtime.clone(),
            queue: queue.clone(),
        };
        let execute_runtime = runtime.clone();
        let scheduler = queue.clone();
        queue.set_execute_start(Rc::new(move |context| {
            let runtime = execute_runtime.clone();
            let scheduler = scheduler.clone();
            Box::pin(async move {
                execute_agent_start_transaction(context, &runtime, &|session| {
                    scheduler.schedule(session)
                })
                .await
            })
        }));
        coordinator
    }

    /// `turns.startTurn(sender, request, workspaceRoot)`.
    pub async fn start_turn(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let session = self
            .runtime
            .require_owned_session(sender, request.get("sessionId"))?;
        require_matching_workspace(&session.workspace_root(), workspace_root)?;
        require_command_preconditions(&session, request)?;
        let command_id = command_identity(request.get("commandId"));
        let (model, effort, mode) = {
            let state = session.state();
            (
                normalize_optional_string(request.get("model")).or(state.selected_model.clone()),
                normalize_optional_string(request.get("effort")).or(state.selected_effort.clone()),
                normalize_optional_string(request.get("mode")).or(state.selected_mode.clone()),
            )
        };
        let prepared = prepare_agent_turn_reference_input(
            request,
            session.capabilities().as_ref(),
            &delivery_for(&session),
        )?;
        let intent = start_command_intent(
            &prepared.display_prompt,
            &prepared.prompt_mentions,
            &prepared.reference_displays,
            model.as_deref(),
            effort.as_deref(),
            mode.as_deref(),
            normalize_optional_string(request.get("recoveryOfTurnId")).as_deref(),
        );
        let fingerprint = command_fingerprint(
            "start",
            &Obj::from(&intent)
                .set("references", prepared.references.clone())
                .build(),
        );
        if let Some(repeated) =
            repeated_command(&session, request.get("commandId"), "start", &fingerprint)?
        {
            return Ok(command_receipt(&session, &repeated));
        }
        let operation_id = operation_identity();
        require_connected_session(&session)?;
        self.runtime
            .require_available_model(&session, model.as_deref())?;
        self.runtime
            .require_available_effort(&session, model.as_deref(), effort.as_deref())?;
        let context = StartContext {
            session: session.clone(),
            request: request.clone(),
            prepared,
            model,
            effort,
            mode,
            command_id: command_id.clone(),
            operation_id: operation_id.clone(),
        };
        if session.active_turn_id().is_some()
            || session.turn_starting()
            || session.interrupting_turn_id().is_some()
        {
            if !session.capability("queue") {
                return Err(AgentError::new(
                    "An Agent turn is already running or stopping.",
                ));
            }
            if session.actor.control()["queue"]
                .as_array()
                .map_or(0, Vec::len)
                >= MAX_QUEUED_TURNS
            {
                return Err(AgentError::new(format!(
                    "Agent prompt queue is full ({MAX_QUEUED_TURNS})."
                )));
            }
            session.actor.dispatch(json!({
                "type": "command.received",
                "command": {
                    "commandId": command_id, "kind": "start", "status": "queued", "targetTurnId": null,
                    "operationId": operation_id, "intentFingerprint": fingerprint, "intent": intent,
                },
            }))?;
            self.queue.enqueue(context);
            return Ok(
                json!({ "sessionId": session.id(), "commandId": command_id, "queued": true, "turnId": session.active_turn_id() }),
            );
        }
        session.actor.dispatch(json!({
            "type": "command.received",
            "command": {
                "commandId": command_id, "kind": "start", "status": "dispatching", "targetTurnId": null,
                "operationId": operation_id, "intentFingerprint": fingerprint, "intent": intent,
            },
        }))?;
        let queue = self.queue.clone();
        execute_agent_start_transaction(context, &self.runtime, &move |current| {
            queue.schedule(current)
        })
        .await
    }

    /// `turns.steerTurn(sender, request, workspaceRoot)`.
    pub async fn steer_turn(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let session = self
            .runtime
            .require_owned_session(sender, request.get("sessionId"))?;
        require_matching_workspace(&session.workspace_root(), workspace_root)?;
        require_command_preconditions(&session, request)?;
        let command_id = command_identity(request.get("commandId"));
        let turn_id = normalize_required_id(request.get("turnId"), "Turn id")?;
        let prepared = prepare_agent_steer_reference_input(
            request,
            session.capabilities().as_ref(),
            &delivery_for(&session),
        )?;
        let fingerprint = command_fingerprint(
            "steer",
            &json!({
                "turnId": turn_id, "message": prepared.prompt, "references": prepared.references,
                "promptMentions": prepared.prompt_mentions,
            }),
        );
        if let Some(repeated) =
            repeated_command(&session, request.get("commandId"), "steer", &fingerprint)?
        {
            return Ok(Obj::from(&command_receipt(&session, &repeated))
                .set("steered", true)
                .build());
        }
        require_connected_session(&session)?;
        if session.active_turn_id().as_deref() != Some(turn_id.as_str()) {
            return Err(AgentError::new("That Agent turn is no longer running."));
        }
        let adapter = session
            .adapter()
            .filter(|a| session.capability("steer") && a.implements("steerTurn"));
        let Some(adapter) = adapter else {
            return Err(AgentError::new(
                "The active Agent runtime does not support steering a running turn.",
            ));
        };
        session.actor.dispatch(json!({
            "type": "command.received",
            "command": { "commandId": command_id, "kind": "steer", "status": "dispatching", "targetTurnId": turn_id, "intentFingerprint": fingerprint },
        }))?;
        let operation_id = operation_identity();
        let identity = OperationIdentity {
            command_id: command_id.clone(),
            operation_id: operation_id.clone(),
            adapter_generation: session.actor.control()["adapterGeneration"]
                .as_i64()
                .unwrap_or(0),
        };
        session
            .actor
            .dispatch(json!({ "type": "command.dispatching", "commandId": command_id, "operationId": operation_id }))?;
        begin_agent_steer_references(&session, request, &identity, &prepared);
        let steered = adapter
            .steer_turn(json!({ "turnId": turn_id, "message": prepared.prompt, "references": prepared.references }))
            .await;
        match steered {
            Ok(_) => {
                let accepted = session.actor.dispatch(json!({
                    "type": "command.accepted", "commandId": command_id, "operationId": operation_id, "turnId": turn_id,
                }))?;
                if !accepted.changed {
                    return Ok(
                        json!({ "sessionId": session.id(), "commandId": command_id, "turnId": turn_id, "steered": true, "outcomeUnknown": true }),
                    );
                }
                accept_agent_steer_references(&session, &identity, &turn_id);
                Ok(
                    json!({ "sessionId": session.id(), "commandId": command_id, "turnId": turn_id, "steered": true }),
                )
            }
            Err(error) => {
                let message = redact_secret_text(&error.message);
                if is_agent_delivery_outcome_unknown(&error) {
                    session.actor.dispatch(json!({
                        "type": "command.outcome-unknown", "commandId": command_id, "operationId": operation_id, "error": message,
                    }))?;
                    return Ok(
                        json!({ "sessionId": session.id(), "commandId": command_id, "turnId": turn_id, "steered": true, "outcomeUnknown": true }),
                    );
                }
                abandon_agent_steer_references(&session, &identity);
                session.actor.dispatch(json!({
                    "type": "command.rejected", "commandId": command_id, "operationId": operation_id, "error": message,
                }))?;
                release_agent_reference_lease(&session, request, self.runtime.attachments()).await;
                Err(error)
            }
        }
    }

    /// `turns.interruptTurn(sender, request, workspaceRoot)`.
    pub async fn interrupt_turn(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let session = self
            .runtime
            .require_owned_session(sender, request.get("sessionId"))?;
        require_matching_workspace(&session.workspace_root(), workspace_root)?;
        require_command_preconditions(&session, request)?;
        let command_id = command_identity(request.get("commandId"));
        let turn_id = normalize_required_id(request.get("turnId"), "Turn id")?;
        let fingerprint = command_fingerprint("interrupt", &json!({ "turnId": turn_id }));
        if let Some(repeated) = repeated_command(
            &session,
            request.get("commandId"),
            "interrupt",
            &fingerprint,
        )? {
            return Ok(Obj::from(&command_receipt(&session, &repeated))
                .set("interruptRequested", true)
                .build());
        }
        require_connected_session(&session)?;
        if session.active_turn_id().as_deref() != Some(turn_id.as_str()) {
            return Err(AgentError::new("That Agent turn is no longer running."));
        }
        if session.interrupting_turn_id().as_deref() == Some(turn_id.as_str()) {
            let operation_id = operation_identity();
            session.actor.dispatch(json!({
                "type": "command.received",
                "command": {
                    "commandId": command_id, "kind": "interrupt", "status": "dispatching", "targetTurnId": turn_id,
                    "operationId": operation_id, "intentFingerprint": fingerprint,
                },
            }))?;
            session.actor.dispatch(json!({
                "type": "command.accepted", "commandId": command_id, "operationId": operation_id, "turnId": turn_id,
            }))?;
            return Ok(
                json!({ "sessionId": session.id(), "commandId": command_id, "turnId": turn_id, "interruptRequested": true, "deduplicated": true }),
            );
        }
        session.actor.dispatch(json!({
            "type": "interrupt.requested", "commandId": command_id, "turnId": turn_id, "intentFingerprint": fingerprint,
        }))?;
        let operation_id = operation_identity();
        session
            .actor
            .dispatch(json!({ "type": "command.dispatching", "commandId": command_id, "operationId": operation_id }))?;
        let adapter = session
            .adapter()
            .ok_or_else(|| AgentError::new("The Agent runtime is disconnected."))?;
        if let Err(error) = adapter.interrupt_turn(json!({ "turnId": turn_id })).await {
            let message = redact_secret_text(&error.message);
            if is_agent_delivery_outcome_unknown(&error) {
                session.actor.dispatch(json!({
                    "type": "command.outcome-unknown", "commandId": command_id, "operationId": operation_id, "error": message,
                }))?;
                if session.active_turn_id().as_deref() == Some(turn_id.as_str()) {
                    self.runtime.schedule_interrupt_fallback(&session, &turn_id);
                }
                return Ok(
                    json!({ "sessionId": session.id(), "commandId": command_id, "turnId": turn_id, "interruptRequested": true, "outcomeUnknown": true }),
                );
            }
            session.actor.dispatch(json!({
                "type": "command.rejected", "commandId": command_id, "operationId": operation_id, "error": message,
            }))?;
            self.runtime.clear_interrupt_fallback(&session);
            return Err(AgentError::new(message));
        }
        let accepted = session.actor.dispatch(json!({
            "type": "command.accepted", "commandId": command_id, "operationId": operation_id, "turnId": turn_id,
        }))?;
        if !accepted.changed {
            return Ok(
                json!({ "sessionId": session.id(), "commandId": command_id, "turnId": turn_id, "interruptRequested": true, "outcomeUnknown": true }),
            );
        }
        // Keep blocking requests actionable until the runtime accepts interruption.
        self.runtime.fail_pending_for_turn(
            &session,
            "approvals",
            Some(&turn_id),
            "turn-interrupted",
        );
        self.runtime.fail_pending_for_turn(
            &session,
            "questions",
            Some(&turn_id),
            "turn-interrupted",
        );
        if session.active_turn_id().as_deref() == Some(turn_id.as_str()) {
            self.runtime.schedule_interrupt_fallback(&session, &turn_id);
        }
        Ok(
            json!({ "sessionId": session.id(), "commandId": command_id, "turnId": turn_id, "interruptRequested": true }),
        )
    }

    /// `turns.resolveQuestion(sender, request, workspaceRoot)`.
    pub async fn resolve_question(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let session = self
            .runtime
            .require_owned_session(sender, request.get("sessionId"))?;
        require_matching_workspace(&session.workspace_root(), workspace_root)?;
        require_command_preconditions(&session, request)?;
        let command_id = command_identity(request.get("commandId"));
        let turn_id = normalize_required_id(request.get("turnId"), "Turn id")?;
        let request_id = normalize_required_id(request.get("requestId"), "Question request id")?;
        let answers_input = request
            .get("answers")
            .filter(|a| !a.is_null())
            .or(request.get("answer"));
        let fingerprint = command_fingerprint(
            "question",
            &json!({
                "turnId": turn_id, "requestId": request_id,
                "answers": answers_input.cloned().unwrap_or(Value::Null),
                "rejected": request["rejected"] == true,
            }),
        );
        if let Some(repeated) =
            repeated_command(&session, request.get("commandId"), "question", &fingerprint)?
        {
            return Ok(Obj::from(&command_receipt(&session, &repeated))
                .set("requestId", request_id)
                .build());
        }
        let Some(pending) = session.pending_question(&request_id) else {
            return Err(AgentError::new(
                "This question is stale or already resolved.",
            ));
        };
        require_reply_available(&session, &request_id)?;
        if pending["turnId"] != turn_id.as_str()
            || pending["runtimeId"] != session.runtime_id().as_str()
        {
            return Err(AgentError::new(
                "Question correlation does not match the active request.",
            ));
        }
        let adapter = session.adapter().filter(|a| {
            session.capability("structuredQuestions") && a.implements("resolveQuestion")
        });
        let Some(adapter) = adapter else {
            return Err(AgentError::new(
                "The active Agent runtime does not support structured questions.",
            ));
        };
        let answers = normalize_question_answers(answers_input, &pending["questions"])?;
        let rejected = request["rejected"] == true || answers.is_none();
        session.actor.dispatch(json!({
            "type": "command.received",
            "command": {
                "commandId": command_id, "kind": "question", "requestId": request_id, "status": "dispatching",
                "targetTurnId": turn_id, "intentFingerprint": fingerprint,
            },
        }))?;
        let operation_id = operation_identity();
        session
            .actor
            .dispatch(json!({ "type": "command.dispatching", "commandId": command_id, "operationId": operation_id }))?;
        let delivered = adapter
            .resolve_question(json!({
                "requestId": request_id, "answers": answers.unwrap_or_default(), "rejected": rejected, "turnId": turn_id,
            }))
            .await;
        match delivered {
            Ok(_) => {
                let accepted = session.actor.dispatch(json!({
                    "type": "command.accepted", "commandId": command_id, "operationId": operation_id, "turnId": turn_id,
                }))?;
                if !accepted.changed {
                    return Ok(
                        json!({ "sessionId": session.id(), "commandId": command_id, "requestId": request_id, "outcomeUnknown": true }),
                    );
                }
            }
            Err(error) => {
                let message = redact_secret_text(&error.message);
                if is_agent_delivery_outcome_unknown(&error) {
                    session.actor.dispatch(json!({
                        "type": "command.outcome-unknown", "commandId": command_id, "operationId": operation_id, "error": message,
                    }))?;
                    return Ok(
                        json!({ "sessionId": session.id(), "commandId": command_id, "requestId": request_id, "outcomeUnknown": true }),
                    );
                }
                session.actor.dispatch(json!({
                    "type": "command.rejected", "commandId": command_id, "operationId": operation_id, "error": message,
                }))?;
                return Err(error);
            }
        }
        let resolution = if rejected { "rejected" } else { "answered" };
        if session.pending_question(&request_id).is_some() {
            self.runtime.journal().emit(
                &session,
                json!({
                    "type": "question.resolved", "providerSessionId": session.provider_session_id(), "turnId": turn_id,
                    "itemId": pending["itemId"], "payload": { "requestId": request_id, "resolution": resolution },
                }),
            );
        }
        Ok(
            json!({ "sessionId": session.id(), "commandId": command_id, "requestId": request_id, "resolution": resolution }),
        )
    }

    /// `turns.resolveApproval(sender, request, workspaceRoot)`.
    pub async fn resolve_approval(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let session = self
            .runtime
            .require_owned_session(sender, request.get("sessionId"))?;
        require_matching_workspace(&session.workspace_root(), workspace_root)?;
        require_command_preconditions(&session, request)?;
        let command_id = command_identity(request.get("commandId"));
        let request_id = normalize_required_id(request.get("requestId"), "Approval request id")?;
        let turn_id = normalize_required_id(request.get("turnId"), "Turn id")?;
        let decision = normalize_approval_decision(request.get("decision"))?;
        let fingerprint = command_fingerprint(
            "approval",
            &json!({ "requestId": request_id, "turnId": turn_id, "decision": decision }),
        );
        if let Some(repeated) =
            repeated_command(&session, request.get("commandId"), "approval", &fingerprint)?
        {
            return Ok(Obj::from(&command_receipt(&session, &repeated))
                .set("requestId", request_id)
                .set("decision", decision)
                .build());
        }
        let Some(pending) = session.pending_approval(&request_id) else {
            return Err(AgentError::new(
                "This approval is stale or already resolved.",
            ));
        };
        require_reply_available(&session, &request_id)?;
        if pending["turnId"] != turn_id.as_str()
            || pending["runtimeId"] != session.runtime_id().as_str()
        {
            return Err(AgentError::new(
                "Approval correlation does not match the active request.",
            ));
        }
        session.actor.dispatch(json!({
            "type": "command.received",
            "command": {
                "commandId": command_id, "kind": "approval", "requestId": request_id, "status": "dispatching",
                "targetTurnId": turn_id, "intentFingerprint": fingerprint,
            },
        }))?;
        let operation_id = operation_identity();
        session
            .actor
            .dispatch(json!({ "type": "command.dispatching", "commandId": command_id, "operationId": operation_id }))?;
        let adapter = session
            .adapter()
            .ok_or_else(|| AgentError::new("The Agent runtime is disconnected."))?;
        let delivered = adapter
            .resolve_approval(json!({
                "requestId": request_id, "decision": decision, "threadId": session.provider_session_id(), "turnId": turn_id,
            }))
            .await;
        if let Err(error) = delivered {
            let message = redact_secret_text(&error.message);
            if is_agent_delivery_outcome_unknown(&error) {
                session.actor.dispatch(json!({
                    "type": "command.outcome-unknown", "commandId": command_id, "operationId": operation_id, "error": message,
                }))?;
                return Ok(
                    json!({ "sessionId": session.id(), "commandId": command_id, "requestId": request_id, "outcomeUnknown": true }),
                );
            }
            session.actor.dispatch(json!({
                "type": "command.rejected", "commandId": command_id, "operationId": operation_id, "error": message,
            }))?;
            return Err(error);
        }
        let accepted = session.actor.dispatch(json!({
            "type": "command.accepted", "commandId": command_id, "operationId": operation_id, "turnId": turn_id,
        }))?;
        if !accepted.changed {
            return Ok(
                json!({ "sessionId": session.id(), "commandId": command_id, "requestId": request_id, "outcomeUnknown": true }),
            );
        }
        if session.pending_approval(&request_id).is_some() {
            self.runtime.journal().emit(
                &session,
                json!({
                    "type": "approval.resolved", "providerSessionId": session.provider_session_id(), "turnId": turn_id,
                    "itemId": pending["itemId"], "payload": { "requestId": request_id, "decision": decision },
                }),
            );
        }
        Ok(
            json!({ "sessionId": session.id(), "commandId": command_id, "requestId": request_id, "decision": decision }),
        )
    }

    /// `turns.replay(sender, request, workspaceRoot)`.
    pub fn replay(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let session = self
            .runtime
            .require_owned_session(sender, request.get("sessionId"))?;
        require_matching_workspace(&session.workspace_root(), workspace_root)?;
        let after_sequence = normalize_sequence(request.get("afterSequence"));
        let session_events = session.events();
        let first_sequence = session_events
            .first()
            .and_then(|e| e["sequence"].as_i64())
            .unwrap_or(session.sequence() + 1);
        let snapshot = session.actor.snapshot();
        let events: Vec<Value> = snapshot.timeline["events"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|event| event["sequence"].as_i64().unwrap_or(0) > after_sequence)
            .cloned()
            .collect();
        let state = session.state();
        let account = state.account.clone();
        let models = state.models.clone();
        let capabilities = state.capabilities.clone().unwrap_or(Value::Null);
        let modes = state.modes.clone();
        let commands = state.commands.clone();
        let runtime = state.runtime.clone();
        drop(state);
        Ok(Obj::new()
            .set("session", session_metadata(&session, None))
            .set("account", account)
            .set("models", models)
            .set("capabilities", capabilities)
            .set("modes", modes)
            .set("commands", commands)
            .set("runtime", runtime)
            .set("cursor", snapshot.cursor.clone())
            .set("control", snapshot.control.clone())
            .set("display", snapshot.display.to_value())
            .set(
                "timeline",
                js::with(&snapshot.timeline, "events", events.clone()),
            )
            .set("events", events)
            .set(
                "partial",
                after_sequence > 0 && after_sequence < first_sequence - 1,
            )
            .set("firstAvailableSequence", first_sequence)
            .set("lastSequence", session.sequence())
            .build())
    }

    /// `turns.getReferenceInputCapabilities(sender, sessionId, workspaceRoot)`.
    pub fn get_reference_input_capabilities(
        &self,
        sender: &Sender,
        session_id: Option<&Value>,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let id = normalize_required_id(session_id, "Agent session id")?;
        let session = self
            .runtime
            .require_owned_session(sender, Some(&Value::from(id)))?;
        require_matching_workspace(&session.workspace_root(), workspace_root)?;
        Ok(session
            .capabilities()
            .and_then(|c| c.get("referenceInputs").filter(|r| js::truthy(r)).cloned())
            .unwrap_or(Value::Null))
    }
}

fn require_reply_available(session: &SessionRef, request_id: &str) -> AgentResult<()> {
    let busy = session.actor.read(|actor| {
        actor.control()["commands"]
            .as_array()
            .is_some_and(|commands| {
                commands.iter().any(|command| {
                    command["requestId"] == request_id
                        && matches!(
                            command["status"].as_str(),
                            Some("dispatching" | "accepted" | "outcome-unknown")
                        )
                })
            })
    });
    if busy {
        return Err(AgentError::new(
            "A response to this Agent request is already being delivered or awaiting confirmation.",
        ));
    }
    Ok(())
}
