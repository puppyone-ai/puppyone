//! Markdown source → semantic elements with marker ranges (`TA-30`, `TA-31`,
//! `TA-40`, product `core/syntax/markdownElements.ts` and
//! `markdownListStructure.ts`).
//!
//! Supports both full-document `Syntax::parse_with` and block-level incremental
//! `Syntax::parse_incremental` (`TA-31`), re-parsing with `pulldown-cmark`
//! starting from the top-level block preceding the earliest change until block
//! boundaries re-align with shifted prior blocks while invoking feature
//! `recognize_inline`, `recognize_blocks`, `collect_range`, and
//! `scan_block_delimiters` hooks (`MA-13`).
mod autolink;
pub mod block_boundaries;
mod elements;
mod incremental;
mod lines;
mod list_structure;
#[cfg(test)]
mod tests;
mod tree;
mod tree_inline;
mod tree_list;
mod tree_table;

pub use super::features::{Footnotes, InlineTag};
pub use elements::{Element, Hl, Kind, Span, Syntax, SyntaxSplice};
pub use lines::{Fence, blockquote_marker, heading_marker, is_fence_line, is_rule_line};
pub use list_structure::{BlockKind, List, ListItem, Paragraph, TaskLine};

use super::features::{self, Features};
use crate::editor::markdown::shared::dom;
use crate::editor::text::{buffer::Buffer, change::ChangeSet};
use std::ops::Range;

fn push_merged_span(out: &mut Vec<Span>, span: &Span) {
    if let Some(last) = out.last_mut()
        && span.start <= last.end
    {
        last.end = last.end.max(span.end);
    } else {
        out.push(span.clone());
    }
}

pub(super) fn span_straddles(spans: &[Span], pos: usize) -> bool {
    let i = spans.partition_point(|r| r.end <= pos);
    spans.get(i).is_some_and(|r| r.start < pos && r.end > pos)
}

pub(super) fn fence_straddles(fences: &[Fence], pos: usize) -> bool {
    let i = fences.partition_point(|f| f.range.end <= pos);
    fences
        .get(i)
        .is_some_and(|f| f.range.start < pos && f.range.end > pos)
}

pub(super) fn spans_overlap(spans: &[Span], range: &Span) -> bool {
    let i = spans.partition_point(|r| r.end <= range.start);
    spans.get(i).is_some_and(|r| r.start < range.end)
}

pub(super) fn link_defs_overlap(defs: &[(Span, String)], range: &Span) -> bool {
    let i = defs.partition_point(|(r, _)| r.end <= range.start);
    defs.get(i).is_some_and(|(r, _)| r.start < range.end)
}

/// Whether an HTML block's tags fail to balance on their own, so it can open or
/// close a flow with another HTML block (`<div>` … `</div>`) across the blocks
/// between them. A balanced block never pairs.
pub(super) fn html_unbalanced(source: &str) -> bool {
    !matches!(dom::parse(source), dom::Parsed::Complete(_))
}

pub(super) fn has_global_hazards(slice: &str) -> bool {
    slice.contains("[^") || slice.contains("]:") || slice.contains("<!--") || slice.contains("-->")
}

fn sort_elements(elements: &mut Vec<Element>) {
    elements.sort_by(|a, b| {
        a.range
            .start
            .cmp(&b.range.start)
            .then(a.range.end.cmp(&b.range.end))
            .then_with(|| a.kind.sort_rank().cmp(&b.kind.sort_rank()))
    });
    elements.dedup_by(|b, a| a.kind == b.kind && a.range == b.range);
}

impl Syntax {
    pub fn parse(doc: &Buffer) -> Self {
        Self::parse_with(doc, &[])
    }

    pub fn parse_with(doc: &Buffer, features: Features) -> Self {
        Self::parse_region(doc, 0..doc.line_count(), "", features)
    }

    /// Parse a localized line window `line_window` of `doc` with optional
    /// external reference link definitions (`TA-31`, `TA-32`).
    pub fn parse_window(
        doc: &Buffer,
        line_window: Range<usize>,
        extra_link_defs: &str,
        features: Features,
    ) -> Self {
        Self::parse_region(doc, line_window, extra_link_defs, features)
    }

