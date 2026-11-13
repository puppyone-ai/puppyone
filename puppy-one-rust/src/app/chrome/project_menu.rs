//! Header popovers: `ProjectPlaceMenu` (the places and the account), the
//! `DesktopWorkspaceSwitcher` folder menu (the folders in the open folder's
//! place, and New), and the Homepage brand's navigation. They hang 2px
//! below their trigger, start aligned, on the `.desktop-project-menu`
//! surface. GPUI Kit places, clamps and dismisses them; the shell holds
//! which one is open so commands and keys can open it too.
use super::*;
use crate::{
    localization::{t as tr, tf},
    theme::Theme,
    ui::appearance::ActiveAppearance,
    ui::components::{
        Button, ButtonVariant, Icon, IconButton, Menu, MenuItem, MenuVariant, PopoverMenu,
    },
};
use gpui_kit::{base::h_flex, component::Sizable as _};

/// `preferredWidth={240}` of the project menu.
const PROJECT_MENU_WIDTH: f32 = 240.;
/// `DesktopTitlebarMenuLayer`'s gap below the trigger.
const MENU_GAP: f32 = 2.;
/// `.desktop-project-list` row gap.
const PROJECT_LIST_GAP: f32 = 2.;
/// `max-height: min(520px, calc(100vh - 58px))` on the surface.
const MENU_MAX_HEIGHT: f32 = 520.;
const MENU_VIEWPORT_INSET: f32 = 58.;
/// `preferredWidth={240}` / `preferredMaxHeight={560}` of the place menu;
/// the Homepage brand's is 260 wide.
const PLACE_MENU_WIDTH: f32 = 240.;
const BRAND_MENU_WIDTH: f32 = 260.;
const PLACE_MENU_MAX_HEIGHT: f32 = 560.;
/// `.desktop-project-switcher-copy`: a 22px button in the row's end slot.
const COPY_BUTTON: f32 = 22.;
/// How long a copied path says so.
const COPIED_FOR: std::time::Duration = std::time::Duration::from_millis(1600);

