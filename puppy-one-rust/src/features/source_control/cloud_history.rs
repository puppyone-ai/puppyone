//! The Cloud History sidebar (`CloudWorkspaceHistorySidebar`,
//! `useCloudHistoryData`, `useCloudHistoryController`, `CloudCommitDetail`,
//! `useCloudCommitDetail`, `historyRepository`).
//!
//! Cloud commits draw as a lane graph (`HistoryGraphVisual` beside each
//! row, inline ref labels, ref-only rows that are not buttons); a commit's
//! detail uses the local History's hierarchy. The list reads summaries, 80
//! per page through the signed
//! cursor; a commit's paths load only when its detail opens. Reads share one
//! flight per page or commit across windows and paint a cached snapshot
//! while revalidating; the cache is bounded and keyed by account, session
//! generation, API and Project. The view is valid only for the scope it was
//! opened in: another Project, account, session or API closes it, and late
//! results of an older request are dropped.
use super::{diff, history, view_action, view_header, view_title};
use crate::{
    cloud::auth::{Broker, Cancellation, Error as AuthError, model::Binding},
    localization::{self, t as tr, tf},
    platform::{
        git_diff::{FileDiff, Status},
        git_history::{CommitChange, CommitSummary},
    },
    theme::{self, Theme},
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, Icon, IconButton},
    },
    workspace::cloud::{
        graph,
        history::{
            self as model, CACHE_ENTRIES, ChangeKind, Commit, History, Invalid, Label, LabelKind,
        },
    },
};
use futures_util::{FutureExt as _, future::Shared};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};
use std::{collections::HashMap, sync::Arc, time::Instant};

/// Why a read failed; the view shows its own copy, never server prose.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Auth(AuthError),
    Invalid(Invalid),
}
impl Failure {
    /// `isHistorySnapshotRestartError`: the server says the snapshot moved.
    fn restarts(self) -> bool {
        self == Self::Auth(AuthError::Http(409))
    }
}
type Load<T> = Shared<Task<Result<T, Failure>>>;

/// One in-flight read shared by every view that asked for it.
struct Flight<T: 'static> {
    id: u64,
    load: Load<T>,
    cancel: Cancellation,
    users: usize,
}
/// A view's hold on a flight: what the cache had, and the read in progress.
struct Subscription<T: 'static> {
    key: String,
    id: u64,
    cached: Option<T>,
    load: Load<T>,
}
/// One resource kind of [`Repository`]: snapshots and flights.
struct Store<T: 'static> {
    cache: crate::workspace::cloud::cache::Cache<T>,
    flights: HashMap<String, Flight<T>>,
}
impl<T: Clone + 'static> Store<T> {
    fn new() -> Self {
        Self {
            cache: crate::workspace::cloud::cache::Cache::new(CACHE_ENTRIES, model::TTL),
            flights: HashMap::new(),
        }
    }
    /// `activateSession`: another namespace drops every snapshot and
    /// cancels every read of the old one.
    fn activate(&mut self, namespace: &str) {
        self.cache.activate(namespace);
        self.flights.retain(|key, flight| {
            let keep = key.starts_with(namespace);
            if !keep {
                flight.cancel.cancel();
            }
            keep
        });
    }
    /// `acquire`: the cached snapshot (stale allowed) and the flight for
    /// `key`, joining one in progress or starting `read`.
    fn acquire(
        &mut self,
        namespace: &str,
        key: String,
        next: &mut u64,
        read: impl FnOnce(Cancellation) -> Task<Result<T, Failure>>,
    ) -> Subscription<T> {
        self.activate(namespace);
        let cached = self.cache.read(&key, Instant::now()).map(|(v, _)| v);
        let flight = self.flights.entry(key.clone()).or_insert_with(|| {
            *next += 1;
            let cancel = Cancellation::default();
            Flight {
                id: *next,
                load: read(cancel.clone()).shared(),
                cancel,
                users: 0,
            }
        });
        flight.users += 1;
        Subscription {
            key,
            id: flight.id,
            cached,
            load: flight.load.clone(),
        }
    }
    /// `release`: the last view leaving an unfinished read cancels it.
    fn release(&mut self, key: &str, id: u64) {
        if let Some(flight) = self.flights.get_mut(key).filter(|f| f.id == id) {
            flight.users = flight.users.saturating_sub(1);
            if flight.users == 0 {
                flight.cancel.cancel();
                self.flights.remove(key);
            }
        }
    }
    /// A flight finished: a success becomes the snapshot, a failure leaves
    /// nothing behind. Only the flight that is still current writes.
    fn settle(&mut self, key: &str, id: u64, result: &Result<T, Failure>) {
        if self.flights.get(key).is_none_or(|f| f.id != id) {
            return;
        }
        self.flights.remove(key);
        match result {
            Ok(value) => self
                .cache
                .store(key.to_owned(), value.clone(), Instant::now()),
            Err(_) => self.cache.discard(key),
        }
    }
}
/// `historyRepository`: one per app, shared by every window.
struct Repository {
    pages: Store<History>,
    details: Store<Commit>,
    next: u64,
}
impl Default for Repository {
    fn default() -> Self {
        Self {
            pages: Store::new(),
            details: Store::new(),
            next: 0,
        }
    }
}
impl Global for Repository {}

/// What the open view reads for: the identity it was opened under.
#[derive(Clone)]
struct Scope {
    /// Account namespace (user, session generation, API).
    namespace: String,
    project: String,
    broker: Arc<Broker>,
    binding: Binding,
}
impl Scope {
    fn current(project: &str, cx: &App) -> Option<Self> {
        let (broker, binding) = crate::features::cloud::account::broker_and_binding(cx)?;
        Some(Self {
            namespace: format!(
                "{}\n{}\n{}\n",
                binding.user,
                binding.epoch,
                binding.environment.api()
            ),
            project: project.to_owned(),
            broker,
            binding,
        })
    }
    fn key(&self) -> String {
        format!("{}{}", self.namespace, self.project)
    }
    fn resource(&self, resource: &str) -> String {
        format!("{}\nlatest\n{resource}", self.key())
    }
}

/// `useCloudCommitDetail`.
#[derive(Clone, Debug, PartialEq)]
enum Detail {
    Loading,
    Ready(Commit),
    Failed,
}

pub enum CloudHistoryEvent {
    Close,
}

pub struct CloudHistory {
    scope: Option<Scope>,
    /// The Project and Web origin for "View code changes".
    link: Option<(String, String)>,
    /// `activeRequestRef`: a result for an older request is dropped.
    request: u64,
    page: Option<(String, u64)>,
    history: Option<History>,
    labels: HashMap<String, Vec<Label>>,
    commits: Vec<CommitSummary>,
    loading: bool,
    loading_more: bool,
    /// The failed read: `false` the first page, `true` a further one.
    error: Option<bool>,
    /// `selectedCommitId`: the head (or first) commit until one is chosen.
    selected: Option<String>,
    /// The commit whose detail is open.
    detail: Option<String>,
    detail_state: Option<Detail>,
    detail_read: Option<(String, u64)>,
    detail_request: u64,
    /// The page's rows with their lanes (`buildCloudBranchGraphRows`).
    graph: Vec<graph::Row>,
    graph_list: ListState,
    icon_theme: String,
    focus: FocusHandle,
    /// Waits for file activity in the Project to fall quiet.
    settling: Option<Task<()>>,
}
impl EventEmitter<CloudHistoryEvent> for CloudHistory {}
/// `contentSettledKey`: how long the Project's files stay quiet before
/// History reads what the activity recorded.
const ACTIVITY_QUIET: std::time::Duration = std::time::Duration::from_secs(2);

