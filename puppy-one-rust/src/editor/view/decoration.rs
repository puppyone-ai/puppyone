//! What an editor extension (Markdown, CSV source, plain text) asks the view
//! to render, mirroring CodeMirror decorations: a block per source line (or a
//! widget replacing several lines), inline marks, hidden source ranges,
//! first-class inline widgets (`TA-12`), and atomic ranges. The view never
//! interprets document syntax.
//!
//! Decorations are split into two pure layers (`TA-11`):
//! - **Document Layer** ([`Decorations`]): depends only on document revision,
//!   appearance, and extension configuration; never on cursor or focus.
//! - **Reveal Layer** ([`RevealLayer`]): overrides only the tiny set of lines
//!   intersecting active cursor reveal / IME / revealed-source ranges.
use super::{
    style::LineStyle,
    widget::{BlockId, BlockWidget},
};
use crate::editor::text::{
    buffer::Buffer,
    change::{Assoc, ChangeSet},
};
use gpui::{Rgba, SharedString};
use std::{borrow::Cow, ops::Range, rc::Rc};

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
    /// Consecutive source lines replaced by a block widget with stable
    /// [`BlockId`] identity (`TA-14`).
    Widget {
        id: BlockId,
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
    /// `--po-md-inline-code-background` / `-padding` (one side); `None`
    /// keeps Kit's (no background, 4px).
    pub inline_code_background: Option<Rgba>,
    pub inline_code_padding: Option<f32>,
    /// Kit underlines links unless told not to.
    pub link_plain: bool,
}

/// `text-decoration` in a dotted or dashed style: 1px segments `dash` long,
/// `gap` apart, `text-underline-offset: 2px` under the baseline of text
/// `size` tall.
#[derive(Clone, Debug, PartialEq)]
pub struct Underline {
    pub range: Range<usize>,
    pub color: Rgba,
    pub dash: f32,
    pub gap: f32,
    pub size: f32,
}

/// The image for a line: its background (a formula is drawn on it), the
/// line's width and font size. `None` while it is not ready.
pub type DrawInline = Rc<
    dyn Fn(
        Option<Rgba>,
        f32,
        f32,
        &mut gpui::Window,
        &mut gpui::App,
    ) -> Option<crate::render_service::Rendered>,
>;

/// A replaced range drawn as an image in the text flow once it is ready
/// (an inline formula, a picture beside text).
#[derive(Clone)]
pub struct InlineImage {
    pub range: Range<usize>,
    /// Inline padding on each side, in ems of the line's font.
    pub pad: f32,
    /// Corner radius of the drawn image.
    pub radius: f32,
    pub draw: DrawInline,
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
    pub color: Option<Rgba>,
    /// `vertical-align: sub` rather than `super`.
    pub lower: bool,
}

/// Payload of a first-class [`InlineWidget`] (`TA-12`).
#[derive(Clone)]
pub enum InlineWidgetKind {
    /// Source shown as replacement text (an HTML entity, an emoji shortcode).
    Text(SharedString),
    /// Shifted `<sup>` / `<sub>` run (`room_text` reserves space in the shaped
    /// leaf while `sup` paints shifted on top).
    Superscript {
        room_text: SharedString,
        sup: Superscript,
    },
    /// Inline rendered image (e.g. inline KaTeX formula or inline picture),
    /// showing `fallback` until `image.draw` returns `Some`.
    Image {
        fallback: SharedString,
        image: InlineImage,
    },
}

/// Unified first-class inline widget decoration (`TA-12`), sorted by
/// `(range.start, range.end)` and mappable across [`ChangeSet`].
#[derive(Clone)]
pub struct InlineWidget {
    pub range: Range<usize>,
    pub kind: InlineWidgetKind,
}

impl InlineWidget {
    pub fn text(range: Range<usize>, text: impl Into<SharedString>) -> Self {
        Self {
            range,
            kind: InlineWidgetKind::Text(text.into()),
        }
    }

    pub fn superscript(
        range: Range<usize>,
        room_text: impl Into<SharedString>,
        sup: Superscript,
    ) -> Self {
        Self {
            range,
            kind: InlineWidgetKind::Superscript {
                room_text: room_text.into(),
                sup,
            },
        }
    }

