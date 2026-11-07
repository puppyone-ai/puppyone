//! The Homepage's projects: `OnboardingProjectToolbar` (filter and sort),
//! `OnboardingProjectLayoutSwitch`, `OnboardingEntryMenu`,
//! `OnboardingProjectList` (the List and the Grid), `LinkedCloudProjectButton`
//! and `useProjectListNavigation`.
//!
//! A project is lit while the pointer is on it, a key has focused it, or its
//! menu is open: its row fills, its folder leans to the ink and lifts its
//! sheet, its time gives way to its actions. The list is one Tab stop (a
//! roving stop, the project last focused); the arrow keys move inside it.
use super::*;
use crate::features::settings::preference_types::{HomepageLayout, HomepageSort};
use gpui_kit::base::Selectable as _;
use std::collections::BTreeSet;
mod list;
mod toolbar;

/// `PROJECT_HOME_PLACES`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(in crate::app) enum Place {
    Local,
    Cloud,
}
/// A local project dragged out of the Homepage: its absolute path.
#[derive(Clone)]
pub(in crate::app) struct ProjectDrag {
    pub path: String,
    label: SharedString,
    /// The system draws the drag (it can leave the window).
    native: bool,
}
impl Render for ProjectDrag {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        if self.native {
            return div();
        }
        div()
            .px(px(10.))
            .py(px(6.))
            .rounded(px(6.))
            .bg(t.menu_bg)
            .border_1()
            .border_color(t.border)
            .text_color(t.text)
            .text_size(px(theme::ty().ui.body))
            .opacity(0.9)
            .child(self.label.clone())
    }
}

pub(super) fn place_of(item: &Item) -> Place {
    if item.local_path.is_some() {
        Place::Local
    } else {
        Place::Cloud
    }
}
/// The Homepage's own menus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app) enum HomeMenu {
    Filter,
    Sort,
    Layout,
    Entry,
}

/// The Grid's cells: `repeat(auto-fill, minmax(112px, 1fr))`, 2px apart.
const CELL_MIN: f32 = 112.;
const CELL_GAP: f32 = 2.;
/// `--po-scrollbar-size`: the list's lane hangs outside the column.
const SCROLLBAR_SIZE: f32 = 12.;
/// The sheet's `transition: transform 220ms ease-out`.
const SHEET_MS: f32 = 220.;
/// `.onboarding-view-menu.is-multiple` and its smallest width.
const MULTIPLE_MENU_WIDTH: f32 = 216.;
const VIEW_MENU_MIN_WIDTH: f32 = 104.;
/// `.onboarding-entry-menu`.
const ENTRY_MENU_WIDTH: f32 = 232.;

