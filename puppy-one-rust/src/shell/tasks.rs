use super::*;
use crate::features::settings::{SettingsWorkspaceSurface, preferences_store::PreferencesStore};
pub struct TaskUi {
    pub settings: Entity<SettingsWorkspaceSurface>,
    pub message: Entity<ui::form_input::TextInput>,
    pub email: Entity<ui::form_input::TextInput>,
}
impl TaskUi {
    pub fn new(
        preferences: Entity<PreferencesStore>,
        window: &mut Window,
        cx: &mut Context<Shell>,
    ) -> Self {
        Self {
            settings: cx.new(|cx| SettingsWorkspaceSurface::new(preferences, window, cx)),
            message: cx.new(|cx| {
                let mut i = ui::form_input::TextInput::new(
                    crate::localization::t("shell.feedback.placeholder"),
                    true,
                    2000,
                    window,
                    cx,
                );
                i.min_height = 112.;
                i
            }),
            email: cx.new(|cx| {
                ui::form_input::TextInput::new("you@example.com", false, 254, window, cx)
            }),
        }
    }
    pub fn clear(&mut self, cx: &mut Context<Shell>) {
        self.message.update(cx, |i, cx| i.clear(cx));
        self.email.update(cx, |i, cx| i.clear(cx));
    }
}
/// `.desktop-settings-dialog-backdrop`: `color-mix(var(--po-backdrop) 84%,
/// transparent)` (the product's 1.5px backdrop blur has no GPUI equivalent).
pub(crate) fn task_backdrop(t: Theme) -> Rgba {
    Rgba {
        a: t.backdrop.a * 0.84,
        ..t.backdrop
    }
}
/// `DesktopDialogSurface` (`.desktop-dialog-surface`) at `r`.
pub(crate) fn modal_card(r: Rect, t: Theme) -> Stateful<Div> {
    div()
        .absolute()
        .left(px(r.x))
        .top(px(r.y))
        .w(px(r.w))
        .h(px(r.h))
        .id("modal-card")
        .bg(t.overlay)
        .border_1()
        .border_color(t.divider)
        .rounded(px(crate::theme::metric::DIALOG_RADIUS))
        .shadow(vec![BoxShadow {
            inset: false,
            color: t.shadow.into(),
            offset: point(px(0.), px(24.)),
            blur_radius: px(48.),
            spread_radius: px(0.),
        }])
        .overflow_hidden()
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
}
/// `SettingsDialog` (`.desktop-settings-dialog`): the task dialog centred in
/// a `w`×`h` window. Shared by the shell and the pixel lab.
pub(crate) fn settings_dialog(
    settings: Entity<SettingsWorkspaceSurface>,
    w: f32,
    h: f32,
    t: Theme,
) -> Stateful<Div> {
    let (width, height) = settings_size(w, h);
    modal_card(
        Rect::new((w - width) / 2., (h - height) / 2., width, height),
        t,
    )
    .rounded(px(crate::theme::metric::TASK_DIALOG_RADIUS))
    .bg(t.canvas)
    .child(settings)
}
pub fn settings_size(w: f32, h: f32) -> (f32, f32) {
    let inset = 2. * crate::theme::metric::TASK_DIALOG_INSET;
    ((w - inset).clamp(280., 960.), (h - inset).clamp(240., 760.))
}
impl Shell {
    pub(super) fn dialog_host(&self, cx: &mut Context<Self>) -> gpui_kit::base::Dialog {
        gpui_kit::base::Dialog::new(cx)
            .focus_handle(self.modal_focus.clone())
            .close_on_escape(false)
            .close_on_backdrop_press(false)
            .on_ok(|_, _, _| false)
            .backdrop(div().size_full().bg(Theme::new(self.dark).backdrop))
    }
    pub(super) fn modal_card(&self, r: Rect) -> Stateful<Div> {
        modal_card(r, Theme::new(self.dark))
    }
    pub(super) fn simple_modal(
        &self,
        title: &str,
        message: &str,
        actions: Vec<(&'static str, Command, ui::Tone)>,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let t = Theme::new(self.dark);
        let w = (self.layout.header.w - 32.).min(440.);
        let h = 180.;
        let card = self.modal_card(Rect::new(
            (self.layout.header.w - w) / 2.,
            (self.layout.editor.bottom() - h) / 2.,
            w,
            h,
        ));
        self.dialog_host(cx).popup(
            card.child(
                column()
                    .p(px(24.))
                    .size_full()
                    .gap(px(10.))
                    .child(
                        div()
                            .text_size(px(crate::theme::ty().ui.title))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.text)
                            .child(title.to_owned()),
                    )
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(crate::theme::ty().ui.body))
                            .text_color(t.muted)
                            .child(message.to_owned()),
                    )
                    .child(
                        row()
                            .justify_end()
                            .gap(px(8.))
                            .children(actions.into_iter().map(|(label, action, tone)| {
                                ui::action_button(label, label, None, tone, false, t).on_click(
                                    cx.listener(move |s, _, w, cx| s.command(action, w, cx)),
                                )
                            })),
                    ),
            ),
        )
    }
    pub(super) fn settings_view(
        &self,
        w: f32,
        h: f32,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let root = self.files.workspace.as_ref().map(|ws| ws.path.clone());
        self.task_ui.settings.update(cx, |s, cx| {
            s.set_root(root, cx);
        });
        let host = cx.weak_entity();
        self.dialog_host(cx)
            .backdrop(div().size_full().bg(task_backdrop(Theme::new(self.dark))))
            .close_on_backdrop_press(true)
            .on_cancel(move |_, w, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.close_tasks(w, cx);
                    cx.notify()
                });
                true
            })
            .popup(settings_dialog(
                self.task_ui.settings.clone(),
                w,
                h,
                Theme::new(self.dark),
            ))
    }
    pub(super) fn create_entry_view(
        &self,
        w: f32,
        h: f32,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let width = (w - 64.).clamp(280., 420.);
        let height = 240.;
        self.dialog_host(cx).popup(
            self.modal_card(Rect::new(
                (w - width) / 2.,
                (h - height) / 2.,
                width,
                height,
            ))
            .child(self.create_entry.clone().unwrap()),
        )
    }
    pub(super) fn feedback_view(
        &self,
        w: f32,
        h: f32,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let t = Theme::new(self.dark);
        let width = (w - 32.).clamp(280., 400.);
        let height = (h - 32.).min(480.);
        self.task_ui.message.update(cx, |i, _| {
            i.dark = self.dark;
            i.set_placeholder(self.locale.text("shell.feedback.placeholder"));
        });
        self.task_ui.email.update(cx, |i, _| i.dark = self.dark);
        self.dialog_host(cx).popup(
            self.modal_card(Rect::new(
                (w - width) / 2.,
                (h - height) / 2.,
                width,
                height,
            ))
            .child(
                column()
                    .id("feedback-content")
                    .size_full()
                    .p(px(20.))
                    .gap(px(12.))
                    .overflow_y_scroll()
                    .child(
                        row()
                            .justify_between()
                            .child(self.locale.text("shell.feedback.label"))
                            .child(
                                ui::icon_button("feedback-close", "x", t)
                                    .accessibility_label(self.locale.text("common.action.close"))
                                    .on_click(cx.listener(|s, _, w, cx| {
                                        s.command(Command::CloseFile, w, cx)
                                    })),
                            ),
                    )
                    .child(format!(
                        "{} *",
                        self.locale.text("shell.feedback.messageLabel")
                    ))
                    .child(self.task_ui.message.clone())
                    .child(
                        div()
                            .text_size(px(crate::theme::font_size(11.)))
                            .text_color(t.subtle)
                            .child(format!(
                                "{} / 2000",
                                self.task_ui.message.read(cx).text().chars().count()
                            )),
                    )
                    .child(
                        row()
                            .gap(px(6.))
                            .text_color(t.subtle)
                            .child(ui::icon_sized("image-plus", 14., t.subtle))
                            .child(self.locale.text("shell.feedback.attachScreenshot")),
                    )
                    .child(format!(
                        "{} *",
                        self.locale.text("shell.feedback.contactLabel")
                    ))
                    .child(self.task_ui.email.clone())
                    .child(
                        div()
                            .text_size(px(crate::theme::font_size(12.)))
                            .text_color(t.subtle)
                            .child(self.locale.text("native.feedback.notConnected")),
                    )
                    .child(
                        row().justify_end().child(
                            div()
                                .text_color(t.subtle)
                                .child(self.locale.text("shell.feedback.send")),
                        ),
                    ),
            ),
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn product_settings_geometry_is_bounded() {
        assert_eq!(settings_size(1280., 800.), (960., 736.));
        assert_eq!(settings_size(640., 480.), (576., 416.));
        assert_eq!(settings_size(1920., 1080.), (960., 760.));
    }
}
