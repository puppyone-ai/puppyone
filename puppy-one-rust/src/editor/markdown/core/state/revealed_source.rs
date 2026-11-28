//! Explicit block revealed-source range state
//! (product `core/state/revealedSource.ts`).
use crate::editor::text::{
    change::Assoc,
    state::{Applied, EditorState, UserEvent},
};
use std::ops::Range;

pub(super) fn settle(
    revealed: Option<Range<usize>>,
    state: &EditorState,
    keep: bool,
) -> Option<Range<usize>> {
    let s = state.selection;
    revealed.filter(|r| keep || (r.start <= s.from() && s.to() <= r.end))
}

/// Whether `line` shows as source because its block was revealed.
pub(super) fn revealed_line(revealed: &Option<Range<usize>>, line: &Range<usize>) -> bool {
    revealed
        .as_ref()
        .is_some_and(|r| line.start <= r.end && line.end >= r.start)
}

pub(super) fn after_applied(
    revealed: Option<Range<usize>>,
    applied: &Applied,
    state: &EditorState,
) -> Option<Range<usize>> {
    if applied.event == UserEvent::External {
        return None;
    }
    let mapped = revealed.map(|r| {
        applied.changes.map(r.start, Assoc::Before)..applied.changes.map(r.end, Assoc::After)
    });
    settle(mapped, state, false)
}
