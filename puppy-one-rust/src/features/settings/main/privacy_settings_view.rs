//! Port of `PrivacySettingsView.tsx` / `ProductAnalyticsSettingsRow.tsx`:
//! the title with its inline Learn More disclosure link, the failure text and
//! the Product Analytics switch over the shared telemetry state. The switch
//! is disabled while the state loads or a change is written; it reads off
//! while the first-run notice is still owed.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Page;
use crate::{
    features::telemetry,
    localization::t as tr,
    platform::telemetry::DISCLOSURE_URL,
    theme::{self, Theme},
    ui::components::{SettingRow, SettingsList, SettingsSection, Switch},
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex};

impl SettingsWorkspaceSurface {
    pub(super) fn privacy(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let title = tr("settings.privacy.productAnalyze.title");
        let detail = tr("settings.privacy.productAnalyze.detail");
        let underline = theme::alpha(t.muted, 0.42);
        let state = telemetry::global(cx);
        let (checked, disabled, error) = match &state {
            Some(entity) => {
                let s = entity.read(cx);
                (
                    s.analytics_checked(),
                    s.loading || s.saving || !s.can_change(),
                    s.error,
                )
            }
            // No telemetry host (`window.puppyoneDesktop` without it).
            None => (true, true, false),
        };
        // `.desktop-product-analyze-label`: title, then the 12px muted link
        // 8px after it with a 42% underline, then the 11px danger text.
        let label = h_flex()
            .gap(px(8.))
            .min_w_0()
            .child(div().line_height(px(18.)).text_color(t.subtle).child(title))
            .child(
                div()
                    .id("privacy-learn-more")
                    .text_size(px(theme::ty().ui.meta))
                    .line_height(px(17.))
                    .text_color(t.muted)
                    .underline()
                    .text_decoration_color(underline)
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.text_color(t.text).text_decoration_color(t.text))
                    .on_click(|_, _, cx| cx.open_url(DISCLOSURE_URL))
                    .child(tr("settings.privacy.productAnalyze.learnMore")),
            )
            .when(error, |d| {
                d.child(
                    div()
                        .ml(px(8.))
                        .text_size(px(theme::ty().ui.caption))
                        .text_color(t.danger)
                        .child(tr("settings.privacy.productAnalyze.error")),
                )
            });
        let switch = Switch::new("product-analytics", title)
            .checked(checked)
            .disabled(disabled)
            .tooltip(detail)
            .on_change(move |checked, _, cx| {
                if let Some(entity) = &state {
                    entity.update(cx, |t, cx| t.set_analytics(checked, cx));
                }
            });
        SettingsSection::new(tr(Page::Privacy.title()))
            .child(
                SettingsList::new()
                    .lead(true)
                    .child(SettingRow::new("").label_element(label).control(switch)),
            )
            .into_any_element()
    }
}
