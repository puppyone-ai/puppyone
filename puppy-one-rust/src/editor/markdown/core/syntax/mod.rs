//! Markdown source → semantic elements with marker ranges (product
//! core/syntax/markdownElements.ts and markdownListStructure.ts). The
//! CommonMark + GFM structure comes from pulldown-cmark's offset events (the
//! product uses the equivalent Lezer tree); line-level constructs the
//! product detects with expressions (strikethrough, quote markers, fences,
//! wiki links) use the same expressions here.
mod autolink;
mod lines;
#[cfg(test)]
mod tests;
mod tree;

pub use lines::{blockquote_marker, heading_marker, is_fence_line, is_rule_line, Fence};

use crate::editor::text::buffer::Buffer;
use std::ops::Range;

pub type Span = Range<usize>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Blockquote,
    Emphasis,
    Escape,
    Fence,
    Heading,
    InlineCode,
    Link,
    List,
    Rule,
    Strike,
    Strong,
    Table,
    Task,
    WikiLink,
}

impl Kind {
    /// Inline kinds whose markers reveal with the caret inside.
    pub fn reveals(self) -> bool {
        matches!(self, Kind::Emphasis | Kind::InlineCode | Kind::Link | Kind::Strike | Kind::Strong | Kind::WikiLink)
    }
    /// Kinds decorated inline (marks + hidden markers).
    pub fn inline(self) -> bool {
        matches!(self, Kind::Emphasis | Kind::Escape | Kind::InlineCode | Kind::Link | Kind::Strike | Kind::Strong | Kind::WikiLink)
    }
    /// Block kinds whose leading marker is deleted as a unit at the visible start.
    pub fn block_marker(self) -> bool {
        matches!(self, Kind::Blockquote | Kind::Heading | Kind::List | Kind::Task)
    }
    /// Decoration priority (inlineDecorations.ts compareInlineDecorationPriority).
    pub fn priority(self) -> u8 {
        match self {
            Kind::WikiLink => 2,
            Kind::Link => 3,
            Kind::InlineCode => 4,
            Kind::Strong => 5,
            Kind::Strike => 6,
            Kind::Emphasis => 7,
            Kind::Escape => 8,
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
    /// The (first) source line of block elements.
    pub line: Option<Span>,
    /// Heading level.
    pub level: u8,
    pub checked: bool,
    pub href: Option<String>,
}

impl Element {
    pub fn new(kind: Kind, range: Span, markers: Vec<Span>, content: Option<Span>) -> Self {
        Self { kind, range, markers, content, line: None, level: 0, checked: false, href: None }
    }
    /// Where visible content starts after the block markers.
    pub fn visible_start(&self) -> usize {
        self.markers.iter().map(|m| m.end).fold(self.range.start, usize::max)
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

/// A view of one list item's source (MarkdownListItem).
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

/// Highlight classes of `puppyMarkdownHighlightStyle`, combined per text
/// span the way Lezer's `highlightTree` combines style tags.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Hl(pub u16);

impl Hl {
    pub const NONE: Hl = Hl(0);
    /// `cm-md-syntax-heading`
    pub const HEADING: Hl = Hl(1);
    /// `cm-md-syntax-strong`
    pub const STRONG: Hl = Hl(1 << 1);
    /// `cm-md-syntax-emphasis`
    pub const EMPHASIS: Hl = Hl(1 << 2);
    /// `cm-md-syntax-strikethrough`
    pub const STRIKE: Hl = Hl(1 << 3);
    /// `cm-md-syntax-link`
    pub const LINK: Hl = Hl(1 << 4);
    /// `cm-md-syntax-monospace`
    pub const MONOSPACE: Hl = Hl(1 << 5);
    /// `cm-md-syntax-markup`
    pub const MARKUP: Hl = Hl(1 << 6);
    /// `cm-md-syntax-quote`
    pub const QUOTE: Hl = Hl(1 << 7);
    /// `cm-md-syntax-list`
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

/// Everything the Markdown pipeline derives from one document revision.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Syntax {
    /// Sorted by start, then end, then kind; one element per (kind, range).
    pub elements: Vec<Element>,
    pub items: Vec<ListItem>,
    pub lists: Vec<List>,
    pub paragraphs: Vec<Paragraph>,
    pub fences: Vec<Fence>,
    /// Source lines covered by fenced code (no inline syntax inside).
    pub code_lines: Vec<Range<usize>>,
    /// Flat, sorted, non-overlapping highlight spans.
    pub highlights: Vec<(Span, Hl)>,
    /// GFM table ranges (the parser's Table nodes).
    pub tables: Vec<Span>,
}

impl Syntax {
    pub fn parse(doc: &Buffer) -> Self {
        let fences = lines::fences(doc);
        let mut syntax = tree::walk(doc);
        syntax.code_lines = fences.iter().map(|f| f.lines.clone()).collect();
        // Block features own their lines (feature collectBlock runs first).
        let mut blocks: Vec<Range<usize>> = syntax.code_lines.clone();
        blocks.extend(syntax.tables.iter().map(|t| doc.line_index(t.start)..doc.line_index(t.end) + 1));
        blocks.sort_by_key(|r| r.start);
        lines::add_line_elements(doc, &blocks, &mut syntax.elements);
        syntax.elements.sort_by(|a, b| a.range.start.cmp(&b.range.start).then(a.range.end.cmp(&b.range.end)).then((a.kind as u8).cmp(&(b.kind as u8))));
        syntax.elements.dedup_by(|b, a| a.kind == b.kind && a.range == b.range);
        // A link inside a wiki link belongs to the wiki link.
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
        syntax.fences = fences;
        syntax
    }

    /// Elements intersecting `range` (inclusive edges).
    pub fn elements_in(&self, range: Span) -> impl Iterator<Item = &Element> {
        let end = self.elements.partition_point(|e| e.range.start <= range.end);
        self.elements[..end].iter().filter(move |e| e.range.end >= range.start)
    }

    /// The smallest revealable inline element strictly around `caret`
    /// (getInlineRevealElement).
    pub fn reveal_element(&self, caret: usize) -> Option<&Element> {
        self.elements_in(caret..caret)
            .filter(|e| e.kind.reveals() && caret > e.range.start && caret < e.range.end)
            .min_by_key(|e| e.range.len())
    }

    /// The block-marker element owning the line starting at `line_start`.
    pub fn block_marker_on(&self, line: Span) -> Option<&Element> {
        self.elements_in(line.clone())
            .find(|e| e.kind.block_marker() && e.line.as_ref().is_some_and(|l| l.start == line.start))
    }

    /// The list item whose marker line contains `offset` (not quoted items).
    pub fn item_at_line(&self, line: Span) -> Option<&ListItem> {
        self.items.iter().rev().find(|i| i.marker_from >= line.start && i.marker_from <= line.end)
    }

    /// Whether `offset` lies inside fenced code.
    pub fn in_code(&self, doc: &Buffer, offset: usize) -> bool {
        let line = doc.line_index(offset);
        self.code_lines.iter().any(|r| r.contains(&line))
    }

    /// `getMarkdownListItemAt`: the innermost list item owning the line of
    /// `offset` (code inside an item owns its own lines).
    pub fn item_at(&self, doc: &Buffer, offset: usize) -> Option<usize> {
        let line = doc.line_index(offset);
        if self.code_lines.iter().any(|r| r.contains(&line)) {
            return None;
        }
        let range = doc.line_range(line);
        let text = doc.line(line);
        let lead = text.bytes().take_while(|b| *b == b' ' || *b == b'\t').count();
        let inside = (range.start + lead + 1).min(range.end);
        self.items
            .iter()
            .enumerate()
            .filter(|(_, i)| i.range.start <= inside && inside <= i.range.end.max(i.marker_to) && doc.line_index(i.marker_from) <= line)
            .max_by_key(|(_, i)| i.range.start)
            .map(|(k, _)| k)
    }

    /// Highlight spans intersecting `range`.
    pub fn highlights_in(&self, range: Span) -> &[(Span, Hl)] {
        let first = self.highlights.partition_point(|(r, _)| r.end <= range.start);
        let last = self.highlights.partition_point(|(r, _)| r.start < range.end).max(first);
        &self.highlights[first..last]
    }
}
