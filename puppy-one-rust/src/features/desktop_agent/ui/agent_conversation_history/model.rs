//! What the History lists: the sources' conversations less the open ones,
//! with each runtime's label and mark and whether discovery is complete.
use super::*;

/// `useAgentConversationHistory(...)`: the controller's state with the
/// sessions already open in a tab left out.
pub(super) struct History {
    pub(super) state: ConversationHistoryState,
    pub(super) sessions: Vec<SessionMetadata>,
    pub(super) excluded_count: usize,
    pub(super) has_more: bool,
}

impl History {
    pub(super) fn new(state: ConversationHistoryState, excluded: &[String]) -> Self {
        let sessions: Vec<SessionMetadata> = state
            .sessions
            .iter()
            .filter(|s| !excluded.contains(&s.id))
            .cloned()
            .collect();
        Self {
            excluded_count: state.sessions.len() - sessions.len(),
            has_more: state.catalog_next_cursor.is_some() || !state.next_cursors.is_empty(),
            sessions,
            state,
        }
    }

    pub(super) fn runtime_label(&self, session: &SessionMetadata) -> String {
        let id = runtime_id(session);
        session
            .runtime
            .as_ref()
            .map(|r| r.display_name.clone())
            .filter(|l| !l.is_empty())
            .or_else(|| self.runtime_name(&id))
            .unwrap_or(id)
    }

    pub(super) fn runtime_name(&self, id: &str) -> Option<String> {
        self.state
            .runtimes
            .iter()
            .find(|entry| entry.descriptor.id == id)
            .map(|entry| entry.descriptor.display_name.clone())
    }

    pub(super) fn icon_key(&self, session: &SessionMetadata) -> String {
        let id = runtime_id(session);
        session
            .runtime
            .as_ref()
            .and_then(|r| r.icon_key.clone())
            .filter(|k| !k.is_empty())
            .or_else(|| {
                self.state
                    .runtimes
                    .iter()
                    .find(|entry| entry.descriptor.id == id)
                    .and_then(|entry| entry.descriptor.icon_key.clone())
            })
            .unwrap_or(id)
    }

    pub(super) fn source_failed(&self) -> bool {
        self.state
            .sources
            .iter()
            .any(|(_, source)| source.status == "failed")
    }

    /// Every source listed to its end: an empty projection is not proof of
    /// an empty native history.
    pub(super) fn complete(&self) -> bool {
        let truncated = self
            .state
            .catalog_coverage
            .as_ref()
            .is_some_and(|c| c.truncated);
        !self.state.sources.is_empty()
            && !truncated
            && !self.has_more
            && self
                .state
                .sources
                .iter()
                .all(|(_, s)| s.status == "complete" && complete_coverage(s))
            && self.state.runtimes.iter().all(|runtime| {
                self.state
                    .source(&runtime.descriptor.id)
                    .is_some_and(complete_coverage)
            })
    }

    /// `sourceNotes`.
    pub(super) fn source_notes(&self) -> Vec<(String, &'static str)> {
        self.state
            .sources
            .iter()
            .filter_map(|(id, source)| {
                let message = match source.status.as_str() {
                    "unsupported" => Some("agent.history.sourceUnsupported"),
                    "partial" => Some("agent.history.sourcePartial"),
                    "failed" => None,
                    _ if !complete_coverage(source) => Some("agent.history.sourceUnverified"),
                    _ => None,
                }?;
                Some((id.clone(), message))
            })
            .collect()
    }

    pub(super) fn label_for(&self, runtime_id: &str) -> String {
        self.runtime_name(runtime_id)
            .unwrap_or_else(|| runtime_id.to_string())
    }
}

pub(super) fn runtime_id(session: &SessionMetadata) -> String {
    session
        .runtime_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .or_else(|| session.runtime.as_ref().map(|r| r.id.as_str()))
        .unwrap_or_default()
        .to_string()
}

pub(super) fn complete_coverage(source: &SessionDiscovery) -> bool {
    source.coverage.as_deref() == Some("complete")
}
