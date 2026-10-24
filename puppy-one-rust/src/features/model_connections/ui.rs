//! Port of `model-connections/ModelConnectionsSettings.tsx` (list → detail →
//! add/edit) on the native configuration client. Storage and Keychain access
//! stay behind `infrastructure`; API keys are taken from the clipboard and are
//! never rendered.
use super::infrastructure::{self as client, ModelConnection};
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{
        appearance::ActiveAppearance,
        components::{
            Button, ButtonVariant, Icon, MutedRow, SettingRow, SettingsCategory,
            SettingsCategoryList, SettingsSection, Switch, ValueRow, tooltip,
        },
        form_input::TextInput,
    },
    wake::Wake,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};
pub struct Saved;
#[derive(Clone, Copy, PartialEq, Eq)]
enum SourceKind {
    Api,
    Local,
}
impl SourceKind {
    fn of(endpoint: &str) -> Self {
        let host = endpoint
            .split("://")
            .nth(1)
            .unwrap_or(endpoint)
            .split(['/', ':'])
            .next()
            .unwrap_or_default()
            .to_lowercase();
        if host == "localhost" || host.starts_with("127.") || host == "[" || host == "0.0.0.0" {
            Self::Local
        } else {
            Self::Api
        }
    }
    fn key(self) -> &'static str {
        match self {
            Self::Api => "api",
            Self::Local => "local",
        }
    }
}
#[derive(Clone, PartialEq)]
enum PageState {
    List,
    Detail(String),
    Edit(String),
    Add(SourceKind),
}
pub struct ModelConnections {
    items: Vec<ModelConnection>,
    loaded: bool,
    page: PageState,
    id: String,
    name: Entity<TextInput>,
    endpoint: Entity<TextInput>,
    model: Entity<TextInput>,
    images: bool,
    authenticated: bool,
    generation: String,
    confirm_remove: bool,
    secret: Option<String>,
    error: Option<String>,
    busy: bool,
    rx: std::sync::mpsc::Receiver<Result<Vec<ModelConnection>, String>>,
    /// Reachable local services from the last discovery, and a pending one.
    candidates: Vec<client::Candidate>,
    discover_rx: Option<std::sync::mpsc::Receiver<Vec<client::Candidate>>>,
    wake: Wake,
}
impl EventEmitter<Saved> for ModelConnections {}
impl ModelConnections {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (wake, rx) = Wake::channel();
        let result = client::load(wake.clone());
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this.update_in(cx, |s, _, cx| s.receive(cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        Self {
            items: vec![],
            loaded: false,
            page: PageState::List,
            id: uuid::Uuid::new_v4().to_string(),
            name: cx.new(|cx| TextInput::new("", false, 120, window, cx)),
            endpoint: cx.new(|cx| TextInput::new("https://…", false, 2048, window, cx)),
            model: cx.new(|cx| TextInput::new("", false, 300, window, cx)),
            images: false,
            authenticated: false,
            generation: String::new(),
            confirm_remove: false,
            secret: None,
            error: None,
            busy: true,
            rx: result,
            candidates: vec![],
            discover_rx: None,
            wake,
        }
    }
    fn receive(&mut self, cx: &mut Context<Self>) {
        if let Some(found) = self.discover_rx.as_ref().and_then(|rx| rx.try_recv().ok()) {
            self.discover_rx = None;
            self.candidates = found;
            cx.notify();
        }
        let Ok(result) = self.rx.try_recv() else {
            return;
        };
        self.busy = false;
        self.loaded = true;
        match result {
            Ok(items) => {
                let saved_form = matches!(self.page, PageState::Edit(_) | PageState::Add(_));
                self.items = items;
                self.error = None;
                self.secret = None;
                if saved_form && self.items.iter().any(|c| c.id == self.id) {
                    self.page = PageState::Detail(self.id.clone());
                }
                if let PageState::Detail(id) = &self.page
                    && !self.items.iter().any(|c| &c.id == id)
                {
                    self.page = PageState::List;
                }
                cx.emit(Saved);
            }
            Err(e) => self.error = Some(e),
        }
        cx.notify();
    }
    fn navigate(&mut self, page: PageState, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.error = None;
        self.confirm_remove = false;
        match &page {
            PageState::Edit(id) => {
                let c = self.items.iter().find(|c| &c.id == id).cloned();
                self.load_form(c, cx)
            }
            PageState::Add(_) => self.load_form(None, cx),
            _ => {}
        }
        self.page = page;
        cx.notify();
    }
    fn load_form(&mut self, c: Option<ModelConnection>, cx: &mut Context<Self>) {
        self.id = c
            .as_ref()
            .map(|c| c.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        self.images = c.as_ref().is_some_and(|c| c.images);
        self.authenticated = c.as_ref().is_some_and(|c| c.authenticated);
        self.secret = None;
        self.generation = c.as_ref().map(|c| c.generation.clone()).unwrap_or_default();
        let fields = [
            (
                &self.name,
                c.as_ref().map(|c| c.name.clone()).unwrap_or_default(),
            ),
            (
                &self.endpoint,
                c.as_ref().map(|c| c.endpoint.clone()).unwrap_or_default(),
            ),
            (&self.model, c.map(|c| c.model).unwrap_or_default()),
        ];
        for (input, text) in fields {
            input.update(cx, |i, cx| i.set_text(text, cx));
        }
    }
    fn reload(&mut self, cx: &mut Context<Self>) {
        if !self.busy {
            self.rx = client::load(self.wake.clone());
            self.busy = true;
            cx.notify();
        }
    }
    fn save(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let connection = ModelConnection {
            id: self.id.clone(),
            name: self.name.read(cx).text().into(),
            endpoint: self.endpoint.read(cx).text().into(),
            model: self.model.read(cx).text().into(),
            images: self.images,
            authenticated: self.authenticated || self.secret.is_some(),
            credential_id: None,
            generation: self.generation.clone(),
        };
        self.rx = client::save(connection, self.secret.take(), self.wake.clone());
        self.busy = true;
        cx.notify();
    }
    fn title(&self) -> String {
        match &self.page {
            PageState::Edit(_) => tr("settings.modelConnections.edit").into(),
            PageState::Add(_) => tr("settings.modelConnections.add").into(),
            PageState::Detail(id) => self
                .items
                .iter()
                .find(|c| &c.id == id)
                .map(|c| c.name.clone())
                .unwrap_or_else(|| tr("settings.modelConnections.title").into()),
            PageState::List => tr("settings.modelConnections.title").into(),
        }
    }
    /// `ModelConnectionsList`: per source kind a category with quiet text
    /// actions over a `.model-connections-list` card of 34px rows.
    fn list(&self, t: Theme, cx: &mut Context<Self>) -> SettingsCategoryList {
        let m = theme::ty();
        let table = |rows: Vec<AnyElement>| {
            div()
                .flex()
                .flex_col()
                .w_full()
                .p(px(4.))
                .border_1()
                .border_color(t.border_subtle)
                .rounded(px(7.))
                .bg(t.panel)
                .children(rows)
        };
        let table_row = || {
            h_flex()
                .w_full()
                .min_w_0()
                .min_h(px(theme::control_large()))
                .p(px(8.))
                .gap(px(10.))
                .rounded(px(6.))
                .text_size(px(m.ui.label))
                .line_height(px(18.))
                .text_color(t.muted)
        };
        let identity = |name: SharedString, endpoint: SharedString| {
            v_flex()
                .flex_1()
                .min_w_0()
                .gap(px(3.))
                .child(div().truncate().text_color(t.text).child(name))
                .child(
                    div()
                        .truncate()
                        .text_size(px(m.ui.caption))
                        .line_height(px(15.))
                        .text_color(t.subtle)
                        .child(endpoint),
                )
        };
        // `.model-connections-text-action`: 20px, 4px inline, caption type.
        let text_action = |id: SharedString, icon: &'static str, size: f32, label: String| {
            div()
                .id(id)
                .h(px(theme::control_micro()))
                .px(px(4.))
                .flex()
                .items_center()
                .gap(px(5.))
                .rounded(px(6.))
                .text_size(px(m.ui.caption))
                .text_color(t.subtle)
                .hover(move |s| s.bg(t.hover).text_color(t.text))
                .child(
                    Icon::new(icon)
                        .with_size(px(size))
                        .stroke(2.)
                        .color(t.subtle),
                )
                .child(label)
        };
        let mut categories = vec![];
        for kind in [SourceKind::Api, SourceKind::Local] {
            let mut rows: Vec<AnyElement> = vec![];
            for (index, item) in self
                .items
                .iter()
                .filter(|c| SourceKind::of(&c.endpoint) == kind)
                .enumerate()
            {
                let id = item.id.clone();
                rows.push(
                    table_row()
                        .id(SharedString::from(format!(
                            "connection-{}-{index}",
                            kind.key()
                        )))
                        .cursor(theme::clickable_cursor())
                        .hover(move |s| s.bg(t.hover))
                        .child(
                            Icon::new(if kind == SourceKind::Api {
                                "key-round"
                            } else {
                                "server"
                            })
                            .with_size(px(18.))
                            .stroke(2.)
                            .color(t.muted),
                        )
                        .child(identity(
                            item.name.clone().into(),
                            item.endpoint.clone().into(),
                        ))
                        .child(
                            div()
                                .max_w(relative(0.32))
                                .text_size(px(m.ui.caption))
                                .text_color(t.muted)
                                .child(tr(if item.model.is_empty() {
                                    "settings.modelConnections.status.unread"
                                } else {
                                    "settings.modelConnections.status.ready"
                                })),
                        )
                        .child(Icon::new("chevron-right").small().stroke(2.).color(t.muted))
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.navigate(PageState::Detail(id.clone()), cx)
                        }))
                        .into_any_element(),
                );
            }
            if rows.is_empty() && self.loaded {
                rows.push(
                    table_row()
                        .text_color(t.subtle)
                        .child(tr(&format!(
                            "settings.modelConnections.empty.{}",
                            kind.key()
                        )))
                        .into_any_element(),
                );
            }
            if kind == SourceKind::Local {
                for (index, candidate) in self
                    .candidates
                    .iter()
                    .filter(|c| !self.items.iter().any(|i| i.endpoint == c.endpoint))
                    .cloned()
                    .enumerate()
                {
                    rows.push(
                        table_row()
                            .child(
                                Icon::new("server")
                                    .with_size(px(18.))
                                    .stroke(2.)
                                    .color(t.muted),
                            )
                            .child(identity(candidate.name.into(), candidate.endpoint.into()))
                            .child(
                                Button::new(("connect-candidate", index))
                                    .label(tr("settings.modelConnections.connect"))
                                    .disabled(self.busy)
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        s.navigate(PageState::Add(SourceKind::Local), cx);
                                        s.name.update(cx, |i, cx| i.set_text(candidate.name, cx));
                                        s.endpoint
                                            .update(cx, |i, cx| i.set_text(candidate.endpoint, cx));
                                    })),
                            )
                            .into_any_element(),
                    );
                }
            }
            let mut actions = h_flex().gap(px(8.));
            if kind == SourceKind::Local {
                let discovering = self.discover_rx.is_some();
                actions = actions.child(
                    text_action(
                        "discover-local-models".into(),
                        if discovering {
                            "loader-circle"
                        } else {
                            "refresh-cw"
                        },
                        12.,
                        tr(if discovering {
                            "settings.modelConnections.discovering"
                        } else {
                            "settings.modelConnections.discover"
                        })
                        .into(),
                    )
                    .on_click(cx.listener(|s, _, _, cx| s.discover(cx))),
                );
            }
            actions = actions.child(
                text_action(
                    SharedString::from(format!("add-{}", kind.key())),
                    "plus",
                    14.,
                    tr("settings.modelConnections.add").into(),
                )
                .tooltip(tooltip(tr(&format!(
                    "settings.modelConnections.add.{}",
                    kind.key()
                ))))
                .on_click(cx.listener(move |s, _, _, cx| s.navigate(PageState::Add(kind), cx))),
            );
            categories.push(
                SettingsCategory::new(tr(&format!(
                    "settings.modelConnections.source.{}",
                    kind.key()
                )))
                .action(actions)
                .body(table(rows)),
            );
        }
        SettingsCategoryList::new()
            .children(categories)
            .when(!self.loaded, |list| {
                list.child(MutedRow::new(tr("settings.modelConnections.loading")))
            })
    }
    /// `discover()`: probe local model services (Ollama, LM Studio).
    fn discover(&mut self, cx: &mut Context<Self>) {
        if self.discover_rx.is_none() {
            self.discover_rx = Some(client::discover(self.wake.clone()));
            cx.notify();
        }
    }
    fn detail(&self, id: &str, t: Theme, cx: &mut Context<Self>) -> Div {
        let Some(item) = self.items.iter().find(|c| c.id == id).cloned() else {
            return div();
        };
        let kind = SourceKind::of(&item.endpoint);
        let edit_id = item.id.clone();
        let edit = Button::new("edit-connection")
            .label(tr("settings.modelConnections.edit"))
            .disabled(self.busy)
            .on_click(
                cx.listener(move |s, _, _, cx| s.navigate(PageState::Edit(edit_id.clone()), cx)),
            );
        let refresh = Button::new("refresh-models")
            .icon(if self.busy {
                "loader-circle"
            } else {
                "refresh-cw"
            })
            .label(tr("settings.modelConnections.refresh"))
            .disabled(self.busy)
            .on_click(cx.listener(|s, _, _, cx| s.reload(cx)));
        let models: Vec<AnyElement> = if item.model.is_empty() {
            vec![MutedRow::new(tr("settings.modelConnections.modelsEmpty")).into_any_element()]
        } else {
            vec![
                ValueRow::new(item.model.clone(), tr("settings.modelConnections.loaded"))
                    .into_any_element(),
            ]
        };
        let remove: AnyElement = if self.confirm_remove {
            v_flex()
                .gap(px(8.))
                .px(px(10.))
                .child(
                    div()
                        .text_size(px(theme::ty().ui.meta))
                        .text_color(t.danger)
                        .child(tr("settings.modelConnections.deleteWarning")),
                )
                .child(
                    h_flex()
                        .gap(px(6.))
                        .child(
                            Button::new("confirm-remove")
                                .variant(ButtonVariant::OutlineDanger)
                                .label(tr("settings.modelConnections.confirmDelete"))
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
                        .label(tr("settings.modelConnections.remove"))
                        .disabled(self.busy)
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.confirm_remove = true;
                            cx.notify()
                        })),
                )
                .into_any_element()
        };
        v_flex()
            .gap(px(20.))
            .child(
                v_flex()
                    .gap(px(2.))
                    .child(ValueRow::new(
                        tr("settings.modelConnections.sourceKind"),
                        tr(&format!("settings.modelConnections.source.{}", kind.key())),
                    ))
                    .child(
                        ValueRow::new(tr("settings.modelConnections.url"), item.endpoint.clone())
                            .monospace(true),
                    )
                    .child(
                        ValueRow::new(
                            tr("settings.modelConnections.apiKey"),
                            tr(if item.authenticated {
                                "settings.modelConnections.keyConfigured"
                            } else {
                                "settings.modelConnections.noKey"
                            }),
                        )
                        .action(edit),
                    ),
            )
            .child(
                div().px(px(10.)).child(
                    SettingsCategory::new(format!(
                        "{} {}",
                        tr("settings.modelConnections.models"),
                        usize::from(!item.model.is_empty())
                    ))
                    .action(refresh)
                    .children(models),
                ),
            )
            .child(remove)
    }
    fn form(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let field = |label: &'static str, input: AnyElement| {
            v_flex()
                .gap(px(6.))
                .px(px(10.))
                .child(
                    div()
                        .text_size(px(theme::ty().ui.meta))
                        .text_color(t.subtle)
                        .child(tr(label)),
                )
                .child(input)
        };
        let key_status = if self.secret.is_some() || self.authenticated {
            tr("settings.modelConnections.keyConfigured")
        } else {
            tr("settings.modelConnections.noKey")
        };
        let paste_label = tf("workspace.node.pasteItems", &[("count", 0usize.into())]);
        let key_row = h_flex()
            .gap(px(8.))
            .px(px(10.))
            .child(
                div()
                    .flex_1()
                    .text_size(px(theme::ty().ui.label))
                    .text_color(t.text)
                    .child(key_status),
            )
            .child(
                Button::new("paste-key")
                    .icon("clipboard-paste")
                    .label(paste_label)
                    .tooltip(tr("settings.modelConnections.keyHelp"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.secret = cx.read_from_clipboard().and_then(|c| c.text());
                        cx.notify();
                    })),
            )
            .child(
                Button::new("no-key")
                    .label(tr("settings.modelConnections.noKey"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.authenticated = false;
                        s.secret = None;
                        cx.notify();
                    })),
            );
        let images = self.images;
        let host = cx.weak_entity();
        v_flex()
            .gap(px(14.))
            .child(field(
                "settings.modelConnections.name",
                self.name.clone().into_any_element(),
            ))
            .child(field(
                "settings.modelConnections.url",
                self.endpoint.clone().into_any_element(),
            ))
            .child(field(
                if self.authenticated {
                    "settings.modelConnections.replaceKey"
                } else {
                    "settings.modelConnections.apiKey"
                },
                key_row.into_any_element(),
            ))
            .child(
                div()
                    .px(px(10.))
                    .text_size(px(theme::ty().ui.caption))
                    .text_color(t.subtle)
                    .child(tr("settings.modelConnections.keyHelp")),
            )
            .child(
                v_flex()
                    .gap(px(10.))
                    .child(
                        div()
                            .px(px(10.))
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.muted)
                            .child(tr("settings.modelConnections.advanced")),
                    )
                    .child(field(
                        "settings.modelConnections.defaultModel",
                        self.model.clone().into_any_element(),
                    ))
                    .child(
                        SettingRow::new(tr("settings.modelConnections.advertised")).control(
                            Switch::new("model-images", tr("settings.modelConnections.advertised"))
                                .checked(images)
                                .on_change(move |on, _, cx| {
                                    let _ = host.update(cx, |s, cx| {
                                        s.images = on;
                                        cx.notify()
                                    });
                                }),
                        ),
                    ),
            )
            .child(
                h_flex()
                    .gap(px(6.))
                    .px(px(10.))
                    .child(
                        Button::new("save-connection")
                            .variant(ButtonVariant::OutlinePrimary)
                            .label(tr(if self.busy {
                                "settings.modelConnections.saving"
                            } else {
                                "settings.modelConnections.save"
                            }))
                            .disabled(self.busy)
                            .on_click(cx.listener(|s, _, _, cx| s.save(cx))),
                    )
                    .child(
                        Button::new("cancel-connection")
                            .label(tr("common.action.cancel"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.secret = None;
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
impl Render for ModelConnections {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let back = match &self.page {
            PageState::List => None,
            PageState::Edit(id) => Some(PageState::Detail(id.clone())),
            _ => Some(PageState::List),
        };
        let mut view = SettingsSection::new(self.title());
        if let Some(back) = back {
            view = view.child(
                h_flex().px(px(10.)).child(
                    Button::new("model-connections-back")
                        .icon("chevron-left")
                        .label(tr("settings.modelConnections.back"))
                        .disabled(self.busy)
                        .on_click(cx.listener(move |s, _, _, cx| s.navigate(back.clone(), cx))),
                ),
            );
        }
        if let Some(error) = &self.error {
            view = view.child(
                div()
                    .px(px(10.))
                    .text_size(px(theme::ty().ui.meta))
                    .text_color(t.danger)
                    .child(tf(
                        "settings.modelConnections.error",
                        &[("code", error.clone().into())],
                    )),
            );
        }
        let content = match self.page.clone() {
            PageState::List => self.list(t, cx).into_any_element(),
            PageState::Detail(id) => self.detail(&id, t, cx).into_any_element(),
            PageState::Edit(_) | PageState::Add(_) => self.form(t, cx).into_any_element(),
        };
        view.child(content)
    }
}
