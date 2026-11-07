//! The layer's own dialogs: Settings and Help, the create form, a notice,
//! the quit and close questions, the running sessions and a project that
//! could not open. Their buttons ask the shell ([`DialogEvent::Command`]).
use super::*;
use crate::{
    geometry::Rect,
    theme::{self, Theme},
    ui::{
        appearance::ActiveAppearance,
        components::{Button, Dialog},
    },
};

impl DialogLayer {
    /// The button that asks the shell to run `command`.
    fn on_command(
        command: Command,
        cx: &mut Context<Self>,
    ) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
        cx.listener(move |_, _, _, cx| cx.emit(DialogEvent::Command(command)))
    }
    /// A notice or confirmation: title, message and footer actions. Escape
    /// and the close button run the first action (the cancel or dismiss).
    pub(super) fn simple_modal(
        &self,
        title: &str,
        message: &str,
        actions: Vec<(&'static str, Command, ButtonVariant)>,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let cancel = actions.first().map(|(_, command, _)| *command);
        let mut dialog = Dialog::new("simple-modal")
            .width(440.)
            .title(title.to_owned())
            .focus_handle(self.focus.clone())
            .keep_on_backdrop()
            .child(message.to_owned());
        if let Some(command) = cancel {
            let layer = cx.weak_entity();
            dialog = dialog.on_close(move |_, cx| {
                let _ = layer.update(cx, |_, cx| cx.emit(DialogEvent::Command(command)));
            });
        }
        for (label, command, variant) in actions {
            dialog = dialog.footer(
                Button::new(label)
                    .variant(variant)
                    .label(label)
                    .on_click(Self::on_command(command, cx)),
            );
        }
        dialog
    }
    /// A notice: Close, and Retry while the failed file operation can run
    /// again.
    pub(super) fn error_dialog(&self, message: &str, cx: &mut Context<Self>) -> Dialog {
        let mut actions = vec![(
            tr("common.action.close"),
            Command::ClearError,
            ButtonVariant::Secondary,
        )];
        if self.can_retry {
            actions.push((
                tr("common.action.retry"),
                Command::RetryFileOperation,
                ButtonVariant::Solid,
            ));
        }
        self.simple_modal(tr("native.error.title"), message, actions, cx)
    }
    /// Manage Running Sessions: this window's Agent and terminal hosts from
    /// the host budget, so they stay manageable after their tabs close.
    pub(super) fn executions_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        use crate::platform::host_budget::{Budget, Cleanup};
        let t = cx.palette();
        let rows: Vec<_> = Budget::global()
            .snapshot()
            .into_iter()
            .filter(|r| r.owner == self.owner || r.owner == "application")
            .collect();
        let layer = cx.weak_entity();
        let mut list = div().flex().flex_col().gap(px(8.));
        if rows.is_empty() {
            list = list.child(tr("native.execution.empty"));
        } else {
            list = list.child(tr("native.execution.inventory"));
        }
        for (index, row) in rows.into_iter().enumerate() {
            let state = tr(match row.cleanup {
                Cleanup::Pending => "native.execution.state.pending",
                Cleanup::Running => "native.execution.state.running",
                Cleanup::Unconfirmed => "native.execution.state.unconfirmed",
            });
            let action = tr(if row.cleanup == Cleanup::Unconfirmed {
                "native.execution.retry"
            } else {
                "native.execution.terminate"
            });
            let key = row.key.clone();
            let short: String = row.key.chars().take(12 + row.kind.len()).collect();
            list = list.child(
                div()
                    .id(("execution-row", index))
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .min_w_0()
                            .child(div().text_color(t.text).child(short))
                            .child(
                                div()
                                    .text_size(px(theme::ty().ui.meta))
                                    .text_color(t.subtle)
                                    .child(state),
                            ),
                    )
                    .child(
                        Button::new(("execution-terminate", index))
                            .variant(ButtonVariant::OutlineDanger)
                            .label(action)
                            .on_click(cx.listener(move |_, _, _, cx| {
                                Budget::global().terminate(&key);
                                cx.notify();
                            })),
                    ),
            );
        }
        Dialog::new("executions")
            .width(480.)
            .title(tr("native.execution.title").to_owned())
            .focus_handle(self.focus.clone())
            .keep_on_backdrop()
            .child(list)
            .child(
                div()
                    .text_size(px(theme::ty().ui.meta))
                    .text_color(t.subtle)
                    .child(tr("native.execution.consequence")),
            )
            .on_close(move |_, cx| {
                let _ = layer.update(cx, |_, cx| {
                    cx.emit(DialogEvent::Command(Command::CloseExecutions))
                });
            })
            .footer(
                Button::new("execution-refresh")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("native.execution.refresh"))
                    .on_click(cx.listener(|_, _, _, cx| cx.notify())),
            )
            .footer(
                Button::new("execution-done")
                    .variant(ButtonVariant::Solid)
                    .label(tr("native.execution.done"))
                    .on_click(Self::on_command(Command::CloseExecutions, cx)),
            )
    }
    pub(super) fn settings_view(
        &self,
        w: f32,
        h: f32,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let layer = cx.weak_entity();
        dialog_host(self.focus.clone(), cx)
            .backdrop(div().size_full().bg(task_backdrop(cx.palette())))
            .close_on_backdrop_press(true)
            .on_cancel(move |_, _, cx| {
                let _ = layer.update(cx, |s, cx| s.close_tasks(cx));
                true
            })
            .popup(settings_dialog(self.settings.clone(), w, h, cx.palette()))
    }
    pub(super) fn create_entry_view(
        &self,
        form: Entity<CreateEntryDialog>,
        w: f32,
        h: f32,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let width = (w - 64.).clamp(280., 420.);
        let height = 240.;
        let card = modal_card(
            Rect::new((w - width) / 2., (h - height) / 2., width, height),
            cx.palette(),
        );
        dialog_host(self.focus.clone(), cx).popup(card.child(form))
    }
    /// `ProjectNavigationFailure`: why the project could not open, Close and
    /// Retry.
    pub(super) fn project_failure_dialog(&self, message: &str, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let layer = cx.weak_entity();
        Dialog::new("project-navigation-failure")
            .width(420.)
            .title(tr("shell.workspaceSwitcher.switchFailed"))
            .focus_handle(self.focus.clone())
            // `.desktop-dialog-error`.
            .child(
                div()
                    .text_size(px(theme::ty().ui.meta))
                    .line_height(px(18.))
                    .text_color(t.danger)
                    .child(message.to_owned()),
            )
            .footer(
                Button::new("project-failure-close")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.close"))
                    .on_click(Self::on_command(Command::CloseProjectFailure, cx)),
            )
            .footer(
                Button::new("project-failure-retry")
                    .variant(ButtonVariant::Solid)
                    .label(tr("cloud.common.retry"))
                    .on_click(Self::on_command(Command::RetryProjectOpen, cx)),
            )
            .on_close(move |_, cx| {
                let _ = layer.update(cx, |_, cx| {
                    cx.emit(DialogEvent::Command(Command::CloseProjectFailure))
                });
            })
    }
}

/// Kit's dialog host on `focus`: Escape and the backdrop are the layer's.
pub(crate) fn dialog_host(focus: FocusHandle, cx: &mut App) -> gpui_kit::base::Dialog {
    gpui_kit::base::Dialog::new(cx)
        .focus_handle(focus)
        .close_on_escape(false)
        .close_on_backdrop_press(false)
        .on_ok(|_, _, _| false)
        .backdrop(div().size_full().bg(cx.palette().backdrop))
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
