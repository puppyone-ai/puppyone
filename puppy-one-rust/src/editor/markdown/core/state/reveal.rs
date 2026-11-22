//! Inline reveal range calculation (product `core/state/livePreviewReveal.ts`).
use crate::editor::{
    markdown::core::syntax::Syntax,
    text::{
        change::Assoc,
        state::{Applied, EditorState},
    },
};
use std::ops::Range;

/// Callout title line reveal check; moves to `features/callout/state.rs` in Step M3.
pub(super) fn callout_title_at(
    state: &EditorState,
    syntax: &Syntax,
    focused: bool,
    read_only: bool,
) -> Option<usize> {
    if !focused || read_only {
        return None;
    }
    let line = state.doc.line_index(state.selection.head);
    syntax
        .callout_at(line)
        .is_some_and(|c| c.first_line == line)
        .then_some(line)
}

pub(super) fn reveal_at(
    state: &EditorState,
    syntax: &Syntax,
    read_only: bool,
) -> Option<Range<usize>> {
    let s = state.selection;
    if read_only || !s.is_empty() {
        return None;
    }
    syntax.reveal_element(s.head).map(|e| e.range.clone())
}

pub(super) fn after_applied(
    prev_reveal: Option<&Range<usize>>,
    applied: &Applied,
    state: &EditorState,
    syntax: &Syntax,
    focused: bool,
    read_only: bool,
) -> Option<Range<usize>> {
    let mapped = prev_reveal.map(|r| {
        applied.changes.map(r.start, Assoc::Before)..applied.changes.map(r.end, Assoc::After)
    });
    if !focused {
        mapped.filter(|r| {
            syntax
                .reveal_element(r.start + 1)
                .is_some_and(|e| e.range == *r)
        })
    } else {
        reveal_at(state, syntax, read_only)
    }
}
