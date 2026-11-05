//! The first publication as the Header switch shows it
//! (`CloudProjectActivationFrame`, `CloudProjectActivation`,
//! `CloudGitPrerequisite`, `CloudPublishRunning`, `CloudPublishResume`,
//! `CloudPublishProgressIndicator`, `CloudPublishHeaderStatus`).
//!
//! Two pictures: before it starts, the activation page with what Cloud gives
//! the project and **Upload to Cloud**; once started, the same page with its
//! progress — running (only **Continue in background**), or standing still
//! where it stopped (**Retry**, and **Discard** with an inline confirmation
//! whose focus starts on Cancel).
use super::*;
use crate::{
    cloud_publication::{Action, Code, Stage},
    features::cloud_publish::{CloudPublish, HeaderStatus, Organizations},
    localization::{t as tr, tf},
    ui::components::{Button, ButtonVariant, Dialog, Icon, ProductIcon},
};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};

/// `CLOUD_PUBLISH_PROGRESS_STEPS`.
const STEPS: [&str; 5] = ["project", "access", "remote", "upload", "finish"];

/// `resolveCloudPublishProgressActiveIndex`.
pub(super) fn step_of(stage: Stage) -> usize {
    match stage {
        Stage::Validating | Stage::CreatingProject => 0,
        Stage::SecuringCredential => 1,
        Stage::ConfiguringRemote => 2,
        Stage::CheckingRemote | Stage::Uploading | Stage::Confirming => 3,
        Stage::Finalizing | Stage::Completed => 4,
    }
}
fn stage_key(stage: Stage) -> &'static str {
    match stage {
        Stage::Validating => "cloud.initialize.progress.validating",
        Stage::CreatingProject => "cloud.initialize.progress.creating-project",
        Stage::SecuringCredential => "cloud.initialize.progress.securing-credential",
        Stage::ConfiguringRemote => "cloud.initialize.progress.configuring-remote",
        Stage::CheckingRemote => "cloud.initialize.progress.checking-remote",
        Stage::Uploading => "cloud.initialize.progress.uploading",
        Stage::Confirming => "cloud.initialize.progress.confirming",
        Stage::Finalizing => "cloud.initialize.progress.finalizing",
        Stage::Completed => "cloud.initialize.progress.completed",
    }
}
/// `formatCloudPublishFailure`.
pub(super) fn failure_copy(code: Code) -> &'static str {
    match code {
        Code::SessionRequired => "cloud.initialize.signInNote",
        Code::OrganizationRequired => "cloud.initialize.organizationRequired",
        Code::RepositoryRequired | Code::CommitRequired => {
            "cloud.message.project-publish-commit-required"
        }
        Code::BranchRequired => "cloud.message.project-publish-branch-required",
        Code::SourceMissing => "cloud.initialize.sourceMissing",
        Code::IdentityMismatch => "cloud.initialize.repositoryIdentityMismatch",
        Code::RemoteConflict => "cloud.initialize.remoteConflict",
        Code::RemoteRefConflict => "cloud.initialize.pushConflictDescription",
        Code::PushUncertain => "cloud.initialize.pushUncertainDescription",
        Code::CleanupFailed => "cloud.initialize.cleanupFailed",
        Code::CleanupNotAllowed => "cloud.initialize.cleanupNotAllowed",
        Code::ProjectUnavailable => "cloud.initialize.projectUnavailable",
        Code::PermissionDenied => "cloud.initialize.permissionDenied",
        Code::ServiceUpgradeRequired => "cloud.message.project-publish-service-upgrade",
        Code::ProjectCreateFailed => "cloud.message.project-publish-create-failed",
        Code::CredentialFailed => "cloud.message.project-publish-credential-failed",
        Code::RemoteConfigFailed => "cloud.message.project-publish-remote-failed",
        Code::PushFailed => "cloud.message.project-publish-push-failed",
        Code::PushLimitExceeded => "cloud.message.project-publish-size-limit",
        Code::CompensationFailed => "cloud.message.project-publish-compensation-failed",
        Code::JournalCorrupt | Code::JournalIoFailed => "cloud.initialize.localRecoveryFailed",
        _ => "cloud.message.project-publish-failed",
    }
}

