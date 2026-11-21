//! `ModelConnectionsList`: one category per source of compute — PuppyOne,
//! provider sign-ins, API keys, local model services — each a
//! `.model-connections-list` card of 34px rows with quiet text actions.
use super::super::infrastructure::{Auth, ModelConnection, OauthProvider, Progress, SourceKind};
use super::rows::{chevron, identity, status, table, table_row, text_action};
use super::{ErrorAt, ModelConnections, OpenAccount, PageState};
use crate::agent::model_connections::providers as registry;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{
        appearance::ActiveAppearance,
        components::{
            Button, ButtonVariant, MutedRow, SettingsCategory, SettingsCategoryList, tooltip,
        },
    },
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};

impl ModelConnections {
    pub(super) fn list(&self, t: Theme, cx: &mut Context<Self>) -> SettingsCategoryList {
        let mut categories = vec![];
        if let Some(managed) = self.managed.filter(|_| self.payments) {
            categories.push(self.managed_category(managed, t, cx));
        }
        categories.push(self.accounts_category(t, cx));
        categories.push(self.api_category(t, cx));
        categories.push(self.local_category(t, cx));
        if self.loaded {
            categories.push(self.guide_category(t, cx));
        }
        SettingsCategoryList::new()
            .children(categories)
            .when(!self.loaded, |list| {
                list.child(MutedRow::new(tr("settings.modelConnections.loading")))
            })
    }

