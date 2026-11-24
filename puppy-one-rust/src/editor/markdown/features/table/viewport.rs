//! The table's horizontal scrollport (`tableInlineViewportController.ts`):
//! a table wider than the reading column scrolls inside a viewport that
//! reaches the editor's edges, while its scrollbar stays on the reading
//! rail. Offsets are logical (zero at the inline start, the table aligned
//! with the reading column) and kept as a column anchor in the view's
//! [`inline_viewport`](crate::editor::markdown::platform::sessions::inline_viewport)
//! session.
use crate::editor::markdown::platform::sessions::inline_viewport::Position;

/// `INLINE_START_EPSILON_PX`.
pub const START_EPSILON: f32 = 0.5;
/// The scrollbar rail's height (`--po-scrollbar-size`).
pub const RAIL_HEIGHT: f32 = 12.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Ltr,
    Rtl,
}

/// How a platform reports right-to-left scroll offsets
/// (`RtlScrollBehavior`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RtlScroll {
    Negative,
    PositiveAscending,
    PositiveDescending,
}

/// `normalizeInlineScrollOffset`: a raw offset as a logical one, zero at
/// the inline start in every direction.
pub fn normalize(raw: f32, max: f32, direction: Direction, rtl: RtlScroll) -> f32 {
    match (direction, rtl) {
        (Direction::Ltr, _) | (Direction::Rtl, RtlScroll::PositiveAscending) => raw.clamp(0., max),
        (Direction::Rtl, RtlScroll::Negative) => (-raw).clamp(0., max),
        (Direction::Rtl, RtlScroll::PositiveDescending) => (max - raw).clamp(0., max),
    }
}

/// `denormalizeInlineScrollOffset`.
pub fn denormalize(logical: f32, max: f32, direction: Direction, rtl: RtlScroll) -> f32 {
    let offset = logical.clamp(0., max);
    match (direction, rtl) {
        (Direction::Ltr, _) | (Direction::Rtl, RtlScroll::PositiveAscending) => offset,
        (Direction::Rtl, RtlScroll::Negative) => -offset,
        (Direction::Rtl, RtlScroll::PositiveDescending) => max - offset,
    }
}

/// `mapInlineScrollOffset`: an offset of one scroll range as the
/// proportional offset of another (the table and its scrollbar rail).
pub fn map_offset(logical: f32, source_max: f32, target_max: f32) -> f32 {
    if source_max <= START_EPSILON || target_max <= 0. {
        return 0.;
    }
    (logical.clamp(0., source_max) / source_max * target_max).clamp(0., target_max)
}

/// `TableInlineGeometry`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Geometry {
    /// Each column's track.
    pub columns: Vec<f32>,
    /// Scroll content before the table: the scrollport reaches the editor's
    /// edge, the table starts at the reading column.
    pub leading: f32,
    /// The largest logical offset.
    pub max: f32,
    /// The scrollport's width.
    pub viewport: f32,
}

impl Geometry {
    /// A table of `columns` tracks (`table_width` with its rules) in a
    /// reading column of `width` with `gutter` on each side. The first track
    /// starts inside the table's outer rule.
    pub fn new(columns: Vec<f32>, table_width: f32, width: f32, gutter: f32) -> Self {
        Self {
            columns,
            leading: gutter + 1.,
            // The table's end aligns with the reading column's end.
            max: (table_width - width).max(0.),
            viewport: width + 2. * gutter,
        }
    }

    pub fn overflows(&self) -> bool {
        self.max > START_EPSILON
    }

    fn before(&self, column: usize) -> f32 {
        self.columns.iter().take(column).sum()
    }
}

/// `getEmbeddedInlineViewportPosition`: the column at `offset`, and how far
/// into it.
pub fn position(offset: f32, geometry: &Geometry) -> Position {
    if offset <= START_EPSILON {
        return Position::Start;
    }
    let content = offset - geometry.leading;
    let mut start = 0.;
    let mut item = 0;
    while item + 1 < geometry.columns.len() {
        let end = start + geometry.columns[item];
        if content < end {
            break;
        }
        start = end;
        item += 1;
    }
    Position::Anchored {
        item,
        within: content - start,
        fallback: offset,
    }
}

/// `getLogicalOffsetForPosition`: the offset that shows `position` with
/// these tracks.
pub fn offset(position: Position, geometry: &Geometry) -> f32 {
    let Position::Anchored {
        item,
        within,
        fallback,
    } = position
    else {
        return 0.;
    };
    let target = if geometry.columns.iter().any(|w| *w > 0.) {
        let item = item.min(geometry.columns.len().saturating_sub(1));
        geometry.leading + geometry.before(item) + within
    } else {
        fallback
    };
    target.clamp(0., geometry.max)
}

/// `revealColumn`: the offset that brings `column` into the scrollport,
/// scrolling as little as possible.
pub fn reveal(current: f32, column: usize, geometry: &Geometry) -> f32 {
    let column = column.min(geometry.columns.len().saturating_sub(1));
    let start = geometry.leading + geometry.before(column);
    let end = start + geometry.columns.get(column).copied().unwrap_or(0.);
    let next = if start < current {
        start
    } else if end > current + geometry.viewport {
        end - geometry.viewport
    } else {
        current
    };
    next.clamp(0., geometry.max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `markdownInlineViewportSession.test.ts` #4.
    #[test]
    fn every_rtl_scroll_model_normalizes_to_zero_at_the_inline_start() {
        let max = 400.;
        for rtl in [
            RtlScroll::Negative,
            RtlScroll::PositiveAscending,
            RtlScroll::PositiveDescending,
        ] {
            for logical in [0., 75., max] {
                let raw = denormalize(logical, max, Direction::Rtl, rtl);
                assert_eq!(normalize(raw, max, Direction::Rtl, rtl), logical, "{rtl:?}");
            }
        }
        assert_eq!(
            normalize(75., max, Direction::Ltr, RtlScroll::Negative),
            75.
        );
    }

    /// #5.
    #[test]
    fn the_table_offset_maps_proportionally_onto_a_differently_sized_scrollbar() {
        assert_eq!(map_offset(0., 1200., 800.), 0.);
        assert_eq!(map_offset(600., 1200., 800.), 400.);
        assert_eq!(map_offset(1200., 1200., 800.), 800.);
        assert_eq!(map_offset(200., 0., 800.), 0.);
    }

    #[test]
    fn anchors_restore_the_offset_and_reveal_scrolls_as_little_as_possible() {
        let g = Geometry::new(vec![100.; 6], 602., 300., 40.);
        assert_eq!((g.max, g.viewport), (302., 380.));
        for at in [0., 1., 55., 140., 302.] {
            assert!((offset(position(at, &g), &g) - at).abs() < 1e-3, "{at}");
        }
        assert_eq!(position(0.2, &g), Position::Start);
        // Column 4 (content 441..541) is past the scrollport's end at 0.
        assert_eq!(reveal(0., 4, &g), 161.);
        // Already visible: no scroll.
        assert_eq!(reveal(161., 3, &g), 161.);
        // Column 0 starts before the current offset.
        assert_eq!(reveal(161., 0, &g), 41.);
    }
}
