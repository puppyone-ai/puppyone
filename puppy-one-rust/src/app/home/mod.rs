//! The homepage: port of `MinimalOnboarding`, `OnboardingHomeLayout`,
//! `OnboardingBrandLockup`, `OnboardingEntryActions` and
//! `styles/onboarding.css`. Shown with no open project and from the project
//! menu's Home item.
//!
//! With projects, the page is their area: a quiet head (sort and layout,
//! then New project with the other ways to start behind its arrow) and the
//! projects by who can open them ([`groups`]), each group as the Grid or the
//! List ([`projects`]), from the head to the page's end. First run greets
//! with the Puppy and the ways to start.
//!
//! - [`create_project`]: the "Create a project" dialog
//! - [`folder`]: the project folder and its marks
use super::{
    Command, at,
    dialogs::{DialogKey, DialogLayer},
    project_actions::ProjectActions,
    session::SessionView,
};
use crate::features::cloud::{CloudCatalog, CloudSpaces, SpacesStatus};
use crate::features::settings::{PreferencesStore, RecentProject};
use crate::geometry::Rect;
use crate::localization::TimeUnit;
use crate::localization::relative_past;
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

pub(in crate::app) mod create_project;
mod first_run;
pub(in crate::app) mod folder;
pub(in crate::app) mod groups;
mod import_repository;
mod intro;
pub(in crate::app) mod project_entry;
mod projects;
mod template_import;
pub(super) use create_project::CreateProject;
pub(super) use import_repository::ImportRepository;
pub(in crate::app) use projects::HomeMenu;
pub(super) use template_import::TemplateImport;

/// `--onboarding-column-width`: room for five folders across with
/// projects, 440px on first run.
const COLUMN_PROJECTS: f32 = 640.;
const COLUMN_EMPTY: f32 = 440.;
/// `.onboarding-homepage { width: min(680px, 100%) }`.
const PAGE_WIDTH: f32 = 680.;
/// `HOMEPAGE_FIRST_PAINT_BUDGET_MS`: the longest a list waits.
const FIRST_PAINT_BUDGET: Duration = Duration::from_millis(4000);
/// `SPACES_WAIT_MS`: how long a first visit waits for the spaces that group
/// its Cloud projects.
const SPACES_WAIT: Duration = Duration::from_millis(3000);

/// What the Homepage asks of the window.
pub(in crate::app) enum HomeEvent {
    /// Open this local folder here.
    OpenProject(PathBuf),
    /// Open this Cloud project here.
    OpenCloud(String),
    /// Open another of my computers' folder here, by its name.
    OpenDevice(crate::workspace::cloud::catalog::RemoteFolder, String),
    /// A project just made: open it here (or, when `new_window`, in a
    /// window of its own) on `open`.
    OpenCreated {
        path: PathBuf,
        open: Option<PathBuf>,
        new_window: bool,
    },
    /// A folder dropped on a team's group: its confirmed first publication
    /// to that space.
    PublishToSpace {
        path: PathBuf,
        space: String,
    },
    /// A folder dropped on My Share Project: open it to my other computers,
    /// after the owner's confirmation.
    ShareFolder {
        path: PathBuf,
    },
    Command(Command),
}

