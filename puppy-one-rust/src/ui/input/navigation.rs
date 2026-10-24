use super::*;
impl TextInput {
    pub(super) fn vertical(&mut self, delta: f32, cx: &mut Context<Self>) {
        let i = layout::vertical_index(&self.last_layout, self.cursor_offset(), delta);
        self.move_to(i.min(self.content.len()), cx);
    }
    pub(super) fn select_up(&mut self, _: &SelectUp, _: &mut Window, cx: &mut Context<Self>) {
        let i = layout::vertical_index(&self.last_layout, self.cursor_offset(), -1.);
        self.select_to(i.min(self.content.len()), cx);
    }
    pub(super) fn select_down(&mut self, _: &SelectDown, _: &mut Window, cx: &mut Context<Self>) {
        let i = layout::vertical_index(&self.last_layout, self.cursor_offset(), 1.);
        self.select_to(i.min(self.content.len()), cx);
    }
    pub(super) fn up(&mut self, _: &Up, _: &mut Window, cx: &mut Context<Self>) {
        self.vertical(-1., cx);
    }
    pub(super) fn down(&mut self, _: &Down, _: &mut Window, cx: &mut Context<Self>) {
        self.vertical(1., cx);
    }
    pub(super) fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.previous_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.start, cx)
        }
    }

    pub(super) fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.next_boundary(self.selected_range.end), cx);
        } else {
            self.move_to(self.selected_range.end, cx)
        }
    }

    pub(super) fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.previous_boundary(self.cursor_offset()), cx);
    }

    pub(super) fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.next_boundary(self.cursor_offset()), cx);
    }

    pub(super) fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
        self.select_to(self.content.len(), cx)
    }

    pub(super) fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
    }

    pub(super) fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.content.len(), cx);
    }

    pub(super) fn line_start(&mut self, _: &LineStart, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(
            layout::line_edge(&self.last_layout, self.cursor_offset(), false),
            cx,
        );
    }
    pub(super) fn line_end(&mut self, _: &LineEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(
            layout::line_edge(&self.last_layout, self.cursor_offset(), true),
            cx,
        );
    }
    pub(super) fn select_line_start(
        &mut self,
        _: &SelectLineStart,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.select_to(
            layout::line_edge(&self.last_layout, self.cursor_offset(), false),
            cx,
        );
    }
    pub(super) fn select_line_end(
        &mut self,
        _: &SelectLineEnd,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.select_to(
            layout::line_edge(&self.last_layout, self.cursor_offset(), true),
            cx,
        );
    }
    pub(super) fn select_start(&mut self, _: &SelectStart, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(0, cx);
    }
    pub(super) fn select_end(&mut self, _: &SelectEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.content.len(), cx);
    }
    pub(super) fn word_boundary(&self, backwards: bool) -> usize {
        let cursor = self.cursor_offset();
        if backwards {
            self.content
                .unicode_word_indices()
                .map(|(start, _)| start)
                .rfind(|i| *i < cursor)
                .unwrap_or(0)
        } else {
            self.content
                .unicode_word_indices()
                .map(|(start, word)| start + word.len())
                .find(|i| *i > cursor)
                .unwrap_or(self.content.len())
        }
    }
    pub(super) fn word_left(&mut self, _: &WordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.word_boundary(true), cx);
    }
    pub(super) fn word_right(&mut self, _: &WordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.word_boundary(false), cx);
    }
    pub(super) fn select_word_left(
        &mut self,
        _: &SelectWordLeft,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.select_to(self.word_boundary(true), cx);
    }
    pub(super) fn select_word_right(
        &mut self,
        _: &SelectWordRight,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.select_to(self.word_boundary(false), cx);
    }
    pub(super) fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.typing_mark = None;
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        self.reveal_cursor = true;
        cx.emit(InputEvent::Selection);
        cx.notify()
    }

    pub(super) fn cursor_offset(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    pub(super) fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.typing_mark = None;
        if self.selection_reversed {
            self.selected_range.start = offset
        } else {
            self.selected_range.end = offset
        };
        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }
        self.reveal_cursor = true;
        cx.emit(InputEvent::Selection);
        cx.notify()
    }
}