/// A choice with its tick (`menuitemradio` / `menuitemcheckbox`).
fn checked_item(item: MenuItem, checked: bool) -> MenuItem {
    if checked {
        item.trailing(Icon::new("check").small().stroke(1.85))
    } else {
        item
    }
}
/// `viewProjectHomeItems`: narrowed to the chosen places (none chosen is
/// every place), then by name (`Intl.Collator(numeric, base)`) or by
/// modification, newest first, unknown last, equals in catalog order.
pub(super) fn view_items(
    mut items: Vec<Item>,
    places: &BTreeSet<Place>,
    sort: HomepageSort,
    untitled: &str,
) -> Vec<Item> {
    items.retain(|item| places.is_empty() || places.contains(&place_of(item)));
    match sort {
        HomepageSort::Name => items.sort_by(|a, b| {
            collate(
                &super::item_name_or(a, untitled),
                &super::item_name_or(b, untitled),
            )
        }),
        HomepageSort::Modified => items.sort_by(|a, b| {
            let time = |i: &Item| i.modified.map_or(f64::NEG_INFINITY, |m| m as f64);
            time(b).total_cmp(&time(a))
        }),
    }
    items
}
/// `Intl.Collator(locale, {numeric: true, sensitivity: "base"})`: case and
/// accents fold, digit runs compare by value.
pub(super) fn collate(a: &str, b: &str) -> std::cmp::Ordering {
    use unicode_normalization::UnicodeNormalization as _;
    let fold = |s: &str| -> Vec<char> {
        s.nfkd()
            .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
            .flat_map(char::to_lowercase)
            .collect()
    };
    let (a, b) = (fold(a), fold(b));
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let run = |s: &[char], mut k: usize| {
                let start = k;
                while k < s.len() && s[k].is_ascii_digit() {
                    k += 1;
                }
                (s[start..k].iter().collect::<String>(), k)
            };
            let ((x, ni), (y, nj)) = (run(&a, i), run(&b, j));
            let (x, y) = (x.trim_start_matches('0'), y.trim_start_matches('0'));
            let order = x.len().cmp(&y.len()).then_with(|| x.cmp(y));
            if order != std::cmp::Ordering::Equal {
                return order;
            }
            (i, j) = (ni, nj);
            continue;
        }
        let order = a[i].cmp(&b[j]);
        if order != std::cmp::Ordering::Equal {
            return order;
        }
        i += 1;
        j += 1;
    }
    (a.len() - i).cmp(&(b.len() - j))
}
/// `settleShownDates`: a date learned after a project is on screen waits
/// for the next visit, so projects move only when someone asked them to.
pub(super) fn settle_dates(shown: &mut HashMap<String, i64>, items: &mut [Item]) {
    for item in items.iter_mut() {
        match shown.get(&item.id) {
            Some(date) => item.modified = Some(*date),
            None => {
                if let Some(date) = item.modified {
                    shown.insert(item.id.clone(), date);
                }
            }
        }
    }
}
/// `resolveTarget`: where a key leads from one project, or nowhere.
pub(super) fn key_target(
    key: &str,
    current: usize,
    last: usize,
    columns: usize,
    rtl: bool,
) -> Option<usize> {
    let columns = columns.max(1);
    match key {
        "home" => Some(0),
        "end" => Some(last),
        "up" => current.checked_sub(columns),
        "down" => {
            let next_row = (current / columns + 1) * columns;
            (next_row <= last).then(|| (current + columns).min(last))
        }
        "left" | "right" if columns > 1 => {
            let forward = (key == "right") != rtl;
            let target = if forward {
                current.checked_add(1)
            } else {
                current.checked_sub(1)
            };
            target.filter(|t| *t <= last)
        }
        _ => None,
    }
}
/// `columnsIn`: how many cells fit across the list's width.
pub(super) fn grid_columns(width: f32) -> usize {
    (((width + CELL_GAP) / (CELL_MIN + CELL_GAP)).floor() as usize).max(1)
}

impl Homepage {
    /// `useHomepageProjectView` with the page's own state applied, and the
    /// shown dates settled (called once per frame while the page shows).
    pub(super) fn sync_project_view(&mut self, cx: &mut Context<Self>) {
        if !self.session.home || self.list_held() {
            return;
        }
        let mut items = self.project_items(cx);
        settle_dates(&mut self.shown_dates, &mut items);
        // A place can empty out from under its filter (signing out).
        let present: BTreeSet<Place> = items.iter().map(place_of).collect();
        self.places.retain(|p| present.contains(p));
    }
    /// The projects the page shows, in the order it shows them.
    pub(in crate::app) fn visible_projects(&self, cx: &App) -> Vec<Item> {
        if self.list_held() {
            return vec![];
        }
        let mut items = self.project_items(cx);
        for item in &mut items {
            if let Some(date) = self.shown_dates.get(&item.id) {
                item.modified = Some(*date);
            }
        }
        let sort = self.preferences.read(cx).state.homepage_project_sort;
        view_items(
            items,
            &self.places,
            sort,
            tr("onboarding.projects.untitled"),
        )
    }
    /// The roving stop: the project last focused, else the first.
    fn project_stop(&self, items: &[Item]) -> Option<String> {
        self.stop
            .as_ref()
            .filter(|id| items.iter().any(|i| &i.id == *id))
            .cloned()
            .or_else(|| items.first().map(|i| i.id.clone()))
    }
    fn project_focus(&mut self, id: &str, cx: &mut Context<Self>) -> FocusHandle {
        self.focus
            .entry(id.to_owned())
            .or_insert_with(|| cx.focus_handle())
            .clone()
    }
    /// `true` while a project is reached for: pointer, key focus or menu.
    fn project_lit(&self, item: &Item, window: &Window, cx: &App) -> bool {
        self.hovered.as_deref() == Some(item.id.as_str())
            || self.actions.read(cx).item() == Some(item.id.as_str())
            || (window.last_input_was_keyboard()
                && self
                    .focus
                    .get(&item.id)
                    .is_some_and(|f| f.is_focused(window)))
    }
    /// How far a project's sheet has risen (0 at rest, 1 reached for),
    /// eased over 220ms and reversed from wherever it is.
    fn sheet_rise(&mut self, id: &str, lit: bool, window: &mut Window, cx: &App) -> f32 {
        let now = std::time::Instant::now();
        let reduce = cx.reduce_motion();
        let at = |(target, since, from): (bool, std::time::Instant, f32)| {
            let elapsed = now.duration_since(since).as_secs_f32() * 1000.;
            let progress = if reduce {
                1.
            } else {
                (elapsed / SHEET_MS).clamp(0., 1.)
            };
            // `ease-out`: cubic-bezier(0, 0, 0.58, 1).
            let eased = crate::ui::motion::cubic_bezier(0., 0., 0.58, 1., progress);
            let to = if target { 1. } else { 0. };
            (from + (to - from) * eased, progress)
        };
        let state =
            *self
                .sheets
                .entry(id.to_owned())
                .or_insert((lit, now, if lit { 1. } else { 0. }));
        let (current, progress) = at(state);
        if state.0 != lit {
            self.sheets.insert(id.to_owned(), (lit, now, current));
            window.request_animation_frame();
            return current;
        }
        if progress < 1. {
            window.request_animation_frame();
        }
        current
    }

