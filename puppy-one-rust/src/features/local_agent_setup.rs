//! Port of `local-agents/setup/LocalAgentSetupSection.tsx` (with
//! `useLocalAgentSetup.ts` and `local-agent-setup.css`) and
//! `local-agents/activation` (`LocalAgentActivationStore.ts`,
//! `LocalAgentActivationDialog.tsx`, `local-agent-activation.css`).
//!
//! [`Activation`] is the app's one activation store over
//! `platform::local_agent_setup`; [`SetupSection`] shows it in Settings
//! (suggestion preference, operations, the setup directory) and in the
//! workbench launcher (suggested and running activations only);
//! [`ActivationDialog`] asks for consent, then follows the operation.
use crate::{
    agent::connections::local_agent_inventory,
    features::{
        desktop_agent::ui::agent_brand_mark::{LauncherIdentity, launcher_icon},
        settings::preferences_store::PreferencesStore,
    },
    localization::{t, tf},
    platform::local_agent_setup::{
        self as setup, Entry, Recipe, Surface,
        activation::{self, Action, ErrorCode, Operation, Plan, Snapshot, StepState},
        companion::{self, Presence},
        installer,
    },
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, Dialog, native_checkbox},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
};

/// The product's activation ports: discovery, the managed installer, the
/// browser and an installation rescan.
#[cfg_attr(test, allow(dead_code))]
struct ProductPorts {
    home: PathBuf,
    changed: async_channel::Sender<()>,
}
impl activation::Ports for ProductPorts {
    fn resolve(&self, id: &str) -> Result<bool, ErrorCode> {
        Ok(local_agent_inventory::discover().iter().any(|i| i.id == id))
    }
    fn install(
        &self,
        recipe: &Recipe,
        cancel: &AtomicBool,
        committed: &dyn Fn(),
    ) -> Result<(), ErrorCode> {
        let installer = installer::Installer::new(self.home.clone());
        let verify = |file: &std::path::Path| installer::verify_version(file, &self.home, cancel);
        installer
            .install(recipe, cancel, &verify, committed)
            .map(|_| ())
    }
    fn open_guide(&self, url: &str) -> Result<(), String> {
        crate::platform::desktop::open_url(url)
    }
    fn refresh(&self) {
        let _ = self.changed.try_send(());
    }
}
/// Tests never touch this machine's Agents.
#[cfg(test)]
struct NoPorts;
#[cfg(test)]
impl activation::Ports for NoPorts {
    fn resolve(&self, _: &str) -> Result<bool, ErrorCode> {
        Ok(false)
    }
    fn install(&self, _: &Recipe, _: &AtomicBool, _: &dyn Fn()) -> Result<(), ErrorCode> {
        Err(ErrorCode::Unsupported)
    }
    fn open_guide(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn refresh(&self) {}
}

/// Installations changed because of an activation (rescan the Agents).
pub struct InstallationsChanged;
/// `LocalAgentActivationStore`: the operations of this app, the
/// companion-app evidence and the session's suppressed suggestions.
pub struct Activation {
    service: activation::Service,
    pub snapshot: Snapshot,
    /// `error`: the last read or update failed.
    pub error: bool,
    companions: Option<Vec<(&'static str, Presence)>>,
    scanning: bool,
    /// Reads the companion apps (this machine's, except in tests).
    scanner: fn() -> Vec<(&'static str, Presence)>,
    /// `sessionSuppressed`: suggestions snoozed during this session.
    suppressed: HashSet<String>,
}
impl EventEmitter<InstallationsChanged> for Activation {}
struct Shared(Entity<Activation>);
impl Global for Shared {}

/// The app's store, created on first use.
pub fn store(cx: &mut App) -> Entity<Activation> {
    if let Some(shared) = cx.try_global::<Shared>() {
        return shared.0.clone();
    }
    #[cfg(not(test))]
    return install(
        crate::platform::data_dir().join("local-agent-activation.json"),
        |changed| {
            Arc::new(ProductPorts {
                home: PathBuf::from(std::env::var_os("HOME").unwrap_or_default()),
                changed,
            })
        },
        cx,
    );
    #[cfg(test)]
    install(
        std::env::temp_dir()
            .join(format!("puppyone-activation-test-{}", uuid::Uuid::new_v4()))
            .join("local-agent-activation.json"),
        |_| Arc::new(NoPorts),
        cx,
    )
}
/// Installs the app's store over `ports` (given the rescan sender).
pub(crate) fn install(
    journal: PathBuf,
    ports: impl FnOnce(async_channel::Sender<()>) -> Arc<dyn activation::Ports>,
    cx: &mut App,
) -> Entity<Activation> {
    let (published, snapshots) = async_channel::unbounded::<Snapshot>();
    let (changed, changes) = async_channel::unbounded::<()>();
    let service = activation::Service::new(
        journal,
        ports(changed),
        Arc::new(move |s| {
            let _ = published.try_send(s);
        }),
    );
    let entity = cx.new(|cx| Activation::new(service, cx));
    let weak = entity.downgrade();
    cx.spawn(async move |cx| {
        while let Ok(snapshot) = snapshots.recv().await {
            if weak.update(cx, |s, cx| s.accept(snapshot, cx)).is_err() {
                break;
            }
        }
    })
    .detach();
    let weak = entity.downgrade();
    cx.spawn(async move |cx| {
        while changes.recv().await.is_ok() {
            if weak
                .update(cx, |s, cx| {
                    s.rescan_companions(cx);
                    cx.emit(InstallationsChanged);
                })
                .is_err()
            {
                break;
            }
        }
    })
    .detach();
    cx.set_global(Shared(entity.clone()));
    entity
}
impl Activation {
    fn new(service: activation::Service, cx: &mut Context<Self>) -> Self {
        let mut store = Self {
            service,
            snapshot: Snapshot {
                epoch: "initial".into(),
                revision: 0,
                operations: vec![],
            },
            error: false,
            companions: None,
            scanning: false,
            #[cfg(not(test))]
            scanner: || companion::inspect(&companion::identities()),
            #[cfg(test)]
            scanner: || {
                companion::identities()
                    .into_iter()
                    .map(|(id, _)| (id, Presence::NotFound))
                    .collect()
            },
            suppressed: HashSet::new(),
        };
        store.refresh(cx);
        store
    }
    fn accept(&mut self, snapshot: Snapshot, cx: &mut Context<Self>) {
        if snapshot.epoch == self.snapshot.epoch && snapshot.revision < self.snapshot.revision {
            return;
        }
        self.snapshot = snapshot;
        self.error = false;
        cx.notify();
    }
    /// `refresh`.
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let service = self.service.clone();
        let read = cx.background_spawn(async move { service.read() });
        cx.spawn(async move |this, cx| {
            let result = read.await;
            let _ = this.update(cx, |s, cx| match result {
                Ok(snapshot) => s.accept(snapshot, cx),
                Err(_) => {
                    s.error = true;
                    cx.notify();
                }
            });
        })
        .detach();
    }
    pub fn plan(
        &self,
        owner: String,
        setup_id: String,
        surface: Surface,
        cx: &App,
    ) -> Task<Result<Plan, ErrorCode>> {
        let service = self.service.clone();
        cx.background_spawn(async move { service.plan(&owner, &setup_id, surface) })
    }
    /// `start` / `act`: the result snapshot is accepted; failures are the
    /// caller's to show.
    pub fn start(
        &self,
        owner: String,
        plan_id: String,
        cx: &mut Context<Self>,
    ) -> Task<Result<(), ErrorCode>> {
        let service = self.service.clone();
        self.apply(
            cx.background_spawn(async move { service.start(&owner, &plan_id) }),
            cx,
        )
    }
    pub fn act(
        &self,
        operation_id: String,
        action: Action,
        cx: &mut Context<Self>,
    ) -> Task<Result<(), ErrorCode>> {
        let service = self.service.clone();
        self.apply(
            cx.background_spawn(async move { service.act(&operation_id, action) }),
            cx,
        )
    }
    fn apply(
        &self,
        work: Task<Result<Snapshot, ErrorCode>>,
        cx: &mut Context<Self>,
    ) -> Task<Result<(), ErrorCode>> {
        cx.spawn(async move |this, cx| {
            let snapshot = work.await?;
            let _ = this.update(cx, |s, cx| s.accept(snapshot, cx));
            Ok(())
        })
    }
    /// Companion apps, scanned once until an explicit rescan.
    fn companions(&mut self, cx: &mut Context<Self>) -> Vec<(&'static str, Presence)> {
        if self.companions.is_none() && !self.scanning {
            self.scanning = true;
            let scanner = self.scanner;
            let scan = cx.background_spawn(async move { scanner() });
            cx.spawn(async move |this, cx| {
                let found = scan.await;
                let _ = this.update(cx, |s, cx| {
                    s.scanning = false;
                    s.companions = Some(found);
                    cx.notify();
                });
            })
            .detach();
        }
        self.companions.clone().unwrap_or_default()
    }
    /// Dev-capture: no companion apps instead of this machine's.
    #[cfg(feature = "dev-capture")]
    pub fn lab_fixture(&mut self, cx: &mut Context<Self>) {
        self.companions = Some(
            companion::identities()
                .into_iter()
                .map(|(id, _)| (id, Presence::NotFound))
                .collect(),
        );
        cx.notify();
    }
    /// After an explicit CLI scan the app evidence is read again.
    pub fn rescan_companions(&mut self, cx: &mut Context<Self>) {
        if !self.scanning {
            self.companions = None;
            cx.notify();
        }
    }
    /// The setup entries of one surface (`inspect` → `adviseSetup`).
    pub fn entries(
        &mut self,
        request: &setup::Request,
        found: &[&str],
        cx: &mut Context<Self>,
    ) -> Vec<Entry> {
        let companions = if request.enabled {
            self.companions(cx)
        } else {
            vec![]
        };
        let now = crate::platform::agent_activity::now_millis();
        for (id, until) in request.snoozed_until {
            if *until > now {
                self.suppressed.insert(id.clone());
            }
        }
        setup::advise(
            request,
            setup::platform(),
            found,
            &companions,
            now,
            &self.suppressed,
        )
    }
}

fn agent_icon(id: &str, cx: &App) -> AnyElement {
    let t = cx.palette();
    match local_agent_inventory::runtime_for(id) {
        Some(runtime) => launcher_icon(
            LauncherIdentity::Runtime(runtime),
            false,
            cx.is_dark(),
            t.muted,
        )
        .into_any_element(),
        None => div().size(px(18.)).flex_shrink_0().into_any_element(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presentation {
    Settings,
    Launcher,
}
/// `LocalAgentSetupSection`.
pub struct SetupSection {
    presentation: Presentation,
    surface: Surface,
    eligible: &'static [&'static str],
    preferences: Entity<PreferencesStore>,
    store: Entity<Activation>,
    owner: String,
    /// Detected installation ids; `None` while the first scan runs.
    found: Option<Vec<&'static str>>,
    selected: Option<(String, String)>,
    directory_open: bool,
    action_error: bool,
    dialog: Option<Entity<ActivationDialog>>,
}
impl SetupSection {
    pub fn new(
        presentation: Presentation,
        surface: Surface,
        preferences: Entity<PreferencesStore>,
        owner: String,
        cx: &mut Context<Self>,
    ) -> Self {
        let store = store(cx);
        cx.observe(&store, |_, _, cx| cx.notify()).detach();
        cx.observe(&preferences, |_, _, cx| cx.notify()).detach();
        Self {
            presentation,
            surface,
            eligible: match surface {
                Surface::Chat => &setup::CHAT_IDS,
                Surface::Terminal => &setup::TERMINAL_IDS,
            },
            preferences,
            store,
            owner,
            found: None,
            selected: None,
            directory_open: false,
            action_error: false,
            dialog: None,
        }
    }
    /// The installations the section narrows by (`discovery.ids`).
    pub fn set_found(&mut self, found: Option<Vec<&'static str>>, cx: &mut Context<Self>) {
        if self.found != found {
            self.found = found;
            cx.notify();
        }
    }
    pub fn set_surface(&mut self, surface: Surface, cx: &mut Context<Self>) {
        if self.surface != surface {
            self.surface = surface;
            self.eligible = match surface {
                Surface::Chat => &setup::CHAT_IDS,
                Surface::Terminal => &setup::TERMINAL_IDS,
            };
            cx.notify();
        }
    }
    /// Dev-capture: the directory open and, with `dialog`, Codex selected.
    #[cfg(feature = "dev-capture")]
    pub fn lab_open(&mut self, dialog: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.directory_open = true;
        if dialog {
            self.select("codex", "Codex", window, cx);
        }
        cx.notify();
    }
    /// Whether the launcher shows the section (Settings always does).
    pub fn visible(&mut self, cx: &mut Context<Self>) -> bool {
        if self.presentation == Presentation::Settings {
            return true;
        }
        let (_, pending, rows) = self.model(cx);
        !rows.is_empty()
            || !pending.is_empty()
            || self.selected.is_some()
            || self.store.read(cx).error
            || self.action_error
    }
    /// Entries, operations of eligible Agents not yet discovered, and the
    /// recommended rows.
    fn model(&mut self, cx: &mut Context<Self>) -> (Vec<Entry>, Vec<Operation>, Vec<Entry>) {
        let prefs = self.preferences.read(cx).state.local_agents.clone();
        let suggestions = prefs.setup_suggestions.clone();
        let found = self.found.clone().unwrap_or_default();
        let request = setup::Request {
            surface: self.surface,
            eligible: self.eligible,
            hidden: &prefs.hidden_agent_ids,
            enabled: suggestions.enabled,
            dismissed: &suggestions.dismissed_setup_ids,
            snoozed_until: &suggestions.snoozed_until,
        };
        let entries = self
            .store
            .update(cx, |s, cx| s.entries(&request, &found, cx));
        let operations: Vec<Operation> = self
            .store
            .read(cx)
            .snapshot
            .operations
            .iter()
            .filter(|o| self.eligible.contains(&o.setup_id.as_str()))
            .cloned()
            .collect();
        // Receipts cannot override the installation inventory.
        let pending: Vec<Operation> = operations
            .into_iter()
            .filter(|o| {
                o.status != activation::Status::Ready && !found.contains(&o.setup_id.as_str())
            })
            .collect();
        let rows: Vec<Entry> = entries
            .iter()
            .filter(|e| {
                !pending.iter().any(|o| o.setup_id == e.setup_id)
                    && e.recommended
                    && !found.contains(&e.setup_id)
            })
            .cloned()
            .collect();
        (entries, pending, rows)
    }
    fn select(&mut self, id: &str, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.selected = Some((id.into(), name.into()));
        let operation = self
            .store
            .read(cx)
            .snapshot
            .operations
            .iter()
            .any(|o| o.setup_id == id);
        let (surface, owner) = (self.surface, self.owner.clone());
        let section = cx.weak_entity();
        let (id, name) = (id.to_owned(), name.to_owned());
        self.dialog = Some(cx.new(|cx| {
            ActivationDialog::new(id, name, surface, owner, !operation, section, window, cx)
        }));
        cx.notify();
    }
    /// `close`.
    fn close(&mut self, cx: &mut Context<Self>) {
        self.selected = None;
        self.dialog = None;
        cx.notify();
    }
    fn change_suggestions(
        &self,
        change: impl FnOnce(&mut crate::features::settings::preference_types::SetupSuggestions),
        cx: &mut Context<Self>,
    ) {
        self.preferences.update(cx, |p, cx| {
            p.change(|p| change(&mut p.local_agents.setup_suggestions), cx)
        });
    }
    /// `.local-agent-setup button`: a quiet, start-aligned text button.
    fn text_button(
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        cx: &App,
    ) -> Stateful<Div> {
        let t = cx.palette();
        div()
            .id(id)
            .flex_shrink_0()
            .px(px(8.))
            .py(px(4.))
            .border_1()
            .border_color(theme::alpha(t.border, 0.))
            .rounded(px(5.))
            .text_color(t.text)
            .cursor(theme::clickable_cursor())
            .hover(move |s| s.bg(t.hover))
            .child(label.into())
    }
}
impl Render for SetupSection {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let m = theme::ty();
        let settings = self.presentation == Presentation::Settings;
        let (entries, pending, rows) = self.model(cx);
        let error = self.store.read(cx).error || self.action_error;
        if !settings && rows.is_empty() && pending.is_empty() && self.selected.is_none() && !error {
            return div().into_any_element();
        }
        let suggestions = self
            .preferences
            .read(cx)
            .state
            .local_agents
            .setup_suggestions
            .clone();
        let caption = m.ui.caption;
        let mut section = v_flex()
            .id("local-agent-setup")
            .w_full()
            .min_w_0()
            .when(settings, |d| d.gap(px(10.)).mt(px(4.)))
            .text_color(t.muted)
            .text_size(px(caption))
            .line_height(px(caption * 1.5));
        if settings {
            let on = suggestions.enabled;
            let toggle = h_flex()
                .id("agent-setup-suggestions")
                .items_start()
                .gap(px(8.))
                .cursor(theme::clickable_cursor())
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
                        .child(t_static("settings.agentSetup.suggestions")),
                )
                .on_click(
                    cx.listener(move |s, _, _, cx| s.change_suggestions(|p| p.enabled = !on, cx)),
                );
            section = section.child(v_flex().gap(px(10.)).child(toggle).when(
                !suggestions.dismissed_setup_ids.is_empty(),
                |d| {
                    d.child(
                        Self::text_button(
                            "agent-setup-restore",
                            t_static("settings.agentSetup.restore"),
                            cx,
                        )
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.change_suggestions(|p| p.dismissed_setup_ids.clear(), cx)
                        })),
                    )
                },
            ));
        }
        let mut ids: Vec<String> = entries.iter().map(|e| e.setup_id.to_owned()).collect();
        for op in &pending {
            if !ids.contains(&op.setup_id) {
                ids.push(op.setup_id.clone());
            }
        }
        // `.local-agent-setup-row`.
        let row = || {
            h_flex()
                .w_full()
                .min_w_0()
                .min_h(px(theme::control_large()))
                .gap(px(9.))
                .px(px(8.))
                .py(px(5.))
                .border_1()
                .border_color(theme::alpha(t.border, 0.))
                .text_size(px(m.right.content))
                .font_weight(FontWeight::NORMAL)
                .line_height(px(m.right.control_line_height))
        };
        let small_button = |id: ElementId, label: SharedString, disabled: bool| {
            div()
                .id(id)
                .flex_shrink_0()
                .px(px(4.))
                .py(px(2.))
                .rounded(px(5.))
                .text_size(px(m.right.caption))
                .text_color(t.text)
                .when(disabled, |d| d.opacity(0.5))
                .when(!disabled, |d| {
                    d.cursor(theme::clickable_cursor())
                        .hover(move |s| s.bg(t.hover))
                })
                .child(label)
        };
        for (index, id) in ids.iter().enumerate() {
            if let Some(op) = pending.iter().find(|o| &o.setup_id == id) {
                let active = op.status.active();
                let mut status = String::new();
                if active {
                    status.push_str(&format!("{}/{} · ", op.current_step(), op.steps.len()));
                }
                status.push_str(t_static(&format!(
                    "settings.activation.status.{}",
                    op.status.key()
                )));
                let (view_id, view_name) = (op.setup_id.clone(), op.display_name.clone());
                let stop_id = op.operation_id.clone();
                section = section.child(
                    row()
                        .child(agent_icon(&op.setup_id, cx))
                        .child(
                            v_flex()
                                .flex_1()
                                .min_w_0()
                                .text_color(t.muted)
                                .child(op.display_name.clone())
                                .child(
                                    div()
                                        .text_size(px(m.right.caption))
                                        .line_height(px(m.right.caption * 1.25))
                                        .child(status),
                                ),
                        )
                        .child(
                            h_flex()
                                .gap(px(4.))
                                .child(
                                    small_button(
                                        ("agent-setup-view", index).into(),
                                        t_static("settings.activation.view").into(),
                                        false,
                                    )
                                    .on_click(cx.listener(
                                        move |s, _, w, cx| s.select(&view_id, &view_name, w, cx),
                                    )),
                                )
                                .when(active, |d| {
                                    let cancelling = op.status == activation::Status::Cancelling;
                                    d.child(
                                        small_button(
                                            ("agent-setup-stop", index).into(),
                                            t_static("settings.activation.stop").into(),
                                            cancelling,
                                        )
                                        .when(
                                            !cancelling,
                                            |b| {
                                                b.on_click(cx.listener(move |s, _, _, cx| {
                                                    s.action_error = false;
                                                    let task = s.store.update(cx, |store, cx| {
                                                        store.act(
                                                            stop_id.clone(),
                                                            Action::Cancel,
                                                            cx,
                                                        )
                                                    });
                                                    cx.spawn(async move |this, cx| {
                                                        if task.await.is_err() {
                                                            let _ = this.update(cx, |s, cx| {
                                                                s.action_error = true;
                                                                cx.notify();
                                                            });
                                                        }
                                                    })
                                                    .detach();
                                                }))
                                            },
                                        ),
                                    )
                                }),
                        )
                        .into_any_element(),
                );
                continue;
            }
            let Some(entry) = rows.iter().find(|e| e.setup_id == id) else {
                continue;
            };
            let (setup_id, name) = (entry.setup_id, entry.display_name);
            section = section.child(
                row()
                    .child(agent_icon(setup_id, cx))
                    .child(div().flex_1().min_w_0().text_color(t.muted).child(name))
                    .child(
                        small_button(
                            ("agent-setup-activate", index).into(),
                            t_static("settings.activation.activate").into(),
                            false,
                        )
                        .ml_auto()
                        .on_click(cx.listener(move |s, _, w, cx| s.select(setup_id, name, w, cx))),
                    )
                    .into_any_element(),
            );
        }
        if error {
            section = section.child(
                h_flex()
                    .flex_wrap()
                    .gap(px(4.))
                    .child(t_static("settings.activation.requestFailed"))
                    .child(
                        Self::text_button(
                            "agent-setup-refresh",
                            t_static("settings.activation.refresh"),
                            cx,
                        )
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.action_error = false;
                            s.store.update(cx, |store, cx| store.refresh(cx));
                        })),
                    ),
            );
        }
        if settings {
            let open = self.directory_open;
            section = section.child(
                Self::text_button(
                    "agent-setup-directory",
                    t_static("settings.agentSetup.title"),
                    cx,
                )
                .on_click(cx.listener(move |s, _, _, cx| {
                    s.directory_open = !open;
                    cx.notify();
                })),
            );
            if open {
                section = section.child(h_flex().flex_wrap().gap(px(6.)).children(
                    entries.iter().enumerate().map(|(i, e)| {
                        let (id, name) = (e.setup_id, e.display_name);
                        Self::text_button(("agent-setup-entry", i), name, cx)
                            .on_click(cx.listener(move |s, _, w, cx| s.select(id, name, w, cx)))
                            .into_any_element()
                    }),
                ));
            }
        }
        if let Some(dialog) = &self.dialog {
            section = section.child(dialog.clone());
        }
        section.into_any_element()
    }
}
fn t_static(key: &str) -> &'static str {
    t(key)
}

