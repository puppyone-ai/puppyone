//! The Model Connections settings page: one place for every source of
//! compute the Built-in Agent can use — PuppyOne's own, provider sign-ins,
//! API keys and local model services (`ModelConnectionsSettings.tsx`,
//! extended for puppyone#122). Chat never configures anything; it reads the
//! ready models this page produces.
//!
//! - `list.rs`: the four source groups, discovery and one-click binding.
//! - `providers.rs`: the API-key provider picker.
//! - `detail.rs`: a connection's models, default and verification.
//! - `form.rs`: the add / edit form (`ModelConnectionSetup`).
//!
//! Storage, Keychain and network work stay behind `infrastructure`; an API
//! key is typed into a password field, sent once and never rendered.
mod detail;
mod form;
mod list;
mod local;
mod providers;
mod rows;

use super::infrastructure::{
    self as client, Auth, Candidate, Connections, Discovery, Driver, ModelConnection,
    OauthProvider, Progress, SignIn, SourceKind,
};
use crate::agent::model_connections::providers as registry;
use crate::{
    localization::{t as tr, tf},
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, SettingsSection},
        form_input::TextInput,
    },
    wake::Wake,
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex};
use std::sync::mpsc::Receiver;

/// A connection was saved or removed: the Agent reloads its models.
pub struct Saved;
/// The PuppyOne row asks Settings to show the Account page.
pub struct OpenAccount;
/// The page moved to another view (a form, details, the list): Settings
/// shows it from the top.
pub struct PageChanged;

#[derive(Clone, PartialEq)]
enum PageState {
    List,
    /// The API-key provider picker.
    ChooseProvider,
    Detail(String),
    Edit(String),
    /// A new connection of a category, from a discovered service or a
    /// provider preset, or neither.
    Add(SourceKind, Option<Candidate>, Option<&'static str>),
}

/// The `ModelConnectionSetup` form's state.
struct Form {
    /// The connection being edited, as saved.
    editing: Option<ModelConnection>,
    source: SourceKind,
    driver: Driver,
    auth: Auth,
    /// The registered provider the form was opened for.
    provider: Option<&'static str>,
    server_tools_disabled: bool,
    /// The `<details>` disclosures: Advanced settings and Key storage.
    advanced: bool,
    key_storage: bool,
}

/// Where an error is shown: next to the action that failed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum ErrorAt {
    /// Under the page title (forms, details, loading).
    #[default]
    Page,
    /// In the local model services card (`Connect`, `Start`).
    Local,
    /// In the sign-in card.
    Accounts,
}

/// A sign-in in flight.
struct SigningIn {
    provider: OauthProvider,
    cancel: client::Cancel,
    rx: Receiver<SignIn>,
    /// The last step the provider asked of the user.
    step: Option<Progress>,
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
    error_at: ErrorAt,
    busy: bool,
    rx: Receiver<Connections>,
    /// Local services from the last discovery, and a pending one.
    discovery: Discovery,
    discover_rx: Option<Receiver<Discovery>>,
    /// A service being started at the user's request.
    starting: Option<(Driver, Receiver<Discovery>)>,
    /// The discovered endpoint (or `endpoint#model`) being bound.
    connecting: Option<String>,
    /// The discovered endpoint whose whole model list is shown.
    expanded: Option<String>,
    /// The install guide is open while local models exist.
    guide_open: bool,
    signing_in: Option<SigningIn>,
    /// PuppyOne compute: `(signed in, credit available)`; `None` while it is
    /// not offered.
    managed: Option<(bool, bool)>,
    managed_rx: Option<Receiver<Option<(bool, bool)>>>,
    /// Payments is on: PuppyOne compute is offered (`enablePayments`).
    payments: bool,
    /// The service catalog of the shown connection (`catalogs`).
    catalog: Option<(String, Result<Vec<client::CatalogModel>, String>)>,
    catalog_rx: Option<Receiver<Result<Vec<client::CatalogModel>, String>>>,
    /// Agent tool round trips that passed, by route; one in flight.
    verified: std::collections::BTreeMap<String, bool>,
    verify_rx: Option<(String, Receiver<Result<(), String>>)>,
    wake: Wake,
}
impl EventEmitter<Saved> for ModelConnections {}
impl EventEmitter<OpenAccount> for ModelConnections {}
impl EventEmitter<PageChanged> for ModelConnections {}