impl WindowChrome {
    /// `DesktopTitlebarContext`: two levels, read like a path: the place,
    /// then the folder. With the project rail on, the rail names the
    /// project and the Header keeps the place alone. While a project is on
    /// its way in there is no place yet.
    pub(super) fn project_context(&self, project_hidden: bool, cx: &mut Context<Self>) -> Div {
        let label = tf(
            "shell.workspaceSwitcher.openMenu",
            &[("workspace", self.session.name.clone().into())],
        );
        let opening = self.opening_project_name(cx);
        let name = match &opening {
            Some(name) => name.clone(),
            None if self.session.name.is_empty() => tr("onboarding.action.openFolder").to_owned(),
            None => self.session.name.clone(),
        };
        let ty = theme::ty().header;
        // `.desktop-titlebar-workspace-button`.
        let project = Button::new("project")
            .variant(ButtonVariant::Ghost)
            .accessibility_label(label)
            .track_focus(&self.project_focus)
            .icon(
                Icon::product(crate::ui::components::ProductIcon::Folder)
                    .stroke(1.65)
                    .large(),
            )
            .label(name)
            .flex_shrink(1.)
            .min_w_0()
            .px(px(6.))
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .font_weight(FontWeight::MEDIUM);
        let items = self.owners.home.read(cx).project_items(cx);
        let cloud = self.owners.cloud.read(cx);
        let place = cloud.place_menu(&items, cx).filter(|_| opening.is_none());
        let t = cx.palette();
        h_flex()
            .min_w_0()
            .gap(px(2.))
            .when_some(place, |d, menu| {
                d.child(self.header_popover(Popover::Place, cloud.place_button(&menu, cx), cx))
                    .when(!project_hidden, |d| {
                        // `.desktop-titlebar-context-separator`.
                        d.child(
                            div()
                                .flex_none()
                                .mx(px(-2.))
                                .text_size(px(ty.content))
                                .line_height(px(ty.line_height))
                                .text_color(t.text_disabled)
                                .child("/"),
                        )
                    })
            })
            .when(!project_hidden, |d| {
                d.child(self.header_popover(Popover::Project, project, cx))
                    .children(cloud.publish_header_mark(cx))
            })
    }
    /// The Homepage's Header names the product; with places or an account
    /// to reach, the name opens them (`OnboardingBrandLockup`).
    pub(super) fn brand(&self, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().header;
        let label = format!(
            "{}, {}",
            tr("shell.brand.name"),
            tr("shell.placeMenu.label")
        );
        let button = Button::new("homepage-brand")
            .variant(ButtonVariant::Titlebar)
            .accessibility_label(label)
            .label(tr("shell.brand.name"))
            .px(px(6.))
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .font_weight(FontWeight::MEDIUM);
        self.header_popover(Popover::Brand, button, cx)
            .into_any_element()
    }
    /// `trigger` and the header popover it opens.
    pub(super) fn header_popover(
        &self,
        popover: Popover,
        trigger: Button,
        cx: &App,
    ) -> PopoverMenu {
        let open = self.popover == Some(popover);
        let id = match popover {
            Popover::Project => "project-menu",
            Popover::Place => "place-menu",
            Popover::Brand => "brand-menu",
        };
        let host = self.weak.clone();
        let mut menu = PopoverMenu::new(id)
            .anchor(Anchor::TopLeft)
            .offset(px(MENU_GAP))
            .open(open)
            .on_open_change(move |opened, window, cx| {
                let _ = host.update(cx, |s, cx| {
                    let open = s.popover == Some(popover);
                    if *opened != open {
                        if *opened && popover == Popover::Project {
                            s.project_focus.focus(window, cx);
                        }
                        s.show_popover(opened.then_some(popover), cx);
                    }
                });
            })
            .trigger(trigger)
            .flex();
        if open {
            match popover {
                Popover::Project => {
                    let fill = self.project_menu(cx);
                    menu = menu.menu(move |surface, window, _| {
                        let max_height = (window.viewport_size().height - px(MENU_VIEWPORT_INSET))
                            .min(px(MENU_MAX_HEIGHT));
                        fill(
                            surface
                                .variant(MenuVariant::Project)
                                .w(px(PROJECT_MENU_WIDTH))
                                .max_h(max_height),
                        )
                    });
                }
                Popover::Place | Popover::Brand => {
                    let place = popover == Popover::Place;
                    let current = if place {
                        let items = self.owners.home.read(cx).project_items(cx);
                        self.owners
                            .cloud
                            .read(cx)
                            .place_menu(&items, cx)
                            .and_then(|menu| current_place(&menu))
                    } else {
                        None
                    };
                    let host = self.weak.clone();
                    let preferences = self.owners.preferences.clone();
                    let width = if place {
                        PLACE_MENU_WIDTH
                    } else {
                        BRAND_MENU_WIDTH
                    };
                    menu = menu.menu(move |surface, _, cx| {
                        let host = host.clone();
                        super::navigation::rows(
                            surface
                                .variant(MenuVariant::Project)
                                .min_w(px(width))
                                .max_w(px(320.))
                                .max_h(px(PLACE_MENU_MAX_HEIGHT)),
                            current.as_deref(),
                            place,
                            &preferences,
                            move |navigate, _, cx| {
                                let _ = host.update(cx, |s, cx| {
                                    s.show_popover(None, cx);
                                    cx.emit(ChromeEvent::Navigate(navigate));
                                });
                            },
                            cx,
                        )
                    });
                }
            }
        }
        menu
    }
    /// `DesktopWorkspaceSwitcher` "projects" view over the shared project
    /// list (`projectCatalog.items`): inside a place, only that place's
    /// folders (`projectMenuGroupsInPlace`); another computer's folder, not
    /// in the account's catalog, lists every place under its heading. Home
    /// is offered only where no place menu is.
    fn project_menu(&self, cx: &App) -> impl FnOnce(Menu) -> Menu + 'static {
        let host = self.weak.clone();
        let action = move |command: Command| {
            let host = host.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.command(command, cx));
            }
        };
        let current = self
            .session
            .root
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned());
        let hosted = self.session.hosted.clone();
        let t = cx.palette();
        let copied = self.copied_path.clone();
        let items = self.owners.home.read(cx).project_items(cx);
        let opening = self.opening_project_name(cx).is_some();
        let place_menu = self
            .owners
            .cloud
            .read(cx)
            .place_menu(&items, cx)
            .filter(|_| !opening);
        let spaces = if crate::features::flags::cloud_enabled(&self.owners.preferences, cx) {
            crate::features::cloud::global_spaces_read(cx)
                .map(|s| s.spaces().to_vec())
                .unwrap_or_default()
        } else {
            vec![]
        };
        let all = groups_by_place(&items, &spaces);
        let place = place_menu.as_ref().and_then(menu_place);
        let groups = match &place {
            Some(place) => in_place(all, place),
            None => all,
        };
        let headings = place.is_none() && needs_headings(&groups);
        let mut index = 0;
        let mut sections = vec![];
        for group in groups {
            let rows = group
                .items
                .into_iter()
                .map(|item| {
                    let selected = (item.local_path.is_some() && item.local_path == current)
                        || (hosted.is_some() && item.cloud_project == hosted);
                    index += 1;
                    self.project_item(index, item, selected, copied.as_ref(), t)
                })
                .collect::<Vec<_>>();
            let heading = headings.then(|| group_label(&group.kind, t));
            sections.push((heading, rows));
        }
        let home = place_menu.is_none().then(|| {
            MenuItem::new(tr("shell.workspaceSwitcher.home"))
                .icon_sized(Icon::new("arrow-left").with_size(px(15.)).stroke(2.))
                .on_click(action(Command::Home))
        });
        // `onCreateProject`: the Project entry launcher.
        let create = MenuItem::new(tr("shell.workspaceSwitcher.createNew"))
            .icon_sized(Icon::new("plus").with_size(px(15.)).stroke(2.))
            .on_click(action(Command::CreateNew));
        move |menu| {
            let listed = sections.iter().any(|(_, rows)| !rows.is_empty());
            let had_home = home.is_some();
            let mut menu = match home {
                Some(home) => menu.item(home),
                None => menu,
            };
            if listed {
                if had_home {
                    menu = menu.separator();
                }
                for (heading, rows) in sections {
                    if let Some(heading) = heading {
                        menu = menu.child_element(heading);
                    }
                    menu = menu.list(PROJECT_LIST_GAP, rows);
                }
                menu = menu.separator();
            }
            menu.item(create)
        }
    }
    /// `DesktopProjectMenuItem`: the current project carries a check at the
    /// row end; a folder's end slot copies its path (and says Copied for a
    /// moment). Choosing enters the project in this window, a Cloud project
    /// as much as a folder.
    fn project_item(
        &self,
        index: usize,
        item: crate::workspace::cloud::catalog::Item,
        current: bool,
        copied: Option<&(String, std::time::Instant)>,
        t: Theme,
    ) -> MenuItem {
        let open_host = self.weak.clone();
        let name = super::super::home::item_name_or(&item, tr("onboarding.projects.untitled"));
        let mut row = MenuItem::new(name.clone())
            .icon_element(super::super::home::folder::list_icon(item.location(), t))
            .selected(current)
            .trailing(
                div()
                    .w(px(COPY_BUTTON))
                    .flex()
                    .justify_center()
                    .when(current, |d| d.child(Icon::new("check").small().stroke(2.))),
            );
        if let Some(path) = item.local_path.clone() {
            let copy_host = self.weak.clone();
            let copied = copied.is_some_and(|(p, at)| *p == path && at.elapsed() < COPIED_FOR);
            let copy_label = tr(if copied {
                "common.action.copied"
            } else {
                "shell.workspaceSwitcher.copyPath"
            });
            let copy_path = path.clone();
            row = row.hover_trailing(
                IconButton::new(
                    ("copy-project-path", index),
                    Icon::new(if copied { "check" } else { "copy" })
                        .small()
                        .stroke(2.),
                )
                .label(format!("{copy_label}: {name}"))
                .tooltip(format!("{copy_label}\n{copy_path}"))
                .with_size(px(COPY_BUTTON))
                .on_click(move |_, _, cx| {
                    cx.stop_propagation();
                    cx.write_to_clipboard(ClipboardItem::new_string(copy_path.clone()));
                    let _ = copy_host.update(cx, |s, cx| {
                        s.copied_path = Some((copy_path.clone(), std::time::Instant::now()));
                        cx.notify();
                        // The check gives way after its moment.
                        cx.spawn(async move |this, cx| {
                            cx.background_executor().timer(COPIED_FOR).await;
                            let _ = this.update(cx, |_, cx| cx.notify());
                        })
                        .detach();
                    });
                }),
            );
            if copied {
                row = row.hold_hover(true);
            }
        }
        row.on_click(move |_, cx| {
            let _ = open_host.update(cx, |s, cx| {
                s.show_popover(None, cx);
                if !current {
                    cx.emit(ChromeEvent::OpenItem(Box::new(item.clone())));
                }
            });
        })
    }
}

