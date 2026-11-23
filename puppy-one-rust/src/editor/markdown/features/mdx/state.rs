//! MDX component pane-local tab state and widget actions (`TA-40`, `MA-04`: zero `gpui`).
use crate::editor::{
    markdown::core::state::FeatureStateValue,
    text::{anchor::Anchor, buffer::Buffer, change::ChangeSet},
};
use std::ops::Range;

/// The widget's commands: a tab shows; the toolbar reveals the source.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub enum Action {
    Select { at: usize, tab: usize },
    ShowSource(Range<usize>),
}

/// Per-feature MDX active-tab state (`TA-40`), tracked via [`Anchor::after`]
/// so editing above `<Tabs>` (and undoing/redoing via `TA-06`) preserves the
/// selected tab instead of resetting to tab 0.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct TabsState(Vec<(Anchor, usize)>);

impl FeatureStateValue for TabsState {
    fn map_changes(&mut self, changes: &ChangeSet, _doc: &Buffer, new_revision: u64) {
        for (anchor, _) in &mut self.0 {
            anchor.map(changes, new_revision);
        }
    }
}

impl TabsState {
    pub fn get(&self, at: usize) -> usize {
        self.0
            .iter()
            .find(|(a, _)| a.offset == at)
            .map(|(_, tab)| *tab)
            .unwrap_or(0)
    }

    pub fn set(&mut self, at: usize, tab: usize, revision: u64) {
        self.0.retain(|(a, _)| a.offset != at);
        self.0.push((Anchor::after(at, revision), tab));
    }
}