impl ModelConnections {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut page = Self::with_loader(window, cx, client::load);
        page.shown(cx);
        page
    }
    fn with_loader(
        window: &mut Window,
        cx: &mut Context<Self>,
        load: impl FnOnce(Wake) -> Receiver<Connections>,
    ) -> Self {
        let (wake, rx) = Wake::channel();
        let result = load(wake.clone());
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
                provider: None,
                server_tools_disabled: false,
                advanced: false,
                key_storage: false,
            },
            generation: String::new(),
            confirm_remove: false,
            error: None,
            error_at: ErrorAt::Page,
            busy: true,
            rx: result,
            discovery: Discovery::default(),
            discover_rx: None,
            starting: None,
            connecting: None,
            expanded: None,
            guide_open: false,
            signing_in: None,
            managed: None,
            managed_rx: None,
            payments: false,
            catalog: None,
            catalog_rx: None,
            verified: Default::default(),
            verify_rx: None,
            wake,
        }
    }

    /// PuppyOne compute is offered only while Payments is on.
    pub fn set_payments(&mut self, on: bool, cx: &mut Context<Self>) {
        if self.payments != on {
            self.payments = on;
            cx.notify();
        }
    }

    /// The page came into view: look for local services and read PuppyOne
    /// compute's state again (loopback only; nothing is saved or run).
    pub fn shown(&mut self, cx: &mut Context<Self>) {
        // Arriving at the page (from the sidebar or from Chat's source
        // switcher) starts from the sources; an unsaved form is left, and
        // its key field is cleared on the way.
        if !self.busy && self.page != PageState::List {
            self.key.update(cx, |i, cx| i.clear(cx));
            self.navigate(PageState::List, cx);
        }
        self.discover(cx);
        if self.managed_rx.is_none() {
            self.managed_rx = Some(client::managed_status(self.wake.clone()));
        }
    }

    fn receive(&mut self, cx: &mut Context<Self>) {
        if let Some(found) = self.discover_rx.as_ref().and_then(|rx| rx.try_recv().ok()) {
            self.discover_rx = None;
            self.discovery = found;
            cx.notify();
        }
        if let Some((driver, rx)) = &self.starting
            && let Ok(found) = rx.try_recv()
        {
            let driver = *driver;
            self.starting = None;
            if !found.candidates.is_empty() {
                self.discovery.candidates = found.candidates;
                let running: Vec<Driver> =
                    self.discovery.candidates.iter().map(|c| c.driver).collect();
                self.discovery
                    .stopped
                    .retain(|s| !running.contains(&s.driver));
            } else {
                // A menu-bar app (oMLX, Jan, LM Studio) opens without serving
                // until the user starts its server there.
                self.error = Some(match driver {
                    Driver::Omlx | Driver::Jan | Driver::LmStudio => format!(
                        "START_IN_APP:{}",
                        registry::local_for(driver)
                            .map(|p| p.name)
                            .unwrap_or_default()
                    ),
                    _ => "START_FAILED".into(),
                });
                self.error_at = ErrorAt::Local;
            }
            cx.notify();
        }
        if let Some(status) = self.managed_rx.as_ref().and_then(|rx| rx.try_recv().ok()) {
            self.managed_rx = None;
            self.managed = status;
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
            if let Err(code) = &result {
                self.error = Some(code.clone());
            }
            self.verified.insert(route, result.is_ok());
            cx.notify();
        }
        self.receive_sign_in(cx);
        let Ok(result) = self.rx.try_recv() else {
            return;
        };
        self.apply(result, cx);
    }

    fn receive_sign_in(&mut self, cx: &mut Context<Self>) {
        let Some(signing) = self.signing_in.as_mut() else {
            return;
        };
        let mut done = None;
        while let Ok(update) = signing.rx.try_recv() {
            match update {
                SignIn::Progress(step) => signing.step = Some(step),
                SignIn::Done(result) => done = Some(result),
            }
        }
        cx.notify();
        if let Some(result) = done {
            let cancelled = signing.cancel.cancelled();
            self.signing_in = None;
            match result {
                Err(code) if cancelled || code == "OAUTH_CANCELLED" => {}
                result => self.apply(result, cx),
            }
        }
    }

    /// A load, save or removal finished.
    fn apply(&mut self, result: Connections, cx: &mut Context<Self>) {
        self.busy = false;
        self.loaded = true;
        self.connecting = None;
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
                    PageState::Detail(id) if self.items.iter().any(|c| c.id == id) => {
                        self.read_catalog(id);
                    }
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
        self.error_at = ErrorAt::Page;
        self.confirm_remove = false;
        match &page {
            PageState::Edit(id) => {
                let c = self.items.iter().find(|c| &c.id == id).cloned();
                let source = c.as_ref().map(|c| c.source_kind).unwrap_or_default();
                self.load_form(c, source, None, None, cx)
            }
            PageState::Add(source, candidate, preset) => {
                self.load_form(None, *source, candidate.clone(), *preset, cx)
            }
            PageState::Detail(id) => self.read_catalog(id.clone()),
            PageState::List => self.discover(cx),
            PageState::ChooseProvider => {}
        }
        if self.page != page {
            cx.emit(PageChanged);
        }
        self.page = page;
        cx.notify();
    }

    /// Probe local model services (loopback only).
    fn discover(&mut self, cx: &mut Context<Self>) {
        if self.discover_rx.is_none() {
            self.discover_rx = Some(client::discover(self.wake.clone()));
            cx.notify();
        }
    }

    /// `Connect`: bind a discovered service in one step.
    fn quick_connect(
        &mut self,
        candidate: Candidate,
        model: Option<String>,
        cx: &mut Context<Self>,
    ) {
        if self.busy {
            return;
        }
        self.error = None;
        self.error_at = ErrorAt::Local;
        self.connecting = Some(match &model {
            Some(model) => format!("{}#{model}", candidate.endpoint),
            None => candidate.endpoint.clone(),
        });
        self.rx = client::quick_connect(candidate, model, self.wake.clone());
        self.busy = true;
        cx.notify();
    }

    /// A copy button: `copy` and `label`, then `check` and `Copied`
    /// (`ui::copy_feedback`).
    pub(super) fn copy_button(
        &self,
        id: impl Into<ElementId>,
        key: &'static str,
        label: &'static str,
        text: String,
    ) -> Button {
        let copied = crate::ui::copy_feedback::copied(key);
        Button::new(id)
            .icon(crate::ui::components::Icon::copy(key))
            .label(tr(if copied {
                "common.action.copied"
            } else {
                label
            }))
            .on_click(move |_, window, cx| {
                crate::ui::copy_feedback::copy(key, text.clone(), window, cx)
            })
    }

    /// `Start`: launch an installed service the user chose.
    fn start_service(&mut self, driver: Driver, cx: &mut Context<Self>) {
        if self.starting.is_none() {
            self.error = None;
            self.error_at = ErrorAt::Local;
            self.starting = Some((driver, client::start_service(driver, self.wake.clone())));
            cx.notify();
        }
    }

    /// The saved sign-in of `provider`, if any.
    fn signed_in(&self, provider: OauthProvider) -> Option<&ModelConnection> {
        self.items
            .iter()
            .find(|c| c.auth == Auth::Oauth && c.oauth_provider == Some(provider))
    }

    /// `Sign in`: run the provider's sign-in; the browser opens on the
    /// worker. Signing in again keeps the connection and its default model.
    fn sign_in(&mut self, provider: OauthProvider, cx: &mut Context<Self>) {
        if self.busy || self.signing_in.is_some() {
            return;
        }
        self.error = None;
        self.error_at = ErrorAt::Accounts;
        let cancel = client::Cancel::default();
        let existing = self.signed_in(provider).cloned();
        self.signing_in = Some(SigningIn {
            provider,
            rx: client::sign_in(provider, existing, cancel.clone(), self.wake.clone()),
            cancel,
            step: None,
        });
        cx.notify();
    }

    fn cancel_sign_in(&mut self, cx: &mut Context<Self>) {
        if let Some(signing) = self.signing_in.take() {
            signing.cancel.cancel();
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

    /// `catalog?.status ?? "unread"` of connection `id`.
    fn catalog_key(&self, id: &str) -> &'static str {
        match &self.catalog {
            Some((shown, _)) if shown == id && self.catalog_rx.is_some() => "refreshing",
            Some((shown, Ok(_))) if shown == id => "ready",
            Some((shown, Err(_))) if shown == id => "failed",
            _ => "unread",
        }
    }

    fn title(&self) -> String {
        match &self.page {
            PageState::Edit(_) => tr("settings.modelConnections.edit").into(),
            PageState::Add(SourceKind::Api, _, Some(preset)) => registry::get(preset)
                .filter(|p| p.id != "custom")
                .map(|p| p.name.to_owned())
                .unwrap_or_else(|| tr("settings.modelConnections.add").into()),
            PageState::Add(..) => tr("settings.modelConnections.add").into(),
            PageState::ChooseProvider => tr("settings.modelConnections.add.api").into(),
            PageState::Detail(id) => self
                .items
                .iter()
                .find(|c| &c.id == id)
                .map(|c| c.name.clone())
                .unwrap_or_else(|| tr("settings.modelConnections.title").into()),
            PageState::List => tr("settings.modelConnections.title").into(),
        }
    }

    /// The error of `at`, as an inline row of its card.
    fn inline_error(&self, at: ErrorAt, t: theme::Theme) -> Option<AnyElement> {
        let error = self.error.as_ref().filter(|_| self.error_at == at)?;
        Some(
            div()
                .id(match at {
                    ErrorAt::Local => "local-error",
                    _ => "accounts-error",
                })
                .px(px(8.))
                .py(px(6.))
                .text_size(px(theme::ty().ui.caption))
                .line_height(px(16.))
                .text_color(t.danger)
                .child(Self::error_text(error))
                .into_any_element(),
        )
    }

    /// The error line: a known code in words, anything else as the
    /// connection error code.
    fn error_text(code: &str) -> String {
        if let Some(app) = code.strip_prefix("START_IN_APP:") {
            return tf(
                "native.modelConnections.error.startInApp",
                &[("app", app.to_owned().into())],
            );
        }
        let key = match code {
            "OAUTH_DENIED" => "native.modelConnections.error.denied",
            "OAUTH_EXPIRED" | "OAUTH_TIMEOUT" => "native.modelConnections.error.expired",
            "OAUTH_PORT_IN_USE" => "native.modelConnections.error.portInUse",
            "OAUTH_UNAVAILABLE" | "OAUTH_UNREACHABLE" => {
                "native.modelConnections.error.signInUnavailable"
            }
            "OAUTH_INVALID_RESPONSE" | "OAUTH_EXCHANGE_FAILED" | "OAUTH_STATE_MISMATCH" => {
                "native.modelConnections.error.signInFailed"
            }
            "OAUTH_REAUTH_REQUIRED" => "native.modelConnections.error.reauth",
            "NO_USABLE_MODEL" => "native.modelConnections.error.noModel",
            "START_FAILED" => "native.modelConnections.error.startFailed",
            "ENDPOINT_UNAVAILABLE" => "native.modelConnections.error.unreachable",
            "LOCAL_KEY_REQUIRED" => "native.modelConnections.error.localKey",
            _ => {
                return tf(
                    "settings.modelConnections.error",
                    &[("code", code.to_owned().into())],
                );
            }
        };
        tr(key).into()
    }
}

