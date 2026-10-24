//! Port of `PrivacySettingsView.tsx` / `ProductAnalyticsSettingsRow.tsx`:
//! the title with its inline Learn More disclosure link and the switch. The
//! native app has no telemetry client, so the switch reports the truth (off)
//! and stays locked; the product shows "on" only for a running telemetry
//! service.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Page;
use crate::{
    localization::t as tr,
    theme::{self, Theme},
    ui::components::{SettingRow, SettingsList, SettingsSection, Switch},
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex};

/// `DESKTOP_TELEMETRY_DISCLOSURE_URL`.
const DISCLOSURE_URL: &str = "https://github.com/puppyone-ai/puppyone/blob/main/README.md#privacy";

impl SettingsWorkspaceSurface {
    pub(super) fn privacy(&self, t: Theme) -> AnyElement {
        let title = tr("settings.privacy.productAnalyze.title");
        let detail = tr("settings.privacy.productAnalyze.detail");
        let underline = theme::alpha(t.muted, 0.42);
        // `.desktop-product-analyze-label`: title, then the 13px muted link
        // 8px after it with a 42% underline.
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
            );
        SettingsSection::new(tr(Page::Privacy.title()))
            .child(
                SettingsList::new().lead(true).child(
                    SettingRow::new("").label_element(label).control(
                        Switch::new("product-analytics", title)
                            .disabled(true)
                            .tooltip(detail),
                    ),
                ),
            )
            .into_any_element()
    }
}
