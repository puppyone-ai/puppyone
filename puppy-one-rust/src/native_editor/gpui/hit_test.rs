//! Cached Kit leaf geometry and whole-document caret/hit mapping.
use super::*;
use gpui_kit::base::text::editor_host::LeafGeometry;
#[derive(Clone, Debug, Default)]
pub struct TextRegion {
    pub range: Range<usize>,
    pub group: usize,
    pub font_size: f32,
    pub heading: bool,
    pub heading_level: u8,
    pub code: bool,
    pub quote: bool,
    pub prefix: String,
    pub columns: usize,
    pub column: usize,
    pub alignment: i8,
    pub before: f32,
    pub after: f32,
}
#[derive(Clone)]
pub(crate) struct Leaf {
    pub range: Range<usize>,
    pub geometry: LeafGeometry,
}
#[derive(Clone)]
pub(crate) struct Label {
    pub range: Range<usize>,
    pub origin: Point<Pixels>,
    pub width: Pixels,
    pub height: Pixels,
}
#[derive(Clone, Default)]
pub(crate) struct TextLayout {
    pub leaves: Vec<Leaf>,
    pub labels: Vec<Label>,
    pub origin: Point<Pixels>,
}
impl TextLayout {
    pub fn clear(&mut self) {
        *self = Self::default();
    }
    fn leaf(&self, index: usize) -> Option<&Leaf> {
        self.leaves
            .iter()
            .find(|l| index <= l.range.end)
            .or(self.leaves.last())
    }
    pub fn height_at(&self, index: usize, fallback: Pixels) -> Pixels {
        self.leaf(index)
            .map(|l| l.geometry.caret_height())
            .unwrap_or(fallback)
    }
}
pub(crate) fn position_at(layout: &TextLayout, index: usize, _: Pixels) -> Point<Pixels> {
    layout
        .leaf(index)
        .map(|l| {
            l.geometry
                .position_for_index(index.saturating_sub(l.range.start).min(l.range.len()))
                - layout.origin
        })
        .unwrap_or_default()
}
pub(crate) fn index_at(layout: &TextLayout, p: Point<Pixels>, _: Pixels) -> usize {
    let at = p + layout.origin;
    layout
        .leaves
        .iter()
        .min_by(|a, b| {
            let distance = |l: &Leaf| {
                let b = l.geometry.bounds();
                let dy = (b.top() - at.y).max(at.y - b.bottom()).max(px(0.));
                let dx = (b.left() - at.x).max(at.x - b.right()).max(px(0.));
                f32::from(dy) * 10000. + f32::from(dx)
            };
            distance(a).total_cmp(&distance(b))
        })
        .map(|l| l.range.start + l.geometry.index_for_position(at).min(l.range.len()))
        .unwrap_or(0)
}
pub(crate) fn vertical_index(layout: &TextLayout, index: usize, direction: f32) -> usize {
    let at = position_at(layout, index, px(24.)) + layout.origin;
    let mut target: Option<(f32, usize)> = None;
    let height = layout
        .leaf(index)
        .map(|l| l.geometry.line_height())
        .unwrap_or(px(24.));
    for leaf in &layout.leaves {
        let bounds = leaf.geometry.bounds();
        let y = if direction > 0. {
            (at.y + height + px(0.5)).max(bounds.top() + px(0.5))
        } else {
            (at.y - px(0.5)).min(bounds.bottom() - px(0.5))
        };
        let byte = leaf
            .geometry
            .index_for_position(point(at.x, y))
            .min(leaf.range.len());
        let p = leaf.geometry.position_for_index(byte);
        let dy = f32::from(p.y - at.y);
        if dy * direction <= 0.5 {
            continue;
        }
        let score = dy.abs() * 10000. + f32::from(p.x - at.x).abs();
        if target.is_none_or(|(best, _)| score < best) {
            target = Some((score, leaf.range.start + byte));
        }
    }
    target.map(|(_, i)| i).unwrap_or(index)
}
pub(crate) fn line_edge(layout: &TextLayout, index: usize, end: bool) -> usize {
    let Some(l) = layout.leaf(index) else {
        return index;
    };
    let p = l
        .geometry
        .position_for_index(index.saturating_sub(l.range.start).min(l.range.len()));
    l.range.start
        + l.geometry
            .index_for_position(point(
                if end {
                    l.geometry.bounds().right() + px(1.)
                } else {
                    l.geometry.bounds().left() - px(1.)
                },
                p.y + l.geometry.line_height() * 0.5,
            ))
            .min(l.range.len())
}
