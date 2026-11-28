//! The API-key provider picker: every registered preset with its mark; the
//! chosen preset fills the form, so the user only pastes a key.
use super::super::infrastructure::SourceKind;
use super::rows::{identity, link_row, row_mark, table, table_row};
use super::{ModelConnections, PageState};
use crate::agent::model_connections::providers::API_PROVIDERS;
use crate::{
    localization::t as tr,
    theme::{self, Theme},
    ui::components::{SettingsCategory, SettingsCategoryList},
};
use gpui::{prelude::*, *};

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
                let row = table_row(t)
                    .id(("provider", index))
                    .child(row_mark(t, Some(provider), SourceKind::Api))
                    .child(identity(t, provider.name.into(), detail))
                    .when(provider.oauth.is_some(), |row| {
                        row.child(
                            div()
                                .flex_none()
                                .text_size(px(theme::ty().ui.caption))
                                .text_color(t.subtle)
                                .child(tr("native.modelConnections.signInAvailable")),
                        )
                    });
                link_row(
                    t,
                    row,
                    cx.listener(move |s, _, _, cx| {
                        s.navigate(PageState::Add(SourceKind::Api, None, Some(id)), cx)
                    }),
                )
                .into_any_element()
            })
            .collect();
        SettingsCategoryList::new().child(
            SettingsCategory::new(tr("native.modelConnections.chooseProvider"))
                .body(table(t, rows)),
        )
    }
}