/// `toGitCommitSummary` for the shared timeline. The day groups by the
/// local calendar date of the Cloud time.
fn summary(commit: &Commit) -> CommitSummary {
    let created_at = commit
        .created_at
        .as_deref()
        .and_then(|iso| chrono::DateTime::parse_from_rfc3339(iso).ok())
        .map(|time| {
            let (y, m, d) = history::local_day(time.timestamp());
            format!("{y:04}-{m:02}-{d:02}")
        });
    CommitSummary {
        id: commit.id.clone(),
        parents: commit.parents.clone(),
        author_name: commit.who.clone(),
        author_email: String::new(),
        created_at,
        message: commit.message.clone(),
        changes: commit
            .changes
            .iter()
            .map(|change| CommitChange {
                path: change.path.clone(),
                old_path: None,
                status: status(change.kind),
                additions: None,
                deletions: None,
            })
            .collect(),
    }
}
fn status(kind: ChangeKind) -> Status {
    match kind {
        ChangeKind::Added => Status::Added,
        ChangeKind::Deleted => Status::Deleted,
        ChangeKind::Modified => Status::Modified,
    }
}
/// `formatRelativeTime` (Cloud): now, minutes, hours, days, then a date.
pub(crate) fn relative_time(iso: &str, now: i64) -> Option<String> {
    let time = chrono::DateTime::parse_from_rfc3339(iso).ok()?.timestamp();
    let delta = (now - time).abs();
    let round = |unit: i64| (delta + unit / 2) / unit;
    Some(match delta {
        d if d < 60 => localization::relative_now().to_owned(),
        d if d < 3_600 => localization::relative_past(round(60), localization::TimeUnit::Minute),
        d if d < 86_400 => localization::relative_past(round(3_600), localization::TimeUnit::Hour),
        d if d < 604_800 => match round(86_400) {
            1 => localization::relative_day(-1),
            n => localization::relative_past(n, localization::TimeUnit::Day),
        },
        _ => {
            let (y, m, d) = history::local_day(time);
            let this_year = history::local_day(now).0;
            localization::month_day((y != this_year).then_some(y), m, d)
        }
    })
}

/// `formatDate(iso, { month: "short", day: "numeric" })` in local time.
pub(crate) fn short_date(iso: &str) -> Option<String> {
    let time = chrono::DateTime::parse_from_rfc3339(iso).ok()?.timestamp();
    let (_, m, d) = history::local_day(time);
    Some(localization::month_day(None, m, d))
}

