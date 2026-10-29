//! `useFirstRunSignIn` + `FirstRunSignInScreen`: on a fresh, empty launch
//! with Cloud on, sign-in is offered once, after workspace and account
//! restoration settle. Signing in, having any project, or Continue locally
//! completes it for good.
use super::*;
use crate::cloud_auth::Status;
use gpui_kit::base::v_flex;

impl Shell {
    fn account_status(&self, cx: &App) -> Option<crate::cloud_auth::Snapshot> {
        let service = cx.try_global::<crate::features::cloud_account::CloudAccountService>()?;
        service.0.read(cx).snapshot.clone()
    }
    /// `required`: available, settled, not completed, signed out, no project.
    pub(in crate::shell) fn first_run_sign_in(&self, cx: &App) -> bool {
        if !crate::features::flags::cloud_enabled(&self.preferences, cx)
            || self.preferences.read(cx).state.first_run_sign_in_completed
            || !self.preferences.read(cx).loaded
        {
            return false;
        }
        let Some(snapshot) = self.account_status(cx) else {
            return false;
        };
        let settled = !matches!(snapshot.status, Status::Restoring);
        settled
            && snapshot.account.is_none()
            && self.recent_projects.is_empty()
            && self.files.workspace.is_none()
    }
    /// Signing in or having a project completes the first run.
    pub(in crate::shell) fn sync_first_run(&mut self, cx: &mut Context<Self>) {
        let prefs = self.preferences.read(cx);
        if prefs.state.first_run_sign_in_completed || !prefs.loaded {
            return;
        }
        let signed_in = self.account_status(cx).is_some_and(|s| s.account.is_some());
        if signed_in || !self.recent_projects.is_empty() || self.files.workspace.is_some() {
            self.complete_first_run(cx);
        }
    }
    pub(in crate::shell) fn complete_first_run(&mut self, cx: &mut Context<Self>) {
        self.preferences.update(cx, |p, cx| {
            p.change(|p| p.first_run_sign_in_completed = true, cx)
        });
    }
    pub(in crate::shell) fn first_run_view(&self, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let m = theme::ty();
        let snapshot = self.account_status(cx);
        let signing_in = snapshot
            .as_ref()
            .is_some_and(|s| s.status == Status::SigningIn);
        let error = snapshot.and_then(|s| s.error).map(|e| e.to_string());
        let action = |id: &'static str, label: &str, primary: bool| {
            Button::new(id)
                .variant(if primary {
                    ButtonVariant::Solid
                } else {
                    ButtonVariant::Ghost
                })
                .label(label.to_owned())
                .w_full()
        };
        at(Rect::new(
            0.,
            0.,
            self.layout.header.w,
            self.layout.editor.bottom(),
        ))
        .bg(t.canvas)
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .pt(px(metric::CHROME_HEIGHT + 32.))
        .pb(px(48.))
        .child(
            v_flex()
                .w(px(320.))
                .max_w_full()
                .items_center()
                .child(
                    img(SharedString::from(if t.dark {
                        "brand/puppy-dark-onboarding.svg"
                    } else {
                        "brand/puppy-lite.svg"
                    }))
                    .size(px(64.))
                    .mb(px(20.))
                    .object_fit(ObjectFit::Contain),
                )
                .child(
                    div()
                        .text_size(px(m.ui.page_title))
                        .font_weight(FontWeight::MEDIUM)
                        .line_height(relative(1.3))
                        .text_color(t.text)
                        .child(tr("shell.brand.name")),
                )
                .child(
                    div()
                        .mt(px(10.))
                        .mb(px(28.))
                        .text_size(px(m.ui.body))
                        .line_height(relative(1.5))
                        .text_color(t.muted)
                        .child(tr("cloud.auth.signInToCloud")),
                )
                .child(
                    v_flex()
                        .w(px(220.))
                        .gap(px(8.))
                        // Asking again while waiting reopens the browser page.
                        .child(
                            action("first-run-sign-in", tr("cloud.auth.signIn"), true).on_click(
                                cx.listener(|_, _, _, cx| {
                                    crate::features::cloud_account::sign_in(cx)
                                }),
                            ),
                        )
                        .child(
                            action(
                                "first-run-continue",
                                tr("onboarding.action.continueLocally"),
                                false,
                            )
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.complete_first_run(cx);
                                cx.notify();
                            })),
                        ),
                )
                .when(signing_in, |d| {
                    d.child(
                        h_flex()
                            .mt(px(20.))
                            .gap(px(6.))
                            .text_size(px(m.ui.meta))
                            .text_color(t.muted)
                            .child(
                                crate::ui::loading::LoadingMark::new("first-run-waiting")
                                    .size(crate::ui::loading::LoaderSize::Xs)
                                    .tone(crate::ui::loading::Tone::Neutral),
                            )
                            .child(tr("cloud.auth.desktopWaiting")),
                    )
                })
                .when_some(error, |d, error| {
                    d.child(
                        div()
                            .mt(px(20.))
                            .text_size(px(m.ui.meta))
                            .text_color(t.danger)
                            .child(error),
                    )
                }),
        )
    }
}
