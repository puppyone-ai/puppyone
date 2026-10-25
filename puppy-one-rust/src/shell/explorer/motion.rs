//! Explorer disclosure motion: port of `explorerMotionPlan.ts`,
//! `explorerMotionAnimation.ts` and `useExplorerMotion.ts`.
//!
//! When the visible rows change (a folder opens or closes, an entry appears
//! or goes away) the rows animate from the last committed layout for 220ms:
//!
//! - rows that appear are revealed top to bottom, a contiguous run one row
//!   after another (`clip-path: inset(0 0 100% 0)` → `inset(0)`);
//! - rows that went away stay where they were as inert ghosts and are clipped
//!   away bottom to top, last row first;
//! - rows that stayed slide from their old position (FLIP), and so does the
//!   list-end "New" row;
//! - a folder's disclosure marker turns with the same timing.
//!
//! The curve is the product's jerk-limited trapezoid: a smooth start, a
//! constant-speed middle and a smooth stop. The first rows of a project
//! (hydration) do not animate, and nothing animates when the system asks
//! for reduced motion.
use crate::{model::Row, ui::motion::Timeline};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::Duration,
};

/// `EXPLORER_MOTION_DURATION_MS`.
pub(super) const DURATION: Duration = Duration::from_millis(220);
/// `EXPLORER_MOTION_RAMP_FRACTION`: the share of the time spent accelerating
/// (and again decelerating).
const RAMP: f32 = 0.22;
/// Removed rows painted as ghosts at most (the product bounds them by its
/// mounted-row limit; rows far outside the viewport are not painted anyway).
const MAX_GHOSTS: usize = 256;

/// `getExplorerMotionProgress`: position along a symmetric jerk-limited
/// trapezoidal velocity profile, both normalised to `0..=1`.
pub(super) fn progress(time: f32) -> f32 {
    let time = time.clamp(0., 1.);
    let plateau = 1. / (1. - RAMP);
    if time < RAMP {
        let ramp = time / RAMP;
        return RAMP * plateau * (ramp.powi(3) - 0.5 * ramp.powi(4));
    }
    if time > 1. - RAMP {
        return 1. - progress(1. - time);
    }
    RAMP * plateau * 0.5 + (time - RAMP) * plateau
}

