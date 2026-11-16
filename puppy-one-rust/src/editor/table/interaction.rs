//! Table gestures shared by CSV and Markdown tables (CsvTableControls,
//! tableDragLayer.ts, editableTableDrag.ts, editableTableSelection.ts,
//! CsvColumnResizeLayer): the hovered cell grips follow, a row / column
//! drag with its drop boundary, the structural selection a move leaves, and
//! a column resize. State is plain data; each format owns it where it lives
//! (an entity field, or keyed element state for a widget) and supplies its
//! geometry through `Tracks`.
use super::{
    operation::{Axis, Operation},
    paint::{Draw, Sides},
    style::EditableTableStyle,
};
use crate::ui::motion::{cubic_bezier, frozen_time};
use gpui::{Bounds, Corners, Pixels, Point, Rgba};
use std::time::{Duration, Instant};

/// A press becomes a drag after moving more than this (`moved`).
pub const DRAG_SLOP: f32 = 4.;
/// Grips straddle their outside edge by about nine pixels.
pub const OUTER_REACH: f32 = 9.;
/// Initial grip fade-in duration (`editable-table.css`, `TB-03`).
pub const GRIP_FADE_DURATION: Duration = Duration::from_millis(80);
/// Cross-cell grip slide duration (`cubic-bezier(0.2, 0, 0, 1)`, `TB-03`).
pub const GRIP_MOVE_DURATION: Duration = Duration::from_millis(160);

#[derive(Clone, Copy, Debug, PartialEq)]
struct MotionSpan {
    started: Instant,
    duration: Duration,
}

impl MotionSpan {
    fn start(duration: Duration) -> Self {
        Self {
            started: Instant::now(),
            duration,
        }
    }

    fn time(&self) -> f32 {
        frozen_time().unwrap_or_else(|| {
            (self.started.elapsed().as_secs_f32() / self.duration.as_secs_f32()).clamp(0., 1.)
        })
    }

    fn finished(&self) -> bool {
        frozen_time().is_none() && self.started.elapsed() >= self.duration
    }

    #[cfg(test)]
    fn advance(&mut self, by: Duration) {
        self.started -= by;
    }
}

/// Pointer-following motion state for a single axis's grip handle (`TB-03`).
///
/// First appearance places the grip directly at its target and fades in over
/// `80ms`; retargeting an already-shown grip slides along its axis over `160ms`
/// (`cubic-bezier(0.2, 0, 0, 1)`), continuing smoothly if retargeted mid-flight.
/// Scroll, layout refresh, menu anchor and drag start snap immediately, and
/// `reduce_motion` disables both transitions.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct GripMotion {
    pub target: Option<usize>,
    last_pos: f32,
    from_offset: f32,
    fade: Option<MotionSpan>,
    slide: Option<MotionSpan>,
}

impl GripMotion {
    fn move_progress(tl: &MotionSpan) -> f32 {
        cubic_bezier(0.2, 0., 0., 1., tl.time())
    }

    fn current_offset(&self) -> f32 {
        match &self.slide {
            Some(tl) if !tl.finished() => self.from_offset * (1. - Self::move_progress(tl)),
            _ => 0.,
        }
    }

    /// Update the targeted track index and its natural main-axis coordinate.
    /// Returns whether the motion state changed.
    pub fn retarget(&mut self, next: Option<(usize, f32)>, reduce_motion: bool) -> bool {
        let before = *self;
        let Some((index, pos)) = next else {
            *self = Self::default();
            return *self != before;
        };
        if reduce_motion {
            *self = Self {
                target: Some(index),
                last_pos: pos,
                from_offset: 0.,
                fade: None,
                slide: None,
            };
            return *self != before;
        }
        match self.target {
            None => {
                self.target = Some(index);
                self.last_pos = pos;
                self.from_offset = 0.;
                self.fade = Some(MotionSpan::start(GRIP_FADE_DURATION));
                self.slide = None;
            }
            Some(prev) if prev == index => {
                // Same track (e.g. scroll or resize): follow immediately without hover lag.
                self.last_pos = pos;
            }
            Some(_) => {
                let visual = self.last_pos + self.current_offset();
                self.target = Some(index);
                self.from_offset = visual - pos;
                self.last_pos = pos;
                self.slide =
                    (self.from_offset.abs() > 0.01).then(|| MotionSpan::start(GRIP_MOVE_DURATION));
                if self.fade.as_ref().is_some_and(MotionSpan::finished) {
                    self.fade = None;
                }
            }
        }
        *self != before
    }