    pub fn image(
        range: Range<usize>,
        fallback: impl Into<SharedString>,
        image: InlineImage,
    ) -> Self {
        Self {
            range,
            kind: InlineWidgetKind::Image {
                fallback: fallback.into(),
                image,
            },
        }
    }

    /// Text placed into the shaped `LeafText` for this inline widget before any
    /// ready image room overrides it.
    pub fn display_text(&self) -> &SharedString {
        match &self.kind {
            InlineWidgetKind::Text(text) => text,
            InlineWidgetKind::Superscript { room_text, .. } => room_text,
            InlineWidgetKind::Image { fallback, .. } => fallback,
        }
    }

    pub fn as_text(&self) -> Option<&SharedString> {
        match &self.kind {
            InlineWidgetKind::Text(text) => Some(text),
            _ => None,
        }
    }

    pub fn replaces_text(&self) -> bool {
        match &self.kind {
            InlineWidgetKind::Text(_) | InlineWidgetKind::Image { .. } => true,
            InlineWidgetKind::Superscript { sup, .. } => sup.size.is_some(),
        }
    }

    pub fn as_superscript(&self) -> Option<&Superscript> {
        match &self.kind {
            InlineWidgetKind::Superscript { sup, .. } => Some(sup),
            _ => None,
        }
    }

    pub fn as_image(&self) -> Option<(&SharedString, &InlineImage)> {
        match &self.kind {
            InlineWidgetKind::Image { fallback, image } => Some((fallback, image)),
            _ => None,
        }
    }
}

/// Records which slice of `blocks` was incrementally spliced from a prior
/// [`Decorations`] instance so [`super::heights::HeightMap`] updates in
/// `O(|touched|)` without scanning untouched blocks (`TA-13`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockSplice {
    pub base_ptr: usize,
    pub old_blocks: Range<usize>,
    pub new_blocks: Range<usize>,
}

pub fn next_decorations_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

pub struct Decorations {
    /// Monotonic identity token preventing ABA pointer-reuse collisions in `HeightMap`.
    pub id: u64,
    /// In source order, covering every source line exactly once.
    pub blocks: Vec<Block>,
    /// Sorted by start, non-overlapping.
    pub marks: Vec<Mark>,
    /// Hidden source ranges (zero-width replacements): sorted,
    /// non-overlapping, each within one source line.
    pub hidden: Vec<Range<usize>>,
    /// Ranges the caret may not rest strictly inside (CodeMirror atomicRanges),
    /// sorted by start.
    pub atomic: Vec<Range<usize>>,
    /// Unified first-class inline widgets (`TA-12`), sorted by
    /// `(range.start, range.end)`.
    pub inline_widgets: Vec<InlineWidget>,
    /// Dotted or dashed lines under text, which Kit marks cannot draw
    /// (sorted by start).
    pub underlines: Vec<Underline>,
    pub surface: Surface,
    /// Optional incremental splice descriptor for `HeightMap`.
    pub splice: Option<BlockSplice>,
}

impl Default for Decorations {
    fn default() -> Self {
        Self {
            id: next_decorations_id(),
            blocks: Vec::new(),
            marks: Vec::new(),
            hidden: Vec::new(),
            atomic: Vec::new(),
            inline_widgets: Vec::new(),
            underlines: Vec::new(),
            surface: Surface::default(),
            splice: None,
        }
    }
}

impl Clone for Decorations {
    fn clone(&self) -> Self {
        Self {
            id: next_decorations_id(),
            blocks: self.blocks.clone(),
            marks: self.marks.clone(),
            hidden: self.hidden.clone(),
            atomic: self.atomic.clone(),
            inline_widgets: self.inline_widgets.clone(),
            underlines: self.underlines.clone(),
            surface: self.surface.clone(),
            splice: self.splice.clone(),
        }
    }
}

