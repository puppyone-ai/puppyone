//! `application/turn/agent-start-transaction.mjs`: executes one
//! already-reserved start command and settles every ownership path.
use super::super::agent_reference_policy::{
    OperationIdentity, PreparedInput, abandon_agent_turn_references, accept_agent_turn_references,
    begin_agent_turn_references, release_agent_reference_lease, revoke_agent_operation_references,
};
use super::super::session::agent_session_runtime::AgentSessionRuntime;
use super::agent_command_outcome_policy::{
    agent_delivery_outcome_unknown_error, is_agent_delivery_outcome_unknown,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::Obj;
use crate::agent::domain::agent_session_model::SessionRef;
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;

static USER_MESSAGE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("message id"));

/// One start the coordinator or queue dispatches.
#[derive(Clone)]
pub struct StartContext {
    pub session: SessionRef,
    pub request: Value,
    pub prepared: PreparedInput,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub mode: Option<String>,
    pub command_id: String,
    pub operation_id: String,
}

fn user_message_id(session: &SessionRef, command_id: &str) -> Value {
    session.actor.read(|actor| {
        actor.control()["commands"]
            .as_array()
            .and_then(|commands| commands.iter().find(|c| c["commandId"] == command_id))
            .map(|c| c["userMessageId"].clone())
            .unwrap_or(Value::Null)
    })
}

