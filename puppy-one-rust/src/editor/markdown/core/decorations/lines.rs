//! Line boxes (`blockDecorations.ts` `decorateMarkdownLine`):
//! - Derives `Class::HEADING` and heading `level` from `Syntax` (`TODO-45`)
//!   rather than regex/line heuristics, so Setext headings get proper heading
//!   styling and `#` lines inside revealed code blocks stay code.
//! - Populates `Class::CODE_BLOCK_LINE`, `Class::CODE_FENCE`, and
//!   `Class::TABLE_LINE` on revealed/source code and table lines (`TODO-44`) so
//!   `style/cascade.rs` applies compact monospace source spacing.
use super::builder::Builder;
use crate::editor::markdown::{
    core::{
        plans::{Atom, Plan, Presentation},
        presentation::classes::{Class, SourceSyntax},
        syntax::{Syntax, blockquote_marker, is_fence_line, is_rule_line},
    },
    style::cascade::LineInput,
};
use std::ops::Range;

/// Structural block classes (`CODE_FENCE`, `CODE_BLOCK_LINE`, `TABLE_LINE`) from
/// `Syntax` fences and tables in `O(log N)` (`TODO-44`).
fn syntax_block_line_classes(syntax: &Syntax, line: usize, range: &Range<usize>) -> Class {
    let mut classes = Class::NONE;
    let f_idx = syntax.fences.partition_point(|f| f.lines.end <= line);
    if let Some(fence) = syntax.fences.get(f_idx)
        && fence.lines.contains(&line)
    {
        let is_delimiter =
            line == fence.lines.start || (fence.closed && line + 1 == fence.lines.end);
        if is_delimiter {
            classes |= Class::CODE_FENCE;
        } else {
            classes |= Class::CODE_BLOCK_LINE;
        }
    }
    let t_idx = syntax.tables.partition_point(|t| t.end < range.start);
    if let Some(table) = syntax.tables.get(t_idx)
        && table.start <= range.end
        && table.end >= range.start
    {
        classes |= Class::TABLE_LINE;
    }
    classes
}

fn non_heading_line_classes(text: &str, in_code: bool) -> Class {
    let mut classes = Class::NONE;
    if !in_code && text.trim_start().starts_with('>') {
        classes |= Class::BLOCKQUOTE;
    }
    if is_fence_line(text) {
        classes |= Class::CODE_FENCE;
    }
    if !in_code && is_rule_line(text) {
        classes |= Class::HR;
    }
    classes
}

impl Builder<'_> {
    /// `addMarkdownSourceLineDecorations`: a line shown as source keeps its
    /// list rail, exposes literal markers, and carries `CODE_BLOCK_LINE` /
    /// `CODE_FENCE` / `TABLE_LINE` when inside a fence or table (`TODO-44`).
    pub fn source_line(&mut self, line: usize) {
        let range = self.cx.doc.line_range(line);
        let text_cow = self.cx.doc.line_cow(line);
        let structural = syntax_block_line_classes(self.cx.syntax, line, &range);
        let mut extra = structural;
        if is_fence_line(&text_cow) {
            extra |= Class::CODE_FENCE;
        }
        let rhythm = self.rhythm_of(line).clone();
        let classes = match &rhythm.list {
            Some(_) => {
                (rhythm.classes - (Class::TASK_LINE | Class::TASK_CHECKED))
                    | Class::SOURCE_LINE
                    | Class::LIST_SOURCE_LINE
                    | extra
            }
            None => Class::SOURCE_LINE | extra,
        };
        self.line_box(
            line,
            LineInput {
                classes,
                level: 0,
                list: rhythm.list.as_ref(),
                live: self.cx.live,
            },
            false,
        );
        if let Some(list) = &rhythm.list
            && list.source_indent_to > range.start
        {
            self.hide(
                range.start..list.source_indent_to,
                SourceSyntax::List,
                false,
            );
        }
    }

    /// `decorateMarkdownLine`.
    pub fn line(&mut self, line: usize, plans: &[&Plan]) {
        let cx = self.cx;
        let range = cx.doc.line_range(line);
        let text_cow = cx.doc.line_cow(line);
        let text = text_cow.as_ref();
        let rhythm = self.rhythm_of(line).clone();

        let structural = syntax_block_line_classes(cx.syntax, line, &range);
        let in_code = structural.any(Class::CODE_FENCE | Class::CODE_BLOCK_LINE);
        let mut classes = non_heading_line_classes(text, in_code) | structural | rhythm.classes;

        // TODO-45: derive `Class::HEADING` + `level` + hidden ATX markers from
        // `Syntax` `Kind::Heading` elements rather than line-prefix heuristics!
        let heading_el = (!in_code)
            .then(|| cx.syntax.heading_on_line(&range))
            .flatten();
        let level = if let Some(h) = heading_el {
            classes |= Class::HEADING;
            h.level
        } else {
            0
        };

        let task = plans
            .iter()
            .find_map(|p| match (&p.presentation, p.element) {
                (Presentation::InlineAtom(Atom::TaskCheckbox { .. }), Some(e))
                    if p.source.start >= range.start && p.source.start <= range.end =>
                {
                    cx.syntax.elements.get(e)
                }
                _ => None,
            });
        self.line_box(
            line,
            LineInput {
                classes,
                level,
                list: rhythm.list.as_ref(),
                live: cx.live,
            },
            true,
        );
        if let Some(h) = heading_el {
            for marker in &h.markers {
                if marker.start >= range.start && marker.end <= range.end {
                    self.hide(marker.clone(), SourceSyntax::Heading, false);
                }
            }
        }
        if !in_code && let Some(n) = blockquote_marker(text) {
            self.hide(
                range.start..range.start + n,
                SourceSyntax::Blockquote,
                false,
            );
        }
        let mut occupied = Vec::new();
        if let Some(element) = task {
            let prefix =
                element.markers.first().map_or(range.start, |m| m.start)..element.visible_start();
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
