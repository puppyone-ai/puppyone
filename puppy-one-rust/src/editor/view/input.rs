//! Platform text input (IME) for the editor: GPUI speaks UTF-16 ranges; the
//! document uses UTF-8 byte offsets. Composition text is a real, provisional
//! document edit (like the browser), committed or replaced by the platform.
use super::editor::EditorView;
use crate::editor::text::{change::ChangeSet, selection::Selection, state::{Transaction, UserEvent}};
use gpui::*;
use std::ops::Range;

pub(super) fn to_utf16(text: &str, offset: usize) -> usize {
    text[..offset.min(text.len())].encode_utf16().count()
}

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
        from_utf16(t, range.start)..from_utf16(t, range.end)
    }
    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        let t = self.state.doc.as_str();
        to_utf16(t, range.start)..to_utf16(t, range.end)
    }
    fn replace(&mut self, range: Option<Range<usize>>, text: &str, mark: Option<Range<usize>>, selected: Option<Range<usize>>, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        let range = range
            .map(|r| self.range_from_utf16(&r))
            .or_else(|| self.marked.clone())
            .unwrap_or_else(|| self.state.selection.as_range());
        let caret = match &selected {
            Some(sel) => range.start + from_utf16(text, sel.end),
            None => range.start + text.len(),
        };
        let anchor = selected.as_ref().map_or(caret, |sel| range.start + from_utf16(text, sel.start));
        self.marked = mark.map(|m| range.start + from_utf16(text, m.start)..range.start + from_utf16(text, m.end));
        if self.marked.as_ref().is_some_and(|m| m.is_empty()) {
            self.marked = None;
        }
        let event = UserEvent::Input;
        let tr = Transaction::edit(ChangeSet::replace(range, text), Some(Selection::range(anchor, caret)), event);
        let marked = self.marked.clone();
        self.dispatch(tr, cx);
        // dispatch maps nothing for marked; restore the composition range.
        self.marked = marked;
    }
}

impl EntityInputHandler for EditorView {
    fn text_for_range(&mut self, range: Range<usize>, actual: &mut Option<Range<usize>>, _: &mut Window, _: &mut Context<Self>) -> Option<String> {
        let r = self.range_from_utf16(&range);
        *actual = Some(self.range_to_utf16(&r));
        Some(self.state.doc.slice(r).to_owned())
    }
    fn selected_text_range(&mut self, _ignore_disabled: bool, _: &mut Window, _: &mut Context<Self>) -> Option<UTF16Selection> {
        let s = self.state.selection;
        Some(UTF16Selection { range: self.range_to_utf16(&s.as_range()), reversed: s.head < s.anchor })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked.as_ref().map(|m| self.range_to_utf16(m))
    }
    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.marked = None;
        cx.notify();
    }
    fn replace_text_in_range(&mut self, range: Option<Range<usize>>, text: &str, _: &mut Window, cx: &mut Context<Self>) {
        self.replace(range, text, None, None, cx);
    }
    fn replace_and_mark_text_in_range(&mut self, range: Option<Range<usize>>, text: &str, marked: Option<Range<usize>>, cx_window: &mut Window, cx: &mut Context<Self>) {
        let _ = cx_window;
        let mark = Some(marked.clone().unwrap_or(0..text.encode_utf16().count()));
        self.replace(range, text, mark, marked, cx);
    }
    fn bounds_for_range(&mut self, range: Range<usize>, _: Bounds<Pixels>, _: &mut Window, _: &mut Context<Self>) -> Option<Bounds<Pixels>> {
        let layout = self.layout.as_ref()?;
        let r = self.range_from_utf16(&range);
        let caret = layout.caret(r.start, false);
        // Shift from the layout frame's scroll to the current one.
        let dy = layout.scroll - px(self.scroll_y);
        Some(Bounds::new(point(caret.x, caret.row_top + dy), size(px(1.), caret.row_height)))
    }
    fn character_index_for_point(&mut self, p: Point<Pixels>, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        let layout = self.layout.as_ref()?;
        let (offset, _) = layout.offset_at(layout.to_layout(p, self.scroll_y));
        Some(to_utf16(self.state.doc.as_str(), offset))
    }
}
