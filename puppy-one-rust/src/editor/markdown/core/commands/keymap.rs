//! `markdownEditingKeymap` (core/commands/markdownEditingKeymap.ts).
use super::{block, change, edit, handled, inline};
use crate::editor::{
    markdown::core::{
        plans::{Plan, Presentation},
        state::PreviewState,
        syntax::Syntax,
    },
    text::{
        selection::Selection,
        state::{EditorState, Transaction, UserEvent},
    },
    view::extension::EditIntent,
};

pub struct Cx<'a> {
    pub state: &'a EditorState,
    pub syntax: &'a Syntax,
    pub plans: &'a [Plan],
    pub preview: &'a PreviewState,
    pub read_only: bool,
}

impl Cx<'_> {
    fn composing_line(&self, offset: usize) -> bool {
        let doc = &self.state.doc;
        self.preview.composing == Some(doc.line_range(doc.line_index(offset)).start)
    }

    /// `getMarkdownVisibleLineStart`: after the block markers of the line.
    fn visible_line_start(&self, offset: usize) -> Option<usize> {
        let doc = &self.state.doc;
        let line = doc.line_range(doc.line_index(offset));
        self.syntax.block_marker_on(line).map(|e| e.visible_start())
    }
}

pub fn intercept(intent: EditIntent, cx: &Cx) -> Option<Transaction> {
    let s = cx.state.selection;
    let editing = !cx.read_only;
    match intent {
        EditIntent::Backspace if editing => delete_marker(cx, true),
        EditIntent::Delete if editing => delete_marker(cx, false),
        EditIntent::Enter if editing && s.is_empty() => enter(cx),
        EditIntent::CharLeft => caret_left_across_block_marker(cx),
        EditIntent::LineStart => caret_to_visible_line_start(cx),
        EditIntent::Tab if editing => block::indent(cx.state, cx.syntax, 1),
        EditIntent::BackTab if editing => block::indent(cx.state, cx.syntax, -1),
        EditIntent::Heading(level) if editing => block::set_heading(cx.state, level),
        EditIntent::BulletList if editing => block::toggle_list(cx.state, cx.syntax, block::ListKind::Bullet),
        EditIntent::OrderedList if editing => block::toggle_list(cx.state, cx.syntax, block::ListKind::Ordered),
        EditIntent::TaskList if editing => block::toggle_list(cx.state, cx.syntax, block::ListKind::Task),
        EditIntent::Quote if editing => block::toggle_quote(cx.state),
        EditIntent::Bold if editing => inline::toggle(cx.state, cx.syntax, inline::Spec::STRONG),
        EditIntent::Italic if editing => inline::toggle(cx.state, cx.syntax, inline::Spec::EMPHASIS),
        EditIntent::Strike if editing => inline::toggle(cx.state, cx.syntax, inline::Spec::STRIKE),
        EditIntent::Code if editing => inline::toggle(cx.state, cx.syntax, inline::Spec::CODE),
        EditIntent::Underline if editing => inline::toggle(cx.state, cx.syntax, inline::Spec::UNDERLINE),
        EditIntent::Link if editing => inline::wrap_link(cx.state),
        // Read-only editors still own their formatting keys.
        EditIntent::Bold | EditIntent::Italic | EditIntent::Strike | EditIntent::Code | EditIntent::Underline | EditIntent::Link => handled(cx.state),
        _ => None,
    }
}

/// `deleteMarkdownMarkerBackward` / `deleteMarkdownMarkerForward`: a block
/// marker at the visible line start, or a collapsed marker unit, goes as one.
fn delete_marker(cx: &Cx, backward: bool) -> Option<Transaction> {
    let s = cx.state.selection;
    if !s.is_empty() || cx.composing_line(s.head) {
        return None;
    }
    let caret = s.head;
    let doc = &cx.state.doc;
    let line = doc.line_range(doc.line_index(caret));
    let block = backward
        .then(|| cx.syntax.block_marker_on(line.clone()))
        .flatten()
        .filter(|e| e.visible_start() == caret)
        .and_then(|e| {
            // A task deletes its staged checkbox marker first.
            if e.kind == crate::editor::markdown::core::syntax::Kind::Task {
                e.markers.iter().find(|m| doc.slice((*m).clone()).contains('[')).or(e.markers.first()).cloned()
            } else {
                e.markers.first().cloned()
            }
        });
    let unit = block.or_else(|| {
        cx.plans.iter().filter(|p| !p.delete_units.is_empty() && p.presentation != Presentation::VisibleSource).filter(|p| p.source.start >= line.start && p.source.end <= line.end).find_map(|p| {
            if backward && caret == p.source.end {
                p.delete_units.last().cloned()
            } else if !backward && caret == p.source.start {
                p.delete_units.first().cloned()
            } else {
                None
            }
        })
    })?;
    edit(vec![change(unit.clone(), "")], Some(Selection::cursor(unit.start)), UserEvent::Delete)
}

/// `handleMarkdownEnter`: lists continue their item; other markup (quotes)
/// continues with the language package's command.
fn enter(cx: &Cx) -> Option<Transaction> {
    let state = cx.state;
    match cx.syntax.item_at(&state.doc, state.selection.head) {
        Some(item) if !cx.syntax.items[item].quoted => block::continue_list_item(state, cx.syntax, item),
        _ => block::continue_quote(state),
    }
}

/// `moveMarkdownCaretLeftAcrossHiddenBlockMarker`.
fn caret_left_across_block_marker(cx: &Cx) -> Option<Transaction> {
    let s = cx.state.selection;
    if !s.is_empty() || cx.composing_line(s.head) {
        return None;
    }
    let doc = &cx.state.doc;
    let line = doc.line_range(doc.line_index(s.head));
    let visible = cx.visible_line_start(s.head)?;
    if s.head != visible || line.start == 0 {
        return None;
    }
    Some(Transaction::select(Selection::cursor(line.start - 1)))
}

/// `moveMarkdownCaretToVisibleLineStart` (Home, ⌘←).
fn caret_to_visible_line_start(cx: &Cx) -> Option<Transaction> {
    let s = cx.state.selection;
    if !s.is_empty() {
        return None;
    }
    let visible = cx.visible_line_start(s.head)?;
    (s.head != visible).then(|| Transaction::select(Selection::cursor(visible)))
}
