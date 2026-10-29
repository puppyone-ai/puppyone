//! Header popovers: the `DesktopWorkspaceSwitcher` menu (Home, recent
//! projects, New workspace) and `DesktopProjectLocationSwitcher` (This Mac /
//! Cloud). Both hang 2px below their trigger, start aligned (centred when the
//! project sits in the middle of the Header), on the `.desktop-project-menu`
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
/// `preferredWidth={200}` of the location popover.
const LOCATION_MENU_WIDTH: f32 = 200.;
/// `DesktopTitlebarMenuLayer`'s gap below the trigger.
const MENU_GAP: f32 = 2.;
/// `.desktop-project-list` row gap.
const PROJECT_LIST_GAP: f32 = 2.;
/// `max-height: min(520px, calc(100vh - 58px))` on the surface.
const MENU_MAX_HEIGHT: f32 = 520.;
const MENU_VIEWPORT_INSET: f32 = 58.;
/// `.desktop-project-switcher-copy`: a 22px button in the row's end slot.
const COPY_BUTTON: f32 = 22.;

impl Shell {
    /// `DesktopWorkspaceSwitcher` trigger + `DesktopProjectLocationSwitcher` trigger.
    pub(super) fn project_context(&self, cx: &mut Context<Self>) -> Div {
        let label = tf(
            "shell.workspaceSwitcher.openMenu",
            &[("workspace", self.project.clone().into())],
        );
        let name = if self.project.is_empty() {
            tr("onboarding.action.openFolder").to_owned()
        } else {
            self.project.clone()
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
        // `DesktopProjectLocationSwitcher` renders only when Cloud workspaces
        // are enabled (`projectLocation` is undefined otherwise).
        let cloud = self.preferences.read(cx).state.experimental.cloud_workspace;
        h_flex()
            .min_w_0()
            .gap(px(2.))
            .child(self.header_popover(Popover::Project, project, cx))
            .when(cloud, |d| {
                // `.desktop-titlebar-location-button`: the computer the
                // screen shows and its readiness, then its name.
                let (place, readiness) = self.header_location(cx);
                let label = tr(match place {
                    super::cloud_switch::Place::Local => "shell.workspaceSwitcher.location.local",
                    super::cloud_switch::Place::Cloud => "shell.projectRuntime.label",
                });
                let stated = match readiness {
                    super::cloud_switch::Readiness::Ready => label.to_owned(),
                    super::cloud_switch::Readiness::Opening => tf(
                        "shell.projectComputers.status.opening",
                        &[("computer", label.into())],
                    ),
                    super::cloud_switch::Readiness::Failed => tf(
                        "shell.projectComputers.status.failed",
                        &[("computer", label.into())],
                    ),
                };
                let location = Button::new("project-location")
                    .variant(ButtonVariant::Titlebar)
                    .icon(Self::location_mark(place, readiness, cx.palette()).large())
                    .label(label)
                    .accessibility_label(format!(
                        "{stated}, {}",
                        tr("shell.workspaceSwitcher.projectDetails")
                    ))
                    .px(px(6.))
                    .text_size(px(ty.content))
                    .line_height(px(ty.line_height))
                    .font_weight(FontWeight::MEDIUM);
                d.child(self.header_popover(Popover::Location, location, cx))
                    .children(self.publish_header_mark(cx))
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
        // `menuAlignment="center"` when the experiment centres the project.
        let centered = popover == Popover::Project
            && self
                .preferences
                .read(cx)
                .state
                .experimental
                .centered_project_in_header;
        let (id, width) = match popover {
            Popover::Project => ("project-menu", PROJECT_MENU_WIDTH),
            Popover::Location => ("location-menu", LOCATION_MENU_WIDTH),
        };
        let host = self.weak.clone();
        let mut menu = PopoverMenu::new(id)
            .anchor(if centered {
                Anchor::TopCenter
            } else {
                Anchor::TopLeft
            })
            .offset(px(MENU_GAP))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    let open = s.popover == Some(popover);
                    if *opened != open {
                        s.popover = opened.then_some(popover);
                        cx.notify();
                    }
                });
            })
            .trigger(trigger)
            .flex()
            .min_w_0();
        if open {
            let fill: Box<dyn FnOnce(Menu) -> Menu> = match popover {
                Popover::Project => Box::new(self.project_menu(cx)),
                Popover::Location => Box::new(self.location_menu(cx)),
            };
            menu = menu.menu(move |surface, window, _| {
                let max_height = (window.viewport_size().height - px(MENU_VIEWPORT_INSET))
                    .min(px(MENU_MAX_HEIGHT));
                fill(
                    surface
                        .variant(MenuVariant::Project)
                        .w(px(width))
                        .max_h(max_height),
                )
            });
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
            .workspace_root()
            .map(|p| p.to_string_lossy().into_owned());
        let hosted = self.hosted_project();
        let t = cx.palette();
        let projects = self
            .project_items(cx)
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let selected = (item.local_path.is_some() && item.local_path == current)
                    || (hosted.is_some() && item.cloud_project == hosted);
                self.project_item(index, item, selected, t)
            })
            .collect::<Vec<_>>();
        let home = MenuItem::new(tr("shell.workspaceSwitcher.home"))
            .icon_sized(Icon::new("arrow-left").with_size(px(15.)).stroke(2.))
            .on_click(action(Command::Home));
        // `onCreateProject`: the native project entry is a folder picker.
        let create = MenuItem::new(tr("shell.workspaceSwitcher.createNew"))
            .icon_sized(Icon::new("plus").with_size(px(15.)).stroke(2.))
            .on_click(action(Command::OpenFolder));
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
    /// row end; hovering a checkout swaps the end slot for a copy-path
    /// button. Choosing keeps this window for a checkout; a hosted-only
    /// Project opens in its own window.
    fn project_item(
        &self,
        index: usize,
        item: crate::workspace::cloud::catalog::Item,
        current: bool,
        t: Theme,
    ) -> MenuItem {
        let open_host = self.weak.clone();
        let name = item.label.clone();
        let mut row = MenuItem::new(name.clone())
            .icon_element(super::home::project_icon(item.location(), t))
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
            let copy_label = tr("shell.workspaceSwitcher.copyPath");
            let copy_path = path.clone();
            row = row.hover_trailing(
                IconButton::new(
                    ("copy-project-path", index),
                    Icon::new("copy").small().stroke(2.),
                )
                .label(format!("{copy_label}: {name}"))
                .tooltip(format!("{copy_label}\n{copy_path}"))
                .with_size(px(COPY_BUTTON))
                .on_click(move |_, _, cx| {
                    cx.stop_propagation();
                    cx.write_to_clipboard(ClipboardItem::new_string(copy_path.clone()));
                    let _ = copy_host.update(cx, |s, cx| {
                        s.popover = None;
                        cx.notify()
                    });
                }),
            );
        }
        row.on_click(move |w, cx| {
            let _ = open_host.update(cx, |s, cx| {
                s.popover = None;
                if current {
                    cx.notify();
                } else if let Some(path) = &item.local_path {
                    s.open_project(PathBuf::from(path), w, cx);
                } else if let Some(project) = item.cloud_project.clone() {
                    let _ = super::windows::open_cloud(project, cx);
                    cx.notify();
                }
            });
        })
    }
}
