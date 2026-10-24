//! Document geometry of the last frame, built from the leaf geometry GPUI
//! Kit reports (`collect_leaf_geometry`): caret rectangles, hit testing,
//! visual rows and line-break selection boxes. Coordinates are window pixels
//! of the frame that produced them; `scroll` records that frame's offset so
//! later pointer events can be mapped after a scroll.
use super::render::LeafEntry;
use gpui::{Bounds, Pixels, Point, point, px};
use gpui_kit::base::text::editor_host::LeafGeometry;
use std::ops::Range;

pub struct Leaf {
    pub entry: LeafEntry,
    pub geometry: LeafGeometry,
}

impl Leaf {
    pub fn source(&self) -> &Range<usize> {
        &self.entry.text.source
    }
    fn display(&self, offset: usize) -> usize {
        let s = self.source();
        self.entry.text.to_display(offset.clamp(s.start, s.end) - s.start, false)
    }
    fn next_char(&self, index: usize) -> Option<usize> {
        let text = &self.entry.text.text;
        text[index..].chars().next().map(|c| index + c.len_utf8())
    }
    /// The display index ends a soft-wrapped row (GPUI puts a boundary index
    /// on the earlier row).
    fn wraps_after(&self, index: usize) -> bool {
        let Some(next) = self.next_char(index) else { return false };
        self.geometry.position_for_index(next).y > self.geometry.position_for_index(index).y
    }
    /// Row top-left of a display index; `upstream` keeps a wrap boundary on
    /// the earlier row, otherwise it starts the next row.
    pub fn position(&self, index: usize, upstream: bool) -> Point<Pixels> {
        let p = self.geometry.position_for_index(index);
        if !upstream && self.wraps_after(index) {
            let next = self.geometry.position_for_index(self.next_char(index).unwrap());
            return point(self.geometry.bounds().left(), next.y);
        }
        p
    }
}

#[derive(Clone, Debug)]
pub struct BlockGeometry {
    pub bounds: Bounds<Pixels>,
    pub lines: Range<usize>,
    pub source: Range<usize>,
}

/// Where a caret is drawn (window coordinates of the layout frame).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Caret {
    pub x: Pixels,
    /// The row (line box) holding the caret.
    pub row_top: Pixels,
    pub row_height: Pixels,
    /// The caret itself: the font's ascent + descent, centred in the row as
    /// GPUI centres the glyphs.
    pub top: Pixels,
    pub height: Pixels,
}

pub struct DocLayout {
    /// The editor element's bounds.
    pub bounds: Bounds<Pixels>,
    /// The scroll offset the frame was laid out with.
    pub scroll: Pixels,
    /// Height of the whole document including content insets.
    pub height: Pixels,
    /// Sorted by source start.
    pub leaves: Vec<Leaf>,
    pub blocks: Vec<BlockGeometry>,
}

impl DocLayout {
    /// A window point of the current frame in this layout's coordinates.
    pub fn to_layout(&self, p: Point<Pixels>, scroll_now: f32) -> Point<Pixels> {
        point(p.x, p.y + px(scroll_now) - self.scroll)
    }

    fn leaf_of(&self, offset: usize) -> Option<&Leaf> {
        let i = self.leaves.partition_point(|l| l.source().start <= offset);
        let leaf = self.leaves.get(i.checked_sub(1)?)?;
        (offset <= leaf.source().end).then_some(leaf)
    }

    fn block_of(&self, offset: usize) -> Option<&BlockGeometry> {
        let i = self.blocks.partition_point(|b| b.source.start <= offset);
        self.blocks.get(i.saturating_sub(1))
    }

    pub fn caret(&self, offset: usize, upstream: bool) -> Caret {
        let Some(leaf) = self.leaf_of(offset) else {
            // Inside a widget without text there: the block's leading edge.
            let b = self.block_of(offset).map_or(self.bounds, |b| b.bounds);
            let h = b.size.height.min(px(20.));
            return Caret { x: b.left(), row_top: b.top(), row_height: h, top: b.top(), height: h };
        };
        let index = leaf.display(offset);
        let p = leaf.position(index, upstream);
        let row_height = leaf.geometry.line_height();
        let height = leaf.geometry.caret_height();
        Caret { x: p.x, row_top: p.y, row_height, top: p.y + (row_height - height) / 2., height }
    }

    /// The source offset nearest to a layout point, and whether it belongs
    /// to the end of a soft-wrapped row.
    pub fn offset_at(&self, at: Point<Pixels>) -> (usize, bool) {
        let distance = |b: Bounds<Pixels>| {
            let dy = (b.top() - at.y).max(at.y - b.bottom()).max(px(0.));
            let dx = (b.left() - at.x).max(at.x - b.right()).max(px(0.));
            (f32::from(dy), f32::from(dx))
        };
        // The block under the point decides; its nearest leaf maps the point.
        let block = self.blocks.iter().min_by(|a, b| distance(a.bounds).partial_cmp(&distance(b.bounds)).unwrap());
        let candidates = self.leaves.iter().filter(|l| block.is_none_or(|b| b.source.start <= l.source().start && l.source().end <= b.source.end));
        let leaf = candidates.min_by(|a, b| distance(a.geometry.bounds()).partial_cmp(&distance(b.geometry.bounds())).unwrap());
        let Some(leaf) = leaf else {
            return match block {
                Some(b) if at.y < b.bounds.center().y => (b.source.start, false),
                Some(b) => (b.source.end, false),
                None => (0, false),
            };
        };
        let index = leaf.geometry.index_for_position(at).min(leaf.entry.text.text.len());
        let upstream = leaf.wraps_after(index) && at.y < leaf.position(index, false).y;
        (leaf.source().start + leaf.entry.text.to_source(index), upstream)
    }

