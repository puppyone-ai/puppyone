//! Port of `useWorkbenchTabMoveDrag`'s drop intents: a tab dragged over a tab
//! bar inserts at the slot nearest the pointer; over a group's content it
//! splits on the closest edge (`closestWorkbenchSplitDropEdge`) when both sides
//! keep their minimum size (`canPlaceWorkbenchSplit`).
use super::layout::{Axis, Id};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    Left,
    Right,
    Top,
    Bottom,
}

impl Edge {
    /// `workbenchSplitDefinition`: direction and whether the source goes second.
    pub fn split(self) -> (Axis, bool) {
        match self {
            Edge::Left => (Axis::Horizontal, false),
            Edge::Right => (Axis::Horizontal, true),
            Edge::Top => (Axis::Vertical, false),
            Edge::Bottom => (Axis::Vertical, true),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DropIntent {
    Insert {
        group: Id,
        index: usize,
        allowed: bool,
    },
    Split {
        group: Id,
        edge: Edge,
        allowed: bool,
    },
}

/// `closestWorkbenchSplitDropEdge`: the edge with the smallest relative distance.
pub fn closest_edge(left: f32, top: f32, width: f32, height: f32, x: f32, y: f32) -> Edge {
    let w = width.max(1.);
    let h = height.max(1.);
    [
        (Edge::Left, (x - left).abs() / w),
        (Edge::Right, (left + width - x).abs() / w),
        (Edge::Top, (y - top).abs() / h),
        (Edge::Bottom, (top + height - y).abs() / h),
    ]
    .into_iter()
    .fold((Edge::Left, f32::INFINITY), |best, candidate| {
        if candidate.1 < best.1 {
            candidate
        } else {
            best
        }
    })
    .0
}

/// Insertion slot for a pointer at `x` over tabs laid out as
/// `(inline_start, width)` (source excluded): before the first tab whose centre
/// lies right of the pointer.
pub fn insertion_index(tabs: &[(f32, f32)], x: f32) -> usize {
    tabs.iter()
        .take_while(|(start, width)| start + width / 2. <= x)
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edges_follow_the_closest_relative_distance() {
        assert_eq!(closest_edge(0., 0., 400., 200., 20., 100.), Edge::Left);
        assert_eq!(closest_edge(0., 0., 400., 200., 390., 100.), Edge::Right);
        assert_eq!(closest_edge(0., 0., 400., 200., 200., 10.), Edge::Top);
        assert_eq!(closest_edge(0., 0., 400., 200., 200., 195.), Edge::Bottom);
        assert_eq!(Edge::Right.split(), (Axis::Horizontal, true));
    }
    #[test]
    fn insertion_uses_tab_centres() {
        let tabs = [(0., 100.), (103., 100.), (206., 100.)];
        assert_eq!(insertion_index(&tabs, 10.), 0);
        assert_eq!(insertion_index(&tabs, 60.), 1);
        assert_eq!(insertion_index(&tabs, 260.), 3);
    }
}
