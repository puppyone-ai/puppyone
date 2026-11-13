//! `CreateTeamDialog`: a space starts here. It is its own place with its own
//! plan: it begins on Free, and the person who creates it owns and pays for
//! it. Once made, the window's spaces are read again and Settings opens on
//! its Members with the invitation field ready.
use super::dialogs::DialogKey;
use super::window_cloud::{CloudEvent, WindowCloud};
use super::*;
use crate::localization::t as tr;
use crate::ui::components::{Button, ButtonVariant, Dialog};
use crate::ui::form_input::TextInput;
use crate::workspace::cloud::services::SPACE_NAME_MAX;
use gpui_kit::base::Disableable as _;

/// The dialog's name field and what it is doing.
pub(super) struct CreateSpace {
    pub name: Entity<TextInput>,
    pub busy: bool,
    pub failed: bool,
}

impl WindowCloud {
    pub(super) fn open_create_space(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.create_space.is_some() {
            return;
        }
        let name = cx.new(|cx| TextInput::new("", false, SPACE_NAME_MAX, window, cx));
        cx.observe(&name, |_, _, cx| cx.notify()).detach();
        // `data-desktop-dialog-initial-focus`: the name.
        name.read(cx).focus_handle(cx).focus(window, cx);
        self.create_space = Some(CreateSpace {
            name,
            busy: false,
            failed: false,
        });
        self.open_dialog(DialogKey::CreateSpace, cx);
        cx.notify();
    }
    pub(super) fn close_create_space(&mut self, cx: &mut Context<Self>) {
        if self.create_space.as_ref().is_some_and(|c| c.busy) {
            return;
        }
        self.create_space = None;
        self.close_dialog(DialogKey::CreateSpace, cx);
        cx.notify();
    }
    /// `createCloudTeam`: one request; a failure leaves the name to try again.
    pub(super) fn confirm_create_space(&mut self, cx: &mut Context<Self>) {
        let Some(state) = self.create_space.as_mut() else {
            return;
        };
        let name = state.name.read(cx).text().trim().to_owned();
        let Some(client) = crate::features::cloud::services_client(cx) else {
            return;
        };
        if name.is_empty() || state.busy {
            return;
        }
        state.busy = true;
        state.failed = false;
        let task = cx.background_spawn(async move { client.create_space(&name) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                match result {
                    Ok(space) => {
                        s.create_space = None;
                        s.close_dialog(DialogKey::CreateSpace, cx);
                        cx.emit(CloudEvent::SpaceCreated(space.id));
                    }
                    Err(_) => {
                        if let Some(state) = s.create_space.as_mut() {
                            state.busy = false;
                            state.failed = true;
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    pub(super) fn create_space_dialog(
        &self,
        state: &CreateSpace,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let ui = theme::ty().ui;
        let busy = state.busy;
        let empty = state.name.read(cx).text().trim().is_empty();
        let host = self.weak.clone();
        Dialog::new("create-space")
            .width(420.)
            .title(tr("settings.plan.space.createTeamTitle"))
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| s.close_create_space(cx));
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(
                        div()
                            .text_size(px(ui.meta))
                            .text_color(t.muted)
                            .child(tr("settings.plan.space.teamName")),
                    )
                    .child(state.name.clone()),
            )
            .child(
                div()
                    .pt(px(10.))
                    .text_size(px(ui.meta))
                    .line_height(relative(1.5))
                    .text_color(t.subtle)
                    .child(tr("settings.plan.space.createTeamNote")),
            )
            .when(state.failed, |dialog| {
                dialog.child(
                    div()
                        .pt(px(8.))
                        .text_size(px(ui.meta))
                        .text_color(t.danger)
                        .child(tr("settings.plan.space.createTeamFailed")),
                )
            })
            .footer(
                Button::new("create-space-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("settings.plan.cancel"))
                    .disabled(busy)
                    .on_click(cx.listener(|s, _, _, cx| s.close_create_space(cx))),
            )
            .footer(
                Button::new("create-space-confirm")
                    .variant(ButtonVariant::Solid)
                    .label(tr("settings.plan.space.createTeam"))
                    .disabled(busy || empty)
                    .on_click(cx.listener(|s, _, _, cx| s.confirm_create_space(cx))),
            )
    }
}