/// `ProjectMenuGroup`'s kind.
#[derive(Clone, Debug, PartialEq)]
enum GroupKind {
    Local,
    Space(crate::workspace::cloud::spaces::Space),
    Cloud,
}
struct Group {
    kind: GroupKind,
    items: Vec<Item>,
}
/// `ProjectMenuPlace`.
#[derive(Clone, Debug, PartialEq)]
enum MenuPlace {
    Local,
    Space(String),
    Cloud,
}
/// `groupProjectsByPlace`: this computer, then each space as the account
/// orders them, then Cloud projects whose space is not known yet.
fn groups_by_place(
    items: &[Item],
    spaces: &[crate::workspace::cloud::spaces::Space],
) -> Vec<Group> {
    let (local, cloud): (Vec<Item>, Vec<Item>) =
        items.iter().cloned().partition(|i| i.local_path.is_some());
    let mut groups = vec![];
    if !local.is_empty() {
        groups.push(Group {
            kind: GroupKind::Local,
            items: local,
        });
    }
    for space in spaces {
        let held: Vec<Item> = cloud
            .iter()
            .filter(|i| i.cloud_organization.as_deref() == Some(space.id.as_str()))
            .cloned()
            .collect();
        if !held.is_empty() {
            groups.push(Group {
                kind: GroupKind::Space(space.clone()),
                items: held,
            });
        }
    }
    let unplaced: Vec<Item> = cloud
        .into_iter()
        .filter(|i| {
            !spaces
                .iter()
                .any(|s| i.cloud_organization.as_deref() == Some(s.id.as_str()))
        })
        .collect();
    if !unplaced.is_empty() {
        groups.push(Group {
            kind: GroupKind::Cloud,
            items: unplaced,
        });
    }
    groups
}
/// `projectMenuPlace`: another computer's folders keep every place.
fn menu_place(menu: &crate::app::project_place::PlaceMenu) -> Option<MenuPlace> {
    use crate::app::project_place::Place;
    if let Some(space) = &menu.space {
        return Some(MenuPlace::Space(space.id.clone()));
    }
    match menu.place {
        Place::Computer => None,
        Place::Local => Some(MenuPlace::Local),
        Place::Cloud => Some(MenuPlace::Cloud),
    }
}
/// `projectMenuGroupsInPlace`.
fn in_place(groups: Vec<Group>, place: &MenuPlace) -> Vec<Group> {
    groups
        .into_iter()
        .filter(|g| match (place, &g.kind) {
            (MenuPlace::Space(id), GroupKind::Space(space)) => &space.id == id,
            (MenuPlace::Local, GroupKind::Local) | (MenuPlace::Cloud, GroupKind::Cloud) => true,
            _ => false,
        })
        .collect()
}
/// `projectMenuGroupsNeedHeadings`: only this computer's folders need none.
fn needs_headings(groups: &[Group]) -> bool {
    groups.len() > 1 || groups.first().is_some_and(|g| g.kind != GroupKind::Local)
}
/// The place the open folder is in, among the window's places
/// (`currentPlace`).
pub(super) fn current_place(menu: &crate::app::project_place::PlaceMenu) -> Option<String> {
    use crate::app::project_place::Place;
    match (&menu.space, menu.place) {
        (Some(space), _) => Some(space.id.clone()),
        (None, Place::Local) => Some(super::navigation::LOCAL_PLACE.to_owned()),
        _ => None,
    }
}
/// `.desktop-project-menu-group-label`.
fn group_label(kind: &GroupKind, t: Theme) -> AnyElement {
    let ty = theme::ty().ui;
    let (mark, name): (AnyElement, String) = match kind {
        GroupKind::Space(space) => (
            crate::features::cloud::space_mark(space)
                .size(crate::ui::components::SpaceMarkSize::Small)
                .into_any_element(),
            crate::features::cloud::space_name(space),
        ),
        GroupKind::Local => (
            Icon::product(crate::ui::components::ProductIcon::Local)
                .with_size(px(12.))
                .stroke(1.8)
                .into_any_element(),
            tr(if cfg!(target_os = "macos") {
                "shell.workspaceSwitcher.location.thisMac"
            } else {
                "shell.workspaceSwitcher.location.thisComputer"
            })
            .to_owned(),
        ),
        GroupKind::Cloud => (
            Icon::product(crate::ui::components::ProductIcon::Cloud)
                .with_size(px(12.))
                .stroke(1.8)
                .into_any_element(),
            tr("cloud.home.location.cloud").to_owned(),
        ),
    };
    h_flex()
        .min_w_0()
        .gap(px(6.))
        .pt(px(4.))
        .pb(px(2.))
        .px(px(8.))
        .text_color(t.subtle)
        .text_size(px(ty.meta))
        .line_height(px(16.))
        .font_weight(FontWeight::MEDIUM)
        .child(mark)
        .child(div().min_w_0().truncate().child(name))
        .into_any_element()
}
