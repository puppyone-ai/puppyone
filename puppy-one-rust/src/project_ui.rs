//! Header popovers: `DesktopWorkspaceSwitcher` menu (Home, projects, Open
//! Folder) and `DesktopProjectLocationSwitcher` (This Mac / Cloud). Each popover
//! has a known rectangle so native hit routing owns it above the Web editor.
use super::*;
use crate::{
    localization::t as tr,
    ui::menu::{MenuEntry, MenuItem, menu_surface},
};
pub(super) const PROJECT_MENU_WIDTH: f32 = 240.;
pub(super) const LOCATION_MENU_WIDTH: f32 = 232.;
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
    /// Popover rectangle in window coordinates (registered with `HitMap`).
    pub(super) fn popover_bounds(&self) -> Option<Rect> {
        let popover = self.popover.as_ref()?;
        let (key, width, height) = match popover {
            Popover::Project => {
                let rows = self.preferences_rows();
                (
                    "project",
                    PROJECT_MENU_WIDTH,
                    8. + 32. * (rows + 2) as f32 + 18.,
                )
            }
            Popover::Location => ("location", LOCATION_MENU_WIDTH, 8. + 32. * 2. + 26.),
            Popover::Explorer(menu) => return Some(menu.bounds),
        };
        let anchor = self.anchor(key).unwrap_or(Rect::new(86., 6., 120., 28.));
        let max_x = (self.layout.header.w - width - 8.).max(8.);
        Some(Rect::new(
            anchor.x.min(max_x),
            anchor.bottom() + 2.,
            width,
            height.min(520.),
        ))
    }
    fn preferences_rows(&self) -> usize {
        self.recent_projects.len().min(10)
    }
    pub(super) fn project_popup(&self, cx: &mut Context<Self>) -> Stateful<Div> {
        let t = Theme::new(self.dark);
        let bounds = self.popover_bounds().unwrap_or_default();
        let host = cx.weak_entity();
        let entries = match &self.popover {
            Some(Popover::Location) => self.location_entries(t, host),
            _ => self.project_entries(t, host),
        };
        at(bounds)
            .child(menu_surface("header-popover", entries, t).size_full())
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
    fn project_entries(&self, t: Theme, host: WeakEntity<Self>) -> Vec<MenuEntry> {
        let action = |name: &'static str| {
            let host = host.clone();
            move |w: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.command(name, w, cx));
            }
        };
        let current = self.files.workspace.as_ref().map(|ws| ws.path.clone());
        let mut entries = vec![MenuEntry::Item(
            MenuItem::new(tr("shell.workspaceSwitcher.home"), action("home")).icon("arrow-left", t),
        )];
        if !self.recent_projects.is_empty() {
            entries.push(MenuEntry::Separator);
        }
        for project in self.recent_projects.iter().take(10) {
            let path = project.path.clone();
            let host = host.clone();
            let selected = current.as_ref() == Some(&project.path);
            let copy_path = project.path.display().to_string();
            let copy_host = host.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(project.name.clone(), move |w, cx| {
                    let path = path.clone();
                    let _ = host.update(cx, |s, cx| s.open_project(path, w, cx));
                })
                .icon("folder", t)
                .checked(selected)
                .trailing(
                    crate::ui::icon_button(
                        SharedString::from(format!("copy-project-path-{}", project.path.display())),
                        "copy",
                        t,
                    )
                    .size(px(22.))
                    .accessibility_label(tr("shell.workspaceSwitcher.copyPath"))
                    .tooltip(crate::ui::tooltip(format!(
                        "{}\n{}",
                        tr("shell.workspaceSwitcher.copyPath"),
                        project.path.display()
                    )))
                    .on_click(move |_, _, cx| {
                        cx.stop_propagation();
                        cx.write_to_clipboard(ClipboardItem::new_string(copy_path.clone()));
                        let _ = copy_host.update(cx, |s, cx| {
                            s.popover = None;
                            cx.notify()
                        });
                    })
                    .into_any_element(),
                ),
            ));
        }
        entries.push(MenuEntry::Separator);
        entries.push(MenuEntry::Item(
            MenuItem::new(
                tr("shell.workspaceSwitcher.openFolder"),
                action("open-folder"),
            )
            .icon("folder-plus", t),
        ));
        entries
    }
    fn location_entries(&self, t: Theme, host: WeakEntity<Self>) -> Vec<MenuEntry> {
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
        vec![
            MenuEntry::Section(tr("shell.workspaceSwitcher.projectDetails").into()),
            MenuEntry::Item(MenuItem::new(device, close).icon("laptop", t).checked(true)),
            MenuEntry::Item(
                MenuItem::new(tr("shell.projectOpen.inCloud"), |_, _| {})
                    .icon("cloud", t)
                    .detail(tr("shell.workspaceSwitcher.location.signInToAccess"))
                    .disabled(true),
            ),
        ]
    }
}
