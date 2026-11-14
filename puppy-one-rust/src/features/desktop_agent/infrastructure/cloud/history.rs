//! `CloudAgentHistory` as a History browser's source: the hosted target's
//! shared locators, adapted to the browser's state; never transcripts.
use super::{Hub, LABEL};
use crate::agent::contract::dto::{RuntimeDescriptor, SessionDiscovery, SessionMetadata};
use crate::features::desktop_agent::application::conversation_history_controller::ConversationHistoryState;
use crate::features::desktop_agent::application::conversation_history_source::ConversationHistorySource;
use crate::localization::t as tr;
use crate::wake::Wake;
use std::sync::Arc;

/// The hosted target's History.
pub struct HostedHistory(pub Arc<Hub>);

impl ConversationHistorySource for HostedHistory {
    fn snapshot(&self) -> ConversationHistoryState {
        hosted_history(&self.0)
    }
    /// `useEffect(() => void workbench.refreshHistory())`.
    fn activate(&self) {
        self.0.refresh_history();
    }
    fn refresh(&self) {
        self.0.refresh_history();
    }
    fn watch(&self, wake: Wake) -> Box<dyn FnOnce()> {
        let id = self.0.watch_history(wake);
        let hub = self.0.clone();
        Box::new(move || hub.unwatch(id))
    }
}

/// `CloudAgentHistory`: server locators adapted, never transcripts.
fn hosted_history(hub: &Hub) -> ConversationHistoryState {
    let history = hub.history();
    let sessions: Vec<SessionMetadata> = history
        .sessions
        .iter()
        .map(|session| {
            let title = session
                .title
                .clone()
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| tr("agent.header.newChat").to_string());
            SessionMetadata {
                id: session.id.clone(),
                provider: "cloud-pi".into(),
                runtime_id: Some("cloud-pi".into()),
                runtime: Some(RuntimeDescriptor {
                    id: "cloud-pi".into(),
                    display_name: LABEL.into(),
                    icon_key: Some("puppyone-agent".into()),
                    ..RuntimeDescriptor::default()
                }),
                provider_session_id: Some(session.id.clone()),
                title,
                created_at: session.updated_at.clone(),
                updated_at: session.updated_at.clone(),
                terminal_state: Some("idle".into()),
                ..SessionMetadata::default()
            }
        })
        .collect();
    let status = if history.error.is_some() {
        "failed"
    } else if history.loaded {
        "complete"
    } else {
        "not-requested"
    };
    ConversationHistoryState {
        sources: vec![(
            "cloud-pi".into(),
            SessionDiscovery {
                runtime_id: Some("cloud-pi".into()),
                status: status.into(),
                coverage: Some(
                    if history.sessions.len() < 200 {
                        "complete"
                    } else {
                        "unknown"
                    }
                    .into(),
                ),
                indexed: history.sessions.len() as i64,
                ..SessionDiscovery::default()
            },
        )],
        sessions,
        loading: !history.loaded && history.loading,
        loaded: history.loaded || history.error.is_some(),
        refreshing: history.loaded && history.loading,
        error: history.error,
        ..Default::default()
    }
}
