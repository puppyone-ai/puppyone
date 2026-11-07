//! Compact `ProjectSwitcherRail`: one mark per remembered project, at the
//! window's start below the Header, in place of the Header's project
//! button.
use super::*;
use crate::{geometry::Rect, ui::appearance::ActiveAppearance};

impl WindowChrome {
    /// The rail in a window `h` tall, drawn from a read.
    pub(in crate::shell) fn rail(&self, h: f32, cx: &App) -> Div {
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
        let recent = self
            .owners
            .preferences
            .read(cx)
            .state
            .recent_projects
            .clone();
        for (index, project) in recent.iter().take(12).enumerate() {
            let active = current.as_ref() == Some(&project.path);
            let initial = project
                .name
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            let path = project.path.clone();
            let target = super::super::project_actions::Target::Local {
                path: path.clone(),
                name: project.name.clone(),
            };
            let actions = self.project_actions.downgrade();
            rail = rail.child(
                gpui_kit::base::Button::new(("rail-project", index))
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
                            .update(cx, |a, cx| a.open(target, at, false, viewport, None, cx));
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
