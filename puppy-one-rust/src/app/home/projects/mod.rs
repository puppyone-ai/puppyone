//! The Homepage's projects:
//! - `toolbar` — `OnboardingProjectToolbar` (sort & layout), `New project`'s Agents
//! - `groups_view` — `OnboardingProjectGroups` (place audiences, scroller, drop zones)
//! - `tile` — Grid cell (`104 × 78` `ProjectFolderGlyph` + name + one caption)
//! - `row` — List row (`34 × 26` `ProjectFolderGlyph`, `open_control`, actions)
mod groups_view;
mod row;
mod tile;
mod toolbar;

pub(in crate::app::home) use groups_view::SpacesUnavailableNote;

use super::*;
use crate::features::settings::{HomepageLayout, HomepageSort};
use gpui_kit::base::Selectable as _;

/// A local project dragged on the Homepage: its absolute path. It stays a
/// drag inside the page (so a group can take it) until the pointer leaves
/// the window, where the system takes over and carries the path as text.
#[derive(Clone)]
pub(in crate::app) struct ProjectDrag {
    pub path: String,
    pub(super) label: SharedString,
    /// The system draws the drag now (it left the window).
    pub(super) native: std::rc::Rc<std::cell::Cell<bool>>,
}

impl Render for ProjectDrag {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        if self.native.get() {
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

/// The Homepage's own menus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app) enum HomeMenu {
    Sort,
    Layout,
    /// `New project`'s Agents.
    NewProject,
    /// The create dialog's team selector.
    CreateTeam,
}

/// Five Finder-proportioned folders across the page, sharing equal cells down
/// to the smallest window (`grid-template-columns: repeat(5, minmax(0, 1fr))`).
pub(super) const GRID_COLUMNS: usize = 5;
/// `--onboarding-tile-gap`: `14px` above `820px` viewport width, `10px` at or below.
pub(super) fn grid_column_gap(viewport_w: f32) -> f32 {
    if viewport_w <= 820. { 10. } else { 14. }
}
/// Grid rows are `12px` apart (`row-gap: 12px`).
pub(super) const CELL_ROW_GAP: f32 = 12.;
/// `--po-scrollbar-size`: the list's lane hangs outside the column.
pub(super) const SCROLLBAR_SIZE: f32 = 12.;
/// `.onboarding-view-menu`'s smallest width.
pub(super) const VIEW_MENU_MIN_WIDTH: f32 = 104.;

/// A choice with its tick (`menuitemradio` / `menuitemcheckbox`).
pub(super) fn checked_item(item: MenuItem, checked: bool) -> MenuItem {
    if checked {
        item.trailing(Icon::new("check").small().stroke(1.85))
    } else {
        item
    }
}

/// `viewProjectHomeItems`: by name (`Intl.Collator(numeric, base)`) or by
/// modification, newest first, unknown last, equals in catalog order.
pub(super) fn view_items(mut items: Vec<Item>, sort: HomepageSort, untitled: &str) -> Vec<Item> {
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

/// Equal cell width for `GRID_COLUMNS` across `width` with `col_gap` gutters.
pub(super) fn grid_cell_width(width: f32, col_gap: f32) -> f32 {
    ((width - col_gap * (GRID_COLUMNS.saturating_sub(1) as f32)) / GRID_COLUMNS as f32).max(0.)
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
        view_items(items, sort, tr("onboarding.projects.untitled"))
    }

    /// A list's roving stop: the project last focused in it, else its first.
    pub(super) fn project_stop(&self, items: &[Item]) -> Option<String> {
        self.stop
            .as_ref()
            .filter(|id| items.iter().any(|i| &i.id == *id))
            .cloned()
            .or_else(|| items.first().map(|i| i.id.clone()))
    }

    pub(super) fn project_focus(&mut self, id: &str, cx: &mut Context<Self>) -> FocusHandle {
        self.focus
            .entry(id.to_owned())
            .or_insert_with(|| cx.focus_handle())
            .clone()
    }

    /// `true` while a project is reached for: pointer, key focus or menu.
    pub(super) fn project_lit(&self, item: &Item, window: &Window, cx: &App) -> bool {
        self.hovered.as_deref() == Some(item.id.as_str())
            || self.actions.read(cx).item() == Some(item.id.as_str())
            || (window.last_input_was_keyboard()
                && self
                    .focus
                    .get(&item.id)
                    .is_some_and(|f| f.is_focused(window)))
    }

    /// `.onboarding-project-row-wrap.is-dragging`.
    pub(super) fn dragging_item(&self, item: &Item, cx: &App) -> bool {
        item.local_path.is_some()
            && cx.has_active_drag()
            && self.dragging_path.as_deref() == item.local_path.as_deref().map(str::trim)
    }

    pub(super) fn item_shared(&self, item: &Item) -> bool {
        item.host_folder
            .as_ref()
            .is_some_and(|id| self.shared_ids.as_ref().is_none_or(|ids| ids.contains(id)))
    }

    /// A stable index for a project's element ids across groups.
    pub(super) fn cell_index(&self, id: &str) -> usize {
        let mut hash: usize = 5381;
        for byte in id.bytes() {
            hash = hash.wrapping_mul(33) ^ byte as usize;
        }
        hash
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
            cloud_organization: None,
            host_folder: None,
            remote: None,
        }
    }

    #[test]
    fn the_view_orders_like_the_product() {
        let items = vec![
            item("b", true, Some(10)),
            item("a10", false, None),
            item("a2", true, Some(30)),
        ];
        let all = view_items(items.clone(), HomepageSort::Modified, "Untitled");
        let ids: Vec<_> = all.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["a2", "b", "a10"], "unknown dates last");
        let named = view_items(items, HomepageSort::Name, "Untitled");
        let ids: Vec<_> = named.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["a2", "a10", "b"], "numeric collation");
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
        assert_eq!(key_target("down", 0, 3, 1, false), Some(1));
        assert_eq!(key_target("up", 0, 3, 1, false), None);
        assert_eq!(key_target("right", 0, 3, 1, false), None);
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
        assert_eq!(grid_column_gap(900.), 14.);
        assert_eq!(grid_column_gap(820.), 10.);
        assert!((grid_cell_width(760., 14.) - 140.8).abs() < 0.01);
    }
}
