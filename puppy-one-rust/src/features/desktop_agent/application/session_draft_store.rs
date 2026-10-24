//! Conversation-local draft ownership, independent of GPUI and runtime transports.
use crate::agent::domain::reference_input::Reference;
use std::collections::HashMap;
#[derive(Default)]
pub struct Draft {
    pub text: String,
    pub references: Vec<Reference>,
}
#[derive(Default)]
pub struct SessionDraftStore {
    active: Option<String>,
    drafts: HashMap<String, Draft>,
}
impl SessionDraftStore {
    pub fn active(&self) -> &Option<String> {
        &self.active
    }
    /// First admission binds an already typed draft; switching a live conversation
    /// retains its text/references and restores the selected conversation only.
    pub fn switch(&mut self, next: Option<String>, current: Draft) -> Option<Draft> {
        if self.active == next {
            return None;
        }
        let restore = if let Some(previous) = self.active.take() {
            self.drafts.insert(previous, current);
            Some(
                next.as_ref()
                    .and_then(|id| self.drafts.remove(id))
                    .unwrap_or_default(),
            )
        } else {
            None
        };
        self.active = next;
        restore
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drafts_follow_conversations_without_resending_or_crossing_threads() {
        let mut s = SessionDraftStore::default();
        assert!(s.switch(Some("a".into()), Draft::default()).is_none());
        let empty = s
            .switch(
                Some("b".into()),
                Draft {
                    text: "draft a".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(empty.text.is_empty());
        let restored = s
            .switch(
                Some("a".into()),
                Draft {
                    text: "draft b".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(restored.text, "draft a");
    }
}
