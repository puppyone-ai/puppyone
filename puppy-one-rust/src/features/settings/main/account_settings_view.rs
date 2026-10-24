//! Signed-out states of `AccountSettingsView.tsx` (+ `AccountIdentity`) and
//! `SeatsSettingsView.tsx` (`PersonalPlanRows` over the catalogue fallback).
//! Desktop browser sign-in is not native yet: like a product build without
//! `supportsDesktopCloudOAuth()`, the sign-in action is shown disabled.
use super::super::{components::*, settings_workspace_surface::SettingsWorkspaceSurface};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{Tone, action_button, column, row},
};
use gpui::{prelude::*, *};

/// `resolvePersonalOffer` without a catalogue: Personal, $19 a month, 10 GB
/// and one Cloud Computer.
const OFFER_PRICE: &str = "$19";
const OFFER_STORAGE: &str = "10 GB";
const INCLUDED_COMPUTERS: usize = 1;

impl SettingsWorkspaceSurface {
    pub(super) fn account(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let m = theme::ty();
        // `.desktop-account-identity`: a 38px round mark (an initial once
        // signed in), 11px before the name and the signed-out reason.
        let identity = row()
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
                column()
                    .min_w_0()
                    .gap(px(1.))
                    .child(
                        div()
                            .text_size(px(m.ui.label))
                            .line_height(px(18.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(tr("settings.account.notSignedIn")),
                    )
                    .child(
                        div()
                            .text_size(px(m.ui.meta))
                            .line_height(px(17.))
                            .text_color(t.subtle)
                            .child(tr("settings.account.signedOutDetail")),
                    ),
            );
        // `.desktop-account-signin`.
        let sign_in = row().px(px(10.)).pt(px(2.)).pb(px(6.)).child(action_button(
            "sign-in",
            tr("settings.account.signInWithBrowser"),
            None,
            Tone::Primary,
            true,
            t,
        ));
        let upgrade = action_button(
            "account-upgrade",
            tr("settings.account.upgrade"),
            None,
            Tone::Default,
            false,
            t,
        )
        .on_click(cx.listener(|s, _, _, cx| s.select_page(Page::Plan, cx)));
        // `.desktop-plan-note`: 12px at 1.4, 10px below the plan row.
        let note = div()
            .mt(px(10.))
            .px(px(10.))
            .text_size(px(m.ui.caption))
            .line_height(px(m.ui.caption * 1.4))
            .text_color(t.subtle)
            .child(tr("settings.account.localFreeNote"));
        section(tr(Page::Account.title()), t)
            .child(identity)
            .child(sign_in)
            .child(subsection(
                None,
                None,
                true,
                vec![
                    value_row(
                        tr("settings.account.plan"),
                        tr("settings.plan.freePrice"),
                        false,
                        Some(upgrade.into_any_element()),
                        t,
                    )
                    .into_any_element(),
                    note.into_any_element(),
                ],
                t,
            ))
    }
    pub(super) fn plan(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let subscribe = action_button(
            "subscribe",
            tr("settings.seats.signInToSubscribe"),
            None,
            Tone::Primary,
            false,
            t,
        )
        // Buying needs an account, and Account owns the one sign-in flow.
        .on_click(cx.listener(|s, _, _, cx| s.select_page(Page::Account, cx)));
        section(tr(Page::Plan.title()), t)
            .child(subsection(
                None,
                None,
                true,
                vec![
                    value_row(
                        tr("settings.seats.planName"),
                        tf(
                            "settings.plan.monthlyFor",
                            &[("amount", OFFER_PRICE.into())],
                        ),
                        false,
                        Some(subscribe.into_any_element()),
                        t,
                    )
                    .into_any_element(),
                ],
                t,
            ))
            .child(subsection(
                Some(tr("settings.seats.includesTitle").into()),
                None,
                false,
                vec![
                    value_row(
                        tr("settings.seats.storageTitle"),
                        OFFER_STORAGE,
                        false,
                        None,
                        t,
                    )
                    .into_any_element(),
                    value_row(
                        tr("settings.seats.computerTitle"),
                        tf(
                            "settings.seats.computerCount",
                            &[("count", INCLUDED_COMPUTERS.into())],
                        ),
                        false,
                        None,
                        t,
                    )
                    .into_any_element(),
                ],
                t,
            ))
    }
}
