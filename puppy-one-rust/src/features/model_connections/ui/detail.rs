//! A connection's details: its category, address and credential, the
//! models its service lists (with the default, verification and `Use as
//! default`), and removal — `Sign out` for a provider sign-in.
use super::super::infrastructure::{self as client, Auth, Driver, ModelConnection};
use super::{ModelConnections, PageState};
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::components::{Button, ButtonVariant, Icon, MutedRow, SettingsCategory, ValueRow},
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};

impl ModelConnections {
    /// The models of the connection's catalog, once read.
    fn listed_models(&self, item: &ModelConnection) -> Vec<client::CatalogModel> {
        match &self.catalog {
            Some((id, Ok(models))) if *id == item.id => models.clone(),
            _ => vec![],
        }
    }
    /// `catalog.status` of the shown connection, when not ready.
    fn catalog_status(&self, item: &ModelConnection) -> Option<String> {
        if self
            .catalog_rx
            .as_ref()
            .is_some_and(|(id, _)| *id == item.id)
        {
            return Some(tr("settings.modelConnections.status.refreshing").to_string());
        }
        match &self.catalog {
            Some((id, Err(code))) if *id == item.id => Some(format!(
                "{} · {}",
                tr("settings.modelConnections.status.failed"),
                Self::error_text(code)
            )),
            Some((id, Ok(_))) if *id == item.id => None,
            _ => Some(tr("settings.modelConnections.status.unread").to_string()),
        }
    }
    /// One `.model-connections-model` row: identity (name, what the service
    /// says), whether Chat offers it, and its Agent check.
    fn model_row(
        &self,
        item: &ModelConnection,
        model: &client::CatalogModel,
        index: usize,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let is_default = item.default_model_id.as_deref() == Some(model.id.as_str());
        let mut labels: Vec<String> = vec![];
        if is_default {
            labels.push(tr("native.modelConnections.default").into());
        }
        if model.remote {
            labels.push(tr("native.modelConnections.ollamaCloud").into());
        }
        if model.tools == Some(true) {
            labels.push(tr("settings.modelConnections.advertised").into());
        }
        match model.loaded {
            Some(true) => labels.push(tr("settings.modelConnections.loaded").into()),
            Some(false) => labels.push(tr("settings.modelConnections.notLoaded").into()),
            None => {}
        }
        if let Some(context) = model.context {
            labels.push(tf(
                "native.modelConnections.window",
                &[("tokens", (context / 1024).to_string().into())],
            ));
        }
        let usable = !model.remote && model.tools != Some(false);
        let (target, chosen, context) = (item.clone(), model.id.clone(), model.context);
        h_flex()
            .id(("model", index))
            .w_full()
            .min_w_0()
            .min_h(px(42.))
            .justify_between()
            .gap(px(12.))
            .px(px(10.))
            .child(
                v_flex()
                    .min_w_0()
                    .flex_1()
                    .child(
                        div()
                            .truncate()
                            .text_size(px(theme::ty().ui.label))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(model.name.clone()),
                    )
                    .when(!labels.is_empty(), |d| {
                        d.child(
                            div()
                                .truncate()
                                .text_size(px(theme::ty().ui.caption))
                                .text_color(t.subtle)
                                .child(labels.join(" · ")),
                        )
                    }),
            )
            .when(!is_default && usable, |row| {
                row.child(
                    Button::new(("use-model", index))
                        .label(tr("native.modelConnections.useAsDefault"))
                        .disabled(self.busy)
                        .on_click(cx.listener(move |s, _, _, cx| {
                            if !s.busy {
                                s.rx = client::use_as_default(
                                    target.clone(),
                                    chosen.clone(),
                                    context,
                                    s.wake.clone(),
                                );
                                s.busy = true;
                                cx.notify();
                            }
                        })),
                )
            })
            .when(usable, |row| {
                row.child(self.verify_control(item, model, index, t, cx))
            })
            .into_any_element()
    }

