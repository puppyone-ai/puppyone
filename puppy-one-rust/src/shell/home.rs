//! Port of `MinimalOnboarding` / `OnboardingHomeLayout`: brand lockup, the
//! project history and entry actions. Shown with no open project and from the
//! project menu's Home item. Creating projects from templates and importing from
//! other apps are not native yet, so those actions are disabled.
use super::*;
use crate::{
    localization::{t as tr, tf},
    ui::{
        appearance::ActiveAppearance,
        components::{Icon, IconButton},
    },
};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};
impl Shell {
    /// Web hides the workspace chrome on the homepage; so does the native shell.
    pub(super) fn home_visible(&self) -> bool {
        !self.fixture && (self.home || self.files.workspace.is_none())
    }
    fn entry_action(
        &self,
        id: &'static str,
        icon: &'static str,
        label: &'static str,
        primary: bool,
        disabled: bool,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Button {
        let t = cx.palette();
        let (bg, fg) = if primary {
            (theme::alpha(t.accent, 0.12), t.accent_text)
        } else {
            (t.control, t.text)
        };
        gpui_kit::base::Button::new(id)
            .accessibility_label(label)
            .disabled(disabled)
            .flex()
            .items_center()
            .w_full()
            .h(px(theme::control() + 4.))
            .px(px(12.))
            .gap(px(8.))
            .rounded(px(theme::metric::CONTROL_RADIUS + 2.))
            .bg(bg)
            .text_size(px(theme::ty().ui.body))
            .font_weight(FontWeight::MEDIUM)
            .text_color(fg)
            .when(disabled, |b| b.opacity(0.5))
            .when(!disabled, |b| {
                b.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.control_hover))
            })
            .child(Icon::new(icon).large().color(fg))
            .child(label)
            .when(!disabled && id == "open-folder", |b| {
                b.on_click(cx.listener(|s, _, w, cx| s.command(Command::OpenFolder, w, cx)))
            })
    }
    pub(super) fn home_view(&self, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let r = Rect::new(
            0.,
            theme::HEADER,
            self.layout.header.w,
            self.layout.editor.h,
        );
        let has_projects = !self.recent_projects.is_empty();
        // `OnboardingBrandLockup`: a 28px mark and the heading in `--po-text-muted`.
        // On dark the product applies `grayscale(1) brightness(0.7)` to the mark;
        // GPUI images have no brightness filter, so the dark variant is the same
        // artwork with that filter baked in (`assets/README.md`).
        let brand = h_flex()
            .gap(px(12.))
            .mb(px(if has_projects { 34. } else { 24. }))
            .child(
                img(SharedString::from(if self.dark {
                    "brand/puppy-dark-onboarding.svg"
                } else {
                    "brand/puppy-lite.svg"
                }))
                .size(px(28.))
                .object_fit(ObjectFit::Contain)
                .flex_shrink_0(),
            )
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(theme::ty().ui.heading))
                    .line_height(px(22.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.muted)
                    .child(tr(if has_projects {
                        "onboarding.section.chooseProject"
                    } else {
                        "onboarding.brand.agentReadyMessage"
                    })),
            );
        let mut list = v_flex()
            .id("home-projects")
            .w_full()
            .max_h(px(360.))
            .overflow_y_scroll()
            .gap(px(2.));
        for (index, project) in self.recent_projects.iter().enumerate() {
            let path = project.path.clone();
            let remove = project.path.clone();
            let name = project.name.clone();
            let parent = project
                .path
                .parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default();
            let remove_label = tf(
                "onboarding.projects.removeFor",
                &[("project", name.clone().into())],
            );
            list = list.child(
                h_flex()
                    .id(("home-project", index))
                    .w_full()
                    .min_h(px(theme::control() + 8.))
                    .gap(px(10.))
                    .px(px(10.))
                    .rounded(px(theme::metric::CONTROL_RADIUS))
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover))
                    .child(Icon::new("folder").large().color(t.muted))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(theme::ty().ui.body))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.text)
                                    .child(name),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(theme::ty().ui.meta))
                                    .text_color(t.subtle)
                                    .child(parent),
                            ),
                    )
                    .child(
                        IconButton::new(("home-project-remove", index), "unlink")
                            .with_size(px(24.))
                            .label(remove_label.clone())
                            .tooltip(format!(
                                "{remove_label}\n{}",
                                tr("onboarding.projects.removeHint")
                            ))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                cx.stop_propagation();
                                let remove = remove.clone();
                                s.preferences.update(cx, |p, cx| {
                                    p.change(|p| p.forget_project(&remove), cx)
                                });
                            })),
                    )
                    .on_click(cx.listener(move |s, _, w, cx| s.open_project(path.clone(), w, cx))),
            );
        }
        let mut launcher = v_flex().w(px(440.)).max_w_full().child(brand);
        if has_projects {
            launcher = launcher.child(
                v_flex()
                    .gap(px(6.))
                    .mb(px(12.))
                    .child(
                        div()
                            .px(px(10.))
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.subtle)
                            .child(tr("onboarding.projects.title")),
                    )
                    .child(list),
            );
        }
        launcher = launcher.child(
            v_flex()
                .gap(px(6.))
                .child(self.entry_action(
                    "create-project",
                    "file-plus-2",
                    tr("onboarding.action.createLocalProject"),
                    !has_projects,
                    true,
                    cx,
                ))
                .child(self.entry_action(
                    "open-folder",
                    "folder-open",
                    tr("onboarding.action.openFolder"),
                    false,
                    self.pending || self.files.busy(),
                    cx,
                ))
                .child(self.entry_action(
                    "import-project",
                    "download",
                    tr("onboarding.action.importFromApps"),
                    false,
                    true,
                    cx,
                )),
        );
        at(r)
            .bg(t.canvas)
            .flex()
            .items_center()
            .justify_center()
            .px(px(24.))
            .child(launcher)
    }
}