/// `LocalAgentActivationDialog`.
pub struct ActivationDialog {
    setup_id: String,
    display_name: String,
    surface: Surface,
    owner: String,
    plan: Option<Plan>,
    plan_revision: u64,
    error: bool,
    busy: bool,
    confirming: bool,
    details_open: bool,
    section: WeakEntity<SetupSection>,
    focus: FocusHandle,
}
impl ActivationDialog {
    #[allow(clippy::too_many_arguments)]
    fn new(
        setup_id: String,
        display_name: String,
        surface: Surface,
        owner: String,
        confirming: bool,
        section: WeakEntity<SetupSection>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let store = store(cx);
        cx.observe(&store, |_, _, cx| cx.notify()).detach();
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        let mut dialog = Self {
            setup_id,
            display_name,
            surface,
            owner,
            plan: None,
            plan_revision: 0,
            error: false,
            busy: false,
            confirming,
            details_open: false,
            section,
            focus,
        };
        if confirming {
            dialog.request_plan(cx);
        }
        dialog
    }
    fn request_plan(&mut self, cx: &mut Context<Self>) {
        self.plan = None;
        self.error = false;
        self.plan_revision += 1;
        let revision = self.plan_revision;
        let task =
            store(cx)
                .read(cx)
                .plan(self.owner.clone(), self.setup_id.clone(), self.surface, cx);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.plan_revision != revision || !s.confirming {
                    return;
                }
                match result {
                    Ok(plan) => s.plan = Some(plan),
                    Err(_) => s.error = true,
                }
                cx.notify();
            });
        })
        .detach();
    }
    fn operation(&self, cx: &App) -> Option<Operation> {
        store_ref(cx)?
            .read(cx)
            .snapshot
            .operations
            .iter()
            .find(|o| o.setup_id == self.setup_id)
            .cloned()
    }
    /// `perform`: one request at a time; a failure shows the alert.
    fn perform(
        &mut self,
        work: impl FnOnce(&mut Activation, &mut Context<Activation>) -> Task<Result<(), ErrorCode>>,
        after: impl FnOnce(&mut Self, &mut Window, &mut Context<Self>) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.error = false;
        self.busy = true;
        let task = store(cx).update(cx, work);
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |s, window, cx| {
                s.busy = false;
                match result {
                    Ok(()) => after(s, window, cx),
                    Err(_) => s.error = true,
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    /// Install and activate / Continue setup.
    fn start(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(plan) = self.plan.clone().filter(|_| !self.busy) else {
            return;
        };
        let owner = self.owner.clone();
        self.perform(
            move |store, cx| store.start(owner, plan.plan_id, cx),
            |s, _, _| s.confirming = false,
            window,
            cx,
        );
    }
    fn act(&mut self, action: Action, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(op) = self.operation(cx) {
            let id = op.operation_id.clone();
            self.perform(move |s, cx| s.act(id, action, cx), |_, _, _| {}, window, cx);
        }
    }
    fn close(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let section = self.section.clone();
        window.defer(cx, move |_, cx| {
            let _ = section.update(cx, |s, cx| s.close(cx));
        });
    }
}
fn store_ref(cx: &App) -> Option<Entity<Activation>> {
    cx.try_global::<Shared>().map(|s| s.0.clone())
}
impl Render for ActivationDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let m = theme::ty();
        let operation = self.operation(cx);
        let active = operation.as_ref().is_some_and(|o| o.status.active());
        let guided = self.plan.as_ref().is_some_and(|p| !p.automatic);
        let title = tf(
            "settings.agentSetup.activate",
            &[("agent", self.display_name.clone().into())],
        );
        // `.local-agent-activation-title`.
        let heading = h_flex()
            .min_w_0()
            .gap(px(10.))
            .child(agent_icon(&self.setup_id, cx))
            .child(
                div()
                    .min_w_0()
                    .text_size(px(m.ui.body_large))
                    // Geist's normal line height (hhea 1005 + 295).
                    .line_height(px(m.ui.body_large * 1.3))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .child(title),
            );
        // `.local-agent-activation-note`: caption type on the body's 1.6.
        let note = |text: SharedString| {
            div()
                .text_color(t.muted)
                .text_size(px(m.ui.caption))
                .line_height(px(m.ui.caption * 1.6))
                .child(text)
        };
        let agent = [("agent", self.display_name.clone().into())];
        // `.local-agent-activation-steps`: numbered while confirming, then
        // each step's state in its circle.
        let steps = |states: Option<[StepState; 3]>| {
            v_flex().children(activation::STEPS.iter().enumerate().map(|(i, id)| {
                let label = t_static(&format!("settings.activation.step.{id}"));
                match states {
                    None => h_flex()
                        .py(px(6.))
                        .child(
                            div()
                                .w(px(24.))
                                .flex()
                                .justify_end()
                                .pr(px(4.))
                                .child(format!("{}.", i + 1)),
                        )
                        .child(label)
                        .into_any_element(),
                    Some(states) => {
                        let state = states[i];
                        h_flex()
                            .py(px(6.))
                            .gap(px(10.))
                            .text_color(if state == StepState::Running {
                                t.text
                            } else {
                                t.muted
                            })
                            .child(
                                div()
                                    .flex()
                                    .flex_shrink_0()
                                    .size(px(24.))
                                    .items_center()
                                    .justify_center()
                                    .border_1()
                                    .border_color(t.border)
                                    .rounded_full()
                                    .text_size(px(m.ui.caption))
                                    .child(if state.done() {
                                        "✓".to_owned()
                                    } else {
                                        (i + 1).to_string()
                                    }),
                            )
                            .child(label)
                            .into_any_element()
                    }
                }
            }))
        };
        let mut body = v_flex()
            .gap(px(16.))
            .text_size(px(m.ui.meta))
            .line_height(px(m.ui.meta * 1.6));
        if self.confirming {
            body = body
                .child(div().child(tf(
                    if guided {
                        "settings.activation.guided"
                    } else {
                        "settings.activation.consent"
                    },
                    &agent,
                )))
                .child(steps(None))
                .child(note(t_static("settings.activation.control").into()));
            if let Some(plan) = self.plan.as_ref().filter(|p| p.automatic) {
                let open = self.details_open;
                body = body.child(
                    v_flex()
                        .text_color(t.muted)
                        .text_size(px(m.ui.caption))
                        .line_height(px(m.ui.caption * 1.6))
                        .child(
                            h_flex()
                                .id("activation-details")
                                .gap(px(4.5))
                                .cursor(theme::clickable_cursor())
                                .child(
                                    // Chromium's `<summary>` marker.
                                    svg()
                                        .path(if open {
                                            "icons/details-open.svg"
                                        } else {
                                            "icons/details-closed.svg"
                                        })
                                        .w(px(if open { 8. } else { 7. }))
                                        .h(px(if open { 7. } else { 8. }))
                                        .text_color(t.muted),
                                )
                                .child(t_static("settings.activation.details"))
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.details_open = !open;
                                    cx.notify();
                                })),
                        )
                        .when(open, |d| {
                            d.child(format!(
                                "{} · {}",
                                plan.publisher,
                                plan.version.unwrap_or("")
                            ))
                            .child(t_static("settings.activation.location"))
                        }),
                );
            }
            if self.setup_id == "claude" && self.surface == Surface::Chat {
                body = body.child(note(t_static("settings.agentSetup.claude").into()));
            }
        } else if let Some(op) = &operation {
            body = body
                .child(steps(Some(op.steps)))
                .child(div().child(t_static(&format!(
                    "settings.activation.status.{}",
                    op.status.key()
                ))));
            if let (Some(code), activation::Status::Failed) = (op.error, op.status) {
                body = body.child(
                    div()
                        .text_color(t.danger)
                        .text_size(px(m.ui.meta))
                        .line_height(px(18.))
                        .child(t_static(&format!(
                            "settings.activation.error.{}",
                            code.key()
                        ))),
                );
            }
            if op.installed
                && matches!(
                    op.status,
                    activation::Status::Cancelled
                        | activation::Status::Failed
                        | activation::Status::Interrupted
                )
            {
                body = body.child(note(t_static("settings.activation.retained").into()));
            }
        }
        if self.error {
            body = body.child(
                v_flex()
                    .gap(px(8.))
                    .child(
                        div()
                            .text_color(t.danger)
                            .text_size(px(m.ui.meta))
                            .line_height(px(18.))
                            .child(t_static("settings.activation.requestFailed")),
                    )
                    .child(
                        div().child(
                            Button::new("activation-refresh")
                                .variant(ButtonVariant::Secondary)
                                .label(t_static("settings.activation.refresh"))
                                .on_click(cx.listener(|s, _, w, cx| {
                                    if s.confirming {
                                        s.request_plan(cx);
                                    } else {
                                        s.perform(
                                            |store, cx| {
                                                store.refresh(cx);
                                                Task::ready(Ok(()))
                                            },
                                            |_, _, _| {},
                                            w,
                                            cx,
                                        );
                                    }
                                })),
                        ),
                    ),
            );
        }
        let close = cx.weak_entity();
        let mut dialog = Dialog::new("local-agent-activation")
            .width(420.)
            .heading(heading)
            .focus_handle(self.focus.clone())
            .on_close(move |window, cx| {
                let _ = close.update(cx, |s, cx| s.close(window, cx));
            })
            .child(body);
        if self.confirming {
            let ready = self.plan.is_some() && !self.busy;
            dialog = dialog
                .footer(
                    Button::new("activation-cancel")
                        .variant(ButtonVariant::Secondary)
                        .label(t_static("common.action.cancel"))
                        .on_click(cx.listener(|s, _, w, cx| s.close(w, cx))),
                )
                .footer(
                    Button::new("activation-start")
                        .variant(ButtonVariant::Solid)
                        .label(t_static(if guided {
                            "settings.activation.beginGuided"
                        } else {
                            "settings.activation.start"
                        }))
                        .disabled(!ready)
                        .on_click(cx.listener(|s, _, w, cx| s.start(w, cx))),
                );
        } else if let Some(op) = &operation {
            if active {
                let cancelling = op.status == activation::Status::Cancelling;
                dialog = dialog.footer(
                    Button::new("activation-stop")
                        .variant(ButtonVariant::Secondary)
                        .label(t_static("settings.activation.cancel"))
                        .disabled(cancelling)
                        .on_click(cx.listener(|s, _, w, cx| s.act(Action::Cancel, w, cx))),
                );
            }
            if !active && op.status != activation::Status::Ready {
                dialog = dialog.footer(
                    Button::new("activation-retry")
                        .variant(ButtonVariant::Secondary)
                        .label(t_static("settings.activation.retry"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.confirming = true;
                            s.request_plan(cx);
                        })),
                );
            }
            if op.status == activation::Status::SetupRequired {
                dialog = dialog
                    .footer(
                        Button::new("activation-guide")
                            .variant(ButtonVariant::Secondary)
                            .label(t_static("settings.agentSetup.guide"))
                            .disabled(self.busy)
                            .on_click(cx.listener(|s, _, w, cx| s.act(Action::Guide, w, cx))),
                    )
                    .footer(
                        Button::new("activation-check")
                            .variant(ButtonVariant::Solid)
                            .label(t_static("settings.activation.check"))
                            .disabled(self.busy)
                            .on_click(cx.listener(|s, _, w, cx| s.act(Action::Check, w, cx))),
                    );
            }
            let id = op.operation_id.clone();
            dialog = dialog.footer(
                Button::new("activation-close")
                    .variant(ButtonVariant::Secondary)
                    .label(t_static(if active {
                        "settings.activation.background"
                    } else {
                        "common.action.close"
                    }))
                    .on_click(cx.listener(move |s, _, w, cx| {
                        if active {
                            s.close(w, cx);
                        } else {
                            let id = id.clone();
                            s.perform(
                                move |store, cx| store.act(id, Action::Dismiss, cx),
                                |s, w, cx| s.close(w, cx),
                                w,
                                cx,
                            );
                        }
                    })),
            );
        }
        dialog
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::sync::Mutex;
    #[derive(Default)]
    struct Fake {
        found: Mutex<Vec<String>>,
    }
    impl activation::Ports for Fake {
        fn resolve(&self, id: &str) -> Result<bool, ErrorCode> {
            Ok(self.found.lock().unwrap().iter().any(|f| f == id))
        }
        fn install(
            &self,
            recipe: &Recipe,
            _: &AtomicBool,
            committed: &dyn Fn(),
        ) -> Result<(), ErrorCode> {
            self.found.lock().unwrap().push(recipe.setup_id.into());
            committed();
            Ok(())
        }
        fn open_guide(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        fn refresh(&self) {}
    }
    fn until(cx: &mut VisualTestContext, mut done: impl FnMut(&mut VisualTestContext) -> bool) {
        for _ in 0..400 {
            cx.run_until_parked();
            if done(cx) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        panic!("condition not reached");
    }
    #[gpui::test]
    fn the_setup_directory_activates_an_agent_from_its_recipe(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let dir = tempfile::tempdir().unwrap();
        let journal = dir.path().join("local-agent-activation.json");
        let store = cx.update(|cx| install(journal, |_| Arc::new(Fake::default()), cx));
        cx.update(|cx| cx.set_global(Shared(store.clone())));
        let preferences = cx.new(|_| PreferencesStore::memory());
        let (section, cx) = cx.add_window_view(|_, cx| {
            SetupSection::new(
                Presentation::Settings,
                Surface::Chat,
                preferences.clone(),
                "w".into(),
                cx,
            )
        });
        section.update(cx, |s, cx| s.set_found(Some(vec!["claude"]), cx));
        // Settings lists every Chat route of this platform.
        let entries = section.update(cx, |s, cx| s.model(cx).0);
        assert_eq!(entries.len(), if cfg!(target_os = "macos") { 8 } else { 6 });
        assert!(entries.iter().all(|e| !e.recommended));
        section.update_in(cx, |s, w, cx| s.select("codex", "Codex", w, cx));
        let dialog = section.read_with(cx, |s, _| s.dialog.clone().unwrap());
        until(cx, |cx| {
            dialog.read_with(cx, |d, _| d.plan.is_some() || d.error)
        });
        let automatic = dialog.read_with(cx, |d, _| d.plan.as_ref().unwrap().automatic);
        assert_eq!(automatic, cfg!(target_os = "macos"));
        if !automatic {
            return;
        }
        dialog.update_in(cx, |d, w, cx| d.start(w, cx));
        until(cx, |cx| {
            dialog.read_with(cx, |d, cx| {
                !d.confirming
                    && d.operation(cx)
                        .is_some_and(|o| o.status == activation::Status::Ready)
            })
        });
        let op = dialog.read_with(cx, |d, cx| d.operation(cx).unwrap());
        assert_eq!(op.steps, [StepState::Complete; 3]);
        // A ready Agent is no longer pending in the section.
        section.update(cx, |s, cx| s.set_found(Some(vec!["claude", "codex"]), cx));
        assert!(section.update(cx, |s, cx| s.model(cx).1.is_empty()));
        // Close dismisses the finished operation.
        dialog.update_in(cx, |d, w, cx| {
            d.perform(
                move |store, cx| store.act(op.operation_id.clone(), Action::Dismiss, cx),
                |d, w, cx| d.close(w, cx),
                w,
                cx,
            )
        });
        until(cx, |cx| section.read_with(cx, |s, _| s.dialog.is_none()));
        assert!(store.read_with(cx, |s, _| s.snapshot.operations.is_empty()));
    }
}