    /// Parse lines `line_window` of `doc` (whose byte range starts at
    /// `doc.line_range(line_window.start).start`), using `extra_link_defs` for
    /// external reference-link resolution.
    pub(super) fn parse_region(
        doc: &Buffer,
        line_window: Range<usize>,
        extra_link_defs: &str,
        features: Features,
    ) -> Self {
        let total_lines = doc.line_count();
        let start_line = line_window.start.min(total_lines);
        let end_line = line_window.end.min(total_lines).max(start_line);
        let byte_start = if start_line < total_lines {
            doc.line_range(start_line).start
        } else {
            doc.len()
        };
        let byte_end = if end_line == 0 || start_line >= end_line {
            byte_start
        } else if end_line >= total_lines {
            doc.len()
        } else {
            doc.line_range(end_line).start
        };

        let fences = lines::fences_in_lines(doc, start_line..end_line);
        let slice_cow = doc.slice_cow(byte_start..byte_end);
        let (mut syntax, link_defs) = tree::walk_slice(&slice_cow, byte_start, extra_link_defs);
        syntax.link_defs = link_defs;
        let mut code_lines: Vec<_> = fences.iter().map(|f| f.lines.clone()).collect();
        code_lines.extend(syntax.code_blocks.iter().map(|r| {
            doc.line_index(r.start)..doc.line_index(r.end.saturating_sub(1).max(r.start)) + 1
        }));
        code_lines.sort_by_key(|r| (r.start, r.end));
        for range in code_lines {
            if let Some(last) = syntax.code_lines.last_mut()
                && range.start < last.end
            {
                last.end = last.end.max(range.end);
            } else {
                syntax.code_lines.push(range);
            }
        }
        syntax.fences = fences;

        let mut blocks: Vec<Range<usize>> = syntax.code_lines.clone();
        for f in features {
            let mut extra_blocks = Vec::new();
            if features::catch_feature_panic(f.id(), "recognize_blocks", || {
                f.recognize_blocks(doc, &syntax.code_lines, &mut extra_blocks);
            })
            .is_some()
            {
                blocks.extend(
                    extra_blocks
                        .into_iter()
                        .filter(|r| r.start < r.end && r.end <= total_lines),
                );
            }
        }
        blocks.sort_by_key(|r| r.start);

        let inline_ranges = lines::inline_ranges(
            doc,
            start_line..end_line,
            &blocks,
            &syntax.tables,
            &syntax.table_cells,
        );
        lines::add_inline_elements(doc, &inline_ranges, features, &mut syntax.elements);
        sort_elements(&mut syntax.elements);

        // Window-scoped feature collection (`TA-30`, `TA-31`, `MA-13`): runs
        // after base parsing and line scanning with sorted `syntax.elements`.
        let mut collected = Vec::new();
        for f in features {
            let mut stage = Vec::new();
            if features::catch_feature_panic(f.id(), "collect_range", || {
                f.collect_range(doc, &syntax, byte_start..byte_end, &mut stage);
            })
            .is_some()
            {
                for elem in stage {
                    if let Some(clamped) = lines::clamp_element(doc, elem) {
                        collected.push(clamped);
                    }
                }
            }
        }
        syntax.elements.extend(collected);
        sort_elements(&mut syntax.elements);

        // Code spans suppress line/feature scanners unless a feature explicitly
        // owns that entire span as part of its delimiter syntax.
        let code: Vec<Element> = syntax
            .elements
            .iter()
            .filter(|e| e.kind == Kind::InlineCode)
            .cloned()
            .collect();
        let mut owned_code = Vec::new();
        syntax.elements.retain(|e| {
            if !matches!(
                e.kind,
                Kind::Highlight
                    | Kind::Comment
                    | Kind::WikiLink
                    | Kind::Strike
                    | Kind::Emoji
                    | Kind::ImageEmbed
                    | Kind::VideoEmbed
                    | Kind::FeatureInline(_)
            ) {
                return true;
            }
            let overlaps: Vec<_> = code
                .iter()
                .filter(|c| c.range.start < e.range.end && e.range.start < c.range.end)
                .collect();
            if overlaps.is_empty() {
                return true;
            }
            let Kind::FeatureInline(id) = e.kind else {
                return false;
            };
            let Some(owner) = features::find(features, id) else {
                return false;
            };
            let owns_all = overlaps.iter().all(|c| {
                e.range.start < c.range.start
                    && c.range.end < e.range.end
                    && features::catch_feature_panic(id, "owns_inline_code", || {
                        owner.owns_inline_code(e, c)
                    })
                    .unwrap_or(false)
            });
            if owns_all {
                owned_code.extend(overlaps.iter().map(|c| c.range.clone()));
            }
            owns_all
        });
        syntax
            .elements
            .retain(|e| e.kind != Kind::InlineCode || !owned_code.contains(&e.range));

        let notes: Vec<Span> = syntax
            .elements
            .iter()
            .filter(|e| matches!(e.kind, Kind::FootnoteReference | Kind::FootnoteDefinition))
            .map(|e| e.range.clone())
            .collect();
        if !notes.is_empty() {
            syntax.elements.retain(|e| {
                e.kind != Kind::Link
                    || !notes
                        .iter()
                        .any(|n| n.start < e.range.end && e.range.start < n.end)
            });
        }

        let mut wiki_end = 0;
        syntax.elements.retain(|e| {
            if e.kind == Kind::Link && e.range.end <= wiki_end {
                return false;
            }
            if e.kind == Kind::WikiLink {
                wiki_end = wiki_end.max(e.range.end);
            }
            true
        });

        syntax.footnotes = Footnotes::from_elements(&syntax.elements);

        let mut block_delimiters = Vec::new();
        for f in features {
            let _ = features::catch_feature_panic(f.id(), "scan_block_delimiters", || {
                f.scan_block_delimiters(
                    doc,
                    start_line..end_line,
                    &syntax.code_lines,
                    &mut block_delimiters,
                );
            });
        }
        block_delimiters.sort_unstable();
        block_delimiters.dedup();
        syntax.block_delimiters = block_delimiters;

        let mut comment_spans = Vec::new();
        let mut footnote_spans = Vec::new();
        for e in &syntax.elements {
            match e.kind {
                Kind::Comment => push_merged_span(&mut comment_spans, &e.range),
                Kind::FootnoteReference | Kind::FootnoteDefinition => {
                    push_merged_span(&mut footnote_spans, &e.range)
                }
                _ => {}
            }
        }
        syntax.comment_spans = comment_spans;
        syntax.footnote_spans = footnote_spans;
        syntax
    }

