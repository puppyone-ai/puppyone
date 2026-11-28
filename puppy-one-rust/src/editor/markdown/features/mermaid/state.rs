//! Per-pane Mermaid diagram view state (`TA-40`, moved from `core/state` in Step M3).
use crate::editor::{
    markdown::core::state::FeatureStateValue,
    text::{anchor::Anchor, buffer::Buffer, change::ChangeSet},
};

/// Plain view-state value of a rendered diagram (`mermaid/widget.rs` reads it).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct DiagramView {
    /// The zoom chosen here, in percent; `None` keeps the fitted default.
    pub zoom: Option<u16>,
    /// A deferred diagram the person asked to render.
    pub activated: bool,
}

/// Per-feature diagram view state (`TA-40`), tracked by [`Anchor::after`] so
/// edits above a diagram preserve its zoom and deferred activation.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct MermaidState(Vec<(Anchor, DiagramView)>);

impl FeatureStateValue for MermaidState {
    fn map_changes(&mut self, changes: &ChangeSet, _doc: &Buffer, new_revision: u64) {
        for (anchor, _) in &mut self.0 {
            anchor.map(changes, new_revision);
        }
    }
}

impl MermaidState {
    pub fn get(&self, at: usize) -> DiagramView {
        self.0
            .iter()
            .find(|(a, _)| a.offset == at)
            .map(|(_, v)| *v)
            .unwrap_or_default()
    }

    pub fn update(&mut self, at: usize, revision: u64, change: impl FnOnce(&mut DiagramView)) {
        let mut view = self.get(at);
        change(&mut view);
        self.0.retain(|(a, _)| a.offset != at);
        self.0.push((Anchor::after(at, revision), view));
    }
}
