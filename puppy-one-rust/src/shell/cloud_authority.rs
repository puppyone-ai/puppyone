//! The account a hosted Project belongs to, and what a failed opening says.
//!
//! A local folder and its Cloud project are two projects (puppy-issues
//! ADR-001): the window shows one or the other, entered like any project,
//! and nothing switches one between this computer and the Cloud. What stays
//! here is the authority a Cloud project was opened under
//! (`useAccountCloudWorkspace`): signing out, another account, a new
//! session generation, another API or Cloud turned off revokes the hosted
//! selection, and `ProjectNavigationFailure` for a Cloud opening.
use super::*;
use crate::{
    features::repository_cloud::RepositoryCloud,
    localization::t as tr,
    ui::components::{Button, ButtonVariant, Dialog},
    workspace::cloud::opening::{Failure, Recovery},
};

pub(super) fn account_key(cx: &App) -> Option<String> {
    crate::features::cloud_account::broker_and_binding(cx)
        .map(|(_, b)| format!("{}\n{}\n{}", b.user, b.epoch, b.environment.api()))
}

impl Shell {
    pub(super) fn new_repository_cloud(cx: &mut Context<Self>) -> Entity<RepositoryCloud> {
        let entity = cx.new(|_| RepositoryCloud::new());
        cx.observe(&entity, |_, _, cx| cx.notify()).detach();
        entity
    }
    fn cloud_enabled(&self, cx: &App) -> bool {
        crate::features::flags::cloud_enabled(&self.preferences, cx)
    }
    /// Keep the open folder's association current for the account.
    pub(super) fn sync_repository_cloud(&mut self, cx: &mut Context<Self>) {
        // A file window has no project and so no Cloud project.
        let root = self.workspace_root().filter(|_| !self.file_mode());
        let enabled = self.cloud_enabled(cx);
        self.repository_cloud
            .update(cx, |r, cx| r.sync(root.as_deref(), enabled, cx));
    }
    /// `closeWorkspaceSidebars`: collapse the right sidebar and release the
    /// focus it held; drafts, widths and sessions stay.
    fn close_workspace_sidebars(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.panes.content() == RightContent::CloudHistory {
            self.close_cloud_history(cx);
        }
        self.panes.close_right();
        self.popover = None;
        self.focus.focus(window, cx);
    }
    /// The hosted Project's authority: when it no longer holds, the opening
    /// in flight is cancelled and a Cloud project on screen leaves for the
    /// Homepage.
    pub(super) fn guard_cloud_authority(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let current = if self.cloud_enabled(cx) {
            account_key(cx)
        } else {
            None
        };
        if self.cloud_authority.is_none() || self.cloud_authority == current {
            return;
        }
        self.cloud_authority = None;
        self.files.cancel_cloud();
        if self.popover == Some(Popover::Share) {
            self.popover = None;
        }
        if self.hosted_project().is_some() {
            self.close_workspace_sidebars(window, cx);
            self.files.deactivate();
            self.home = true;
            self.receive(window, cx);
        }
        self.cloud_project = None;
        cx.notify();
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
            .focus_handle(self.modal_focus.clone())
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.modals
                        .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
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
            );
        let action = failure.recovery != Recovery::None;
        let close = Button::new("cloud-open-close")
            .variant(if action {
                ButtonVariant::Secondary
            } else {
                ButtonVariant::Solid
            })
            .label(tr("common.action.close"))
            .on_click(cx.listener(|s, _, _, cx| {
                s.modals
                    .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
                cx.notify();
            }));
        dialog = dialog.footer(close);
        match failure.recovery {
            Recovery::Retry => dialog.footer(
                Button::new("cloud-open-retry")
                    .variant(ButtonVariant::Solid)
                    .label(tr("cloud.common.retry"))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.modals
                            .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
                        s.open_cloud(project.clone(), cx);
                    })),
            ),
            Recovery::Account => dialog.footer(
                Button::new("cloud-open-account")
                    .variant(ButtonVariant::Solid)
                    .label(tr("settings.sidebar.account"))
                    .on_click(cx.listener(|s, _, w, cx| {
                        s.modals
                            .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
                        s.command(Command::Settings, w, cx);
                        s.task_ui.settings.update(cx, |settings, cx| {
                            settings.select_page(crate::features::settings::Page::Account, cx)
                        });
                    })),
            ),
            Recovery::None => dialog,
        }
    }
}