/// The Homepage (`MinimalOnboarding` and its stores): the remembered and
/// Cloud projects it lists, its own state, and the ways into a new project
/// with their dialogs. What the window shows reaches it as a
/// [`SessionView`]; what it asks for leaves as a [`HomeEvent`].
pub(in crate::app) struct Homepage {
    session: SessionView,
    preferences: Entity<PreferencesStore>,
    catalog: Entity<CloudCatalog>,
    /// The account's spaces, which decide each Cloud project's group.
    pub(in crate::app) spaces: Entity<CloudSpaces>,
    /// The account's computers and the folders they offer.
    pub(in crate::app) hosts: Entity<crate::features::hosts::HostCatalog>,
    actions: Entity<ProjectActions>,
    dialogs: WeakEntity<DialogLayer>,
    /// The dialog layer's focus, which the dialogs here keep.
    dialog_focus: FocusHandle,
    /// The window's own focus, which takes the keyboard back.
    window_focus: FocusHandle,
    weak: WeakEntity<Self>,
    /// The project list's scroller.
    pub scroll: ScrollHandle,
    /// When each project last changed (`None`: unknown), by path.
    activity: HashMap<PathBuf, Option<SystemTime>>,
    /// `puppyoneGitRemote` of each checkout whose remotes were read
    /// (`hydrationState: "ready"`); an absent path is never linked.
    locators: HashMap<PathBuf, Option<Locator>>,
    /// The projects the activity was read for; a new list reads again.
    read_for: Option<Vec<PathBuf>>,
    /// The projects were listed at the last change.
    shown: bool,
    /// Activity is being read.
    pub reading: bool,
    /// `useHomepageFirstPaint`: the first Homepage waits (whole) until its
    /// list can appear once in its final order, at most four seconds; then
    /// the account it was released for.
    first_paint: Option<Instant>,
    released_for: Option<Option<String>>,
    /// `useHomepageListHold`: after Home only the list waits.
    pub list_held_since: Option<Instant>,
    /// The team the team group shows, when several could.
    pub chosen_team: Option<String>,
    /// The group a dragged project is over.
    pub drop_over: Option<groups::GroupId>,
    /// Since when a first visit waits for the spaces.
    pub(in crate::app::home) spaces_wait: Option<Instant>,
    /// This computer's shared folder ids, once its sharing state is read
    /// (`None`: every recorded offer counts).
    pub(in crate::app) shared_ids: Option<std::collections::HashSet<String>>,
    /// Opening a folder to my other computers is offered here.
    pub(in crate::app) local_share: bool,
    /// The owner's other computers, by name (`OtherComputersLabel`).
    pub(in crate::app) other_computers: Vec<String>,
    /// This computer's sharing, for My Share Project's heading.
    presence: Option<(String, bool)>,
    /// `settleShownDates`: each project's date as first shown this visit.
    shown_dates: HashMap<String, i64>,
    /// The toolbar or entry menu that is open.
    pub menu: Option<HomeMenu>,
    /// The list's roving Tab stop.
    pub stop: Option<String>,
    /// Each project's open control.
    pub focus: HashMap<String, FocusHandle>,
    /// Where each project's actions trigger was painted.
    pub action_bounds: HashMap<String, std::rc::Rc<std::cell::Cell<Bounds<Pixels>>>>,
    /// The project under the pointer.
    pub hovered: Option<String>,
    /// Each tile's sheet motion: target, since, from.
    sheets: HashMap<String, (bool, Instant, f32)>,
    /// A folder is being dragged over the window.
    pub dragging: bool,
    /// The project being dragged out, by its absolute path (`draggingPath`).
    pub dragging_path: Option<String>,
    /// `onboarding-homepage-error`: why a drop or opening failed.
    pub error: Option<String>,
    /// The empty-state intro that is playing.
    pub(in crate::app) intro: Option<crate::ui::motion::Timeline>,
    /// Whether the visible Homepage had no projects at the last change
    /// (`None` while it is hidden, so showing it again replays the intro).
    intro_empty: Option<bool>,
    /// This Homepage has shown the analytics disclosure; it stays for as
    /// long as the Homepage does (`shownForLaunch`).
    pub(in crate::app) disclosure_shown: bool,
    /// "Create a project", while its dialog is open.
    pub(in crate::app) create: Option<CreateProject>,
    /// The template card, while it is open.
    pub(in crate::app) template: Option<Box<TemplateImport>>,
    /// Cloning a repository into a new project, while its dialog is open.
    pub(in crate::app) import: Option<ImportRepository>,
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
        // The list, the first run and the intro follow what they read.
        cx.observe(&preferences, |h, _, cx| h.refresh(cx)).detach();
        cx.observe(&catalog, |h, _, cx| h.refresh(cx)).detach();
        let spaces = crate::features::cloud::global_spaces(cx);
        cx.observe(&spaces, |h, _, cx| h.refresh(cx)).detach();
        let hosts = crate::features::hosts::global(cx);
        cx.observe(&hosts, |h, _, cx| h.refresh(cx)).detach();
        let link = crate::features::hosts::host_link(cx);
        cx.observe(&link, |h, _, cx| h.refresh(cx)).detach();
        // Coming back to the window reads the spaces and the computers
        // again while the page shows.
        cx.observe_window_activation(window, |h, window, cx| {
            if window.is_window_active() && h.session.home {
                h.read_spaces(true, cx);
                h.read_hosts(true, cx);
            }
        })
        .detach();
        // Presence changes while the page is open: a quiet poll keeps
        // "online" honest without a button.
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
        // Dev builds replay the intro (Alt+Shift+L, `KeyL`).
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
        // The disclosure follows the analytics state.
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
            chosen_team: None,
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
            sheets: HashMap::new(),
            dragging: false,
            dragging_path: None,
            error: None,
            intro: None,
            intro_empty: None,
            disclosure_shown: false,
            create: None,
            template: None,
            import: None,
        }
    }
    /// What the window shows changed.
    pub fn set_session(&mut self, session: SessionView, cx: &mut Context<Self>) {
        if self.session != session {
            self.session = session;
            self.refresh(cx);
        }
    }
    /// What the page reads changed: the list, the first run and the intro
    /// catch up, and the page draws again.
    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.read_spaces(false, cx);
        self.read_hosts(false, cx);
        self.sync_sharing(cx);
        self.refresh_activity(cx);
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
    fn recent<'a>(&self, cx: &'a App) -> &'a [RecentProject] {
        &self.preferences.read(cx).state.recent_projects
    }
    fn open_project(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        cx.emit(HomeEvent::OpenProject(path));
    }
    fn open_cloud(&mut self, project: String, cx: &mut Context<Self>) {
        cx.emit(HomeEvent::OpenCloud(project));
    }
    /// `useHostCatalog`: the account's computers, while Other computers is
    /// on and the page shows.
    pub(in crate::app) fn read_hosts(&mut self, retry: bool, cx: &mut Context<Self>) {
        let enabled = crate::features::flags::host_devices_enabled(&self.preferences, cx);
        let visible = self.session.home;
        self.hosts
            .update(cx, |h, cx| h.ensure(enabled, visible, retry, cx));
    }
    /// This computer's own sharing (`HomepageComputers`): what it offers, its
    /// id among the account's computers, and whether a folder may be offered.
    fn sync_sharing(&mut self, cx: &mut Context<Self>) {
        let on = crate::features::flags::host_devices_enabled(&self.preferences, cx);
        let account = crate::features::cloud::account::broker_and_binding(cx).map(|(_, b)| b.user);
        let link = crate::features::hosts::host_link(cx);
        if on {
            link.update(cx, |l, cx| {
                l.sync_account(cx);
                l.ensure(false, cx);
            });
        }
        let device = account.as_deref().and_then(|a| link.read(cx).device_for(a));
        if self.hosts.read(cx).this_device != device {
            self.hosts.update(cx, |h, cx| {
                h.this_device = device;
                cx.notify();
            });
        }
        let own: Option<std::collections::HashSet<String>> = link
            .read(cx)
            .status
            .as_ref()
            .filter(|_| on)
            .map(|s| s.folders.iter().map(|f| f.folder_id.clone()).collect());
        let hosts = self.hosts.read(cx);
        self.other_computers = hosts
            .others()
            .filter(|_| on)
            .map(|d| d.name.clone())
            .collect();
        self.shared_ids = own.or_else(|| hosts.offered_here().filter(|_| on && !hosts.error()));
        // A device key needs this computer's keychain.
        self.local_share = on && account.is_some() && cfg!(target_os = "macos");
        // `ThisComputerDetail`: paused sharing is resumed where it is seen.
        self.presence = link.read(cx).status.as_ref().filter(|_| on).and_then(|s| {
            let key = if s.state == "outdated" {
                "hosts.sharing.outdated"
            } else if s.folders.is_empty() {
                return None;
            } else if s.paused {
                "hosts.sharing.paused"
            } else if s.state == "connecting" {
                "hosts.sharing.connecting"
            } else if s.state == "offline" {
                "hosts.sharing.reconnecting"
            } else {
                return None;
            };
            Some((tr(key).to_owned(), s.paused && s.state != "outdated"))
        });
    }
    /// The folders my other computers offer, but those this computer shares.
    fn remote_items(&self, cx: &App) -> Vec<Item> {
        if !crate::features::flags::host_devices_enabled(&self.preferences, cx) {
            return vec![];
        }
        let local: std::collections::HashSet<String> = self
            .recent(cx)
            .iter()
            .filter_map(|p| p.host_folder.clone())
            .collect();
        self.hosts.read(cx).remote_items(&local)
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
    /// Closes `key`; `false` when it was not open.
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
    /// The dialog on top of the layer, while it is one of these.
    fn top_dialog(&self, cx: &App) -> Option<DialogKey> {
        self.dialogs.upgrade()?.read(cx).top_key()
    }
    fn render_dialog(
        &mut self,
        key: DialogKey,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match key {
            DialogKey::CreateProject => self
                .create
                .as_ref()
                .map(|c| self.create_project_dialog(c, cx).into_any_element()),
            DialogKey::TemplateImport => self
                .template
                .as_ref()
                .map(|t| self.template_import_dialog(t, cx).into_any_element()),
            DialogKey::ImportRepository => self
                .import
                .as_ref()
                .map(|i| self.import_dialog(i, cx).into_any_element()),
            DialogKey::ProjectEntry => Some(self.project_entry_dialog(cx).into_any_element()),
            _ => None,
        }
        .unwrap_or_else(|| Empty.into_any_element())
    }
    /// Escape on one of the Homepage's dialogs, each with its own cancel.
    fn dismiss_dialog(&mut self, key: DialogKey, window: &mut Window, cx: &mut Context<Self>) {
        match key {
            DialogKey::CreateProject => self.close_create_project(window, cx),
            DialogKey::TemplateImport => self.close_template(window, cx),
            DialogKey::ImportRepository => self.close_import(window, cx),
            _ => self.close_project_entry(cx),
        }
    }
}

