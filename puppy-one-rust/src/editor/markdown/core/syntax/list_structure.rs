//! List, list-item, task-line, and paragraph syntax structures
//! (product `core/syntax/markdownListStructure.ts`).
use super::Span;

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