impl Shell {
    pub(super) fn new_cloud_publish(cx: &mut Context<Self>) -> Entity<CloudPublish> {
        let entity = cx.new(|_| CloudPublish::default());
        cx.observe(&entity, |s, publish, cx| {
            // A finished publication resolves the association again; a
            // waiting Header switch then continues to the new Project.
            if publish.read(cx).published.is_some()
                && s.cloud.publish_reported != publish.read(cx).published
            {
                s.cloud.publish_reported = publish.read(cx).published.clone();
                s.cloud.repository.update(cx, |r, cx| r.retry(cx));
            }
            s.report_publication(cx);
            cx.notify()
        })
        .detach();
        entity
    }
    /// The Share wizard waits on the first publication of its Project.
    pub(super) fn report_publication(&mut self, cx: &mut Context<Self>) {
        let Some(project) = self.cloud_services.read(cx).project().map(str::to_owned) else {
            return;
        };
        let publish = self.cloud.publish.read(cx);
        let publication = publish.publication(&project);
        let failure = publish
            .outcome
            .as_ref()
            .and_then(|o| o.error.as_ref())
            .map(|e| tr(failure_copy(e.code)).to_owned());
        self.cloud_services
            .update(cx, |s, cx| s.sync_publication(publication, failure, cx));
    }
    /// `publish.start` from the wizard: the run outlives its dialog as any
    /// other does, and the Header states it.
    pub(super) fn resume_publication(&mut self, cx: &mut Context<Self>) {
        let started = self.cloud.publish.update(cx, |p, cx| {
            let action = p.push_action();
            p.start(action, cx);
            p.running.is_some()
        });
        if !started {
            self.cloud_services
                .update(cx, |s, cx| s.publication_refused(cx));
        }
    }
    pub(super) fn sync_cloud_publish(&mut self, cx: &mut Context<Self>) {
        let enabled = crate::features::flags::cloud_enabled(&self.preferences, cx);
        // The services dialog ends with its account or with Cloud.
        if self
            .modals
            .iter()
            .any(|m| matches!(m, Modal::CloudServices))
            && (!enabled || !crate::features::cloud_account::has_account(cx))
        {
            self.cloud_services.update(cx, |s, cx| s.close(cx));
        }
        let sharing = crate::features::flags::share_enabled(&self.preferences, cx)
            && crate::features::cloud_account::has_account(cx);
        self.cloud_services
            .update(cx, |s, cx| s.sync_sharing(sharing, cx));
        let root = self.workspace_root();
        // The activation page asks for the owning organization only while it
        // shows for a folder without a Cloud project.
        let activating = self.modals.iter().any(|m| matches!(m, Modal::CloudPublish))
            && matches!(
                self.cloud.repository.read(cx).context,
                crate::workspace::cloud::repository::Context::LocalOnly
            )
            && crate::features::cloud_account::has_account(cx);
        self.cloud.publish.update(cx, |p, cx| {
            p.sync(root.as_deref(), enabled, cx);
            if activating {
                p.load_organizations(cx);
            }
        });
    }
    pub(super) fn project_display_name(&self) -> String {
        self.workspace_root()
            .and_then(|root| {
                self.recent_projects
                    .iter()
                    .find(|p| p.path == root)
                    .map(|p| p.name.clone())
            })
            .unwrap_or_else(|| self.window.name.clone())
    }
    /// The Cloud switch dialog for a checkout with no Cloud Project yet.
    pub(super) fn publish_dialog(&self, dialog: Dialog, cx: &mut Context<Self>) -> Dialog {
        let publish = self.cloud.publish.read(cx);
        let name = self.project_display_name();
        let pending = publish
            .outcome
            .as_ref()
            .filter(|o| o.record.is_some())
            .cloned();
        if let Some(stage) = publish.running {
            return self.running_view(dialog, &name, stage, cx);
        }
        if let Some(outcome) = pending {
            return self.resume_view(dialog, &name, &outcome, cx);
        }
        self.activation_view(dialog, &name, cx)
    }
    /// `CloudProjectJourney` + eyebrow, title and lead.
    fn activation_frame(
        &self,
        name: &str,
        title: String,
        lead: String,
        cx: &mut Context<Self>,
    ) -> Div {
        let t = cx.palette();
        let m = theme::ty();
        let card = || {
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .px(px(10.))
                .py(px(8.))
                .rounded(px(8.))
                .border_1()
                .border_color(t.border)
                .bg(t.panel_raised)
        };
        let wire = |active: bool| {
            div()
                .flex_1()
                .h(px(1.))
                .min_w(px(18.))
                .bg(if active { t.brand_blue } else { t.border })
        };
        let banner = h_flex()
            .w_full()
            .items_center()
            .gap(px(6.))
            .p(px(16.))
            .rounded(px(10.))
            .bg(theme::alpha(t.inset, 0.6))
            .child(
                card()
                    .flex_shrink_0()
                    .child(Icon::product(ProductIcon::Folder).small().stroke(1.6))
                    .child(
                        v_flex()
                            .child(
                                div()
                                    .text_size(px(m.ui.meta))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.text)
                                    .max_w(px(120.))
                                    .truncate()
                                    .child(if name.trim().is_empty() {
                                        tr("cloud.activation.project.folderFallback").to_owned()
                                    } else {
                                        name.to_owned()
                                    }),
                            )
                            .child(
                                div()
                                    .text_size(px(m.ui.caption))
                                    .text_color(t.subtle)
                                    .child(tr("cloud.share.location.thisDevice")),
                            ),
                    ),
            )
            .child(wire(true))
            .child(
                card().flex_shrink_0().child(
                    Icon::product(ProductIcon::Cloud)
                        .with_size(px(28.))
                        .color(t.brand_blue),
                ),
            )
            .child(wire(false))
            .child(
                v_flex()
                    .flex_shrink_0()
                    .gap(px(6.))
                    .child(
                        card().child(
                            div()
                                .text_size(px(m.ui.caption))
                                .text_color(t.muted)
                                .child(tr("cloud.activation.project.agentsLabel")),
                        ),
                    )
                    .child(
                        card().child(
                            div()
                                .text_size(px(m.ui.caption))
                                .text_color(t.muted)
                                .child(tr("cloud.activation.project.teammatesLabel")),
                        ),
                    ),
            );
        v_flex()
            .w_full()
            .gap(px(10.))
            .child(banner)
            .child(
                h_flex()
                    .gap(px(6.))
                    .pt(px(8.))
                    .text_size(px(m.ui.meta))
                    .text_color(t.accent_text)
                    .child(Icon::product(ProductIcon::Cloud).small())
                    .child(tr("cloud.productName")),
            )
            .child(
                div()
                    .text_size(px(m.ui.heading))
                    .font_weight(FontWeight(650.))
                    .text_color(t.text)
                    .child(title),
            )
            .child(
                div()
                    .text_size(px(m.ui.body))
                    .line_height(relative(1.45))
                    .text_color(t.muted)
                    .child(lead),
            )
    }
    /// The footer note (`localNote`).
    fn local_note(&self, cx: &App) -> Div {
        let t = cx.palette();
        h_flex()
            .gap(px(6.))
            .pt(px(6.))
            .text_size(px(theme::ty().ui.caption))
            .text_color(t.subtle)
            .child(
                Icon::product(ProductIcon::Local)
                    .with_size(px(13.))
                    .stroke(1.6),
            )
            .child(tr("cloud.activation.project.localNote"))
    }
    fn activation_view(&self, dialog: Dialog, name: &str, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let m = theme::ty();
        let publish = self.cloud.publish.read(cx);
        let title = if name.trim().is_empty() {
            tr("cloud.activation.project.headlineFallback").to_owned()
        } else {
            tf(
                "cloud.activation.project.headline",
                &[("project", name.to_owned().into())],
            )
        };
        let value = |icon: &'static str, title: &str, detail: &str| {
            h_flex()
                .items_start()
                .gap(px(10.))
                .child(
                    div().flex_shrink_0().pt(px(1.)).child(
                        Icon::new(icon)
                            .with_size(px(15.))
                            .stroke(1.6)
                            .color(t.muted),
                    ),
                )
                .child(
                    v_flex()
                        .gap(px(1.))
                        .child(
                            div()
                                .text_size(px(13.))
                                .font_weight(FontWeight(550.))
                                .line_height(relative(1.4))
                                .text_color(t.text)
                                .child(title.to_owned()),
                        )
                        .child(
                            div()
                                .text_size(px(12.))
                                .line_height(relative(1.45))
                                .text_color(t.muted)
                                .child(detail.to_owned()),
                        ),
                )
        };
        let organizations = publish.organizations.clone();
        let selected = publish.selected.clone();
        let error = publish.outcome.as_ref().and_then(|o| o.error.clone());
        let ready = selected.is_some();
        let mut body = self
            .activation_frame(
                name,
                title,
                tr("cloud.activation.project.lead").to_owned(),
                cx,
            )
            .child(
                v_flex()
                    .gap(px(10.))
                    .pt(px(6.))
                    .child(value(
                        "bot",
                        tr("cloud.activation.project.agents"),
                        tr("cloud.activation.project.agentsDetail"),
                    ))
                    .child(value(
                        "users",
                        tr("cloud.activation.project.teammates"),
                        tr("cloud.activation.project.teammatesDetail"),
                    ))
                    .child(value(
                        "history",
                        tr("cloud.activation.project.history"),
                        tr("cloud.activation.project.historyDetail"),
                    )),
            );
        // `CloudGitPrerequisite`: the organization that will own the Project.
        match &organizations {
            Organizations::Ready(list) if list.len() > 1 => {
                body = body.child(
                    v_flex()
                        .gap(px(6.))
                        .pt(px(8.))
                        .child(
                            div()
                                .text_size(px(m.ui.meta))
                                .text_color(t.subtle)
                                .child(tr("cloud.initialize.organizationRequired")),
                        )
                        .child(h_flex().flex_wrap().gap(px(6.)).children(
                            list.iter().enumerate().map(|(index, org)| {
                                let id = org.id.clone();
                                Button::new(("publish-org", index))
                                    .variant(if selected.as_deref() == Some(org.id.as_str()) {
                                        ButtonVariant::OutlinePrimary
                                    } else {
                                        ButtonVariant::Outline
                                    })
                                    .label(org.name.clone())
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        let id = id.clone();
                                        s.cloud.publish.update(cx, |p, cx| p.select(id, cx));
                                    }))
                            }),
                        )),
                );
            }
            Organizations::Ready(list) if list.is_empty() => {
                body = body.child(self.publish_alert(tr("cloud.initialize.noOrganization"), cx));
            }
            Organizations::Failed => {
                body =
                    body.child(self.publish_alert(tr("cloud.initialize.organizationRequired"), cx));
            }
            _ => {}
        }
        if let Some(error) = error {
            body = body.child(self.publish_alert(tr(failure_copy(error.code)), cx));
        }
        dialog
            .child(body.child(self.local_note(cx)))
            .footer(
                Button::new("publish-not-now")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("cloud.activation.project.notNow"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.modals.remove(|m| matches!(m, Modal::CloudPublish));
                        cx.notify();
                    })),
            )
            .footer(
                Button::new("publish-upload")
                    .variant(ButtonVariant::Solid)
                    .label(tr("cloud.activation.project.publish"))
                    .disabled(!ready)
                    // `CloudGitPrerequisite`: the confirmation comes first.
                    .on_click(cx.listener(|s, _, w, cx| {
                        s.modals.open(Modal::ConfirmPublish);
                        s.modal_focus.focus(w, cx);
                        cx.notify();
                    })),
            )
    }
    fn publish_alert(&self, text: &str, cx: &App) -> Div {
        let t = cx.palette();
        div()
            .mt(px(6.))
            .px(px(10.))
            .py(px(8.))
            .rounded(px(6.))
            .bg(theme::mix(t.danger, t.panel, 0.10))
            .text_size(px(theme::ty().ui.meta))
            .text_color(t.danger)
            .child(text.to_owned())
    }
    /// `CloudPublishProgressIndicator`: the bar and the five steps; the
    /// current one names what it does, or "Stopped here".
    fn progress(&self, stage: Stage, paused: bool, cx: &App) -> Div {
        let t = cx.palette();
        let m = theme::ty();
        let active = step_of(stage);
        let completed = stage == Stage::Completed;
        let fraction = if completed {
            1.
        } else {
            ((active as f32 + 0.5) / STEPS.len() as f32).min(1.)
        };
        let bar = div().w_full().h(px(4.)).rounded_full().bg(t.border).child(
            div()
                .h_full()
                .w(relative(fraction))
                .rounded_full()
                .bg(if paused { t.warning } else { t.brand_blue }),
        );
        let rows = STEPS.iter().enumerate().map(|(index, step)| {
            let done = completed || index < active;
            let current = !completed && index == active;
            let mark = if done {
                Icon::new("check")
                    .with_size(px(14.))
                    .stroke(2.)
                    .color(t.success)
                    .into_any_element()
            } else if current && paused {
                Icon::new("triangle-alert")
                    .with_size(px(14.))
                    .color(t.warning)
                    .into_any_element()
            } else if current {
                Icon::new("loader-circle")
                    .with_size(px(14.))
                    .spinning(("publish-step", index))
                    .into_any_element()
            } else {
                div()
                    .size(px(12.))
                    .rounded_full()
                    .border_1()
                    .border_color(t.border_strong)
                    .into_any_element()
            };
            h_flex()
                .items_start()
                .gap(px(10.))
                .child(
                    div()
                        .size(px(16.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(mark),
                )
                .child(
                    v_flex()
                        .child(
                            div()
                                .text_size(px(m.ui.meta))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(if done || current { t.text } else { t.muted })
                                .child(
                                    tr(&format!("cloud.initialize.progress.step.{step}"))
                                        .to_owned(),
                                ),
                        )
                        .when(current, |d| {
                            d.child(
                                div()
                                    .text_size(px(m.ui.caption))
                                    .text_color(t.subtle)
                                    .child(tr(if paused {
                                        "cloud.initialize.progress.paused"
                                    } else {
                                        stage_key(stage)
                                    })),
                            )
                        }),
                )
        });
        v_flex()
            .w_full()
            .gap(px(10.))
            .pt(px(8.))
            .child(bar)
            .children(rows)
    }
    fn running_view(
        &self,
        dialog: Dialog,
        name: &str,
        stage: Stage,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let title = if name.trim().is_empty() {
            tr("cloud.initialize.progress.titleFallback").to_owned()
        } else {
            tf(
                "cloud.initialize.progress.title",
                &[("project", name.to_owned().into())],
            )
        };
        let body = self
            .activation_frame(
                name,
                title,
                tr("cloud.initialize.progress.lead").to_owned(),
                cx,
            )
            .child(self.progress(stage, false, cx));
        dialog.child(body).footer(
            Button::new("publish-hide")
                .variant(ButtonVariant::Secondary)
                .label(tr("cloud.initialize.progress.hide"))
                .on_click(cx.listener(|s, _, _, cx| s.publish_in_background(cx))),
        )
    }
    fn resume_view(
        &self,
        dialog: Dialog,
        name: &str,
        outcome: &crate::cloud_publication::Outcome,
        cx: &mut Context<Self>,
    ) -> Dialog {
        use crate::workspace::cloud::publish::{Action as A, Cleanup, Project, Push};
        let t = cx.palette();
        let publish = self.cloud.publish.read(cx);
        let busy = publish.reading;
        let confirming = publish.confirming_discard;
        let state = outcome.state.clone();
        let cleaning = state.as_ref().is_some_and(|s| {
            matches!(
                s.cleanup,
                Cleanup::Requested | Cleanup::Deleting | Cleanup::Failed
            )
        });
        let can_push = state.as_ref().is_none_or(|s| {
            s.actions.iter().any(|a| {
                matches!(
                    a,
                    A::RetryPush | A::PushLatest | A::Reconcile | A::ChooseSource
                )
            })
        }) && !cleaning;
        let can_discard = state
            .as_ref()
            .is_some_and(|s| s.actions.contains(&A::DeleteEmptyProject));
        let finish_cleanup = state
            .as_ref()
            .is_some_and(|s| s.actions.contains(&A::FinishCleanup));
        let title = if cleaning {
            tr("cloud.initialize.resume.cleanupTitle").to_owned()
        } else if name.trim().is_empty() {
            tr("cloud.initialize.resume.titleFallback").to_owned()
        } else {
            tf(
                "cloud.initialize.resume.title",
                &[("project", name.to_owned().into())],
            )
        };
        let paused_stage = match state.as_ref() {
            Some(s) if matches!(s.project, Project::Absent | Project::Creating) => {
                Stage::CreatingProject
            }
            Some(s) if matches!(s.push, Push::Uncertain | Push::Confirming) => Stage::Confirming,
            _ => Stage::Uploading,
        };
        let project_name = outcome
            .record
            .as_ref()
            .map(|r| r.project_name.clone())
            .unwrap_or_else(|| name.to_owned());
        let mut body = self.activation_frame(
            name,
            title,
            tr("cloud.initialize.resume.lead").to_owned(),
            cx,
        );
        if !cleaning {
            body = body.child(self.progress(paused_stage, true, cx));
        }
        if let Some(error) = &outcome.error {
            body = body.child(self.publish_alert(tr(failure_copy(error.code)), cx));
        }
        if confirming {
            // The inline confirmation; Cancel is the safe default.
            body = body.child(
                v_flex()
                    .mt(px(8.))
                    .p(px(12.))
                    .gap(px(6.))
                    .rounded(px(8.))
                    .border_1()
                    .border_color(theme::mix(t.danger, t.border, 0.36))
                    .child(
                        div()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.text)
                            .child(tr("cloud.initialize.resume.abandonTitle")),
                    )
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.muted)
                            .child(tf(
                                "cloud.initialize.resume.abandonDescription",
                                &[("project", project_name.into())],
                            )),
                    )
                    .child(
                        h_flex()
                            .justify_end()
                            .gap(px(8.))
                            .child(
                                Button::new("publish-discard-cancel")
                                    .variant(ButtonVariant::Secondary)
                                    .label(tr("cloud.common.cancel"))
                                    .track_focus(&self.modal_focus)
                                    .on_click(cx.listener(|s, _, _, cx| {
                                        s.cloud.publish.update(cx, |p, cx| {
                                            p.confirming_discard = false;
                                            cx.notify();
                                        })
                                    })),
                            )
                            .child(
                                Button::new("publish-discard-confirm")
                                    .variant(ButtonVariant::SolidDanger)
                                    .label(tr("cloud.initialize.resume.abandonConfirm"))
                                    .disabled(busy)
                                    .on_click(cx.listener(|s, _, _, cx| {
                                        s.cloud.publish.update(cx, |p, cx| p.discard(cx))
                                    })),
                            ),
                    ),
            );
        }
        let mut dialog = dialog.child(body.child(self.local_note(cx)));
        if can_discard && !confirming {
            dialog = dialog.footer(
                Button::new("publish-discard")
                    .variant(ButtonVariant::Secondary)
                    .label(tr(if busy {
                        "cloud.initialize.resume.discarding"
                    } else {
                        "cloud.initialize.resume.abandon"
                    }))
                    .disabled(busy)
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.cloud.publish.update(cx, |p, cx| {
                            p.confirming_discard = true;
                            cx.notify();
                        })
                    })),
            );
        }
        if finish_cleanup {
            dialog =
                dialog.footer(
                    Button::new("publish-finish-cleanup")
                        .variant(ButtonVariant::Solid)
                        .label(tr(if busy {
                            "cloud.initialize.resume.discarding"
                        } else {
                            "cloud.initialize.resume.abandon"
                        }))
                        .disabled(busy)
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.cloud.publish.update(cx, |p, cx| p.discard(cx))
                        })),
                );
        } else if can_push {
            let action = self.cloud.publish.read(cx).push_action();
            dialog = dialog.footer(
                Button::new("publish-retry")
                    .variant(ButtonVariant::Solid)
                    .label(tr(if action == Action::PushLatest {
                        "cloud.initialize.pushLatestCommit"
                    } else {
                        "cloud.initialize.resume.continue"
                    }))
                    .disabled(busy || confirming)
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.cloud.publish.update(cx, |p, cx| p.start(action, cx))
                    })),
            );
        }
        dialog
    }
    /// "Continue in background": the dialog goes; the run stays, and the
    /// Header states it.
    fn publish_in_background(&mut self, cx: &mut Context<Self>) {
        self.modals.remove(|m| matches!(m, Modal::CloudPublish));
        cx.notify();
    }
    /// `CloudPublishHeaderStatus`: beside the location, while a publication
    /// runs, after it finished, or when it stopped; it reopens the same view.
    pub(super) fn publish_header_mark(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let status = self.cloud.publish.read(cx).header_status()?;
        let t = cx.palette();
        let (icon, label) = match status {
            HeaderStatus::Running => (
                Icon::new("loader-circle")
                    .with_size(px(14.))
                    .spinning("publish-header"),
                "cloud.initialize.header.running",
            ),
            HeaderStatus::Completed => (
                Icon::new("circle-check")
                    .with_size(px(14.))
                    .color(t.success),
                "cloud.initialize.header.completed",
            ),
            HeaderStatus::Paused => (
                Icon::new("circle-pause")
                    .with_size(px(14.))
                    .color(t.warning),
                "cloud.initialize.header.paused",
            ),
            HeaderStatus::DiscardPaused => (
                Icon::new("circle-pause")
                    .with_size(px(14.))
                    .color(t.warning),
                "cloud.initialize.header.discardPaused",
            ),
            HeaderStatus::Attention => (
                Icon::new("triangle-alert")
                    .with_size(px(14.))
                    .color(t.warning),
                "cloud.initialize.header.attention",
            ),
        };
        Some(
            crate::ui::components::IconButton::new("publish-header-status", icon)
                .label(tr(label))
                .on_click(cx.listener(move |s, _, w, cx| {
                    if status == HeaderStatus::Completed {
                        s.cloud.publish.update(cx, |p, cx| {
                            p.published = None;
                            cx.notify();
                        });
                    }
                    // The same publication, shown again.
                    s.put_in_cloud(w, cx);
                }))
                .into_any_element(),
        )
    }

    /// `CloudDialog` at "initialize": the folder's first publication, after
    /// sign-in. Sign-in keeps the same intent for this folder.
    pub(super) fn cloud_publish_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let m = theme::ty();
        let host = cx.weak_entity();
        let dialog = Dialog::new("cloud-publish")
            .width(600.)
            .title(tr("cloud.activation.project.title"))
            .focus_handle(self.modal_focus.clone())
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.modals.remove(|m| matches!(m, Modal::CloudPublish));
                    cx.notify();
                });
            });
        let session = crate::workspace::cloud::publish::Session::of(
            crate::features::cloud_account::status(cx),
            crate::features::cloud_account::has_account(cx),
        );
        if session != crate::workspace::cloud::publish::Session::SignedIn {
            let waiting = session == crate::workspace::cloud::publish::Session::SigningIn;
            return dialog
                .child(
                    v_flex()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(px(m.ui.heading))
                                .font_weight(FontWeight(650.))
                                .text_color(t.text)
                                .child(tr("cloud.auth.signInToCloud")),
                        )
                        .child(
                            div()
                                .text_size(px(m.ui.body))
                                .line_height(relative(1.5))
                                .text_color(t.muted)
                                .child(tr("cloud.message.remote-sign-in")),
                        ),
                )
                .footer(
                    Button::new("cloud-publish-sign-in")
                        .variant(ButtonVariant::Solid)
                        .disabled(waiting)
                        .label(tr(if waiting {
                            "cloud.auth.desktopWaiting"
                        } else {
                            "cloud.auth.signIn"
                        }))
                        .on_click(
                            cx.listener(|_, _, _, cx| crate::features::cloud_account::sign_in(cx)),
                        ),
                );
        }
        self.publish_dialog(dialog, cx)
    }
    /// Review the `puppyone` remote as it is now, off the main thread.
    pub(super) fn begin_replace(&mut self, cx: &mut Context<Self>) {
        let Some(root) = self.workspace_root() else {
            return;
        };
        self.cloud.replace_url = None;
        let task = cx.background_executor().spawn(async move {
            use crate::cloud_publication::git::{Cli, GitOps as _, Remote};
            match (Cli { helper: None }).remote(&root) {
                Ok(Remote::Exact(url)) => Some(url),
                _ => None,
            }
        });
        cx.spawn(async move |this, cx| {
            let url = task.await;
            let _ = this.update(cx, |s, cx| {
                if url.is_none() {
                    for m in s.modals.iter_mut() {
                        if let Modal::ReplaceCloud(replace) = m {
                            replace.failed = true;
                        }
                    }
                }
                s.cloud.replace_url = url;
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    /// The exact target is authorized once more with the same session; only
    /// a second 404 with the reviewed remote unchanged detaches it, and the
    /// first publication follows (`onDone("replaced")`).
    pub(super) fn confirm_replace(&mut self, project: String, cx: &mut Context<Self>) {
        let (Some(root), Some((broker, binding)), Some(url)) = (
            self.workspace_root(),
            crate::features::cloud_account::broker_and_binding(cx),
            self.cloud.replace_url.clone(),
        ) else {
            return;
        };
        for m in self.modals.iter_mut() {
            if let Modal::ReplaceCloud(replace) = m {
                replace.busy = true;
                replace.failed = false;
            }
        }
        cx.notify();
        let task = cx.background_executor().spawn(async move {
            use crate::workspace::cloud::repository::{self, Context as Association};
            let cancel = crate::cloud_auth::Cancellation::default();
            match repository::authorize(&broker, &binding, &project, &cancel) {
                // Reachable again: keep the link (`reconnected`).
                Ok(_) => Ok(false),
                Err((Association::NotFound { .. }, _)) => {
                    crate::cloud_publication::git::detach(&root, &url)
                        .map(|_| true)
                        .map_err(|_| ())
                }
                Err(_) => Err(()),
            }
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                match result {
                    Ok(replaced) => {
                        s.modals.remove(|m| matches!(m, Modal::ReplaceCloud(_)));
                        s.cloud.repository.update(cx, |r, cx| r.retry(cx));
                        if replaced && !s.modals.iter().any(|m| matches!(m, Modal::CloudPublish)) {
                            s.modals.open(Modal::CloudPublish);
                        }
                    }
                    Err(()) => {
                        for m in s.modals.iter_mut() {
                            if let Modal::ReplaceCloud(replace) = m {
                                replace.busy = false;
                                replace.failed = true;
                            }
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
}