fn map_range(range: &Range<usize>, changes: &ChangeSet, doc: &Buffer) -> Option<Range<usize>> {
    let start = doc.clamp(changes.map(range.start, Assoc::After));
    let end = doc.clamp(changes.map(range.end, Assoc::Before)).max(start);
    (start < end || range.is_empty()).then_some(start..end)
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

    /// Inline widgets intersecting `range`.
    pub fn inline_widgets_in(&self, range: &Range<usize>) -> &[InlineWidget] {
        let first = self
            .inline_widgets
            .partition_point(|w| w.range.end <= range.start);
        let last = self
            .inline_widgets
            .partition_point(|w| w.range.start < range.end)
            .max(first);
        &self.inline_widgets[first..last]
    }

    /// Hidden ranges touching `range` (empty ranges at its edges included).
    pub fn hidden_in(&self, range: &Range<usize>) -> &[Range<usize>] {
        let first = self.hidden.partition_point(|r| r.end < range.start);
        let last = self
            .hidden
            .partition_point(|r| r.start <= range.end)
            .max(first);
        &self.hidden[first..last]
    }

    /// Underlines intersecting `range` (`TA-13` viewport binary search).
    pub fn underlines_in(&self, range: &Range<usize>) -> &[Underline] {
        let first = self
            .underlines
            .partition_point(|u| u.range.end <= range.start);
        let last = self
            .underlines
            .partition_point(|u| u.range.start < range.end)
            .max(first);
        &self.underlines[first..last]
    }

    /// Binary-search atomic ranges containing `pos` strictly inside (`start < pos < end`).
    pub fn atomic_containing(&self, pos: usize) -> Option<&Range<usize>> {
        let idx = self.atomic.partition_point(|r| r.start < pos);
        let r = self.atomic.get(idx.checked_sub(1)?)?;
        (r.start < pos && pos < r.end).then_some(r)
    }

    /// Translate decorations across `changes` onto `doc` (`TA-11`, `TA-12`,
    /// `TA-31` optimistic shift while async background syntax parses).
    pub fn map(&self, changes: &ChangeSet, doc: &Buffer, new_revision: u64) -> Self {
        let line_count = doc.line_count();
        let plain_style = self
            .blocks
            .iter()
            .find_map(|b| match b {
                Block::Line { style, .. } => Some(style.clone()),
                _ => None,
            })
            .unwrap_or_else(|| Rc::new(LineStyle::default()));

        let mut blocks = Vec::with_capacity(line_count);
        let mut covered_until = 0usize;
        for block in &self.blocks {
            match block {
                Block::Line { line, style } => {
                    if *line < line_count && covered_until == *line {
                        blocks.push(Block::Line {
                            line: *line,
                            style: style.clone(),
                        });
                        covered_until = *line + 1;
                    }
                }
                Block::Widget { id, lines, widget } => {
                    let mapped_id = id.mapped(changes, new_revision);
                    let start_line = doc.line_index(mapped_id.resolve(doc));
                    let span = lines.len().max(1);
                    let end_line = (start_line + span).min(line_count);
                    while covered_until < start_line {
                        blocks.push(Block::Line {
                            line: covered_until,
                            style: plain_style.clone(),
                        });
                        covered_until += 1;
                    }
                    if start_line < end_line && covered_until == start_line {
                        blocks.push(Block::Widget {
                            id: mapped_id,
                            lines: start_line..end_line,
                            widget: widget.clone(),
                        });
                        covered_until = end_line;
                    }
                }
            }
        }
        while covered_until < line_count {
            blocks.push(Block::Line {
                line: covered_until,
                style: plain_style.clone(),
            });
            covered_until += 1;
        }

        let marks = self
            .marks
            .iter()
            .filter_map(|m| {
                let range = map_range(&m.range, changes, doc)?;
                (!range.is_empty()).then(|| Mark {
                    range,
                    style: m.style.clone(),
                })
            })
            .collect();
        let hidden = self
            .hidden
            .iter()
            .filter_map(|r| {
                let mapped = map_range(r, changes, doc)?;
                (!mapped.is_empty()).then_some(mapped)
            })
            .collect();
        let atomic = self
            .atomic
            .iter()
            .filter_map(|r| {
                let mapped = map_range(r, changes, doc)?;
                (!mapped.is_empty()).then_some(mapped)
            })
            .collect();
        let inline_widgets = self
            .inline_widgets
            .iter()
            .filter_map(|w| {
                let range = map_range(&w.range, changes, doc)?;
                if range.is_empty() {
                    return None;
                }
                let kind = match &w.kind {
                    InlineWidgetKind::Text(t) => InlineWidgetKind::Text(t.clone()),
                    InlineWidgetKind::Superscript { room_text, sup } => {
                        let mut sup = sup.clone();
                        sup.range = range.clone();
                        InlineWidgetKind::Superscript {
                            room_text: room_text.clone(),
                            sup,
                        }
                    }
                    InlineWidgetKind::Image { fallback, image } => {
                        let mut image = image.clone();
                        image.range = range.clone();
                        InlineWidgetKind::Image {
                            fallback: fallback.clone(),
                            image,
                        }
                    }
                };
                Some(InlineWidget { range, kind })
            })
            .collect();
        let underlines = self
            .underlines
            .iter()
            .filter_map(|u| {
                let range = map_range(&u.range, changes, doc)?;
                (!range.is_empty()).then(|| Underline { range, ..u.clone() })
            })
            .collect();

        Self {
            id: next_decorations_id(),
            blocks,
            marks,
            hidden,
            atomic,
            inline_widgets,
            underlines,
            surface: self.surface.clone(),
            splice: None,
        }
    }
}

