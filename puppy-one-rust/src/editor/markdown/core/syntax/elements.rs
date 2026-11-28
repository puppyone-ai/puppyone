//! Semantic element types, highlight bitflags, and `Syntax` query & tail-split
//! methods (product `core/syntax/markdownElementTypes.ts` and
//! `markdownElements.ts`).
use super::{Fence, Footnotes, InlineTag, List, ListItem, Paragraph, html_unbalanced, lines};
use crate::editor::text::buffer::Buffer;
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
    /// `:shortcode:` shown as its emoji (the `inline-syntax` feature).
    Emoji,
    /// `&name;` shown as its character.
    Entity,
    /// `[^id]` shown as its note's number (the `footnote` feature).
    FootnoteReference,
    /// `[^id]:` opening a note, shown as its number.
    FootnoteDefinition,
    /// `<tag>content</tag>` of the inline-editable HTML profile (the `html` feature).
    InlineHtml,
    /// A balanced stretch of inline HTML shown as one unit (`runRole: owner`,
    /// the `html` feature): an image, a theme picture or a passive element the
    /// inline-editable profile cannot style. Its markers are every tag inside.
    HtmlRun,
    /// `![alt](src)`, a reference image, or an Obsidian `![[image]]` embed.
    Image,
    /// The `!` of an Obsidian image embed: its target resolves by name (the `media` feature).
    ImageEmbed,
    /// An Obsidian `![[clip.mp4]]` video embed (the `media` feature).
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
            Kind::HtmlRun => (25, ""),
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
                | Kind::HtmlRun
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
    pub note_definitions: Vec<usize>,
    pub inline_tags: Vec<Span>,
    pub html_blocks: Vec<Span>,
    /// HTML blocks that share their first line with a list or quote marker
    /// (`isMarkerOwnedHtmlBlock`): a block widget would replace the marker, so
    /// the `html` feature projects them as runs. Their tags are in `inline_tags`.
    pub marker_html: Vec<Span>,
    pub top_blocks: Vec<Span>,
    pub footnotes: Footnotes,
    /// Global index of `[label]: url` link reference definitions (`TA-31`).
    pub link_defs: Vec<(Span, String)>,
    /// Sorted byte offsets of feature-reported multi-block delimiters (`TA-31`, `TA-32`).
    pub block_delimiters: Vec<usize>,
    /// Sorted non-overlapping spans of `Kind::Comment` elements for `O(log N)` incremental checks.
    pub comment_spans: Vec<Span>,
    /// Sorted non-overlapping spans of footnote reference/definition elements for `O(log N)` checks.
    pub footnote_spans: Vec<Span>,
}

impl Syntax {
    /// Eligible inline source ranges (non-code lines, split by table cells)
    /// intersecting byte `window`, for feature `collect_range` hooks.
    pub fn inline_ranges_in(&self, doc: &Buffer, window: Range<usize>) -> Vec<Span> {
        let total = doc.line_count();
        if total == 0 {
            return Vec::new();
        }
        let start_line = doc.line_index(window.start.min(doc.len()));
        let end_line = if window.end >= doc.len() {
            total
        } else if window.end <= window.start {
            start_line
        } else {
            (doc.line_index(window.end - 1) + 1).min(total)
        };
        lines::inline_ranges(
            doc,
            start_line..end_line,
            &self.code_lines,
            &self.tables,
            &self.table_cells,
        )
    }

    /// Whether an HTML block could pair with another across the document.
    pub fn has_unbalanced_html(&self, doc: &Buffer) -> bool {
        self.html_blocks
            .iter()
            .any(|h| html_unbalanced(&doc.slice_cow(h.clone())))
    }

    pub(super) fn enclosing_block_start(&self, offset: usize) -> usize {
        let idx = self.top_blocks.partition_point(|b| b.start <= offset);
        let Some(tb) = idx
            .checked_sub(1)
            .and_then(|i| self.top_blocks.get(i))
            .filter(|b| offset <= b.end)
        else {
            return offset;
        };
        let mut min_start = tb.start;
        let li = self.lists.partition_point(|l| l.range.start < tb.start);
        if self.lists.get(li).is_some_and(|l| {
            l.parent.is_none() && !l.quoted && l.range.start == tb.start && offset <= l.range.end
        }) {
            let i_at = self.items.partition_point(|i| i.range.start <= offset);
            if i_at > 0 {
                let root = self.items[i_at - 1]
                    .parents
                    .first()
                    .copied()
                    .unwrap_or(i_at - 1);
                let root_item = &self.items[root];
                if root_item.range.start >= tb.start {
                    min_start = if root_item.range.end >= offset {
                        root_item.range.start
                    } else {
                        root_item.range.end
                    };
                }
            }
        } else {
            let ti = self.tables.partition_point(|t| t.start < tb.start);
            if self
                .tables
                .get(ti)
                .is_some_and(|t| t.start == tb.start && offset <= t.end)
            {
                let ci = self.table_cells.partition_point(|c| c.start <= offset);
                if ci > 0 {
                    let prev_cell = &self.table_cells[ci - 1];
                    if prev_cell.start >= tb.start {
                        min_start = if prev_cell.end >= offset {
                            prev_cell.start
                        } else {
                            prev_cell.end
                        };
                    }
                }
            }
        }
        for spans in [&self.comment_spans, &self.footnote_spans] {
            let i = spans.partition_point(|r| r.end < offset);
            if let Some(s) = spans.get(i)
                && s.start < min_start
                && offset <= s.end
            {
                min_start = s.start;
            }
        }
        min_start
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
        // A run reveals as a whole, from either edge, and nothing nested in
        // it takes the reveal from it.
        if let Some(run) = self
            .elements_in(caret..caret)
            .filter(|e| e.kind == Kind::HtmlRun)
            .find(|e| e.range.start <= caret && caret <= e.range.end)
        {
            return Some(run);
        }
        self.elements_in(caret..caret)
            .filter(|e| {
                e.kind.reveals()
                    && if matches!(
                        e.kind,
                        Kind::FootnoteReference | Kind::FootnoteDefinition | Kind::Entity
                    ) {
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
        let last = self.items.partition_point(|i| i.range.start <= inside);
        if last == 0 {
            return None;
        }
        let cand = last - 1;
        std::iter::once(cand)
            .chain(self.items[cand].parents.iter().rev().copied())
            .find(|&idx| {
                let i = &self.items[idx];
                i.range.start <= inside
                    && inside <= i.range.end.max(i.marker_to)
                    && doc.line_index(i.marker_from) <= line
            })
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
