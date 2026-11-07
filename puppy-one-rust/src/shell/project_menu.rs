//! Header popovers: the `DesktopWorkspaceSwitcher` menu (Home, every
//! project, New) and `ProjectPlaceMenu` (where the open project is). Both
//! hang 2px below their trigger, start aligned, on the `.desktop-project-menu`
//! surface. GPUI Kit places, clamps and dismisses them; the shell holds which
//! one is open so commands and keys can open it too.
use super::*;
use crate::{
    localization::{t as tr, tf},
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
/// `preferredMaxHeight={200}` of the place menu.
const PLACE_MENU_MAX_HEIGHT: f32 = 200.;
/// `.desktop-project-switcher-copy`: a 22px button in the row's end slot.
const COPY_BUTTON: f32 = 22.;
/// How long a copied path says so.
const COPIED_FOR: std::time::Duration = std::time::Duration::from_millis(1600);

impl Shell {
    /// `DesktopTitlebarContext`: the project switcher, the place menu while
    /// Cloud is on, and a first publication's status beside them.
    pub(super) fn project_context(&self, cx: &mut Context<Self>) -> Div {
        let label = tf(
            "shell.workspaceSwitcher.openMenu",
            &[("workspace", self.session.project.name.clone().into())],
        );
        let opening = self.opening_project_name(cx);
        let name = match &opening {
            Some(name) => name.clone(),
            None if self.session.project.name.is_empty() => {
                tr("onboarding.action.openFolder").to_owned()
            }
            None => self.session.project.name.clone(),
        };
        let ty = theme::ty().header;
        // `.desktop-titlebar-workspace-button`.
        let project = Button::new("project")
            .variant(ButtonVariant::Ghost)
            .accessibility_label(label)
            .track_focus(&self.project_focus)
            .icon(
                Icon::product(crate::ui::components::ProductIcon::Home)
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
        // The place and the publication wait while a project is entered.
        let items = self.home.read(cx).project_items(cx);
        let cloud = self.cloud.read(cx);
        let place = cloud.place_menu(&items, cx).filter(|_| opening.is_none());
        h_flex()
            .min_w_0()
            .gap(px(2.))
            .child(self.header_popover(Popover::Project, project, cx))
            .when_some(place, |d, menu| {
                d.child(self.header_popover(Popover::Place, cloud.place_button(&menu), cx))
                    .children(cloud.publish_header_mark(cx))
            })
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
            Popover::Share => "share-panel",
            Popover::Agents => "agents-panel",
        };
        let host = self.weak.clone();
        let mut menu = PopoverMenu::new(id)
            .anchor(Anchor::TopLeft)
            .offset(px(MENU_GAP))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    let open = s.popover == Some(popover);
                    if *opened != open {
                        s.set_popover(opened.then_some(popover), cx);
                        cx.notify();
                    }
                });
            })
            .trigger(trigger)
            .flex()
            .min_w_0();
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
                Popover::Place => {
                    let items = self.home.read(cx).project_items(cx);
                    let cloud = self.cloud.read(cx);
                    if let Some(place) = cloud.place_menu(&items, cx) {
                        let fill = cloud.place_rows(place, cx);
                        menu = menu.menu(move |surface, _, _| {
                            fill(
                                surface
                                    .variant(MenuVariant::Project)
                                    .min_w(px(super::project_place::PLACE_MENU_WIDTH))
                                    .max_w(px(320.))
                                    .max_h(px(PLACE_MENU_MAX_HEIGHT)),
                            )
                        });
                    }
                }
                // The Share and Agents cards have their own controls
                // (`share_control`, `agents_control`).
                Popover::Share | Popover::Agents => {}
            }
        }
        menu
    }
    /// `DesktopWorkspaceSwitcher` "projects" view over the shared project
    /// list (`projectCatalog.items`).
    fn project_menu(&self, cx: &App) -> impl FnOnce(Menu) -> Menu + 'static {
        let host = self.weak.clone();
        let action = move |command: Command| {
            let host = host.clone();
            move |w: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.command(command, w, cx));
            }
        };
        let current = self
            .workspace_root(cx)
            .map(|p| p.to_string_lossy().into_owned());
        let hosted = self.hosted_project(cx);
        let t = cx.palette();
        let copied = self.cloud.read(cx).copied_path.clone();
        let projects = self
            .home
            .read(cx)
            .project_items(cx)
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let selected = (item.local_path.is_some() && item.local_path == current)
                    || (hosted.is_some() && item.cloud_project == hosted);
                self.project_item(index, item, selected, copied.as_ref(), t)
            })
            .collect::<Vec<_>>();
        let home = MenuItem::new(tr("shell.workspaceSwitcher.home"))
            .icon_sized(Icon::new("arrow-left").with_size(px(15.)).stroke(2.))
            .on_click(action(Command::Home));
        // `onCreateProject`: the Project entry launcher.
        let create = MenuItem::new(tr("shell.workspaceSwitcher.createNew"))
            .icon_sized(Icon::new("plus").with_size(px(15.)).stroke(2.))
            .on_click(action(Command::CreateNew));
        move |menu| {
            let menu = menu.item(home);
            let menu = if projects.is_empty() {
                menu
            } else {
                menu.separator()
                    .list(PROJECT_LIST_GAP, projects)
                    .separator()
            };
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
        let name = super::home::item_name_or(&item, tr("onboarding.projects.untitled"));
        let mut row = MenuItem::new(name.clone())
            .icon_element(super::home::folder::list_icon(
                item.location(),
                false,
                false,
                t,
            ))
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
                        let copied = (copy_path.clone(), std::time::Instant::now());
                        s.cloud.update(cx, |c, _| c.copied_path = Some(copied));
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
        row.on_click(move |w, cx| {
            let _ = open_host.update(cx, |s, cx| {
                s.set_popover(None, cx);
                if current {
                    cx.notify();
                } else {
                    s.open_item(&item, w, cx);
                }
            });
        })
    }
}
