//! Inline reveal range calculation (product `core/state/livePreviewReveal.ts`).
use crate::editor::{
    markdown::core::syntax::{Kind, Syntax},
    text::{
        change::Assoc,
        state::{Applied, EditorState},
    },
};
use std::ops::Range;

/// Feature-agnostic block-header reveal line: when a focused, editable caret
/// sits on the opening line of a top-level blockquote, record that line so
/// features decorating quote headers (e.g. callouts) can reveal raw syntax
/// without leaking feature types into `core/state`.
pub(super) fn reveal_line_at(
    state: &EditorState,
    syntax: &Syntax,
    focused: bool,
    read_only: bool,
) -> Option<usize> {
    if !focused || read_only {
        return None;
    }
    let line = state.doc.line_index(state.selection.head);
    let line_range = state.doc.line_range(line);
    let outer_quote = syntax
        .elements_in(line_range.clone())
        .filter(|e| e.kind == Kind::Blockquote)
        .min_by_key(|e| (e.range.start, std::cmp::Reverse(e.range.end)))?;
    let first = outer_quote
        .line
        .as_ref()
        .map(|l| state.doc.line_index(l.start))?;
    (first == line).then_some(line)
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
