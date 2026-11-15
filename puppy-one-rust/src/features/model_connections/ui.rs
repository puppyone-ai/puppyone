//! Port of `model-connections/ModelConnectionsSettings.tsx` (list → detail →
//! add/edit with `ModelConnectionSetup.tsx`) on the native configuration
//! client. Storage and Keychain access stay behind `infrastructure`; an API
//! key is typed into a password field, sent once and never rendered.
use super::infrastructure::{self as client, Auth, Driver, ModelConnection, SourceKind};
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{
        appearance::ActiveAppearance,
        components::{
            Button, ButtonVariant, Icon, MutedRow, Select, SelectOption, SettingsCategory,
            SettingsCategoryList, SettingsSection, ValueRow, native_checkbox, tooltip,
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
#[derive(Clone, PartialEq)]
enum PageState {
    List,
    Detail(String),
    Edit(String),
    /// A new connection of a category, from a discovered service or not.
    Add(SourceKind, Option<client::Candidate>),
}
/// The `ModelConnectionSetup` form's state.
struct Form {
    /// The connection being edited, as saved.
    editing: Option<ModelConnection>,
    source: SourceKind,
    driver: Driver,
    auth: Auth,
    server_tools_disabled: bool,
    /// The `<details>` disclosures: Advanced settings and Key storage.
    advanced: bool,
    key_storage: bool,
}
pub struct ModelConnections {
    items: Vec<ModelConnection>,
    loaded: bool,
    page: PageState,
    id: String,
    name: Entity<TextInput>,
    endpoint: Entity<TextInput>,
    /// Write-only: cleared on save and cancel.
    key: Entity<TextInput>,
    manual_model: Entity<TextInput>,
    default_model: Entity<TextInput>,
    context: Entity<TextInput>,
    form: Form,
    generation: String,
    confirm_remove: bool,
    error: Option<String>,
    busy: bool,
    rx: std::sync::mpsc::Receiver<Result<Vec<ModelConnection>, String>>,
    /// Reachable local services from the last discovery, and a pending one.
    candidates: Vec<client::Candidate>,
    discover_rx: Option<std::sync::mpsc::Receiver<Vec<client::Candidate>>>,
    /// The service catalog of the shown connection (`catalogs`).
    catalog: Option<(String, Result<Vec<client::CatalogModel>, String>)>,
    catalog_rx: Option<std::sync::mpsc::Receiver<Result<Vec<client::CatalogModel>, String>>>,
    /// Agent tool round trips that passed, by route; one in flight.
    verified: std::collections::BTreeMap<String, bool>,
    verify_rx: Option<(String, std::sync::mpsc::Receiver<Result<(), String>>)>,
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
            key: cx.new(|cx| TextInput::new("", false, 8192, window, cx).masked(window, cx)),
            manual_model: cx.new(|cx| TextInput::new("", false, 300, window, cx)),
            default_model: cx.new(|cx| TextInput::new("", false, 300, window, cx)),
            context: cx.new(|cx| TextInput::new("", false, 8, window, cx)),
            form: Form {
                editing: None,
                source: SourceKind::Api,
                driver: Driver::OpenaiCompatible,
                auth: Auth::Bearer,
                server_tools_disabled: false,
                advanced: false,
                key_storage: false,
            },
            generation: String::new(),
            confirm_remove: false,
            error: None,
            busy: true,
            rx: result,
            candidates: vec![],
            discover_rx: None,
            catalog: None,
            catalog_rx: None,
            verified: Default::default(),
            verify_rx: None,
            wake,
        }
    }
    fn receive(&mut self, cx: &mut Context<Self>) {
        if let Some(found) = self.discover_rx.as_ref().and_then(|rx| rx.try_recv().ok()) {
            self.discover_rx = None;
            self.candidates = found;
            cx.notify();
        }
        if let Some(result) = self.catalog_rx.as_ref().and_then(|rx| rx.try_recv().ok()) {
            self.catalog_rx = None;
            if let PageState::Detail(id) = &self.page {
                self.catalog = Some((id.clone(), result));
            }
            cx.notify();
        }
        if let Some((route, result)) = self
            .verify_rx
            .as_ref()
            .and_then(|(route, rx)| rx.try_recv().ok().map(|r| (route.clone(), r)))
        {
            self.verify_rx = None;
            self.verified.insert(route, result.is_ok());
            cx.notify();
        }
        let Ok(result) = self.rx.try_recv() else {
            return;
        };
        self.busy = false;
        self.loaded = true;
        match result {
            Ok(items) => {
                self.items = items;
                self.error = None;
                // A saved form returns where it was opened from; an edited
                // connection's catalog is read again.
                match self.page.clone() {
                    PageState::Edit(id) => {
                        self.page = PageState::Detail(id.clone());
                        self.read_catalog(id);
                    }
                    PageState::Add(..) => self.page = PageState::List,
                    _ => {}
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
                let source = c.as_ref().map(|c| c.source_kind).unwrap_or_default();
                self.load_form(c, source, None, cx)
            }
            PageState::Add(source, candidate) => {
                self.load_form(None, *source, candidate.clone(), cx)
            }
            PageState::Detail(id) => self.read_catalog(id.clone()),
            _ => {}
        }
        self.page = page;
        cx.notify();
    }
    /// `initialConnectionFields`: the connection's fields, else the
    /// discovered service's, else its category's default service.
    fn load_form(
        &mut self,
        c: Option<ModelConnection>,
        source: SourceKind,
        candidate: Option<client::Candidate>,
        cx: &mut Context<Self>,
    ) {
        let driver = c
            .as_ref()
            .map(|c| c.driver)
            .or(candidate.as_ref().map(|c| c.driver))
            .unwrap_or(match source {
                SourceKind::Api => Driver::OpenaiCompatible,
                SourceKind::Local => Driver::Ollama,
            });
        let (name, endpoint) = driver.defaults();
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
                    .or(candidate.as_ref().map(|c| c.name.into()))
                    .unwrap_or(name.into()),
            ),
            (
                &self.endpoint,
                c.as_ref()
                    .map(|c| c.endpoint.clone())
                    .or(candidate.as_ref().map(|c| c.endpoint.into()))
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
                    .unwrap_or(4096)
                    .to_string(),
            ),
        ];
        for (input, text) in fields {
            input.update(cx, |i, cx| i.set_text(text, cx));
        }
        self.form = Form {
            auth: c.as_ref().map(|c| c.auth).unwrap_or(driver.default_auth()),
            server_tools_disabled: c.as_ref().is_some_and(|c| c.server_tools_disabled),
            editing: c,
            source,
            driver,
            advanced: false,
            key_storage: false,
        };
    }
    /// `selectDriver`: a service starts from its name, URL and
    /// authentication, without a key.
    fn select_driver(&mut self, driver: Driver, cx: &mut Context<Self>) {
        let (name, endpoint) = driver.defaults();
        self.name.update(cx, |i, cx| i.set_text(name, cx));
        self.endpoint.update(cx, |i, cx| i.set_text(endpoint, cx));
        self.key.update(cx, |i, cx| i.clear(cx));
        self.form.driver = driver;
        self.form.auth = driver.default_auth();
        self.form.server_tools_disabled = false;
        cx.notify();
    }
    /// `keyRequired`: a saved key does not follow the connection to another
    /// endpoint or authentication method.
    fn key_required(&self, cx: &App) -> bool {
        self.form.editing.as_ref().is_some_and(|c| {
            c.credential_id.is_some()
                && (self.endpoint.read(cx).text() != c.endpoint || self.form.auth != c.auth)
        })
    }
    fn reload(&mut self, cx: &mut Context<Self>) {
        if !self.busy {
            self.rx = client::load(self.wake.clone());
            self.busy = true;
            cx.notify();
        }
    }
    /// The form's `onSubmit`: the key travels with this one request and the
    /// field is cleared at once.
    fn save(&mut self, cx: &mut Context<Self>) {
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
    fn title(&self) -> String {
        match &self.page {
            PageState::Edit(_) => tr("settings.modelConnections.edit").into(),
            PageState::Add(..) => tr("settings.modelConnections.add").into(),
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
                .filter(|c| c.source_kind == kind)
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
                                .child(tr(&format!(
                                    "settings.modelConnections.status.{}",
                                    self.catalog_key(&item.id)
                                ))),
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
                                        s.navigate(
                                            PageState::Add(
                                                SourceKind::Local,
                                                Some(candidate.clone()),
                                            ),
                                            cx,
                                        )
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
                .on_click(
                    cx.listener(move |s, _, _, cx| s.navigate(PageState::Add(kind, None), cx)),
                ),
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
    /// Read the service's model catalog for `id`.
    fn read_catalog(&mut self, id: String) {
        if let Some(connection) = self.items.iter().find(|c| c.id == id).cloned() {
            self.catalog = None;
            self.catalog_rx = Some(client::catalog(connection, self.wake.clone()));
        }
    }
    /// The models of the connection's catalog, once read.
    fn listed_models(&self, item: &ModelConnection) -> Vec<client::CatalogModel> {
        match &self.catalog {
            Some((id, Ok(models))) if *id == item.id => models.clone(),
            _ => vec![],
        }
    }
    /// `catalog?.status ?? "unread"` of connection `id`.
    fn catalog_key(&self, id: &str) -> &'static str {
        match &self.catalog {
            Some((shown, _)) if shown == id && self.catalog_rx.is_some() => "refreshing",
            Some((shown, Ok(_))) if shown == id => "ready",
            Some((shown, Err(_))) if shown == id => "failed",
            _ => "unread",
        }
    }
    /// `catalog.status` of the shown connection, when not ready.
    fn catalog_status(&self, item: &ModelConnection) -> Option<String> {
        if self.catalog_rx.is_some() {
            return Some(tr("settings.modelConnections.status.refreshing").to_string());
        }
        match &self.catalog {
            Some((id, Err(code))) if *id == item.id => Some(format!(
                "{} · {}",
                tr("settings.modelConnections.status.failed"),
                tf(
                    "settings.modelConnections.error",
                    &[("code", code.clone().into())]
                )
            )),
            Some((id, Ok(_))) if *id == item.id => None,
            _ => Some(tr("settings.modelConnections.status.unread").to_string()),
        }
    }
    /// One `.model-connections-model` row: identity (name, verification
    /// label) and the Verify action.
    fn model_row(
        &self,
        item: &ModelConnection,
        model: &client::CatalogModel,
        index: usize,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let route = format!("{}/{}", item.id, model.id);
        let label = tr(if self.verified.get(&route) == Some(&true) {
            "settings.modelConnections.verified"
        } else if model.tools == Some(true) {
            "settings.modelConnections.advertised"
        } else {
            "settings.modelConnections.unverified"
        });
        let loaded = match model.loaded {
            Some(true) => Some(tr("settings.modelConnections.loaded")),
            Some(false) => Some(tr("settings.modelConnections.notLoaded")),
            None => None,
        };
        let verifying = self.verify_rx.as_ref().is_some_and(|(r, _)| *r == route);
        let mut connection = item.clone();
        connection.model = model.id.clone();
        h_flex()
            .w_full()
            .min_w_0()
            .min_h(px(42.))
            .justify_between()
            .gap(px(18.))
            .px(px(10.))
            .child(
                v_flex()
                    .min_w_0()
                    .child(
                        div()
                            .truncate()
                            .text_size(px(theme::ty().ui.label))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(model.name.clone()),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(px(theme::ty().ui.caption))
                            .text_color(t.subtle)
                            .child(match loaded {
                                Some(loaded) => format!("{label} · {loaded}"),
                                None => label.to_string(),
                            }),
                    ),
            )
            .child(
                Button::new(("verify-model", index))
                    .label(tr(if verifying {
                        "settings.modelConnections.working"
                    } else {
                        "settings.modelConnections.verify"
                    }))
                    // `findModel`: a known window, and Unsloth's own tools off.
                    .disabled(
                        self.busy
                            || self.verify_rx.is_some()
                            || model.context.is_none()
                            || (item.driver == Driver::Unsloth && !item.server_tools_disabled),
                    )
                    .on_click(cx.listener(move |s, _, _, cx| {
                        if s.verify_rx.is_none() {
                            s.verify_rx = Some((
                                connection.route(),
                                client::verify(connection.clone(), s.wake.clone()),
                            ));
                            cx.notify();
                        }
                    })),
            )
            .into_any_element()
    }
    fn detail(&self, id: &str, t: Theme, cx: &mut Context<Self>) -> Div {
        let Some(item) = self.items.iter().find(|c| c.id == id).cloned() else {
            return div();
        };
        let kind = item.source_kind;
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
                            tr(if item.credential_id.is_some() {
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
    /// `ModelConnectionSetup` (`.model-connection-setup`): fields on a
    /// `minmax(120px, .7fr) minmax(0, 1fr)` grid (one column at 800px and
    /// under), the Advanced settings disclosure, then the actions.
    fn form(&self, narrow: bool, t: Theme, cx: &mut Context<Self>) -> Div {
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
    }
}
impl Render for ModelConnections {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
            PageState::Edit(_) | PageState::Add(..) => self
                .form(window.viewport_size().width <= px(800.), t, cx)
                .into_any_element(),
        };
        view.child(content)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use gpui::{TestAppContext, VisualTestContext};

    /// The page with no connections read and nothing pending.
    fn page(cx: &mut TestAppContext) -> (Entity<ModelConnections>, &mut VisualTestContext) {
        cx.update(gpui_kit::init);
        let (view, cx) = cx.add_window_view(ModelConnections::new);
        view.update(cx, |s, _| {
            s.rx = std::sync::mpsc::sync_channel(1).1;
            s.busy = false;
            s.loaded = true;
        });
        (view, cx)
    }

    /// `modelConnectionsSettings.test.tsx`: "starts an API connection with
    /// URL and write-only Key" and the local service defaults.
    #[gpui::test]
    fn a_new_connection_starts_from_its_category_and_service(cx: &mut TestAppContext) {
        let (view, cx) = page(cx);
        view.update(cx, |s, cx| {
            s.navigate(PageState::Add(SourceKind::Api, None), cx);
            assert_eq!(
                (s.form.driver, s.form.auth),
                (Driver::OpenaiCompatible, Auth::Bearer)
            );
            assert_eq!(s.endpoint.read(cx).text(), "");
            assert!(!s.form.advanced && !s.form.key_storage);
            s.navigate(PageState::Add(SourceKind::Local, None), cx);
            assert_eq!((s.form.driver, s.form.auth), (Driver::Ollama, Auth::None));
            assert_eq!(s.endpoint.read(cx).text(), "http://127.0.0.1:11434/v1");
            assert_eq!(s.context.read(cx).text(), "4096");
            s.key.update(cx, |i, cx| i.set_text("typed-key", cx));
            s.select_driver(Driver::Unsloth, cx);
            assert_eq!(s.form.auth, Auth::Bearer);
            assert_eq!(
                (s.name.read(cx).text(), s.endpoint.read(cx).text()),
                ("Unsloth", "http://127.0.0.1:8000/v1")
            );
            assert_eq!(s.key.read(cx).text(), "");
            s.form.advanced = true;
            s.form.key_storage = true;
        });
        cx.run_until_parked();
        let candidate = client::Candidate {
            driver: Driver::LmStudio,
            name: "LM Studio",
            endpoint: "http://127.0.0.1:1234/v1",
        };
        view.update(cx, |s, cx| {
            s.navigate(PageState::Add(SourceKind::Local, Some(candidate)), cx);
            assert_eq!((s.form.driver, s.form.auth), (Driver::LmStudio, Auth::None));
            assert_eq!(s.name.read(cx).text(), "LM Studio");
        });
    }

    /// "preserves the saved Key on edit": the key field starts empty, and a
    /// new endpoint or authentication asks for the key again.
    #[gpui::test]
    fn an_edit_keeps_the_saved_key_until_its_endpoint_changes(cx: &mut TestAppContext) {
        let (view, cx) = page(cx);
        let id = uuid::Uuid::new_v4().to_string();
        view.update(cx, |s, cx| {
            s.items = vec![ModelConnection {
                id: id.clone(),
                name: "Work API".into(),
                endpoint: "https://example.test/v1".into(),
                auth: Auth::Bearer,
                credential_id: Some("stored".into()),
                generation: "g1".into(),
                manual_context_window: Some(8192),
                ..Default::default()
            }];
            s.navigate(PageState::Edit(id.clone()), cx);
            assert_eq!(s.key.read(cx).text(), "");
            assert_eq!(s.context.read(cx).text(), "8192");
            assert!(!s.key_required(cx));
            s.endpoint
                .update(cx, |i, cx| i.set_text("https://other.test/v1", cx));
            assert!(s.key_required(cx));
            s.endpoint
                .update(cx, |i, cx| i.set_text("https://example.test/v1", cx));
            s.form.auth = Auth::None;
            assert!(s.key_required(cx));
        });
        cx.run_until_parked();
    }
}