    /// The Agent check of one model: a button, a turning loader while the
    /// tool round trip runs, then a chip that flips in green (passed) or
    /// red (failed, with the provider's reason) and checks again on click.
    fn verify_control(
        &self,
        item: &ModelConnection,
        model: &client::CatalogModel,
        index: usize,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let route = format!("{}/{}", item.id, model.id);
        let verifying = self.verify_rx.as_ref().is_some_and(|(r, _)| *r == route);
        let blocked = self.busy
            || self.verify_rx.is_some()
            || model.context.is_none()
            || (item.driver == Driver::Unsloth && !item.server_tools_disabled);
        let mut connection = item.clone();
        connection.model = model.id.clone();
        let context = model.context;
        let start = cx.listener(move |s, _, _, cx| {
            if s.verify_rx.is_none() {
                // The model is checked as the Agent would serve it.
                let mut checked = connection.clone();
                if checked.manual_context_window.is_none() {
                    checked.manual_context_window = context;
                }
                s.verify_rx = Some((checked.route(), client::verify(checked, s.wake.clone())));
                cx.notify();
            }
        });
        if verifying {
            return Button::new(("verify-model", index))
                .icon(Icon::new("loader-circle").spinning(("verify-spin", index)))
                .label(tr("native.modelConnections.verifying"))
                .disabled(true)
                .into_any_element();
        }
        let Some((result, at)) = self.verified.get(&route) else {
            return Button::new(("verify-model", index))
                .label(tr("settings.modelConnections.verify"))
                .disabled(blocked)
                .on_click(start)
                .into_any_element();
        };
        let passed = result.is_ok();
        let tone: Hsla = if passed {
            t.success.into()
        } else {
            t.danger.into()
        };
        let reason: SharedString = match result {
            Ok(()) => tr("native.modelConnections.verifyAgain").into(),
            Err(code) => format!(
                "{} · {}",
                Self::error_text(code),
                tr("native.modelConnections.verifyAgain")
            )
            .into(),
        };
        let key = SharedString::from(format!("verify-chip-{route}@{at:?}"));
        let icon = if passed { "check" } else { "x" };
        let glyph = svg()
            .path(format!("icons/{icon}@2.4.svg"))
            .size(px(12.))
            .flex_shrink_0()
            .text_color(tone)
            .with_animation(
                ElementId::Name(format!("{key}-glyph").into()),
                Animation::new(std::time::Duration::from_millis(360)),
                |svg, delta| {
                    // Turns over about its vertical axis as it arrives.
                    let scale = (std::f32::consts::PI * (1. - delta) / 2.).cos().max(0.02);
                    svg.with_transformation(Transformation::scale(size(scale, 1.)))
                },
            );
        div()
            .id(("verify-chip", index))
            .flex_none()
            .h(px(theme::control_compact()))
            .px(px(8.))
            .flex()
            .items_center()
            .gap(px(5.))
            .rounded(px(theme::metric::CONTROL_RADIUS))
            .border_1()
            .text_size(px(theme::ty().ui.caption))
            .font_weight(FontWeight::MEDIUM)
            .text_color(tone)
            .cursor(theme::clickable_cursor())
            .tooltip(crate::ui::components::tooltip(reason))
            .when(!blocked, |d| d.on_click(start))
            .child(glyph)
            .child(tr(if passed {
                "native.modelConnections.verifyPassed"
            } else {
                "native.modelConnections.verifyFailed"
            }))
            // The fill washes in from clear to the result's tint.
            .with_animation(
                ElementId::Name(key),
                Animation::new(std::time::Duration::from_millis(360)),
                move |d, delta| {
                    d.bg(tone.opacity(0.12 * delta))
                        .border_color(tone.opacity(0.18 + 0.22 * delta))
                },
            )
            .into_any_element()
    }

