//! Per-pane HTML block view state (`TA-40`): deferred blocks the person asked
//! to render, tracked by [`Anchor::after`] so edits above keep it.
use crate::editor::{
    markdown::core::state::FeatureStateValue,
    text::{anchor::Anchor, buffer::Buffer, change::ChangeSet},
};

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct HtmlState(Vec<Anchor>);

impl FeatureStateValue for HtmlState {
    fn map_changes(&mut self, changes: &ChangeSet, _doc: &Buffer, new_revision: u64) {
        for anchor in &mut self.0 {
            anchor.map(changes, new_revision);
        }
    }
}

impl HtmlState {
    /// Whether the deferred block at `at` was asked to render.
    pub fn activated(&self, at: usize) -> bool {
        self.0.iter().any(|a| a.offset == at)
    }

    pub fn activate(&mut self, at: usize, revision: u64) {
        if !self.activated(at) {
            self.0.push(Anchor::after(at, revision));
        }
    }
}
