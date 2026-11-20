//! `ModelConnectionSetup` (`.model-connection-setup`): the add / edit form.
//! A preset or a discovered service fills it; the API key is write-only.
use super::super::infrastructure::{
    self as client, Auth, Candidate, Driver, ModelConnection, SourceKind,
};
use super::Form;
use super::{ModelConnections, PageState};
use crate::agent::model_connections::providers as registry;
use crate::{
    localization::t as tr,
    theme::{self, Theme},
    ui::{
        components::{Button, ButtonVariant, Select, SelectOption, native_checkbox},
        form_input::TextInput,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};

impl ModelConnections {
    /// `initialConnectionFields`: the connection's fields, else the
    /// discovered service's, else the preset's, else its category's default
    /// service.
    pub(super) fn load_form(
        &mut self,
        c: Option<ModelConnection>,
        source: SourceKind,
        candidate: Option<Candidate>,
        preset: Option<&'static str>,
        cx: &mut Context<Self>,
    ) {
        let provider = preset.and_then(registry::get);
        let driver = c
            .as_ref()
            .map(|c| c.driver)
            .or(candidate.as_ref().map(|c| c.driver))
            .or(provider.map(|p| p.driver))
            .unwrap_or(match source {
                SourceKind::Api => Driver::OpenaiCompatible,
                SourceKind::Local => Driver::Ollama,
            });
        let (name, endpoint) = match provider {
            Some(p) if p.id == "custom" => ("API", ""),
            Some(p) => (p.name, p.base_url),
            None => driver.defaults(),
        };
        let context = provider
            .map(|p| p.context)
            .unwrap_or(registry::LOCAL_CONTEXT);
        self.id = c
            .as_ref()
            .map(|c| c.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        self.generation = c.as_ref().map(|c| c.generation.clone()).unwrap_or_default();
        let fields = [
            (
                &self.name,
                c.as_ref()
                    .map(|c| c.name.clone())
                    .or(candidate.as_ref().map(|c| c.name.clone()))
                    .unwrap_or(name.into()),
            ),
            (
                &self.endpoint,
                c.as_ref()
                    .map(|c| c.endpoint.clone())
                    .or(candidate.as_ref().map(|c| c.endpoint.clone()))
                    .unwrap_or(endpoint.into()),
            ),
            (&self.key, String::new()),
            (
                &self.manual_model,
                c.as_ref()
                    .and_then(|c| c.manual_model_id.clone())
                    .unwrap_or_default(),
            ),
            (
                &self.default_model,
                c.as_ref()
                    .and_then(|c| c.default_model_id.clone())
                    .unwrap_or_default(),
            ),
            (
                &self.context,
                c.as_ref()
                    .and_then(|c| c.manual_context_window)
                    .unwrap_or(context)
                    .to_string(),
            ),
        ];
        for (input, text) in fields {
            input.update(cx, |i, cx| i.set_text(text, cx));
        }
        self.form = Form {
            auth: c
                .as_ref()
                .map(|c| c.auth)
                .or(provider.filter(|p| p.api_key).map(|p| {
                    if p.source == SourceKind::Api {
                        Auth::Bearer
                    } else {
                        p.driver.default_auth()
                    }
                }))
                .unwrap_or(driver.default_auth()),
            server_tools_disabled: c.as_ref().is_some_and(|c| c.server_tools_disabled),
            provider: c
                .as_ref()
                .and_then(|c| c.provider())
                .map(|p| p.id)
                .or(preset)
                .or(candidate
                    .as_ref()
                    .and_then(|c| registry::local_for(c.driver))
                    .map(|p| p.id)),
            editing: c,
            source,
            driver,
            advanced: false,
            key_storage: false,
        };
    }

    /// `selectDriver`: a service starts from its name, URL and
    /// authentication, without a key.
    pub(super) fn select_driver(&mut self, driver: Driver, cx: &mut Context<Self>) {
        let (name, endpoint) = driver.defaults();
        self.name.update(cx, |i, cx| i.set_text(name, cx));
        self.endpoint.update(cx, |i, cx| i.set_text(endpoint, cx));
        self.key.update(cx, |i, cx| i.clear(cx));
        self.form.driver = driver;
        self.form.auth = driver.default_auth();
        self.form.provider = registry::local_for(driver).map(|p| p.id);
        self.form.server_tools_disabled = false;
        cx.notify();
    }

    /// `keyRequired`: a saved key does not follow the connection to another
    /// endpoint or authentication method.
    pub(super) fn key_required(&self, cx: &App) -> bool {
        self.form.editing.as_ref().is_some_and(|c| {
            c.credential_id.is_some()
                && (self.endpoint.read(cx).text() != c.endpoint || self.form.auth != c.auth)
        })
    }

    pub(super) fn reload(&mut self, cx: &mut Context<Self>) {
        if !self.busy {
            self.rx = client::load(self.wake.clone());
            self.busy = true;
            cx.notify();
        }
    }

    /// The form's `onSubmit`: the key travels with this one request and the
    /// field is cleared at once. An unset default model is chosen from the
    /// catalog before saving.
    pub(super) fn save(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let text = |input: &Entity<TextInput>| input.read(cx).text().to_owned();
        let optional = |input: &Entity<TextInput>| Some(text(input)).filter(|t| !t.is_empty());
        let key = optional(&self.key).filter(|_| self.form.auth == Auth::Bearer);
        let context = optional(&self.context);
        let mut connection = ModelConnection {
            id: self.id.clone(),
            name: text(&self.name),
            endpoint: text(&self.endpoint),
            source_kind: self.form.source,
            driver: self.form.driver,
            auth: self.form.auth,
            generation: self.generation.clone(),
            default_model_id: optional(&self.default_model),
            manual_model_id: optional(&self.manual_model),
            server_tools_disabled: self.form.server_tools_disabled,
            provider: self.form.provider.map(str::to_owned),
            ..Default::default()
        };
        self.key.update(cx, |i, cx| i.clear(cx));
        if let Some(context) = context {
            let Ok(context) = context.trim().parse() else {
                self.error = Some("INVALID_CONTEXT".into());
                cx.notify();
                return;
            };
            connection.manual_context_window = Some(context);
        }
        self.error = None;
        self.rx = client::save(connection, key, self.wake.clone());
        self.busy = true;
        cx.notify();
    }

    /// `ModelConnectionSetup` (`.model-connection-setup`): fields on a
    /// `minmax(120px, .7fr) minmax(0, 1fr)` grid (one column at 800px and
    /// under), the Advanced settings disclosure, then the actions.
    pub(super) fn form(&self, narrow: bool, t: Theme, cx: &mut Context<Self>) -> Div {
        let m = theme::ty();
        let busy = self.busy;
        let form = &self.form;
        let track = |grow: f32| {
            let mut d = div().flex_basis(px(0.));
            d.style().flex_grow = Some(grow);
            d
        };
        // One grid row: the label cell and the control cell.
        let row = |label: Option<AnyElement>, control: Option<AnyElement>| -> AnyElement {
            if narrow {
                v_flex()
                    .gap(px(6.))
                    .children(label)
                    .children(control)
                    .into_any_element()
            } else {
                h_flex()
                    .items_center()
                    .gap(px(18.))
                    .child(track(0.7).min_w(px(120.)).children(label))
                    .child(track(1.).min_w_0().children(control))
                    .into_any_element()
            }
        };
        let label = |key: &str| {
            div()
                .text_size(px(m.ui.label))
                .line_height(px(m.ui.label * 1.45))
                .text_color(t.subtle)
                .child(tr(key))
                .into_any_element()
        };
        // `.model-connection-field small`.
        let small = |key: &str| {
            div()
                .text_size(px(m.ui.caption))
                .line_height(px(m.ui.caption * 1.5))
                .text_color(t.subtle)
                .child(tr(key))
                .into_any_element()
        };
        let field = |rows: Vec<AnyElement>| v_flex().gap(px(6.)).children(rows).into_any_element();
        let fields = |items: Vec<AnyElement>| v_flex().gap(px(16.)).children(items);
        // `.desktop-settings-text-input` at `width: 100%`.
        let input = |entity: &Entity<TextInput>, cx: &mut Context<Self>| {
            entity.update(cx, |i, _| {
                i.appearance = false;
                i.prompt_text = Some((m.ui.meta, 17.));
                i.placeholder_color = Some(|t| t.subtle);
                i.min_height = 17.;
            });
            div()
                .w_full()
                .h(px(theme::control_compact()))
                .px(px(5.))
                .flex()
                .items_center()
                .border_1()
                .border_color(t.divider)
                .rounded(px(6.))
                .bg(t.input)
                .when(busy, |d| d.opacity(0.62))
                .child(div().w_full().child(entity.clone()))
                .into_any_element()
        };
        // A `<details>` summary: the disclosure triangle and its text.
        let summary = |id: &'static str, key: &str, open: bool, color: Rgba| {
            h_flex()
                .id(id)
                .gap(px(4.))
                .text_size(px(m.ui.label))
                .line_height(px(m.ui.label * 1.45))
                .text_color(color)
                .cursor(theme::clickable_cursor())
                .child(if open { "▾" } else { "▸" })
                .child(tr(key))
        };
        let host = cx.weak_entity();
        let mut basic: Vec<AnyElement> = vec![];
        if form.source == SourceKind::Local {
            let (current, host) = (form.driver, host.clone());
            let select = Select::new("model-connection-driver", current.defaults().0, move |_| {
                Driver::ALL
                    .into_iter()
                    .map(|driver| {
                        let host = host.clone();
                        SelectOption::new(driver.defaults().0)
                            .selected(driver == current)
                            .on_select(move |_, cx| {
                                let _ = host.update(cx, |s, cx| s.select_driver(driver, cx));
                            })
                    })
                    .collect()
            })
            .full_width()
            .disabled(busy);
            basic.push(field(vec![row(
                Some(label("settings.modelConnections.service")),
                Some(select.into_any_element()),
            )]));
        }
        basic.push(field(vec![row(
            Some(label("settings.modelConnections.name")),
            Some(input(&self.name, cx)),
        )]));
        basic.push(field(vec![row(
            Some(label("settings.modelConnections.url")),
            Some(input(&self.endpoint, cx)),
        )]));
        if form.auth == Auth::Bearer {
            let configured = form
                .editing
                .as_ref()
                .is_some_and(|c| c.credential_id.is_some());
            let mut rows = vec![row(
                Some(label(if configured {
                    "settings.modelConnections.replaceKey"
                } else {
                    "settings.modelConnections.apiKey"
                })),
                Some(input(&self.key, cx)),
            )];
            if self.key_required(cx) {
                rows.push(row(
                    None,
                    Some(small("settings.modelConnections.keyRequired")),
                ));
            }
            let open = form.key_storage;
            let details = v_flex()
                .child(
                    summary(
                        "model-connection-key-storage",
                        "settings.modelConnections.keyStorage",
                        open,
                        t.text,
                    )
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.form.key_storage = !s.form.key_storage;
                        cx.notify();
                    })),
                )
                .when(open, |d| {
                    d.child(small("settings.modelConnections.keyHelp"))
                });
            rows.push(row(Some(details.into_any_element()), None));
            basic.push(field(rows));
        }
        if form.driver == Driver::Unsloth {
            let on = form.server_tools_disabled;
            basic.push(
                h_flex()
                    .id("model-connection-unsloth-tools")
                    .items_start()
                    .gap(px(8.))
                    .text_size(px(m.ui.label))
                    .line_height(px(m.ui.label * 1.45))
                    .text_color(t.subtle)
                    .when(!busy, |d| d.cursor(theme::clickable_cursor()))
                    // The box's default margins: 3px 3px 3px 4px.
                    .child(
                        div()
                            .my(px(3.))
                            .ml(px(4.))
                            .mr(px(3.))
                            .child(native_checkbox(on, false, cx)),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .child(tr("settings.modelConnections.unslothTools")),
                    )
                    .on_click(cx.listener(move |s, _, _, cx| {
                        if !s.busy {
                            s.form.server_tools_disabled = !on;
                            cx.notify();
                        }
                    }))
                    .into_any_element(),
            );
        }
        let advanced_open = form.advanced;
        let mut advanced = v_flex()
            .pt(px(16.))
            .border_t_1()
            .border_color(t.border_subtle)
            .child(
                summary(
                    "model-connection-advanced",
                    "settings.modelConnections.advanced",
                    advanced_open,
                    t.muted,
                )
                .when(advanced_open, |d| d.mb(px(16.)))
                .on_click(cx.listener(|s, _, _, cx| {
                    s.form.advanced = !s.form.advanced;
                    cx.notify();
                })),
            );
        if advanced_open {
            let (current, host) = (form.auth, host.clone());
            let auth = Select::new(
                "model-connection-auth",
                tr(auth_label(current)),
                move |_| {
                    [Auth::None, Auth::Bearer]
                        .into_iter()
                        .map(|auth| {
                            let host = host.clone();
                            SelectOption::new(tr(auth_label(auth)))
                                .selected(auth == current)
                                .on_select(move |_, cx| {
                                    let _ = host.update(cx, |s, cx| {
                                        s.form.auth = auth;
                                        s.key.update(cx, |i, cx| i.clear(cx));
                                        cx.notify();
                                    });
                                })
                        })
                        .collect()
                },
            )
            .full_width()
            .disabled(busy);
            advanced = advanced.child(fields(vec![
                field(vec![row(
                    Some(label("settings.modelConnections.authentication")),
                    Some(auth.into_any_element()),
                )]),
                field(vec![row(
                    Some(label("settings.modelConnections.manualModel")),
                    Some(input(&self.manual_model, cx)),
                )]),
                field(vec![row(
                    Some(label("settings.modelConnections.defaultModel")),
                    Some(input(&self.default_model, cx)),
                )]),
                field(vec![
                    row(
                        Some(label("settings.modelConnections.context")),
                        Some(input(&self.context, cx)),
                    ),
                    row(None, Some(small("settings.modelConnections.contextHelp"))),
                ]),
            ]));
        }
        v_flex()
            .px(px(10.))
            .min_w_0()
            .gap(px(20.))
            .child(fields(basic))
            .child(advanced)
            .child(
                h_flex()
                    .justify_end()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        Button::new("save-connection")
                            .variant(ButtonVariant::OutlinePrimary)
                            .label(tr(if busy {
                                "settings.modelConnections.saving"
                            } else {
                                "settings.modelConnections.save"
                            }))
                            .disabled(busy)
                            .on_click(cx.listener(|s, _, _, cx| s.save(cx))),
                    )
                    .child(
                        Button::new("cancel-connection")
                            .label(tr("common.action.cancel"))
                            .disabled(busy)
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.key.update(cx, |i, cx| i.clear(cx));
                                let back = match &s.page {
                                    PageState::Edit(id) => PageState::Detail(id.clone()),
                                    _ => PageState::List,
                                };
                                s.navigate(back, cx)
                            })),
                    ),
            )
    }
}
/// The Authentication option labels.
fn auth_label(auth: Auth) -> &'static str {
    match auth {
        Auth::None => "settings.modelConnections.noKey",
        Auth::Bearer => "settings.modelConnections.apiKey",
        Auth::Oauth => "native.modelConnections.signedIn",
    }
}
