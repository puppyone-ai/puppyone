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
use super::*;
use crate::workspace::cloud::{
    catalog::{self, Item},
    locator::{self, Locator},
};
use crate::{
    features::settings::preference_types::RecentProject,
    localization::{TimeUnit, relative_past, t as tr, tf},
    platform::project_activity,
    theme::metric,
    ui::{
        appearance::ActiveAppearance,
        components::{
            Button, ButtonVariant, Icon, IconButton, Menu, MenuItem, PopoverMenu, ProductIcon,
        },
    },
};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};
use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

mod create_project;
mod first_run;
pub(in crate::shell) mod folder;
mod import_repository;
mod intro;
pub(in crate::shell) mod project_entry;
mod projects;
pub(super) use create_project::CreateProject;
pub(super) use import_repository::ImportRepository;
pub(in crate::shell) use projects::{HomeMenu, Place};

/// `--onboarding-column-width`: room for five folders across with
/// projects, 440px on first run.
const COLUMN_PROJECTS: f32 = 640.;
const COLUMN_EMPTY: f32 = 440.;
/// `.onboarding-homepage { width: min(680px, 100%) }`.
const PAGE_WIDTH: f32 = 680.;
/// `HOMEPAGE_FIRST_PAINT_BUDGET_MS`: the longest a list waits.
const FIRST_PAINT_BUDGET: Duration = Duration::from_millis(4000);