/// `executeAgentStartTransaction(context, { runtimeSession, emit, persistSoon, attachmentStore, onSettled })`.
pub async fn execute_agent_start_transaction(
    context: StartContext,
    runtime: &AgentSessionRuntime,
    on_settled: &dyn Fn(&SessionRef),
) -> AgentResult<Value> {
    let StartContext {
        session,
        request,
        prepared,
        model,
        effort,
        mode,
        command_id,
        operation_id,
    } = context;
    let adapter_generation = session.actor.control()["adapterGeneration"]
        .as_i64()
        .unwrap_or(0);
    let identity = OperationIdentity {
        command_id: command_id.clone(),
        operation_id: operation_id.clone(),
        adapter_generation,
    };
    let attachments = runtime.attachments().cloned();
    let result = async {
        begin_agent_turn_references(&session, &request, &identity, &prepared)?;
        {
            let mut state = session.state_mut();
            state.selected_model = model.clone();
            state.selected_effort = effort.clone();
            state.selected_mode = mode.clone();
        }
        let references = prepared.references.clone();
        let adapter = session.adapter().ok_or_else(|| AgentError::new("The Agent runtime is disconnected."))?;
        let start = Obj::new()
            .set("prompt", prepared.prompt.as_str())
            .set("clientUserMessageId", user_message_id(&session, &command_id))
            .set("model", model.clone())
            .opt("effort", effort.clone())
            .set("mode", mode.clone())
            .set("references", references.clone())
            .set(
                "attachments",
                references.iter().filter(|r| r["kind"] == "staged-attachment").cloned().collect::<Vec<_>>(),
            )
            .set(
                "contextReferences",
                references.iter().filter(|r| r["kind"] == "workspace-entry").cloned().collect::<Vec<_>>(),
            )
            .build();
        let result = adapter.start_turn(start).await?;
        let control = session.actor.control();
        if !runtime.is_current(&session)
            || control["adapterGeneration"].as_i64() != Some(adapter_generation)
            || matches!(control["connection"]["status"].as_str(), Some("exited" | "disconnected"))
        {
            return Err(agent_delivery_outcome_unknown_error(
                "The Agent session changed before turn acceptance could be confirmed.",
            ));
        }
        let turn_id = result["turnId"].as_str().unwrap_or("").to_string();
        let terminal_outcome = session.actor.read(|actor| actor.terminal_outcome(&turn_id).map(str::to_string));
        if terminal_outcome.is_none() && session.last_started_turn_id().as_deref() != Some(turn_id.as_str()) {
            runtime.journal().emit(
                &session,
                Obj::new()
                    .set("type", "turn.started")
                    .set("providerSessionId", session.provider_session_id())
                    .set("turnId", turn_id.as_str())
                    .set(
                        "payload",
                        Obj::new()
                            .set("status", "running")
                            .set("prompt", prepared.display_prompt.as_str())
                            .opt(
                                "recoveryOfTurnId",
                                request.get("recoveryOfTurnId").filter(|r| crate::agent::contract::js::truthy(r)).cloned(),
                            )
                            .set("userMessageId", user_message_id(&session, &command_id))
                            .set("submissionId", command_id.as_str())
                            .set("model", model.clone())
                            .set("effort", effort.clone())
                            .set("mode", mode.clone())
                            .set("referenceDisplays", prepared.reference_displays.clone())
                            .set("promptMentions", prepared.prompt_mentions.clone())
                            .build(),
                    )
                    .build(),
            );
        }
        let accepted = session.actor.dispatch(json!({
            "type": "submission.accepted",
            "commandId": command_id,
            "operationId": operation_id,
            "adapterGeneration": adapter_generation,
            "turnId": turn_id,
            "userMessageId": user_message_id(&session, &command_id),
            "terminalOutcome": terminal_outcome,
        }))?;
        if !accepted.changed {
            return Err(agent_delivery_outcome_unknown_error(
                "The Agent start receipt no longer matches the active operation.",
            ));
        }
        if terminal_outcome.is_some() {
            revoke_agent_operation_references(&session, &identity, attachments.as_ref()).await;
        } else {
            accept_agent_turn_references(&session, &identity, &turn_id);
        }
        runtime.journal().persist_soon(&session);
        Ok(json!({ "sessionId": session.id(), "commandId": command_id, "queued": false, "turnId": turn_id }))
    }
    .await;
    let settled = match result {
        Ok(receipt) => Ok(receipt),
        Err(error) => {
            let confirmed = session.actor.read(|actor| {
                actor.control()["commands"].as_array().and_then(|commands| {
                    commands
                        .iter()
                        .find(|c| {
                            c["commandId"] == command_id.as_str()
                                && c["operationId"] == operation_id.as_str()
                                && c["status"] == "accepted"
                        })
                        .and_then(|c| c["targetTurnId"].as_str().map(str::to_string))
                })
            });
            let current_generation =
                session.actor.control()["adapterGeneration"].as_i64() == Some(adapter_generation);
            if let Some(turn_id) =
                confirmed.filter(|_| runtime.is_current(&session) && current_generation)
            {
                // Correlated native execution is stronger evidence than a missing RPC receipt.
                if session
                    .actor
                    .read(|actor| actor.terminal_outcome(&turn_id).is_some())
                {
                    revoke_agent_operation_references(&session, &identity, attachments.as_ref())
                        .await;
                } else {
                    accept_agent_turn_references(&session, &identity, &turn_id);
                }
                runtime.journal().persist_soon(&session);
                Ok(
                    json!({ "sessionId": session.id(), "commandId": command_id, "queued": false, "turnId": turn_id }),
                )
            } else {
                let message = redact_secret_text(&error.message);
                if is_agent_delivery_outcome_unknown(&error) {
                    let user_message = error
                        .client_user_message_id
                        .as_ref()
                        .filter(|id| USER_MESSAGE_ID.is_match(id))
                        .cloned();
                    let _ = session.actor.dispatch(json!({
                        "type": "submission.outcome-unknown",
                        "commandId": command_id,
                        "operationId": operation_id,
                        "adapterGeneration": adapter_generation,
                        "error": message,
                        "userMessageId": user_message,
                    }));
                    Ok(
                        json!({ "sessionId": session.id(), "commandId": command_id, "queued": false, "turnId": null, "outcomeUnknown": true }),
                    )
                } else {
                    abandon_agent_turn_references(&session, &identity);
                    let _ = session.actor.dispatch(json!({
                        "type": "command.rejected", "commandId": command_id, "operationId": operation_id, "error": message,
                    }));
                    release_agent_reference_lease(&session, &request, attachments.as_ref()).await;
                    Err(AgentError::new(message))
                }
            }
        }
    };
    on_settled(&session);
    settled
}
