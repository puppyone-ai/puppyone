//! The Header's local ↔ Cloud switch (`DesktopProjectLocationSwitcher`,
//! `useRepositoryCloudWorkspaceSwitch`, `useCloudWorkspaceSwitch`,
//! `CloudWorkspaceSwitchDialog`, `RepositoryCloudSwitchGate`, and App's
//! `openCloudWorkspace` / `openLocalWorkspace`).
//!
//! - Choosing Cloud keeps the intent for the current checkout only: with a
//!   session and a resolved Project it prepares in place behind the visible
//!   workbench (the Header already shows the Cloud Computer, with a spinner);
//!   sign-in, matching and recovery wait in a dialog; nothing ever offers a
//!   project picker.
//! - The local host stays retained beside the Cloud one, drafts and all;
//!   going back shows it again without I/O, and a retained Cloud host is
//!   shown again the same way while the account is unchanged.
//! - Either direction closes the right sidebar and releases its focus; it
//!   stays closed until the person opens it again.
use super::*;
use crate::{
    features::repository_cloud::RepositoryCloud,
    localization::{t as tr, tf},
    theme::Theme,
    ui::components::{Button, ButtonVariant, Dialog, Icon, Menu, MenuItem, ProductIcon},
    workspace::cloud::{
        opening::{Failure, Recovery},
        repository::{CloudState, Context as Association},
    },
};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};

/// `DesktopProjectLocation["current"]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Place {
    Local,
    Cloud,
}
/// `ProjectComputerStatus`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Readiness {
    Ready,
    Opening,
    Failed,
}
/// A Header switch to the Cloud Computer in progress.
#[derive(Clone, Debug, Default)]
pub(super) struct CloudSwitch {
    /// Preparing in place for this Project.
    preparing: Option<String>,
    failure: Option<Failure>,
}
/// A host kept alive while the other location shows.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Retained {
    pub key: String,
    /// The local root, or the Cloud Project and the account it opened under.
    pub root: Option<PathBuf>,
    pub project: Option<(String, String)>,
}

