//! Platform text input (`NSTextInputClient` through GPUI's
//! `EntityInputHandler`): GPUI speaks UTF-16 ranges, the document uses UTF-8
//! byte offsets. The composition lifecycle and its rules live in
//! `composition.rs`; this file only translates the protocol.
//!
//! - `replace_and_mark_text_in_range` (`setMarkedText:selectedRange:
//!   replacementRange:`): the new text becomes the composition; the selected
//!   range is relative to it (the caret, or the clause being converted).
//! - `replace_text_in_range` (`insertText:replacementRange:`): commits an
//!   open composition, or inserts typed text; an explicit replacement range
//!   (press-and-hold accents, reconversion, Vietnamese / Telex rewrites)
//!   wins over both.
//! - `unmark_text`: the marked text stays as typed.
//! - Function-key text some input methods insert for arrows and the like
//!   is not text: dropped, the key replayed (`ui::ime`).
use super::editor::EditorView;
use crate::{editor::text::selection::Selection, ui::ime};
use gpui::*;
use std::ops::Range;

pub(super) fn to_utf16(text: &str, offset: usize) -> usize {
    text[..offset.min(text.len())].encode_utf16().count()
}

/// The byte offset of a UTF-16 offset; an offset inside a surrogate pair
/// resolves to the end of its character.
pub(super) fn from_utf16(text: &str, offset: usize) -> usize {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units >= offset {
            return byte;
        }
        units += ch.len_utf16();
    }
    text.len()
}

impl EditorView {
    fn range_from_utf16(&self, range: &Range<usize>) -> Range<usize> {
        let t = self.state.doc.as_str();
        let (a, b) = (from_utf16(t, range.start), from_utf16(t, range.end));
        a.min(b)..a.max(b)
    }
    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        let t = self.state.doc.as_str();
        to_utf16(t, range.start)..to_utf16(t, range.end)
    }
    /// The source range an input-method edit replaces: its explicit
    /// replacement range, else the marked text, else the selection.
    fn input_target(&self, range: Option<Range<usize>>) -> Range<usize> {
        range
            .map(|r| self.range_from_utf16(&r))
            .or_else(|| self.composition_range())
            .unwrap_or_else(|| self.state.selection.as_range())
    }
}

impl EntityInputHandler for EditorView {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let r = self.range_from_utf16(&range);
        *actual = Some(self.range_to_utf16(&r));
        Some(self.state.doc.slice(r).to_owned())
    }

    fn selected_text_range(
        &mut self,
        ignore_disabled_input: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        // A read-only editor offers no text input (the input method stays off).
        if self.read_only && !ignore_disabled_input {
            return None;
        }
        let s = self.state.selection;
        Some(UTF16Selection {
            range: self.range_to_utf16(&s.as_range()),
            reversed: s.head < s.anchor,
        })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.composition_range().map(|m| self.range_to_utf16(&m))
    }

    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.unmark(cx);
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if ime::intercept_function_key(text, window, cx) {
            return;
        }
        if range.is_none() && text.is_empty() && !self.composing() {
            // An empty insert outside a composition is not an edit (it would
            // delete the selection).
            return;
        }
        let target = self.input_target(range);
        self.apply_input(target, text, text.len()..text.len(), false, cx);
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selected: Option<Range<usize>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if ime::intercept_function_key(text, window, cx) {
            return;
        }
        let target = self.input_target(range);
        let units = text.encode_utf16().count();
        let selected = selected.map_or(text.len()..text.len(), |s| {
            let (a, b) = (
                from_utf16(text, s.start.min(units)),
                from_utf16(text, s.end.min(units)),
            );
            a.min(b)..a.max(b)
        });
        self.apply_input(target, text, selected, true, cx);
    }

    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        _: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let layout = self.layout.as_ref()?;
        let r = self.range_from_utf16(&range);
        // The input method asks right after an edit, before the next frame:
        // an older layout is only exact before the edit, so anchor at the
        // start (the composition's first row follows once laid out).
        let rect = if layout.revision == self.state.revision {
            layout.first_row_rect(r)
        } else {
            layout.first_row_rect(r.start..r.start)
        };
        // Shift from the layout frame's scroll to the current one.
        Some(Bounds::new(
            rect.origin + point(px(0.), layout.scroll - px(self.scroll_y)),
            rect.size,
        ))
    }

    fn character_index_for_point(
        &mut self,
        p: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        let layout = self.layout.as_ref()?;
        let (offset, _) = layout.offset_at(layout.to_layout(p, self.scroll_y));
        Some(to_utf16(self.state.doc.as_str(), offset))
    }

    fn set_selected_text_range(
        &mut self,
        range: Range<usize>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.composing() {
            return;
        }
        let r = self.range_from_utf16(&range);
        self.set_selection(Selection::range(r.start, r.end), cx);
    }

    fn accepts_text_input(&self, _: &mut Window, _: &mut Context<Self>) -> bool {
        !self.read_only
    }
}
