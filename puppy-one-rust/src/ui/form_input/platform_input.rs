//! A bounded input bridge. All editing, IME transactions, history and geometry
//! remain in Kit; only incoming text is capped to the product's field limits,
//! and function-key text some input methods insert for arrows is dropped
//! (the key replayed, `ui::ime`).
use super::*;
use std::ops::Range;

impl TextInput {
    pub(super) fn bounded(
        &self,
        range: Option<Range<usize>>,
        text: &str,
        window: &mut Window,
        cx: &mut App,
    ) -> String {
        let (value, replacing) = dispatch!(&self.field, |s| s.update(cx, |s, cx| {
            let value = s.value();
            let replacing = range
                .or_else(|| s.marked_text_range(window, cx))
                .or_else(|| s.selected_text_range(false, window, cx).map(|s| s.range))
                .unwrap_or(0..0);
            (value, replacing)
        }));
        let start = super::super::input::utf16_to_byte(&value, replacing.start);
        let end = super::super::input::utf16_to_byte(&value, replacing.end).max(start);
        let capacity = self
            .max_chars
            .saturating_sub(value.chars().count() - value[start..end].chars().count());
        text.chars().take(capacity).collect()
    }
}
impl EntityInputHandler for TextInput {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        adjusted: &mut Option<Range<usize>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<String> {
        dispatch!(&self.field, |s| s
            .update(cx, |s, cx| s.text_for_range(range, adjusted, window, cx)))
    }
    fn selected_text_range(
        &mut self,
        ignore: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        dispatch!(&self.field, |s| s
            .update(cx, |s, cx| s.selected_text_range(ignore, window, cx)))
    }
    fn marked_text_range(
        &self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        dispatch!(&self.field, |s| s
            .update(cx, |s, cx| s.marked_text_range(window, cx)))
    }
    fn unmark_text(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        dispatch!(&self.field, |s| s
            .update(cx, |s, cx| s.unmark_text(window, cx)));
    }
    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if crate::ui::ime::intercept_function_key(text, window, cx) {
            return;
        }
        let text = self.bounded(range.clone(), text, window, cx);
        dispatch!(&self.field, |s| s.update(cx, |s, cx| s
            .replace_text_in_range(range, &text, window, cx)));
        self.value = dispatch!(&self.field, |s| s.read(cx).value());
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selection: Option<Range<usize>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if crate::ui::ime::intercept_function_key(text, window, cx) {
            return;
        }
        let text = self.bounded(range.clone(), text, window, cx);
        let len = text.encode_utf16().count();
        let selection = selection.map(|r| r.start.min(len)..r.end.min(len));
        dispatch!(&self.field, |s| s
            .update(cx, |s, cx| s.replace_and_mark_text_in_range(
                range, &text, selection, window, cx
            )));
        self.value = dispatch!(&self.field, |s| s.read(cx).value());
    }
    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        bounds: Bounds<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        dispatch!(&self.field, |s| s
            .update(cx, |s, cx| s.bounds_for_range(range, bounds, window, cx)))
    }
    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<usize> {
        dispatch!(&self.field, |s| s.update(cx, |s, cx| s
            .character_index_for_point(point, window, cx)))
    }
}

pub(super) struct PlatformInput {
    pub host: Entity<TextInput>,
    pub child: AnyElement,
}
impl IntoElement for PlatformInput {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl Element for PlatformInput {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        (self.child.request_layout(window, cx), ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.child.prepaint(window, cx);
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.child.paint(window, cx);
        let focus = self.host.focus_handle(cx);
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.host.clone()),
            cx,
        );
    }
}