impl CloudHistory {
    pub fn new(cx: &mut Context<Self>) -> Self {
        cx.on_release(|s: &mut Self, cx| s.release(cx)).detach();
        Self {
            scope: None,
            link: None,
            request: 0,
            page: None,
            history: None,
            labels: HashMap::new(),
            commits: Vec::new(),
            loading: false,
            loading_more: false,
            error: None,
            selected: None,
            detail: None,
            detail_state: None,
            detail_read: None,
            detail_request: 0,
            graph: Vec::new(),
            graph_list: ListState::new(0, ListAlignment::Top, px(400.)),
            icon_theme: "default".into(),
            focus: cx.focus_handle(),
            settling: None,
        }
    }
    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus
    }
    pub fn set_icon_theme(&mut self, icon_theme: String, cx: &mut Context<Self>) {
        if self.icon_theme != icon_theme {
            self.icon_theme = icon_theme;
            cx.notify();
        }
    }
    /// The scope key History would open under for `project` now.
    pub fn scope_key(project: &str, cx: &App) -> Option<String> {
        Scope::current(project, cx).map(|s| s.key())
    }
    /// Open on `project` (a fresh view; the cache may paint at once).
    /// `false` without a signed-in account.
    pub fn open(&mut self, project: &str, cx: &mut Context<Self>) -> bool {
        let Some(scope) = Scope::current(project, cx) else {
            return false;
        };
        self.close(cx);
        self.link = Some((
            scope.project.clone(),
            scope
                .binding
                .environment
                .web()
                .trim_end_matches('/')
                .to_owned(),
        ));
        self.scope = Some(scope);
        self.load(cx);
        true
    }
    /// The open view still belongs to `project` under the current account.
    pub fn matches(&self, project: Option<&str>, cx: &App) -> bool {
        match (&self.scope, project) {
            (Some(scope), Some(project)) => {
                Self::scope_key(project, cx).as_deref() == Some(scope.key().as_str())
            }
            _ => false,
        }
    }
    /// History holds a scope (it opened and has not closed).
    pub fn is_open(&self) -> bool {
        self.scope.is_some()
    }
    /// Unmount: drop every read and the view's state.
    pub fn close(&mut self, cx: &mut Context<Self>) {
        self.release(cx);
        self.scope = None;
        self.link = None;
        self.request += 1;
        self.detail_request += 1;
        self.history = None;
        self.labels.clear();
        self.commits.clear();
        self.loading = false;
        self.loading_more = false;
        self.error = None;
        self.selected = None;
        self.detail = None;
        self.detail_state = None;
        self.rebuild();
        cx.notify();
    }
    fn release(&mut self, cx: &mut App) {
        let repository = cx.default_global::<Repository>();
        if let Some((key, id)) = self.page.take() {
            repository.pages.release(&key, id);
        }
        if let Some((key, id)) = self.detail_read.take() {
            repository.details.release(&key, id);
        }
    }
    fn rebuild(&mut self) {
        self.graph = self.history.as_ref().map(graph::rows).unwrap_or_default();
        self.graph_list.reset(self.graph.len());
    }
    /// A history arrived (first page, cache or a merge).
    fn adopt(&mut self, history: History) {
        self.labels = model::labels(&history);
        self.commits = history.commits.iter().map(summary).collect();
        let present = |id: &str| history.commits.iter().any(|c| c.id == id);
        if !self.selected.as_deref().is_some_and(&present) {
            self.selected = history
                .head
                .clone()
                .filter(|h| present(h))
                .or_else(|| history.commits.first().map(|c| c.id.clone()));
        }
        if self.detail.as_deref().is_some_and(|id| !present(id)) {
            self.detail = None;
            self.detail_state = None;
        }
        self.history = Some(history);
        self.rebuild();
    }
    fn page_read(
        scope: &Scope,
        cursor: Option<String>,
        cx: &mut Context<Self>,
    ) -> Subscription<History> {
        let key = scope.resource(&format!("page:{}", cursor.as_deref().unwrap_or("first")));
        let (broker, binding, project) = (
            scope.broker.clone(),
            scope.binding.clone(),
            scope.project.clone(),
        );
        let executor = cx.background_executor().clone();
        let repository = cx.default_global::<Repository>();
        let next = &mut repository.next;
        repository
            .pages
            .acquire(&scope.namespace, key, next, move |cancel| {
                executor.spawn(async move {
                    let continuation = cursor.is_some();
                    let request = model::page_request(&project, cursor.as_deref())
                        .ok_or(Failure::Invalid(Invalid::Project))?;
                    let value = broker
                        .request_scoped(&binding, &request, &cancel)
                        .map_err(Failure::Auth)?;
                    model::parse_page(&value, &project, continuation).map_err(Failure::Invalid)
                })
            })
    }
    /// A hosted run's accepted changes: an open History reads its first page
    /// again (`useCloudHistoryData` refreshes after publication).
    pub fn refresh_published(&mut self, cx: &mut Context<Self>) {
        if self.is_open() {
            self.load(cx);
        }
    }
    /// The Project's files changed. Once they have been quiet for two
    /// seconds an open History reads its first page again, so a burst of
    /// writes reads it once (`contentSettledKey`).
    pub fn file_activity(&mut self, cx: &mut Context<Self>) {
        self.settling = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(ACTIVITY_QUIET).await;
            let _ = this.update(cx, |h, cx| {
                h.settling = None;
                h.refresh_published(cx);
            });
        }));
    }
    /// `load` (also Refresh and the first page's Try again).
    pub fn load(&mut self, cx: &mut Context<Self>) {
        self.request += 1;
        let request = self.request;
        let Some(scope) = self.scope.clone() else {
            return;
        };
        self.loading = true;
        self.loading_more = false;
        self.error = None;
        if let Some((key, id)) = self.page.take() {
            cx.default_global::<Repository>().pages.release(&key, id);
        }
        let subscription = Self::page_read(&scope, None, cx);
        self.page = Some((subscription.key.clone(), subscription.id));
        if let Some(cached) = subscription.cached {
            self.loading = false;
            self.adopt(cached);
        }
        let (key, id, load) = (subscription.key, subscription.id, subscription.load);
        cx.spawn(async move |this, cx| {
            let result = load.await;
            let _ = this.update(cx, |s, cx| {
                cx.default_global::<Repository>()
                    .pages
                    .settle(&key, id, &result);
                if s.page.as_ref() == Some(&(key.clone(), id)) {
                    s.page = None;
                }
                if s.request != request {
                    return;
                }
                s.loading = false;
                match result {
                    Ok(history) => s.adopt(history),
                    Err(_) => {
                        s.history = None;
                        s.labels.clear();
                        s.commits.clear();
                        s.rebuild();
                        s.error = Some(false);
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    /// `loadMore`: one flight per cursor; a moved snapshot restarts.
    pub fn load_more(&mut self, cx: &mut Context<Self>) {
        let (Some(scope), Some(current)) = (self.scope.clone(), self.history.clone()) else {
            return;
        };
        let Some(cursor) = current.next_cursor.clone().filter(|_| current.more()) else {
            return;
        };
        if self.loading || self.loading_more {
            return;
        }
        self.request += 1;
        let request = self.request;
        self.loading_more = true;
        self.error = None;
        if let Some((key, id)) = self.page.take() {
            cx.default_global::<Repository>().pages.release(&key, id);
        }
        let subscription = Self::page_read(&scope, Some(cursor), cx);
        self.page = Some((subscription.key.clone(), subscription.id));
        let (key, id, load) = (subscription.key, subscription.id, subscription.load);
        cx.spawn(async move |this, cx| {
            let result = load.await;
            let _ = this.update(cx, |s, cx| {
                cx.default_global::<Repository>()
                    .pages
                    .settle(&key, id, &result);
                if s.page.as_ref() == Some(&(key.clone(), id)) {
                    s.page = None;
                }
                if s.request != request {
                    return;
                }
                s.loading_more = false;
                let merged = match result {
                    Ok(page) => model::merge(&current, page).map_err(|_| true),
                    Err(failure) => Err(failure.restarts()),
                };
                match merged {
                    Ok(history) => {
                        if s.history
                            .as_ref()
                            .is_some_and(|h| h.snapshot == current.snapshot)
                        {
                            s.adopt(history);
                        }
                    }
                    Err(true) => s.load(cx),
                    Err(false) => s.error = Some(true),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    /// A commit row: select it and open its detail.
    fn show_detail(&mut self, id: String, cx: &mut Context<Self>) {
        self.selected = Some(id.clone());
        self.detail = Some(id);
        self.read_detail(cx);
        cx.notify();
    }
    /// `useCloudCommitDetail`: a summary's paths load on demand.
    fn read_detail(&mut self, cx: &mut Context<Self>) {
        self.detail_request += 1;
        let request = self.detail_request;
        if let Some((key, id)) = self.detail_read.take() {
            cx.default_global::<Repository>().details.release(&key, id);
        }
        let (Some(scope), Some(commit)) = (self.scope.clone(), self.detail_commit().cloned())
        else {
            self.detail_state = None;
            return;
        };
        if commit.changes_loaded {
            self.detail_state = Some(Detail::Ready(commit));
            return;
        }
        let key = scope.resource(&format!("detail:{}", commit.id));
        let (broker, binding, project, id) = (
            scope.broker.clone(),
            scope.binding.clone(),
            scope.project.clone(),
            commit.id.clone(),
        );
        let executor = cx.background_executor().clone();
        let repository = cx.default_global::<Repository>();
        let next = &mut repository.next;
        let subscription = repository
            .details
            .acquire(&scope.namespace, key, next, move |cancel| {
                executor.spawn(async move {
                    let request = model::detail_request(&project, &id)
                        .ok_or(Failure::Invalid(Invalid::Project))?;
                    let value = broker
                        .request_scoped(&binding, &request, &cancel)
                        .map_err(Failure::Auth)?;
                    model::parse_detail(&value, &id).map_err(Failure::Invalid)
                })
            });
        self.detail_state = Some(match subscription.cached {
            Some(cached) => Detail::Ready(cached),
            None => Detail::Loading,
        });
        self.detail_read = Some((subscription.key.clone(), subscription.id));
        let (key, id, load) = (subscription.key, subscription.id, subscription.load);
        cx.spawn(async move |this, cx| {
            let result = load.await;
            let _ = this.update(cx, |s, cx| {
                cx.default_global::<Repository>()
                    .details
                    .settle(&key, id, &result);
                if s.detail_read.as_ref() == Some(&(key.clone(), id)) {
                    s.detail_read = None;
                }
                if s.detail_request != request {
                    return;
                }
                s.detail_state = Some(match result {
                    Ok(commit) => Detail::Ready(commit),
                    Err(_) => Detail::Failed,
                });
                cx.notify();
            });
        })
        .detach();
    }
    fn detail_commit(&self) -> Option<&Commit> {
        let id = self.detail.as_deref()?;
        self.history.as_ref()?.commits.iter().find(|c| c.id == id)
    }
    /// Back (and Escape): from a commit to the list, from the list out of
    /// History.
    pub fn back(&mut self, cx: &mut Context<Self>) {
        if self.detail.take().is_some() {
            self.detail_state = None;
            self.detail_request += 1;
            if let Some((key, id)) = self.detail_read.take() {
                cx.default_global::<Repository>().details.release(&key, id);
            }
            cx.notify();
        } else {
            cx.emit(CloudHistoryEvent::Close);
        }
    }

    // ------------------------------------------------------------- views
    fn notices(&self, t: Theme, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let m = theme::ty();
        let notice = || {
            div()
                .px(px(16.))
                .py(px(12.))
                .text_size(px(m.ui.meta))
                .line_height(relative(theme::NORMAL_LINE_HEIGHT))
        };
        let mut notices = Vec::new();
        if let Some(more) = self.error {
            let busy = self.loading || self.loading_more;
            notices.push(
                notice()
                    .text_color(t.danger)
                    .child(tr(if more {
                        "cloud.message.history-load-more-failed"
                    } else {
                        "cloud.message.history-load-failed"
                    }))
                    .child(
                        div().pt(px(8.)).child(
                            Button::new("cloud-history-retry")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.common.tryAgain"))
                                .disabled(busy)
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    if more { s.load_more(cx) } else { s.load(cx) }
                                })),
                        ),
                    )
                    .into_any_element(),
            );
        }
        if let Some(count) = self.history.as_ref().and_then(History::warning) {
            notices.push(
                notice()
                    .text_color(t.muted)
                    .child(if count > 0 {
                        tf(
                            "cloud.message.history-degraded-count",
                            &[("count", count.into())],
                        )
                    } else {
                        tr("cloud.message.history-degraded").to_owned()
                    })
                    .into_any_element(),
            );
        }
        notices
    }
    /// `.desktop-git-history-sidebar-state`.
    fn state(text: &str, t: Theme) -> Div {
        let m = theme::ty();
        v_flex()
            .flex_1()
            .min_h_0()
            .items_center()
            .justify_center()
            .p(px(20.))
            .text_size(px(m.right.meta))
            .line_height(px(m.right.meta_line_height))
            .text_color(t.subtle)
            .child(text.to_owned())
    }
    /// `.desktop-cloud-history-ref-badge` (and `.desktop-head-badge`).
    fn badge(text: String, kind: Option<LabelKind>, t: Theme) -> Div {
        let (border, fill, color) = match kind {
            None => (
                theme::alpha(t.success, 0.2),
                theme::alpha(t.success, 0.07),
                theme::mix(t.success, t.muted, 0.52),
            ),
            Some(LabelKind::Cloud) => (
                theme::alpha(t.success, 0.28),
                theme::alpha(t.success, 0.1),
                t.success,
            ),
            Some(LabelKind::Tag) => {
                let tag = theme::history_tag();
                (
                    theme::alpha(tag, 0.34),
                    theme::alpha(tag, 0.09),
                    theme::mix(tag, t.text, 0.72),
                )
            }
        };
        div()
            .flex_none()
            .flex()
            .items_center()
            .h(px(16.))
            .max_w(px(180.))
            .px(px(4.))
            .overflow_hidden()
            .border_1()
            .border_color(border)
            .rounded(px(3.))
            .bg(fill)
            .text_color(color)
            .text_size(px(theme::ty().ui.micro))
            .line_height(relative(1.))
            .font_weight(FontWeight(620.))
            .truncate()
            .child(text)
    }
    /// `.desktop-cloud-commit-actions button`.
    fn commit_action(id: &'static str, icon: &'static str, label: &str, t: Theme) -> IconButton {
        IconButton::new(id, Icon::new(icon).with_size(px(13.)))
            .label(label.to_owned())
            .w(px(24.))
            .h(px(theme::control_tight()))
            .color(t.subtle)
            .rounded(px(5.))
    }
    /// `CloudCommitDetail`.
    fn detail_view(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let summary = self.detail_commit()?;
        let t = cx.palette();
        let m = theme::ty();
        let state = self.detail_state.clone().unwrap_or(Detail::Loading);
        let commit = match &state {
            Detail::Ready(commit) => commit,
            _ => summary,
        };
        let history = self.history.as_ref()?;
        let head = history.head.as_deref() == Some(commit.id.as_str());
        let labels: Vec<Label> = self
            .labels
            .get(&commit.id)
            .into_iter()
            .flatten()
            .filter(|l| !(head && l.name == "HEAD"))
            .cloned()
            .collect();
        let (project, web) = self.link.clone().unzip();
        let commit_id = commit.id.clone();
        let author = if commit.who.is_empty() {
            tr("cloud.graph.author.cloud").to_owned()
        } else {
            commit.who.clone()
        };
        let time = commit
            .created_at
            .as_deref()
            .and_then(|iso| relative_time(iso, history::now()))
            .unwrap_or_else(|| tr("cloud.history.timeUnavailable").to_owned());
        let id_row = h_flex()
            .w_full()
            .min_w_0()
            .flex_wrap()
            .gap(px(8.))
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(m.ui.heading))
                    .line_height(relative(theme::NORMAL_LINE_HEIGHT))
                    .font_weight(FontWeight(650.))
                    .text_color(t.text)
                    .child(commit.id.chars().take(8).collect::<String>()),
            )
            .when(head, |d| d.child(Self::badge("HEAD".into(), None, t)))
            .children(labels.into_iter().map(|l| {
                let name = if l.name.is_empty() {
                    tr("cloud.graph.label.cloud-history").to_owned()
                } else {
                    l.name
                };
                Self::badge(name, Some(l.kind), t)
            }))
            .child(
                h_flex()
                    .ml_auto()
                    .gap(px(2.))
                    .child(
                        IconButton::new(
                            "cloud-commit-refresh",
                            if self.loading {
                                Icon::new("refresh-cw")
                                    .with_size(px(13.))
                                    .spinning("cloud-commit-refresh-spin")
                            } else {
                                Icon::new("refresh-cw").with_size(px(13.))
                            },
                        )
                        .label(tr("cloud.history.refresh"))
                        .w(px(24.))
                        .h(px(theme::control_tight()))
                        .color(t.subtle)
                        .rounded(px(5.))
                        .disabled(self.loading)
                        .on_click(cx.listener(|s, _, _, cx| s.load(cx))),
                    )
                    .when_some(project.zip(web), |d, (project, web)| {
                        d.child(
                            Self::commit_action(
                                "cloud-commit-web",
                                "external-link",
                                tr("cloud.history.viewCodeChanges"),
                                t,
                            )
                            .on_click(move |_, _, _| {
                                // `openCloudApp`: the Web app's change view.
                                let url =
                                    format!("{web}/projects/{project}/changes?commit={commit_id}");
                                let _ = crate::platform::desktop::open_url(&url);
                            }),
                        )
                    }),
            );
        let summary_block = v_flex()
            .w_full()
            .min_w_0()
            .gap(px(9.))
            .pb(px(18.))
            .child(id_row)
            .child(
                div()
                    .text_size(px(m.ui.body))
                    .font_weight(FontWeight::MEDIUM)
                    .line_height(relative(1.45))
                    .text_color(t.muted)
                    .child(if commit.message.is_empty() {
                        tr("cloud.history.updateWorkspace").to_owned()
                    } else {
                        commit.message.clone()
                    }),
            )
            .child(
                h_flex()
                    .flex_wrap()
                    .gap_x(px(10.))
                    .gap_y(px(4.))
                    .text_size(px(m.right.meta))
                    .line_height(relative(theme::NORMAL_LINE_HEIGHT))
                    .text_color(t.muted)
                    .child(author)
                    .child(time)
                    .child(tf(
                        "source-control.commit.parentCount",
                        &[("count", commit.parents.len().into())],
                    )),
            );
        let stats = commit.changes_loaded.then(|| {
            h_flex()
                .w_full()
                .flex_wrap()
                .justify_end()
                .gap(px(8.))
                .mb(px(16.))
                .text_size(px(m.ui.meta))
                .line_height(relative(theme::NORMAL_LINE_HEIGHT))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(t.subtle)
                .child(tf(
                    "cloud.history.fileChangeCount",
                    &[("count", commit.changes.len().into())],
                ))
                .child(div().text_color(t.success).child("+0"))
                .child(div().text_color(t.danger).child("-0"))
        });
        let empty = |text: &str| {
            div()
                .px(px(16.))
                .py(px(14.))
                .text_size(px(m.ui.meta))
                .line_height(relative(theme::NORMAL_LINE_HEIGHT))
                .italic()
                .text_color(t.subtle)
                .child(text.to_owned())
        };
        let body = match state {
            Detail::Loading => empty(tr("cloud.history.loading")).into_any_element(),
            Detail::Failed => h_flex()
                .gap(px(8.))
                .child(empty(tr("cloud.history.unavailable")))
                .child(
                    Button::new("cloud-commit-retry")
                        .variant(ButtonVariant::GitAction)
                        .label(tr("cloud.common.tryAgain"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.read_detail(cx);
                            cx.notify();
                        })),
                )
                .into_any_element(),
            Detail::Ready(_) if commit.changes.is_empty() => {
                empty(tr("cloud.history.noPathChanges")).into_any_element()
            }
            Detail::Ready(_) => {
                let palette = diff::DiffPalette::new(t);
                v_flex()
                    .w_full()
                    .min_w_0()
                    .gap(px(10.))
                    .children(commit.changes.iter().map(|change| {
                        diff::metadata(
                            &FileDiff {
                                path: change.path.clone(),
                                old_path: None,
                                status: status(change.kind),
                                additions: None,
                                deletions: None,
                                binary: true,
                                lines: Vec::new(),
                                truncated: false,
                                omitted_lines: 0,
                                revision: None,
                                redline: None,
                            },
                            &palette,
                        )
                    }))
                    .into_any_element()
            }
        };
        Some(
            div()
                .id("cloud-history-detail")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .child(
                    v_flex()
                        .w_full()
                        .min_w_0()
                        .pt(px(12.))
                        .px(px(18.))
                        .pb(px(32.))
                        .child(summary_block)
                        .children(stats)
                        .child(body),
                )
                .into_any_element(),
        )
    }
}

/// The pixel lab (`cloud-history-*`): the product fixture's page and
/// detail, without a session or reads (`tools/reference-cloud-entry.tsx`).
#[cfg(feature = "dev-capture")]
impl CloudHistory {
    pub fn lab_fixture(
        &mut self,
        scenario: &str,
        data: &serde_json::Value,
        cx: &mut Context<Self>,
    ) {
        let page = &data[if scenario == "history-empty" {
            "empty"
        } else {
            "page"
        }];
        let project = data["page"]["project_id"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let web = data["web"].as_str().unwrap_or_default().to_owned();
        self.link = Some((project.clone(), web));
        if let Ok(history) = model::parse_page(page, &project, false) {
            self.adopt(history);
        }
        if scenario == "history-detail"
            && let Some(first) = self.commits.first().map(|c| c.id.clone())
        {
            self.selected = Some(first.clone());
            self.detail = Some(first.clone());
            self.detail_state = model::parse_detail(&data["detail"], &first)
                .ok()
                .map(Detail::Ready);
        }
        cx.notify();
    }
}

impl CloudHistory {
    /// Tests: the `index`-th commit of the page opens its detail.
    #[cfg(test)]
    fn open_commit(&mut self, index: usize, cx: &mut Context<Self>) {
        if let Some(id) = self.commits.get(index).map(|c| c.id.clone()) {
            self.show_detail(id, cx);
        }
    }
    /// `CloudProjectHistorySidebar`'s list: the rows in a "Commit history"
    /// list, the lane graph as wide as the page needs.
    fn graph_view(&self, cx: &mut Context<Self>) -> AnyElement {
        let host = cx.weak_entity();
        let width = graph::width(&self.graph);
        div()
            .id("cloud-history-graph")
            .role(Role::List)
            .aria_label(tr("cloud.history.commitHistory"))
            .test_support()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                list(self.graph_list.clone(), move |index, _, cx| {
                    host.update(cx, |s, cx| s.graph_row(index, width, cx))
                        .unwrap_or_else(|_| div().into_any_element())
                })
                .flex_1()
                .min_h_0(),
            )
            .into_any_element()
    }
    /// `CloudHistorySidebarRow`: the lane cell, then HEAD and the message
    /// with its inline refs, then the change counts (a commit, a button) or
    /// the short commit id (a ref outside the page, not a button).
    fn graph_row(&self, index: usize, width: f32, cx: &mut Context<Self>) -> AnyElement {
        let Some(row) = self.graph.get(index).cloned() else {
            return div().into_any_element();
        };
        let t = cx.palette();
        let m = theme::ty();
        let height = theme::control();
        let selected = row.commit && self.selected.as_deref() == Some(row.id.as_str());
        let current = row.labels.iter().any(|l| l.current);
        let commit = self
            .history
            .as_ref()
            .and_then(|h| h.commits.iter().find(|c| c.id == row.id));
        let message = commit
            .map(|c| c.message.clone())
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| tr("cloud.history.updateWorkspace").to_owned());
        let background = if selected { t.selected } else { t.auxiliary() };
        let labels = row
            .labels
            .iter()
            .filter(|l| !(current && l.current && l.name == "HEAD"))
            .map(|l| {
                let name = if l.name.is_empty() {
                    tr("cloud.graph.label.cloud-history").to_owned()
                } else {
                    l.name.clone()
                };
                let selector = format!("cloud-history-ref:{name}");
                let kind = match l.kind {
                    graph::LabelKind::Cloud => LabelKind::Cloud,
                    graph::LabelKind::Tag => LabelKind::Tag,
                };
                Self::badge(name, Some(kind), t).debug_selector(move || selector)
            });
        let trailing = if row.commit {
            // `buildCloudCommitStats`: Cloud summaries carry no line counts.
            let zero = localization::format_number(0);
            let selector = format!("cloud-history-stat:+{zero}-{zero}");
            h_flex()
                .debug_selector(move || selector)
                .flex_none()
                .w(px(56.))
                .justify_end()
                .gap(px(4.))
                .text_size(px(m.ui.micro))
                .child(
                    div()
                        .text_color(theme::mix(t.success, t.subtle, 0.52))
                        .child(format!("+{zero}")),
                )
                .child(
                    div()
                        .text_color(theme::mix(t.danger, t.subtle, 0.52))
                        .child(format!("-{zero}")),
                )
                .into_any_element()
        } else {
            let short: String = row
                .id
                .strip_prefix("ref:")
                .and_then(|r| r.split(':').next())
                .filter(|id| id.len() == 40)
                .map(|id| id.chars().take(8).collect())
                .unwrap_or_else(|| tr("cloud.history.unknownCommit").to_owned());
            div()
                .flex_none()
                .max_w(px(80.))
                .truncate()
                .text_size(px(m.ui.micro))
                .text_color(t.subtle)
                .child(short)
                .into_any_element()
        };
        let kind = if row.commit { "commit" } else { "ref" };
        let selector = format!("cloud-history-row:{kind}:{}", row.id);
        let content = h_flex()
            .id(("cloud-history-row", index))
            .debug_selector(move || selector)
            .w_full()
            .h(px(height))
            .pr(px(theme::metric::SIDEBAR_ROW_CONTENT_RIGHT))
            .items_center()
            .overflow_hidden()
            .rounded(px(theme::metric::SIDEBAR_ROW_RADIUS))
            .text_color(if selected { t.text } else { t.muted })
            .child(lane_cell(&row, width, height, background, t.canvas, index))
            .child(
                h_flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(6.))
                    .child(
                        h_flex()
                            .flex_1()
                            .min_w_0()
                            .gap(px(6.))
                            .overflow_hidden()
                            .when(current, |d| {
                                d.child(
                                    Self::badge("HEAD".into(), None, t)
                                        .debug_selector(|| "cloud-history-ref:HEAD".into()),
                                )
                            })
                            .child(
                                div()
                                    .flex_1()
                                    .min_w(px(20.))
                                    .truncate()
                                    .text_size(px(m.left.content))
                                    .child(message.clone()),
                            )
                            .children(labels),
                    )
                    .child(trailing),
            );
        let item = if row.commit {
            let id = row.id.clone();
            content
                .role(Role::Button)
                .aria_label(message)
                .test_support()
                .cursor(theme::clickable_cursor())
                .when(selected, |d| d.bg(t.selected))
                .when(!selected, |d| {
                    d.hover(move |s| s.bg(t.hover).text_color(t.text))
                })
                .on_click(cx.listener(move |s, _, _, cx| s.show_detail(id.clone(), cx)))
                .into_any_element()
        } else {
            content.role(Role::ListItem).into_any_element()
        };
        div()
            .w_full()
            .px(px(theme::metric::SIDEBAR_ROW_LEFT_GAP - 6.))
            .child(item)
            .into_any_element()
    }
}

fn graph_color(index: usize) -> Rgba {
    theme::cloud_graph(index % graph::COLORS)
}

/// `HistoryGraphVisual`: the row's lane segments, its commit node (filled
/// when it is the current head) and its ref markers, over `background`.
fn lane_cell(
    row: &graph::Row,
    width: f32,
    height: f32,
    background: Rgba,
    ink: Rgba,
    index: usize,
) -> AnyElement {
    let row = row.clone();
    let counts: Vec<(usize, usize)> = row
        .ref_markers
        .iter()
        .filter(|m| m.count > 1)
        .map(|m| (m.lane, m.count))
        .collect();
    div()
        .debug_selector(move || format!("cloud-history-lanes:{index}"))
        .relative()
        .flex_none()
        .w(px(width.max(24.)))
        .h(px(height))
        .child(
            canvas(
                |_, _, _| {},
                move |bounds, _, window, _| {
                    let origin = bounds.origin;
                    let y = |anchor: graph::Anchor| match anchor {
                        graph::Anchor::Top => 0.,
                        graph::Anchor::Middle => height / 2.,
                        graph::Anchor::Bottom => height,
                    };
                    let at = |x: f32, y: f32| point(origin.x + px(x), origin.y + px(y));
                    for segment in &row.segments {
                        let (x1, y1) = (graph::lane_x(segment.from_lane), y(segment.from));
                        let (x2, y2) = (graph::lane_x(segment.to_lane), y(segment.to));
                        let mut path = PathBuilder::stroke(px(1.5));
                        path.move_to(at(x1, y1));
                        if x1 == x2 || y1 == y2 {
                            path.line_to(at(x2, y2));
                        } else {
                            let control = y1 + (y2 - y1) / 2.;
                            path.cubic_bezier_to(at(x2, y2), at(x1, control), at(x2, control));
                        }
                        if let Ok(path) = path.build() {
                            window.paint_path(path, graph_color(segment.color));
                        }
                    }
                    let square = |lane: usize, size: f32| {
                        let center = at(graph::lane_x(lane), height / 2.);
                        Bounds::new(
                            point(center.x - px(size / 2.), center.y - px(size / 2.)),
                            size_f(size),
                        )
                    };
                    for marker in &row.ref_markers {
                        window.paint_quad(
                            fill(square(marker.lane, 10.), graph_color(marker.color))
                                .corner_radii(px(3.))
                                .border_widths(px(2.))
                                .border_color(background),
                        );
                    }
                    if row.commit {
                        let current = row.labels.iter().any(|l| l.current);
                        let color = graph_color(row.node_color);
                        window.paint_quad(
                            fill(square(row.node_lane, 11.), background).corner_radii(px(3.)),
                        );
                        let size = if current { 8. } else { 7. };
                        window.paint_quad(
                            fill(
                                square(row.node_lane, size),
                                if current { color } else { background },
                            )
                            .corner_radii(px(2.))
                            .border_widths(px(1.5))
                            .border_color(color),
                        );
                    }
                },
            )
            .size_full(),
        )
        .children(counts.into_iter().map(move |(lane, count)| {
            div()
                .absolute()
                .left(px(graph::lane_x(lane) - 5.))
                .top(px(height / 2. - 5.))
                .size(px(10.))
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(8.))
                .font_weight(FontWeight(800.))
                .text_color(ink)
                .child(count.to_string())
        }))
        .into_any_element()
}
fn size_f(side: f32) -> Size<Pixels> {
    size(px(side), px(side))
}

impl Render for CloudHistory {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let busy = self.loading || self.loading_more;
        let refresh_icon = if self.loading {
            Icon::new("refresh-cw")
                .with_size(px(14.))
                .spinning("cloud-history-refresh-spin")
        } else {
            Icon::new("refresh-cw").with_size(px(14.))
        };
        let header = view_header(t)
            .pl(px(8.))
            .justify_start()
            .child(
                view_action(
                    "cloud-history-back",
                    "arrow-left",
                    15.,
                    tr("shared-ui.navigation.back"),
                    t,
                )
                .on_click(cx.listener(|s, _, _, cx| s.back(cx))),
            )
            .child(view_title(tr("source-control.history.title"), t))
            .child(
                h_flex()
                    .ml_auto()
                    .gap(px(2.))
                    .child(
                        IconButton::new("cloud-history-refresh", refresh_icon)
                            .label(tr("cloud.history.refresh"))
                            .with_size(px(24.))
                            .color(t.subtle)
                            .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                            .disabled(busy)
                            .on_click(cx.listener(|s, _, _, cx| s.load(cx))),
                    )
                    .child(
                        view_action(
                            "cloud-history-close",
                            "x",
                            15.,
                            tr("common.action.close"),
                            t,
                        )
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(CloudHistoryEvent::Close))),
                    ),
            );
        let detail = self.detail_view(cx);
        let detail_visible = detail.is_some();
        let mut content = v_flex()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .children(self.notices(t, cx));
        content = match detail {
            Some(detail) => content.child(detail),
            None if !self.commits.is_empty() => {
                content
                    .child(self.graph_view(cx))
                    .child(crate::ui::scrollbar::vertical(
                        "cloud-history-scrollbar",
                        &self.graph_list,
                    ))
            }
            None if self.loading => {
                content.child(Self::state(tr("source-control.status.readingHistory"), t))
            }
            None if self.error.is_none() => {
                content.child(Self::state(tr("cloud.history.noCommits"), t))
            }
            None => content,
        };
        let more = self.history.as_ref().is_some_and(History::more);
        let footer = (!detail_visible && more).then(|| {
            h_flex()
                .flex_shrink_0()
                .justify_center()
                .px(px(12.))
                .py(px(8.))
                .border_t_1()
                .border_color(t.border_subtle)
                .child(
                    Button::new("cloud-history-more")
                        .variant(ButtonVariant::Secondary)
                        .label(tr(if self.loading_more {
                            "cloud.common.loading"
                        } else {
                            "cloud.common.loadMore"
                        }))
                        .disabled(busy)
                        .on_click(cx.listener(|s, _, _, cx| s.load_more(cx))),
                )
        });
        v_flex()
            .id("cloud-history")
            .track_focus(&self.focus)
            .size_full()
            .min_h_0()
            .overflow_hidden()
            .bg(t.auxiliary())
            .text_color(t.text)
            .child(header)
            .child(content)
            .children(footer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn cloud_commits_map_to_timeline_summaries() {
        let commit = Commit {
            id: "a".repeat(40),
            parents: vec!["b".repeat(40)],
            who: "agent".into(),
            message: "m".into(),
            changes: vec![model::Change {
                path: "x.md".into(),
                kind: ChangeKind::Deleted,
            }],
            changes_loaded: true,
            created_at: Some("2026-10-28T12:00:00Z".into()),
        };
        let mapped = summary(&commit);
        assert_eq!(mapped.author_name, "agent");
        assert_eq!(mapped.changes[0].status, Status::Deleted);
        assert_eq!(mapped.changes[0].additions, None);
        // The day is the local date of the Cloud time.
        let (y, m, d) = history::local_day(1_793_188_800);
        assert_eq!(
            mapped.created_at.as_deref(),
            Some(format!("{y:04}-{m:02}-{d:02}").as_str())
        );
        assert_eq!(
            summary(&Commit {
                created_at: None,
                ..commit
            })
            .created_at,
            None
        );
    }

    #[test]
    fn relative_times_follow_the_cloud_formatter() {
        let now = 1_793_188_800; // 2026-10-28T12:00:00Z
        assert_eq!(relative_time("2026-10-28T11:59:30Z", now).unwrap(), "now");
        assert_eq!(
            relative_time("2026-10-28T11:55:00Z", now).unwrap(),
            "5 minutes ago"
        );
        assert_eq!(
            relative_time("2026-10-28T09:00:00Z", now).unwrap(),
            "3 hours ago"
        );
        assert_eq!(
            relative_time("2026-10-27T12:00:00Z", now).unwrap(),
            "yesterday"
        );
        assert_eq!(
            relative_time("2026-10-25T12:00:00Z", now).unwrap(),
            "3 days ago"
        );
        assert!(relative_time("nope", now).is_none());
    }

    fn id(n: u8) -> String {
        format!("{n:02x}").repeat(20)
    }
    fn commit_json(n: u8, parents: &[u8]) -> serde_json::Value {
        serde_json::json!({"commit_id": id(n),
            "parent_ids": parents.iter().map(|p| id(*p)).collect::<Vec<_>>(),
            "who": "agent", "message": format!("c{n}"), "changes_loaded": false,
            "created_at": "2026-10-28T10:00:00Z"})
    }
    /// A Cloud API that serves two pages and commit detail, counting reads.
    fn responder(reads: Arc<std::sync::Mutex<Vec<String>>>) -> crate::cloud::auth::Responder {
        Arc::new(move |request| {
            let cursor = request
                .query
                .iter()
                .find(|(k, _)| k == "cursor")
                .map(|(_, v)| v.clone());
            reads.lock().unwrap().push(format!(
                "{}{}",
                request.path,
                cursor.as_deref().map_or(String::new(), |c| format!("?{c}"))
            ));
            let page = |commits: serde_json::Value, first: bool, next: Option<&str>| {
                serde_json::json!({"code": 0, "data": {
                    "project_id": "p1", "commits": commits, "head_commit_id": id(1),
                    "refs": if first { serde_json::json!([{"ref_name": "refs/heads/main",
                        "ref_type": "branch", "commit_id": id(1)}]) } else { serde_json::json!([]) },
                    "refs_included": first, "snapshot_id": "a".repeat(64),
                    "next_cursor": next, "has_more": next.is_some(), "total": 3,
                    "graph_health": "complete", "unreadable_commit_ids": []}})
            };
            Ok(match (request.path.as_str(), cursor.as_deref()) {
                ("/content/p1/commits", None) => page(
                    serde_json::json!([commit_json(1, &[2]), commit_json(2, &[3])]),
                    true,
                    Some("n2"),
                ),
                ("/content/p1/commits", Some(_)) => {
                    page(serde_json::json!([commit_json(3, &[])]), false, None)
                }
                ("/content/p1/commit-detail", _) => serde_json::json!({"data": {
                    "commit_id": id(1), "parent_ids": [id(2)], "who": "agent", "message": "c1",
                    "changes_loaded": true, "created_at": "2026-10-28T10:00:00Z",
                    "changes": [{"path": "a.md", "action": "add"}, {"path": "b.md", "op": "deleted"}]}}),
                _ => return Err(AuthError::Http(404)),
            })
        })
    }
    fn settle(
        cx: &mut gpui::TestAppContext,
        mut done: impl FnMut(&mut gpui::TestAppContext) -> bool,
    ) {
        let deadline = Instant::now() + std::time::Duration::from_secs(4);
        loop {
            cx.run_until_parked();
            if done(cx) {
                return;
            }
            assert!(Instant::now() < deadline, "the history read did not settle");
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    #[gpui::test]
    fn the_sidebar_pages_reads_detail_on_demand_and_shares_snapshots(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.executor().allow_parking();
        let reads = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (broker, browser) =
            crate::cloud::auth::responding_account_fixture(responder(reads.clone()));
        cx.update(|cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
        settle(cx, |cx| {
            cx.update(|cx| crate::features::cloud::account::has_account(cx))
        });
        let view = cx.new(CloudHistory::new);
        view.update(cx, |h, cx| assert!(h.open("p1", cx)));
        settle(cx, |cx| view.read_with(cx, |h, _| !h.loading));
        view.read_with(cx, |h, _| {
            assert_eq!(h.commits.len(), 2);
            // The head is selected; the list has summaries only.
            assert_eq!(h.selected.as_deref(), Some(id(1).as_str()));
            assert!(h.history.as_ref().unwrap().more());
            assert!(h.commits[0].changes.is_empty());
            assert_eq!(h.labels[&id(1)][0].name, "main");
        });
        // A rapid double click appends the cursor page once.
        view.update(cx, |h, cx| {
            h.load_more(cx);
            h.load_more(cx);
        });
        settle(cx, |cx| view.read_with(cx, |h, _| !h.loading_more));
        view.read_with(cx, |h, _| {
            assert_eq!(h.commits.len(), 3);
            assert!(!h.history.as_ref().unwrap().more());
        });
        // Opening a commit reads its paths, once.
        view.update(cx, |h, cx| h.open_commit(0, cx));
        view.read_with(cx, |h, _| assert_eq!(h.detail_state, Some(Detail::Loading)));
        settle(cx, |cx| {
            view.read_with(cx, |h, _| matches!(h.detail_state, Some(Detail::Ready(_))))
        });
        view.read_with(cx, |h, _| {
            let Some(Detail::Ready(commit)) = &h.detail_state else {
                unreachable!()
            };
            assert_eq!(commit.changes.len(), 2);
        });
        assert_eq!(
            *reads.lock().unwrap(),
            [
                "/content/p1/commits",
                "/content/p1/commits?n2",
                "/content/p1/commit-detail"
            ]
        );
        // Back returns to the list; another view paints the cached snapshot
        // at once and revalidates it.
        view.update(cx, |h, cx| h.back(cx));
        view.read_with(cx, |h, _| assert!(h.detail.is_none()));
        let other = cx.new(CloudHistory::new);
        other.update(cx, |h, cx| {
            assert!(h.open("p1", cx));
            assert_eq!(h.commits.len(), 2);
            assert!(!h.loading);
        });
        settle(cx, |cx| other.read_with(cx, |h, _| h.page.is_none()));
        assert_eq!(reads.lock().unwrap().len(), 4);
        // A hosted run's publication reads the first page again.
        view.update(cx, |h, cx| h.refresh_published(cx));
        settle(cx, |cx| {
            view.read_with(cx, |h, _| h.page.is_none() && !h.loading)
        });
        let first_pages = || {
            reads
                .lock()
                .unwrap()
                .iter()
                .filter(|r| *r == "/content/p1/commits")
                .count()
        };
        assert_eq!(first_pages(), 3);
        // File activity reads it again once it has been quiet for two
        // seconds, once for the whole burst.
        for _ in 0..5 {
            view.update(cx, |h, cx| h.file_activity(cx));
            cx.executor()
                .advance_clock(std::time::Duration::from_millis(500));
            cx.run_until_parked();
        }
        assert_eq!(first_pages(), 3);
        cx.executor().advance_clock(ACTIVITY_QUIET);
        settle(cx, |cx| {
            view.read_with(cx, |h, _| h.page.is_none() && !h.loading)
        });
        assert_eq!(first_pages(), 4);
        // The view belongs to its Project; closing drops everything.
        cx.update(|cx| {
            assert!(view.read(cx).matches(Some("p1"), cx));
            assert!(!view.read(cx).matches(Some("p2"), cx));
            assert!(!view.read(cx).matches(None, cx));
        });
        view.update(cx, |h, cx| {
            h.close(cx);
            assert!(!h.is_open());
            assert!(h.commits.is_empty());
        });
    }

    #[gpui::test]
    fn the_list_and_detail_render_in_a_window(cx: &mut gpui::TestAppContext) {
        cx.executor().allow_parking();
        let reads = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder(reads));
        cx.update(|cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
        settle(cx, |cx| {
            cx.update(|cx| crate::features::cloud::account::has_account(cx))
        });
        let (view, vcx) = cx.add_window_view(|_, cx| CloudHistory::new(cx));
        let draw = |vcx: &mut gpui::VisualTestContext| {
            vcx.update(|w, cx| {
                w.draw(cx).clear(cx);
            })
        };
        // Loading, then the list with its pagination footer.
        view.update(vcx, |h, cx| assert!(h.open("p1", cx)));
        draw(vcx);
        settle(vcx, |cx| view.read_with(cx, |h, _| !h.loading));
        draw(vcx);
        view.update(vcx, |h, cx| h.open_commit(0, cx));
        draw(vcx);
        settle(vcx, |cx| {
            view.read_with(cx, |h, _| matches!(h.detail_state, Some(Detail::Ready(_))))
        });
        draw(vcx);
        // A failed first page shows the notice with Try again.
        view.update(vcx, |h, cx| {
            h.back(cx);
            h.error = Some(false);
        });
        draw(vcx);
    }

    /// `selects graph commits and presents them with the canonical local
    /// History hierarchy` and `uses native button-list semantics and keeps
    /// ref-only rows non-interactive`: the page draws as lane-graph rows in a
    /// "Commit history" list; each commit is a button with its lanes, its
    /// inline refs (HEAD on the current head) and its counts; a ref outside
    /// the page is a row that is not a button; choosing an older commit opens
    /// its detail.
    #[gpui::test]
    fn the_page_draws_as_a_lane_graph_with_buttons_for_commits_only(cx: &mut gpui::TestAppContext) {
        use gpui_kit::test::TestQueryExt as _;
        cx.executor().allow_parking();
        crate::localization::set_current("en");
        let responder: crate::cloud::auth::Responder = Arc::new(|request| {
            Ok(match request.path.as_str() {
                "/content/p1/commits" => serde_json::json!({"code": 0, "data": {
                    "project_id": "p1",
                    "commits": [commit_json(1, &[2]), commit_json(2, &[3])],
                    "head_commit_id": id(1),
                    "refs": [
                        {"ref_name": "refs/heads/main", "ref_type": "branch", "commit_id": id(1)},
                        {"ref_name": "refs/tags/v1", "ref_type": "tag", "commit_id": id(9)},
                    ],
                    "refs_included": true, "snapshot_id": "a".repeat(64),
                    "next_cursor": null, "has_more": false, "total": 2,
                    "graph_health": "complete", "unreadable_commit_ids": []}}),
                "/content/p1/commit-detail" => serde_json::json!({"data": {
                    "commit_id": id(2), "parent_ids": [id(3)], "who": "agent", "message": "c2",
                    "changes_loaded": true, "created_at": "2026-10-28T10:00:00Z",
                    "changes": [{"path": "a.md", "op": "deleted"}]}}),
                _ => return Err(AuthError::Http(404)),
            })
        });
        let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
        cx.update(|cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
        settle(cx, |cx| {
            cx.update(|cx| crate::features::cloud::account::has_account(cx))
        });
        let (view, vcx) = cx.add_window_view(|_, cx| CloudHistory::new(cx));
        let draw = |vcx: &mut gpui::VisualTestContext| {
            vcx.update(|w, cx| {
                w.draw(cx).clear(cx);
            })
        };
        view.update(vcx, |h, cx| assert!(h.open("p1", cx)));
        settle(vcx, |cx| {
            view.read_with(cx, |h, _| !h.loading && !h.graph.is_empty())
        });
        draw(vcx);
        let rows = view.read_with(vcx, |h, _| h.graph.clone());
        assert_eq!(rows.len(), 3, "two commits and the tag outside the page");
        for (index, row) in rows.iter().enumerate() {
            let kind = if row.commit { "commit" } else { "ref" };
            let selector: &'static str =
                Box::leak(format!("cloud-history-row:{kind}:{}", row.id).into_boxed_str());
            assert!(vcx.debug_bounds(selector).is_some(), "{selector}");
            let lanes: &'static str =
                Box::leak(format!("cloud-history-lanes:{index}").into_boxed_str());
            assert!(
                vcx.debug_bounds(lanes).is_some(),
                "each row draws its lanes"
            );
        }
        let list = vcx.update(|w, _| w.find_all_by_role(gpui::Role::List));
        assert!(list.iter().any(|l| l.label() == Some("Commit history")));
        let buttons = vcx.update(|w, _| {
            w.find_all_by_role(gpui::Role::Button)
                .into_iter()
                .filter(|b| matches!(b.label(), Some("c1" | "c2")))
                .collect::<Vec<_>>()
        });
        assert_eq!(buttons.len(), 2, "commits are buttons, the ref row is not");
        let ref_buttons = vcx.update(|w, _| {
            w.find_all_by_role(gpui::Role::Button)
                .into_iter()
                .filter(|b| b.label() == Some("Update workspace"))
                .count()
        });
        assert_eq!(ref_buttons, 0, "a ref outside the page is not a button");
        assert!(vcx.debug_bounds("cloud-history-ref:HEAD").is_some());
        assert!(vcx.debug_bounds("cloud-history-ref:v1").is_some());
        assert!(vcx.debug_bounds("cloud-history-stat:+0-0").is_some());
        let older = vcx.update(|w, _| w.find_by_label("c2").bounds());
        vcx.simulate_click(older.center(), Modifiers::default());
        settle(vcx, |cx| {
            view.read_with(cx, |h, _| matches!(h.detail_state, Some(Detail::Ready(_))))
        });
        view.read_with(vcx, |h, _| {
            assert_eq!(h.detail.as_deref(), Some(id(2).as_str()));
            assert_eq!(h.selected.as_deref(), Some(id(2).as_str()));
        });
    }

    #[test]
    fn flights_are_shared_released_and_settled_once() {
        let mut store: Store<u32> = Store::new();
        let mut next = 0;
        let cancel = std::cell::RefCell::new(None);
        let ready = |c: Cancellation| {
            *cancel.borrow_mut() = Some(c);
            Task::ready(Ok(7))
        };
        let a = store.acquire("ns\n", "ns\nk".into(), &mut next, ready);
        // A second view joins the same flight instead of reading again.
        let b = store.acquire("ns\n", "ns\nk".into(), &mut next, |_| {
            unreachable!("joined")
        });
        assert_eq!(a.id, b.id);
        store.release(&a.key, a.id);
        assert!(store.flights.contains_key("ns\nk"));
        store.release(&b.key, b.id);
        // The last view leaving cancels the unfinished read.
        assert!(store.flights.is_empty());
        assert!(cancel.borrow().as_ref().unwrap().check().is_err());
        // A settled flight becomes the snapshot the next view paints.
        let c = store.acquire("ns\n", "ns\nk".into(), &mut next, |_| Task::ready(Ok(9)));
        store.settle(&c.key, c.id, &Ok(9));
        let d = store.acquire("ns\n", "ns\nk".into(), &mut next, |_| Task::ready(Ok(10)));
        assert_eq!(d.cached, Some(9));
        // Another account clears snapshots and cancels the old flights.
        let e = store.acquire("other\n", "other\nk".into(), &mut next, |_| {
            Task::ready(Err(Failure::Auth(AuthError::Http(409))))
        });
        assert_eq!(e.cached, None);
        assert!(!store.flights.contains_key("ns\nk"));
        store.settle(&e.key, e.id, &Err(Failure::Auth(AuthError::Http(409))));
        assert!(Failure::Auth(AuthError::Http(409)).restarts());
    }
}
