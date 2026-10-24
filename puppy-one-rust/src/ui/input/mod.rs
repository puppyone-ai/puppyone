//! Native GPUI text input, adapted from gpui 0.2.2 examples/input.rs (Apache-2.0).
//! Extended with wrapped text, style runs, bounded editing and IME transactions.
use gpui::{prelude::*, *};
use std::ops::Range;
use unicode_segmentation::UnicodeSegmentation;
mod layout;
pub use layout::TextRegion;
use layout::{KitTextElement, TextLayout, index_at, position_at};
mod actions;
mod clipboard;
mod editing;
mod navigation;
mod platform;
mod pointer;
pub mod presentation;
mod render;
#[cfg(test)]
mod tests;
pub use actions::*;
/// Shared native input boundary used by the form bridge and document host.
pub fn utf16_to_byte(text: &str, offset: usize) -> usize {
    platform::utf16_to_byte(text, offset)
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mark {
    pub bold: bool,
    pub italic: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InputSnapshot {
    pub text: String,
    pub marks: Vec<Mark>,
    pub anchor: usize,
    pub cursor: usize,
}
// Each of the two consumers uses a different subset of this shared event API.
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub enum InputEvent {
    Changed,
    Selection,
    Undo,
    Redo,
    Next { backwards: bool, vertical: bool },
    PasteTable(String),
    Adornment(usize),
}
pub struct TextInput {
    focus_handle: FocusHandle,
    content: SharedString,
    placeholder: SharedString,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    marks: Vec<Mark>,
    last_layout: TextLayout,
    last_bounds: Option<Bounds<Pixels>>,
    is_selecting: bool,
    scroll: ScrollHandle,
    table_scrolls: std::collections::HashMap<usize, ScrollHandle>,
    reveal_cursor: bool,
    pub multiline: bool,
    pub table_cell: bool,
    pub external_history: bool,
    pub max_chars: usize,
    pub font_size: f32,
    pub min_height: f32,
    pub heading: bool,
    pub dark: bool,
    pub read_only: bool,
    pub document_mode: bool,
    pub regions: Vec<TextRegion>,
    pub last_replacement: Option<(Range<usize>, usize)>,
    pub soft_break: bool,
    typing_mark: Option<Mark>,
    undo: Vec<InputSnapshot>,
    redo: Vec<InputSnapshot>,
    ime_before: Option<InputSnapshot>,
}
impl EventEmitter<InputEvent> for TextInput {}
impl TextInput {
    pub fn new(
        placeholder: impl Into<SharedString>,
        multiline: bool,
        max_chars: usize,
        cx: &mut Context<Self>,
    ) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
            content: "".into(),
            placeholder: placeholder.into(),
            selected_range: 0..0,
            selection_reversed: false,
            marked_range: None,
            marks: vec![],
            last_layout: TextLayout::default(),
            last_bounds: None,
            is_selecting: false,
            scroll: ScrollHandle::new(),
            table_scrolls: Default::default(),
            reveal_cursor: false,
            multiline,
            table_cell: false,
            external_history: false,
            max_chars,
            font_size: 14.,
            min_height: 22.,
            heading: false,
            dark: true,
            read_only: false,
            document_mode: false,
            regions: vec![],
            last_replacement: None,
            soft_break: false,
            typing_mark: None,
            undo: vec![],
            redo: vec![],
            ime_before: None,
        }
    }
    #[cfg(test)]
    pub fn text(&self) -> &str {
        &self.content
    }
    pub fn composing(&self) -> bool {
        self.marked_range.is_some()
    }
    pub fn toggle_typing_mark(&mut self, bold: bool, cx: &mut Context<Self>) {
        let scalar = self.content[..self.cursor_offset()].chars().count();
        let mut mark = self.typing_mark.unwrap_or_else(|| {
            scalar
                .checked_sub(1)
                .and_then(|i| self.marks.get(i))
                .copied()
                .unwrap_or_default()
        });
        if bold {
            mark.bold = !mark.bold;
        } else {
            mark.italic = !mark.italic;
        }
        self.typing_mark = Some(mark);
        cx.notify();
    }
    fn line_height(&self) -> Pixels {
        px(self.font_size
            * if self.document_mode {
                presentation::BODY_LINE_HEIGHT
            } else {
                1.55
            })
    }
    pub fn snapshot(&self) -> InputSnapshot {
        InputSnapshot {
            text: self.content.to_string(),
            marks: self.marks.clone(),
            anchor: if self.selection_reversed {
                self.selected_range.end
            } else {
                self.selected_range.start
            },
            cursor: self.cursor_offset(),
        }
    }
    pub fn restore(&mut self, s: InputSnapshot, cx: &mut Context<Self>) {
        self.typing_mark = None;
        self.last_replacement = None;
        self.content = s.text.into();
        self.marks = s.marks;
        self.selected_range = s.anchor.min(s.cursor)..s.anchor.max(s.cursor);
        self.selection_reversed = s.cursor < s.anchor;
        self.marked_range = None;
        self.ime_before = None;
        self.last_layout.clear();
        self.reveal_cursor = true;
        cx.notify();
    }
    fn replace(&mut self, range: Range<usize>, text: &str) -> usize {
        let start = self.content[..range.start].chars().count();
        let end = self.content[..range.end].chars().count();
        let remaining = self
            .max_chars
            .saturating_sub(self.marks.len() - (end - start));
        let text: String = text
            .chars()
            .filter(|c| self.multiline || (*c != '\n' && *c != '\r'))
            .take(remaining)
            .collect();
        let mark = self.typing_mark.unwrap_or_else(|| {
            self.marks
                .get(start)
                .or_else(|| start.checked_sub(1).and_then(|i| self.marks.get(i)))
                .copied()
                .unwrap_or_default()
        });
        self.marks
            .splice(start..end, std::iter::repeat_n(mark, text.chars().count()));
        self.content =
            (self.content[..range.start].to_owned() + &text + &self.content[range.end..]).into();
        self.last_replacement = Some((range, text.len()));
        self.soft_break = false;
        text.len()
    }
    fn changed(&mut self, before: InputSnapshot, cx: &mut Context<Self>) {
        if !self.external_history && before.text != self.content.as_ref() {
            self.undo.push(before);
            if self.undo.len() > 64 {
                self.undo.remove(0);
            }
            self.redo.clear();
        }
        self.reveal_cursor = true;
        cx.emit(InputEvent::Changed);
        cx.notify();
    }
}