/// The share of the timeline over which one row of a run is revealed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Phase {
    start: f32,
    end: f32,
}
impl Phase {
    const FULL: Self = Self { start: 0., end: 1. };
    /// How far this row is revealed at eased progress `eased`.
    fn local(self, eased: f32) -> f32 {
        if self.end <= self.start {
            return if eased >= self.end { 1. } else { 0. };
        }
        ((eased - self.start) / (self.end - self.start)).clamp(0., 1.)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum RowMotion {
    Enter(Phase),
    /// Old minus new position, in pixels.
    Move(f32),
}

/// A row that went away, painted where it was until it is clipped away.
#[derive(Clone, Debug)]
pub(in crate::shell) struct Ghost {
    pub row: Row,
    /// Its index in the previous rows.
    pub index: usize,
    phase: Phase,
}

/// One disclosure: what each visible row does, indexed like the new rows.
#[derive(Debug)]
pub(super) struct Plan {
    rows: Vec<Option<RowMotion>>,
    /// Folders whose disclosure changed, by new index: now expanded?
    toggled: HashMap<usize, bool>,
    ghosts: Vec<Ghost>,
    list_end_offset: f32,
}

/// `createExplorerMotionPlan` over the whole projection (the work is one pass
/// over the rows; only the rows in view are painted).
pub(super) fn plan(previous: &[Row], next: &[Row], stride: f32) -> Option<Plan> {
    // The first snapshot of a project is hydration, not a disclosure, and a
    // projection with nothing in common is a different project.
    if previous.is_empty() || next.is_empty() {
        return None;
    }
    let previous_index: HashMap<&Path, usize> = previous
        .iter()
        .enumerate()
        .map(|(index, row)| (row.path.as_path(), index))
        .collect();
    if !next
        .iter()
        .any(|row| previous_index.contains_key(row.path.as_path()))
    {
        return None;
    }
    let next_keys: HashSet<&Path> = next.iter().map(|row| row.path.as_path()).collect();
    let enter = runs(
        next.len(),
        |i| !previous_index.contains_key(next[i].path.as_path()),
        false,
    );
    let exit = runs(
        previous.len(),
        |i| !next_keys.contains(previous[i].path.as_path()),
        true,
    );

    let mut rows = vec![None; next.len()];
    let mut toggled = HashMap::new();
    for (index, row) in next.iter().enumerate() {
        match previous_index.get(row.path.as_path()) {
            None => rows[index] = Some(RowMotion::Enter(enter[index].unwrap_or(Phase::FULL))),
            Some(&old) => {
                let offset = (old as f32 - index as f32) * stride;
                if offset != 0. {
                    rows[index] = Some(RowMotion::Move(offset));
                }
                if row.folder && previous[old].expanded != row.expanded {
                    toggled.insert(index, row.expanded);
                }
            }
        }
    }
    let ghosts: Vec<Ghost> = previous
        .iter()
        .enumerate()
        .filter(|(_, row)| !next_keys.contains(row.path.as_path()))
        .take(MAX_GHOSTS)
        .map(|(index, row)| Ghost {
            row: row.clone(),
            index,
            phase: exit[index].unwrap_or(Phase::FULL),
        })
        .collect();
    let list_end_offset = (previous.len() as f32 - next.len() as f32) * stride;
    let idle = rows.iter().all(Option::is_none) && ghosts.is_empty() && toggled.is_empty();
    (!idle).then_some(Plan {
        rows,
        toggled,
        ghosts,
        list_end_offset,
    })
}

/// `buildContiguousRevealPhases`: each run of affected rows shares the
/// timeline, row by row (`reverse`: the last row of a run goes first).
fn runs(len: usize, affected: impl Fn(usize) -> bool, reverse: bool) -> Vec<Option<Phase>> {
    let mut phases = vec![None; len];
    let mut start = None;
    for index in 0..=len {
        if index < len && affected(index) {
            start.get_or_insert(index);
            continue;
        }
        let Some(run_start) = start.take() else {
            continue;
        };
        let run = index - run_start;
        for offset in 0..run {
            let slot = if reverse { run - offset - 1 } else { offset };
            phases[run_start + offset] = Some(Phase {
                start: slot as f32 / run as f32,
                end: (slot + 1) as f32 / run as f32,
            });
        }
    }
    phases
}

/// What one row slot paints this frame.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(in crate::shell) struct RowFrame {
    /// Vertical offset from its slot.
    pub offset: f32,
    /// Visible share of the row from its top (`None`: all of it).
    pub reveal: Option<f32>,
}

/// The Explorer's motion state: the last committed rows and the running plan.
#[derive(Default)]
pub(in crate::shell) struct TreeMotion {
    tree: u64,
    revision: u64,
    committed: Vec<Row>,
    running: Option<(Plan, Timeline)>,
}
impl TreeMotion {
    /// Commits `rows` (revision `revision` of tree `tree`) and starts a plan
    /// from the previous commit of the same tree. Returns whether a plan runs
    /// and the frame needs repainting.
    pub fn sync(
        &mut self,
        tree: u64,
        revision: u64,
        rows: &[Row],
        stride: f32,
        animate: bool,
    ) -> bool {
        if revision != self.revision {
            let same_tree = std::mem::replace(&mut self.tree, tree) == tree;
            self.revision = revision;
            self.running = (animate && same_tree)
                .then(|| plan(&self.committed, rows, stride))
                .flatten()
                .map(|plan| (plan, Timeline::start(DURATION)));
            self.committed = rows.to_vec();
        }
        if self
            .running
            .as_ref()
            .is_some_and(|(_, timeline)| timeline.finished())
        {
            self.running = None;
        }
        self.running.is_some()
    }
    /// Eased progress of the running plan.
    fn eased(&self) -> Option<(&Plan, f32)> {
        let (plan, timeline) = self.running.as_ref()?;
        Some((plan, progress(timeline.time())))
    }
    /// Row `index` of the current projection.
    pub fn row(&self, index: usize) -> RowFrame {
        let Some((plan, eased)) = self.eased() else {
            return RowFrame::default();
        };
        match plan.rows.get(index).copied().flatten() {
            Some(RowMotion::Enter(phase)) => RowFrame {
                offset: 0.,
                reveal: Some(phase.local(eased)),
            },
            Some(RowMotion::Move(offset)) => RowFrame {
                offset: offset * (1. - eased),
                reveal: None,
            },
            None => RowFrame::default(),
        }
    }
    /// The list-end row (after the last row).
    pub fn list_end(&self) -> RowFrame {
        match self.eased() {
            Some((plan, eased)) => RowFrame {
                offset: plan.list_end_offset * (1. - eased),
                reveal: None,
            },
            None => RowFrame::default(),
        }
    }
    /// The disclosure marker's turn (0 closed, 1 open) while it animates.
    pub fn disclosure(&self, index: usize) -> Option<f32> {
        let (plan, eased) = self.eased()?;
        plan.toggled
            .get(&index)
            .map(|&open| if open { eased } else { 1. - eased })
    }
    /// Ghosts whose old slot lies in `slots`, with their visible share.
    pub fn ghosts(&self, slots: std::ops::Range<usize>) -> Vec<(&Ghost, f32)> {
        let Some((plan, eased)) = self.eased() else {
            return vec![];
        };
        plan.ghosts
            .iter()
            .filter(|ghost| slots.contains(&ghost.index))
            .map(|ghost| (ghost, 1. - ghost.phase.local(eased)))
            .filter(|(_, visible)| *visible > 0.)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::path::PathBuf;

    fn row(path: &str, folder: bool, expanded: bool) -> Row {
        Row {
            path: PathBuf::from(path),
            name: path.rsplit('/').next().unwrap().into(),
            folder,
            expanded,
            depth: path.matches('/').count(),
            display: path.into(),
            extension: None,
            error: None,
        }
    }

    #[test]
    fn the_curve_is_a_symmetric_jerk_limited_trapezoid() {
        assert_eq!(progress(0.), 0.);
        assert!((progress(1.) - 1.).abs() < 1e-6);
        assert!((progress(0.5) - 0.5).abs() < 1e-6);
        for step in 1..50 {
            let t = step as f32 / 50.;
            assert!(
                (progress(t) + progress(1. - t) - 1.).abs() < 1e-5,
                "symmetric at {t}"
            );
            assert!(progress(t) > progress(t - 0.02), "monotonic at {t}");
        }
        // A smooth start: slower than linear early, constant speed mid-way.
        assert!(progress(0.1) < 0.1);
        let speed = (progress(0.55) - progress(0.45)) / 0.1;
        assert!((speed - 1. / (1. - RAMP)).abs() < 1e-4);
    }

    #[test]
    fn opening_a_folder_reveals_its_rows_in_order_and_pushes_the_rest_down() {
        let before = [row("a", true, false), row("b", false, false)];
        let after = [
            row("a", true, true),
            row("a/1", false, false),
            row("a/2", false, false),
            row("b", false, false),
        ];
        let plan = plan(&before, &after, 34.).unwrap();
        assert_eq!(plan.rows[0], None);
        assert_eq!(
            plan.rows[1],
            Some(RowMotion::Enter(Phase {
                start: 0.,
                end: 0.5
            }))
        );
        assert_eq!(
            plan.rows[2],
            Some(RowMotion::Enter(Phase {
                start: 0.5,
                end: 1.
            }))
        );
        // "b" starts two rows higher, where it was.
        assert_eq!(plan.rows[3], Some(RowMotion::Move(-68.)));
        assert_eq!(plan.toggled.get(&0), Some(&true));
        assert!(plan.ghosts.is_empty());
        assert_eq!(plan.list_end_offset, -68.);
    }

    #[test]
    fn closing_a_folder_clips_its_rows_away_last_first() {
        let before = [
            row("a", true, true),
            row("a/1", false, false),
            row("a/2", false, false),
            row("b", false, false),
        ];
        let after = [row("a", true, false), row("b", false, false)];
        let plan = plan(&before, &after, 34.).unwrap();
        assert_eq!(plan.rows[1], Some(RowMotion::Move(68.)));
        assert_eq!(plan.toggled.get(&0), Some(&false));
        let ghosts: Vec<_> = plan.ghosts.iter().map(|g| (g.index, g.phase)).collect();
        assert_eq!(
            ghosts,
            [
                (
                    1,
                    Phase {
                        start: 0.5,
                        end: 1.
                    }
                ),
                (
                    2,
                    Phase {
                        start: 0.,
                        end: 0.5
                    }
                )
            ]
        );
    }

    #[test]
    fn hydration_and_a_different_project_do_not_animate() {
        let rows = [row("a", false, false)];
        assert!(plan(&[], &rows, 34.).is_none());
        assert!(plan(&rows, &[row("z", false, false)], 34.).is_none());
        assert!(plan(&rows, &rows, 34.).is_none());
    }

    #[test]
    fn a_new_revision_starts_a_plan_that_ends_after_its_duration() {
        let mut motion = TreeMotion::default();
        let closed = [row("a", true, false), row("b", false, false)];
        let open = [
            row("a", true, true),
            row("a/1", false, false),
            row("b", false, false),
        ];
        assert!(!motion.sync(7, 1, &closed, 34., true), "hydration");
        assert!(motion.sync(7, 2, &open, 34., true));
        // A frame just after the start: still where everything was.
        assert!((motion.row(2).offset + 34.).abs() < 0.01);
        assert!(motion.row(1).reveal.unwrap() < 0.001);
        assert!(motion.disclosure(0).unwrap() < 0.001);
        motion.running.as_mut().unwrap().1.advance(DURATION);
        assert!(!motion.sync(7, 2, &open, 34., true));
        assert_eq!(motion.row(2), RowFrame::default());
        // Reduced motion commits without a plan.
        assert!(!motion.sync(7, 3, &closed, 34., false));
        // A replaced tree (another project) is not a disclosure.
        assert!(!motion.sync(8, 4, &open, 34., true));
    }
}
