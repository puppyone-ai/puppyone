//! `application/agent-event-journal.mjs`: commits canonical facts and
//! schedules process-local recovery snapshots.
use super::ports::{Logger, SessionCache};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use crate::agent::domain::agent_event_workspace_paths::normalize_agent_event_workspace_paths;
use crate::agent::domain::agent_session_actor::EventInput;
use crate::agent::domain::agent_session_model::{SessionRef, terminal_state_from_control};
use crate::agent::event_loop::{set_timeout, spawn};
use serde_json::{Value, json};
use std::rc::Rc;

pub const PERSIST_DEBOUNCE_MS: u64 = 750;

/// `createAgentEventJournal({ sessionCache, logger })`.
#[derive(Clone)]
pub struct AgentEventJournal {
    cache: Rc<dyn SessionCache>,
    logger: Rc<dyn Logger>,
}

impl AgentEventJournal {
    pub fn new(cache: Rc<dyn SessionCache>, logger: Rc<dyn Logger>) -> Self {
        Self { cache, logger }
    }

    /// `journal.emit(session, adapterEvent)`: the committed envelope.
    pub fn emit(&self, session: &SessionRef, adapter_event: Value) -> Option<Value> {
        let workspace_root = session.workspace_root();
        let normalized = normalize_agent_event_workspace_paths(&adapter_event, &workspace_root);
        let provider_session_id = normalized
            .get("providerSessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| session.provider_session_id());
        let committed = session.actor.append_event(EventInput {
            session_id: session.id(),
            runtime_id: session.runtime_id(),
            provider_session_id,
            event: normalized,
        });
        let envelope = match committed {
            Ok(envelope) => Some(envelope),
            Err(error) => {
                // A bad display item must not terminate the native stream consumer. Keep
                // the failure visible and let later, valid native objects continue.
                let event_type = js::head16(adapter_event.event_type(), 80).to_string();
                let event_type = if adapter_event.get("type").is_some_and(Value::is_string) {
                    event_type
                } else {
                    "unknown".into()
                };
                self.logger.warn(
                    "Agent display translation rejected an item",
                    json!({ "type": event_type, "stage": "main-commit" }),
                );
                let diagnostic = js::head16(&redact_secret_text(&error.0), 1_000).to_string();
                let envelope = session
                    .actor
                    .append_event(EventInput {
                        session_id: session.id(),
                        runtime_id: session.runtime_id(),
                        provider_session_id: session.provider_session_id(),
                        event: json!({
                            "type": "provider.error",
                            "turnId": session.active_turn_id(),
                            "itemId": null,
                            "payload": {
                                "code": "AGENT_DISPLAY_ITEM_INVALID", "stage": "main-commit", "recoverable": true,
                                "message": "An Agent content item could not be displayed.", "diagnostic": diagnostic,
                            },
                        }),
                    })
                    .ok();
                if matches!(
                    event_type.as_str(),
                    "turn.completed" | "turn.failed" | "turn.interrupted"
                ) {
                    let terminal = session.actor.append_event(EventInput {
                        session_id: session.id(),
                        runtime_id: session.runtime_id(),
                        provider_session_id: session.provider_session_id(),
                        event: json!({
                            "type": event_type,
                            "turnId": adapter_event.get("turnId").cloned().unwrap_or(Value::Null),
                            "payload": { "status": &event_type[5..] },
                        }),
                    });
                    if terminal.is_err() {
                        let _ = session.actor.dispatch(json!({
                            "type": "recovery.unconfirmed", "reason": "invalid-native-terminal-identity",
                        }));
                    }
                } else if event_type == "approval.requested" || event_type == "question.requested" {
                    let _ = session.actor.dispatch(json!({
                        "type": "recovery.unconfirmed", "reason": "invalid-native-request-identity",
                    }));
                }
                envelope
            }
        };
        if let Some(emitted_at) = envelope.as_ref().and_then(|e| e["emittedAt"].as_str()) {
            session.state_mut().updated_at = emitted_at.to_string();
        }
        self.persist_soon(session);
        envelope
    }

    /// `journal.persistSoon(session)`.
    pub fn persist_soon(&self, session: &SessionRef) {
        if session.closing() || session.state().persist_timer.is_some() {
            return;
        }
        let journal = self.clone();
        let target = session.clone();
        let timer = set_timeout(PERSIST_DEBOUNCE_MS, move || {
            target.state_mut().persist_timer = None;
            let journal = journal.clone();
            spawn(async move { journal.persist_now(&target).await });
        });
        session.state_mut().persist_timer = Some(timer);
    }

    /// `journal.persistNow(session)`.
    pub async fn persist_now(&self, session: &SessionRef) {
        let Some(provider_session_id) = session.provider_session_id() else {
            return;
        };
        let record = {
            let state = session.state();
            Obj::new()
                .set("sessionId", state.id.as_str())
                .set("workspaceRoot", state.workspace_root.as_str())
                .set("runtimeId", state.runtime_id.as_str())
                .set("runtime", state.runtime.clone())
                .set("providerSessionId", provider_session_id)
                .set(
                    "sourceScopeId",
                    state
                        .source_scope_id
                        .clone()
                        .unwrap_or_else(|| "default".into()),
                )
                .set("title", state.title.as_str())
                .set("createdAt", state.created_at.as_str())
                .set("updatedAt", state.updated_at.as_str())
                .set(
                    "terminalState",
                    terminal_state_from_control(&session.actor.control()),
                )
                .set("selectedModel", state.selected_model.clone())
                .set("selectedEffort", state.selected_effort.clone())
                .set("selectedMode", state.selected_mode.clone())
                .set(
                    "capabilityRevision",
                    state
                        .capabilities
                        .as_ref()
                        .and_then(|c| c.get("revision"))
                        .cloned()
                        .unwrap_or(Value::Null),
                )
                .set("lastSequence", session.sequence())
                .set("events", session.events())
                .build()
        };
        // Only adapter/native-store evidence can make a locator reopenable.
        let promote = session.state().native_persistence_confirmed;
        if let Err(error) = self.cache.save(record, promote).await {
            self.logger.warn(
                &format!(
                    "Unable to update the Agent conversation metadata catalog: {}",
                    redact_secret_text(&error.message)
                ),
                Value::Null,
            );
        }
    }
}
