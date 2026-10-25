//! Default commands (CodeMirror `@codemirror/commands` standard keymap):
//! cursor motion by character, group, visual line, page and document; deletion;
//! line breaks; clipboard. A format extension may intercept editing intents.
//!
//! While a composition is open, keys go to the input method first; a key it
//! hands back (`doCommandBySelector:`) commits the marked text and then runs
//! as usual, as in AppKit text views.
use super::{editor::EditorView, extension::EditIntent};
use crate::editor::text::{
    change::ChangeSet,
    selection::Selection,
    state::{Transaction, UserEvent},
    words,
};
use gpui::{ClipboardItem, Context, Window, point, px};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Motion {
    CharLeft,
    CharRight,
    GroupLeft,
    GroupRight,
    LineStart,
    LineEnd,
    Up,
    Down,
    PageUp,
    PageDown,
    DocStart,
    DocEnd,
}

impl EditorView {
    fn target(&self, motion: Motion, extend: bool) -> Selection {
        let s = self.state.selection;
        let text = self.state.doc.as_str();
        let head = s.head;
        // A collapsing horizontal move lands on the selection edge.
        if !extend && !s.is_empty() {
            match motion {
                Motion::CharLeft => return Selection::cursor(s.from()),
                Motion::CharRight => return Selection::cursor(s.to()),
                _ => {}
            }
        }
        let (pos, goal, upstream) = match motion {
            Motion::CharLeft => (
                self.skip_atomic(words::previous_grapheme(text, head), false),
                None,
                false,
            ),
            Motion::CharRight => (
                self.skip_atomic(words::next_grapheme(text, head), true),
                None,
                false,
            ),
            Motion::GroupLeft => (
                self.skip_atomic(words::previous_group(text, head), false),
                None,
                false,
            ),
            Motion::GroupRight => (
                self.skip_atomic(words::next_group(text, head), true),
                None,
                false,
            ),
            Motion::DocStart => (0, None, false),
            Motion::DocEnd => (text.len(), None, false),
            Motion::LineStart | Motion::LineEnd => {
                let (pos, upstream) = self.visual_line_edge(s, motion == Motion::LineEnd);
                (pos, None, upstream)
            }
            Motion::Up | Motion::Down | Motion::PageUp | Motion::PageDown => {
                self.vertical(motion, s)
            }
        };
        let anchor = if extend { s.anchor } else { pos };
        Selection {
            anchor,
            head: pos,
            goal_x: goal,
            upstream,
        }
    }

    /// Positions strictly inside an atomic range jump to its edge in the
    /// direction of motion (CodeMirror atomicRanges).
    pub(super) fn skip_atomic(&self, pos: usize, forward: bool) -> usize {
        match self
            .decorations
            .atomic
            .iter()
            .find(|r| r.start < pos && pos < r.end)
        {
            Some(r) if forward => r.end,
            Some(r) => r.start,
            None => pos,
        }
    }

    /// Start or end of the visual row holding the head.
    fn visual_line_edge(&self, s: Selection, end: bool) -> (usize, bool) {
        let doc = &self.state.doc;
        let fallback = || {
            let r = doc.line_range(doc.line_index(s.head));
            (if end { r.end } else { r.start }, false)
        };
        self.layout
            .as_ref()
            .and_then(|l| l.row_edge(s.head, s.upstream, end))
            .unwrap_or_else(fallback)
    }

    /// Up / down by source lines, for a caret or target outside the
    /// laid-out blocks (the caret was scrolled away): the layout has no rows
    /// there. The reveal that follows brings the caret into view.
    fn vertical_by_lines(&self, motion: Motion, s: Selection) -> (usize, Option<f32>, bool) {
        let doc = &self.state.doc;
        let line = doc.line_index(s.head);
        let column = s.head - doc.line_range(line).start;
        let last = doc.line_count().saturating_sub(1);
        let page = self.layout.as_ref().map_or(20, |l| {
            (f32::from(l.bounds.size.height) / 24.).max(1.) as usize
        });
        let target = match motion {
            Motion::Up => line.checked_sub(1),
            Motion::Down => (line < last).then_some(line + 1),
            Motion::PageUp => (line > 0).then(|| line.saturating_sub(page)),
            _ => (line < last).then(|| (line + page).min(last)),
        };
        let Some(target) = target else {
            let up = matches!(motion, Motion::Up | Motion::PageUp);
            return (if up { 0 } else { doc.len() }, s.goal_x, false);
        };
        let r = doc.line_range(target);
        let mut pos = (r.start + column).min(r.end);
        while !doc.as_str().is_char_boundary(pos) {
            pos -= 1;
        }
        (pos, s.goal_x, false)
    }