/// Contiguous source-line override produced by the Reveal Layer (`TA-11`).
#[derive(Clone, Default)]
pub struct RevealPatch {
    pub lines: Range<usize>,
    pub byte_range: Range<usize>,
    pub blocks: Vec<Block>,
    pub marks: Vec<Mark>,
    pub hidden: Vec<Range<usize>>,
    pub atomic: Vec<Range<usize>>,
    pub inline_widgets: Vec<InlineWidget>,
    pub underlines: Vec<Underline>,
}

/// Cursor/focus-dependent Reveal Layer (`TA-11`), containing 0..k small
/// non-overlapping [`RevealPatch`]es in ascending source order.
#[derive(Clone, Default)]
pub struct RevealLayer {
    pub patches: Vec<RevealPatch>,
}

impl RevealLayer {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn from_patches(patches: Vec<RevealPatch>) -> Self {
        Self { patches }
    }

    pub fn is_empty(&self) -> bool {
        self.patches.is_empty()
    }

    pub fn patch_overlapping_bytes(&self, range: &Range<usize>) -> Option<&RevealPatch> {
        let i = self
            .patches
            .partition_point(|p| p.byte_range.end < range.start);
        let patch = self.patches.get(i)?;
        (patch.byte_range.start <= range.end && patch.byte_range.end >= range.start)
            .then_some(patch)
    }
}

/// Maps one [`RevealPatch`] onto the replaced index slice of `doc.blocks` in
/// `O(log N)` without cloning untouched document blocks (`TA-11`, `TA-13`).
#[derive(Clone, Debug)]
pub struct BlockPatchSpan {
    pub doc_blocks: Range<usize>,
    pub effective_range: Range<usize>,
    pub patch_idx: usize,
}

/// Effective decoration view combining the `Rc`-shared Document Layer and
/// `Rc`-shared Reveal Layer (`TA-11`) in `O(|patches| log N)` without cloning
/// the document's blocks on cursor motion.
#[derive(Clone, Default)]
pub struct LayeredDecorations {
    pub doc: Rc<Decorations>,
    pub reveal: Rc<RevealLayer>,
    spans: Vec<BlockPatchSpan>,
    effective_len: usize,
}

