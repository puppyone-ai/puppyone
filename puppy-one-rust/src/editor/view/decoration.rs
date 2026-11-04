//! What an editor extension (Markdown, CSV source, plain text) asks the view
//! to render, mirroring CodeMirror decorations: a block per source line (or a
//! widget replacing several lines), inline marks, hidden (replaced) source
//! ranges and atomic ranges. The view never interprets document syntax.
//!
//! Text is drawn by GPUI Kit (`editor_host`): a mark is what a Kit text leaf
//! can express (bold, italic, strikethrough, inline code, link); every box
//! around the text belongs to the line style.
use super::{style::LineStyle, widget::BlockWidget};
use gpui::{Rgba, SharedString};
use std::{ops::Range, rc::Rc};

/// Inline formatting of a source range, as Kit `TextMark`s.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct MarkStyle {
    pub bold: bool,
    pub italic: bool,
    pub strike: bool,
    pub underline: bool,
    pub code: bool,
    pub link: Option<SharedString>,
    /// A background behind the text (`<mark>`, `==highlight==`), as RGBA.
    pub highlight: Option<u32>,
    /// The text's own colour, as RGBA.
    pub color: Option<u32>,
}
/// An `Rgba` as the packed RGBA a mark stores.
pub fn packed(color: Rgba) -> u32 {
    let channel = |v: f32| (v.clamp(0., 1.) * 255.).round() as u32;
    channel(color.r) << 24 | channel(color.g) << 16 | channel(color.b) << 8 | channel(color.a)
}

impl MarkStyle {
    pub fn is_plain(&self) -> bool {
        *self == Self::default()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Mark {
    pub range: Range<usize>,
    pub style: MarkStyle,
}

#[derive(Clone)]
pub enum Block {
    /// One `.cm-line`: a source line laid out as a wrapped paragraph.
    Line { line: usize, style: Rc<LineStyle> },
    /// Consecutive source lines replaced by a block widget.
    Widget {
        lines: Range<usize>,
        widget: Rc<dyn BlockWidget>,
    },
}

impl Block {
    pub fn lines(&self) -> Range<usize> {
        match self {
            Self::Line { line, .. } => *line..*line + 1,
            Self::Widget { lines, .. } => lines.clone(),
        }
    }
}

/// Scrollport-level presentation.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Surface {
    /// Minimum insets of the text column inside the scrollport.
    pub content: super::style::Edges,
    /// Maximum width of the text column (e.g. the 724px reading rail).
    pub max_text_width: Option<f32>,
    pub background: Rgba,
    pub selection: Rgba,
    pub selection_inactive: Rgba,
    pub caret: Rgba,
    pub caret_width: f32,
    /// Kit link colour (`--po-md-link-color`).
    pub link: Rgba,
    /// Kit inline-code colour (`--po-md-inline-code-color`); `None` inherits
    /// the enclosing text's colour, just like CSS `currentColor`.
    pub inline_code: Option<Rgba>,
}

#[derive(Clone, Default)]
pub struct Decorations {
    /// In source order, covering every source line exactly once.
    pub blocks: Vec<Block>,
    /// Sorted by start, non-overlapping.
    pub marks: Vec<Mark>,
    /// Hidden source ranges (zero-width replacements): sorted,
    /// non-overlapping, each within one source line.
    pub hidden: Vec<Range<usize>>,
    /// Ranges the caret may not rest strictly inside (CodeMirror atomicRanges).
    pub atomic: Vec<Range<usize>>,
    /// Source shown as other text (an entity as its character, a shortcode
    /// as its emoji): sorted, non-overlapping, each within one source line,
    /// never overlapping a hidden range.
    pub replaced: Vec<(Range<usize>, SharedString)>,
    /// Text set as `<sup>` / `<sub>` (sorted by start).
    pub superscripts: Vec<Superscript>,
    pub surface: Surface,
}

/// Text set as `<sup>` or `<sub>`: at its own size and colour, its baseline
/// shifted (`vertical-align: super` / `sub`). One shaped run has one size,
/// so the leaf keeps the text's room, transparent, and the renderer paints
/// it.
#[derive(Clone, Debug, PartialEq)]
pub struct Superscript {
    pub range: Range<usize>,
    pub text: SharedString,
    /// `None`: `font-size: smaller` (the line's size ÷ 1.2).
    pub size: Option<f32>,
    /// `None`: the line's colour.
    pub color: Option<gpui::Rgba>,
    /// `vertical-align: sub` rather than `super`.
    pub lower: bool,
}

impl Decorations {
    /// Marks intersecting `range`.
    pub fn marks_in(&self, range: &Range<usize>) -> &[Mark] {
        let first = self.marks.partition_point(|m| m.range.end <= range.start);
        let last = self
            .marks
            .partition_point(|m| m.range.start < range.end)
            .max(first);
        &self.marks[first..last]
    }

    /// Hidden ranges touching `range` (empty ranges at its edges included).
    /// Replacements touching `range`.
    pub fn replaced_in(&self, range: &Range<usize>) -> &[(Range<usize>, SharedString)] {
        let first = self.replaced.partition_point(|(r, _)| r.end <= range.start);
        let last = self
            .replaced
            .partition_point(|(r, _)| r.start < range.end)
            .max(first);
        &self.replaced[first..last]
    }
    pub fn hidden_in(&self, range: &Range<usize>) -> &[Range<usize>] {
        let first = self.hidden.partition_point(|r| r.end < range.start);
        let last = self
            .hidden
            .partition_point(|r| r.start <= range.end)
            .max(first);
        &self.hidden[first..last]
    }
}