    /// Opens the project at `index` of the visible list.
    pub(super) fn open_home_item_at(&mut self, index: usize, cx: &mut Context<Self>) {
        if let Some(item) = self.visible_projects(cx).get(index).cloned() {
            self.open_item(&item, cx);
        }
    }
    /// `.onboarding-project-row-wrap.is-dragging`.
    fn dragging_item(&self, item: &Item, cx: &App) -> bool {
        item.local_path.is_some()
            && cx.has_active_drag()
            && self.dragging_path.as_deref() == item.local_path.as_deref().map(str::trim)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn item(id: &str, local: bool, modified: Option<i64>) -> Item {
        Item {
            id: id.into(),
            label: id.into(),
            local_path: local.then(|| format!("/x/{id}")),
            cloud_project: (!local).then(|| id.into()),
            linked: None,
            actions: None,
            modified,
        }
    }

    #[test]
    fn the_view_narrows_to_places_and_orders_like_the_product() {
        let items = vec![
            item("b", true, Some(10)),
            item("a10", false, None),
            item("a2", true, Some(30)),
        ];
        let all = view_items(
            items.clone(),
            &BTreeSet::new(),
            HomepageSort::Modified,
            "Untitled",
        );
        let ids: Vec<_> = all.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["a2", "b", "a10"], "unknown dates last");
        let named = view_items(
            items.clone(),
            &BTreeSet::new(),
            HomepageSort::Name,
            "Untitled",
        );
        let ids: Vec<_> = named.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["a2", "a10", "b"], "numeric collation");
        let cloud = view_items(
            items,
            &[Place::Cloud].into(),
            HomepageSort::Modified,
            "Untitled",
        );
        assert_eq!(cloud.len(), 1);
        assert_eq!(collate("Équipe", "equipe"), std::cmp::Ordering::Equal);
    }

    #[test]
    fn dates_learned_after_a_project_shows_wait_for_the_next_visit() {
        let mut shown = HashMap::new();
        let mut first = vec![item("a", true, Some(5)), item("b", true, None)];
        settle_dates(&mut shown, &mut first);
        let mut later = vec![item("a", true, Some(50)), item("b", true, Some(40))];
        settle_dates(&mut shown, &mut later);
        assert_eq!(later[0].modified, Some(5), "a keeps its first date");
        assert_eq!(later[1].modified, Some(40), "b had none to keep");
    }

    #[test]
    fn keys_walk_rows_and_cells_like_the_product() {
        // A list: up and down only.
        assert_eq!(key_target("down", 0, 3, 1, false), Some(1));
        assert_eq!(key_target("up", 0, 3, 1, false), None);
        assert_eq!(key_target("right", 0, 3, 1, false), None);
        // A grid of three columns over eight cells.
        assert_eq!(key_target("down", 1, 7, 3, false), Some(4));
        assert_eq!(
            key_target("down", 5, 7, 3, false),
            Some(7),
            "clamped to the last"
        );
        assert_eq!(key_target("down", 6, 7, 3, false), None);
        assert_eq!(key_target("right", 2, 7, 3, false), Some(3));
        assert_eq!(key_target("right", 2, 7, 3, true), Some(1), "RTL");
        assert_eq!(key_target("end", 0, 7, 3, false), Some(7));
        assert_eq!(grid_columns(640.), 5);
        assert_eq!(grid_columns(100.), 1);
    }
}
