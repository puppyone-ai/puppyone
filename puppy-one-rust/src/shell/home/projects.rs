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

/// `PROJECT_HOME_PLACES`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(in crate::shell) enum Place {
    Local,
    Cloud,
}
/// A local project dragged out of the Homepage: its absolute path.
#[derive(Clone)]
pub(in crate::shell) struct ProjectDrag {
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
pub(in crate::shell) enum HomeMenu {
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

impl Shell {
    /// `useHomepageProjectView` with the page's own state applied, and the
    /// shown dates settled (called once per frame while the page shows).
    pub(super) fn sync_project_view(&mut self, cx: &mut Context<Self>) {
        if !self.home_visible() || self.homepage.list_held() {
            return;
        }
        let mut items = self.project_items(cx);
        settle_dates(&mut self.homepage.shown_dates, &mut items);
        // A place can empty out from under its filter (signing out).
        let present: BTreeSet<Place> = items.iter().map(place_of).collect();
        self.homepage.places.retain(|p| present.contains(p));
    }
    /// The projects the page shows, in the order it shows them.
    pub(in crate::shell) fn visible_projects(&self, cx: &App) -> Vec<Item> {
        if self.homepage.list_held() {
            return vec![];
        }
        let mut items = self.project_items(cx);
        for item in &mut items {
            if let Some(date) = self.homepage.shown_dates.get(&item.id) {
                item.modified = Some(*date);
            }
        }
        let sort = self.preferences.read(cx).state.homepage_project_sort;
        view_items(
            items,
            &self.homepage.places,
            sort,
            tr("onboarding.projects.untitled"),
        )
    }
    /// The roving stop: the project last focused, else the first.
    fn project_stop(&self, items: &[Item]) -> Option<String> {
        self.homepage
            .stop
            .as_ref()
            .filter(|id| items.iter().any(|i| &i.id == *id))
            .cloned()
            .or_else(|| items.first().map(|i| i.id.clone()))
    }
    fn project_focus(&mut self, id: &str, cx: &mut Context<Self>) -> FocusHandle {
        self.homepage
            .focus
            .entry(id.to_owned())
            .or_insert_with(|| cx.focus_handle())
            .clone()
    }
    /// `true` while a project is reached for: pointer, key focus or menu.
    fn project_lit(&self, item: &Item, window: &Window) -> bool {
        self.homepage.hovered.as_deref() == Some(item.id.as_str())
            || self.homepage.actions.as_deref() == Some(item.id.as_str())
            || (window.last_input_was_keyboard()
                && self
                    .homepage
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
        let state = *self.homepage.sheets.entry(id.to_owned()).or_insert((
            lit,
            now,
            if lit { 1. } else { 0. },
        ));
        let (current, progress) = at(state);
        if state.0 != lit {
            self.homepage
                .sheets
                .insert(id.to_owned(), (lit, now, current));
            window.request_animation_frame();
            return current;
        }
        if progress < 1. {
            window.request_animation_frame();
        }
        current
    }

    // ------------------------------------------------------------- toolbar
    /// `OnboardingToolbarMenu`: a quiet control that opens its own menu,
    /// centred under it; its tooltip says what it is set to.
    #[allow(clippy::too_many_arguments)]
    fn view_menu(
        &self,
        menu: HomeMenu,
        icon: Icon,
        trigger_label: String,
        active: bool,
        disabled: bool,
        build: impl FnOnce(Menu) -> Menu + 'static,
        cx: &App,
    ) -> PopoverMenu {
        let open = self.homepage.menu == Some(menu) && !disabled;
        let host = self.weak.clone();
        let t = cx.palette();
        let trigger = IconButton::new(("home-view-menu", menu as usize), icon)
            .label(trigger_label)
            .selected(open)
            .when(active, |b| b.color(t.text))
            .disabled(disabled);
        let multiple = menu == HomeMenu::Filter;
        PopoverMenu::new(("home-view-menu-popover", menu as usize))
            .anchor(Anchor::TopCenter)
            .offset(px(metric::MENU_PADDING))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    let is = s.homepage.menu == Some(menu);
                    if *opened != is {
                        s.homepage.menu = opened.then_some(menu);
                        cx.notify();
                    }
                });
            })
            .trigger(trigger)
            .menu(move |surface, _, _| {
                let surface = surface.min_w(px(VIEW_MENU_MIN_WIDTH));
                build(if multiple {
                    surface.w(px(MULTIPLE_MENU_WIDTH))
                } else {
                    surface
                })
            })
    }
    /// `OnboardingProjectToolbar` + the layout switch: chips for the places
    /// in force, then Filter, Sort and Layout, aligned to the end.
    pub(super) fn project_toolbar(&self, disabled: bool, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let prefs = &self.preferences.read(cx).state;
        let (sort, layout) = (prefs.homepage_project_sort, prefs.homepage_project_layout);
        let present: BTreeSet<Place> = self.project_items(cx).iter().map(place_of).collect();
        let chosen: Vec<Place> = [Place::Local, Place::Cloud]
            .into_iter()
            .filter(|p| self.homepage.places.contains(p))
            .collect();
        let place_label = |place: Place| -> String {
            match place {
                Place::Local => tr(if cfg!(target_os = "macos") {
                    "shell.workspaceSwitcher.location.thisMac"
                } else {
                    "shell.workspaceSwitcher.location.thisComputer"
                })
                .into(),
                Place::Cloud => tr("onboarding.projects.filter.cloud").into(),
            }
        };
        let place_icon = |place: Place| {
            Icon::product(match place {
                Place::Local => ProductIcon::Local,
                Place::Cloud => ProductIcon::Cloud,
            })
            .small()
            .stroke(1.85)
        };
        let host = self.weak.clone();
        let chips = chosen.iter().map(|place| {
            let place = *place;
            let host = host.clone();
            // `.onboarding-filter-chip`.
            div()
                .id(("home-filter-chip", place as usize))
                .flex()
                .flex_shrink(1.)
                .min_w_0()
                .h(px(theme::control() - 4.))
                .items_center()
                .gap(px(4.))
                .pl(px(8.))
                .pr(px(6.))
                .rounded(px(metric::CONTROL_RADIUS))
                .bg(t.control)
                .text_color(t.text)
                .text_size(px(theme::ty().ui.caption))
                .when(!disabled, |d| {
                    d.cursor(theme::clickable_cursor())
                        .hover(move |s| s.bg(t.control_hover))
                        .on_click(move |_, _, cx| {
                            let _ = host.update(cx, |s, cx| {
                                s.homepage.places.remove(&place);
                                cx.notify();
                            });
                        })
                })
                .child(place_icon(place))
                .child(div().min_w_0().truncate().child(place_label(place)))
                .child(Icon::new("x").with_size(px(12.)).stroke(1.85))
        });
        let filter_label = tr("onboarding.projects.filter.label");
        let filter_trigger = if chosen.is_empty() {
            filter_label.to_owned()
        } else {
            format!(
                "{filter_label}: {}",
                chosen
                    .iter()
                    .map(|p| place_label(*p))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        let filter = {
            let host = host.clone();
            let chosen_set = self.homepage.places.clone();
            let entries: Vec<(Place, String, bool, bool)> = [Place::Local, Place::Cloud]
                .into_iter()
                .map(|p| {
                    (
                        p,
                        place_label(p),
                        chosen_set.contains(&p),
                        present.contains(&p),
                    )
                })
                .collect();
            let all_checked = chosen_set.is_empty();
            self.view_menu(
                HomeMenu::Filter,
                Icon::new("list-filter").small(),
                filter_trigger,
                !chosen.is_empty(),
                disabled,
                move |menu| {
                    let all = {
                        let host = host.clone();
                        checked_item(
                            MenuItem::new(tr("onboarding.projects.filter.all"))
                                .icon_sized(Icon::new("list-filter").small()),
                            all_checked,
                        )
                        .stay_open()
                        .on_click(move |_, cx| {
                            let _ = host.update(cx, |s, cx| {
                                s.homepage.places.clear();
                                cx.notify();
                            });
                        })
                    };
                    let mut menu = menu.item(all);
                    for (place, label, checked, available) in entries {
                        let host = host.clone();
                        menu = menu.item(
                            checked_item(
                                MenuItem::new(label)
                                    .icon_sized(place_icon(place))
                                    .disabled(!available),
                                checked,
                            )
                            .stay_open()
                            .on_click(move |_, cx| {
                                let _ = host.update(cx, |s, cx| {
                                    if !s.homepage.places.remove(&place) {
                                        s.homepage.places.insert(place);
                                    }
                                    cx.notify();
                                });
                            }),
                        );
                    }
                    menu
                },
                cx,
            )
        };
        let sort_label = tr("onboarding.projects.sort.label");
        let sort_name = |s: HomepageSort| {
            tr(match s {
                HomepageSort::Modified => "onboarding.projects.sort.modified",
                HomepageSort::Name => "onboarding.projects.sort.name",
            })
        };
        let sort_menu = {
            let prefs = self.preferences.clone();
            self.view_menu(
                HomeMenu::Sort,
                Icon::new("arrow-up-down").small(),
                format!("{sort_label}: {}", sort_name(sort)),
                false,
                disabled,
                move |menu| {
                    menu.items([HomepageSort::Modified, HomepageSort::Name].map(|option| {
                        let prefs = prefs.clone();
                        checked_item(MenuItem::new(sort_name(option)), sort == option).on_click(
                            move |_, cx| {
                                prefs.update(cx, |p, cx| {
                                    p.change(|p| p.homepage_project_sort = option, cx)
                                })
                            },
                        )
                    }))
                },
                cx,
            )
        };
        let layout_label = tr("onboarding.projects.layout.label");
        let layout_name = |l: HomepageLayout| {
            tr(match l {
                HomepageLayout::List => "onboarding.projects.layout.list",
                HomepageLayout::Grid => "onboarding.projects.layout.grid",
            })
        };
        let layout_icon = |l: HomepageLayout| {
            Icon::new(match l {
                HomepageLayout::List => "list",
                HomepageLayout::Grid => "layout-grid",
            })
            .with_size(px(15.))
        };
        let layout_menu = {
            let prefs = self.preferences.clone();
            self.view_menu(
                HomeMenu::Layout,
                layout_icon(layout),
                format!("{layout_label}: {}", layout_name(layout)),
                false,
                disabled,
                move |menu| {
                    menu.items([HomepageLayout::List, HomepageLayout::Grid].map(|option| {
                        let prefs = prefs.clone();
                        checked_item(
                            MenuItem::new(layout_name(option)).icon_sized(layout_icon(option)),
                            layout == option,
                        )
                        .on_click(move |_, cx| {
                            prefs.update(cx, |p, cx| {
                                p.change(|p| p.homepage_project_layout = option, cx)
                            })
                        })
                    }))
                },
                cx,
            )
        };
        // `.onboarding-project-toolbar` > `.onboarding-project-view`.
        div()
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .justify_end()
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(4.))
                    .children(chips)
                    .child(filter)
                    .child(sort_menu)
                    .child(layout_menu),
            )
    }
    /// `OnboardingEntryMenu`: New project, one click away, and the arrow
    /// holding Open a folder and Import. `narrow` hides New's words.
    pub(super) fn entry_menu(&self, busy: bool, narrow: bool, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let open = self.homepage.menu == Some(HomeMenu::Entry) && !busy;
        let host = self.weak.clone();
        let more = tr("onboarding.action.moreEntries");
        let trigger = Button::new("home-entry-more")
            .variant(ButtonVariant::PatternPrimary)
            .icon(Icon::new("chevron-down").small().stroke(1.85))
            .accessibility_label(more)
            .tooltip(more)
            .disabled(busy)
            .w(px(theme::control()))
            .px_0()
            .rounded_l(px(0.))
            .rounded_r(px(metric::CONTROL_RADIUS));
        let menu = PopoverMenu::new("home-entry-menu")
            .anchor(Anchor::TopRight)
            .offset(px(metric::MENU_PADDING))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    let is = s.homepage.menu == Some(HomeMenu::Entry);
                    if *opened != is {
                        s.homepage.menu = opened.then_some(HomeMenu::Entry);
                        cx.notify();
                    }
                });
            })
            .trigger(trigger)
            .menu({
                let host = self.weak.clone();
                move |surface, _, _| {
                    let open_folder = {
                        let host = host.clone();
                        MenuItem::new(tr("onboarding.action.openFolder"))
                            .icon_sized(Icon::product(ProductIcon::Folder).small().stroke(1.85))
                            .on_click(move |w, cx| {
                                let _ =
                                    host.update(cx, |s, cx| s.command(Command::OpenFolder, w, cx));
                            })
                    };
                    let import = {
                        let host = host.clone();
                        MenuItem::new(tr("onboarding.action.importFromApps"))
                            .icon_sized(Icon::new("download").small().stroke(1.85))
                            .trailing(super::project_entry::import_badges(t, t.menu_bg, false))
                            .on_click(move |w, cx| {
                                let _ = host.update(cx, |s, cx| s.begin_import(w, cx));
                            })
                    };
                    surface
                        .w(px(ENTRY_MENU_WIDTH))
                        .item(open_folder)
                        .item(import)
                }
            });
        // `.onboarding-entry-menu-root`: New and the arrow, 1px apart.
        div()
            .flex()
            .flex_none()
            .gap(px(1.))
            .ml_auto()
            .child(
                self.create_action_compact(narrow, busy, cx)
                    .rounded_r(px(0.)),
            )
            .child(menu)
    }

    // ---------------------------------------------------------- the list
    /// `OnboardingProjectList`: the projects as rows or as the Grid.
    pub(super) fn project_list(
        &mut self,
        items: Vec<Item>,
        width: f32,
        busy: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if self.homepage.list_held() {
            // `.onboarding-project-list-wait`: the mark at the area's centre,
            // revealed after 120ms.
            let shown = self
                .homepage
                .list_held_since
                .is_some_and(|since| since.elapsed() >= std::time::Duration::from_millis(120));
            if !shown {
                window.request_animation_frame();
            }
            return div()
                .size_full()
                .min_h_0()
                .flex()
                .items_center()
                .justify_center()
                .when(shown, |d| {
                    d.child(
                        crate::ui::loading::LoadingMark::new("home-projects-loading")
                            .area()
                            .size(crate::ui::loading::LoaderSize::Md)
                            .tone(crate::ui::loading::Tone::Neutral),
                    )
                })
                .into_any_element();
        }
        let layout = self.preferences.read(cx).state.homepage_project_layout;
        let stop = self.project_stop(&items);
        let columns = match layout {
            HomepageLayout::Grid => grid_columns(width),
            HomepageLayout::List => 1,
        };
        let ids: Vec<String> = items.iter().map(|i| i.id.clone()).collect();
        let mut children = Vec::with_capacity(items.len());
        for (index, item) in items.into_iter().enumerate() {
            self.homepage
                .action_bounds
                .entry(item.id.clone())
                .or_default();
            let focus = self.project_focus(&item.id, cx);
            let lit = self.project_lit(&item, window);
            let rise = match layout {
                HomepageLayout::Grid => self.sheet_rise(&item.id, lit, window, cx),
                HomepageLayout::List => 0.,
            };
            let is_stop = stop.as_deref() == Some(item.id.as_str());
            focus.clone().tab_stop(is_stop);
            let keys = {
                let host = self.weak.clone();
                let ids = ids.clone();
                move |event: &KeyDownEvent, window: &mut Window, cx: &mut App| {
                    let key = event.keystroke.key.as_str();
                    let key = match key {
                        "up" | "down" | "left" | "right" | "home" | "end" => key,
                        "enter" | "space" => {
                            let _ = host.update(cx, |s, cx| s.open_home_item_at(index, window, cx));
                            cx.stop_propagation();
                            return;
                        }
                        _ => return,
                    };
                    cx.stop_propagation();
                    let Some(target) =
                        key_target(key, index, ids.len().saturating_sub(1), columns, false)
                    else {
                        return;
                    };
                    let _ = host.update(cx, |s, cx| {
                        let id = ids[target].clone();
                        s.homepage.stop = Some(id.clone());
                        if let Some(handle) = s.homepage.focus.get(&id) {
                            handle.focus(window, cx);
                        }
                        cx.notify();
                    });
                }
            };
            children.push(match layout {
                HomepageLayout::Grid => {
                    self.project_tile(index, &item, focus, rise, lit, is_stop, busy, keys, cx)
                }
                HomepageLayout::List => {
                    self.project_row(index, &item, focus, lit, is_stop, busy, keys, cx)
                }
            });
        }
        let list = div()
            .id("home-projects")
            .w(px(width + SCROLLBAR_SIZE))
            .min_h_0()
            .flex_shrink(1.)
            .py(px(8.))
            .pr(px(SCROLLBAR_SIZE))
            .overflow_y_scroll()
            .track_scroll(&self.home_scroll)
            .on_hover(cx.listener(|s, hovered: &bool, _, cx| {
                if !*hovered && s.homepage.hovered.take().is_some() {
                    cx.notify();
                }
            }));
        let list = match layout {
            HomepageLayout::Grid => {
                // Rows of whole cells: a wrapping row could drop its last
                // cell to rounding.
                let cell_w = ((width + CELL_GAP) / columns as f32) - CELL_GAP;
                let mut cells = children.into_iter().peekable();
                let mut rows = Vec::new();
                while cells.peek().is_some() {
                    rows.push(
                        h_flex()
                            .w(px(width))
                            .items_start()
                            .gap(px(CELL_GAP))
                            .children(
                                cells
                                    .by_ref()
                                    .take(columns)
                                    .map(|cell| div().w(px(cell_w)).flex_none().child(cell)),
                            ),
                    );
                }
                list.child(v_flex().w(px(width)).gap(px(CELL_GAP)).children(rows))
            }
            HomepageLayout::List => list.child(
                div()
                    .w(px(width))
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .children(children),
            ),
        };
        // `mask-image`: the rows fade over 8px at either end.
        let t = cx.palette();
        let fade = |top: bool| {
            div()
                .absolute()
                .left_0()
                .w(px(width))
                .h(px(8.))
                .when(top, |d| d.top_0())
                .when(!top, |d| d.bottom_0())
                .bg(linear_gradient(
                    if top { 180. } else { 0. },
                    linear_color_stop(t.canvas, 0.),
                    linear_color_stop(theme::alpha(t.canvas, 0.), 1.),
                ))
        };
        div()
            .relative()
            .min_h_0()
            .flex()
            .flex_col()
            .child(list)
            .child(fade(true))
            .child(fade(false))
            .child(crate::ui::scrollbar::vertical(
                "home-projects-scrollbar",
                &self.home_scroll,
            ))
            .into_any_element()
    }
    /// Opens the project at `index` of the visible list.
    pub(super) fn open_home_item_at(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(item) = self.visible_projects(cx).get(index).cloned() {
            self.open_item(&item, window, cx);
        }
    }
    /// The parts every project has: its open control and what it reacts to.
    /// A local project drags out as its absolute path, which also goes to
    /// the clipboard (`startProjectDrag`).
    fn open_control(
        &self,
        id: impl Into<ElementId>,
        item: &Item,
        focus: FocusHandle,
        busy: bool,
        keys: impl Fn(&KeyDownEvent, &mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let hover_id = item.id.clone();
        let focus_id = item.id.clone();
        let open = item.clone();
        let drag = item
            .local_path
            .clone()
            .filter(|path| !busy && !path.trim().is_empty())
            .map(|path| ProjectDrag {
                path: path.trim().to_owned(),
                label: item_name(item).into(),
                native: false,
            });
        let selector = format!("home-project:{}", item.id);
        div()
            .id(id)
            .debug_selector(move || selector.clone())
            .track_focus(&focus)
            .on_key_down(keys)
            .on_hover(cx.listener(move |s, hovered: &bool, _, cx| {
                let next = hovered.then(|| hover_id.clone());
                if s.homepage.hovered != next
                    && (*hovered || s.homepage.hovered.as_ref() == Some(&hover_id))
                {
                    s.homepage.hovered = next;
                    cx.notify();
                }
            }))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |s, _, _, cx| {
                    s.homepage.stop = Some(focus_id.clone());
                    cx.notify();
                }),
            )
            .when(!busy, |d| {
                d.cursor(theme::clickable_cursor())
                    .on_click(cx.listener(move |s, _, w, cx| s.open_item(&open, w, cx)))
            })
            .when_some(drag, |d, drag| {
                let host = cx.weak_entity();
                d.on_drag(drag, move |drag, _, window, cx| {
                    cx.write_to_clipboard(ClipboardItem::new_string(drag.path.clone()));
                    let path = drag.path.clone();
                    let _ = host.update(cx, |s, cx| {
                        s.homepage.dragging_path = Some(path);
                        cx.notify();
                    });
                    // Out of the window as text; when that session ends, so
                    // does the drag here.
                    let (ended, end) = async_channel::bounded(1);
                    let native =
                        crate::platform::drag_out::begin_text(window, &drag.path, &drag.path, {
                            move || {
                                let _ = ended.try_send(());
                            }
                        });
                    if native {
                        let handle = window.window_handle();
                        let host = host.clone();
                        cx.spawn(async move |cx| {
                            if end.recv().await.is_ok() {
                                let _ = handle.update(cx, |_, window, cx| {
                                    cx.stop_active_drag(window);
                                });
                                let _ = host.update(cx, |s, cx| {
                                    s.homepage.dragging_path = None;
                                    cx.notify();
                                });
                            }
                        })
                        .detach();
                    }
                    cx.new(|_| ProjectDrag {
                        native,
                        ..drag.clone()
                    })
                })
            })
    }
    /// `.onboarding-project-row-wrap.is-dragging`.
    fn dragging_item(&self, item: &Item) -> bool {
        item.local_path.is_some()
            && self.homepage.dragging_path.as_deref() == item.local_path.as_deref().map(str::trim)
    }
    /// One project as a row (`DesktopMenuItem.onboarding-project-row`).
    #[allow(clippy::too_many_arguments)]
    fn project_row(
        &self,
        index: usize,
        item: &Item,
        focus: FocusHandle,
        lit: bool,
        is_stop: bool,
        busy: bool,
        keys: impl Fn(&KeyDownEvent, &mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let name = item_name(item);
        let location = item.location();
        let linked = item.linked.is_some();
        let detail = match &item.local_path {
            Some(path) => parent_for_display(Path::new(path)),
            None => item_caption(item),
        };
        let modified = item.modified.filter(|m| *m > 0).map(|ms| {
            modification_time(
                UNIX_EPOCH + Duration::from_millis(ms as u64),
                SystemTime::now(),
            )
        });
        let narrow = self.layout.header.w <= 520.;
        let dragging = self.dragging_item(item);
        // `.has-cloud-project` rests quieter: the Cloud project is where
        // people and agents work.
        let name_color = if linked && !lit { t.subtle } else { t.text };
        let actions = self.project_actions_trigger(index, item, is_stop, busy, cx);
        let cloud_link = item
            .linked
            .clone()
            .map(|linked| self.linked_cloud_button(index, linked, false, is_stop, busy, cx));
        let reserve = if cloud_link.is_some() && lit {
            132.
        } else {
            0.
        };
        let row = self
            .open_control(("home-project", index), item, focus, busy, keys, cx)
            .w_full()
            .min_w_0()
            .h(px(theme::control()))
            .flex()
            .items_center()
            .gap(px(metric::MENU_ITEM_GAP))
            .pl(px(metric::MENU_ITEM_PADDING_INLINE))
            .pr(px(metric::MENU_ITEM_PADDING_INLINE.max(reserve)))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_size(px(ty.body))
            .line_height(px(18.))
            .text_color(t.text)
            .when(lit && !busy, |d| d.bg(t.hover))
            .when(busy, |d| d.opacity(0.58))
            .when(dragging, |d| d.bg(t.hover).opacity(0.62))
            .child(
                div()
                    .size(px(metric::MENU_ICON_SLOT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(super::folder::list_icon(location, true, lit, t)),
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_baseline()
                    .gap(px(7.))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .when(!narrow, |d| d.flex_none().max_w(relative(0.65)))
                            .when(narrow, |d| d.flex_1())
                            .text_color(name_color)
                            .child(name),
                    )
                    .when(!narrow, |d| {
                        d.child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_size(px(ty.caption))
                                .text_color(t.subtle)
                                .child(detail),
                        )
                    }),
            )
            .children(modified.map(|time| {
                div()
                    .flex_none()
                    .max_w(px(if narrow { 76. } else { 112. }))
                    .truncate()
                    .text_size(px(ty.caption))
                    .text_color(t.subtle)
                    .when(lit, |d| d.invisible())
                    .child(time)
            }));
        div()
            .relative()
            .min_w_0()
            .child(row)
            .children(cloud_link.map(|link| {
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right(px(34.))
                    .flex()
                    .items_center()
                    .when(!lit, |d| d.invisible())
                    .child(link)
            }))
            .children(actions.map(|actions| {
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right(px(6.))
                    .flex()
                    .items_center()
                    .when(!lit, |d| d.invisible())
                    .child(actions)
            }))
            .into_any_element()
    }
    /// One project on the Grid: a folder and one line of name. The tooltip
    /// adds where it lives and when it last changed (and the name when the
    /// line cuts it).
    #[allow(clippy::too_many_arguments)]
    fn project_tile(
        &self,
        index: usize,
        item: &Item,
        focus: FocusHandle,
        rise: f32,
        lit: bool,
        is_stop: bool,
        busy: bool,
        keys: impl Fn(&KeyDownEvent, &mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let name = item_name(item);
        let place = match &item.local_path {
            Some(path) => parent_for_display(Path::new(path)),
            None => item_caption(item),
        };
        let modified = item.modified.filter(|m| *m > 0).map(|ms| {
            modification_time(
                UNIX_EPOCH + Duration::from_millis(ms as u64),
                SystemTime::now(),
            )
        });
        let linked = item.linked.is_some();
        // A cut name joins the tooltip; the tile is about 112px, so the
        // estimate uses the caption's average advance.
        let cut = name.chars().count() as f32 * theme::ty().ui.caption * 0.56 > CELL_MIN - 8.;
        let tooltip = [cut.then(|| name.clone()), Some(place), modified]
            .into_iter()
            .flatten()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
        let tile = self
            .open_control(("home-tile", index), item, focus, busy, keys, cx)
            .w_full()
            .min_w_0()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(8.))
            .pt(px(12.))
            .px(px(4.))
            .pb(px(8.))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_color(t.text)
            .when(lit && !busy, |d| d.bg(t.hover))
            .when(busy, |d| d.opacity(0.58))
            .when(self.dragging_item(item), |d| d.opacity(0.62))
            .tooltip(crate::ui::components::tooltip(tooltip))
            .child(super::folder::grid_folder(item.location(), rise, lit, t))
            .child(
                div()
                    .max_w_full()
                    .min_w_0()
                    .truncate()
                    .text_size(px(theme::ty().ui.caption))
                    .line_height(px(16.))
                    .text_color(if linked && !lit { t.subtle } else { t.text })
                    .child(name),
            );
        let actions = self.project_actions_trigger(index, item, is_stop, busy, cx);
        let cloud_link = item
            .linked
            .clone()
            .map(|linked| self.linked_cloud_button(index, linked, true, is_stop, busy, cx));
        div()
            .relative()
            .min_w_0()
            .child(tile)
            .children(cloud_link.map(|link| {
                div()
                    .absolute()
                    .top(px(4.))
                    .left(px(4.))
                    .when(!lit, |d| d.invisible())
                    .child(link)
            }))
            .children(actions.map(|actions| {
                div()
                    .absolute()
                    .top(px(4.))
                    .right(px(4.))
                    .when(!lit, |d| d.invisible())
                    .child(actions)
            }))
            .into_any_element()
    }
    /// `LinkedCloudProjectButton`: opens the folder's own Cloud project, the
    /// other project of the pair. On a tile only its cloud shows.
    fn linked_cloud_button(
        &self,
        index: usize,
        linked: crate::workspace::cloud::catalog::Linked,
        compact: bool,
        is_stop: bool,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let label = tf(
            "cloud.home.openLinkedCloudProject",
            &[("project", linked.name.clone().into())],
        );
        let hint = tf(
            "cloud.home.linkedCloudProjectHint",
            &[("project", linked.name.clone().into())],
        );
        let project = linked.id.clone();
        div()
            .id(("home-project-cloud-link", index))
            .flex()
            .items_center()
            .justify_center()
            .gap(px(4.))
            .when(!compact, |d| d.px(px(6.)).py(px(4.)))
            .when(compact, |d| d.size(px(24.)))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_size(px(theme::ty().ui.caption))
            .text_color(t.muted)
            .tooltip(crate::ui::components::tooltip(hint))
            .debug_selector(move || format!("cloud-link:{label}"))
            .when(!busy, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover).text_color(t.text))
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(cx.listener(move |s, _, _, cx| {
                        cx.stop_propagation();
                        s.open_cloud(project.clone(), cx);
                    }))
            })
            .when(!is_stop, |d| d)
            .child(
                Icon::product(ProductIcon::Cloud)
                    .with_size(px(12.))
                    .color(t.brand_blue),
            )
            .when(!compact, |d| d.child(tr("cloud.home.location.cloud")))
            .into_any_element()
    }
    /// `ProjectRowActions`' trigger, only where the account may change the
    /// project; an entry with nothing to offer has none.
    fn project_actions_trigger(
        &self,
        index: usize,
        item: &Item,
        _is_stop: bool,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let target = super::super::project_actions::Target::of(item)?;
        let t = cx.palette();
        let name = item_name(item);
        let open = self.homepage.actions.as_deref() == Some(item.id.as_str());
        let id = item.id.clone();
        let label = tf(
            "shell.workspaceSwitcher.projectActionsFor",
            &[("project", name.into())],
        );
        let bounds = self
            .homepage
            .action_bounds
            .get(&item.id)
            .cloned()
            .unwrap_or_default();
        let measured = bounds.clone();
        Some(
            div()
                .relative()
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .child(
                    IconButton::new(
                        ("home-project-actions", index),
                        Icon::new("ellipsis-vertical").small(),
                    )
                    .label(label)
                    .tooltip(tr("shell.workspaceSwitcher.projectActions"))
                    .with_size(px(22.))
                    .when(open, |b| b.color(t.text))
                    .disabled(busy)
                    .on_click(cx.listener(move |s, _, w, cx| {
                        cx.stop_propagation();
                        if s.homepage.actions.as_deref() == Some(id.as_str()) {
                            s.homepage.actions = None;
                            s.project_actions = None;
                            cx.notify();
                            return;
                        }
                        s.homepage.actions = Some(id.clone());
                        s.open_project_actions(
                            target.clone(),
                            bounds.get(),
                            true,
                            w.viewport_size(),
                            cx,
                        );
                    })),
                )
                .child(
                    canvas(move |b, _, _| measured.set(b), |_, _, _, _| {})
                        .absolute()
                        .inset_0(),
                )
                .into_any_element(),
        )
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