/// `getProjectName` for a catalog entry.
pub(in crate::app) fn item_name_or(item: &Item, untitled: &str) -> String {
    let label = item.label.trim();
    if !label.is_empty() && Some(label) != item.local_path.as_deref() {
        return label.to_owned();
    }
    item.local_path
        .as_deref()
        .and_then(|p| Path::new(p).file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| {
            if label.is_empty() {
                untitled.to_owned()
            } else {
                label.to_owned()
            }
        })
}
fn item_name(item: &Item) -> String {
    item_name_or(item, tr("onboarding.projects.untitled"))
}
/// `useProjectHomeItemCaption`: where an entry's project is; another
/// computer's folder says which computer and what it allows there, or why
/// it cannot open now (`RemoteFolderList`).
fn item_caption(item: &Item) -> String {
    if let Some(remote) = &item.remote {
        let host = crate::localization::bidi_isolate(&remote.host);
        if !remote.online {
            return crate::localization::tf("hosts.home.computerOffline", &[("host", host.into())]);
        }
        let access = if remote.paused {
            tr("hosts.sharing.paused")
        } else if remote.writable {
            tr("hosts.catalog.editable")
        } else {
            tr("hosts.catalog.readOnly")
        };
        return format!("{host} · {access}");
    }
    tr(if item.local_path.is_none() {
        "cloud.home.location.cloud"
    } else if cfg!(target_os = "macos") {
        "shell.workspaceSwitcher.location.thisMac"
    } else {
        "shell.workspaceSwitcher.location.thisComputer"
    })
    .to_owned()
}
/// `getProjectName`: the label, else the folder's name.
fn project_name(project: &RecentProject) -> String {
    let label = project.name.trim();
    if !label.is_empty() && Path::new(label) != project.path {
        return label.to_owned();
    }
    project
        .path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| tr("onboarding.projects.untitled").to_owned())
}
/// `getWorkspacePathForDisplay`: home as `~`.
pub(in crate::app) fn path_for_display(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    match text.strip_prefix("/Users/") {
        Some(rest) => match rest.split_once('/') {
            Some((_, below)) => format!("~/{below}"),
            None => "~".into(),
        },
        None => text,
    }
}
/// `getWorkspaceParentPathForDisplay`: the parent folder, home as `~`.
fn parent_for_display(path: &Path) -> String {
    match path.parent() {
        Some(parent) => path_for_display(parent),
        None => String::new(),
    }
}
/// `formatModificationTime`: "Just now", then whole minutes, hours or days.
fn modification_time(changed: SystemTime, now: SystemTime) -> String {
    const MINUTE: u64 = 60;
    const HOUR: u64 = 60 * MINUTE;
    const DAY: u64 = 24 * HOUR;
    let elapsed = now
        .duration_since(changed)
        .unwrap_or(Duration::ZERO)
        .as_secs();
    if elapsed < MINUTE {
        return tr("onboarding.time.justNow").into();
    }
    let (n, unit) = if elapsed < HOUR {
        (elapsed / MINUTE, TimeUnit::Minute)
    } else if elapsed < DAY {
        (elapsed / HOUR, TimeUnit::Hour)
    } else {
        (elapsed / DAY, TimeUnit::Day)
    };
    relative_past(n.max(1) as i64, unit)
}

