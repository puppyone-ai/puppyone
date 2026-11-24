//! Compact `ProjectSwitcherRail`: one mark per remembered project, at the
//! window's start below the Header, in place of the Header's project
//! button.
use super::*;
use crate::{geometry::Rect, ui::appearance::ActiveAppearance};

impl WindowChrome {
    /// The rail in a window `h` tall, drawn from a read.
    pub(in crate::app) fn rail(&self, h: f32, cx: &App) -> Div {
        let t = cx.palette();
        let current = self.session.root.clone();
        let r = Rect::new(0., theme::HEADER, self.rail_width(), h - theme::HEADER);
        let mut rail = div()
            .absolute()
            .left(px(r.x))
            .top(px(r.y))
            .w(px(r.w))
            .h(px(r.h))
            .bg(t.sidebar)
            .border_r_1()
            .border_color(t.sidebar_divider)
            .flex()
            .flex_col()
            .items_center()
            .pt(px(12.))
            .gap(px(6.));
        let recent: Vec<_> = self
            .owners
            .preferences
            .read(cx)
            .state
            .recent_projects
            .iter()
            .take(12)
            .cloned()
            .collect();
        // Opening a project makes it the most recent; the rail keeps every
        // project where it was and moves only the active state.
        let order = {
            let mut slots = self.rail_slots.borrow_mut();
            *slots = merge_slots(
                &slots,
                &recent.iter().map(|p| p.path.clone()).collect::<Vec<_>>(),
            );
            slots.clone()
        };
        let recent = order
            .iter()
            .filter_map(|path| recent.iter().find(|p| &p.path == path));
        for (index, project) in recent.enumerate() {
            let active = current.as_ref() == Some(&project.path);
            let initial = initial(&project.name, &project.path);
            let path = project.path.clone();
            let target = super::super::project_actions::Target::Local {
                path: path.clone(),
                name: project.name.clone(),
            };
            let actions = self.project_actions.downgrade();
            rail = rail.child(
                gpui_kit::base::Button::new(("rail-project", index))
                    .debug_selector({
                        let name = project.name.clone();
                        move || format!("rail-project-{name}")
                    })
                    .accessibility_label(crate::localization::tf(
                        "shell.workspaceSwitcher.projectTitle",
                        &[("project", project.name.clone().into())],
                    ))
                    .selected(active)
                    .size(px(theme::control()))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(8.))
                    .border_1()
                    .border_color(if active {
                        t.border_strong
                    } else {
                        t.border_subtle
                    })
                    .bg(if active { t.selected } else { t.control })
                    .text_size(px(theme::ty().ui.label))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if active { t.text } else { t.muted })
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover))
                    .tooltip(crate::ui::components::tooltip(project.name.clone()))
                    .child(initial)
                    .on_mouse_down(MouseButton::Right, move |e, w, cx| {
                        cx.stop_propagation();
                        let at = Bounds::new(e.position, size(px(0.), px(0.)));
                        let (target, viewport) = (target.clone(), w.viewport_size());
                        let _ = actions
                            .update(cx, |a, cx| a.open(target, at, false, viewport, None, w, cx));
                    })
                    .on_click(self.listener(move |_, _, _, cx| {
                        cx.emit(ChromeEvent::OpenProject(path.clone()))
                    })),
            );
        }
        rail.child(
            IconButton::new("rail-plus", "plus")
                .label(crate::localization::t("shell.workspaceSwitcher.addProject"))
                .size(px(theme::control()))
                .on_click(self.listener(|s, _, _, cx| s.command(Command::CreateNew, cx))),
        )
    }
}

/// `mergeProjectSwitcherRailOrder`: the projects shown now, those already
/// in a slot kept where they were and new ones after them in `current`'s
/// order.
fn merge_slots(previous: &[PathBuf], current: &[PathBuf]) -> Vec<PathBuf> {
    previous
        .iter()
        .filter(|path| current.contains(path))
        .chain(current.iter().filter(|path| !previous.contains(path)))
        .cloned()
        .collect()
}

/// `getProjectSwitcherInitial`: the first grapheme of the Project's name,
/// else of its folder, uppercased.
fn initial(name: &str, path: &std::path::Path) -> String {
    use unicode_segmentation::UnicodeSegmentation as _;
    let folder = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    [name.trim(), folder.trim()]
        .into_iter()
        .find_map(|text| text.graphemes(true).next())
        .map(str::to_uppercase)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    /// `derives a stable Unicode grapheme from the Project identity`, and
    /// `preserves existing slots when the active and recent Project order
    /// changes`.
    #[test]
    fn rail_marks_take_a_grapheme_and_keep_their_slots() {
        let fallback = std::path::Path::new("/projects/fallback");
        assert_eq!(initial("  项目", fallback), "项");
        assert_eq!(initial("🧠 Lab", fallback), "🧠");
        assert_eq!(initial("e\u{301}clair", fallback), "E\u{301}");
        assert_eq!(initial("", std::path::Path::new("/projects/traction")), "T");
        let path = |p: &str| PathBuf::from(p);
        let (a, b, c) = (path("/a"), path("/b"), path("/c"));
        let first = merge_slots(&[], &[a.clone(), b.clone()]);
        assert_eq!(first, [a.clone(), b.clone()]);
        assert_eq!(
            merge_slots(&first, &[b.clone(), a.clone()]),
            [a.clone(), b.clone()]
        );
        assert_eq!(
            merge_slots(&first, &[c.clone(), b.clone()]),
            [b.clone(), c.clone()]
        );
    }
}
