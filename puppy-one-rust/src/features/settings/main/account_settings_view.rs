//! Signed-out states of `AccountSettingsView.tsx` (+ `AccountIdentity`) and
//! `SeatsSettingsView.tsx` (`PersonalPlanRows` over the catalogue fallback).
//! Desktop browser sign-in is not native yet: like a product build without
//! `supportsDesktopCloudOAuth()`, the sign-in action is shown disabled.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::components::{Button, ButtonVariant, SettingsSection, SettingsSubsection, ValueRow},
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};

/// `resolvePersonalOffer` without a catalogue: Personal, $19 a month, 10 GB
/// and one Cloud Computer.
const OFFER_PRICE: &str = "$19";
const OFFER_STORAGE: &str = "10 GB";
const INCLUDED_COMPUTERS: usize = 1;

impl SettingsWorkspaceSurface {
    pub(super) fn account(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
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
        let sign_in = h_flex().px(px(10.)).pt(px(2.)).pb(px(6.)).child(
            Button::new("sign-in")
                .variant(ButtonVariant::OutlinePrimary)
                .label(tr("settings.account.signInWithBrowser"))
                .disabled(true),
        );
        let upgrade = Button::new("account-upgrade")
            .label(tr("settings.account.upgrade"))
            .on_click(cx.listener(|s, _, _, cx| s.select_page(Page::Plan, cx)));
        // `.desktop-plan-note`: 12px at 1.4, 10px below the plan row.
        let note = div()
            .mt(px(10.))
            .px(px(10.))
            .text_size(px(m.ui.caption))
            .line_height(px(m.ui.caption * 1.4))
            .text_color(t.subtle)
            .child(tr("settings.account.localFreeNote"));
        SettingsSection::new(tr(Page::Account.title()))
            .child(identity)
            .child(sign_in)
            .child(
                SettingsSubsection::new()
                    .lead(true)
                    .child(
                        ValueRow::new(tr("settings.account.plan"), tr("settings.plan.freePrice"))
                            .action(upgrade),
                    )
                    .child(note),
            )
            .into_any_element()
    }
    pub(super) fn plan(&self, _: Theme, cx: &mut Context<Self>) -> AnyElement {
        let subscribe = Button::new("subscribe")
            .variant(ButtonVariant::OutlinePrimary)
            .label(tr("settings.seats.signInToSubscribe"))
            // Buying needs an account, and Account owns the one sign-in flow.
            .on_click(cx.listener(|s, _, _, cx| s.select_page(Page::Account, cx)));
        SettingsSection::new(tr(Page::Plan.title()))
            .child(
                SettingsSubsection::new().lead(true).child(
                    ValueRow::new(
                        tr("settings.seats.planName"),
                        tf(
                            "settings.plan.monthlyFor",
                            &[("amount", OFFER_PRICE.into())],
                        ),
                    )
                    .action(subscribe),
                ),
            )
            .child(
                SettingsSubsection::new()
                    .title(tr("settings.seats.includesTitle"))
                    .child(ValueRow::new(
                        tr("settings.seats.storageTitle"),
                        OFFER_STORAGE,
                    ))
                    .child(ValueRow::new(
                        tr("settings.seats.computerTitle"),
                        tf(
                            "settings.seats.computerCount",
                            &[("count", INCLUDED_COMPUTERS.into())],
                        ),
                    )),
            )
            .into_any_element()
    }
}