    /// PuppyOne compute: the account's state, managed on the Account page.
    fn managed_category(
        &self,
        (signed_in, available): (bool, bool),
        t: Theme,
        cx: &mut Context<Self>,
    ) -> SettingsCategory {
        let detail = tr(match (signed_in, available) {
            (false, _) => "settings.account.signedOutDetailCompute",
            (true, false) => "native.modelConnections.managedNoCredit",
            (true, true) => "native.modelConnections.managedReady",
        });
        let brand = crate::ui::agent_brands::get("built-in-agent").expect("registered brand");
        let row = table_row(t)
            .id("connection-managed")
            .child(crate::ui::agent_brands::image(brand, cx.is_dark(), 18.))
            .child(identity(t, "PuppyOne".into(), detail.into()))
            .child(
                Button::new("open-account")
                    .label(tr("native.modelConnections.openAccount"))
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(OpenAccount))),
            );
        SettingsCategory::new(tr("settings.modelConnections.source.managed"))
            .body(table(t, vec![row.into_any_element()]))
    }

    /// Provider sign-ins (Pi's OAuth flows): one row per provider.
    fn accounts_category(&self, t: Theme, cx: &mut Context<Self>) -> SettingsCategory {
        let mut rows: Vec<AnyElement> = vec![];
        for (index, provider) in OauthProvider::ALL.into_iter().enumerate() {
            let home = registry::for_oauth(provider);
            let name: SharedString = home.map(|p| p.name).unwrap_or_default().into();
            let saved = self.signed_in(provider).cloned();
            let signing = self.signing_in.as_ref().filter(|s| s.provider == provider);
            let mut row = table_row(t)
                .id(("connection-oauth", index))
                .child(super::mark(home, SourceKind::Api, 18., t.text.into()));
            row = match (&saved, signing) {
                (_, Some(signing)) => {
                    let waiting = match &signing.step {
                        Some(Progress::DeviceCode { .. }) => {
                            tr("native.modelConnections.waitingForCode")
                        }
                        Some(Progress::Exchanging) => tr("native.modelConnections.finishing"),
                        _ => tr("native.modelConnections.signingIn"),
                    };
                    row.child(identity(t, name, waiting.into())).child(
                        Button::new(("cancel-sign-in", index))
                            .label(tr("common.action.cancel"))
                            .on_click(cx.listener(|s, _, _, cx| s.cancel_sign_in(cx))),
                    )
                }
                (Some(saved), None) => {
                    let id = saved.id.clone();
                    let detail = saved
                        .account_label()
                        .map(|account| {
                            tf(
                                "native.modelConnections.signedInAs",
                                &[("account", account.into())],
                            )
                            .to_string()
                        })
                        .unwrap_or_else(|| tr("native.modelConnections.signedIn").into());
                    row.cursor(theme::clickable_cursor())
                        .hover(move |s| s.bg(t.hover))
                        .child(identity(t, name, detail.into()))
                        .when_some(saved.default_model_id.clone(), |row, model| {
                            row.child(status(t, model.into()))
                        })
                        .child(chevron(t))
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.navigate(PageState::Detail(id.clone()), cx)
                        }))
                }
                (None, None) => row
                    .child(identity(
                        t,
                        name,
                        tr(&format!("native.modelConnections.oauth.{}", provider.key())).into(),
                    ))
                    .child(
                        Button::new(("sign-in", index))
                            .variant(ButtonVariant::OutlinePrimary)
                            .label(tr("native.modelConnections.signIn"))
                            .disabled(self.busy || self.signing_in.is_some())
                            .on_click(cx.listener(move |s, _, _, cx| s.sign_in(provider, cx))),
                    ),
            };
            rows.push(row.into_any_element());
            // A browser sign-in whose page could not reach the app shows a
            // code ("copy this code to finish signing in"): paste it here.
            if let Some(signing) = signing
                && provider.uses_browser_callback()
                && !matches!(signing.step, Some(Progress::Exchanging))
            {
                rows.push(self.paste_row(index, t, cx));
            }
            if let Some(Progress::DeviceCode {
                user_code,
                verification_uri,
            }) = signing.and_then(|s| s.step.clone())
            {
                rows.push(self.device_code(index, user_code, verification_uri, t));
            }
        }
        rows.extend(self.inline_error(ErrorAt::Accounts, t));
        SettingsCategory::new(tr("native.modelConnections.source.oauth")).body(table(t, rows))
    }

    /// The paste field of a browser sign-in: the code the provider's page
    /// shows, or the final address it opened.
    fn paste_row(&self, index: usize, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let m = theme::ty();
        self.paste.update(cx, |i, _| {
            i.appearance = false;
            i.prompt_text = Some((m.ui.meta, 17.));
            i.placeholder_color = Some(|t| t.subtle);
            i.min_height = 17.;
        });
        v_flex()
            .id(("paste-code", index))
            .w_full()
            .min_w_0()
            .px(px(36.))
            .pb(px(8.))
            .gap(px(6.))
            .child(
                div()
                    .text_size(px(m.ui.caption))
                    .text_color(t.subtle)
                    .child(tr("native.modelConnections.pasteHint")),
            )
            .child(
                h_flex()
                    .w_full()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .h(px(theme::control_compact()))
                            .pl(px(8.))
                            .pr(px(5.))
                            .flex()
                            .items_center()
                            .border_1()
                            .border_color(t.divider)
                            .rounded(px(6.))
                            .bg(t.input)
                            .child(div().w_full().child(self.paste.clone())),
                    )
                    .child(
                        Button::new(("paste-continue", index))
                            .variant(ButtonVariant::OutlinePrimary)
                            .label(tr("native.modelConnections.pasteContinue"))
                            .on_click(cx.listener(|s, _, _, cx| s.paste_code(cx))),
                    ),
            )
            .into_any_element()
    }

    /// The code the user types on the provider's page.
    fn device_code(&self, index: usize, code: String, uri: String, t: Theme) -> AnyElement {
        let m = theme::ty();
        let copy = code.clone();
        h_flex()
            .id(("device-code", index))
            .w_full()
            .min_w_0()
            .px(px(36.))
            .pb(px(8.))
            .gap(px(10.))
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(4.))
                    .child(
                        div()
                            .text_size(px(m.ui.caption))
                            .text_color(t.subtle)
                            .child(tr("native.modelConnections.deviceCode")),
                    )
                    .child(
                        div()
                            .font_family(theme::MONO)
                            .text_size(px(m.ui.page_title))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.text)
                            .child(code),
                    ),
            )
            .child(self.copy_button(
                ("copy-device-code", index),
                "device-code",
                "native.modelConnections.copyCode",
                copy,
            ))
            .child(
                Button::new(("open-device-page", index))
                    .icon("external-link")
                    .label(tr("native.modelConnections.openPage"))
                    .on_click(move |_, _, _| {
                        let _ = crate::platform::desktop::open_url(&uri);
                    }),
            )
            .into_any_element()
    }

    /// Saved API-key connections; `Add` opens the provider picker.
    fn api_category(&self, t: Theme, cx: &mut Context<Self>) -> SettingsCategory {
        let mut rows: Vec<AnyElement> = self
            .items
            .iter()
            .filter(|c| c.source_kind == SourceKind::Api && c.auth != Auth::Oauth)
            .enumerate()
            .map(|(index, item)| self.connection_row(item, ("connection-api", index), t, cx))
            .collect();
        if rows.is_empty() && self.loaded {
            rows.push(
                table_row(t)
                    .text_color(t.subtle)
                    .child(tr("settings.modelConnections.empty.api"))
                    .into_any_element(),
            );
        }
        let add = text_action(
            t,
            "add-api",
            "plus",
            14.,
            tr("settings.modelConnections.add").into(),
        )
        .tooltip(tooltip(tr("settings.modelConnections.add.api")))
        .on_click(cx.listener(|s, _, _, cx| s.navigate(PageState::ChooseProvider, cx)));
        SettingsCategory::new(tr("settings.modelConnections.source.api"))
            .action(add)
            .body(table(t, rows))
    }

    /// A saved connection: its mark, name, endpoint and catalog status.
    pub(super) fn connection_row(
        &self,
        item: &ModelConnection,
        id: (&'static str, usize),
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let target = item.id.clone();
        let detail: SharedString = match &item.default_model_id {
            Some(model) => format!("{model} · {}", item.endpoint).into(),
            None => item.endpoint.clone().into(),
        };
        table_row(t)
            .id(id)
            .cursor(theme::clickable_cursor())
            .hover(move |s| s.bg(t.hover))
            .child(super::mark(
                item.provider(),
                item.source_kind,
                18.,
                t.text.into(),
            ))
            .child(identity(t, item.name.clone().into(), detail))
            .child(status(
                t,
                tr(&format!(
                    "settings.modelConnections.status.{}",
                    self.catalog_key(&item.id)
                ))
                .into(),
            ))
            .child(chevron(t))
            .on_click(
                cx.listener(move |s, _, _, cx| s.navigate(PageState::Detail(target.clone()), cx)),
            )
            .into_any_element()
    }
}
