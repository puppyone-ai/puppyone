//! Line boxes (blockDecorations.ts `decorateMarkdownLine`): each source
//! line's classes from its text and rhythm, its hidden block prefixes, then
//! its inline decorations.
use super::builder::Builder;
use crate::editor::markdown::{
    core::{
        classes::{Class, SourceSyntax},
        plans::{Atom, Plan, Presentation},
        syntax::{blockquote_marker, heading_marker, is_fence_line, is_rule_line},
    },
    style::cascade::LineInput,
};

/// `getMarkdownLineClasses` (expressions over the line text).
fn line_classes(text: &str) -> (Class, u8) {
    let mut classes = Class::NONE;
    let mut level = 0;
    if let Some((l, _)) = heading_marker(text) {
        classes |= Class::HEADING;
        level = l;
    }
    if text.trim_start().starts_with('>') {
        classes |= Class::BLOCKQUOTE;
    }
    if is_fence_line(text) {
        classes |= Class::CODE_FENCE;
    }
    if is_rule_line(text) {
        classes |= Class::HR;
    }
    (classes, level)
}

impl Builder<'_> {
    /// `addMarkdownSourceLineDecorations`: a line shown as source keeps its
    /// list rail and exposes one literal marker.
    pub fn source_line(&mut self, line: usize) {
        let range = self.cx.doc.line_range(line);
        let rhythm = &self.cx.rhythm[line];
        let classes = match &rhythm.list {
            Some(_) => (rhythm.classes - (Class::TASK_LINE | Class::TASK_CHECKED)) | Class::SOURCE_LINE | Class::LIST_SOURCE_LINE,
            None => Class::SOURCE_LINE,
        };
        self.line_box(line, LineInput { classes, level: 0, list: rhythm.list.as_ref(), live: self.cx.live }, false);
        if let Some(list) = &rhythm.list
            && list.source_indent_to > range.start
        {
            self.hide(range.start..list.source_indent_to, SourceSyntax::List, false);
        }
    }

    /// `decorateMarkdownLine`.
    pub fn line(&mut self, line: usize, plans: &[&Plan]) {
        let cx = self.cx;
        let range = cx.doc.line_range(line);
        let text = cx.doc.line(line);
        let rhythm = &cx.rhythm[line];
        let (mut classes, level) = line_classes(text);
        classes |= rhythm.classes;
        let task = plans.iter().find_map(|p| match (&p.presentation, p.element) {
            (Presentation::InlineAtom(Atom::TaskCheckbox { .. }), Some(e)) if p.source.start >= range.start && p.source.start <= range.end => Some(&cx.syntax.elements[e]),
            _ => None,
        });
        self.line_box(line, LineInput { classes, level, list: rhythm.list.as_ref(), live: cx.live }, true);
        if let Some((_, n)) = heading_marker(text) {
            self.hide(range.start..range.start + n, SourceSyntax::Heading, false);
        }
        if let Some(n) = blockquote_marker(text) {
            self.hide(range.start..range.start + n, SourceSyntax::Blockquote, false);
        }
        let mut occupied = Vec::new();
        if let Some(element) = task {
            let prefix = element.markers.first().map_or(range.start, |m| m.start)..element.visible_start();
            self.hide(prefix.clone(), SourceSyntax::Task, false);
            occupied.push(prefix);
        } else if let Some(list) = &rhythm.list
            && list.prefix_to > range.start
        {
            self.hide(range.start..list.prefix_to, SourceSyntax::List, false);
        }
        self.inline(line, plans, occupied);
    }
}
