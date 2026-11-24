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

/// An element drawn over an inline image's room instead of its image (an
/// audio player in a sentence): the owning view, the room's width and
/// height.
pub type DrawElement = Rc<
    dyn Fn(
        &gpui::WeakEntity<super::editor::EditorView>,
        f32,
        f32,
        &mut gpui::Window,
        &mut gpui::App,
    ) -> gpui::AnyElement,
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
    /// Drawn in the image's room instead of the image, when set; `draw`
    /// still gives the room's size and baseline.
    pub element: Option<DrawElement>,
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
    /// Block widget IDs unmounted by this splice so `EditorView` can evict
    /// their [`super::widget::WidgetStateStore`] entries in `O(|removed|)`.
    pub removed_widget_ids: Vec<BlockId>,
}

/// Deferred byte-offset shift applied lazily to untouched suffix slices of
/// `marks`, `hidden`, `atomic`, `inline_widgets`, `underlines`, and
/// `Block::Widget` anchors so incremental typing and IME stay
/// `O(log N + |window|)` regardless of document length (`TA-13`, `TA-81`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DeferredByteShift {
    pub delta: isize,
    pub marks_split: usize,
    pub hidden_split: usize,
    pub atomic_split: usize,
    pub inline_widgets_split: usize,
    pub underlines_split: usize,
    pub blocks_split: usize,
    pub blocks_delta: isize,
    pub blocks_revision: u64,
}

impl DeferredByteShift {
    pub fn is_empty(&self) -> bool {
        self.delta == 0 && self.blocks_delta == 0
    }
}

pub fn next_decorations_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

#[inline]
fn shift_usize(v: usize, delta: isize) -> usize {
    (v as isize + delta) as usize
}

#[inline]
fn shift_range_signed(r: &Range<usize>, delta: isize) -> Range<usize> {
    shift_usize(r.start, delta)..shift_usize(r.end, delta)
}

#[inline]
fn shift_inline_widget_in_place(w: &mut InlineWidget, delta: isize) {
    w.range = shift_range_signed(&w.range, delta);
    match &mut w.kind {
        InlineWidgetKind::Text(_) => {}
        InlineWidgetKind::Superscript { sup, .. } => sup.range = w.range.clone(),
        InlineWidgetKind::Image { image, .. } => image.range = w.range.clone(),
    }
}

#[inline]
fn shift_inline_widget_owned(w: &InlineWidget, delta: isize) -> InlineWidget {
    let mut out = w.clone();
    shift_inline_widget_in_place(&mut out, delta);
    out
}

#[inline]
fn logical_pos(v: usize, idx: usize, split: usize, delta: isize) -> i128 {
    if idx < split {
        v as i128
    } else {
        v as i128 + delta as i128
    }
}

#[inline]
fn partition_index(len: usize, mut pred: impl FnMut(usize) -> bool) -> usize {
    let mut lo = 0usize;
    let mut hi = len;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if pred(mid) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
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
    /// Deferred suffix byte shift for `O(log N + |window|)` incremental splices.
    pub deferred: DeferredByteShift,
    /// Lowest block index at/after which all `Block::Widget`s are already
    /// wrapped for lazy re-materialisation (`usize::MAX` when none wrapped).
    pub lazy_wrapped_from: usize,
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
            deferred: DeferredByteShift::default(),
            lazy_wrapped_from: usize::MAX,
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
            deferred: self.deferred.clone(),
            lazy_wrapped_from: self.lazy_wrapped_from,
        }
    }
}

fn map_range(range: &Range<usize>, changes: &ChangeSet, doc: &Buffer) -> Option<Range<usize>> {
    let start = doc.clamp(changes.map(range.start, Assoc::After));
    let end = doc.clamp(changes.map(range.end, Assoc::Before)).max(start);
    (start < end || range.is_empty()).then_some(start..end)
}

impl Decorations {
    pub fn has_deferred_shift(&self) -> bool {
        !self.deferred.is_empty()
    }

