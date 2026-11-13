//! Account is a projection of the app-owned native broker, never a credential
//! or browser protocol owner. Plan/billing remains the catalogue fallback.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::components::{Button, ButtonVariant, SettingsSection, SettingsSubsection, ValueRow},
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};

impl SettingsWorkspaceSurface {
    pub(super) fn account(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        use crate::features::cloud::account::Status;
        let model = self.cloud.as_ref().map(|c| c.read(cx));
        let snapshot = model.and_then(|m| m.snapshot.clone());
        let unavailable = model.and_then(|m| m.unavailable);
        let closing = model.is_some_and(|m| m.closing);
        let status = snapshot.as_ref().map_or(Status::SignedOut, |s| s.status);
        let account = snapshot.as_ref().and_then(|s| s.account.as_ref());
        let title = account.map_or_else(
            || tr("settings.account.notSignedIn").to_owned(),
            |a| a.email.clone(),
        );
        let detail = tr(match status {
            Status::SignedOut | Status::StorageBlocked => "settings.account.signedOutDetail",
            Status::Restoring => "settings.account.status.restoring",
            Status::SigningIn => "settings.account.message.finishInBrowser",
            Status::Authenticated => "settings.account.status.signedIn",
            Status::Offline => "settings.account.status.offline",
            Status::Refreshing => "settings.account.status.refreshing",
            Status::SigningOut => "settings.account.status.signingOut",
        });
        let m = theme::ty();
        // `.desktop-account-identity`: a 38px round mark (an initial once
        // signed in), 11px before the name and the signed-out reason.
        let identity = h_flex()
            .gap(px(11.))
            .px(px(10.))
            .pt(px(4.))
            .pb(px(14.))
            .child(
                div()
                    .size(px(38.))
                    .flex_shrink_0()
                    .rounded_full()
                    .bg(t.control),
            )
            .child(
                v_flex()
                    .min_w_0()
                    .gap(px(1.))
                    .child(
                        div()
                            .text_size(px(m.ui.label))
                            .line_height(px(18.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(title),
                    )
                    .child(
                        div()
                            .text_size(px(m.ui.meta))
                            .line_height(px(17.))
                            .text_color(t.subtle)
                            .child(detail),
                    ),
            );
        let busy = closing
            || matches!(
                status,
                Status::Restoring | Status::Refreshing | Status::SigningOut
            );
        let mut sign_in = h_flex().gap(px(8.)).px(px(10.)).pt(px(2.)).pb(px(6.));
        if status == Status::SigningIn {
            // `startWebSignIn` while the browser is out: the same button
            // sends it to the sign-in page again, and the page says where
            // to finish. There is no separate reopen or cancel.
            sign_in = sign_in.child(
                Button::new("sign-in")
                    .variant(ButtonVariant::OutlinePrimary)
                    .label(tr("settings.account.signInWithBrowser"))
                    .disabled(closing || !snapshot.as_ref().is_some_and(|s| s.can_reopen))
                    .on_click(cx.listener(|s, _, _, cx| {
                        if let Some(cloud) = &s.cloud {
                            cloud.read(cx).reopen();
                        }
                    })),
            );
        } else if account.is_some() || status == Status::StorageBlocked {
            sign_in = sign_in.child(
                Button::new("sign-out")
                    .label(tr("settings.account.signOut"))
                    .disabled(busy)
                    .on_click(cx.listener(|s, _, _, cx| {
                        if let Some(cloud) = &s.cloud {
                            cloud.read(cx).sign_out();
                        }
                    })),
            );
            if status == Status::Offline {
                sign_in = sign_in.child(
                    Button::new("restore-sign-in")
                        .label(tr("common.action.retry"))
                        .disabled(closing)
                        .on_click(cx.listener(|s, _, _, cx| {
                            if let Some(cloud) = &s.cloud {
                                cloud.read(cx).retry();
                            }
                        })),
                );
            }
        } else {
            sign_in = sign_in.child(
                Button::new("sign-in")
                    .variant(ButtonVariant::OutlinePrimary)
                    .label(tr("settings.account.signInWithBrowser"))
                    .disabled(busy || unavailable.is_some() || self.cloud.is_none())
                    .on_click(cx.listener(|s, _, _, cx| {
                        if let Some(cloud) = &s.cloud {
                            cloud.read(cx).sign_in();
                        }
                    })),
            );
        }
        let mut session_details = v_flex()
            .gap(px(6.))
            .px(px(10.))
            .text_size(px(m.ui.meta))
            .text_color(t.subtle);
        if let Some(snapshot) = &snapshot {
            let (label, service) = account.map_or(
                (
                    "settings.account.desktopService",
                    snapshot.environment.api(),
                ),
                |a| {
                    (
                        "settings.account.sessionService",
                        a.binding.environment.api(),
                    )
                },
            );
            session_details = session_details.child(format!("{}: {}", tr(label), service));
        }
        if let Some(error) = unavailable.or_else(|| snapshot.as_ref().and_then(|s| s.error)) {
            session_details = session_details.child(error.to_string());
        }
        let prefs = &self.preferences.read(cx).state.experimental;
        let payments = prefs.payments;
        let cloud_on = crate::features::flags::cloud_enabled(&self.preferences, cx);
        // The balance belongs to the account, so it is topped up here, the
        // page the account entry in every Header opens.
        let credits = (payments && account.is_some() && status == Status::Authenticated)
            .then(|| self.compute_credits(true, t, cx));
        // A compact reading of the Settings space's plan; Plan owns usage,
        // prices and changes.
        let space = self.settings_space(cx).filter(|_| payments && cloud_on);
        let plan = space.map(|space| {
            let (reading, billing) =
                self.plan_reading(&space.id, status == Status::Restoring, account.is_some());
            SettingsSubsection::new().lead(true).child(
                ValueRow::new(
                    tr("settings.account.plan"),
                    format!("{} · {reading}", crate::features::cloud::space_name(&space)),
                )
                .action(
                    Button::new("account-open-plan")
                        .label(tr(if billing {
                            "settings.account.openBilling"
                        } else {
                            "settings.account.upgrade"
                        }))
                        .on_click(cx.listener(|s, _, _, cx| s.select_page(Page::Plan, cx))),
                ),
            )
        });
        SettingsSection::new(tr(Page::Account.title()))
            .child(identity)
            .child(sign_in)
            .when(self.cloud.is_some(), |section| {
                section.child(session_details)
            })
            .children(plan)
            .children(credits)
            .into_any_element()
    }
    /// Account's Plan row as it reads now.
    #[cfg(test)]
    pub fn account_plan_reading(&self, cx: &App) -> Option<String> {
        let space = self.settings_space(cx)?;
        let (reading, _) = self.plan_reading(&space.id, false, true);
        Some(format!(
            "{} · {reading}",
            crate::features::cloud::space_name(&space)
        ))
    }
    /// `AccountAICredits`: the available balance and the top-up packs.
    fn compute_credits(&self, top_up: bool, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        use crate::features::cloud::{ComputeReason as Reason, global_compute, money};
        let compute = global_compute(cx);
        let state = compute.read(cx);
        let reason = state.reason(true);
        let value = match reason {
            Reason::Loading | Reason::GatewayUnavailable => "—".to_owned(),
            _ => money(state.balance.map_or(0, |b| b.available_micro_usd)),
        };
        let pending = state.pending;
        let packs = state
            .catalog
            .as_ref()
            .map(|c| c.packs.clone())
            .unwrap_or_default();
        let failed = state.failed;
        let mut actions = h_flex().gap(px(6.));
        if top_up {
            for (index, pack) in packs.into_iter().enumerate() {
                let id = pack.id.clone();
                actions = actions.child(
                    Button::new(("compute-top-up", index))
                        .variant(ButtonVariant::OutlinePrimary)
                        .label(tf(
                            "agent.compute.topUp",
                            &[("amount", money(pack.price_cents * 10_000).into())],
                        ))
                        .disabled(pending)
                        .on_click(cx.listener(move |_, _, _, cx| {
                            let id = id.clone();
                            global_compute(cx).update(cx, |c, cx| c.checkout(id, cx));
                        })),
                );
            }
            actions = actions.child(
                Button::new("compute-refresh")
                    .label(tr("agent.compute.refreshBalance"))
                    .disabled(pending)
                    .on_click(cx.listener(|_, _, _, cx| {
                        global_compute(cx).update(cx, |c, cx| c.refresh(true, cx));
                    })),
            );
        }
        let mut row = ValueRow::new(tr("agent.compute.availableBalance"), value);
        if top_up {
            row = row.action(actions);
        }
        SettingsSubsection::new()
            .child(row)
            .when(failed, |d| {
                d.child(
                    div()
                        .px(px(10.))
                        .pt(px(6.))
                        .text_size(px(theme::ty().ui.meta))
                        .text_color(t.danger)
                        .child(tr("agent.compute.paymentUnavailable")),
                )
            })
            .into_any_element()
    }
}
