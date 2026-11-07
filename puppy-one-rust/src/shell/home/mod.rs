//! The homepage: port of `MinimalOnboarding`, `OnboardingHomeLayout`,
//! `OnboardingBrandLockup`, `OnboardingEntryActions` and
//! `styles/onboarding.css`. Shown with no open project and from the project
//! menu's Home item.
//!
//! With projects, the page is their area: a quiet head (filter, sort and
//! layout, then New project with the other ways to start behind its arrow)
//! and the projects, as the Grid or the List ([`projects`]), from the head to
//! the page's end. First run greets with the Puppy and the ways to start.
//!
//! - [`create_project`]: the "Create a project" dialog
//! - [`folder`]: the project folder and its marks
use super::{
    Command, at,
    dialogs::{DialogKey, DialogLayer},
    project_actions::ProjectActions,
    session::SessionView,
};
use crate::workspace::cloud::{
    catalog::{self, Item},
    locator::{self, Locator},
};
use crate::{
    features::{
        cloud::catalog::CloudCatalog,
        settings::{preference_types::RecentProject, preferences_store::PreferencesStore},
    },
    geometry::Rect,
    localization::{TimeUnit, relative_past, t as tr, tf},
    platform::project_activity,
    theme::{self, Theme, metric},
    ui::{
        appearance::ActiveAppearance,
        components::{
            Button, ButtonVariant, Icon, IconButton, Menu, MenuItem, PopoverMenu, ProductIcon,
        },
    },
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

mod create_project;
mod first_run;
pub(in crate::shell) mod folder;
mod import_repository;
mod intro;
pub(in crate::shell) mod project_entry;
mod projects;
mod template_import;
pub(super) use create_project::CreateProject;
pub(super) use import_repository::ImportRepository;
pub(in crate::shell) use projects::{HomeMenu, Place};
pub(super) use template_import::TemplateImport;

/// `--onboarding-column-width`: room for five folders across with
/// projects, 440px on first run.
const COLUMN_PROJECTS: f32 = 640.;
const COLUMN_EMPTY: f32 = 440.;
/// `.onboarding-homepage { width: min(680px, 100%) }`.
const PAGE_WIDTH: f32 = 680.;
/// `HOMEPAGE_FIRST_PAINT_BUDGET_MS`: the longest a list waits.
const FIRST_PAINT_BUDGET: Duration = Duration::from_millis(4000);

/// What the Homepage asks of the window.
pub(in crate::shell) enum HomeEvent {
    /// Open this local folder here.
    OpenProject(PathBuf),
    /// Open this Cloud project here.
    OpenCloud(String),
    /// A project just made: open it here (or, when `new_window`, in a
    /// window of its own) on `open`.
    OpenCreated {
        path: PathBuf,
        open: Option<PathBuf>,
        new_window: bool,
    },
    Command(Command),
}

/// The Homepage (`MinimalOnboarding` and its stores): the remembered and
/// Cloud projects it lists, its own state, and the ways into a new project
/// with their dialogs. What the window shows reaches it as a
/// [`SessionView`]; what it asks for leaves as a [`HomeEvent`].
pub(in crate::shell) struct Homepage {
    session: SessionView,
    preferences: Entity<PreferencesStore>,
    catalog: Entity<CloudCatalog>,
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
    /// The places the filter shows; it lasts only as long as the page.
    pub places: std::collections::BTreeSet<Place>,
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
    pub(in crate::shell) intro: Option<crate::ui::motion::Timeline>,
    /// Whether the visible Homepage had no projects at the last change
    /// (`None` while it is hidden, so showing it again replays the intro).
    intro_empty: Option<bool>,
    /// This Homepage has shown the analytics disclosure; it stays for as
    /// long as the Homepage does (`shownForLaunch`).
    pub(in crate::shell) disclosure_shown: bool,
    /// "Create a project", while its dialog is open.
    pub(in crate::shell) create: Option<CreateProject>,
    /// The template card, while it is open.
    pub(in crate::shell) template: Option<Box<TemplateImport>>,
    /// Cloning a repository into a new project, while its dialog is open.
    pub(in crate::shell) import: Option<ImportRepository>,
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
        cx.observe(&actions, |_, _, cx| cx.notify()).detach();
        crate::features::cloud::account::observe(window, cx, |h, _, cx| h.refresh(cx)).detach();
        // The disclosure follows the analytics state.
        if let Some(telemetry) = crate::features::telemetry::global(cx) {
            cx.observe(&telemetry, |_, _, cx| cx.notify()).detach();
        }
        Self {
            session: SessionView::default(),
            preferences,
            catalog,
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
            places: Default::default(),
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
pub(in crate::shell) fn item_name_or(item: &Item, untitled: &str) -> String {
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
/// `useProjectHomeItemCaption`: where an entry's project is.
fn item_caption(item: &Item) -> String {
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
pub(in crate::shell) fn path_for_display(path: &Path) -> String {
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
        if !self.session.home && !self.places.is_empty() {
            self.places.clear();
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
    pub(in crate::shell) fn hold_list(&mut self) {
        self.list_held_since = Some(Instant::now());
        // A re-read even of an unchanged list, as the product refreshes it.
        self.read_for = None;
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
            || matches!(
                catalog.state,
                crate::features::cloud::catalog::State::Failed
            )
            || (matches!(
                catalog.state,
                crate::features::cloud::catalog::State::Ready(_)
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
    pub(in crate::shell) fn project_items(&self, cx: &App) -> Vec<Item> {
        use crate::features::cloud::catalog::State;
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
    pub(in crate::shell) fn replay_intro(&mut self, cx: &mut Context<Self>) -> bool {
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
            let list = self.project_list(items, column, w <= 520., busy, window, cx);
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
    pub(in crate::shell) fn capture_create_project(
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
    pub(in crate::shell) fn capture_hover(&mut self, index: usize, cx: &mut Context<Self>) -> bool {
        let Some(item) = self.visible_projects(cx).into_iter().nth(index) else {
            return false;
        };
        self.hovered = Some(item.id);
        cx.notify();
        true
    }
    /// The actions of the project at `index`, beside its trigger; `false`
    /// until the trigger is painted.
    pub(in crate::shell) fn capture_actions(
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
