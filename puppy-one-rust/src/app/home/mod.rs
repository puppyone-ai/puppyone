//! The Homepage (`MinimalOnboarding.tsx` and `components/onboarding/*`):
//! shown when no project is open and from the Header project menu's Home item.
//!
//! Architecture & component boundaries:
//! - `components` — Pure `RenderOnce` UI components (`OnboardingHomeLayout`,
//!   `OnboardingBrandLockup`, `OnboardingStartActions`, `OnboardingEntryActions`,
//!   `HomepageAgentBrandMark`, `SpaceAgents`, `OnboardingErrorBanner`,
//!   `OnboardingTelemetryDisclosure`)
//! - `discovery` — Background preview & Local/Cloud Agent discovery (`HomeDiscovery`)
//! - `hydration` — Activity hydration, spaces/hosts sync, first-paint & list hold
//! - `display` — Display names, compact workspace paths, and relative timestamps
//! - `folder` — `ProjectFolderGlyph` (`104 × 78` Grid / `34 × 26` List) and blank sheets
//! - `projects` — toolbar menus, audience groups, Grid tiles & List rows
//! - `create_project`, `agent_start`, `import_sources`, `import_repository`,
//!   `template_import`, `project_entry` — Entry dialogs
use super::{
    Command, at,
    dialogs::{DialogKey, DialogLayer},
    project_actions::ProjectActions,
    session::SessionView,
};
use crate::features::cloud::{CloudCatalog, CloudSpaces, SpacesStatus};
use crate::features::settings::{PreferencesStore, RecentProject};
use crate::geometry::Rect;
use crate::localization::t as tr;
use crate::localization::tf;
use crate::platform::project_activity;
use crate::theme;
use crate::theme::Theme;
use crate::theme::metric;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Button;
use crate::ui::components::ButtonVariant;
use crate::ui::components::Icon;
use crate::ui::components::IconButton;
use crate::ui::components::Menu;
use crate::ui::components::MenuItem;
use crate::ui::components::PopoverMenu;
use crate::ui::components::ProductIcon;
use crate::workspace::cloud::{
    catalog::{self, Item},
    locator::{self, Locator},
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub(in crate::app) mod agent_start;
mod components;
pub(in crate::app) mod create_project;
pub(in crate::app) mod discovery;
mod display;
mod first_run;
pub(in crate::app) mod folder;
mod folder_status;
pub(in crate::app) mod groups;
mod hydration;
mod import_repository;
pub(in crate::app) mod import_sources;
mod intro;
pub(in crate::app) mod previews;
pub(in crate::app) mod project_entry;
mod projects;
mod template_import;
mod value;

use components::{
    OnboardingBrandLockup, OnboardingCreateProjectAction, OnboardingEntryActions,
    OnboardingHomeLayout, OnboardingHomeState, OnboardingStartActions,
};
pub(super) use create_project::CreateProject;
pub(in crate::app) use display::{compact_display_path, item_name_or, path_for_display};
pub(super) use import_repository::ImportRepository;
pub(in crate::app) use projects::HomeMenu;
use projects::SpacesUnavailableNote;
pub(super) use template_import::TemplateImport;

/// What the Homepage asks of the window.
pub(in crate::app) enum HomeEvent {
    OpenProject(PathBuf),
    OpenImported {
        path: PathBuf,
        attempt: std::sync::Arc<std::sync::atomic::AtomicBool>,
    },
    OpenCloud(String),
    OpenDevice(crate::workspace::cloud::catalog::RemoteFolder, String),
    OpenCreated {
        path: PathBuf,
        open: Option<PathBuf>,
        new_window: bool,
    },
    OpenAgentCreated {
        path: PathBuf,
        runtime_id: String,
        prompt: String,
    },
    PublishToSpace {
        path: PathBuf,
        space: String,
    },
    ShareFolder {
        path: PathBuf,
    },
    ManageSpace(String),
    OpenSettings(crate::features::settings::Page),
    WindowFolder,
    Command(Command),
}

/// Composition root for Home (`MinimalOnboarding` and its stores).
pub(in crate::app) struct Homepage {
    session: SessionView,
    preferences: Entity<PreferencesStore>,
    catalog: Entity<CloudCatalog>,
    pub(in crate::app) spaces: Entity<CloudSpaces>,
    pub(in crate::app) hosts: Entity<crate::features::hosts::HostCatalog>,
    actions: Entity<ProjectActions>,
    dialogs: WeakEntity<DialogLayer>,
    dialog_focus: FocusHandle,
    window_focus: FocusHandle,
    weak: WeakEntity<Self>,
    pub scroll: ScrollHandle,
    activity: HashMap<PathBuf, Option<SystemTime>>,
    locators: HashMap<PathBuf, Option<Locator>>,
    read_for: Option<Vec<PathBuf>>,
    shown: bool,
    pub reading: bool,
    first_paint: Option<Instant>,
    released_for: Option<Option<String>>,
    pub list_held_since: Option<Instant>,
    pub place_focus: Option<(groups::GroupId, Instant, Option<Instant>)>,
    pub drop_over: Option<groups::GroupId>,
    pub(in crate::app::home) spaces_wait: Option<Instant>,
    pub(in crate::app) shared_ids: Option<std::collections::HashSet<String>>,
    pub(in crate::app) local_share: bool,
    pub(in crate::app) other_computers: Vec<String>,
    presence: Option<(String, bool)>,
    shown_dates: HashMap<String, i64>,
    pub menu: Option<HomeMenu>,
    pub stop: Option<String>,
    pub focus: HashMap<String, FocusHandle>,
    pub action_bounds: HashMap<String, std::rc::Rc<std::cell::Cell<Bounds<Pixels>>>>,
    pub hovered: Option<String>,
    /// Asset previews and Local/Cloud Agent discovery state.
    pub(in crate::app) discovery: discovery::HomeDiscovery,
    pub dragging: bool,
    pub dragging_path: Option<String>,
    pub error: Option<String>,
    pub(in crate::app) intro: Option<crate::ui::motion::Timeline>,
    moments: crate::ui::moments::Carousel,
    moments_hovered: bool,
    intro_empty: Option<bool>,
    pub(in crate::app) disclosure_shown: bool,
    pub(in crate::app) create: Option<CreateProject>,
    pub(in crate::app) agent_start: Option<agent_start::AgentStart>,
    pub(in crate::app) template: Option<Box<TemplateImport>>,
    pub(in crate::app) import: Option<ImportRepository>,
    pub(in crate::app) import_picker: Option<import_sources::ImportPicker>,
    pub(in crate::app) app_places: Option<crate::platform::app_folders::Places>,
    pub(in crate::app) unavailable: HashMap<PathBuf, folder_status::FolderStatus>,
    pub(in crate::app) window_folder: Option<(PathBuf, folder_status::FolderStatus)>,
    read_failed: Option<String>,
    pub(in crate::app) folder_question: Option<folder_status::FolderQuestion>,
    folder_error: Option<String>,
    folder_busy: bool,
}

impl EventEmitter<HomeEvent> for Homepage {}

impl Homepage {
    pub fn new(
        preferences: Entity<PreferencesStore>,
        catalog: Entity<CloudCatalog>,
        actions: Entity<ProjectActions>,
        dialogs: &Entity<DialogLayer>,
        window_focus: FocusHandle,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.observe(&preferences, |h, _, cx| h.refresh(cx)).detach();
        cx.observe(&catalog, |h, _, cx| h.refresh(cx)).detach();
        let spaces = crate::features::cloud::global_spaces(cx);
        cx.observe(&spaces, |h, _, cx| h.refresh(cx)).detach();
        let hosts = crate::features::hosts::global(cx);
        cx.observe(&hosts, |h, _, cx| h.refresh(cx)).detach();
        let link = crate::features::hosts::host_link(cx);
        cx.observe(&link, |h, _, cx| h.refresh(cx)).detach();
        let installations = crate::features::local_agents::installation_store(cx);
        cx.observe(&installations, |h, _, cx| {
            h.sync_local_agent_installations(cx)
        })
        .detach();
        cx.observe_window_activation(window, |h, window, cx| {
            if !window.is_window_active() {
                return;
            }
            if !h.session.restoring {
                h.read_spaces(true, cx);
            }
            if h.session.home {
                h.read_hosts(true, cx);
                h.refresh_local_agents(true, cx);
                h.refresh_cloud_home_details(true, cx);
            }
            h.read_for = None;
            h.refresh_activity(cx);
            h.check_window_folder(cx);
        })
        .detach();
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(crate::features::hosts::REFRESH)
                    .await;
                if this.update(cx, |h, cx| h.read_hosts(false, cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        cx.observe(&actions, |_, _, cx| cx.notify()).detach();
        crate::features::cloud::account::observe(window, cx, |h, _, cx| h.refresh(cx)).detach();
        if cfg!(debug_assertions) {
            let home = cx.weak_entity();
            let own = window.window_handle();
            cx.intercept_keystrokes(move |event, window, cx| {
                let k = &event.keystroke;
                if window.window_handle() != own
                    || !k.key.eq_ignore_ascii_case("l")
                    || !k.modifiers.alt
                    || !k.modifiers.shift
                    || k.modifiers.platform
                    || k.modifiers.control
                {
                    return;
                }
                let _ = home.update(cx, |h, cx| {
                    if h.replay_intro(cx) {
                        cx.stop_propagation();
                    }
                });
            })
            .detach();
        }
        if let Some(telemetry) = crate::features::telemetry::global(cx) {
            cx.observe(&telemetry, |_, _, cx| cx.notify()).detach();
        }
        Self {
            session: SessionView::default(),
            preferences,
            catalog,
            spaces,
            hosts,
            actions,
            dialogs: dialogs.downgrade(),
            dialog_focus: dialogs.read(cx).focus_handle().clone(),
            window_focus,
            weak: cx.weak_entity(),
            scroll: ScrollHandle::default(),
            activity: HashMap::new(),
            locators: HashMap::new(),
            read_for: None,
            shown: false,
            reading: false,
            first_paint: None,
            released_for: None,
            list_held_since: None,
            place_focus: None,
            drop_over: None,
            spaces_wait: None,
            shared_ids: None,
            local_share: false,
            other_computers: vec![],
            presence: None,
            shown_dates: HashMap::new(),
            menu: None,
            stop: None,
            focus: HashMap::new(),
            action_bounds: HashMap::new(),
            hovered: None,
            discovery: discovery::HomeDiscovery::default(),
            dragging: false,
            dragging_path: None,
            error: None,
            intro: None,
            moments: value::carousel(),
            moments_hovered: false,
            intro_empty: None,
            disclosure_shown: false,
            create: None,
            agent_start: None,
            template: None,
            import: None,
            import_picker: None,
            app_places: None,
            unavailable: HashMap::new(),
            window_folder: None,
            read_failed: None,
            folder_question: None,
            folder_error: None,
            folder_busy: false,
        }
    }

    pub fn set_session(&mut self, session: SessionView, cx: &mut Context<Self>) {
        if self.session != session {
            let root_changed =
                self.session.root != session.root || self.session.home != session.home;
            self.session = session;
            if root_changed {
                self.check_window_folder(cx);
            }
            self.refresh(cx);
        }
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.sync_import_sources(cx);
        self.read_spaces(false, cx);
        self.read_hosts(false, cx);
        self.sync_sharing(cx);
        self.refresh_activity(cx);
        self.refresh_local_agents(false, cx);
        self.refresh_cloud_home_details(false, cx);
        self.sync_project_view(cx);
        self.sync_first_run(cx);
        self.sync_intro(cx);
        if self.session.home && self.released_for != Some(self.first_paint_account(cx)) {
            self.first_paint.get_or_insert_with(Instant::now);
        }
        cx.notify();
    }

    pub fn list_held(&self) -> bool {
        self.list_held_since.is_some()
    }

    pub fn has_projects(&self, cx: &App) -> bool {
        !self.project_items(cx).is_empty()
            || self.list_held()
            || (crate::features::flags::cloud_enabled(&self.preferences, cx)
                && !self.spaces.read(cx).spaces().is_empty())
    }

    fn recent<'a>(&self, cx: &'a App) -> &'a [RecentProject] {
        &self.preferences.read(cx).state.recent_projects
    }

    fn open_project(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        cx.emit(HomeEvent::OpenProject(path));
    }

    fn open_cloud(&mut self, project: String, cx: &mut Context<Self>) {
        cx.emit(HomeEvent::OpenCloud(project));
    }

    fn command(&mut self, command: Command, cx: &mut Context<Self>) {
        cx.emit(HomeEvent::Command(command));
    }

    // -------------------------------------------------------------- dialogs
    fn open_dialog(&mut self, key: DialogKey, cx: &mut Context<Self>) {
        let owner = self.weak.clone();
        let _ = self.dialogs.update(cx, |d, cx| {
            d.open_for(key, owner, Self::render_dialog, Self::dismiss_dialog, cx)
        });
    }

    fn close_dialog(&mut self, key: DialogKey, cx: &mut Context<Self>) -> bool {
        self.dialogs
            .update(cx, |d, cx| d.close(key, cx))
            .unwrap_or(false)
    }

    fn dialog_open(&self, key: DialogKey, cx: &App) -> bool {
        self.dialogs
            .upgrade()
            .is_some_and(|d| d.read(cx).contains(key))
    }

    fn top_dialog(&self, cx: &App) -> Option<DialogKey> {
        self.dialogs.upgrade()?.read(cx).top_key()
    }

    fn render_dialog(
        &mut self,
        key: DialogKey,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match key {
            DialogKey::CreateProject => self
                .create
                .as_ref()
                .map(|c| self.create_project_dialog(c, cx).into_any_element()),
            DialogKey::AgentStart => self.agent_start.as_ref().map(|start| {
                self.agent_start_dialog(start, window, cx)
                    .into_any_element()
            }),
            DialogKey::TemplateImport => self
                .template
                .as_ref()
                .map(|t| self.template_import_dialog(t, cx).into_any_element()),
            DialogKey::ImportRepository => match (&self.import, &self.import_picker) {
                (Some(import), _) => Some(self.import_dialog(import, cx).into_any_element()),
                (None, Some(picker)) => {
                    Some(self.import_picker_dialog(picker, cx).into_any_element())
                }
                (None, None) => None,
            },
            DialogKey::ProjectEntry => Some(self.project_entry_dialog(cx).into_any_element()),
            DialogKey::ProjectFolder => self
                .project_folder_dialog(cx)
                .map(IntoElement::into_any_element),
            _ => None,
        }
        .unwrap_or_else(|| Empty.into_any_element())
    }

    fn dismiss_dialog(&mut self, key: DialogKey, window: &mut Window, cx: &mut Context<Self>) {
        match key {
            DialogKey::CreateProject => self.close_create_project(window, cx),
            DialogKey::AgentStart => self.close_agent_start(window, cx),
            DialogKey::TemplateImport => self.close_template(window, cx),
            DialogKey::ImportRepository => self.close_import(window, cx),
            DialogKey::ProjectFolder => self.close_folder_question(cx),
            _ => self.close_project_entry(cx),
        }
    }

    // --------------------------------------------------------- empty intro
    fn sync_intro(&mut self, cx: &mut Context<Self>) {
        let visible = self.session.home && !self.session.restoring && !self.first_run_sign_in(cx);
        if !visible {
            self.intro = None;
            self.intro_empty = None;
            self.disclosure_shown = false;
            return;
        }
        let empty = self.project_items(cx).is_empty();
        if self.intro_empty != Some(empty) {
            self.intro_empty = Some(empty);
            self.intro = (empty && !cx.reduce_motion())
                .then(|| crate::ui::motion::Timeline::start(intro::TOTAL));
        }
        if self.intro.is_some_and(|timeline| timeline.finished()) {
            self.intro = None;
        }
        if empty
            && self.intro.is_none()
            && !self.disclosure_shown
            && let Some(telemetry) = crate::features::telemetry::global(cx)
            && telemetry.read(cx).disclosure_required()
        {
            self.disclosure_shown = true;
            telemetry.update(cx, |t, cx| t.disclosure_presented(cx));
        }
    }

    #[cfg(feature = "dev-capture")]
    pub fn lab(&mut self, played: bool) {
        if played {
            self.intro_empty = Some(true);
        }
        self.lab_moment(&std::env::var("PUPPYONE_LAB").unwrap_or_default());
    }

    pub(in crate::app) fn replay_intro(&mut self, cx: &mut Context<Self>) -> bool {
        if !cfg!(debug_assertions) || self.intro.is_some() || self.intro_empty != Some(true) {
            return false;
        }
        self.intro = Some(crate::ui::motion::Timeline::start(intro::TOTAL));
        cx.notify();
        true
    }

    fn intro_curtain(&self, w: f32, h: f32, cx: &App) -> Option<AnyElement> {
        let timeline = self.intro.as_ref()?;
        let frame = intro::current(timeline, w, h);
        Some(intro::curtain(frame.radius, w, h, cx.palette().dark).into_any_element())
    }

    // --------------------------------------------------------- composition
    fn home_view(
        &mut self,
        w: f32,
        h: f32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if self.session.restoring {
            return self.restoring_view(cx).into_any_element();
        }
        match self.first_paint_released(cx) {
            None => {
                window.request_animation_frame();
                return self.restoring_view(cx).into_any_element();
            }
            Some(account) if self.released_for.as_ref() != Some(&account) => {
                cx.defer_in(window, |h, window, cx| {
                    h.release_first_paint(cx);
                    h.offer_copied_template(window, cx);
                });
            }
            Some(_) => {}
        }

        let t = cx.palette();
        let has_projects = self.has_projects(cx);
        let state = if has_projects {
            OnboardingHomeState::Projects
        } else {
            OnboardingHomeState::Empty
        };
        let page_w = state.page_width(w);
        let column = if has_projects {
            page_w
        } else {
            value::layout(w).column.min(page_w)
        };
        let busy = self.session.busy;
        let intro_opacity = self
            .intro
            .as_ref()
            .map(|timeline| intro::current(timeline, w, h).content);

        let body: AnyElement = if has_projects {
            let items = self.visible_projects(cx);
            let held = self.groups_held(&items, window, cx);
            let groups = if held {
                vec![]
            } else {
                self.project_groups_now(items, cx)
            };
            let list_held = self.list_held();
            let held = held || list_held;

            // One toolbar: ways to start a project at its start, how the
            // projects are shown at its end.
            let start_actions = OnboardingStartActions::new(
                busy,
                cx.listener(|s, _, w, cx| s.begin_create_project(w, cx)),
                cx.listener(|s, _, _, cx| s.command(Command::OpenFolder, cx)),
                cx.listener(|s, _, w, cx| s.begin_import(w, cx)),
            )
            .agents_menu(self.new_project_menu(busy, cx));
            let view = (!list_held).then(|| self.project_toolbar(busy, cx));
            let head = OnboardingBrandLockup::projects(start_actions, view);
            let note = (crate::features::flags::cloud_enabled(&self.preferences, cx)
                && self.spaces.read(cx).status() == SpacesStatus::Error)
                .then(|| {
                    SpacesUnavailableNote::new(cx.listener(|s, _, _, cx| s.read_spaces(true, cx)))
                        .into_any_element()
                });
            let list =
                self.project_groups(groups, note, held, column, w, w <= 520., busy, window, cx);
            let primary = div()
                .flex_1()
                .min_h_0()
                .w_full()
                .flex()
                .flex_col()
                .gap(px(8.))
                .rounded(px(metric::CARD_RADIUS))
                .when(self.dragging, |d| d.bg(t.hover))
                .child(list);

            v_flex()
                .w(px(column))
                .flex_1()
                .min_h_0()
                .max_h_full()
                .child(head)
                .child(primary)
                .into_any_element()
        } else {
            let brand = OnboardingBrandLockup::empty(self.moment_copy(cx));
            let primary = div()
                .w_full()
                .mb(px(8.))
                .rounded(px(metric::CARD_RADIUS))
                .when(self.dragging, |d| d.bg(t.hover))
                .child(OnboardingCreateProjectAction::new(
                    true,
                    busy,
                    cx.listener(|s, _, w, cx| s.begin_create_project(w, cx)),
                ));
            let actions = OnboardingEntryActions::new(
                busy,
                self.dragging,
                self.preferences
                    .read(cx)
                    .state
                    .experimental
                    .other_app_imports,
                cx.listener(|s, _, _, cx| s.command(Command::OpenFolder, cx)),
                cx.listener(|s, _, w, cx| s.begin_import(w, cx)),
            );
            let launcher = v_flex()
                .flex_none()
                .w(px(column))
                .child(brand)
                .child(primary)
                .child(actions)
                .into_any_element();
            self.first_run_row(w, launcher, window, cx)
        };

        let host_project_drag = self.weak.clone();
        let host_ext_enter = self.weak.clone();
        let host_ext_drop = self.weak.clone();
        let host_ext_leave = self.weak.clone();
        let show_disclosure = !has_projects && self.disclosure_shown && self.intro.is_none();

        OnboardingHomeLayout::new(state, w, h, column, body)
            .error(self.error.clone())
            .intro_opacity(intro_opacity)
            .show_telemetry_disclosure(show_disclosure)
            .on_project_drag_move(move |event, window, cx| {
                let size = window.viewport_size();
                let at = event.event.position;
                let outside =
                    at.x < px(0.) || at.y < px(0.) || at.x > size.width || at.y > size.height;
                if outside {
                    let drag = event.drag(cx).clone();
                    let _ =
                        host_project_drag.update(cx, |s, cx| s.drag_left_window(&drag, window, cx));
                }
            })
            .on_external_drag(
                move |_, cx| {
                    let _ = host_ext_enter.update(cx, |s, cx| {
                        if !s.dragging {
                            s.dragging = true;
                            cx.notify();
                        }
                    });
                },
                move |paths, _, cx| {
                    let _ = host_ext_drop.update(cx, |s, cx| {
                        s.dragging = false;
                        s.drop_on_homepage(paths, cx);
                    });
                },
                move |_, cx| {
                    let _ = host_ext_leave.update(cx, |s, cx| {
                        if s.dragging {
                            s.dragging = false;
                            cx.notify();
                        }
                    });
                },
            )
            .into_any_element()
    }

    fn drop_on_homepage(&mut self, paths: &[PathBuf], cx: &mut Context<Self>) {
        match paths.iter().find(|p| p.is_dir()) {
            Some(folder) if paths.len() == 1 => {
                self.error = None;
                self.open_project(folder.clone(), cx);
            }
            _ => {
                self.error = Some(tr("onboarding.error.dropLocalFolder").into());
                cx.notify();
            }
        }
    }

    fn open_item(&mut self, item: &Item, cx: &mut Context<Self>) {
        self.error = None;
        if let Some(remote) = &item.remote {
            if remote.available() {
                cx.emit(HomeEvent::OpenDevice(
                    remote.clone(),
                    display::item_name(item),
                ));
            }
            return cx.notify();
        }
        match (&item.local_path, &item.cloud_project) {
            (Some(path), _) => self.open_project(PathBuf::from(path), cx),
            (None, Some(project)) => self.open_cloud(project.clone(), cx),
            _ => {}
        }
        cx.notify();
    }
}

#[cfg(feature = "dev-capture")]
impl Homepage {
    pub(in crate::app) fn capture_create_project(
        &mut self,
        name: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.begin_create_project(window, cx);
        if let Some(create) = self.create.as_mut() {
            create
                .destination
                .name
                .update(cx, |input, cx| input.set_text(name, cx));
        }
    }

    pub(in crate::app) fn capture_hover(&mut self, index: usize, cx: &mut Context<Self>) -> bool {
        let Some(item) = self.visible_projects(cx).into_iter().nth(index) else {
            return false;
        };
        self.hovered = Some(item.id);
        cx.notify();
        true
    }

    pub(in crate::app) fn capture_actions(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(item) = self.visible_projects(cx).into_iter().nth(index) else {
            return false;
        };
        let Some(target) = super::project_actions::Target::of(&item) else {
            return true;
        };
        let bounds = self
            .action_bounds
            .get(&item.id)
            .map(|b| b.get())
            .unwrap_or_default();
        if bounds.size.width <= px(0.) {
            return false;
        }
        self.hovered = Some(item.id.clone());
        let viewport = window.viewport_size();
        self.actions.update(cx, |a, cx| {
            a.open(target, bounds, true, viewport, Some(item.id), cx)
        });
        true
    }
}

impl Render for Homepage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let size = window.viewport_size();
        let (w, h) = (f32::from(size.width), f32::from(size.height));
        let root = div().absolute().top_0().left_0().size_full();
        if !self.session.home {
            return root;
        }
        match &self.intro {
            Some(timeline) if timeline.finished() => {
                cx.defer_in(window, |h, _, cx| h.refresh(cx));
            }
            Some(_) => window.request_animation_frame(),
            None => {}
        }
        if self.dragging_path.is_some() && !cx.has_active_drag() {
            cx.defer_in(window, |h, _, cx| {
                if !cx.has_active_drag() && h.dragging_path.take().is_some() {
                    cx.notify();
                }
            });
        }
        let page = if self.first_run_sign_in(cx) {
            self.first_run_view(w, h, cx).into_any_element()
        } else {
            self.home_view(w, h, window, cx)
        };
        root.child(page).children(self.intro_curtain(w, h, cx))
    }
}
