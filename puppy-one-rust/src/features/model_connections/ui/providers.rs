//! The API-key provider picker: every registered preset with its mark; the
//! chosen preset fills the form, so the user only pastes a key.
use super::super::infrastructure::SourceKind;
use super::rows::{identity, table, table_row};
use super::{ModelConnections, PageState};
use crate::agent::model_connections::providers::API_PROVIDERS;
use crate::{
    localization::t as tr,
    theme::{self, Theme},
    ui::components::{Icon, SettingsCategory, SettingsCategoryList},
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;

impl ModelConnections {
    pub(super) fn provider_picker(&self, t: Theme, cx: &mut Context<Self>) -> SettingsCategoryList {
        let rows = API_PROVIDERS
            .iter()
            .enumerate()
            .map(|(index, provider)| {
                let id = provider.id;
                let detail: SharedString = if provider.base_url.is_empty() {
                    tr("native.modelConnections.customDetail").into()
                } else {
                    provider
                        .base_url
                        .trim_start_matches("https://")
                        .to_owned()
                        .into()
                };
                table_row(t)
                    .id(("provider", index))
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover))
                    .child(super::mark(
                        Some(provider),
                        SourceKind::Api,
                        18.,
                        t.text.into(),
                    ))
                    .child(identity(t, provider.name.into(), detail))
                    .when(provider.oauth.is_some(), |row| {
                        row.child(
                            div()
                                .flex_none()
                                .text_size(px(theme::ty().ui.caption))
                                .text_color(t.subtle)
                                .child(tr("native.modelConnections.signInAvailable")),
                        )
                    })
                    .child(Icon::new("chevron-right").small().stroke(2.).color(t.muted))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.navigate(PageState::Add(SourceKind::Api, None, Some(id)), cx)
                    }))
                    .into_any_element()
            })
            .collect();
        SettingsCategoryList::new().child(
            SettingsCategory::new(tr("native.modelConnections.chooseProvider"))
                .body(table(t, rows)),
        )
    }
}