impl LayeredDecorations {
    pub fn new(doc: Rc<Decorations>, reveal: Rc<RevealLayer>) -> Self {
        if reveal.is_empty() {
            let effective_len = doc.blocks.len();
            return Self {
                doc,
                reveal,
                spans: Vec::new(),
                effective_len,
            };
        }
        let mut spans = Vec::with_capacity(reveal.patches.len());
        let mut doc_cursor = 0usize;
        let mut eff_cursor = 0usize;
        for (patch_idx, patch) in reveal.patches.iter().enumerate() {
            let start = doc.blocks[doc_cursor..]
                .partition_point(|b| b.lines().end <= patch.lines.start)
                + doc_cursor;
            let end =
                doc.blocks[start..].partition_point(|b| b.lines().start < patch.lines.end) + start;
            eff_cursor += start - doc_cursor;
            let eff_end = eff_cursor + patch.blocks.len();
            spans.push(BlockPatchSpan {
                doc_blocks: start..end,
                effective_range: eff_cursor..eff_end,
                patch_idx,
            });
            doc_cursor = end;
            eff_cursor = eff_end;
        }
        eff_cursor += doc.blocks.len() - doc_cursor;
        Self {
            doc,
            reveal,
            spans,
            effective_len: eff_cursor,
        }
    }

    pub fn surface(&self) -> &Surface {
        &self.doc.surface
    }

    pub fn block_len(&self) -> usize {
        self.effective_len
    }

    pub fn patch_spans(&self) -> &[BlockPatchSpan] {
        &self.spans
    }

    /// Resolve block `index` in `O(|patches|)` (typically `0..=3` comparisons)
    /// without allocating or cloning `doc.blocks`.
    pub fn block(&self, index: usize) -> &Block {
        if self.spans.is_empty() {
            return &self.doc.blocks[index];
        }
        let mut delta: isize = 0;
        for span in &self.spans {
            if index < span.effective_range.start {
                let doc_idx = (index as isize - delta) as usize;
                return &self.doc.blocks[doc_idx];
            }
            if index < span.effective_range.end {
                let local = index - span.effective_range.start;
                return &self.reveal.patches[span.patch_idx].blocks[local];
            }
            delta += span.effective_range.len() as isize - span.doc_blocks.len() as isize;
        }
        let doc_idx = (index as isize - delta) as usize;
        &self.doc.blocks[doc_idx]
    }

