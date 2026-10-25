//! The block widget contract (CodeMirror `WidgetType` for
//! `Decoration.replace({ block: true })`): a widget replaces whole source
//! lines with its own boxes and text leaves; the document text inside stays
//! the one canonical source. Each frame the view tells a widget its state
//! (block-selected, focused, read-only) and gives it handlers back into the
//! editor: format commands and selecting the whole block.
use super::{command::Command, render::RenderCx};
use gpui::*;
use std::{ops::Range, rc::Rc};

/// Runs a format command through the editor, for handlers that only know
/// their command when they fire (a drop target, a menu choice).
pub type CommandSender = Rc<dyn Fn(Command, &mut Window, &mut App)>;

/// Returns keyboard focus to the editor.
pub type Focuser = Rc<dyn Fn(&mut Window, &mut App)>;

/// What the view knows about a widget this frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WidgetState {
    /// The document selection covers the widget's whole source (the
    /// product's `is-doc-selected`).
    pub selected: bool,
    /// The caret or selection touches the widget's source.
    pub caret_inside: bool,
    /// The editor has keyboard focus.
    pub editor_focused: bool,
    pub read_only: bool,
}

impl WidgetState {
    /// The state of a widget over `source` for a selection `from..to`.
    pub fn of(
        source: &Range<usize>,
        from: usize,
        to: usize,
        editor_focused: bool,
        read_only: bool,
    ) -> Self {
        let selected = from < to && from <= source.start && to >= source.end;
        let caret_inside = from <= source.end && to >= source.start;
        Self {
            selected,
            caret_inside,
            editor_focused,
            read_only,
        }
    }

    /// `:focus-within`: the editor is focused with the caret inside.
    pub fn focus_within(&self) -> bool {
        self.editor_focused && self.caret_inside
    }
}

/// One widget's frame: its document geometry, state, and the render context.
pub struct WidgetCx<'r, 'a> {
    pub source: Range<usize>,
    /// Document top, column left and width of the block.
    pub top: f32,
    pub left: f32,
    pub width: f32,
    pub state: WidgetState,
    pub render: &'r mut RenderCx<'a>,
}

impl WidgetCx<'_, '_> {
    /// The block's positioned box of `height`.
    pub fn block_box(&self, height: f32) -> Div {
        self.render
            .block_box(self.top, self.left, self.width, height)
    }

    /// A stable element id for a part of this widget (keyed per block).
    pub fn id(&self, part: &'static str) -> ElementId {
        ElementId::NamedInteger(part.into(), self.source.start as u64)
    }

    pub fn sender(&self) -> CommandSender {
        let view = self.render.view.clone();
        Rc::new(move |command, window, cx| {
            let _ = view.update(cx, |v, cx| v.run_command(&command, window, cx));
        })
    }

    /// A handler returning keyboard focus to the editor.
    pub fn focuser(&self) -> Focuser {
        let view = self.render.view.clone();
        Rc::new(move |window, cx| {
            let _ = view.update(cx, |v, cx| v.focus(window, cx));
        })
    }
}

pub trait BlockWidget {
    /// The widget's box (at `cx.top` in a column of `cx.width`), with text
    /// leaves registered through `cx.render`. Returns the element and its
    /// height.
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32);
}

#[cfg(test)]
mod tests {
    use super::WidgetState;

    #[test]
    fn a_widget_is_block_selected_only_when_the_selection_covers_it() {
        let source = 10..20;
        assert!(WidgetState::of(&source, 5, 25, true, false).selected);
        assert!(WidgetState::of(&source, 10, 20, true, false).selected);
        assert!(!WidgetState::of(&source, 12, 25, true, false).selected);
        // A caret inside (or at an edge) is focus-within only when focused.
        let caret = WidgetState::of(&source, 15, 15, false, false);
        assert!(caret.caret_inside && !caret.selected && !caret.focus_within());
        assert!(WidgetState::of(&source, 20, 20, true, false).focus_within());
        assert!(!WidgetState::of(&source, 30, 30, true, false).caret_inside);
    }
}