    /// Materialise deferred byte shifts on inline decoration vectors (`marks`,
    /// `hidden`, `atomic`, `inline_widgets`, `underlines`) in place.
    pub fn materialize_inline_vectors(&mut self) {
        let delta = self.deferred.delta;
        if delta == 0 {
            self.deferred.marks_split = self.marks.len();
            self.deferred.hidden_split = self.hidden.len();
            self.deferred.atomic_split = self.atomic.len();
            self.deferred.inline_widgets_split = self.inline_widgets.len();
            self.deferred.underlines_split = self.underlines.len();
            return;
        }
        let ms = self.deferred.marks_split.min(self.marks.len());
        for m in &mut self.marks[ms..] {
            m.range = shift_range_signed(&m.range, delta);
        }
        let hs = self.deferred.hidden_split.min(self.hidden.len());
        for r in &mut self.hidden[hs..] {
            *r = shift_range_signed(r, delta);
        }
        let ats = self.deferred.atomic_split.min(self.atomic.len());
        for r in &mut self.atomic[ats..] {
            *r = shift_range_signed(r, delta);
        }
        let iws = self
            .deferred
            .inline_widgets_split
            .min(self.inline_widgets.len());
        for w in &mut self.inline_widgets[iws..] {
            shift_inline_widget_in_place(w, delta);
        }
        let us = self.deferred.underlines_split.min(self.underlines.len());
        for u in &mut self.underlines[us..] {
            u.range = shift_range_signed(&u.range, delta);
        }
        self.deferred.delta = 0;
        self.deferred.marks_split = self.marks.len();
        self.deferred.hidden_split = self.hidden.len();
        self.deferred.atomic_split = self.atomic.len();
        self.deferred.inline_widgets_split = self.inline_widgets.len();
        self.deferred.underlines_split = self.underlines.len();
    }

    /// Materialise deferred byte shifts on `Block::Widget` anchors in place.
    pub fn materialize_block_anchors(&mut self) {
        let delta = self.deferred.blocks_delta;
        if delta != 0 {
            let bs = self.deferred.blocks_split.min(self.blocks.len());
            let rev = self.deferred.blocks_revision;
            for b in &mut self.blocks[bs..] {
                if let Block::Widget { id, .. } = b {
                    id.shift(delta, rev);
                }
            }
        }
        self.deferred.blocks_delta = 0;
        self.deferred.blocks_split = self.blocks.len();
    }

    /// Materialise all deferred byte shifts so raw vector fields carry exact
    /// document byte offsets.
    pub fn materialize(&mut self) {
        self.materialize_inline_vectors();
        self.materialize_block_anchors();
    }

    /// Marks intersecting `range` (when no deferred shift applies).
    pub fn marks_in(&self, range: &Range<usize>) -> &[Mark] {
        debug_assert_eq!(self.deferred.delta, 0);
        let first = self.marks.partition_point(|m| m.range.end <= range.start);
        let last = self
            .marks
            .partition_point(|m| m.range.start < range.end)
            .max(first);
        &self.marks[first..last]
    }

