//! Port of `workbenchSessionHeaderLayout.ts` (`resolveWorkbenchSessionHeaderLayout`)
//! and the capacity rule of `useWorkbenchSessionHeaderLayout.ts`. Pure; no GPUI.
use super::layout::Id;

/// `WORKBENCH_SESSION_HEADER_METRICS`.
pub const GAP: f32 = 3.;
pub const FULL_MAXIMUM: f32 = 144.;
pub const FULL_MINIMUM: f32 = 104.;
pub const COMPACT: f32 = 28.;
pub const OVERFLOW_CONTROL: f32 = 28.;
pub const CREATE_CONTROL: f32 = 28.;
pub const ABSOLUTE_ACTIVE_MINIMUM: f32 = 64.;
/// `.desktop-terminal-subheader` block size and padding (`4px 6px 6px`).
pub const HEADER_HEIGHT: f32 = 38.;
pub const HEADER_PADDING_TOP: f32 = 4.;
pub const HEADER_PADDING_INLINE: f32 = 6.;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    Full,
    Compact,
    Overflow,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TabBounds {
    pub id: Id,
    pub inline_start: f32,
    pub width: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HeaderLayout {
    pub mode: Mode,
    pub tabs: Vec<TabBounds>,
    pub tabs_width: f32,
    pub visible: Vec<Id>,
    pub hidden: Vec<Id>,
}

/// Rail capacity for a group of `group_width`: the header's content box minus
/// the trailing create control and its gap (one trailing control).
pub fn available_width(group_width: f32) -> f32 {
    let capacity = (group_width - 2. * HEADER_PADDING_INLINE).floor();
    (capacity - CREATE_CONTROL - GAP).max(0.)
}

/// The active session is always visible; overflow keeps its nearest siblings
/// in stable order and preserves an already rendered window when possible.
pub fn resolve(ids: &[Id], active: Option<Id>, available: f32, preferred: &[Id]) -> HeaderLayout {
    let count = ids.len();
    if count == 0 {
        return HeaderLayout {
            mode: Mode::Full,
            tabs: vec![],
            tabs_width: 0.,
            visible: vec![],
            hidden: vec![],
        };
    }
    let active = active.filter(|a| ids.contains(a)).unwrap_or(ids[0]);
    let width = available.floor().max(0.);
    let all = |mode, tab_width| create(mode, active, tab_width, tab_width, ids, vec![]);
    if width == 0. {
        return all(Mode::Full, FULL_MAXIMUM);
    }
    let full = ((width - GAP * (count as f32 - 1.)) / count as f32).floor();
    if full >= FULL_MINIMUM {
        return all(Mode::Full, full.min(FULL_MAXIMUM));
    }
    let compact_active = width - (count as f32 - 1.) * COMPACT - GAP * (count as f32 - 1.);
    if compact_active >= FULL_MINIMUM {
        return create(
            Mode::Compact,
            active,
            compact_active.min(FULL_MAXIMUM),
            COMPACT,
            ids,
            vec![],
        );
    }
    let for_compact = (width - FULL_MINIMUM - OVERFLOW_CONTROL - GAP).max(0.);
    let inactive = (count - 1).min((for_compact / (COMPACT + GAP)).floor() as usize);
    let visible = if preserves(active, preferred, ids, inactive + 1) {
        preferred.to_vec()
    } else {
        nearest(ids, active, inactive)
    };
    let active_width = (width - OVERFLOW_CONTROL - GAP - inactive as f32 * (COMPACT + GAP))
        .clamp(ABSOLUTE_ACTIVE_MINIMUM, FULL_MAXIMUM);
    let hidden = ids
        .iter()
        .copied()
        .filter(|id| !visible.contains(id))
        .collect();
    create(
        Mode::Overflow,
        active,
        active_width,
        COMPACT,
        &visible,
        hidden,
    )
}

fn create(
    mode: Mode,
    active: Id,
    active_width: f32,
    inactive_width: f32,
    visible: &[Id],
    hidden: Vec<Id>,
) -> HeaderLayout {
    let mut start = 0.;
    let tabs: Vec<TabBounds> = visible
        .iter()
        .map(|&id| {
            let width = if id == active {
                active_width
            } else {
                inactive_width
            };
            let bounds = TabBounds {
                id,
                inline_start: start,
                width,
            };
            start += width + GAP;
            bounds
        })
        .collect();
    HeaderLayout {
        mode,
        tabs_width: if tabs.is_empty() { 0. } else { start - GAP },
        tabs,
        visible: visible.to_vec(),
        hidden,
    }
}

fn preserves(active: Id, preferred: &[Id], ids: &[Id], count: usize) -> bool {
    if preferred.len() != count || !preferred.contains(&active) {
        return false;
    }
    let mut previous = None;
    for id in preferred {
        let Some(index) = ids.iter().position(|x| x == id) else {
            return false;
        };
        if previous.is_some_and(|p| index <= p) {
            return false;
        }
        previous = Some(index);
    }
    true
}

fn nearest(ids: &[Id], active: Id, count: usize) -> Vec<Id> {
    let active_index = ids.iter().position(|&id| id == active).unwrap_or(0);
    let mut others: Vec<usize> = (0..ids.len()).filter(|&i| i != active_index).collect();
    others.sort_by_key(|&i| (i.abs_diff(active_index), i));
    let mut chosen: Vec<usize> = others.into_iter().take(count).collect();
    chosen.push(active_index);
    chosen.sort_unstable();
    chosen.into_iter().map(|i| ids[i]).collect()
}

/// `layoutMotionMs`.
pub const LAYOUT_MOTION: std::time::Duration = std::time::Duration::from_millis(200);

/// An element of the header rail that moves (`useWorkbenchSessionHeaderMotion`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Part {
    Tab(Id),
    Overflow,
    Create,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Span {
    pub x: f32,
    pub width: f32,
}
#[derive(Clone, Copy, Debug)]
struct Track {
    from: Span,
    to: Span,
    started: std::time::Instant,
}
/// One layout transaction retargets every visible element from where it is
/// drawn now: a new tab grows from its neighbour's edge, the overflow control
/// from the create control, all over 200ms on `cubic-bezier(0.2, 0, 0, 1)`.
#[derive(Default)]
pub struct Motion {
    tracks: std::collections::HashMap<Part, Track>,
    last: Option<(Vec<(Part, Span)>, bool)>,
}
impl Motion {
    /// The spans to draw now for `targets` (rail order); `true` while any
    /// element is still moving.
    pub fn frame(
        &mut self,
        targets: &[(Part, Span)],
        enabled: bool,
        now: std::time::Instant,
    ) -> (Vec<(Part, Span)>, bool) {
        let changed = self
            .last
            .as_ref()
            .is_none_or(|(last, was)| *was != enabled || last.as_slice() != targets);
        if changed {
            let first = self.last.is_none();
            let mut starts: std::collections::HashMap<Part, Span> = targets
                .iter()
                .filter_map(|(part, _)| self.tracks.get(part).map(|t| (*part, t.at(now))))
                .collect();
            let tabs: Vec<(usize, Part)> = targets
                .iter()
                .enumerate()
                .filter(|(_, (p, _))| matches!(p, Part::Tab(_)))
                .map(|(i, (p, _))| (i, *p))
                .collect();
            for (k, &(i, part)) in tabs.iter().enumerate() {
                if starts.contains_key(&part) {
                    continue;
                }
                let before = k
                    .checked_sub(1)
                    .and_then(|b| starts.get(&tabs[b].1).copied());
                let after = tabs[k + 1..]
                    .iter()
                    .find_map(|(_, p)| starts.get(p).copied());
                let x = match (before, after) {
                    (Some(b), _) => b.x + b.width + GAP,
                    (None, Some(a)) => a.x,
                    (None, None) => targets[i].1.x,
                };
                starts.insert(part, Span { x, width: 0. });
            }
            if !starts.contains_key(&Part::Overflow)
                && let Some((_, target)) = targets.iter().find(|(p, _)| *p == Part::Overflow)
            {
                let x = starts.get(&Part::Create).map_or(target.x, |c| c.x);
                starts.insert(Part::Overflow, Span { x, width: 0. });
            }
            let animate = enabled && !first;
            self.tracks = targets
                .iter()
                .map(|&(part, to)| {
                    let from = if animate {
                        starts
                            .get(&part)
                            .copied()
                            .unwrap_or(Span { width: 0., ..to })
                    } else {
                        to
                    };
                    (
                        part,
                        Track {
                            from,
                            to,
                            started: now,
                        },
                    )
                })
                .collect();
            self.last = Some((targets.to_vec(), enabled));
        }
        let mut moving = false;
        let spans = targets
            .iter()
            .map(|&(part, to)| {
                let span = self.tracks.get(&part).map_or(to, |t| {
                    moving |= t.moving(now);
                    t.at(now)
                });
                (part, span)
            })
            .collect();
        (spans, moving)
    }
}
impl Track {
    fn progress(&self, now: std::time::Instant) -> f32 {
        let t =
            now.saturating_duration_since(self.started).as_secs_f32() / LAYOUT_MOTION.as_secs_f32();
        ease(t.clamp(0., 1.))
    }
    fn moving(&self, now: std::time::Instant) -> bool {
        self.from != self.to && now.saturating_duration_since(self.started) < LAYOUT_MOTION
    }
    fn at(&self, now: std::time::Instant) -> Span {
        let p = self.progress(now);
        Span {
            x: self.from.x + (self.to.x - self.from.x) * p,
            width: self.from.width + (self.to.width - self.from.width) * p,
        }
    }
}
/// `cubic-bezier(0.2, 0, 0, 1)` at time `t`.
fn ease(t: f32) -> f32 {
    if t <= 0. {
        return 0.;
    }
    if t >= 1. {
        return 1.;
    }
    let bezier = |p1: f32, p2: f32, s: f32| {
        3. * (1. - s) * (1. - s) * s * p1 + 3. * (1. - s) * s * s * p2 + s * s * s
    };
    let (mut low, mut high) = (0f32, 1f32);
    for _ in 0..24 {
        let mid = (low + high) / 2.;
        if bezier(0.2, 0., mid) < t {
            low = mid;
        } else {
            high = mid;
        }
    }
    bezier(0., 1., (low + high) / 2.)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn layout_changes_animate_from_where_elements_are_drawn() {
        use std::time::{Duration, Instant};
        let span = |x: f32, width: f32| Span { x, width };
        let t0 = Instant::now();
        let mut motion = Motion::default();
        let one = [
            (Part::Tab(1), span(0., 144.)),
            (Part::Create, span(147., 28.)),
        ];
        // The first layout never animates.
        assert_eq!(motion.frame(&one, true, t0), (one.to_vec(), false));
        // A new tab grows from its neighbour's edge; the others move.
        let two = [
            (Part::Tab(1), span(0., 104.)),
            (Part::Tab(2), span(107., 144.)),
            (Part::Create, span(254., 28.)),
        ];
        let (start, moving) = motion.frame(&two, true, t0);
        assert!(moving);
        assert_eq!(start[1].1, span(147., 0.));
        assert_eq!(start[2].1, span(147., 28.));
        let (mid, _) = motion.frame(&two, true, t0 + Duration::from_millis(100));
        assert!(mid[1].1.width > 72. && mid[1].1.width < 144.);
        let (end, moving) = motion.frame(&two, true, t0 + LAYOUT_MOTION);
        assert_eq!((end, moving), (two.to_vec(), false));
        // Disabled (a drag): the layout snaps.
        let (snapped, moving) = motion.frame(&one, false, t0 + LAYOUT_MOTION);
        assert_eq!((snapped, moving), (one.to_vec(), false));
        assert!((ease(0.5) - 0.5).abs() > 0.1 && ease(1.) > 0.999 && ease(0.) < 0.001);
    }
    fn widths(layout: &HeaderLayout) -> Vec<f32> {
        layout.tabs.iter().map(|t| t.width).collect()
    }
    #[test]
    fn full_tabs_share_the_rail_up_to_their_maximum() {
        // 420px group (artifacts/workbench-reference/chat-transcript-*.json): 3 × 123px.
        let layout = resolve(&[1, 2, 3], Some(1), available_width(420.), &[]);
        assert_eq!(layout.mode, Mode::Full);
        assert_eq!(widths(&layout), vec![123., 123., 123.]);
        assert_eq!(layout.tabs[2].inline_start, 252.);
        assert_eq!(layout.tabs_width, 375.);
        let single = resolve(&[1], Some(1), available_width(420.), &[]);
        assert_eq!(widths(&single), vec![144.]);
    }
    #[test]
    fn narrow_rails_compact_inactive_tabs_then_overflow() {
        // 300px group with five tabs (tabs-narrow-*): active 133px, four compact.
        let layout = resolve(&[1, 2, 3, 4, 5], Some(1), available_width(300.), &[]);
        assert_eq!(layout.mode, Mode::Compact);
        assert_eq!(widths(&layout), vec![133., 28., 28., 28., 28.]);
        assert_eq!(layout.tabs_width, 257.);
        let overflow = resolve(&[1, 2, 3, 4, 5, 6, 7], Some(4), available_width(240.), &[]);
        assert_eq!(overflow.mode, Mode::Overflow);
        assert!(overflow.visible.contains(&4));
        assert_eq!(overflow.visible.len() + overflow.hidden.len(), 7);
        // The nearest siblings of the active tab stay visible, in order.
        assert_eq!(overflow.visible, vec![3, 4, 5]);
        // An already rendered window survives activating a visible sibling.
        let kept = resolve(
            &[1, 2, 3, 4, 5, 6, 7],
            Some(5),
            available_width(240.),
            &overflow.visible,
        );
        assert_eq!(kept.visible, overflow.visible);
    }
}