impl Homepage {
    /// Hydrates the remembered projects (when each last changed, and its
    /// canonical Cloud locator) whenever the homepage or the Header project
    /// menu appears or the list changes, off the main thread. A visit ends
    /// when the page hides: its filter and shown dates go with it.
    fn refresh_activity(&mut self, cx: &mut Context<Self>) {
        let shown = self.session.listing;
        let appeared = shown && !self.shown;
        if !self.session.home {
            self.chosen_team = None;
        }
        if appeared && self.session.home {
            self.shown_dates.clear();
            self.menu = None;
        }
        self.shown = shown;
        let paths: Vec<PathBuf> = self.recent(cx).iter().map(|p| p.path.clone()).collect();
        if !shown || (!appeared && self.read_for.as_ref() == Some(&paths)) {
            return;
        }
        self.read_for = Some(paths.clone());
        self.reading = true;
        let read = cx.background_executor().spawn(async move {
            paths
                .into_iter()
                .map(|path| {
                    let changed = project_activity::last_modified(&path);
                    let remote = project_activity::remote_urls(&path)
                        .map(|urls| locator::canonical_locator(urls.iter().map(String::as_str)));
                    (path, changed, remote)
                })
                .collect::<Vec<_>>()
        });
        cx.spawn(async move |this, cx| {
            let read = read.await;
            let _ = this.update(cx, |s, cx| {
                s.locators = read
                    .iter()
                    .filter_map(|(path, _, remote)| Some((path.clone(), remote.clone()?)))
                    .collect();
                s.activity = read
                    .into_iter()
                    .map(|(path, changed, _)| (path, changed))
                    .collect();
                s.reading = false;
                // The list is whole: it may be seen now.
                s.list_held_since = None;
                s.refresh(cx);
            });
        })
        .detach();
    }
    /// `useHomepageListHold`: Home leaves at once and only the list waits,
    /// so the project just left is in its new place the first time it shows.
    pub(in crate::app) fn hold_list(&mut self) {
        self.list_held_since = Some(Instant::now());
        // A re-read even of an unchanged list, as the product refreshes it.
        self.read_for = None;
    }
    /// `useCloudSpaces`: the spaces of the signed-in account, while Cloud is
    /// on and the page shows.
    fn read_spaces(&mut self, retry: bool, cx: &mut Context<Self>) {
        let enabled = crate::features::flags::cloud_enabled(&self.preferences, cx);
        let visible = self.session.home;
        self.spaces
            .update(cx, |s, cx| s.ensure(enabled, visible, retry, cx));
    }
    /// The groups wait as one while a first visit's spaces are on their way,
    /// up to three seconds, rather than grouping a Cloud project once
    /// provisionally and then moving it.
    fn groups_held(&mut self, items: &[Item], window: &mut Window, cx: &App) -> bool {
        let awaiting = self.spaces.read(cx).status() == SpacesStatus::Loading
            && items.iter().any(|item| item.local_path.is_none());
        if !awaiting {
            self.spaces_wait = None;
            return false;
        }
        let since = *self.spaces_wait.get_or_insert_with(Instant::now);
        let held = since.elapsed() < SPACES_WAIT;
        if held {
            window.request_animation_frame();
        }
        held
    }
    /// The audience groups for the visible projects.
    pub(in crate::app) fn project_groups_now(
        &self,
        items: Vec<Item>,
        cx: &App,
    ) -> Vec<groups::Group> {
        let spaces = self.spaces.read(cx);
        let cloud = crate::features::flags::cloud_enabled(&self.preferences, cx)
            && crate::features::cloud::account::has_account(cx);
        groups::groups(groups::Inputs {
            spaces: if cloud { spaces.spaces() } else { &[] },
            items,
            dragging_path: self
                .dragging_path
                .as_deref()
                .filter(|_| cx.has_active_drag()),
            busy: self.session.busy,
            can_publish: cloud,
            chosen_team: self.chosen_team.as_deref(),
            shared_ids: self.shared_ids.as_ref(),
            local_share: self.local_share,
            remote: self.remote_items(cx),
            presence: self.presence.clone(),
        })
    }
    /// `projectAudience` of `MinimalOnboarding`: who can open a local folder
    /// listed here, and how its menu changes that — opened to my devices
    /// directly, or copied to a team's Cloud space.
    pub(in crate::app) fn audience_of_id(
        &self,
        id: &str,
        cx: &App,
    ) -> Option<super::audience::ProjectAudience> {
        use super::audience::{AudienceAction as A, CloudCopy, Devices, ProjectAudience, Team};
        use crate::workspace::cloud::spaces::Kind;
        let items = self.visible_projects(cx);
        let item = items.iter().find(|i| i.id == id)?;
        let path = PathBuf::from(item.local_path.clone()?);
        let cloud = crate::features::flags::cloud_enabled(&self.preferences, cx)
            && crate::features::cloud::account::has_account(cx);
        let spaces = self.spaces.read(cx);
        let spaces = if cloud { spaces.spaces() } else { &[] };
        let shared = item
            .host_folder
            .as_ref()
            .is_some_and(|f| self.shared_ids.as_ref().is_none_or(|ids| ids.contains(f)));
        let linked = item.linked.clone();
        let copy = linked.as_ref().map(|l| CloudCopy {
            open: Some(A::OpenCloud(l.id.clone())),
            ..Default::default()
        });
        let space_of = |project: &str| {
            items
                .iter()
                .find(|i| i.cloud_project.as_deref() == Some(project))
                .and_then(|i| i.cloud_organization.clone())
                .and_then(|org| spaces.iter().find(|s| s.id == org))
        };
        let personal_copy = linked
            .as_ref()
            .and_then(|l| space_of(&l.id))
            .is_some_and(|s| s.kind == Kind::Personal);
        let first_team = spaces
            .iter()
            .find(|s| s.kind == Kind::Team && s.can_create_projects);
        let devices = (self.local_share || (shared && item.host_folder.is_some())).then(|| {
            let folder = item.host_folder.clone().unwrap_or_default();
            Devices {
                on: shared,
                detail: shared
                    .then(|| super::audience::other_computers(&self.other_computers, false)),
                turn_on: (self.local_share && !shared)
                    .then(|| A::TurnOnDevices { path: path.clone() }),
                stop: shared.then(|| A::StopDevices {
                    folder: folder.clone(),
                    path: path.clone(),
                }),
                settings: shared.then(|| A::DeviceSettings {
                    folder: folder.clone(),
                    name: item.label.clone(),
                    path: path.clone(),
                }),
            }
        });
        let team = (first_team.is_some() || (copy.is_some() && !personal_copy)).then(|| Team {
            copy: if personal_copy { None } else { copy.clone() },
            on_copy: first_team
                .filter(|_| linked.is_none() && cloud)
                .map(|team| A::CopyToTeam {
                    path: path.clone(),
                    space: team.id.clone(),
                }),
        });
        Some(ProjectAudience {
            devices,
            devices_copy: if personal_copy { copy } else { None },
            team,
        })
        .filter(|a| a.any())
    }
    /// The account the first Homepage waits for (`None`: signed out or no
    /// Cloud).
    fn first_paint_account(&self, cx: &App) -> Option<String> {
        crate::features::cloud::account::broker_and_binding(cx)
            .filter(|_| crate::features::flags::cloud_enabled(&self.preferences, cx))
            .map(|(_, b)| format!("{}\n{}", b.environment.api(), b.user))
    }
    /// `useHomepageFirstPaint`: the first Homepage of an account waits for
    /// its list (whole, final order), up to four seconds. `Some(account)`
    /// once it may show for `account`; `None` while it still waits.
    fn first_paint_released(&self, cx: &App) -> Option<Option<String>> {
        let account = self.first_paint_account(cx);
        if self.session.restoring || self.released_for.as_ref() == Some(&account) {
            return Some(account);
        }
        // `settled`: no Cloud result is still on its way that would reorder
        // the list (a cached stand-in is not the account's own answer).
        let catalog = self.catalog.read(cx);
        let catalog_settled = account.is_none()
            || matches!(catalog.state, crate::features::cloud::CatalogState::Failed)
            || (matches!(
                catalog.state,
                crate::features::cloud::CatalogState::Ready(_)
            ) && catalog.fresh);
        let settled = !self.reading && self.read_for.is_some() && catalog_settled;
        let over = self
            .first_paint
            .is_some_and(|since| since.elapsed() >= FIRST_PAINT_BUDGET);
        (settled || over).then_some(account)
    }
    /// The first paint may show: it shows for this account from now on.
    fn release_first_paint(&mut self, cx: &mut Context<Self>) {
        if let Some(account) = self.first_paint_released(cx)
            && self.released_for.as_ref() != Some(&account)
            && !self.session.restoring
        {
            self.released_for = Some(account);
            self.first_paint = None;
            self.list_held_since = None;
            cx.notify();
        }
    }
    /// `useHomepageCloudProjects().items`: the one flat project list the
    /// Homepage and the Header project menu share. Location chooses icons
    /// and actions, never the rank; Cloud entries come only from the
    /// current account's catalog, and a folder links to one only through
    /// its freshly read, trusted Project-root locator.
    pub(in crate::app) fn project_items(&self, cx: &App) -> Vec<Item> {
        use crate::features::cloud::CatalogState as State;
        let account = crate::features::cloud::account::broker_and_binding(cx)
            .map(|(_, binding)| binding)
            .filter(|_| crate::features::flags::cloud_enabled(&self.preferences, cx));
        let catalog = self.catalog.read(cx);
        let (cloud, activity) = match (&catalog.state, &account) {
            (State::Ready(entries), Some(_)) => (entries.as_slice(), &catalog.activity),
            _ => (&[][..], &catalog.activity),
        };
        let api = account.as_ref().map(|b| b.environment.api().to_owned());
        let hosted_git_origin = account
            .as_ref()
            .and_then(|b| b.environment.hosted_git_origin());
        let millis = |t: SystemTime| {
            t.duration_since(UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as i64)
        };
        let local: Vec<catalog::LocalEntry> = self
            .recent(cx)
            .iter()
            .map(|p| catalog::LocalEntry {
                path: p.path.to_string_lossy().into_owned(),
                name: project_name(p),
                modified: self
                    .activity
                    .get(&p.path)
                    .copied()
                    .flatten()
                    .and_then(millis),
                trusted_locator: api.as_deref().and_then(|api| {
                    self.locators.get(&p.path).cloned().flatten().filter(|l| {
                        locator::is_trusted_git_origin(&l.origin, api, hosted_git_origin.as_deref())
                    })
                }),
                host_folder: p.host_folder.clone(),
            })
            .collect();
        catalog::build(&local, cloud, activity)
    }
    /// `showEmptyStateIntro`: the intro plays whenever the Homepage appears
    /// (or loses its last project) with no projects, unless motion is
    /// reduced; the disclosure waits for it.
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
        // `OnboardingTelemetryDisclosure ready={!showEmptyStateIntro}`: shown
        // on an empty Homepage once the intro is over, then marked seen.
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
    /// The pixel lab's Homepage (`shell-home-*`): no fixture workspace and
    /// no capture of its own. `played` starts after the intro, as if it had
    /// already run; otherwise it plays (held by `PUPPYONE_MOTION_AT`).
    #[cfg(feature = "dev-capture")]
    pub fn lab(&mut self, played: bool) {
        if played {
            self.intro_empty = Some(true);
        }
    }
    /// Dev builds: Alt+Shift+L replays the intro on an empty Homepage.
    pub(in crate::app) fn replay_intro(&mut self, cx: &mut Context<Self>) -> bool {
        if !cfg!(debug_assertions) || self.intro.is_some() || self.intro_empty != Some(true) {
            return false;
        }
        self.intro = Some(crate::ui::motion::Timeline::start(intro::TOTAL));
        cx.notify();
        true
    }
    /// The curtain over the whole window while the intro plays (the
    /// Header's titlebar stays above it, `z-index: 60` over the curtain's 3).
    fn intro_curtain(&self, w: f32, h: f32, cx: &App) -> Option<AnyElement> {
        let timeline = self.intro.as_ref()?;
        let frame = intro::current(timeline, w, h);
        Some(intro::curtain(frame.radius, w, h, cx.palette().dark).into_any_element())
    }
    /// `.onboarding-telemetry-disclosure`: one caption line in the bottom
    /// end corner, the Learn More link underlined at 45%.
    fn telemetry_disclosure(&self, w: f32, cx: &App) -> Option<AnyElement> {
        if !self.disclosure_shown || self.intro.is_some() {
            return None;
        }
        let t = cx.palette();
        let narrow = w <= 700.;
        let (end, bottom) = if narrow { (16., 12.) } else { (24., 16.) };
        Some(
            h_flex()
                .debug_selector(|| "onboarding-telemetry-disclosure".into())
                .absolute()
                .right(px(end))
                .bottom(px(bottom))
                .max_w(px(w - end * 2.))
                .flex_wrap()
                .text_size(px(theme::ty().ui.caption))
                .line_height(px(15.))
                .text_color(t.subtle)
                .child(format!("{} ", tr("onboarding.telemetry.notice")))
                .child(
                    div()
                        .id("onboarding-telemetry-learn-more")
                        .underline()
                        .text_decoration_color(theme::alpha(t.subtle, 0.45))
                        .cursor(theme::clickable_cursor())
                        .hover(move |s| s.text_color(t.muted).text_decoration_color(t.muted))
                        .on_click(|_, _, cx| {
                            cx.open_url(crate::platform::telemetry::DISCLOSURE_URL)
                        })
                        .child(tr("onboarding.telemetry.learnMore")),
                )
                .into_any_element(),
        )
    }
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
                // The budget is checked again on the next frame.
                window.request_animation_frame();
                return self.restoring_view(cx).into_any_element();
            }
            Some(account) if self.released_for.as_ref() != Some(&account) => {
                cx.defer_in(window, |h, _, cx| h.release_first_paint(cx));
            }
            Some(_) => {}
        }
        let t = cx.palette();
        let all = self.project_items(cx);
        let has_projects = !all.is_empty() || self.list_held();
        let busy = self.session.busy;
        let pad = metric::UTILITY_PADDING_INLINE;
        let page_w = PAGE_WIDTH.min(w - pad * 2.).max(0.);
        let column = if has_projects {
            COLUMN_PROJECTS
        } else {
            COLUMN_EMPTY
        }
        .min(page_w);
        let error = self.error.clone().map(|error| {
            // `.onboarding-error.onboarding-homepage-error`.
            h_flex()
                .flex_none()
                .w(px(COLUMN_PROJECTS.min(page_w)))
                .items_start()
                .gap(px(8.))
                .py(px(9.))
                .px(px(10.))
                .rounded(px(8.))
                .border_1()
                .border_color(theme::mix(t.danger, t.border_subtle, 0.18))
                .bg(theme::alpha(t.danger, 0.06))
                .text_color(t.danger)
                .text_size(px(theme::ty().ui.body))
                .line_height(relative(1.4))
                .child(Icon::new("triangle-alert").with_size(px(15.)).mt(px(1.)))
                .child(div().min_w_0().child(error))
        });
        let intro = self
            .intro
            .as_ref()
            .map(|timeline| intro::current(timeline, w, h).content);
        let page = if has_projects {
            let items = self.visible_projects(cx);
            let held = self.groups_held(&items, window, cx);
            let groups = if held {
                vec![]
            } else {
                self.project_groups_now(items, cx)
            };
            let held = held || self.list_held();
            // `.onboarding-brand-lockup` with its toolbar and the entry menu.
            let head = h_flex()
                .flex_none()
                .w_full()
                .min_w_0()
                .gap(px(8.))
                .mb(px(8.))
                .text_color(t.muted)
                .child(self.project_toolbar(busy, cx))
                .child(self.entry_menu(busy, w <= 696., cx));
            let note = (self.spaces.read(cx).status() == SpacesStatus::Error).then(|| {
                // `.onboarding-project-groups-note`: the spaces could not be
                // read; the projects stay where they are.
                h_flex()
                    .gap(px(4.))
                    .px(px(8.))
                    .pt(px(2.))
                    .pb(px(6.))
                    .text_size(px(theme::ty().ui.caption))
                    .line_height(px(18.))
                    .text_color(t.subtle)
                    .child(tr("onboarding.spaces.unavailable"))
                    .child(
                        div()
                            .id("home-spaces-retry")
                            .cursor(theme::clickable_cursor())
                            .underline()
                            .hover(move |s| s.text_color(t.text))
                            .on_click(cx.listener(|s, _, _, cx| s.read_spaces(true, cx)))
                            .child(tr("onboarding.spaces.retry")),
                    )
                    .into_any_element()
            });
            let list = self.project_groups(groups, note, held, column, w <= 520., busy, window, cx);
            // `.onboarding-home-primary[data-onboarding-primary="projects"]`:
            // the projects sit on the page; a fill appears only for a drop.
            let primary = div()
                .flex_1()
                .min_h_0()
                .w_full()
                .flex()
                .flex_col()
                .rounded(px(metric::CARD_RADIUS))
                .when(self.dragging, |d| d.bg(t.hover))
                .child(list);
            v_flex()
                .w(px(page_w))
                .h_full()
                .items_center()
                .gap(px(30.))
                .child(
                    v_flex()
                        .w(px(column))
                        .flex_1()
                        .min_h_0()
                        .max_h_full()
                        .child(head)
                        .child(primary),
                )
                .children(error)
        } else {
            // First run: the Puppy and a line, New project, then Open a
            // folder and Import side by side.
            let brand = v_flex()
                .flex_none()
                .w_full()
                .items_center()
                .gap(px(16.))
                .mb(px(20.))
                .text_color(t.muted)
                .child(
                    img(SharedString::from(if t.dark {
                        "brand/puppy-dark-onboarding.svg"
                    } else {
                        "brand/puppy-lite.svg"
                    }))
                    .size(px(48.))
                    .object_fit(ObjectFit::Contain)
                    .flex_shrink_0(),
                )
                .child(
                    div()
                        .text_size(px(theme::ty().ui.heading))
                        .line_height(relative(1.25))
                        .font_weight(FontWeight::MEDIUM)
                        .text_center()
                        .child(tr("onboarding.brand.agentReadyMessage")),
                );
            let primary = div()
                .w_full()
                .mb(px(8.))
                .rounded(px(metric::CARD_RADIUS))
                .when(self.dragging, |d| d.bg(t.hover))
                .child(self.create_action(true, busy, cx).w_full());
            let actions = h_flex()
                .w_full()
                .gap(px(8.))
                .pb(px(18.))
                .child(
                    Button::new("home-open-folder")
                        .variant(ButtonVariant::Pattern)
                        .icon(Icon::product(ProductIcon::Folder).small().stroke(1.85))
                        .label(tr("onboarding.action.openFolder"))
                        .disabled(busy)
                        .flex_1()
                        .min_w_0()
                        .text_size(px(theme::ty().ui.body))
                        .font_weight(FontWeight::NORMAL)
                        .when(self.dragging, |b| b.bg(t.control_hover))
                        .on_click(cx.listener(|s, _, _, cx| s.command(Command::OpenFolder, cx))),
                )
                .child(self.import_action(t, busy, cx).flex_1().min_w_0());
            v_flex()
                .w(px(page_w))
                .items_center()
                .gap(px(30.))
                .child(
                    v_flex()
                        .w(px(column))
                        .child(brand)
                        .child(primary)
                        .child(actions),
                )
                .children(error)
        }
        .when_some(intro, |d, opacity| d.opacity(opacity));
        let host = self.weak.clone();
        at(Rect::new(0., 0., w, h))
            .id("homepage")
            .bg(t.canvas)
            .flex()
            .flex_col()
            .items_center()
            .when(has_projects, |d| {
                d.justify_start()
                    .pt(px(metric::CHROME_HEIGHT + 32.))
                    .pb(px(20.))
            })
            .when(!has_projects, |d| d.justify_center().py(px(48.)))
            .px(px(pad))
            .child(page)
            // A project dragged past the window's edge leaves as text.
            .on_drag_move::<projects::ProjectDrag>(cx.listener(
                |s, event: &DragMoveEvent<projects::ProjectDrag>, window, cx| {
                    let size = window.viewport_size();
                    let at = event.event.position;
                    let outside =
                        at.x < px(0.) || at.y < px(0.) || at.x > size.width || at.y > size.height;
                    if outside {
                        let drag = event.drag(cx).clone();
                        s.drag_left_window(&drag, window, cx);
                    }
                },
            ))
            // `useWorkspaceFolderDrop`: a folder dropped anywhere opens.
            .on_drag_move::<ExternalPaths>(cx.listener(|s, _, _, cx| {
                if !s.dragging {
                    s.dragging = true;
                    cx.notify();
                }
            }))
            .on_drop(cx.listener(move |s, paths: &ExternalPaths, _, cx| {
                s.dragging = false;
                s.drop_on_homepage(paths.paths(), cx);
            }))
            .on_hover(move |hovered, _, cx| {
                if !*hovered {
                    let _ = host.update(cx, |s, cx| {
                        if s.dragging {
                            s.dragging = false;
                            cx.notify();
                        }
                    });
                }
            })
            .when(!has_projects, |d| {
                d.children(self.telemetry_disclosure(w, cx))
            })
            .into_any_element()
    }
    /// A folder dropped on the page opens; anything else says why not.
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
    /// Opens an entry in this window: a local folder, or a Cloud project
    /// (`selectCloudProject`); a folder's Cloud project is its own entry.
    fn open_item(&mut self, item: &Item, cx: &mut Context<Self>) {
        self.error = None;
        if let Some(remote) = &item.remote {
            // An offline or paused computer's folder stays listed, closed.
            if remote.available() {
                cx.emit(HomeEvent::OpenDevice(remote.clone(), item_name(item)));
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
    /// `OnboardingCreateProjectAction`: "New project", the default path.
    fn create_action(&self, prominent: bool, busy: bool, cx: &mut Context<Self>) -> Button {
        Button::new("home-create-project")
            .variant(if prominent {
                ButtonVariant::PatternPrimary
            } else {
                ButtonVariant::Pattern
            })
            .icon(Icon::new("file-plus-2").small().stroke(1.85))
            .label(tr("onboarding.action.createLocalProject"))
            .accessibility_label(tr("onboarding.action.createLocalProject"))
            .disabled(busy)
            .text_size(px(theme::ty().ui.body))
            .font_weight(FontWeight::NORMAL)
            .on_click(cx.listener(|s, _, w, cx| s.begin_create_project(w, cx)))
    }
    /// New project at the head of a page with projects; below the column's
    /// width it keeps its key and gives its words to assistive technology.
    fn create_action_compact(&self, narrow: bool, busy: bool, cx: &mut Context<Self>) -> Button {
        let label = tr("onboarding.action.createLocalProject");
        let button = Button::new("home-create-project")
            .variant(ButtonVariant::PatternPrimary)
            .icon(Icon::new("file-plus-2").small().stroke(1.85))
            .accessibility_label(label)
            .disabled(busy)
            .text_size(px(theme::ty().ui.body))
            .font_weight(FontWeight::NORMAL)
            .on_click(cx.listener(|s, _, w, cx| s.begin_create_project(w, cx)));
        if narrow {
            button.tooltip(label).px(px(11.))
        } else {
            button.label(label)
        }
    }
    /// `ImportAction` with its GitHub and GitLab preview: clone a repository
    /// into a new local project.
    fn import_action(&self, t: Theme, busy: bool, cx: &mut Context<Self>) -> Button {
        let label = tr("onboarding.action.importFromApps");
        Button::new("home-import")
            .variant(ButtonVariant::Pattern)
            .icon(Icon::new("download").small().stroke(1.85))
            .label(label)
            .disabled(busy)
            .text_size(px(theme::ty().ui.body))
            .font_weight(FontWeight::NORMAL)
            .on_click(cx.listener(|s, _, w, cx| s.begin_import(w, cx)))
            // `.onboarding-entry-import-brand-badge`, ringed in the control.
            .trailing(project_entry::import_badges(t, t.canvas, busy))
    }
}

/// Captures reach for the page the way a person would.
#[cfg(feature = "dev-capture")]
impl Homepage {
    /// "Create a project", named `name`.
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
    /// The pointer on the project at `index`; `false` before it is listed.
    pub(in crate::app) fn capture_hover(&mut self, index: usize, cx: &mut Context<Self>) -> bool {
        let Some(item) = self.visible_projects(cx).into_iter().nth(index) else {
            return false;
        };
        self.hovered = Some(item.id);
        cx.notify();
        true
    }
    /// The actions of the project at `index`, beside its trigger; `false`
    /// until the trigger is painted.
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
        // The intro's frames, and what follows its end.
        match &self.intro {
            Some(timeline) if timeline.finished() => {
                cx.defer_in(window, |h, _, cx| h.refresh(cx));
            }
            Some(_) => window.request_animation_frame(),
            None => {}
        }
        // A drag that ended outside any target leaves nothing dragged.
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn project_names_and_folders_display_like_the_product() {
        let project = |name: &str, path: &str| RecentProject {
            path: PathBuf::from(path),
            name: name.into(),
            opened_at: 0,
            host_folder: None,
        };
        assert_eq!(project_name(&project("Notes", "/a/notes")), "Notes");
        assert_eq!(project_name(&project("", "/a/notes")), "notes");
        assert_eq!(project_name(&project("/a/notes", "/a/notes")), "notes");
        assert_eq!(
            parent_for_display(Path::new("/Users/ada/project/x")),
            "~/project"
        );
        assert_eq!(parent_for_display(Path::new("/Users/ada/x")), "~");
        assert_eq!(
            parent_for_display(Path::new("/private/tmp/x")),
            "/private/tmp"
        );
    }

    #[test]
    fn modification_times_round_down_to_minutes_hours_and_days() {
        let now = SystemTime::now();
        let ago = |secs: u64| modification_time(now - Duration::from_secs(secs), now);
        assert_eq!(ago(5), "Just now");
        assert_eq!(ago(150), "2 minutes ago");
        assert_eq!(ago(3 * 3600 + 5), "3 hours ago");
        assert_eq!(ago(26 * 3600), "1 day ago");
    }
}