    /// Snap immediately to the target with full opacity (press, drag, menu).
    pub fn snap_immediate(&mut self) {
        self.from_offset = 0.;
        self.fade = None;
        self.slide = None;
    }

    /// Sample `(visual_pos, opacity)` at the current frame for `target_pos`.
    pub fn sample(&self, target_pos: f32, reduce_motion: bool) -> (f32, f32) {
        if reduce_motion {
            return (target_pos, 1.);
        }
        let opacity = match &self.fade {
            Some(tl) if !tl.finished() => tl.time(),
            _ => 1.,
        };
        let pos = target_pos + self.current_offset();
        (pos, opacity)
    }

    /// Prune finished timelines; returns `true` while an animation is still active.
    pub fn tick(&mut self, reduce_motion: bool) -> bool {
        if reduce_motion {
            self.snap_immediate();
            return false;
        }
        if self.fade.as_ref().is_some_and(MotionSpan::finished) {
            self.fade = None;
        }
        if self.slide.as_ref().is_some_and(MotionSpan::finished) {
            self.slide = None;
            self.from_offset = 0.;
        }
        self.fade.is_some() || self.slide.is_some()
    }

    #[cfg(test)]
    pub fn advance(&mut self, by: Duration) {
        if let Some(fade) = &mut self.fade {
            fade.advance(by);
        }
        if let Some(slide) = &mut self.slide {
            slide.advance(by);
        }
    }
}

/// A table's tracks, in the coordinates its controls are drawn in.
pub trait Tracks {
    fn rows(&self) -> usize;
    fn columns(&self) -> usize;
    /// The first row that moves (1 under a header record or row).
    fn first_movable(&self) -> usize;
    /// A row's (natural, unstuck) top and height, borders included.
    fn row_span(&self, row: usize) -> (f32, f32);
    fn column_span(&self, column: usize) -> (f32, f32);
    /// The table's border box.
    fn table(&self) -> Bounds<f32>;
}

/// The hovered cell (`hoverRef`): a record number has no column.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Hover {
    pub row: Option<usize>,
    pub column: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StructureDrag {
    pub axis: Axis,
    pub source: usize,
    pub start: Point<Pixels>,
    pub moved: bool,
    /// The drop boundary among the movable rows / the columns.
    pub boundary: Option<usize>,
}

/// `getEditableTableDropBoundary`: the first segment whose midpoint lies
/// past the pointer, else after the last.
pub fn drop_boundary(segments: &[(f32, f32)], pointer: f32) -> Option<usize> {
    if segments.is_empty() {
        return None;
    }
    Some(
        segments
            .iter()
            .position(|(start, size)| pointer < start + size / 2.)
            .unwrap_or(segments.len()),
    )
}

impl StructureDrag {
    pub fn new(axis: Axis, source: usize, start: Point<Pixels>) -> Self {
        Self {
            axis,
            source,
            start,
            moved: false,
            boundary: None,
        }
    }

    /// Follow the pointer (window coordinates; `content` the same point in
    /// track coordinates). Returns whether the drag changed.
    pub fn track(
        &mut self,
        pointer: Point<Pixels>,
        content: (f32, f32),
        tracks: &impl Tracks,
    ) -> bool {
        let before = *self;
        if !self.moved {
            let (dx, dy) = (
                f32::from(pointer.x - self.start.x),
                f32::from(pointer.y - self.start.y),
            );
            if dx.abs() <= DRAG_SLOP && dy.abs() <= DRAG_SLOP {
                return false;
            }
            self.moved = true;
        }
        self.boundary = match self.axis {
            Axis::Row => {
                let segments: Vec<(f32, f32)> = (tracks.first_movable()..tracks.rows())
                    .map(|r| tracks.row_span(r))
                    .collect();
                drop_boundary(&segments, content.1)
            }
            Axis::Column => {
                let segments: Vec<(f32, f32)> = (0..tracks.columns())
                    .map(|c| tracks.column_span(c))
                    .collect();
                drop_boundary(&segments, content.0)
            }
        };
        *self != before
    }

    /// Where the boundary moves the source to, if anywhere (`applyMove`).
    pub fn target(&self, tracks: &impl Tracks) -> Option<usize> {
        let boundary = self.boundary?;
        let (offset, count) = match self.axis {
            Axis::Row => (
                tracks.first_movable(),
                tracks.rows() - tracks.first_movable(),
            ),
            Axis::Column => (0, tracks.columns()),
        };
        let target_boundary = offset + boundary.min(count);
        let target = if target_boundary > self.source {
            target_boundary - 1
        } else {
            target_boundary
        };
        (target != self.source).then_some(target)
    }