    /// Binary-search the effective block containing source `line` in `O(log N)`.
    pub fn block_index_for_line(&self, line: usize) -> usize {
        let mut lo = 0usize;
        let mut hi = self.effective_len;
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.block(mid).lines().end <= line {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }

    pub fn marks_in<'a>(&'a self, range: &Range<usize>) -> Cow<'a, [Mark]> {
        if self.reveal.is_empty() {
            return Cow::Borrowed(self.doc.marks_in(range));
        }
        let overlaps = self
            .reveal
            .patches
            .iter()
            .any(|p| p.byte_range.start < range.end && p.byte_range.end > range.start);
        if !overlaps {
            return Cow::Borrowed(self.doc.marks_in(range));
        }
        let mut out: Vec<Mark> =
            self.doc
                .marks_in(range)
                .iter()
                .filter(|m| {
                    !self.reveal.patches.iter().any(|p| {
                        m.range.start < p.byte_range.end && m.range.end > p.byte_range.start
                    })
                })
                .cloned()
                .collect();
        for p in &self.reveal.patches {
            if p.byte_range.start < range.end && p.byte_range.end > range.start {
                out.extend(
                    p.marks
                        .iter()
                        .filter(|m| m.range.end > range.start && m.range.start < range.end)
                        .cloned(),
                );
            }
        }
        out.sort_by_key(|m| (m.range.start, m.range.end));
        Cow::Owned(out)
    }

    pub fn hidden_in<'a>(&'a self, range: &Range<usize>) -> Cow<'a, [Range<usize>]> {
        if self.reveal.is_empty() {
            return Cow::Borrowed(self.doc.hidden_in(range));
        }
        let overlaps = self
            .reveal
            .patches
            .iter()
            .any(|p| p.byte_range.start <= range.end && p.byte_range.end >= range.start);
        if !overlaps {
            return Cow::Borrowed(self.doc.hidden_in(range));
        }
        let mut out: Vec<Range<usize>> = self
            .doc
            .hidden_in(range)
            .iter()
            .filter(|r| {
                !self
                    .reveal
                    .patches
                    .iter()
                    .any(|p| r.start <= p.byte_range.end && r.end >= p.byte_range.start)
            })
            .cloned()
            .collect();
        for p in &self.reveal.patches {
            if p.byte_range.start <= range.end && p.byte_range.end >= range.start {
                out.extend(
                    p.hidden
                        .iter()
                        .filter(|r| r.end >= range.start && r.start <= range.end)
                        .cloned(),
                );
            }
        }
        out.sort_by_key(|r| (r.start, r.end));
        Cow::Owned(out)
    }

    pub fn inline_widgets_in<'a>(&'a self, range: &Range<usize>) -> Cow<'a, [InlineWidget]> {
        if self.reveal.is_empty() {
            return Cow::Borrowed(self.doc.inline_widgets_in(range));
        }
        let overlaps = self
            .reveal
            .patches
            .iter()
            .any(|p| p.byte_range.start < range.end && p.byte_range.end > range.start);
        if !overlaps {
            return Cow::Borrowed(self.doc.inline_widgets_in(range));
        }
        let mut out: Vec<InlineWidget> =
            self.doc
                .inline_widgets_in(range)
                .iter()
                .filter(|w| {
                    !self.reveal.patches.iter().any(|p| {
                        w.range.start < p.byte_range.end && w.range.end > p.byte_range.start
                    })
                })
                .cloned()
                .collect();
        for p in &self.reveal.patches {
            if p.byte_range.start < range.end && p.byte_range.end > range.start {
                out.extend(
                    p.inline_widgets
                        .iter()
                        .filter(|w| w.range.end > range.start && w.range.start < range.end)
                        .cloned(),
                );
            }
        }
        out.sort_by_key(|w| (w.range.start, w.range.end));
        Cow::Owned(out)
    }

    pub fn for_each_underline_in(&self, range: &Range<usize>, mut f: impl FnMut(&Underline)) {
        if self.reveal.is_empty() {
            for u in self.doc.underlines_in(range) {
                f(u);
            }
            return;
        }
        for u in self.doc.underlines_in(range) {
            let overridden = self
                .reveal
                .patches
                .iter()
                .any(|p| u.range.start < p.byte_range.end && u.range.end > p.byte_range.start);
            if !overridden {
                f(u);
            }
        }
        for p in &self.reveal.patches {
            if p.byte_range.start < range.end && p.byte_range.end > range.start {
                for u in &p.underlines {
                    if u.range.end > range.start && u.range.start < range.end {
                        f(u);
                    }
                }
            }
        }
    }

    pub fn atomic_containing(&self, pos: usize) -> Option<Range<usize>> {
        if !self.reveal.is_empty() {
            for p in &self.reveal.patches {
                if p.byte_range.start <= pos && pos <= p.byte_range.end {
                    return p
                        .atomic
                        .iter()
                        .find(|r| r.start < pos && pos < r.end)
                        .cloned();
                }
            }
        }
        self.doc.atomic_containing(pos).cloned()
    }

    /// Materialise a flat `Cow<Decorations>` (zero-cost borrow when `reveal` is
    /// empty, merged copy for tests inspecting revealed ranges).
    pub fn as_decorations(&self) -> Cow<'_, Decorations> {
        if self.reveal.is_empty() {
            return Cow::Borrowed(&self.doc);
        }
        let full = 0..usize::MAX;
        let mut underlines = Vec::new();
        self.for_each_underline_in(&full, |u| underlines.push(u.clone()));
        let mut atomic: Vec<Range<usize>> = self
            .doc
            .atomic
            .iter()
            .filter(|r| {
                !self
                    .reveal
                    .patches
                    .iter()
                    .any(|p| r.start < p.byte_range.end && r.end > p.byte_range.start)
            })
            .cloned()
            .collect();
        for p in &self.reveal.patches {
            atomic.extend(p.atomic.iter().cloned());
        }
        atomic.sort_by_key(|r| (r.start, r.end));
        Cow::Owned(Decorations {
            id: next_decorations_id(),
            blocks: (0..self.block_len())
                .map(|i| self.block(i).clone())
                .collect(),
            marks: self.marks_in(&full).into_owned(),
            hidden: self.hidden_in(&full).into_owned(),
            atomic,
            inline_widgets: self.inline_widgets_in(&full).into_owned(),
            underlines,
            surface: self.doc.surface.clone(),
            splice: None,
        })
    }
}
