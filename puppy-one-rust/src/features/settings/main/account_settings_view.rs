//! Signed-out states of `AccountSettingsView.tsx` and `SeatsSettingsView.tsx`.
//! Cloud identity and billing are not native yet; the product's own
//! unavailable messages are shown instead of a fake session.
use super::super::{components::*, settings_workspace_surface::SettingsWorkspaceSurface};
use super::Page;
use crate::{
    localization::t as tr,
    theme::{self, Theme},
    ui::{Tone, action_button, column, icon_sized, row},
};
use gpui::{prelude::*, *};
impl SettingsWorkspaceSurface {
    pub(super) fn account(&self, t: Theme) -> Div {
        let identity = row()
            .gap(px(12.))
            .px(px(10.))
            .min_h(px(54.))
            .child(
                div()
                    .size(px(36.))
                    .rounded_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(t.control)
                    .child(icon_sized("user-round", 18., t.muted)),
            )
            .child(
                column()
                    .gap(px(2.))
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.body))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(tr("settings.account.notSignedIn")),
                    )
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.subtle)
                            .child(tr("settings.account.signedOutDetail")),
                    ),
            );
        section(tr(Page::Account.title()), t).child(identity).child(
            column()
                .px(px(10.))
                .gap(px(8.))
                .child(row().child(action_button(
                    "sign-in",
                    tr("settings.account.signInWithBrowser"),
                    None,
                    Tone::Primary,
                    true,
                    t,
                )))
                .child(notice(tr("settings.account.error.oauthUnavailable"), t).px_0()),
        )
    }
    pub(super) fn plan(&self, t: Theme) -> Div {
        section(tr(Page::Plan.title()), t).child(lead_list(vec![
            value_row(
                tr("settings.account.plan"),
                tr("settings.plan.freePrice"),
                false,
                Some(
                    action_button(
                        "subscribe",
                        tr("settings.seats.signInToSubscribe"),
                        None,
                        Tone::Primary,
                        true,
                        t,
                    )
                    .into_any_element(),
                ),
                t,
            )
            .into_any_element(),
            muted_row(tr("settings.seats.comingSoon"), t).into_any_element(),
        ]))
    }
}
