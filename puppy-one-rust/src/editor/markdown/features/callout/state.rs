//! Per-pane callout fold state and title-line reveal helper (`TA-40`,
//! moved from `core/state` in Step M3).
use super::model::Callout;
use crate::editor::{
    markdown::core::state::{FeatureStateStore, FeatureStateValue, PreviewState},
    text::{anchor::Anchor, buffer::Buffer, change::ChangeSet},
};

/// Compatibility alias for callout fold tests using `FeatureStateStore`.
pub type CalloutFolds = FeatureStateStore;

/// Per-feature callout fold state (`TA-40`), tracked via [`Anchor::after`] so
/// edits at or above a callout (including undo/redo) preserve its fold toggle.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct CalloutFoldState(Vec<(Anchor, bool)>);

impl FeatureStateValue for CalloutFoldState {
    fn map_changes(&mut self, changes: &ChangeSet, _doc: &Buffer, new_revision: u64) {
        for (anchor, _) in &mut self.0 {
            anchor.map(changes, new_revision);
        }
    }
}

impl CalloutFoldState {
    pub fn get(&self, at: usize) -> Option<bool> {
        self.0.iter().find(|(a, _)| a.offset == at).map(|(_, f)| *f)
    }

    pub fn folded(&self, callout: &Callout) -> bool {
        callout.fold.is_some()
            && self
                .0
                .iter()
                .find(|(a, _)| a.offset == callout.marker.start)
                .map_or(callout.fold == Some(true), |(_, folded)| *folded)
    }

    pub fn set(&mut self, at: usize, folded: bool, revision: u64) {
        self.0.retain(|(a, _)| a.offset != at);
        self.0.push((Anchor::after(at, revision), folded));
    }
}

pub fn is_folded(callout: &Callout, state: Option<&CalloutFoldState>) -> bool {
    match state {
        Some(s) => s.folded(callout),
        None => callout.fold == Some(true),
    }
}

/// Whether `line` (a callout's title line) should show its raw `[!type]` marker.
pub fn is_title_revealed(preview: &PreviewState, line: usize) -> bool {
    preview.reveal_line == Some(line)
}