/// A connection's or provider's mark (`ui::provider_marks`).
fn mark(
    provider: Option<&registry::Provider>,
    source: SourceKind,
    size: f32,
    color: Hsla,
) -> AnyElement {
    crate::ui::provider_marks::provider_mark(
        provider.and_then(|p| p.mark.map(|mark| (mark, p.monochrome))),
        source == SourceKind::Local,
        size,
        color,
    )
}

impl Render for ModelConnections {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let back = match &self.page {
            PageState::List => None,
            PageState::Edit(id) => Some(PageState::Detail(id.clone())),
            PageState::Add(SourceKind::Api, None, Some(_)) => Some(PageState::ChooseProvider),
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
        if let Some(error) = self
            .error
            .as_ref()
            .filter(|_| self.error_at == ErrorAt::Page)
        {
            view = view.child(
                div()
                    .id("model-connections-error")
                    .px(px(10.))
                    .text_size(px(theme::ty().ui.meta))
                    .text_color(t.danger)
                    .child(Self::error_text(error)),
            );
        }
        let content = match self.page.clone() {
            PageState::List => self.list(t, cx).into_any_element(),
            PageState::ChooseProvider => self.provider_picker(t, cx).into_any_element(),
            PageState::Detail(id) => self.detail(&id, t, cx).into_any_element(),
            PageState::Edit(_) | PageState::Add(..) => self
                .form(window.viewport_size().width <= px(800.), t, cx)
                .into_any_element(),
        };
        view.child(content)
    }
}

#[cfg(test)]
mod tests;
