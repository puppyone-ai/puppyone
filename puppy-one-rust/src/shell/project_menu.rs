//! Header popovers: the `DesktopWorkspaceSwitcher` menu (Home, recent
//! projects, New workspace) and `DesktopProjectLocationSwitcher` (This Mac /
//! Cloud). Both hang 2px below their trigger, start aligned (centred when the
//! project sits in the middle of the Header), on the `.desktop-project-menu`
//! surface. GPUI Kit places, clamps and dismisses them; the shell holds which
//! one is open so commands and keys can open it too.
use super::*;
use crate::{
    features::settings::preference_types::RecentProject,
    localization::{t as tr, tf},
    ui::components::{
        Button, ButtonVariant, Icon, IconButton, Menu, MenuItem, MenuVariant, PopoverMenu,
    },
};
use gpui_kit::{base::h_flex, component::Sizable as _};

/// `preferredWidth={240}` of the project menu.
const PROJECT_MENU_WIDTH: f32 = 240.;
const LOCATION_MENU_WIDTH: f32 = 232.;
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
        let device = tr(if cfg!(target_os = "macos") {
            "shell.workspaceSwitcher.location.thisMac"
        } else {
            "shell.workspaceSwitcher.location.thisComputer"
        });
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
                let location = Button::new("project-location")
                    .variant(ButtonVariant::Titlebar)
                    .icon(Icon::product(crate::ui::components::ProductIcon::Local).large())
                    .accessibility_label(format!(
                        "{device}, {}",
                        tr("shell.workspaceSwitcher.projectDetails")
                    ))
                    .tooltip(device)
                    .w(px(theme::control()));
                d.child(self.header_popover(Popover::Location, location, cx))
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
                Popover::Project => Box::new(self.project_menu()),
                Popover::Location => Box::new(self.location_menu()),
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
    /// `DesktopWorkspaceSwitcher` "projects" view.
    fn project_menu(&self) -> impl FnOnce(Menu) -> Menu + 'static {
        let host = self.weak.clone();
        let action = move |command: Command| {
            let host = host.clone();
            move |w: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.command(command, w, cx));
            }
        };
        let current = self
            .files
            .workspace
            .as_ref()
            .and_then(|ws| ws.local_root().map(PathBuf::from));
        let projects = self
            .recent_projects
            .iter()
            .take(10)
            .enumerate()
            .map(|(index, project)| {
                self.project_item(index, project, current.as_ref() == Some(&project.path))
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
    /// row end; hovering any row swaps the end slot for a copy-path button.
    fn project_item(&self, index: usize, project: &RecentProject, current: bool) -> MenuItem {
        let open_host = self.weak.clone();
        let copy_host = self.weak.clone();
        let path = project.path.clone();
        let copy_path = project.path.display().to_string();
        let copy_label = tr("shell.workspaceSwitcher.copyPath");
        let copy = IconButton::new(
            ("copy-project-path", index),
            Icon::new("copy").small().stroke(2.),
        )
        .label(format!("{copy_label}: {}", project.name))
        .tooltip(format!("{copy_label}\n{copy_path}"))
        .with_size(px(COPY_BUTTON))
        .on_click(move |_, _, cx| {
            cx.stop_propagation();
            cx.write_to_clipboard(ClipboardItem::new_string(copy_path.clone()));
            let _ = copy_host.update(cx, |s, cx| {
                s.popover = None;
                cx.notify()
            });
        });
        MenuItem::new(project.name.clone())
            .icon_sized(
                Icon::product(crate::ui::components::ProductIcon::Folder)
                    .small()
                    .stroke(1.85),
            )
            .selected(current)
            .trailing(
                div()
                    .w(px(COPY_BUTTON))
                    .flex()
                    .justify_center()
                    .when(current, |d| d.child(Icon::new("check").small().stroke(2.))),
            )
            .hover_trailing(copy)
            .on_click(move |w, cx| {
                let path = path.clone();
                let _ = open_host.update(cx, |s, cx| s.open_project(path, w, cx));
            })
    }
    /// `DesktopProjectLocationSwitcher`: this computer, or Cloud once signed in.
    fn location_menu(&self) -> impl FnOnce(Menu) -> Menu + 'static {
        let device = tr(if cfg!(target_os = "macos") {
            "shell.workspaceSwitcher.location.thisMac"
        } else {
            "shell.workspaceSwitcher.location.thisComputer"
        });
        let host = self.weak.clone();
        let local = MenuItem::new(device)
            .product_icon(crate::ui::components::ProductIcon::Local)
            .selected(true)
            .on_click(move |w, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.popover = None;
                    s.project_focus.focus(w, cx);
                    cx.notify()
                });
            });
        let cloud = MenuItem::new(tr("shell.projectOpen.inCloud"))
            .product_icon(crate::ui::components::ProductIcon::Cloud)
            .detail(tr("shell.workspaceSwitcher.location.signInToAccess"))
            .disabled(true);
        move |menu| {
            menu.label(tr("shell.workspaceSwitcher.projectDetails"))
                .item(local)
                .item(cloud)
        }
    }
}
