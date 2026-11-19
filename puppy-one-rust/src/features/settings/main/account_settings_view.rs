//! Account is a projection of the app-owned native broker, never a credential
//! or browser protocol owner. It is Personal's first page and the person's
//! own: who is signed in, one card, and their AI balance, another. A space's
//! plan is on Plan, beside it.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::components::{Button, ButtonVariant, PersonMark, SettingsCard, SettingsSection},
    workspace::cloud::spaces::{mark_initial, mark_tone},
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
        // The person: their circle (an empty one until someone signs in),
        // their email and where the session stands.
        let identity = h_flex()
            .gap(px(12.))
            .min_w_0()
            .child(match account {
                Some(account) => PersonMark::new(
                    mark_tone(&account.email) as usize,
                    mark_initial(&account.email),
                )
                .side(28.)
                .into_any_element(),
                None => div()
                    .size(px(28.))
                    .flex_shrink_0()
                    .rounded_full()
                    .bg(t.control)
                    .into_any_element(),
            })
            .child(
                v_flex()
                    .min_w_0()
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(title),
                    )
                    .child(div().text_color(t.muted).child(detail)),
            );
        let busy = closing
            || matches!(
                status,
                Status::Restoring | Status::Refreshing | Status::SigningOut
            );
        let mut sign_in = h_flex().gap(px(8.));
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
        let mut session_details = v_flex().gap(px(2.)).min_w_0();
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
            session_details =
                session_details.child(div().text_color(t.danger).child(error.to_string()));
        }
        let payments = crate::features::flags::payments_enabled(&self.preferences, cx);
        // The balance belongs to the account, so it is topped up here, the
        // page the account entry in every Header opens.
        let credits = (payments && account.is_some() && status == Status::Authenticated)
            .then(|| self.compute_credits(true, t, cx));
        let personal = self.settings_space(cx).filter(|s| s.is_default);
        let identity = SettingsCard::new()
            .id("account-identity")
            .child(identity)
            .when(self.cloud.is_some(), |card| card.note(session_details))
            .action(sign_in);
        let mut section = SettingsSection::new(tr(Page::Account.title()));
        if let Some(space) = &personal {
            section = section.lede(self.scope_lede(space, None, t, cx));
        }
        section.child(identity).children(credits).into_any_element()
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
                        .variant(ButtonVariant::Solid)
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
        let ui = theme::ty().ui;
        let mut card = SettingsCard::new()
            .id("account-balance")
            .title(tr("agent.compute.availableBalance"))
            .child(
                div()
                    .font_family(theme::MONO)
                    .text_size(px(ui.page_title))
                    .line_height(px(ui.page_title * 1.4))
                    .font_weight(FontWeight::MEDIUM)
                    .child(value),
            );
        if failed {
            card = card.note(
                div()
                    .text_color(t.danger)
                    .child(tr("agent.compute.paymentUnavailable")),
            );
        }
        if top_up {
            card = card.action(actions);
        }
        card.into_any_element()
    }
}