    pub(super) fn detail(&self, id: &str, t: Theme, cx: &mut Context<Self>) -> Div {
        let Some(item) = self.items.iter().find(|c| c.id == id).cloned() else {
            return div();
        };
        let kind = item.source_kind;
        let oauth = item.auth == Auth::Oauth;
        let credential_action =
            if let Some(provider) = item.oauth_provider.filter(|_| oauth) {
                Button::new("sign-in-again")
                    .label(tr("native.modelConnections.signInAgain"))
                    .disabled(self.busy || self.signing_in.is_some())
                    .on_click(cx.listener(move |s, _, _, cx| s.sign_in(provider, cx)))
            } else {
                let edit_id = item.id.clone();
                Button::new("edit-connection")
                    .label(tr("settings.modelConnections.edit"))
                    .disabled(self.busy)
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.navigate(PageState::Edit(edit_id.clone()), cx)
                    }))
            };
        let refresh = Button::new("refresh-models")
            .icon(if self.catalog_rx.is_some() {
                Icon::new("loader-circle").spinning("refresh-models-spin")
            } else {
                Icon::new("refresh-cw")
            })
            .label(tr("settings.modelConnections.refresh"))
            .disabled(self.busy)
            .on_click(cx.listener(|s, _, _, cx| {
                s.reload(cx);
                if let PageState::Detail(id) = &s.page {
                    s.read_catalog(id.clone());
                }
            }));
        let listed = self.listed_models(&item);
        let model_count = listed.len();
        let mut models: Vec<AnyElement> = listed
            .iter()
            .enumerate()
            .map(|(index, model)| self.model_row(&item, model, index, t, cx))
            .collect();
        if models.is_empty() {
            models.push(
                MutedRow::new(tr("settings.modelConnections.modelsEmpty")).into_any_element(),
            );
        }
        let status = self.catalog_status(&item);
        let hint = |text: SharedString| {
            div()
                .px(px(10.))
                .text_size(px(theme::ty().ui.caption))
                .text_color(t.subtle)
                .child(text)
        };
        let verify = (model_count > 0)
            .then(|| hint(tr("settings.modelConnections.verificationHelp").into()));
        let (remove_label, warning, confirm) = if oauth {
            (
                "native.modelConnections.signOut",
                "native.modelConnections.signOutWarning",
                "native.modelConnections.signOut",
            )
        } else {
            (
                "settings.modelConnections.remove",
                "settings.modelConnections.deleteWarning",
                "settings.modelConnections.confirmDelete",
            )
        };
        let remove: AnyElement = if self.confirm_remove {
            v_flex()
                .gap(px(8.))
                .px(px(10.))
                .child(
                    div()
                        .text_size(px(theme::ty().ui.meta))
                        .text_color(t.danger)
                        .child(tr(warning)),
                )
                .child(
                    h_flex()
                        .gap(px(6.))
                        .child(
                            Button::new("confirm-remove")
                                .variant(ButtonVariant::OutlineDanger)
                                .label(tr(confirm))
                                .disabled(self.busy)
                                .on_click(cx.listener(|s, _, _, cx| {
                                    if !s.busy {
                                        if let PageState::Detail(id) = &s.page {
                                            let generation = s
                                                .items
                                                .iter()
                                                .find(|c| &c.id == id)
                                                .map(|c| c.generation.clone())
                                                .unwrap_or_default();
                                            s.rx = client::remove(
                                                id.clone(),
                                                generation,
                                                s.wake.clone(),
                                            );
                                            s.busy = true;
                                        }
                                        s.confirm_remove = false;
                                        cx.notify();
                                    }
                                })),
                        )
                        .child(
                            Button::new("cancel-remove")
                                .label(tr("common.action.cancel"))
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.confirm_remove = false;
                                    cx.notify()
                                })),
                        ),
                )
                .into_any_element()
        } else {
            h_flex()
                .px(px(10.))
                .child(
                    Button::new("remove-connection")
                        .variant(ButtonVariant::OutlineDanger)
                        .label(tr(remove_label))
                        .disabled(self.busy)
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.confirm_remove = true;
                            cx.notify()
                        })),
                )
                .into_any_element()
        };
        let credential = if oauth {
            ValueRow::new(
                tr("native.modelConnections.account"),
                item.account_label()
                    .unwrap_or_else(|| tr("native.modelConnections.signedIn").into()),
            )
        } else {
            ValueRow::new(
                tr("settings.modelConnections.apiKey"),
                tr(if item.credential_id.is_some() {
                    "settings.modelConnections.keyConfigured"
                } else {
                    "settings.modelConnections.noKey"
                }),
            )
        };
        let category = if oauth {
            tr("native.modelConnections.source.oauth")
        } else {
            tr(&format!("settings.modelConnections.source.{}", kind.key()))
        };
        v_flex()
            .gap(px(20.))
            .child(
                v_flex()
                    .gap(px(2.))
                    .child(ValueRow::new(
                        tr("settings.modelConnections.sourceKind"),
                        category,
                    ))
                    .child(
                        ValueRow::new(tr("settings.modelConnections.url"), item.endpoint.clone())
                            .monospace(true),
                    )
                    .child(credential.action(credential_action)),
            )
            .child(
                div().px(px(10.)).child(
                    SettingsCategory::new(format!(
                        "{} {}",
                        tr("settings.modelConnections.models"),
                        model_count
                    ))
                    .action(refresh)
                    .children(status.map(|s| hint(s.into()).into_any_element()))
                    .children(models),
                ),
            )
            .children(verify)
            .child(remove)
    }
}
