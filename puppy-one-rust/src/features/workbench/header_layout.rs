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

#[cfg(test)]
mod tests {
    use super::*;
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