    /// Block-level incremental Markdown parse (`TA-31`).
    pub fn parse_incremental(
        doc: &Buffer,
        before_doc: &Buffer,
        prev: &Syntax,
        changes: &ChangeSet,
        features: Features,
    ) -> (Self, Option<SyntaxSplice>) {
        if changes.is_empty() {
            return (prev.clone(), None);
        }
        match Self::try_parse_incremental(doc, before_doc, prev, changes, features) {
            Some((syntax, splice)) => (syntax, Some(splice)),
            None => (Self::parse_with(doc, features), None),
        }
    }

    /// Attempt a bounded `O(|touched|)` block-level incremental re-parse (`TA-31`).
    pub fn try_parse_incremental(
        doc: &Buffer,
        before_doc: &Buffer,
        prev: &Syntax,
        changes: &ChangeSet,
        features: Features,
    ) -> Option<(Self, SyntaxSplice)> {
        let mut next = prev.clone();
        let splice =
            Self::try_parse_incremental_in_place(&mut next, doc, before_doc, changes, features)?;
        Some((next, splice))
    }

    /// In-place variant of [`Self::try_parse_incremental`] (`TA-31`, `TA-13`).
    pub fn try_parse_incremental_in_place(
        syntax: &mut Syntax,
        doc: &Buffer,
        before_doc: &Buffer,
        changes: &ChangeSet,
        features: Features,
    ) -> Option<SyntaxSplice> {
        Self::try_parse_incremental_in_place_bounded(
            syntax, doc, before_doc, changes, features, true,
        )
    }

    /// Bounded variant of [`Self::try_parse_incremental_in_place`].
    pub fn try_parse_incremental_in_place_bounded(
        syntax: &mut Syntax,
        doc: &Buffer,
        before_doc: &Buffer,
        changes: &ChangeSet,
        features: Features,
        allow_eof: bool,
    ) -> Option<SyntaxSplice> {
        if allow_eof {
            if let Some(splice) = Self::try_patch_single_list_item_in_place(
                syntax, doc, before_doc, changes, features,
            ) {
                return Some(splice);
            }
            if let Some(splice) = Self::try_patch_single_table_row_in_place(
                syntax, doc, before_doc, changes, features,
            ) {
                return Some(splice);
            }
        }
        let (win_syntax, splice) = Self::compute_incremental_window(
            doc, before_doc, syntax, changes, features, allow_eof,
        )?;
        Self::splice_syntax_in_place(syntax, win_syntax, &splice);
        Some(splice)
    }
}