fn account_key(cx: &App) -> Option<String> {
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
    /// The local checkout the location describes: the visible one, or the
    /// retained one while Cloud shows.
    fn local_checkout(&self) -> Option<PathBuf> {
        self.workspace_root()
            .or_else(|| self.retained_local.as_ref().and_then(|r| r.root.clone()))
    }
    /// Keep the association current for the checkout and account.
    pub(super) fn sync_repository_cloud(&mut self, cx: &mut Context<Self>) {
        let root = self.local_checkout();
        let enabled = self.cloud_enabled(cx);
        self.repository_cloud
            .update(cx, |r, cx| r.sync(root.as_deref(), enabled, cx));
    }
    /// `resolveProjectComputerPresence`: the computer the Header names and
    /// whether it is ready. The name moves with the screen: an in-place
    /// preparation already shows the Cloud Computer.
    pub(super) fn header_location(&self, cx: &App) -> (Place, Readiness) {
        let current = if self.hosted_project().is_some() {
            Place::Cloud
        } else {
            Place::Local
        };
        let Some(switch) = &self.cloud_switch else {
            return (current, Readiness::Ready);
        };
        let association = &self.repository_cloud.read(cx).context;
        let in_place = crate::features::cloud_account::has_account(cx)
            && (matches!(
                association,
                Association::Resolved { .. } | Association::Resolving
            ) || switch.failure.is_some());
        let at = if current == Place::Cloud || in_place {
            Place::Cloud
        } else {
            Place::Local
        };
        if at != Place::Cloud {
            return (at, Readiness::Ready);
        }
        (
            at,
            if switch.failure.is_some() {
                Readiness::Failed
            } else {
                Readiness::Opening
            },
        )
    }
    /// `localAvailable`: a local host to show — the retained one, or for a
    /// hosted-only window the checkout the shared list matches to this
    /// Project through its trusted locator. Never an unrelated project, and
    /// never a new local copy.
    fn local_available(&self, cx: &App) -> bool {
        self.hosted_project().is_none()
            || self.retained_local.is_some()
            || self.matching_checkout(cx).is_some()
    }
    /// `projectItems.find(item => item.cloudProjectId === id && item.localPath)`.
    pub(super) fn matching_checkout(&self, cx: &App) -> Option<PathBuf> {
        let project = self.hosted_project()?;
        self.project_items(cx)
            .into_iter()
            .find(|i| i.cloud_project.as_deref() == Some(project.as_str()))
            .and_then(|i| i.local_path)
            .map(PathBuf::from)
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
    /// `openCloudWorkspace`.
    pub(super) fn view_cloud(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.cloud_enabled(cx) || self.hosted_project().is_some() {
            self.popover = None;
            return;
        }
        self.close_workspace_sidebars(window, cx);
        let association = self.repository_cloud.read(cx).context.clone();
        // A kept-alive Cloud host for this Project and account shows again;
        // one from another Project or account is never reused.
        if let Some(retained) = self.retained_cloud.clone() {
            let same = retained.project.as_ref().is_some_and(|(p, account)| {
                association.project() == Some(p.as_str())
                    && account_key(cx).as_ref() == Some(account)
            });
            if !same {
                self.retained_cloud = None;
            } else if let Some(local) = self.visible_host()
                && self.files.activate_host(&retained.key)
            {
                self.retained_local = Some(local);
                self.cloud_project = association.project().map(str::to_owned);
                self.receive(window, cx);
                return;
            }
        }
        self.cloud_switch = Some(CloudSwitch::default());
        self.advance_cloud_switch(cx);
    }
    /// The visible host, to keep alive while the other location shows.
    fn visible_host(&self) -> Option<Retained> {
        let key = self.files.workspace_key()?.to_owned();
        Some(Retained {
            key,
            root: self.workspace_root(),
            project: None,
        })
    }
    /// `openLocalWorkspace` / `returnToLocalWorkspace`: the retained local
    /// host, else its folder, else the Homepage.
    pub(super) fn view_local(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.close_workspace_sidebars(window, cx);
        self.cancel_cloud_switch(cx);
        let Some(project) = self.hosted_project() else {
            return;
        };
        let Some(local) = self.retained_local.take() else {
            match self.matching_checkout(cx) {
                Some(path) => self.open_project(path, window, cx),
                None => self.home = true,
            }
            return;
        };
        if let (Some(cloud), Some(account)) = (self.visible_host(), account_key(cx)) {
            self.retained_cloud = Some(Retained {
                project: Some((project, account)),
                ..cloud
            });
        }
        if !self.files.activate_host(&local.key) {
            match local.root {
                Some(root) => self.files.begin(Intent::OpenFolder(root), &self.wake),
                None => self.home = true,
            }
        }
        self.receive(window, cx);
    }
    /// `cancel`: revoke the intent; an opening in flight is cancelled and the
    /// visible host stays.
    pub(super) fn cancel_cloud_switch(&mut self, cx: &mut Context<Self>) {
        if self.cloud_switch.take().is_some() {
            self.files.cancel_cloud();
            self.modals.remove(|m| matches!(m, Modal::CloudSwitch));
            cx.notify();
        }
    }
    /// `retry`: the failed step again (resolution, or the opening).
    pub(super) fn retry_cloud_switch(&mut self, cx: &mut Context<Self>) {
        if let Some(switch) = &mut self.cloud_switch {
            switch.failure = None;
            switch.preparing = None;
        }
        if self.repository_cloud.read(cx).context.retryable() {
            self.repository_cloud.update(cx, |r, cx| r.retry(cx));
        }
        self.advance_cloud_switch(cx);
    }
    /// The switch effect: prepare once the Project is resolved and the
    /// account signed in; commit when the Cloud root shows; keep the dialog
    /// only while sign-in, matching or recovery needs it.
    pub(super) fn advance_cloud_switch(&mut self, cx: &mut Context<Self>) {
        let Some(mut switch) = self.cloud_switch.clone() else {
            return;
        };
        // The intent belongs to this checkout: a local switch elsewhere, or
        // Cloud being turned off, revokes it.
        if !self.cloud_enabled(cx) {
            self.cancel_cloud_switch(cx);
            return;
        }
        if let Some(project) = &switch.preparing {
            if self.hosted_project().as_deref() == Some(project.as_str()) {
                self.cloud_switch = None;
                self.modals.remove(|m| matches!(m, Modal::CloudSwitch));
                return;
            }
            if self.files.cloud_opening().is_none() {
                switch.failure = self.files.take_cloud_failure().or(Some(Failure {
                    code: "workspace-open-failed",
                    recovery: Recovery::Retry,
                    status: None,
                }));
                switch.preparing = None;
            }
        } else if switch.failure.is_none()
            && let Association::Resolved { project, .. } =
                self.repository_cloud.read(cx).context.clone()
            && let Some((broker, binding)) = crate::features::cloud_account::broker_and_binding(cx)
            && let Some(local) = self.visible_host()
        {
            self.retained_local = Some(local);
            self.cloud_project = Some(project.clone());
            self.files
                .open_cloud(broker, binding, project.clone(), &self.wake);
            switch.preparing = Some(project);
        }
        let dialog = switch.preparing.is_none();
        self.cloud_switch = Some(switch);
        let shown = self.modals.iter().any(|m| matches!(m, Modal::CloudSwitch));
        if dialog && !shown {
            self.popover = None;
            self.modals.open(Modal::CloudSwitch);
        } else if !dialog && shown {
            self.modals.remove(|m| matches!(m, Modal::CloudSwitch));
        }
    }

    // ---------------------------------------------------------------- views
    /// `ProjectLocationMark` in the Header button: the computer, or its
    /// status while it opens or failed.
    pub(super) fn location_mark(place: Place, readiness: Readiness, t: Theme) -> Icon {
        match readiness {
            Readiness::Ready => Icon::product(match place {
                Place::Local => ProductIcon::Local,
                Place::Cloud => ProductIcon::Cloud,
            }),
            Readiness::Opening => Icon::new("loader-circle").spinning("location-opening"),
            Readiness::Failed => Icon::new("triangle-alert").color(t.warning),
        }
    }
    /// `DesktopProjectLocationControls` in its popover: On This Mac and On
    /// Cloud Computer, the current one checked; Cloud reads as an action
    /// (accent) while the checkout has no Cloud association yet.
    pub(super) fn location_menu(&self, cx: &App) -> impl FnOnce(Menu) -> Menu + 'static {
        let t = cx.palette();
        let device = tr(if cfg!(target_os = "macos") {
            "shell.projectOpen.onMac"
        } else {
            "shell.projectOpen.onComputer"
        });
        let current = if self.hosted_project().is_some() {
            Place::Cloud
        } else {
            Place::Local
        };
        let selection = if self.cloud_switch.is_some() {
            Place::Cloud
        } else {
            current
        };
        let association = self.repository_cloud.read(cx).context.clone();
        let signed_in = crate::features::cloud_account::has_account(cx);
        let state = association.cloud_state(signed_in);
        let linked = current == Place::Cloud
            || matches!(state, CloudState::Available | CloudState::SignedOut);
        let create = !linked && state == CloudState::Unavailable;
        let loading = (self
            .cloud_switch
            .as_ref()
            .is_some_and(|s| s.failure.is_none()))
            || state == CloudState::Resolving;
        let local_disabled = selection != Place::Local && !self.local_available(cx);
        let host = self.weak.clone();
        let local = MenuItem::new(device)
            .icon_sized(Icon::product(ProductIcon::Local).with_size(px(15.)))
            .checked(current == Place::Local)
            .disabled(local_disabled)
            .on_click(move |w, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.popover = None;
                    if s.hosted_project().is_some() || s.cloud_switch.is_some() {
                        s.view_local(w, cx);
                    } else {
                        s.project_focus.focus(w, cx);
                    }
                    cx.notify()
                });
            });
        let host = self.weak.clone();
        let cloud_icon = if loading && current != Place::Cloud {
            Icon::new("loader-circle")
                .with_size(px(15.))
                .spinning("location-menu-loading")
        } else {
            Icon::product(ProductIcon::Cloud)
                .with_size(px(15.))
                .color(t.accent_text)
        };
        let mut cloud = MenuItem::new(tr("shell.projectOpen.inCloud"))
            .icon_sized(cloud_icon)
            .checked(current == Place::Cloud && !create)
            .disabled(!self.cloud_enabled(cx) && selection != Place::Cloud)
            .on_click(move |w, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.popover = None;
                    s.view_cloud(w, cx);
                    cx.notify()
                });
            });
        if create {
            cloud = cloud.accent();
        }
        move |menu| menu.item(local).item(cloud)
    }
    /// `CloudWorkspaceSwitchDialog` with `RepositoryCloudSwitchGate`.
    pub(super) fn cloud_switch_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let m = theme::ty();
        let switch = self.cloud_switch.clone().unwrap_or_default();
        let association = self.repository_cloud.read(cx).context.clone();
        let signed_in = crate::features::cloud_account::has_account(cx);
        let paragraph = |text: String, color: Rgba| {
            div()
                .text_size(px(m.ui.body))
                .line_height(relative(1.5))
                .text_color(color)
                .child(text)
        };
        let heading = |text: &str| {
            div()
                .text_size(px(m.ui.heading))
                .font_weight(FontWeight(650.))
                .text_color(t.text)
                .child(text.to_owned())
        };
        let loading = |label: &str| {
            h_flex()
                .gap(px(10.))
                .py(px(24.))
                .justify_center()
                .child(
                    crate::ui::loading::LoadingMark::new("cloud-switch-loading")
                        .size(crate::ui::loading::LoaderSize::Md)
                        .tone(crate::ui::loading::Tone::Neutral),
                )
                .child(paragraph(label.to_owned(), t.muted))
                .into_any_element()
        };
        let host = cx.weak_entity();
        let mut dialog = Dialog::new("cloud-switch")
            .width(600.)
            .title(tr("cloud.activation.project.title"))
            .focus_handle(self.modal_focus.clone())
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| s.cancel_cloud_switch(cx));
            });
        let retry = |label: &'static str| {
            Button::new("cloud-switch-retry")
                .variant(ButtonVariant::Solid)
                .label(tr(label))
                .on_click(cx.listener(|s, _, _, cx| s.retry_cloud_switch(cx)))
        };
        let account = || {
            Button::new("cloud-switch-account")
                .variant(ButtonVariant::Secondary)
                .label(tr("settings.sidebar.account"))
                .on_click(cx.listener(|s, _, w, cx| {
                    s.cancel_cloud_switch(cx);
                    s.command(Command::Settings, w, cx);
                    s.task_ui.settings.update(cx, |settings, cx| {
                        settings.select_page(crate::features::settings::Page::Account, cx)
                    });
                }))
        };
        if let Some(failure) = &switch.failure {
            dialog = dialog.child(
                v_flex()
                    .gap(px(8.))
                    .child(heading(tr("cloud.opening.failedTitle")))
                    .child(paragraph(
                        tr(&format!("cloud.message.{}", failure.code)).to_owned(),
                        t.muted,
                    )),
            );
            match failure.recovery {
                Recovery::Retry => dialog = dialog.footer(retry("cloud.common.tryAgain")),
                Recovery::Account => dialog = dialog.footer(account()),
                Recovery::None => {}
            }
            return dialog;
        }
        if !signed_in {
            // `CloudSignedOutRoute compact`: sign in, then the same intent
            // continues for this checkout.
            return dialog
                .child(
                    v_flex()
                        .gap(px(8.))
                        .child(heading(tr("cloud.auth.signInToCloud")))
                        .child(paragraph(
                            tr("cloud.message.remote-sign-in").to_owned(),
                            t.muted,
                        )),
                )
                .footer(
                    Button::new("cloud-switch-sign-in")
                        .variant(ButtonVariant::Solid)
                        .label(tr("cloud.auth.signIn"))
                        .on_click(
                            cx.listener(|_, _, _, cx| crate::features::cloud_account::sign_in(cx)),
                        ),
                );
        }
        match &association {
            Association::Resolving | Association::Resolved { .. } => {
                dialog.child(loading(tr("cloud.loading.matchingProject")))
            }
            Association::LocalOnly => dialog.child(
                v_flex()
                    .gap(px(8.))
                    .child(heading(tr("cloud.state.localOnly")))
                    .child(paragraph(
                        tr("cloud.state.localOnlyDescription").to_owned(),
                        t.muted,
                    )),
            ),
            Association::WrongHost { .. } => {
                let detail = association
                    .message()
                    .map(|(key, origin)| match origin {
                        Some(origin) => tf(key, &[("origin", origin.to_owned().into())]),
                        None => tr(key).to_owned(),
                    })
                    .unwrap_or_default();
                dialog
                    .child(
                        v_flex()
                            .gap(px(8.))
                            .child(heading(tr("cloud.recovery.title")))
                            .child(
                                div()
                                    .text_size(px(m.ui.meta))
                                    .text_color(t.subtle)
                                    .child(tr("cloud.activation.project.errorDetails")),
                            )
                            .child(paragraph(detail, t.muted)),
                    )
                    .footer(retry("cloud.activation.project.reconnect"))
            }
            other => {
                let message = other
                    .message()
                    .map(|(key, _)| tr(key).to_owned())
                    .unwrap_or_default();
                let mut dialog = dialog.child(
                    v_flex()
                        .gap(px(8.))
                        .child(heading(tr("cloud.recovery.title")))
                        .child(paragraph(message, t.muted)),
                );
                if matches!(other, Association::WrongAccount) {
                    dialog = dialog.footer(account());
                }
                if other.retryable() {
                    dialog = dialog.footer(retry("cloud.common.tryAgain"));
                }
                dialog
            }
        }
    }
}