    /// The move a released drag applies, at the hovered cross position.
    pub fn operation(
        &self,
        tracks: &impl Tracks,
        hover: Hover,
    ) -> Option<(Operation, usize, usize)> {
        let target = self.target(tracks)?;
        Some(match self.axis {
            Axis::Row => (
                Operation::MoveRowTo(target),
                self.source,
                hover.column.unwrap_or(0),
            ),
            Axis::Column => (
                Operation::MoveColumnTo(target),
                hover.row.unwrap_or(tracks.first_movable()),
                self.source,
            ),
        })
    }

    /// `.po-editable-table-drop-indicator`: a 2px line on the boundary the
    /// source would land at, hidden where it would not move.
    pub fn indicator(&self, tracks: &impl Tracks, style: &EditableTableStyle) -> Option<Draw> {
        if !self.moved {
            return None;
        }
        self.target(tracks)?;
        let boundary = self.boundary?;
        let table = tracks.table();
        let bounds = match self.axis {
            Axis::Row => {
                let row = tracks.first_movable() + boundary;
                let y = if row < tracks.rows() {
                    tracks.row_span(row).0
                } else {
                    let (top, height) = tracks.row_span(tracks.rows() - 1);
                    top + height
                };
                Draw::rect(table.origin.x, y - 1., table.size.width, 2.)
            }
            Axis::Column => {
                let x = if boundary < tracks.columns() {
                    tracks.column_span(boundary).0
                } else {
                    let (left, width) = tracks.column_span(tracks.columns() - 1);
                    left + width
                };
                Draw::rect(x - 1., table.origin.y, 2., table.size.height)
            }
        };
        Some(Draw::Cell {
            bounds,
            background: style.selection_border,
            border: Sides::default(),
            border_color: Rgba::default(),
            radius: Corners::default(),
        })
    }
}

/// `.po-editable-table-selection-outline`: a perimeter around a row (the
/// table's width) or a column (the table's height).
pub fn outline(
    tracks: &impl Tracks,
    style: &EditableTableStyle,
    axis: Axis,
    index: usize,
) -> Option<Draw> {
    let table = tracks.table();
    let bounds = match axis {
        Axis::Row if index < tracks.rows() => {
            let (top, height) = tracks.row_span(index);
            Draw::rect(table.origin.x, top, table.size.width, height)
        }
        Axis::Column if index < tracks.columns() => {
            let (left, width) = tracks.column_span(index);
            Draw::rect(left, table.origin.y, width, table.size.height)
        }
        _ => return None,
    };
    let s = style.selection_stroke;
    Some(Draw::Cell {
        bounds,
        background: Rgba::default(),
        border: Sides {
            top: s,
            right: s,
            bottom: s,
            left: s,
        },
        border_color: style.selection_border,
        radius: Corners::default(),
    })
}

/// One table's pointer gestures: what the grips follow, a grip drag, the
/// structural selection a move leaves, a column resize and the column whose
/// resize rail shows, and whether the pointer is over the table surface or
/// a grip (`pointerleave` waits for both).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Gestures {
    pub hover: Hover,
    pub drag: Option<StructureDrag>,
    pub structural: Option<(Axis, usize)>,
    pub resizing: Option<Resizing>,
    pub resize_hover: Option<usize>,
    pub surface_hovered: bool,
    pub grip_hovered: bool,
    pub column_motion: GripMotion,
    pub row_motion: GripMotion,
}

impl Gestures {
    /// The row / column with a perimeter: a drag source, else `menu` (a grip
    /// menu's target), else the selection a move left.
    pub fn outline(&self, menu: Option<(Axis, usize)>) -> Option<(Axis, usize)> {
        self.drag
            .map(|d| (d.axis, d.source))
            .or(menu)
            .or(self.structural)
    }

    /// End in-progress pointer gestures (`CS-11`), returning any cancelled
    /// column resize so the owner can restore its starting width.
    pub fn cancel_transient(&mut self) -> Option<Resizing> {
        self.drag = None;
        self.resize_hover = None;
        self.column_motion.snap_immediate();
        self.row_motion.snap_immediate();
        self.resizing.take()
    }
}

/// A column resize in progress (pointer capture from the rail).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Resizing {
    pub column: usize,
    pub start_x: f32,
    pub start_width: f32,
}

