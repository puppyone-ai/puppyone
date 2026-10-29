//! Forward platform input to the same Kit state that paints and edits code.
//! The wrapper observes every composition boundary, including unmark/cancel,
//! so retained snapshots never capture preedit or wait forever for Change.
use super::CodeView;
use gpui::*;
use std::ops::Range;

impl EntityInputHandler for CodeView {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<String> {
        self.field
            .update(cx, |s, cx| s.text_for_range(range, actual, w, cx))
    }
    fn selected_text_range(
        &mut self,
        ignore: bool,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        if self.read_only && !ignore {
            return None;
        }
        self.field
            .update(cx, |s, cx| s.selected_text_range(ignore, w, cx))
    }
    fn marked_text_range(&self, w: &mut Window, cx: &mut Context<Self>) -> Option<Range<usize>> {
        self.field.update(cx, |s, cx| s.marked_text_range(w, cx))
    }
    fn unmark_text(&mut self, w: &mut Window, cx: &mut Context<Self>) {
        self.field.update(cx, |s, cx| s.unmark_text(w, cx));
        self.sync(w, cx);
    }
    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only || crate::ui::ime::intercept_function_key(text, w, cx) {
            return;
        }
        if range.is_none() && text.is_empty() && !self.composing {
            return;
        }
        self.field
            .update(cx, |s, cx| s.replace_text_in_range(range, text, w, cx));
        self.sync(w, cx);
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selected: Option<Range<usize>>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only || crate::ui::ime::intercept_function_key(text, w, cx) {
            return;
        }
        self.field.update(cx, |s, cx| {
            s.replace_and_mark_text_in_range(range, text, selected, w, cx)
        });
        self.sync(w, cx);
    }
    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        bounds: Bounds<Pixels>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        self.field
            .update(cx, |s, cx| s.bounds_for_range(range, bounds, w, cx))
    }
    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<usize> {
        self.field
            .update(cx, |s, cx| s.character_index_for_point(point, w, cx))
    }
    fn set_selected_text_range(
        &mut self,
        range: Range<usize>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.composing {
            self.finish_composition(w, cx);
        }
        self.field.update(cx, |s, cx| {
            use gpui_kit::base::input::RopeExt;
            let start = s.text().offset_utf16_to_offset(range.start);
            let end = s.text().offset_utf16_to_offset(range.end);
            s.set_selected_range(start..end, cx);
        });
    }
    fn accepts_text_input(&self, _: &mut Window, _: &mut Context<Self>) -> bool {
        !self.read_only
    }
}
