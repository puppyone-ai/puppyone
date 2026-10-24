//! Port of `PrivacySettingsView.tsx` / `ProductAnalyticsSettingsRow.tsx`.
//! The native preview has no telemetry client: analytics are off and locked.
use super::super::{components::*, settings_workspace_surface::SettingsWorkspaceSurface};
use super::Page;
use crate::{
    localization::t as tr,
    theme::Theme,
    ui::{switch, tooltip},
};
use gpui::{prelude::*, *};
impl SettingsWorkspaceSurface {
    pub(super) fn privacy(&self, t: Theme) -> Div {
        let title = tr("settings.privacy.productAnalyze.title");
        section(tr(Page::Privacy.title()), t).child(lead_list(vec![
            setting_row_detail(
                title,
                Some((
                    tr("settings.privacy.productAnalyze.detail").into(),
                    t.subtle,
                )),
                switch("product-analytics", title, false, true, t, |_, _, _| {})
                    .tooltip(tooltip(tr("settings.privacy.productAnalyze.detail"))),
                t,
            )
            .into_any_element(),
        ]))
    }
}