impl Resizing {
    /// The width at pointer `x`, clamped to `minimum..=maximum`.
    pub fn width(&self, x: f32, minimum: f32, maximum: f32) -> f32 {
        (self.start_width + (x - self.start_x))
            .round()
            .clamp(minimum, maximum)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{point, px, size};

    struct Grid;
    impl Tracks for Grid {
        fn rows(&self) -> usize {
            4
        }
        fn columns(&self) -> usize {
            3
        }
        fn first_movable(&self) -> usize {
            1
        }
        fn row_span(&self, row: usize) -> (f32, f32) {
            (row as f32 * 10., 10.)
        }
        fn column_span(&self, column: usize) -> (f32, f32) {
            (column as f32 * 100., 100.)
        }
        fn table(&self) -> Bounds<f32> {
            Bounds {
                origin: point(0., 0.),
                size: size(300., 40.),
            }
        }
    }

    #[test]
    fn drops_land_before_the_first_segment_past_the_pointer_midpoint() {
        let segments = [(0., 10.), (10., 10.), (20., 10.)];
        assert_eq!(drop_boundary(&segments, -5.), Some(0));
        assert_eq!(drop_boundary(&segments, 4.9), Some(0));
        assert_eq!(drop_boundary(&segments, 5.), Some(1));
        assert_eq!(drop_boundary(&segments, 26.), Some(3));
        assert_eq!(drop_boundary(&[], 1.), None);
    }

    #[test]
    fn a_drag_moves_past_the_slop_and_targets_the_boundary() {
        let start = point(px(0.), px(0.));
        let mut drag = StructureDrag::new(Axis::Row, 1, start);
        assert!(!drag.track(point(px(3.), px(3.)), (0., 13.), &Grid));
        // Below row 3's midpoint: after the last row.
        assert!(drag.track(point(px(0.), px(30.)), (0., 36.), &Grid));
        assert_eq!((drag.boundary, drag.target(&Grid)), (Some(3), Some(3)));
        assert_eq!(
            drag.operation(
                &Grid,
                Hover {
                    row: None,
                    column: Some(2)
                }
            ),
            Some((Operation::MoveRowTo(3), 1, 2))
        );
        // Onto its own boundary: no move, no indicator.
        drag.track(point(px(0.), px(12.)), (0., 12.), &Grid);
        assert_eq!(drag.target(&Grid), None);
        assert!(drag.indicator(&Grid, &style()).is_none());
    }

    fn style() -> EditableTableStyle {
        EditableTableStyle::resolve(
            crate::editor::tokens::Tokens::csv(true, crate::typography::Scale::Medium),
            13.,
        )
    }

    #[test]
    fn grip_motion_fades_on_appear_slides_across_tracks_and_respects_reduced_motion() {
        let mut motion = GripMotion::default();
        // First appearance: positioned directly at target (no fly-in), 80ms fade-in.
        assert!(motion.retarget(Some((0, 100.)), false));
        let (pos0, op0) = motion.sample(100., false);
        assert_eq!(pos0, 100.);
        assert!(op0 < 0.25);
        motion.advance(Duration::from_millis(40));
        let (pos_mid, op_mid) = motion.sample(100., false);
        assert_eq!(pos_mid, 100.);
        assert!((0.35..0.75).contains(&op_mid));
        motion.advance(Duration::from_millis(50));
        assert!(!motion.tick(false));
        assert_eq!(motion.sample(100., false), (100., 1.));

        // Cross-track retarget: 160ms slide from 100 to 220, and mid-flight reversal.
        assert!(motion.retarget(Some((1, 220.)), false));
        motion.advance(Duration::from_millis(40));
        let (mid_x, op) = motion.sample(220., false);
        assert_eq!(op, 1.);
        assert!(mid_x > 105. && mid_x < 215., "mid_x={mid_x}");
        // Retarget back to track 0 mid-flight: starts smoothly from `mid_x`, no jump.
        motion.retarget(Some((0, 100.)), false);
        let (after_reverse, _) = motion.sample(100., false);
        assert!(
            (after_reverse - mid_x).abs() < 2.,
            "{after_reverse} vs {mid_x}"
        );
        motion.advance(Duration::from_millis(170));
        assert!(!motion.tick(false));
        assert_eq!(motion.sample(100., false), (100., 1.));

        // Reduced motion skips both fade and slide immediately.
        let mut still = GripMotion::default();
        still.retarget(Some((0, 50.)), true);
        assert_eq!(still.sample(50., true), (50., 1.));
        still.retarget(Some((2, 300.)), true);
        assert_eq!(still.sample(300., true), (300., 1.));
        assert!(!still.tick(true));
    }
}
