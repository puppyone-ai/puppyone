//! Markdown source → semantic elements with marker ranges (`TA-30`, `TA-31`,
//! `TA-40`, product `core/syntax/markdownElements.ts` and
//! `markdownListStructure.ts`).
//!
//! Supports both full-document `Syntax::parse_with` and block-level incremental
//! `Syntax::parse_incremental` (`TA-31`), re-parsing with `pulldown-cmark`
//! starting from the top-level block preceding the earliest change until block
//! boundaries re-align with shifted prior blocks while maintaining global
//! link-reference definitions and footnote indices.
mod autolink;
pub mod block_boundaries;
mod footnotes;
mod inline_html;
mod inline_syntax;
mod lines;
#[cfg(test)]
mod tests;
mod tree;

pub use footnotes::Footnotes;
pub use inline_html::InlineTag;
pub use lines::{Fence, blockquote_marker, heading_marker, is_fence_line, is_rule_line};

use super::feature::{self, Features};
use crate::editor::text::{buffer::Buffer, change::ChangeSet};
use std::ops::Range;

pub type Span = Range<usize>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Blockquote,
    Emphasis,
    Escape,
    Heading,
    InlineCode,
    Link,
    List,
    Rule,
    Strike,
    Strong,
    Task,
    WikiLink,
    /// `==text==` (the `inline-syntax` feature).
    Highlight,
    /// `%%text%%` or `<!-- text -->`: markup-coloured, never hidden.
    Comment,
    /// A link reference definition's `[label]:`.
    LinkDefinition,
    /// `:shortcode:` shown as its emoji.
    Emoji,
    /// `&name;` shown as its character.
    Entity,
    /// `[^id]` shown as its note's number (the `footnote` feature).
    FootnoteReference,
    /// `[^id]:` opening a note, shown as its number.
    FootnoteDefinition,
    /// `<tag>content</tag>` of the inline-editable HTML profile.
    InlineHtml,
    /// `![alt](src)`, a reference image, or an Obsidian `![[image]]` embed.
    Image,
    /// The `!` of an Obsidian image embed: its target resolves by name.
    ImageEmbed,
    /// An Obsidian `![[clip.mp4]]` video embed.
    VideoEmbed,
    /// Open inline element kind contributed by a feature (`TA-30`, `TA-40`,
    /// e.g. `Kind::FeatureInline("math")` for `$formula$`).
    FeatureInline(&'static str),
    /// Open block element kind contributed by a feature (`TA-40`).
    FeatureBlock(&'static str),
}

impl Kind {
    pub fn sort_rank(self) -> (u8, &'static str) {
        match self {
            Kind::Blockquote => (0, ""),
            Kind::Emphasis => (1, ""),
            Kind::Escape => (2, ""),
            Kind::Heading => (3, ""),
            Kind::InlineCode => (4, ""),
            Kind::Link => (5, ""),
            Kind::List => (6, ""),
            Kind::Rule => (7, ""),
            Kind::Strike => (8, ""),
            Kind::Strong => (9, ""),
            Kind::Task => (10, ""),
            Kind::WikiLink => (11, ""),
            Kind::Highlight => (12, ""),
            Kind::Comment => (13, ""),
            Kind::LinkDefinition => (14, ""),
            Kind::Emoji => (15, ""),
            Kind::Entity => (16, ""),
            Kind::FeatureInline(id) => (17, id),
            Kind::FootnoteReference => (18, ""),
            Kind::FootnoteDefinition => (19, ""),
            Kind::InlineHtml => (20, ""),
            Kind::Image => (21, ""),
            Kind::ImageEmbed => (22, ""),
            Kind::VideoEmbed => (23, ""),
            Kind::FeatureBlock(id) => (24, id),
        }
    }

    /// Inline kinds whose markers reveal with the caret inside.
    pub fn reveals(self) -> bool {
        matches!(
            self,
            Kind::Emphasis
                | Kind::InlineCode
                | Kind::Link
                | Kind::Strike
                | Kind::Strong
                | Kind::WikiLink
                | Kind::Highlight
                | Kind::LinkDefinition
                | Kind::Emoji
                | Kind::Entity
                | Kind::FeatureInline(_)
                | Kind::FootnoteReference
                | Kind::FootnoteDefinition
                | Kind::InlineHtml
        )
    }

    /// Kinds decorated inline (marks + hidden markers + inline widgets).
    pub fn inline(self) -> bool {
        matches!(
            self,
            Kind::Emphasis
                | Kind::Escape
                | Kind::InlineCode
                | Kind::Link
                | Kind::Strike
                | Kind::Strong
                | Kind::WikiLink
                | Kind::Highlight
                | Kind::Comment
                | Kind::LinkDefinition
                | Kind::Emoji
                | Kind::Entity
                | Kind::FeatureInline(_)
                | Kind::FootnoteReference
                | Kind::FootnoteDefinition
                | Kind::InlineHtml
        )
    }

    /// Block kinds whose leading marker is deleted as a unit at the visible start.
    pub fn block_marker(self) -> bool {
        matches!(
            self,
            Kind::Blockquote | Kind::Heading | Kind::List | Kind::Task
        )
    }

    /// Decoration priority (`inlineDecorations.ts` `compareInlineDecorationPriority`).
    pub fn priority(self) -> u8 {
        match self {
            Kind::WikiLink => 2,
            Kind::Link => 3,
            Kind::InlineCode => 4,
            Kind::Strong => 5,
            Kind::Strike => 6,
            Kind::Emphasis => 7,
            Kind::Escape => 8,
            Kind::Highlight => 6,
            Kind::Emoji
            | Kind::Entity
            | Kind::FeatureInline(_)
            | Kind::FootnoteReference
            | Kind::FootnoteDefinition => 8,
            _ => 9,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Element {
    pub kind: Kind,
    pub range: Span,
    pub markers: Vec<Span>,
    pub content: Option<Span>,
    /// The (first) source line of block elements (`None` on Setext headings).
    pub line: Option<Span>,
    /// Heading level.
    pub level: u8,
    pub checked: bool,
    pub href: Option<String>,
    /// What an emoji, entity, or feature inline atom shows instead of its source.
    pub text: Option<String>,
    /// An inline HTML element's tag.
    pub html: Option<Box<InlineTag>>,
}

impl Element {
    pub fn new(kind: Kind, range: Span, markers: Vec<Span>, content: Option<Span>) -> Self {
        Self {
            kind,
            range,
            markers,
            content,
            line: None,
            level: 0,
            checked: false,
            href: None,
            text: None,
            html: None,
        }
    }

    /// Where visible content starts after the block markers.
    pub fn visible_start(&self) -> usize {
        self.markers
            .iter()
            .map(|m| m.end)
            .fold(self.range.start, usize::max)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TaskLine {
    pub line: Span,
    pub depth: usize,
    pub checked: bool,
    pub checkbox: Span,
    pub prefix_to: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockKind {
    Paragraph,
    /// A task item's paragraph (Lezer's GFM `Task` node).
    Task,
    Heading,
}

/// A view of one list item's source (`MarkdownListItem`).
#[derive(Clone, Debug, PartialEq)]
pub struct ListItem {
    pub range: Span,
    pub list: usize,
    /// Ancestor items, outermost first.
    pub parents: Vec<usize>,
    pub quoted: bool,
    pub marker: String,
    pub marker_from: usize,
    /// After the marker and its following whitespace.
    pub marker_to: usize,
    pub content_from: usize,
    pub task: Option<TaskLine>,
    /// Direct text blocks (paragraphs, task paragraph, headings).
    pub blocks: Vec<(BlockKind, Span)>,
    /// Columns of indentation before the marker (tab stops of 4).
    pub indent_columns: usize,
    /// Column where content starts (CommonMark: 1–4 after the marker).
    pub content_column: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct List {
    pub range: Span,
    pub ordered: bool,
    pub items: Vec<usize>,
    pub parent: Option<usize>,
    pub quoted: bool,
    /// Widest marker (`10.` is 3) of an ordered list, else 0.
    pub columns: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Paragraph {
    pub range: Span,
    /// The nearest list item around the paragraph.
    pub item: Option<usize>,
    /// That item is inside a blockquote.
    pub item_quoted: bool,
    /// A direct child of the item (not nested in a quote or sub-block).
    pub direct: bool,
    /// The paragraph is the item's GFM `Task` block.
    pub task: bool,
}

/// Highlight classes of `puppyMarkdownHighlightStyle`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Hl(pub u16);

impl Hl {
    pub const NONE: Hl = Hl(0);
    pub const HEADING: Hl = Hl(1);
    pub const STRONG: Hl = Hl(1 << 1);
    pub const EMPHASIS: Hl = Hl(1 << 2);
    pub const STRIKE: Hl = Hl(1 << 3);
    pub const LINK: Hl = Hl(1 << 4);
    pub const MONOSPACE: Hl = Hl(1 << 5);
    pub const MARKUP: Hl = Hl(1 << 6);
    pub const QUOTE: Hl = Hl(1 << 7);
    pub const LIST: Hl = Hl(1 << 8);

    pub fn has(self, other: Hl) -> bool {
        self.0 & other.0 == other.0
    }
}

impl std::ops::BitOr for Hl {
    type Output = Hl;
    fn bitor(self, rhs: Hl) -> Hl {
        Hl(self.0 | rhs.0)
    }
}

/// An Obsidian callout (`calloutModel.ts`).
#[derive(Clone, Debug, PartialEq)]
pub struct Callout {
    pub appearance: &'static str,
    pub default_title: String,
    pub has_title: bool,
    pub fold: Option<bool>,
    pub marker: Span,
    pub first_line: usize,
    pub last_line: usize,
}

fn callout(doc: &Buffer, quote: &Element) -> Option<Callout> {
    let line = quote.line.clone()?;
    let text_cow = doc.slice_cow(line.clone());
    let text = text_cow.as_ref();
    let lead = text.len() - text.trim_start().len();
    let rest = text[lead..].strip_prefix('>')?;
    let space = usize::from(rest.starts_with([' ', '\t']));
    let after = &rest[space..];
    let word_len = after.strip_prefix("[!")?.find(']').filter(|&n| n > 0)?;
    let word = &after[2..2 + word_len];
    if !word.starts_with(|c: char| c.is_ascii_alphabetic())
        || !word
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    let mut end = 2 + word_len + 1;
    let fold = match after[end..].chars().next() {
        Some('-') => {
            end += 1;
            Some(true)
        }
        Some('+') => {
            end += 1;
            Some(false)
        }
        _ => None,
    };
    let marker_from = line.start + lead + 1 + space;
    let spaces = after[end..].len() - after[end..].trim_start_matches([' ', '\t']).len();
    let marker_to = marker_from + end + spaces;
    let lower = word.to_lowercase();
    let appearance = match lower.as_str() {
        "abstract" | "summary" | "tldr" => "abstract",
        "attention" | "warning" => "warning",
        "bug" => "bug",
        "caution" => "caution",
        "check" | "done" | "success" => "success",
        "cite" | "quote" => "quote",
        "danger" | "error" => "danger",
        "example" => "example",
        "fail" | "failure" | "missing" => "failure",
        "faq" | "help" | "question" => "question",
        "hint" | "tip" => "tip",
        "important" => "important",
        "info" => "info",
        "todo" => "todo",
        _ => "note",
    };
    let mut title = lower;
    if let Some(first) = title.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    Some(Callout {
        appearance,
        default_title: title,
        has_title: !doc.slice_cow(marker_to..line.end).trim().is_empty(),
        fold,
        marker: marker_from..marker_to,
        first_line: doc.line_index(line.start),
        last_line: doc.line_index(quote.range.end.saturating_sub(1).max(quote.range.start)),
    })
}

/// Window descriptor produced when [`Syntax::parse_incremental`] splices a
/// localized block window (`TA-31`), consumed by incremental plan compilation
/// (`TA-32`) and incremental Document-Layer decoration splicing (`TA-11`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyntaxSplice {
    pub old_bytes: Span,
    pub new_bytes: Span,
    pub old_lines: Range<usize>,
    pub new_lines: Range<usize>,
    pub byte_delta: isize,
    pub line_delta: isize,
    pub old_had_delimiters: bool,
}

/// Everything the Markdown pipeline derives from one document revision.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Syntax {
    pub elements: Vec<Element>,
    pub items: Vec<ListItem>,
    pub lists: Vec<List>,
    pub paragraphs: Vec<Paragraph>,
    pub fences: Vec<Fence>,
    /// Parser-owned fenced/indented code, including quote and list containers.
    pub code_blocks: Vec<Span>,
    pub code_lines: Vec<Range<usize>>,
    pub highlights: Vec<(Span, Hl)>,
    pub tables: Vec<Span>,
    /// Parser-owned content ranges; custom inline syntax cannot cross cells.
    pub table_cells: Vec<Span>,
    pub callouts: Vec<Callout>,
    pub note_definitions: Vec<usize>,
    pub inline_tags: Vec<Span>,
    pub html_blocks: Vec<Span>,
    pub top_blocks: Vec<Span>,
    pub footnotes: Footnotes,
    /// Global index of `[label]: url` link reference definitions (`TA-31`).
    pub link_defs: Vec<(Span, String)>,
    /// Sorted byte offsets of feature-reported multi-block delimiters (`TA-31`, `TA-32`).
    pub block_delimiters: Vec<usize>,
}

fn shift_signed(v: usize, delta: isize) -> usize {
    (v as isize + delta) as usize
}

fn shift_span_signed(span: &Span, delta: isize) -> Span {
    shift_signed(span.start, delta)..shift_signed(span.end, delta)
}

fn has_global_hazards(slice: &str) -> bool {
    slice.contains("[^") || slice.contains("]:") || slice.contains("<!--") || slice.contains("-->")
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
    fn parse_region(
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
            // Include the trailing `\n` of `end_line - 1` so pulldown-cmark sees
            // clean line terminations matching the full document.
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

        let mut blocks: Vec<Range<usize>> = syntax.code_lines.clone();
        for f in features {
            let mut extra_blocks = Vec::new();
            if feature::catch_feature_panic(f.id(), "recognize_blocks", || {
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
        footnotes::add_in_ranges(doc, &inline_ranges, &mut syntax);
        let html = inline_html::elements_in_buffer(doc, &syntax);
        syntax.elements.extend(html.into_iter().filter(|element| {
            // Inline HTML may span soft line breaks in a paragraph, but a
            // table cell is its own inline context. Any tag pair touching a
            // cell must fit wholly inside that one cell.
            let index = syntax
                .table_cells
                .partition_point(|cell| cell.end <= element.range.start);
            syntax.table_cells.get(index).is_none_or(|cell| {
                cell.start >= element.range.end
                    || (cell.start <= element.range.start && cell.end >= element.range.end)
            })
        }));
        syntax.elements.sort_by(|a, b| {
            a.range
                .start
                .cmp(&b.range.start)
                .then(a.range.end.cmp(&b.range.end))
                .then_with(|| a.kind.sort_rank().cmp(&b.kind.sort_rank()))
        });
        syntax
            .elements
            .dedup_by(|b, a| a.kind == b.kind && a.range == b.range);

        // Code spans suppress line scanners unless a feature explicitly owns
        // that entire span as part of its delimiter syntax. Resolve all code
        // intersections before removing anything, so an outer code span still
        // protects a nested feature-looking string.
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
            let Some(owner) = feature::find(features, id) else {
                return false;
            };
            let owns_all = overlaps.iter().all(|c| {
                e.range.start < c.range.start
                    && c.range.end < e.range.end
                    && feature::catch_feature_panic(id, "owns_inline_code", || {
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

        let mut block_delimiters = Vec::new();
        for f in features {
            let _ = feature::catch_feature_panic(f.id(), "scan_block_delimiters", || {
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

        syntax.fences = fences;
        let mut covered = 0;
        let callouts: Vec<Callout> = syntax
            .elements
            .iter()
            .filter(|e| e.kind == Kind::Blockquote)
            .filter(|e| {
                let outer = e.range.start >= covered;
                covered = covered.max(e.range.end);
                outer
            })
            .filter_map(|e| callout(doc, e))
            .collect();
        syntax.callouts = callouts;
        syntax
    }

    /// Block-level incremental Markdown parse (`TA-31`): re-parses starting
    /// from the top-level block preceding the earliest edit in `changes` until
    /// block boundaries re-align with shifted blocks from `prev`. Falls back
    /// cleanly to `parse_with` when an edit alters global link definitions,
    /// footnotes, front matter at line 0, or document-spanning fences/blocks.
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

    /// Attempt a bounded `O(|touched|)` block-level incremental re-parse,
    /// returning `None` when the edit requires a full document parse (`TA-31`).
    pub fn try_parse_incremental(
        doc: &Buffer,
        before_doc: &Buffer,
        prev: &Syntax,
        changes: &ChangeSet,
        features: Features,
    ) -> Option<(Self, SyntaxSplice)> {
        let (win_syntax, splice) =
            Self::compute_incremental_window(doc, before_doc, prev, changes, features)?;
        let mut next = prev.clone();
        Self::splice_syntax_in_place(&mut next, win_syntax, &splice);
        Some((next, splice))
    }

    /// In-place variant of [`Self::try_parse_incremental`] (`TA-31`, `TA-13`),
    /// mutating `syntax` in place so untouched elements, list items, fences, and
    /// strings avoid per-edit heap reallocation on multi-thousand-line documents.
    pub fn try_parse_incremental_in_place(
        syntax: &mut Syntax,
        doc: &Buffer,
        before_doc: &Buffer,
        changes: &ChangeSet,
        features: Features,
    ) -> Option<SyntaxSplice> {
        let (win_syntax, splice) =
            Self::compute_incremental_window(doc, before_doc, syntax, changes, features)?;
        Self::splice_syntax_in_place(syntax, win_syntax, &splice);
        Some(splice)
    }

    fn compute_incremental_window(
        doc: &Buffer,
        before_doc: &Buffer,
        prev: &Syntax,
        changes: &ChangeSet,
        features: Features,
    ) -> Option<(Self, SyntaxSplice)> {
        if changes.is_empty() {
            return None;
        }
        let n_blocks = prev.top_blocks.len();
        if n_blocks < 6 {
            return None;
        }

        let cs = changes.changes();
        let min_old = cs.first().map_or(0, |c| c.range.start);
        let max_old = cs.last().map_or(0, |c| c.range.end);
        let byte_delta = doc.len() as isize - before_doc.len() as isize;

        let first_hit = prev.top_blocks.partition_point(|b| b.end < min_old);
        let b_start = first_hit.saturating_sub(1);

        let old_start_byte;
        let old_start_line;
        if b_start == 0 {
            old_start_byte = 0;
            old_start_line = 0;
        } else {
            let prev_end = prev.top_blocks[b_start - 1].end;
            if prev_end >= min_old {
                return None;
            }
            let guard_end_line = doc.line_index(prev_end);
            old_start_line = guard_end_line + 1;
            if old_start_line >= doc.line_count() {
                return None;
            }
            old_start_byte = doc.line_range(old_start_line).start;
            if old_start_byte > min_old {
                return None;
            }
        }

        if prev
            .fences
            .iter()
            .any(|f| f.range.start < old_start_byte && f.range.end > old_start_byte)
            || prev
                .html_blocks
                .iter()
                .any(|h| h.start < old_start_byte && h.end > old_start_byte)
            || prev.elements.iter().any(|e| {
                e.kind == Kind::Comment
                    && e.range.start < old_start_byte
                    && e.range.end > old_start_byte
            })
        {
            return None;
        }

        let last_hit = prev.top_blocks.partition_point(|b| b.start <= max_old);
        let mut b_end = (last_hit + 1).min(n_blocks);

        loop {
            if b_end >= n_blocks {
                break;
            }
            let anchor_end = prev.top_blocks[b_end - 1].end;
            let straddles = prev
                .fences
                .iter()
                .any(|f| f.range.start < anchor_end && f.range.end > anchor_end)
                || prev
                    .html_blocks
                    .iter()
                    .any(|h| h.start < anchor_end && h.end > anchor_end)
                || prev.elements.iter().any(|e| {
                    e.kind == Kind::Comment
                        && e.range.start < anchor_end
                        && e.range.end > anchor_end
                });
            if straddles {
                b_end += 1;
            } else {
                break;
            }
        }

        let mut step = 1usize;
        let mut tried_eof = false;
        loop {
            let at_eof = b_end >= n_blocks;
            if at_eof {
                if tried_eof || b_start == 0 {
                    break;
                }
                tried_eof = true;
            } else if prev.top_blocks[b_end - 1].start <= max_old {
                b_end = (b_end + step).min(n_blocks);
                step *= 2;
                continue;
            }

            let (new_end_line, new_end_byte, old_end_byte, expected_align_new) = if at_eof {
                (doc.line_count(), doc.len(), before_doc.len(), None)
            } else {
                let align_block_old = &prev.top_blocks[b_end - 1];
                let expected = shift_span_signed(align_block_old, byte_delta);
                if expected.end > doc.len() {
                    return None;
                }
                let nel = (doc.line_index(expected.end) + 1).min(doc.line_count());
                let neb = if nel >= doc.line_count() {
                    doc.len()
                } else {
                    doc.line_range(nel).start
                };
                let oeb_signed = neb as isize - byte_delta;
                if oeb_signed < 0 {
                    return None;
                }
                (nel, neb, oeb_signed as usize, Some(expected))
            };

            if new_end_byte < old_start_byte
                || old_end_byte < old_start_byte
                || old_end_byte > before_doc.len()
            {
                return None;
            }

            let win_probe = doc.slice_cow(old_start_byte..new_end_byte);
            if has_global_hazards(&win_probe)
                || prev
                    .link_defs
                    .iter()
                    .any(|(r, _)| r.end > old_start_byte && r.start < old_end_byte)
                || prev.elements.iter().any(|e| {
                    matches!(e.kind, Kind::FootnoteReference | Kind::FootnoteDefinition)
                        && e.range.end > old_start_byte
                        && e.range.start < old_end_byte
                })
            {
                return None;
            }

            let extra_defs: String = prev
                .link_defs
                .iter()
                .map(|(_, raw)| raw.as_str())
                .collect::<Vec<_>>()
                .join("\n");

            let win_syntax =
                Self::parse_region(doc, old_start_line..new_end_line, &extra_defs, features);

            let start_aligned = b_start == 0
                || win_syntax
                    .top_blocks
                    .first()
                    .is_some_and(|first| first.start == prev.top_blocks[b_start].start);
            let end_aligned = match &expected_align_new {
                Some(expected) => {
                    win_syntax.fences.iter().all(|f| f.closed)
                        && win_syntax
                            .html_blocks
                            .last()
                            .is_none_or(|h| h.end <= expected.end)
                        && win_syntax.top_blocks.last() == Some(expected)
                }
                None => {
                    win_syntax.fences.iter().all(|f| f.closed)
                        && (extra_defs.is_empty() || win_syntax.html_blocks.is_empty())
                }
            };
            let aligned = win_syntax.link_defs.is_empty()
                && win_syntax.footnotes.is_empty()
                && start_aligned
                && end_aligned;

            if aligned {
                let old_end_line = if new_end_line >= doc.line_count() {
                    before_doc.line_count()
                } else {
                    before_doc.line_index(old_end_byte)
                };
                let line_delta = new_end_line as isize - old_end_line as isize;
                let bd_pre = prev
                    .block_delimiters
                    .partition_point(|&p| p < old_start_byte);
                let bd_suf = prev
                    .block_delimiters
                    .partition_point(|&p| p < old_end_byte)
                    .max(bd_pre);
                let splice = SyntaxSplice {
                    old_bytes: old_start_byte..old_end_byte,
                    new_bytes: old_start_byte..new_end_byte,
                    old_lines: old_start_line..old_end_line,
                    new_lines: old_start_line..new_end_line,
                    byte_delta,
                    line_delta,
                    old_had_delimiters: bd_suf > bd_pre,
                };
                return Some((win_syntax, splice));
            }

            if at_eof || step > 16 {
                break;
            }
            b_end = (b_end + step).min(n_blocks);
            step *= 2;
        }

        None
    }

    fn splice_syntax_in_place(prev: &mut Syntax, win: Syntax, sp: &SyntaxSplice) {
        let bd = sp.byte_delta;
        let ld = sp.line_delta;
        let ob = &sp.old_bytes;

        // 1. Elements (mutated in place — zero Vec/String clones for suffix!)
        let el_pre = prev.elements.partition_point(|e| e.range.start < ob.start);
        let el_suf = prev
            .elements
            .partition_point(|e| e.range.start < ob.end)
            .max(el_pre);
        let win_el_len = win.elements.len();
        prev.elements.splice(el_pre..el_suf, win.elements);
        if bd != 0 {
            for m in &mut prev.elements[el_pre + win_el_len..] {
                m.range = shift_span_signed(&m.range, bd);
                for mk in &mut m.markers {
                    *mk = shift_span_signed(mk, bd);
                }
                if let Some(c) = &mut m.content {
                    *c = shift_span_signed(c, bd);
                }
                if let Some(l) = &mut m.line {
                    *l = shift_span_signed(l, bd);
                }
            }
        }

        // 2. Lists, Items, and Paragraphs (with cross-index adjustment in place!)
        let list_pre = prev.lists.partition_point(|l| l.range.end <= ob.start);
        let list_suf = prev
            .lists
            .partition_point(|l| l.range.start < ob.end)
            .max(list_pre);
        let item_pre = prev.items.partition_point(|i| i.range.end <= ob.start);
        let item_suf = prev
            .items
            .partition_point(|i| i.range.start < ob.end)
            .max(item_pre);
        let para_pre = prev.paragraphs.partition_point(|p| p.range.end <= ob.start);
        let para_suf = prev
            .paragraphs
            .partition_point(|p| p.range.start < ob.end)
            .max(para_pre);

        let win_list_len = win.lists.len();
        let win_item_len = win.items.len();
        let win_para_len = win.paragraphs.len();
        let list_idx_delta = win_list_len as isize - (list_suf - list_pre) as isize;
        let item_idx_delta = win_item_len as isize - (item_suf - item_pre) as isize;

        let mut win_lists = win.lists;
        if item_pre != 0 {
            for l in &mut win_lists {
                for it in &mut l.items {
                    *it += item_pre;
                }
                if let Some(p) = &mut l.parent {
                    *p += item_pre;
                }
            }
        }
        prev.lists.splice(list_pre..list_suf, win_lists);
        if bd != 0 || item_idx_delta != 0 {
            for m in &mut prev.lists[list_pre + win_list_len..] {
                m.range = shift_span_signed(&m.range, bd);
                if item_idx_delta != 0 {
                    for it in &mut m.items {
                        *it = shift_signed(*it, item_idx_delta);
                    }
                    if let Some(p) = &mut m.parent {
                        *p = shift_signed(*p, item_idx_delta);
                    }
                }
            }
        }

        let mut win_items = win.items;
        if list_pre != 0 || item_pre != 0 {
            for it in &mut win_items {
                it.list += list_pre;
                for p in &mut it.parents {
                    *p += item_pre;
                }
            }
        }
        prev.items.splice(item_pre..item_suf, win_items);
        if bd != 0 || list_idx_delta != 0 || item_idx_delta != 0 {
            for m in &mut prev.items[item_pre + win_item_len..] {
                m.range = shift_span_signed(&m.range, bd);
                m.list = shift_signed(m.list, list_idx_delta);
                if item_idx_delta != 0 {
                    for p in &mut m.parents {
                        *p = shift_signed(*p, item_idx_delta);
                    }
                }
                m.marker_from = shift_signed(m.marker_from, bd);
                m.marker_to = shift_signed(m.marker_to, bd);
                m.content_from = shift_signed(m.content_from, bd);
                if let Some(t) = &mut m.task {
                    t.line = shift_span_signed(&t.line, bd);
                    t.checkbox = shift_span_signed(&t.checkbox, bd);
                    t.prefix_to = shift_signed(t.prefix_to, bd);
                }
                for (_, br) in &mut m.blocks {
                    *br = shift_span_signed(br, bd);
                }
            }
        }

        let mut win_paras = win.paragraphs;
        if item_pre != 0 {
            for p in &mut win_paras {
                if let Some(it) = &mut p.item {
                    *it += item_pre;
                }
            }
        }
        prev.paragraphs.splice(para_pre..para_suf, win_paras);
        if bd != 0 || item_idx_delta != 0 {
            for m in &mut prev.paragraphs[para_pre + win_para_len..] {
                m.range = shift_span_signed(&m.range, bd);
                if let Some(it) = &mut m.item {
                    *it = shift_signed(*it, item_idx_delta);
                }
            }
        }

        // 3. Fence models and all code-line regions have independent indexes:
        // indented/quoted code need not have a standalone fence model.
        let f_pre = prev.fences.partition_point(|f| f.range.end <= ob.start);
        let f_suf = prev
            .fences
            .partition_point(|f| f.range.start < ob.end)
            .max(f_pre);
        let win_f_len = win.fences.len();
        prev.fences.splice(f_pre..f_suf, win.fences);
        if bd != 0 || ld != 0 {
            for m in &mut prev.fences[f_pre + win_f_len..] {
                m.range = shift_span_signed(&m.range, bd);
                m.code = shift_span_signed(&m.code, bd);
                m.lines = shift_span_signed(&m.lines, ld);
            }
        }
        let c_pre = prev
            .code_lines
            .partition_point(|r| r.end <= sp.old_lines.start);
        let c_suf = prev
            .code_lines
            .partition_point(|r| r.start < sp.old_lines.end)
            .max(c_pre);
        let win_c_len = win.code_lines.len();
        prev.code_lines.splice(c_pre..c_suf, win.code_lines);
        if ld != 0 {
            for r in &mut prev.code_lines[c_pre + win_c_len..] {
                *r = shift_span_signed(r, ld);
            }
        }

        // 4. Highlights (in-place shift + splice + boundary coalescing)
        let hl_pre = prev.highlights.partition_point(|(r, _)| r.end <= ob.start);
        let hl_suf = prev
            .highlights
            .partition_point(|(r, _)| r.start < ob.end)
            .max(hl_pre);
        if bd != 0 {
            for (r, _) in &mut prev.highlights[hl_suf..] {
                *r = shift_span_signed(r, bd);
            }
        }
        let win_hl: Vec<(Span, Hl)> = win
            .highlights
            .into_iter()
            .filter(|(r, c)| !r.is_empty() && *c != Hl::NONE)
            .collect();
        let win_hl_len = win_hl.len();
        prev.highlights.splice(hl_pre..hl_suf, win_hl);
        let check_start = hl_pre.saturating_sub(1);
        let mut check_end = (hl_pre + win_hl_len + 1).min(prev.highlights.len());
        let mut idx = check_start;
        while idx + 1 < check_end {
            if prev.highlights[idx].1 == prev.highlights[idx + 1].1
                && prev.highlights[idx].0.end == prev.highlights[idx + 1].0.start
            {
                prev.highlights[idx].0.end = prev.highlights[idx + 1].0.end;
                prev.highlights.remove(idx + 1);
                check_end -= 1;
            } else {
                idx += 1;
            }
        }

        // 5. Simple sorted span lists
        let splice_spans_in_place = |vec: &mut Vec<Span>, mid: Vec<Span>| {
            let pre = vec.partition_point(|r| r.end <= ob.start);
            let suf = vec.partition_point(|r| r.start < ob.end).max(pre);
            let mid_len = mid.len();
            vec.splice(pre..suf, mid);
            if bd != 0 {
                for r in &mut vec[pre + mid_len..] {
                    *r = shift_span_signed(r, bd);
                }
            }
        };
        splice_spans_in_place(&mut prev.code_blocks, win.code_blocks);
        splice_spans_in_place(&mut prev.tables, win.tables);
        splice_spans_in_place(&mut prev.table_cells, win.table_cells);
        splice_spans_in_place(&mut prev.inline_tags, win.inline_tags);
        splice_spans_in_place(&mut prev.html_blocks, win.html_blocks);
        splice_spans_in_place(&mut prev.top_blocks, win.top_blocks);

        // 6. Note definitions
        let nd_pre = prev.note_definitions.partition_point(|&p| p < ob.start);
        let nd_suf = prev
            .note_definitions
            .partition_point(|&p| p < ob.end)
            .max(nd_pre);
        let win_nd_len = win.note_definitions.len();
        prev.note_definitions
            .splice(nd_pre..nd_suf, win.note_definitions);
        if bd != 0 {
            for p in &mut prev.note_definitions[nd_pre + win_nd_len..] {
                *p = shift_signed(*p, bd);
            }
        }

        // 7. Callouts
        let c_pre = prev
            .callouts
            .partition_point(|c| c.last_line < sp.old_lines.start);
        let c_suf = prev
            .callouts
            .partition_point(|c| c.first_line < sp.old_lines.end)
            .max(c_pre);
        let win_c_len = win.callouts.len();
        prev.callouts.splice(c_pre..c_suf, win.callouts);
        if bd != 0 || ld != 0 {
            for m in &mut prev.callouts[c_pre + win_c_len..] {
                m.marker = shift_span_signed(&m.marker, bd);
                m.first_line = shift_signed(m.first_line, ld);
                m.last_line = shift_signed(m.last_line, ld);
            }
        }

        // 8. Link definitions (unchanged outside window)
        let ld_pre = prev.link_defs.partition_point(|(r, _)| r.end <= ob.start);
        let ld_suf = prev
            .link_defs
            .partition_point(|(r, _)| r.start < ob.end)
            .max(ld_pre);
        prev.link_defs.drain(ld_pre..ld_suf);
        if bd != 0 {
            for (r, _) in &mut prev.link_defs[ld_pre..] {
                *r = shift_span_signed(r, bd);
            }
        }

        // 9. Feature block delimiters (`TA-31`, `TA-32`)
        let bd_pre = prev.block_delimiters.partition_point(|&p| p < ob.start);
        let bd_suf = prev
            .block_delimiters
            .partition_point(|&p| p < ob.end)
            .max(bd_pre);
        let win_bd_len = win.block_delimiters.len();
        prev.block_delimiters
            .splice(bd_pre..bd_suf, win.block_delimiters);
        if bd != 0 {
            for p in &mut prev.block_delimiters[bd_pre + win_bd_len..] {
                *p = shift_signed(*p, bd);
            }
        }

        prev.footnotes.shift_in_place(ob.end, bd);
    }

    pub fn callout_at(&self, line: usize) -> Option<&Callout> {
        let i = self.callouts.partition_point(|c| c.last_line < line);
        let c = self.callouts.get(i)?;
        (c.first_line <= line && line <= c.last_line).then_some(c)
    }

    fn enclosing_block_start(&self, offset: usize) -> usize {
        let idx = self.top_blocks.partition_point(|b| b.start <= offset);
        idx.checked_sub(1)
            .and_then(|i| self.top_blocks.get(i))
            .filter(|b| offset <= b.end)
            .map_or(offset, |b| b.start)
    }

    pub fn elements_in(&self, range: Span) -> impl Iterator<Item = &Element> {
        let min_start = self.enclosing_block_start(range.start);
        let start = self.elements.partition_point(|e| e.range.start < min_start);
        let end = self
            .elements
            .partition_point(|e| e.range.start <= range.end)
            .max(start);
        self.elements[start..end]
            .iter()
            .filter(move |e| e.range.end >= range.start)
    }

    pub fn reveal_element(&self, caret: usize) -> Option<&Element> {
        self.elements_in(caret..caret)
            .filter(|e| {
                e.kind.reveals()
                    && if matches!(
                        e.kind,
                        Kind::FootnoteReference | Kind::FootnoteDefinition | Kind::Entity
                    ) {
                        // Footnotes and character references expose source on
                        // either boundary under the product's caret-touch rule.
                        e.range.start <= caret && caret <= e.range.end
                    } else {
                        e.range.start < caret && caret < e.range.end
                    }
            })
            .min_by_key(|e| e.range.len())
    }

    /// ATX / list / quote / task block-marker element owning `line.start` in `O(log N)`.
    pub fn block_marker_on(&self, line: Span) -> Option<&Element> {
        let start = self
            .elements
            .partition_point(|e| e.range.start < line.start);
        let end = self
            .elements
            .partition_point(|e| e.range.start <= line.end)
            .max(start);
        self.elements[start..end].iter().find(|e| {
            e.kind.block_marker()
                && !e.markers.is_empty()
                && e.line.as_ref().is_some_and(|l| l.start == line.start)
        })
    }

    /// Heading element (`Kind::Heading`, ATX or Setext) covering `line` (`TODO-45`).
    pub fn heading_on_line(&self, line_range: &Span) -> Option<&Element> {
        self.elements_in(line_range.clone()).find(|e| {
            if e.kind != Kind::Heading {
                return false;
            }
            if let Some(hl) = &e.line {
                hl.start == line_range.start
            } else if let Some(content) = &e.content {
                // Setext heading: title lines get `Class::HEADING` + `level`.
                content.start <= line_range.end && content.end >= line_range.start
            } else {
                false
            }
        })
    }

    pub fn item_at(&self, doc: &Buffer, offset: usize) -> Option<usize> {
        let line = doc.line_index(offset);
        if self
            .code_lines
            .binary_search_by(|r| {
                if r.end <= line {
                    std::cmp::Ordering::Less
                } else if r.start > line {
                    std::cmp::Ordering::Greater
                } else {
                    std::cmp::Ordering::Equal
                }
            })
            .is_ok()
        {
            return None;
        }
        let range = doc.line_range(line);
        let text = doc.line_cow(line);
        let lead = text
            .bytes()
            .take_while(|b| *b == b' ' || *b == b'\t')
            .count();
        let inside = (range.start + lead + 1).min(range.end);
        let min_start = self.enclosing_block_start(range.start);
        let first = self.items.partition_point(|i| i.range.end < min_start);
        let last = self
            .items
            .partition_point(|i| i.range.start <= inside)
            .max(first);
        self.items[first..last]
            .iter()
            .enumerate()
            .filter(|(_, i)| {
                i.range.start <= inside
                    && inside <= i.range.end.max(i.marker_to)
                    && doc.line_index(i.marker_from) <= line
            })
            .max_by_key(|(_, i)| i.range.start)
            .map(|(k, _)| first + k)
    }

    pub fn highlights_in(&self, range: Span) -> &[(Span, Hl)] {
        let first = self
            .highlights
            .partition_point(|(r, _)| r.end <= range.start);
        let last = self
            .highlights
            .partition_point(|(r, _)| r.start < range.end)
            .max(first);
        &self.highlights[first..last]
    }
}