    /// Start or end of the visual row holding `offset`.
    pub fn row_edge(&self, offset: usize, upstream: bool, end: bool) -> Option<(usize, bool)> {
        let leaf = self.leaf_of(offset)?;
        let index = leaf.display(offset);
        let p = leaf.position(index, upstream);
        let y = p.y + leaf.geometry.line_height() / 2.;
        let b = leaf.geometry.bounds();
        let x = if end { b.right() + px(1.) } else { b.left() - px(1.) };
        let edge = leaf.geometry.index_for_position(point(x, y)).min(leaf.entry.text.text.len());
        let soft = end && leaf.wraps_after(edge);
        Some((leaf.source().start + leaf.entry.text.to_source(edge), soft))
    }

    /// Line-break boxes of a selection: one space wide after the last row of
    /// every leaf whose break the selection covers (browser selection).
    pub fn line_break_boxes(&self, range: Range<usize>, space: impl Fn(&LeafEntry) -> Pixels) -> Vec<Bounds<Pixels>> {
        let mut out = Vec::new();
        if range.is_empty() {
            return out;
        }
        for leaf in &self.leaves {
            let s = leaf.source();
            if !leaf.entry.line_break || s.end < range.start || s.end >= range.end {
                continue;
            }
            let p = leaf.geometry.position_for_index(leaf.entry.text.text.len());
            out.push(Bounds::new(p, gpui::size(space(&leaf.entry), leaf.geometry.line_height())));
        }
        out
    }

    /// Boxes covering a source range's visible text, one per row of each
    /// leaf — what an inline mark's background covers (the text's content
    /// area, not the whole line box).
    pub fn range_boxes(&self, range: Range<usize>) -> Vec<Bounds<Pixels>> {
        let mut out = Vec::new();
        for leaf in &self.leaves {
            let s = leaf.source();
            if s.end <= range.start || s.start >= range.end {
                continue;
            }
            let a = leaf.entry.text.to_display(range.start.max(s.start) - s.start, false);
            let b = leaf.entry.text.to_display(range.end.min(s.end) - s.start, true);
            if a >= b {
                continue;
            }
            let (line, caret) = (leaf.geometry.line_height(), leaf.geometry.caret_height());
            let mut row: Option<(Pixels, Pixels, Pixels)> = None;
            let push = |row: Option<(Pixels, Pixels, Pixels)>, out: &mut Vec<Bounds<Pixels>>| {
                if let Some((y, x0, x1)) = row.filter(|(_, x0, x1)| x1 > x0) {
                    out.push(Bounds::new(point(x0, y + (line - caret) / 2.), gpui::size(x1 - x0, caret)));
                }
            };
            let mut i = a;
            while i < b {
                let next = leaf.next_char(i).unwrap_or(b).min(b);
                let (p0, p1) = (leaf.position(i, false), leaf.position(next, true));
                match &mut row {
                    Some((y, _, x1)) if *y == p0.y => *x1 = p1.x,
                    _ => {
                        push(row.take(), &mut out);
                        row = Some((p0.y, p0.x, p1.x));
                    }
                }
                i = next;
            }
            push(row, &mut out);
        }
        out
    }

    /// Selection ranges in each leaf's display space, by leaf key.
    pub fn selection_ranges(leaves: &[LeafEntry], range: &Range<usize>) -> Vec<(u64, Range<usize>)> {
        let mut out = Vec::new();
        if range.is_empty() {
            return out;
        }
        for leaf in leaves {
            let s = &leaf.text.source;
            if s.end < range.start || s.start > range.end {
                continue;
            }
            let a = leaf.text.to_display(range.start.max(s.start) - s.start, false);
            let b = leaf.text.to_display(range.end.min(s.end) - s.start, true);
            if a < b {
                out.push((leaf.key, a..b));
            }
        }
        out
    }

    pub fn max_scroll(&self) -> f32 {
        f32::from(self.height - self.bounds.size.height).max(0.)
    }
}

impl DocLayout {
    /// Character and block geometry relative to the editor's top-left, in
    /// the shape of tools/probe-editor.mjs output (`chars`, `lines`), for
    /// numeric comparison with the product.
    pub fn dump(&self) -> serde_json::Value {
        let origin = self.bounds.origin;
        let rel = |p: Point<Pixels>| (f32::from(p.x - origin.x), f32::from(p.y - origin.y));
        let mut chars = Vec::new();
        for leaf in &self.leaves {
            let text = &leaf.entry.text;
            let caret_h = leaf.geometry.caret_height();
            let row_h = leaf.geometry.line_height();
            for (i, ch) in text.text.char_indices() {
                let j = i + ch.len_utf8();
                let (p0, p1) = (leaf.geometry.position_for_index(i), leaf.position(j, true));
                let (x, y) = rel(p0);
                let w = if p1.y == p0.y { f32::from(p1.x - p0.x) } else { 0. };
                let top = y + f32::from((row_h - caret_h) / 2.);
                chars.push(serde_json::json!({"at": text.source.start + text.to_source(i), "ch": ch.to_string(), "rect": [x, top, w, f32::from(caret_h)], "row": y}));
            }
        }
        let lines: Vec<_> = self
            .blocks
            .iter()
            .map(|b| {
                let (x, y) = rel(b.bounds.origin);
                serde_json::json!({"from": b.source.start, "lines": [b.lines.start, b.lines.end], "rect": [x, y, f32::from(b.bounds.size.width), f32::from(b.bounds.size.height)]})
            })
            .collect();
        serde_json::json!({"viewport": [f32::from(self.bounds.size.width), f32::from(self.bounds.size.height)], "chars": chars, "lines": lines})
    }
}
