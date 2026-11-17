//! The account a hosted Project belongs to, and what a failed opening says.
//!
//! A local folder and its Cloud project are two projects (puppy-issues
//! ADR-001): the window shows one or the other, entered like any project,
//! and nothing switches one between this computer and the Cloud. What stays
//! here is the authority a Cloud project was opened under
//! (`useAccountCloudWorkspace`): signing out, another account, a new
//! session generation, another API or Cloud turned off revokes the hosted
//! selection, and `ProjectNavigationFailure` for a Cloud opening.
use super::{
    dialogs::DialogKey,
    window_cloud::{CloudEvent, WindowCloud},
};
use crate::{
    localization::{t as tr, tf},
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, Dialog},
    },
    workspace::cloud::opening::{Failure, Recovery},
};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;

pub(super) fn account_key(cx: &App) -> Option<String> {
    crate::features::cloud::account::broker_and_binding(cx)
        .map(|(_, b)| format!("{}\n{}\n{}", b.user, b.epoch, b.environment.api()))
}

impl WindowCloud {
    /// Keep the open folder's association current for the account.
    pub(super) fn sync_repository_cloud(&mut self, cx: &mut Context<Self>) {
        // A file window has no project and so no Cloud project.
        let root = self.root().filter(|_| !self.session().file_mode);
        let enabled = self.cloud_enabled(cx);
        self.repository
            .update(cx, |r, cx| r.sync(root.as_deref(), enabled, cx));
    }
    /// `ProjectNavigationFailure` for a Cloud opening: why, Close, and Retry
    /// or Account where they help.
    pub(super) fn cloud_open_recovery_dialog(
        &self,
        project: &str,
        failure: &Failure,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let host = cx.weak_entity();
        let project = project.to_owned();
        // `formatCloudMessage(failure.message)`: the reason's own copy.
        let message = tr(&format!("cloud.message.{}", failure.code)).to_owned();
        let mut dialog = Dialog::new("cloud-open-recovery")
            .width(420.)
            .title(tr("cloud.opening.failedTitle"))
            .focus_handle(self.dialog_focus.clone())
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.close_cloud_recovery(cx);
                    cx.notify();
                });
            })
            // `.desktop-dialog-error`.
            .child(
                div()
                    .text_size(px(theme::ty().ui.meta))
                    .line_height(px(18.))
                    .text_color(t.danger)
                    .child(message),
            )
            .children(self.cloud_failure_diagnostic(failure, cx));
        let action = failure.recovery != Recovery::None;
        let close = Button::new("cloud-open-close")
            .variant(if action {
                ButtonVariant::Secondary
            } else {
                ButtonVariant::Solid
            })
            .label(tr("common.action.close"))
            .on_click(cx.listener(|s, _, _, cx| {
                s.close_cloud_recovery(cx);
                cx.notify();
            }));
        dialog = dialog.footer(close);
        match failure.recovery {
            Recovery::Retry => dialog.footer(
                Button::new("cloud-open-retry")
                    .variant(ButtonVariant::Solid)
                    .label(tr("cloud.common.retry"))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.close_cloud_recovery(cx);
                        cx.emit(CloudEvent::OpenCloud(project.clone()));
                    })),
            ),
            Recovery::Account => dialog.footer(
                Button::new("cloud-open-account")
                    .variant(ButtonVariant::Solid)
                    .label(tr("settings.sidebar.account"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.close_cloud_recovery(cx);
                        cx.emit(CloudEvent::OpenSettings(
                            crate::features::settings::Page::Account,
                        ));
                    })),
            ),
            Recovery::None => dialog,
        }
    }
    /// `.desktop-dialog-diagnostic`: the server's code and request id, so
    /// a report can be found in its log, with Copy details.
    fn cloud_failure_diagnostic(&self, failure: &Failure, cx: &mut Context<Self>) -> Option<Div> {
        let t = cx.palette();
        let (code, request) = failure.diagnostic()?;
        let text = [
            code.map(|code| {
                tf(
                    "cloud.opening.diagnosticCode",
                    &[("code", code.as_str().into())],
                )
            }),
            request.map(|id| {
                tf(
                    "cloud.opening.diagnosticRequest",
                    &[("requestId", id.as_str().into())],
                )
            }),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");
        let copied = self.recovery_copied;
        let copy = text.clone();
        Some(
            h_flex()
                .mt(px(8.))
                .gap(px(8.))
                .items_baseline()
                .text_size(px(theme::ty().ui.meta))
                .line_height(px(18.))
                .text_color(t.muted)
                .child(
                    div()
                        .id("cloud-open-diagnostic")
                        .debug_selector(|| "cloud-open-diagnostic".into())
                        .min_w_0()
                        .child(text),
                )
                .child(
                    div()
                        .id("cloud-open-diagnostic-copy")
                        .flex_none()
                        .underline()
                        .cursor(theme::clickable_cursor())
                        .child(tr(if copied {
                            "cloud.opening.diagnosticCopied"
                        } else {
                            "cloud.opening.copyDiagnostic"
                        }))
                        .on_click(cx.listener(move |s, _, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()));
                            s.recovery_copied = true;
                            cx.notify();
                        })),
                ),
        )
    }
    pub(super) fn close_cloud_recovery(&mut self, cx: &mut Context<Self>) {
        self.recovery = None;
        self.close_dialog(DialogKey::CloudRecovery, cx);
    }
}
