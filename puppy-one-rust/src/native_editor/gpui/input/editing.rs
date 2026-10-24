use super::*;
impl TextInput {
    pub(super) fn undo(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        if self.read_only || self.composing() {
            return;
        }
        if self.external_history {
            cx.emit(InputEvent::Undo);
            return;
        }
        if let Some(s) = self.undo.pop() {
            self.redo.push(self.snapshot());
            self.restore(s, cx);
            self.reveal_cursor = true;
            cx.emit(InputEvent::Changed);
        }
    }
    pub(super) fn redo(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        if self.read_only || self.composing() {
            return;
        }
        if self.external_history {
            cx.emit(InputEvent::Redo);
            return;
        }
        if let Some(s) = self.redo.pop() {
            self.undo.push(self.snapshot());
            self.restore(s, cx);
            self.reveal_cursor = true;
            cx.emit(InputEvent::Changed);
        }
    }
    pub(super) fn enter(&mut self, _: &Enter, w: &mut Window, cx: &mut Context<Self>) {
        if self.composing() {
            return;
        }
        if self.table_cell {
            cx.emit(InputEvent::Next {
                backwards: false,
                vertical: true,
            });
        } else if self.multiline {
            self.replace_text_in_range(None, "\n", w, cx);
        }
    }
    pub(super) fn soft_enter(&mut self, _: &SoftEnter, w: &mut Window, cx: &mut Context<Self>) {
        if self.multiline && !self.composing() {
            self.replace_text_in_range(None, "\n", w, cx);
            self.soft_break = true;
        }
    }
    pub(super) fn tab(&mut self, _: &Tab, _: &mut Window, cx: &mut Context<Self>) {
        cx.emit(InputEvent::Next {
            backwards: false,
            vertical: false,
        });
    }
    pub(super) fn back_tab(&mut self, _: &BackTab, _: &mut Window, cx: &mut Context<Self>) {
        cx.emit(InputEvent::Next {
            backwards: true,
            vertical: false,
        });
    }
    pub(super) fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.select_to(self.previous_boundary(self.cursor_offset()), cx)
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    pub(super) fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.select_to(self.next_boundary(self.cursor_offset()), cx)
        }
        self.replace_text_in_range(None, "", window, cx)
    }
}
