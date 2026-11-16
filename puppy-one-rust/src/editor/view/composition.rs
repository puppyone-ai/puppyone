//! IME composition (marked text) for every native document editor: the
//! lifecycle the platform input method drives through `input.rs`, and the
//! rules the rest of the view follows while a composition is open.
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
        self.ime.composition.is_some()
    }

    /// Source range of the marked text.
    pub fn composition_range(&self) -> Option<Range<usize>> {
        self.ime.composition.as_ref().map(|c| c.range.clone())
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
        let open = self.ime.composition.is_some();
        if !open && text.is_empty() && (compose || range.is_empty()) {
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
        self.ime.updating = true;
        self.dispatch(
            Transaction::edit(
                ChangeSet::replace(range.clone(), text),
                Some(selection),
                event,
            ),
            cx,
        );
        self.ime.updating = false;
        if compose && !text.is_empty() {
            let anchor = self.ime.composition.as_ref().and_then(|c| c.anchor);
            self.ime.composition = Some(Composition {
                range: range.start..range.start + text.len(),
                anchor,
            });
        } else if event == UserEvent::Compose {
            self.ime.composition = None;
            self.end_composition(cx);
        }
    }

    /// The input method's `unmarkText`: keep the marked text as typed.
    pub(super) fn unmark(&mut self, cx: &mut Context<Self>) {
        if self.ime.composition.take().is_some() {
            self.end_composition(cx);
            cx.notify();
        }
    }

    /// The view ends the composition itself (click, command, selection
    /// change, focus loss, read-only): the marked text stays as typed and the
    /// input method is told to drop its composition (`TA-16`).
    pub fn commit_composition(&mut self, cx: &mut Context<Self>) {
        if self.ime.composition.take().is_none() {
            return;
        }
        self.end_composition(cx);
        self.discard_platform_composition(cx);
        cx.notify();
    }

    /// The document is being replaced externally (`TA-71`, `DP-03`): drop the
    /// uncommitted marked text by restoring the pre-composition `(doc,
    /// selection)` snapshot so external undo recovers the committed state
    /// rather than uncommitted preedit letters.
    pub fn abandon_composition(&mut self, cx: &mut Context<Self>) {
        if self.ime.composition.take().is_none() {
            return;
        }
        if let Some((doc, selection)) = self.history.take_abandoned_composition() {
            self.state.doc = doc;
            self.state.selection = selection;
            self.caches.reveal_deco_key = None;
        }
        self.discard_platform_composition(cx);
    }

    fn end_composition(&mut self, cx: &mut Context<Self>) {
        let changed = self.history.end_composition(&self.state, Instant::now());
        self.blink.epoch = Instant::now();
        cx.emit(if changed {
            EditorEvent::Changed(UserEvent::Input)
        } else {
            EditorEvent::CompositionEnded
        });
    }

    fn discard_platform_composition(&mut self, cx: &mut Context<Self>) {
        self.ime.discard_requests += 1;
        cx.spawn(async move |_, _| crate::ui::ime::discard_marked_text())
            .detach();
    }
}