    /// Shift-aware marks intersecting `range` (`O(log N + |window|)`).
    pub fn marks_in_cow(&self, range: &Range<usize>) -> Cow<'_, [Mark]> {
        let delta = self.deferred.delta;
        if delta == 0 {
            return Cow::Borrowed(self.marks_in(range));
        }
        let split = self.deferred.marks_split.min(self.marks.len());
        let rs = range.start as i128;
        let re = range.end as i128;
        let first = partition_index(self.marks.len(), |i| {
            logical_pos(self.marks[i].range.end, i, split, delta) <= rs
        });
        let last = partition_index(self.marks.len(), |i| {
            logical_pos(self.marks[i].range.start, i, split, delta) < re
        })
        .max(first);
        if last <= split {
            return Cow::Borrowed(&self.marks[first..last]);
        }
        let out = (first..last)
            .map(|i| {
                let m = &self.marks[i];
                if i < split {
                    m.clone()
                } else {
                    Mark {
                        range: shift_range_signed(&m.range, delta),
                        style: m.style.clone(),
                    }
                }
            })
            .collect();
        Cow::Owned(out)
    }

    /// Inline widgets intersecting `range` (when no deferred shift applies).
    pub fn inline_widgets_in(&self, range: &Range<usize>) -> &[InlineWidget] {
        debug_assert_eq!(self.deferred.delta, 0);
        let first = self
            .inline_widgets
            .partition_point(|w| w.range.end <= range.start);
        let last = self
            .inline_widgets
            .partition_point(|w| w.range.start < range.end)
            .max(first);
        &self.inline_widgets[first..last]
    }

    /// Shift-aware inline widgets intersecting `range` (`O(log N + |window|)`).
    pub fn inline_widgets_in_cow(&self, range: &Range<usize>) -> Cow<'_, [InlineWidget]> {
        let delta = self.deferred.delta;
        if delta == 0 {
            return Cow::Borrowed(self.inline_widgets_in(range));
        }
        let split = self
            .deferred
            .inline_widgets_split
            .min(self.inline_widgets.len());
        let rs = range.start as i128;
        let re = range.end as i128;
        let first = partition_index(self.inline_widgets.len(), |i| {
            logical_pos(self.inline_widgets[i].range.end, i, split, delta) <= rs
        });
        let last = partition_index(self.inline_widgets.len(), |i| {
            logical_pos(self.inline_widgets[i].range.start, i, split, delta) < re
        })
        .max(first);
        if last <= split {
            return Cow::Borrowed(&self.inline_widgets[first..last]);
        }
        let out = (first..last)
            .map(|i| {
                let w = &self.inline_widgets[i];
                if i < split {
                    w.clone()
                } else {
                    shift_inline_widget_owned(w, delta)
                }
            })
            .collect();
        Cow::Owned(out)
    }

    /// Hidden ranges touching `range` (when no deferred shift applies).
    pub fn hidden_in(&self, range: &Range<usize>) -> &[Range<usize>] {
        debug_assert_eq!(self.deferred.delta, 0);
        let first = self.hidden.partition_point(|r| r.end < range.start);
        let last = self
            .hidden
            .partition_point(|r| r.start <= range.end)
            .max(first);
        &self.hidden[first..last]
    }

    /// Shift-aware hidden ranges touching `range` (`O(log N + |window|)`).
    pub fn hidden_in_cow(&self, range: &Range<usize>) -> Cow<'_, [Range<usize>]> {
        let delta = self.deferred.delta;
        if delta == 0 {
            return Cow::Borrowed(self.hidden_in(range));
        }
        let split = self.deferred.hidden_split.min(self.hidden.len());
        let rs = range.start as i128;
        let re = range.end as i128;
        let first = partition_index(self.hidden.len(), |i| {
            logical_pos(self.hidden[i].end, i, split, delta) < rs
        });
        let last = partition_index(self.hidden.len(), |i| {
            logical_pos(self.hidden[i].start, i, split, delta) <= re
        })
        .max(first);
        if last <= split {
            return Cow::Borrowed(&self.hidden[first..last]);
        }
        let out = (first..last)
            .map(|i| {
                let r = &self.hidden[i];
                if i < split {
                    r.clone()
                } else {
                    shift_range_signed(r, delta)
                }
            })
            .collect();
        Cow::Owned(out)
    }

    /// Underlines intersecting `range` (`TA-13` viewport binary search, unshifted).
    pub fn underlines_in(&self, range: &Range<usize>) -> &[Underline] {
        debug_assert_eq!(self.deferred.delta, 0);
        let first = self
            .underlines
            .partition_point(|u| u.range.end <= range.start);
        let last = self
            .underlines
            .partition_point(|u| u.range.start < range.end)
            .max(first);
        &self.underlines[first..last]
    }

    /// Shift-aware visitor over underlines intersecting `range`.
    pub fn for_each_underline_in(&self, range: &Range<usize>, mut f: impl FnMut(&Underline)) {
        let delta = self.deferred.delta;
        if delta == 0 {
            for u in self.underlines_in(range) {
                f(u);
            }
            return;
        }
        let split = self.deferred.underlines_split.min(self.underlines.len());
        let rs = range.start as i128;
        let re = range.end as i128;
        let first = partition_index(self.underlines.len(), |i| {
            logical_pos(self.underlines[i].range.end, i, split, delta) <= rs
        });
        let last = partition_index(self.underlines.len(), |i| {
            logical_pos(self.underlines[i].range.start, i, split, delta) < re
        })
        .max(first);
        for i in first..last {
            let u = &self.underlines[i];
            if i < split {
                f(u);
            } else {
                let shifted = Underline {
                    range: shift_range_signed(&u.range, delta),
                    ..u.clone()
                };
                f(&shifted);
            }
        }
    }

    /// Binary-search atomic ranges containing `pos` strictly inside (`start < pos < end`).
    pub fn atomic_containing(&self, pos: usize) -> Option<&Range<usize>> {
        debug_assert_eq!(self.deferred.delta, 0);
        let idx = self.atomic.partition_point(|r| r.start < pos);
        let r = self.atomic.get(idx.checked_sub(1)?)?;
        (r.start < pos && pos < r.end).then_some(r)
    }

    /// Shift-aware atomic range containing `pos` strictly inside (`start < pos < end`).
    pub fn atomic_containing_owned(&self, pos: usize) -> Option<Range<usize>> {
        let delta = self.deferred.delta;
        if delta == 0 {
            return self.atomic_containing(pos).cloned();
        }
        let split = self.deferred.atomic_split.min(self.atomic.len());
        let pos_i = pos as i128;
        let idx = partition_index(self.atomic.len(), |i| {
            logical_pos(self.atomic[i].start, i, split, delta) < pos_i
        });
        let prev = idx.checked_sub(1)?;
        let r = if prev < split {
            self.atomic[prev].clone()
        } else {
            shift_range_signed(&self.atomic[prev], delta)
        };
        (r.start < pos && pos < r.end).then_some(r)
    }

    /// Translate decorations across `changes` onto `doc` (`TA-11`, `TA-12`,
    /// `TA-31` optimistic shift while async background syntax parses).
    pub fn map(&self, changes: &ChangeSet, doc: &Buffer, new_revision: u64) -> Self {
        if self.has_deferred_shift() {
            let mut materialized = self.clone();
            materialized.materialize();
            return materialized.map(changes, doc, new_revision);
        }
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
            deferred: DeferredByteShift::default(),
            lazy_wrapped_from: usize::MAX,
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
            return self.doc.marks_in_cow(range);
        }
        let overlaps = self
            .reveal
            .patches
            .iter()
            .any(|p| p.byte_range.start < range.end && p.byte_range.end > range.start);
        if !overlaps {
            return self.doc.marks_in_cow(range);
        }
        let mut out: Vec<Mark> =
            self.doc
                .marks_in_cow(range)
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
            return self.doc.hidden_in_cow(range);
        }
        let overlaps = self
            .reveal
            .patches
            .iter()
            .any(|p| p.byte_range.start <= range.end && p.byte_range.end >= range.start);
        if !overlaps {
            return self.doc.hidden_in_cow(range);
        }
        let mut out: Vec<Range<usize>> = self
            .doc
            .hidden_in_cow(range)
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
            return self.doc.inline_widgets_in_cow(range);
        }
        let overlaps = self
            .reveal
            .patches
            .iter()
            .any(|p| p.byte_range.start < range.end && p.byte_range.end > range.start);
        if !overlaps {
            return self.doc.inline_widgets_in_cow(range);
        }
        let mut out: Vec<InlineWidget> =
            self.doc
                .inline_widgets_in_cow(range)
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
            self.doc.for_each_underline_in(range, f);
            return;
        }
        self.doc.for_each_underline_in(range, |u| {
            let overridden = self
                .reveal
                .patches
                .iter()
                .any(|p| u.range.start < p.byte_range.end && u.range.end > p.byte_range.start);
            if !overridden {
                f(u);
            }
        });
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
        self.doc.atomic_containing_owned(pos)
    }

    /// Materialise a flat `Cow<Decorations>` (zero-cost borrow when `reveal` is
    /// empty and no deferred shift is pending; merged materialized copy
    /// otherwise for tests and legacy callers).
    pub fn as_decorations(&self) -> Cow<'_, Decorations> {
        if self.reveal.is_empty() {
            if !self.doc.has_deferred_shift() {
                return Cow::Borrowed(&self.doc);
            }
            let mut owned = (*self.doc).clone();
            owned.materialize();
            owned.splice = None;
            return Cow::Owned(owned);
        }
        let full = 0..usize::MAX;
        let mut underlines = Vec::new();
        self.for_each_underline_in(&full, |u| underlines.push(u.clone()));
        let delta = self.doc.deferred.delta;
        let atomic_split = self.doc.deferred.atomic_split.min(self.doc.atomic.len());
        let mut atomic: Vec<Range<usize>> = self
            .doc
            .atomic
            .iter()
            .enumerate()
            .map(|(i, r)| {
                if delta == 0 || i < atomic_split {
                    r.clone()
                } else {
                    shift_range_signed(r, delta)
                }
            })
            .filter(|r| {
                !self
                    .reveal
                    .patches
                    .iter()
                    .any(|p| r.start < p.byte_range.end && r.end > p.byte_range.start)
            })
            .collect();
        for p in &self.reveal.patches {
            atomic.extend(p.atomic.iter().cloned());
        }
        atomic.sort_by_key(|r| (r.start, r.end));
        let mut blocks: Vec<Block> = (0..self.block_len())
            .map(|i| self.block(i).clone())
            .collect();
        if self.doc.deferred.blocks_delta != 0 {
            let b_delta = self.doc.deferred.blocks_delta;
            let b_rev = self.doc.deferred.blocks_revision;
            let b_split = self.doc.deferred.blocks_split;
            for (eff_idx, block) in blocks.iter_mut().enumerate() {
                // Only shift doc-layer widgets originating at/after `blocks_split`.
                let mut is_patch = false;
                let mut delta_idx: isize = 0;
                for span in &self.spans {
                    if eff_idx < span.effective_range.start {
                        break;
                    }
                    if eff_idx < span.effective_range.end {
                        is_patch = true;
                        break;
                    }
                    delta_idx +=
                        span.effective_range.len() as isize - span.doc_blocks.len() as isize;
                }
                if !is_patch {
                    let doc_idx = (eff_idx as isize - delta_idx) as usize;
                    if doc_idx >= b_split
                        && let Block::Widget { id, .. } = block
                    {
                        id.shift(b_delta, b_rev);
                    }
                }
            }
        }
        Cow::Owned(Decorations {
            id: next_decorations_id(),
            blocks,
            marks: self.marks_in(&full).into_owned(),
            hidden: self.hidden_in(&full).into_owned(),
            atomic,
            inline_widgets: self.inline_widgets_in(&full).into_owned(),
            underlines,
            surface: self.doc.surface.clone(),
            splice: None,
            deferred: DeferredByteShift::default(),
            lazy_wrapped_from: usize::MAX,
        })
    }
}
