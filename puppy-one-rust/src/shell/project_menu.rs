//! Header popovers: `DesktopWorkspaceSwitcher` menu (Home, projects, New
//! workspace) and `DesktopProjectLocationSwitcher` (This Mac / Cloud). Both
//! hang from their trigger through `DesktopTitlebarMenuLayer`
//! (`resolveAnchoredOverlayPosition`: start aligned, below, margin 8) and wear
//! the `.desktop-project-menu` surface.
use super::*;
use crate::geometry::menu_position;
use crate::{
    localization::t as tr,
    theme::metric,
    ui::menu::{MenuItem, MenuStyle, menu_frame, menu_row, menu_section_label, menu_separator},
};
/// `preferredWidth={240}` of the project menu.
pub(super) const PROJECT_MENU_WIDTH: f32 = 240.;
pub(super) const LOCATION_MENU_WIDTH: f32 = 232.;
/// `.desktop-project-list` row gap.
const PROJECT_LIST_GAP: f32 = 2.;
impl Shell {
    fn anchor(&self, key: &str) -> Option<Rect> {
        self.anchors.borrow().get(key).map(|b| {
            Rect::new(
                f32::from(b.origin.x),
                f32::from(b.origin.y),
                f32::from(b.size.width),
                f32::from(b.size.height),
            )
        })
    }
    fn project_menu_rows(&self) -> usize {
        self.recent_projects.len().min(10)
    }
    /// Rendered height of the project menu: Home, the project list and
    /// New workspace, each group separated when the list is not empty.
    fn project_menu_height(&self, style: MenuStyle) -> f32 {
        let rows = self.project_menu_rows();
        let list = if rows == 0 {
            0.
        } else {
            2. * metric::MENU_SEPARATOR_BLOCK
                + rows as f32 * style.item_height
                + (rows - 1) as f32 * PROJECT_LIST_GAP
        };
        2. + 2. * style.padding + 2. * style.item_height + list
    }
    fn location_menu_height(&self, style: MenuStyle) -> f32 {
        let (_, label) = style.typography.meta();
        2. + 2. * style.padding + label + 4. + 2. * style.item_height
    }
    /// Popover rectangle in window coordinates.
    pub(super) fn popover_bounds(&self, cx: &App) -> Option<Rect> {
        let t = Theme::new(self.dark);
        let style = MenuStyle::project_menu(t);
        let (key, width, height) = match self.popover.as_ref()? {
            Popover::Project => (
                "project",
                PROJECT_MENU_WIDTH,
                self.project_menu_height(style),
            ),
            Popover::Location => (
                "location",
                LOCATION_MENU_WIDTH,
                self.location_menu_height(style),
            ),
        };
        let viewport = (self.layout.header.w, self.layout.editor.bottom());
        let anchor = self.anchor(key).unwrap_or(Rect::new(86., 6., 120., 28.));
        // `max-height: min(520px, calc(100vh - 58px))` on the surface.
        let max_height = 520f32.min(viewport.1 - 58.);
        // `menuAlignment="center"` when the experiment centres the project.
        let centered = key == "project"
            && self
                .preferences
                .read(cx)
                .state
                .experimental
                .centered_project_in_header;
        let position = menu_position::anchored_overlay(
            anchor,
            menu_position::titlebar_menu(width, 2., max_height, centered),
            viewport,
        );
        Some(Rect::new(
            position.left,
            position.top,
            position.width,
            height.min(position.max_height),
        ))
    }
    pub(super) fn project_popup(&self, cx: &mut Context<Self>) -> Stateful<Div> {
        let t = Theme::new(self.dark);
        let bounds = self.popover_bounds(cx).unwrap_or_default();
        let host = cx.weak_entity();
        let style = MenuStyle::project_menu(t);
        let surface = match &self.popover {
            Some(Popover::Location) => self.location_menu(style, t, host),
            _ => self.project_menu(style, t, host),
        };
        at(bounds)
            .child(surface.size_full())
            .id("project-popup")
            .on_mouse_down_out(cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                let p = (f32::from(e.position.x), f32::from(e.position.y));
                let trigger = match s.popover {
                    Some(Popover::Location) => s.anchor("location"),
                    _ => s.anchor("project"),
                };
                if !trigger.is_some_and(|r| r.contains(p)) {
                    s.popover = None;
                    cx.notify();
                }
            }))
    }
    /// `DesktopWorkspaceSwitcher` "projects" view.
    fn project_menu(&self, style: MenuStyle, t: Theme, host: WeakEntity<Self>) -> Stateful<Div> {
        let action = |command: Command| {
            let host = host.clone();
            move |w: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.command(command, w, cx));
            }
        };
        let current = self.files.workspace.as_ref().map(|ws| ws.path.clone());
        let mut menu = menu_frame("header-popover", style, t).child(menu_row(
            "project-menu-home",
            MenuItem::new(tr("shell.workspaceSwitcher.home"), action(Command::Home)).lucide(
                "arrow-left",
                15.,
                2.,
            ),
            style,
            t,
        ));
        let projects = self.recent_projects.iter().take(10).collect::<Vec<_>>();
        if !projects.is_empty() {
            let mut list = column().flex_shrink_0().gap(px(PROJECT_LIST_GAP));
            for (index, project) in projects.iter().enumerate() {
                let selected = current.as_ref() == Some(&project.path);
                list = list.child(self.project_switcher_row(index, project, selected, style, t));
            }
            menu = menu
                .child(menu_separator(t))
                .child(list)
                .child(menu_separator(t));
        }
        menu.child(menu_row(
            "project-menu-create",
            // `onCreateProject`: the native project entry is a folder picker.
            MenuItem::new(
                tr("shell.workspaceSwitcher.createNew"),
                action(Command::OpenFolder),
            )
            .lucide("plus", 15., 2.),
            style,
            t,
        ))
    }
    /// `DesktopProjectMenuItem`: the selected project carries a check at the
    /// row end; hovering any row swaps it for the copy-path button.
    fn project_switcher_row(
        &self,
        index: usize,
        project: &crate::features::settings::preference_types::RecentProject,
        selected: bool,
        style: MenuStyle,
        t: Theme,
    ) -> Stateful<Div> {
        let host = self.weak.clone();
        let path = project.path.clone();
        let copy_path = project.path.display().to_string();
        let copy_host = host.clone();
        let group = SharedString::from(format!("project-switcher-row-{index}"));
        let copy_label = tr("shell.workspaceSwitcher.copyPath");
        // `padding-inline-end: padding + 22px + gap`.
        let reserve = style.item_padding_inline + 22. + style.item_gap;
        // The trailing check is positioned by the row, not the item.
        let item = MenuItem::new(project.name.clone(), move |w, cx| {
            let path = path.clone();
            let _ = host.update(cx, |s, cx| s.open_project(path, w, cx));
        })
        .lucide("folder", 14., 1.85)
        .selected(selected);
        div()
            .id(("project-switcher-row", index))
            .group(group.clone())
            .relative()
            .flex_shrink_0()
            .child(
                menu_row(("project-switcher-item", index), item, style, t)
                    .pr(px(reserve))
                    .group_hover(group.clone(), move |s| s.bg(t.hover).text_color(t.text)),
            )
            .when(selected, |d| {
                d.child(
                    div()
                        .absolute()
                        .top_0()
                        .bottom_0()
                        .right(px(style.item_padding_inline + 4.))
                        .flex()
                        .items_center()
                        .group_hover(group.clone(), |s| s.invisible())
                        .child(crate::ui::icon_stroke("check", 14., 2., t.text)),
                )
            })
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right(px(style.item_padding_inline))
                    .flex()
                    .items_center()
                    .invisible()
                    .group_hover(group, |s| s.visible())
                    .child(
                        gpui_kit::base::Button::new(("copy-project-path", index))
                            .flex()
                            .items_center()
                            .justify_center()
                            .w(px(22.))
                            .h(px(theme::control_mini()))
                            .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
                            .text_color(t.subtle)
                            .cursor(theme::clickable_cursor())
                            .hover(move |s| s.bg(t.control).text_color(t.text))
                            .accessibility_label(format!("{copy_label}: {}", project.name))
                            .tooltip(crate::ui::tooltip(format!(
                                "{copy_label}\n{}",
                                project.path.display()
                            )))
                            .child(crate::ui::icon_stroke("copy", 14., 2., t.subtle))
                            .on_click(move |_, _, cx| {
                                cx.stop_propagation();
                                cx.write_to_clipboard(ClipboardItem::new_string(copy_path.clone()));
                                let _ = copy_host.update(cx, |s, cx| {
                                    s.popover = None;
                                    cx.notify()
                                });
                            }),
                    ),
            )
    }
    fn location_menu(&self, style: MenuStyle, t: Theme, host: WeakEntity<Self>) -> Stateful<Div> {
        let device = tr(if cfg!(target_os = "macos") {
            "shell.workspaceSwitcher.location.thisMac"
        } else {
            "shell.workspaceSwitcher.location.thisComputer"
        });
        let close = {
            let host = host.clone();
            move |w: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| {
                    s.popover = None;
                    s.project_focus.focus(w, cx);
                    cx.notify()
                });
            }
        };
        let entries = [
            MenuItem::new(device, close).icon("laptop").selected(true),
            MenuItem::new(tr("shell.projectOpen.inCloud"), |_, _| {})
                .icon("cloud")
                .detail(tr("shell.workspaceSwitcher.location.signInToAccess"))
                .disabled(true),
        ];
        let mut menu = menu_frame("header-popover", style, t).child(menu_section_label(
            tr("shell.workspaceSwitcher.projectDetails").into(),
            style,
            t,
        ));
        for (index, item) in entries.into_iter().enumerate() {
            menu = menu.child(menu_row(("location-item", index), item, style, t));
        }
        menu
    }
}