    fn vertical(&self, motion: Motion, s: Selection) -> (usize, Option<f32>, bool) {
        let doc = &self.state.doc;
        let Some(layout) = &self.layout else {
            return (s.head, None, false);
        };
        if !layout.covers(s.head) {
            return self.vertical_by_lines(motion, s);
        }
        let c = layout.caret(s.head, s.upstream);
        let goal = s.goal_x.unwrap_or(f32::from(c.x));
        let page = (f32::from(layout.bounds.size.height) - 40.).max(40.);
        let up = matches!(motion, Motion::Up | Motion::PageUp);
        let (row_top, row_bottom) = (f32::from(c.row_top), f32::from(c.row_top + c.row_height));
        let mut y = match motion {
            Motion::Up => row_top - 0.5,
            Motion::Down => row_bottom + 0.5,
            Motion::PageUp => row_top - page,
            _ => row_top + page,
        };
        let first = layout
            .blocks
            .first()
            .map_or(0., |b| f32::from(b.bounds.top()));
        let last = layout
            .blocks
            .last()
            .map_or(0., |b| f32::from(b.bounds.bottom()));
        for _ in 0..8 {
            if y < first {
                return if layout.starts_document {
                    (0, Some(goal), false)
                } else {
                    self.vertical_by_lines(motion, s)
                };
            }
            if y >= last {
                return if layout.ends_document {
                    (doc.len(), Some(goal), false)
                } else {
                    self.vertical_by_lines(motion, s)
                };
            }
            let (pos, upstream) = layout.offset_at(point(px(goal), px(y)));
            let next = layout.caret(pos, upstream);
            let moved = if up {
                next.row_top < c.row_top
            } else {
                next.row_top > c.row_top
            };
            if moved {
                return (pos, Some(goal), upstream);
            }
            // Landed in the padding of the same box: step past the box.
            match layout
                .blocks
                .iter()
                .find(|b| f32::from(b.bounds.top()) <= y && y < f32::from(b.bounds.bottom()))
            {
                Some(b) => {
                    y = if up {
                        f32::from(b.bounds.top()) - 0.5
                    } else {
                        f32::from(b.bounds.bottom()) + 0.5
                    }
                }
                None => y += if up { -1. } else { 1. },
            }
        }
        (s.head, Some(goal), s.upstream)
    }

    pub fn motion(&mut self, motion: Motion, extend: bool, cx: &mut Context<Self>) {
        self.commit_composition(cx);
        let selection = self.target(motion, extend);
        self.dispatch(Transaction::select(selection), cx);
    }

    /// A format may replace a default motion (e.g. ← across a hidden block
    /// marker); otherwise the motion runs.
    pub fn intent_or_motion(&mut self, intent: EditIntent, motion: Motion, cx: &mut Context<Self>) {
        self.commit_composition(cx);
        if let Some(tr) = self.extension.intercept(intent, &self.state) {
            self.dispatch(tr, cx);
            return;
        }
        self.motion(motion, false, cx);
    }

    pub fn select_all(&mut self, cx: &mut Context<Self>) {
        let len = self.state.doc.len();
        self.dispatch(Transaction::select(Selection::range(0, len)), cx);
    }

    fn try_intercept(&mut self, intent: EditIntent, cx: &mut Context<Self>) -> bool {
        self.commit_composition(cx);
        if self.read_only {
            return true;
        }
        if let Some(tr) = self.extension.intercept(intent, &self.state) {
            self.dispatch(tr, cx);
            return true;
        }
        false
    }

    /// Delete backward/forward by `motion` (or the selection).
    pub fn delete(&mut self, motion: Motion, cx: &mut Context<Self>) {
        let backward = matches!(
            motion,
            Motion::CharLeft | Motion::GroupLeft | Motion::LineStart
        );
        let intent = if backward {
            EditIntent::Backspace
        } else {
            EditIntent::Delete
        };
        if matches!(motion, Motion::CharLeft | Motion::CharRight) && self.try_intercept(intent, cx)
        {
            return;
        }
        self.commit_composition(cx);
        if self.read_only {
            return;
        }
        let s = self.state.selection;
        let range = if s.is_empty() {
            let mut moved = s;
            moved.head = self.target(motion, true).head;
            moved.as_range()
        } else {
            s.as_range()
        };
        if range.is_empty() {
            return;
        }
        let tr = Transaction::edit(
            ChangeSet::replace(range.clone(), ""),
            Some(Selection::cursor(range.start)),
            UserEvent::Delete,
        );
        self.dispatch(tr, cx);
    }

    pub fn edit_intent(&mut self, intent: EditIntent, cx: &mut Context<Self>) {
        if self.try_intercept(intent, cx) {
            return;
        }
        let text = match intent {
            EditIntent::Enter | EditIntent::SoftEnter => "\n",
            EditIntent::Tab => "\t",
            _ => return,
        };
        self.insert(text, UserEvent::Input, cx);
    }

    pub fn copy(&mut self, cut: bool, cx: &mut Context<Self>) {
        let range = self.state.selection.as_range();
        if range.is_empty() {
            return;
        }
        cx.write_to_clipboard(ClipboardItem::new_string(
            self.state.doc.slice(range.clone()).to_owned(),
        ));
        if cut && !self.read_only {
            self.dispatch(
                Transaction::edit(
                    ChangeSet::replace(range.clone(), ""),
                    Some(Selection::cursor(range.start)),
                    UserEvent::Delete,
                ),
                cx,
            );
        }
    }

    pub fn paste(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            let text = text.replace("\r\n", "\n").replace('\r', "\n");
            self.insert(&text, UserEvent::Paste, cx);
        }
    }
}
