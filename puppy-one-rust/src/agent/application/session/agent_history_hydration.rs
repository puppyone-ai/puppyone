//! `application/session/agent-history-hydration.mjs`: opening a
//! conversation uses its existing Actor and its own adapter connection.
use super::super::agent_event_journal::AgentEventJournal;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::domain::agent_session_model::SessionRef;
use crate::agent::runtime::agent_history_read_result::assert_agent_history_read_result;
use crate::agent::runtime::agent_runtime_port::is_agent_provider_session_unavailable_error;
use crate::agent::runtime::agent_session_history_port::resolve_agent_session_history_port;
use crate::agent::tasks::Canceller;
use serde_json::{Value, json};
use std::time::Duration;

/// `hydrateAgentSession(session, emit, { timeoutMs })`.
pub async fn hydrate_agent_session(
    session: &SessionRef,
    journal: &AgentEventJournal,
    timeout_ms: Option<u64>,
) -> AgentResult<()> {
    let timeout_ms = timeout_ms.unwrap_or(30_000);
    let result = async {
        let adapter = session.adapter().ok_or_else(|| AgentError::new("The Agent session closed while opening history."))?;
        let history = resolve_agent_session_history_port(adapter.as_ref())?;
        let read = match history.filter(|h| h.implements("hydrate")) {
            Some(history) => {
                let controller = Canceller::new();
                let hydrated = tokio::select! {
                    result = history.hydrate(controller.signal()) => result?,
                    _ = tokio::time::sleep(Duration::from_millis(timeout_ms)) => {
                        let error = AgentError::new("Opening native history timed out.");
                        controller.cancel(error.clone());
                        return Err(error);
                    }
                };
                assert_agent_history_read_result(&hydrated, session.provider_session_id().as_deref())?
            }
            None => json!({ "events": [], "coverage": "unknown", "reason": "unsupported" }),
        };
        if session.closing() || session.adapter().is_none() {
            return Err(AgentError::new("The Agent session closed while opening history."));
        }
        for event in read["events"].as_array().cloned().unwrap_or_default() {
            journal.emit(session, event);
        }
        session.state_mut().history_coverage = read["coverage"].as_str().map(str::to_string);
        session.actor.dispatch(json!({ "type": "history.loaded", "coverage": read["coverage"], "reason": read["reason"] }))?;
        Ok::<(), AgentError>(())
    }
    .await;
    result.map_err(|error| {
        if is_agent_provider_session_unavailable_error(&error) {
            return error;
        }
        let mut wrapped = error.clone();
        wrapped.code = Some(
            error
                .code
                .clone()
                .unwrap_or_else(|| "HISTORY_READ_FAILED".into()),
        );
        wrapped.stage = Some("history-read".into());
        wrapped.retryable = Some(true);
        wrapped.name = None;
        wrapped.extra = Some(Value::from(error.message.clone()));
        wrapped
    })
}
