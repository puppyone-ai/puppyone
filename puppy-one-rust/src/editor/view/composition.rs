//! IME composition (marked text) for every native document editor: the
//! lifecycle the platform input method drives through `input.rs`, and the
//! rules the rest of the view follows while a composition is open.
//!
//! Like the browser, the composition is a real, provisional edit of the
//! document (`UserEvent::Compose`), so text, layout, caret and the candidate
//! window position stay one model. The rules:
//!
//! - The whole marked text is the composition; the platform's selected range
//!   is only the caret (or the clause being converted) inside it.
//! - Provisional text is not history and not a document change for the
//!   outside: history folds the composition into one step when it ends, and
//!   `EditorEvent::Changed` is emitted once then (`CompositionEnded` when it
//!   was cancelled, so hosts waiting for it can proceed).
//! - Formats do not rewrite around it: no selection normalisation, no
//!   format commands while it is open.
//! - Anything that is not the input method (a click, a command, a selection
//!   change, focus moving away, read-only) first commits the marked text as
//!   typed and tells the input method to discard its composition; replacing
//!   the document from storage abandons it.
//! - The marked text is underlined across every row it wraps to (the clause
//!   being converted thicker, instead of a selection highlight), and the
//!   candidate window follows the text when layout or scroll moves it.
use super::editor::{EditorEvent, EditorView};
use crate::editor::text::{
    change::ChangeSet,
    selection::Selection,
    state::{Transaction, UserEvent},
};
use gpui::{Bounds, Context, Pixels};
use std::{ops::Range, time::Instant};

/// The open composition.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Composition {
    /// Source range of the marked text.
    pub range: Range<usize>,
    /// The first row of the marked text as last reported to the platform
    /// (candidate window anchor), to re-anchor it when the text moves.
    pub anchor: Option<Bounds<Pixels>>,
}

impl EditorView {
    /// An IME composition is open (its text is provisional).
    pub fn composing(&self) -> bool {
        self.composition.is_some()
    }

    /// Source range of the marked text.
    pub fn composition_range(&self) -> Option<Range<usize>> {
        self.composition.as_ref().map(|c| c.range.clone())
    }

    /// The clause the input method is converting (a non-empty selection
    /// inside the marked text, e.g. Japanese conversion), shown with a thick
    /// underline instead of a selection highlight.
    pub(super) fn composition_clause(&self) -> Option<Range<usize>> {
        let range = self.composition_range()?;
        let s = self.state.selection.as_range();
        (!s.is_empty() && range.start <= s.start && s.end <= range.end).then_some(s)
    }

    /// Apply an edit from the input method: replace `range` with `text`, put
    /// the selection at `selected` (byte range relative to `text`), and keep
    /// `text` marked (`compose`) or commit it.
    pub(super) fn apply_input(
        &mut self,
        range: Range<usize>,
        text: &str,
        selected: Range<usize>,
        compose: bool,
        cx: &mut Context<Self>,
    ) {
        if self.read_only {
            return;
        }
        let open = self.composition.is_some();
        if !open && text.is_empty() && (compose || range.is_empty()) {
            // Nothing to insert and nothing to cancel (e.g. the input method
            // echoing a discard).
            return;
        }
        if compose && !open {
            self.history.begin_composition(&self.state);
        }
        let event = if self.history.composing() {
            UserEvent::Compose
        } else {
            UserEvent::Input
        };
        let selection = Selection::range(range.start + selected.start, range.start + selected.end);
        self.ime_update = true;
        self.dispatch(
            Transaction::edit(
                ChangeSet::replace(range.clone(), text),
                Some(selection),
                event,
            ),
            cx,
        );
        self.ime_update = false;
        if compose && !text.is_empty() {
            let anchor = self.composition.as_ref().and_then(|c| c.anchor);
            self.composition = Some(Composition {
                range: range.start..range.start + text.len(),
                anchor,
            });
        } else if event == UserEvent::Compose {
            // Committed (`insertText`) or cancelled (empty marked text).
            self.composition = None;
            self.end_composition(cx);
        }
    }

    /// The input method's `unmarkText`: keep the marked text as typed.
    pub(super) fn unmark(&mut self, cx: &mut Context<Self>) {
        if self.composition.take().is_some() {
            self.end_composition(cx);
            cx.notify();
        }
    }

    /// The view ends the composition itself (click, command, selection
    /// change, focus loss, read-only): the marked text stays as typed and the
    /// input method is told to drop its composition.
    pub fn commit_composition(&mut self, cx: &mut Context<Self>) {
        if self.composition.take().is_none() {
            return;
        }
        self.end_composition(cx);
        self.discard_platform_composition(cx);
        cx.notify();
    }

    /// The document is being replaced from storage (or the editor dropped
    /// with it): the composition goes with it, without a history step.
    pub fn abandon_composition(&mut self, cx: &mut Context<Self>) {
        if self.composition.take().is_none() {
            return;
        }
        self.history.abandon_composition();
        self.discard_platform_composition(cx);
    }

    fn end_composition(&mut self, cx: &mut Context<Self>) {
        let changed = self.history.end_composition(&self.state, Instant::now());
        self.blink_epoch = Instant::now();
        cx.emit(if changed {
            EditorEvent::Changed(UserEvent::Input)
        } else {
            EditorEvent::CompositionEnded
        });
    }

    fn discard_platform_composition(&mut self, cx: &mut Context<Self>) {
        self.discard_requests += 1;
        // Outside the current update: the input method may call back into
        // the view while it discards.
        cx.spawn(async move |_, _| crate::ui::ime::discard_marked_text())
            .detach();
    }
}
