use super::*;
impl TextInput {
    pub(super) fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.focus_handle.focus(window, cx);
        if self.document_mode
            && !self.read_only
            && let Some(bounds) = self.last_bounds
        {
            let p = event.position - bounds.origin;
            if let Some(label) = self.last_layout.labels.iter().find(|l| {
                p.x >= l.origin.x
                    && p.x < l.origin.x + l.width
                    && p.y >= l.origin.y
                    && p.y < l.origin.y + l.height
            }) {
                cx.emit(InputEvent::Adornment(label.range.start));
                return;
            }
        }
        self.is_selecting = true;

        if event.click_count >= 3 {
            let offset = self.index_for_mouse_position(event.position);
            let range = self
                .regions
                .iter()
                .find(|r| offset <= r.range.end)
                .map(|r| r.range.clone())
                .unwrap_or(0..self.content.len());
            self.move_to(range.start, cx);
            self.select_to(range.end, cx);
        } else if event.click_count == 2 {
            let offset = self.index_for_mouse_position(event.position);
            let word = self
                .content
                .unicode_word_indices()
                .find(|(start, word)| *start <= offset && offset < *start + word.len())
                .map(|(start, word)| start..start + word.len());
            if let Some(range) = word {
                self.move_to(range.start, cx);
                self.select_to(range.end, cx);
            } else {
                self.move_to(offset, cx);
            }
        } else if event.modifiers.shift {
            self.select_to(self.index_for_mouse_position(event.position), cx);
        } else {
            self.move_to(self.index_for_mouse_position(event.position), cx)
        }
    }

    pub(super) fn on_mouse_up(
        &mut self,
        _: &MouseUpEvent,
        _window: &mut Window,
        _: &mut Context<Self>,
    ) {
        self.is_selecting = false;
    }

    pub(super) fn on_mouse_move(
        &mut self,
        event: &MouseMoveEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.is_selecting {
            self.select_to(self.index_for_mouse_position(event.position), cx);
        }
    }

    pub(super) fn index_for_mouse_position(&self, position: Point<Pixels>) -> usize {
        if self.content.is_empty() {
            return 0;
        }

        let Some(bounds) = self.last_bounds else {
            return 0;
        };
        index_at(
            &self.last_layout,
            position - bounds.origin,
            self.line_height(),
        )
        .min(self.content.len())
    }
}