/// Homepage state held by the shell.
#[derive(Default)]
pub(super) struct Homepage {
    /// When each project last changed (`None`: unknown), by path.
    activity: HashMap<PathBuf, Option<SystemTime>>,
    /// `puppyoneGitRemote` of each checkout whose remotes were read
    /// (`hydrationState: "ready"`); an absent path is never linked.
    locators: HashMap<PathBuf, Option<Locator>>,
    /// The projects the activity was read for; a new list reads again.
    read_for: Option<Vec<PathBuf>>,
    /// The homepage was showing at the last frame.
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
    /// The project whose actions are open.
    pub actions: Option<String>,
    /// A folder is being dragged over the window.
    pub dragging: bool,
    /// `onboarding-homepage-error`: why a drop or opening failed.
    pub error: Option<String>,
    /// The empty-state intro that is playing.
    pub(in crate::shell) intro: Option<crate::ui::motion::Timeline>,
    /// Whether the visible Homepage had no projects at the last frame
    /// (`None` while it is hidden, so showing it again replays the intro).
    intro_empty: Option<bool>,
    /// This Homepage has shown the analytics disclosure; it stays for as
    /// long as the Homepage does (`shownForLaunch`).
    pub(in crate::shell) disclosure_shown: bool,
}
impl Homepage {
    pub fn list_held(&self) -> bool {
        self.list_held_since.is_some()
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

impl Shell {
    /// Web hides the workspace chrome on the homepage; so does the native shell.
    pub(super) fn home_visible(&self) -> bool {
        // A project on its way in takes the window from the Homepage.
        !self.fixture && !self.opening() && (self.home || self.files.workspace.is_none())
    }
    /// Hydrates the remembered projects (when each last changed, and its
    /// canonical Cloud locator) whenever the homepage or the Header project
    /// menu appears or the list changes, off the main thread. A visit ends
    /// when the page hides: its filter and shown dates go with it.
    pub(super) fn refresh_home_activity(&mut self, cx: &mut Context<Self>) {
        let shown = self.home_visible() || self.popover.is_some();
        let appeared = shown && !self.homepage.shown;
        if !self.home_visible() && !self.homepage.places.is_empty() {
            self.homepage.places.clear();
        }
        if appeared && self.home_visible() {
            self.homepage.shown_dates.clear();
            self.homepage.menu = None;
        }
        self.homepage.shown = shown;
        let paths: Vec<PathBuf> = self
            .recent_projects
            .iter()
            .map(|p| p.path.clone())
            .collect();
        if !shown || (!appeared && self.homepage.read_for.as_ref() == Some(&paths)) {
            return;
        }
        self.homepage.read_for = Some(paths.clone());
        self.homepage.reading = true;
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
                s.homepage.locators = read
                    .iter()
                    .filter_map(|(path, _, remote)| Some((path.clone(), remote.clone()?)))
                    .collect();
                s.homepage.activity = read
                    .into_iter()
                    .map(|(path, changed, _)| (path, changed))
                    .collect();
                s.homepage.reading = false;
                // The list is whole: it may be seen now.
                s.homepage.list_held_since = None;
                cx.notify();
            });
        })
        .detach();
    }
    /// `useHomepageListHold`: Home leaves at once and only the list waits,
    /// so the project just left is in its new place the first time it shows.
    pub(super) fn hold_home_list(&mut self) {
        self.homepage.list_held_since = Some(Instant::now());
        // A re-read even of an unchanged list, as the product refreshes it.
        self.homepage.read_for = None;
    }
    /// `useHomepageFirstPaint`: `true` while the first Homepage of an
    /// account still waits for its list (whole, final order), up to four
    /// seconds; the window shows the restoring mark meanwhile.
    pub(super) fn home_first_paint_pending(&mut self, window: &mut Window, cx: &App) -> bool {
        if !self.home_visible() || self.restoring() {
            return false;
        }
        let account = crate::features::cloud_account::broker_and_binding(cx)
            .filter(|_| crate::features::flags::cloud_enabled(&self.preferences, cx))
            .map(|(_, b)| format!("{}\n{}", b.environment.api(), b.user));
        if self.homepage.released_for.as_ref() == Some(&account) {
            return false;
        }
        let since = *self.homepage.first_paint.get_or_insert_with(Instant::now);
        let catalog_settled = account.is_none()
            || matches!(
                self.cloud_catalog.read(cx).state,
                crate::features::cloud_catalog::State::Ready(_)
                    | crate::features::cloud_catalog::State::Failed
            );
        let settled = !self.homepage.reading && self.homepage.read_for.is_some() && catalog_settled;
        if settled || since.elapsed() >= FIRST_PAINT_BUDGET {
            self.homepage.released_for = Some(account);
            self.homepage.first_paint = None;
            self.homepage.list_held_since = None;
            return false;
        }
        window.request_animation_frame();
        true
    }
    /// `useHomepageCloudProjects().items`: the one flat project list the
    /// Homepage and the Header project menu share. Location chooses icons
    /// and actions, never the rank; Cloud entries come only from the
    /// current account's catalog, and a folder links to one only through
    /// its freshly read, trusted Project-root locator.
    pub(super) fn project_items(&self, cx: &App) -> Vec<Item> {
        use crate::features::cloud_catalog::State;
        let account = crate::features::cloud_account::broker_and_binding(cx)
            .map(|(_, binding)| binding)
            .filter(|_| crate::features::flags::cloud_enabled(&self.preferences, cx));
        let catalog = self.cloud_catalog.read(cx);
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
            .recent_projects
            .iter()
            .map(|p| catalog::LocalEntry {
                path: p.path.to_string_lossy().into_owned(),
                name: project_name(p),
                modified: self
                    .homepage
                    .activity
                    .get(&p.path)
                    .copied()
                    .flatten()
                    .and_then(millis),
                trusted_locator: api.as_deref().and_then(|api| {
                    self.homepage
                        .locators
                        .get(&p.path)
                        .cloned()
                        .flatten()
                        .filter(|l| {
                            locator::is_trusted_git_origin(
                                &l.origin,
                                api,
                                hosted_git_origin.as_deref(),
                            )
                        })
                }),
            })
            .collect();
        catalog::build(&local, cloud, activity)
    }
    /// `showEmptyStateIntro`: the intro plays whenever the Homepage appears
    /// (or loses its last project) with no projects, unless motion is
    /// reduced; the disclosure waits for it. Called once per frame.
    pub(super) fn sync_home_intro(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let visible = self.home_visible() && !self.restoring() && !self.first_run_sign_in(cx);
        if !visible {
            self.homepage.intro = None;
            self.homepage.intro_empty = None;
            self.homepage.disclosure_shown = false;
            return;
        }
        let empty = self.project_items(cx).is_empty();
        if self.homepage.intro_empty != Some(empty) {
            self.homepage.intro_empty = Some(empty);
            self.homepage.intro = (empty && !cx.reduce_motion())
                .then(|| crate::ui::motion::Timeline::start(intro::TOTAL));
        }
        match self.homepage.intro {
            Some(timeline) if timeline.finished() => self.homepage.intro = None,
            Some(_) => window.request_animation_frame(),
            None => {}
        }
        // `OnboardingTelemetryDisclosure ready={!showEmptyStateIntro}`: shown
        // on an empty Homepage once the intro is over, then marked seen.
        if empty
            && self.homepage.intro.is_none()
            && !self.homepage.disclosure_shown
            && let Some(telemetry) = crate::features::telemetry::global(cx)
            && telemetry.read(cx).disclosure_required()
        {
            self.homepage.disclosure_shown = true;
            telemetry.update(cx, |t, cx| t.disclosure_presented(cx));
        }
    }
    /// The pixel lab's Homepage (`shell-home-*`): no fixture workspace and
    /// no capture of its own. `played` starts after the intro, as if it had
    /// already run; otherwise it plays (held by `PUPPYONE_MOTION_AT`).
    #[cfg(feature = "dev-capture")]
    pub fn lab_home(&mut self, played: bool) {
        self.fixture = false;
        self.captured = true;
        if played {
            self.homepage.intro_empty = Some(true);
        }
    }
    /// Dev builds: Alt+Shift+L replays the intro on an empty Homepage.
    pub(super) fn replay_home_intro(&mut self, cx: &mut Context<Self>) -> bool {
        if !cfg!(debug_assertions)
            || self.homepage.intro.is_some()
            || self.homepage.intro_empty != Some(true)
        {
            return false;
        }
        self.homepage.intro = Some(crate::ui::motion::Timeline::start(intro::TOTAL));
        cx.notify();
        true
    }
    /// The curtain over the whole window while the intro plays.
    pub(super) fn home_intro_curtain(&self, w: f32, h: f32, cx: &App) -> Option<AnyElement> {
        let timeline = self.homepage.intro.as_ref()?;
        let frame = intro::current(timeline, w, h);
        Some(intro::curtain(frame.radius, w, h, cx.palette().dark).into_any_element())
    }
    /// `.onboarding-telemetry-disclosure`: one caption line in the bottom
    /// end corner, the Learn More link underlined at 45%.
    fn telemetry_disclosure(&self, w: f32, cx: &App) -> Option<AnyElement> {
        if !self.homepage.disclosure_shown || self.homepage.intro.is_some() {
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
    pub(super) fn home_view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if self.restoring() || self.home_first_paint_pending(window, cx) {
            return self.restoring_view(cx).into_any_element();
        }
        self.sync_project_view(cx);
        let t = cx.palette();
        let all = self.project_items(cx);
        let has_projects = !all.is_empty() || self.homepage.list_held();
        let busy = self.pending
            || self.files.busy()
            || self.files.folder_busy
            || self.files.cloud_opening().is_some();
        let (w, h) = (self.layout.header.w, self.layout.editor.bottom());
        let pad = metric::UTILITY_PADDING_INLINE;
        let page_w = PAGE_WIDTH.min(w - pad * 2.).max(0.);
        let column = if has_projects {
            COLUMN_PROJECTS
        } else {
            COLUMN_EMPTY
        }
        .min(page_w);
        let error = self.homepage.error.clone().map(|error| {
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
            .homepage
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
            let list = self.project_list(items, column, busy, window, cx);
            // `.onboarding-home-primary[data-onboarding-primary="projects"]`:
            // the projects sit on the page; a fill appears only for a drop.
            let primary = div()
                .flex_1()
                .min_h_0()
                .w_full()
                .flex()
                .flex_col()
                .rounded(px(metric::CARD_RADIUS))
                .when(self.homepage.dragging, |d| d.bg(t.hover))
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
                .when(self.homepage.dragging, |d| d.bg(t.hover))
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
                        .when(self.homepage.dragging, |b| b.bg(t.control_hover))
                        .on_click(cx.listener(|s, _, w, cx| s.command(Command::OpenFolder, w, cx))),
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
                if !s.homepage.dragging {
                    s.homepage.dragging = true;
                    cx.notify();
                }
            }))
            .on_drop(cx.listener(move |s, paths: &ExternalPaths, w, cx| {
                s.homepage.dragging = false;
                s.drop_on_homepage(paths.paths(), w, cx);
            }))
            .on_hover(move |hovered, _, cx| {
                if !*hovered {
                    let _ = host.update(cx, |s, cx| {
                        if s.homepage.dragging {
                            s.homepage.dragging = false;
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
    /// `HomepageCloudStatus`: the account, never a project row. Loading,
    /// a failure (with what helps) or an empty catalog lead it; then the
    /// account's initial, or Sign in.
    pub(super) fn homepage_account(&self, cx: &mut Context<Self>) -> AnyElement {
        use crate::features::cloud_account::Status;
        use crate::features::cloud_catalog::State;
        let t = cx.palette();
        let ty = theme::ty().header;
        let account = cx
            .try_global::<crate::features::cloud_account::CloudAccountService>()
            .map(|s| s.0.read(cx).snapshot.clone())
            .unwrap_or_default();
        let status = account.as_ref().map(|a| a.status);
        let email = account
            .as_ref()
            .and_then(|a| a.account.as_ref())
            .map(|a| a.email.clone());
        let restoring = status == Some(Status::Restoring);
        let signing_in = status == Some(Status::SigningIn);
        let auth_error = account
            .as_ref()
            .filter(|a| a.account.is_none())
            .and_then(|a| a.error);
        let catalog = self.cloud_catalog.read(cx).state.clone();
        let text = |text: String, color: Rgba| {
            div()
                .min_w_0()
                .truncate()
                .text_size(px(ty.content))
                .line_height(px(ty.line_height))
                .text_color(color)
                .child(text)
        };
        let feedback: Option<AnyElement> = if self.files.cloud_opening().is_some() {
            None
        } else if catalog == State::Failed || auth_error.is_some() {
            let label = match &auth_error {
                Some(error) => error.to_string(),
                None => tr("cloud.catalog.loadFailed").to_owned(),
            };
            let sign_in = auth_error.is_some();
            Some(
                h_flex()
                    .min_w_0()
                    .gap(px(8.))
                    .child(text(label, t.danger))
                    .child(
                        Button::new("homepage-cloud-retry")
                            .variant(ButtonVariant::Titlebar)
                            .label(tr("cloud.common.retry"))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                if sign_in {
                                    crate::features::cloud_account::sign_in(cx);
                                } else {
                                    s.refresh_cloud_catalog(true, cx);
                                }
                            })),
                    )
                    .into_any_element(),
            )
        } else if restoring || catalog == State::Loading || (email.is_none() && signing_in) {
            Some(
                h_flex()
                    .gap(px(6.))
                    .child(
                        crate::ui::loading::LoadingMark::new("homepage-cloud-loading")
                            .size(crate::ui::loading::LoaderSize::Xs)
                            .tone(crate::ui::loading::Tone::Neutral),
                    )
                    .child(text(
                        tr(if signing_in {
                            "cloud.home.waitingForSignIn"
                        } else {
                            "cloud.home.loading"
                        })
                        .to_owned(),
                        t.utility,
                    ))
                    .into_any_element(),
            )
        } else if email.is_some()
            && matches!(&catalog, State::Ready(list) if list.is_empty())
            && self.project_items(cx).is_empty()
        {
            Some(text(tr("cloud.catalog.empty").to_owned(), t.utility).into_any_element())
        } else {
            None
        };
        let entry: Option<AnyElement> = (!restoring).then(|| match &email {
            Some(email) => {
                let initial = email
                    .trim()
                    .chars()
                    .next()
                    .map(|c| c.to_uppercase().to_string())
                    .unwrap_or_else(|| "P".into());
                let size = 22.;
                div()
                    .id("homepage-cloud-avatar")
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(size))
                    .mr(px((theme::control() - 4. - size) / 2.))
                    .rounded_full()
                    .bg(t.control)
                    .text_color(t.utility)
                    .text_size(px(ty.content))
                    .line_height(px(ty.line_height))
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.control_hover).text_color(t.text))
                    .tooltip(crate::ui::components::tooltip(format!(
                        "{}: {email}",
                        tr("settings.sidebar.account")
                    )))
                    .on_click(cx.listener(|s, _, w, cx| {
                        s.command(Command::Settings, w, cx);
                        s.task_ui.settings.update(cx, |settings, cx| {
                            settings.select_page(crate::features::settings::Page::Account, cx)
                        });
                    }))
                    .child(initial)
                    .into_any_element()
            }
            None => Button::new("homepage-cloud-sign-in")
                .variant(ButtonVariant::Titlebar)
                .label(tr("cloud.auth.signIn"))
                .accessibility_label(tr("cloud.auth.signInToCloud"))
                .pl(px(7.))
                .pr(px(8.))
                .text_size(px(ty.content))
                .line_height(px(ty.line_height))
                .on_click(cx.listener(|_, _, _, cx| crate::features::cloud_account::sign_in(cx)))
                .into_any_element(),
        });
        h_flex()
            .min_w_0()
            .max_w(px(360.))
            .h(px(theme::control() - 4.))
            .gap(px(8.))
            .justify_end()
            .children(feedback)
            .children(entry)
            .into_any_element()
    }
    /// A folder dropped on the page opens; anything else says why not.
    fn drop_on_homepage(&mut self, paths: &[PathBuf], window: &mut Window, cx: &mut Context<Self>) {
        match paths.iter().find(|p| p.is_dir()) {
            Some(folder) if paths.len() == 1 => {
                self.homepage.error = None;
                self.open_project(folder.clone(), window, cx);
            }
            _ => {
                self.homepage.error = Some(tr("onboarding.error.dropLocalFolder").into());
                cx.notify();
            }
        }
    }
    /// Opens an entry in this window: a local folder, or a Cloud project
    /// (`selectCloudProject`); a folder's Cloud project is its own entry.
    pub(super) fn open_item(&mut self, item: &Item, window: &mut Window, cx: &mut Context<Self>) {
        self.popover = None;
        self.homepage.error = None;
        match (&item.local_path, &item.cloud_project) {
            (Some(path), _) => self.open_project(PathBuf::from(path), window, cx),
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
