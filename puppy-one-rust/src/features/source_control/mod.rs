//! Right-sidebar Changes surface: port of `GitChangesSidebar.tsx`,
//! `SourceControlSidebar.tsx` and `sidebar/*` (`GitLocalStatusPanels`,
//! `SourceControlSectionHeader`, `SourceControlWorkingTreeRow`,
//! `GitOperationButton`, `GitIncomingUpdateNotice`) with
//! `source-control/styles/*`. Git runs through `platform/git.rs` on a worker.
//! A selected change opens its file diff in place (`WorkingFileDetail` over
//! the format-aware `diff` registry).
mod backup_card;
mod cloud_history;
pub(crate) use cloud_history::{relative_time, short_date};
mod diff;
#[cfg(test)]
mod diff_tests;
mod failure;
mod history;
mod panel_layout;
mod refresh;
#[cfg(test)]
mod refresh_tests;
#[cfg(test)]
mod sidebar_tests;

pub use cloud_history::{CloudHistory, CloudHistoryEvent};

use crate::{
    localization::{t as tr, tf},
    platform::{
        git::{self, Change, Operation, Snapshot},
        git_diff::{self, FileDiff, Scope},
        git_history::{self, CommitSummary, History},
    },
    theme::{self, Theme, metric},
    ui::{
        appearance::ActiveAppearance,
        components::{
            Button, ButtonVariant, FileIcon, Icon, IconButton, RowActionButton, RowVariant,
            SectionHeader, SidebarRow,
        },
    },
    wake::Wake,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

enum ResultValue {
    /// A physical status read retains its slot until its own completion.
    Read(Result<Snapshot, String>, u64),
    Status(Result<Snapshot, String>),
    /// A silent fetch only invalidates; it cannot publish a second status read.
    Fetched(Result<(), String>),
    /// The repository metadata watcher (`git-metadata-watch-service`).
    Watching(Option<crate::platform::git_watch::GitWatch>),
    History(Result<History, String>, u64),
    Diff(Result<Vec<FileDiff>, String>, u64),
}
/// The focused Changes file (`GitWorkingSelection`).
#[derive(Clone, Debug)]
struct Selection {
    change: Change,
    scope: Scope,
}
impl Selection {
    fn staged(&self) -> bool {
        self.scope == Scope::Staged
    }
    /// The letter its row shows for this scope.
    fn status(&self) -> char {
        match (self.scope, self.change.index, self.change.worktree) {
            (Scope::Untracked, ..) => 'U',
            (Scope::Staged, index, _) => index,
            (_, _, ' ') => self.change.index,
            (_, _, worktree) => worktree,
        }
    }
}
/// What the detail view shows.
#[derive(Clone, Debug)]
enum DetailKind {
    Working(Selection),
    Commit(CommitSummary),
}
type DetailReader =
    Arc<dyn Fn(PathBuf, &AtomicBool) -> Result<Vec<FileDiff>, String> + Send + Sync>;
/// A file diff list (Changes detail or a History commit) and its rows.
struct Detail {
    kind: DetailKind,
    reader: Option<DetailReader>,
    /// `None` while Git reads it.
    files: Option<Result<Vec<FileDiff>, String>>,
    rows: Vec<diff::Row>,
    list: ListState,
}
impl Detail {
    fn new(kind: DetailKind) -> Self {
        let list = ListState::new(0, ListAlignment::Top, px(400.));
        let detail = Self {
            kind,
            reader: None,
            files: None,
            rows: Vec::new(),
            list,
        };
        detail.list.reset(detail.lead());
        detail
    }
    /// Changes is a sidebar list; a History commit is a page.
    fn density(&self) -> diff::Density {
        match self.kind {
            DetailKind::Working(_) => diff::Density::Sidebar,
            DetailKind::Commit(_) => diff::Density::Page,
        }
    }
    /// Rows above the diffs: a commit's summary.
    fn lead(&self) -> usize {
        usize::from(matches!(self.kind, DetailKind::Commit(_)))
    }
    fn failed(&self) -> bool {
        match &self.files {
            Some(Err(_)) => true,
            Some(Ok(files)) => files
                .iter()
                .any(|file| matches!(file.redline, Some(Err(_)))),
            None => false,
        }
    }
    fn publish(&mut self, files: Result<Vec<FileDiff>, String>) {
        let density = self.density();
        self.rows = files
            .as_deref()
            .map(|f| diff::rows(f, density))
            .unwrap_or_default();
        self.list.reset(self.lead() + self.rows.len());
        self.files = Some(files);
    }
}
/// What the Changes surface asks of the shell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SourceControlEvent {
    /// `onOpenFile`: open a workspace-relative file in the editor.
    OpenFile(String),
    /// `onOpenHistory` / `onBack`: the sidebar now shows History or the
    /// Changes list (`rightSidebarSurface`).
    Surface,
    /// An operation failed, or its failure was dismissed: the window shows
    /// or closes `GitOperationErrorDialog` ([`SourceControl::has_failure`]).
    Failure,
    /// `cloudBackup.start`: put the folder in Puppyone Cloud.
    BackUpToCloud,
}
/// `GitSidebarPanelId` of the local status panels, in display order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Panel {
    Merge,
    Committed,
    Staged,
    Unstaged,
}
impl Panel {
    /// `grow` of `createGitLocalStatusPanels`.
    fn grow(self) -> f32 {
        match self {
            Self::Merge | Self::Staged => 0.9,
            Self::Committed => 1.05,
            Self::Unstaged => 1.15,
        }
    }
    fn title(self) -> &'static str {
        match self {
            Self::Merge => "source-control.section.merge",
            Self::Committed => "source-control.section.committed",
            Self::Staged => "source-control.section.staged",
            Self::Unstaged => "source-control.section.unstaged",
        }
    }
}
#[derive(Clone, Debug)]
struct Section {
    panel: Panel,
    changes: Vec<Change>,
}
/// Merge, staged and unstaged resources; untracked files join "Unstaged".
impl SourceControl {
    /// Feed a backend result through the same status projection in shell tests.
    #[cfg(test)]
    pub(crate) fn receive_snapshot_for_test(&mut self, snapshot: Snapshot, cx: &mut Context<Self>) {
        self.publish_status(snapshot, cx);
    }
    /// The opened folder's place in its repository (empty at the root).
    fn prefix(&self) -> &str {
        self.snapshot.as_ref().map_or("", |s| s.prefix.as_str())
    }
    /// A repository path as the folder-relative path the editor opens;
    /// `None` for a file elsewhere in the repository.
    fn workspace_path(&self, path: &str) -> Option<String> {
        git::local(self.prefix(), path).map(str::to_owned)
    }
}
fn project_sections(snapshot: &Snapshot) -> Vec<Section> {
    [Panel::Merge, Panel::Staged, Panel::Unstaged]
        .into_iter()
        .map(|panel| Section {
            panel,
            changes: snapshot
                .changes
                .iter()
                .filter(|c| match panel {
                    Panel::Merge => c.conflict(),
                    Panel::Staged => c.staged(),
                    _ => c.unstaged() || c.untracked(),
                })
                .cloned()
                .collect(),
        })
        .filter(|s| !s.changes.is_empty())
        .collect()
}
/// `getSourceControlPrimaryActionSlot`: which action wears the primary colour.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PrimarySlot {
    Operation,
    Sync,
    Staged,
    Committed,
    StageAndCommit,
}
/// The actions that could wear it, each only while it can run.
#[derive(Clone, Copy, Debug, Default)]
struct SlotCandidates {
    conflicts: bool,
    operation: bool,
    sync: bool,
    staged: bool,
    committed: bool,
    stage_and_commit: bool,
}
fn primary_slot(c: SlotCandidates) -> Option<PrimarySlot> {
    if c.conflicts {
        None
    } else if c.operation {
        Some(PrimarySlot::Operation)
    } else if c.sync {
        Some(PrimarySlot::Sync)
    } else if c.staged {
        Some(PrimarySlot::Staged)
    } else if c.committed {
        Some(PrimarySlot::Committed)
    } else if c.stage_and_commit {
        Some(PrimarySlot::StageAndCommit)
    } else {
        None
    }
}
/// `getCommittedPrimaryAction`'s kind: a branch with nowhere to push to yet
/// is published, else its commits are pushed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CommittedAction {
    Publish,
    Push,
}
impl CommittedAction {
    fn operation(self) -> Operation {
        match self {
            Self::Publish => Operation::Publish,
            Self::Push => Operation::Push,
        }
    }
}
/// `getCommittedPrimaryAction`: the action and whether it is disabled; a
/// blocked repository (unresolved conflicts, an operation in progress)
/// sends nothing.
fn committed_action(snapshot: &Snapshot, blocked: bool) -> Option<(CommittedAction, bool)> {
    if snapshot.can_publish() {
        Some((CommittedAction::Publish, blocked))
    } else if snapshot.remote_exists() && snapshot.ahead > 0 && snapshot.behind > 0 {
        Some((CommittedAction::Push, true))
    } else if snapshot.can_push() {
        Some((CommittedAction::Push, blocked))
    } else {
        None
    }
}
/// `MAX_VISIBLE_ROWS` of `useGitSidebarPanelLayout`.
const MAX_VISIBLE_ROWS: usize = 9;
/// `--git-section-body-top-gap`, `--git-section-divider-height`.
const SECTION_BODY_TOP_GAP: f32 = 2.;
const SECTION_DIVIDER_HEIGHT: f32 = 12.;
pub struct SourceControl {
    root: Option<PathBuf>,
    epoch: u64,
    cancel: Arc<AtomicBool>,
    tx: mpsc::Sender<(u64, ResultValue)>,
    rx: mpsc::Receiver<(u64, ResultValue)>,
    wake: Wake,
    pub snapshot: Option<Snapshot>,
    /// Last successful metadata per project, including known non-repositories.
    status_cache: std::collections::VecDeque<(PathBuf, Option<Snapshot>)>,
    /// A successful observation of an ordinary, non-repository folder.
    repository_absent: bool,
    /// The status could not be read.
    pub error: Option<String>,
    /// The last operation's failure, while its dialog is open.
    failure: Option<failure::Failure>,
    /// The dialog's "Copied" and its reset.
    prompt_copied: bool,
    prompt_reset: Option<Task<()>>,
    /// Cloud is on, a first publication runs, and the backup card was
    /// dismissed (`backupCardDismissed`).
    cloud_enabled: bool,
    cloud_publishing: bool,
    backup_dismissed: bool,
    busy: bool,
    /// The running mutation's label (`gitOperationLoading`).
    running: Option<&'static str>,
    queued_operation: Option<Operation>,
    dirty: bool,
    dirty_immediate: bool,
    last_successful_refresh: Option<Instant>,
    refresh_generation: u64,
    applied_generation: u64,
    read_ticket: Option<u64>,
    read_cancel: Option<Arc<AtomicBool>>,
    status_reader: StatusReader,
    refresh_retry: Option<Task<()>>,
    retry_delay: Duration,
    /// Refresh scheduling (`gitRefreshScheduler`, `remoteRefreshPolicy`):
    /// the metadata watcher and its flag, the pending debounce, window
    /// focus, and the remote fetch's last attempt and loop.
    git_watch: Option<crate::platform::git_watch::GitWatch>,
    metadata_changed: Arc<AtomicBool>,
    debounce: Option<Task<()>>,
    focused: bool,
    fetching: bool,
    fetch_attempts: std::collections::HashMap<(PathBuf, String), Instant>,
    observed_fetch_target: Option<git::sync_state::FetchTarget>,
    remote_fetcher: RemoteFetcher,
    online_probe: Arc<dyn Fn() -> Option<bool> + Send + Sync>,
    online: bool,
    remote_loop: Option<Task<()>>,
    next_remote_tick: Option<Instant>,
    history_open: bool,
    history_ticket: u64,
    history_cancel: Arc<AtomicBool>,
    detail_cancel: Arc<AtomicBool>,
    diff_reader: Arc<git_diff::Reader>,
    history: History,
    /// History has been read at least once (an empty one is final).
    history_loaded: bool,
    timeline: Vec<history::TimelineRow>,
    timeline_list: ListState,
    /// Each status panel's list scroller (Merge, Committed, Staged, Unstaged).
    panel_scroll: [UniformListScrollHandle; 4],
    panel_layout: panel_layout::Layout,
    /// Collapsed days of the timeline (local `YYYY-MM-DD`).
    collapsed_days: std::collections::HashSet<String>,
    /// The commit id just copied (its icon reads "copied" briefly).
    copied: Option<String>,
    sections: Vec<Section>,
    /// Collapsed disclosure panels (`useGitSidebarExpansionState`).
    collapsed: std::collections::HashSet<Panel>,
    selection: u64,
    detail: Option<Detail>,
    layout: crate::features::settings::GitSidebarLayout,
    icon_theme: String,
    #[cfg(test)]
    painted_rows: usize,
}
type RemoteFetcher = Arc<dyn Fn(PathBuf, String, &AtomicBool) -> Result<(), String> + Send + Sync>;
type StatusReader = Arc<dyn Fn(PathBuf, Arc<AtomicBool>) -> Result<Snapshot, String> + Send + Sync>;
impl EventEmitter<SourceControlEvent> for SourceControl {}
impl SourceControl {
    /// Appearance → Git sidebar layout and file icon theme.
    pub fn set_presentation(
        &mut self,
        layout: crate::features::settings::GitSidebarLayout,
        icon_theme: String,
        cx: &mut Context<Self>,
    ) {
        if self.layout != layout || self.icon_theme != icon_theme {
            self.layout = layout;
            self.icon_theme = icon_theme;
            cx.notify();
        }
    }
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        panel_layout::install(window, cx);
        let (wake, rx) = Wake::channel();
        let (tx, results) = mpsc::channel();
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this
                    .update_in(cx, |s, w, cx| {
                        s.poll(w, cx);
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        Self {
            root: None,
            epoch: 0,
            cancel: Arc::new(AtomicBool::new(false)),
            tx,
            rx: results,
            wake,
            snapshot: None,
            status_cache: Default::default(),
            repository_absent: false,
            error: None,
            failure: None,
            prompt_copied: false,
            prompt_reset: None,
            cloud_enabled: false,
            cloud_publishing: false,
            backup_dismissed: false,
            busy: false,
            running: None,
            queued_operation: None,
            dirty: false,
            dirty_immediate: false,
            last_successful_refresh: None,
            refresh_generation: 0,
            applied_generation: 0,
            read_ticket: None,
            read_cancel: None,
            status_reader: Arc::new(|root, cancel| git::status(&root, &cancel)),
            refresh_retry: None,
            retry_delay: refresh::RETRY_INITIAL,
            git_watch: None,
            metadata_changed: Arc::new(AtomicBool::new(false)),
            debounce: None,
            focused: true,
            fetching: false,
            fetch_attempts: Default::default(),
            observed_fetch_target: None,
            remote_fetcher: Arc::new(|root, remote, cancel| git::fetch(&root, &remote, cancel)),
            online_probe: Arc::new(crate::platform::connectivity::online),
            online: true,
            remote_loop: None,
            next_remote_tick: None,
            history_open: false,
            history_ticket: 0,
            history_cancel: Arc::new(AtomicBool::new(false)),
            detail_cancel: Arc::new(AtomicBool::new(false)),
            diff_reader: Arc::new(git_diff::Reader::default()),
            history: History::default(),
            history_loaded: false,
            timeline: vec![],
            timeline_list: ListState::new(0, ListAlignment::Top, px(400.)),
            panel_scroll: Default::default(),
            panel_layout: panel_layout::Layout::new(cx),
            collapsed_days: Default::default(),
            copied: None,
            sections: vec![],
            collapsed: Default::default(),
            selection: 0,
            detail: None,
            layout: Default::default(),
            icon_theme: "default".into(),
            #[cfg(test)]
            painted_rows: 0,
        }
    }
    pub fn set_workspace(&mut self, root: PathBuf, cx: &mut Context<Self>) {
        if self.root.as_ref() == Some(&root) {
            return;
        }
        self.panel_layout.cancel();
        self.panel_layout.reconcile(&[]);
        self.cancel.store(true, Ordering::Relaxed);
        if let Some(cancel) = self.read_cancel.take() {
            cancel.store(true, Ordering::Relaxed);
        }
        self.history_cancel.store(true, Ordering::Relaxed);
        self.detail_cancel.store(true, Ordering::Relaxed);
        self.diff_reader.invalidate();
        self.diff_reader = Arc::new(git_diff::Reader::default());
        self.cancel = Arc::new(AtomicBool::new(false));
        self.epoch += 1;
        let cached = self
            .status_cache
            .iter()
            .find(|(path, _)| path == &root)
            .map(|(_, snapshot)| snapshot.clone());
        self.repository_absent = matches!(cached, Some(None));
        self.snapshot = cached.flatten();
        self.root = Some(root);
        self.error = None;
        self.dismiss_failure(cx);
        self.backup_dismissed = false;
        self.busy = false;
        self.running = None;
        self.queued_operation = None;
        self.read_ticket = None;
        self.refresh_generation = 0;
        self.applied_generation = 0;
        self.last_successful_refresh = None;
        self.refresh_retry = None;
        self.retry_delay = refresh::RETRY_INITIAL;
        self.dirty = false;
        self.dirty_immediate = false;
        // History stays the surface across projects (`rightSidebarSurface`);
        // it reloads with the new repository's first snapshot.
        self.detail = None;
        self.history = History::default();
        self.history_loaded = false;
        self.collapsed_days.clear();
        self.rebuild_timeline();
        self.sections = self
            .snapshot
            .as_ref()
            .map(project_sections)
            .unwrap_or_default();
        self.fetching = false;
        self.observed_fetch_target = None;
        self.next_remote_tick = Some(cx.background_executor().now() + refresh::REMOTE_INTERVAL);
        self.debounce = None;
        // Repository metadata invalidates through its own watcher; Git
        // resolves the directories, so the watch starts on a worker.
        self.git_watch = None;
        let (flag, wake) = (self.metadata_changed.clone(), self.wake.clone());
        self.task(move |root, _| {
            ResultValue::Watching(
                crate::platform::git_watch::watch(&root, refresh::metadata_noise, move || {
                    flag.store(true, Ordering::Relaxed);
                    wake.notify();
                })
                .ok(),
            )
        });
        // Read-only OS connectivity sampling replaces the browser's online
        // event. It runs no network probe and only samples in the foreground.
        self.remote_loop = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(refresh::ONLINE_POLL).await;
                if this
                    .update(cx, |s, cx| {
                        s.check_online(cx);
                        let now = cx.background_executor().now();
                        if s.next_remote_tick.is_some_and(|at| now >= at) {
                            s.next_remote_tick = Some(now + refresh::REMOTE_INTERVAL);
                            s.request_fetch(refresh::REMOTE_INTERVAL, cx);
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        }));
        self.refresh(cx);
        // A cached status can compare equal to the fresh response. History
        // was cleared for the new epoch, so it still needs its own first read.
        if self.history_open && self.snapshot.is_some() {
            self.load_history();
        }
        self.reconcile_fetch_target(cx);
    }
    fn task(&self, work: impl FnOnce(PathBuf, &AtomicBool) -> ResultValue + Send + 'static) {
        self.task_with(self.cancel.clone(), work);
    }
    fn task_with(
        &self,
        cancel: Arc<AtomicBool>,
        work: impl FnOnce(PathBuf, &AtomicBool) -> ResultValue + Send + 'static,
    ) {
        let Some(root) = self.root.clone() else {
            return;
        };
        let epoch = self.epoch;
        let tx = self.tx.clone();
        let wake = self.wake.clone();
        crate::localization::spawn(move || {
            let result = work(root, &cancel);
            let _ = tx.send((epoch, result));
            wake.notify();
        });
    }
    fn operation(&mut self, op: Operation, cx: &mut Context<Self>) {
        if self.busy || self.read_ticket.is_some() {
            if self.running.is_none() {
                self.queued_operation = Some(op);
            }
            return;
        }
        self.busy = true;
        self.running = Some(op.label());
        self.dismiss_failure(cx);
        self.close_detail();
        self.task(move |root, cancel| ResultValue::Status(git::operate(&root, &op, cancel)));
        cx.notify();
    }
    fn poll(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if self.metadata_changed.swap(false, Ordering::Relaxed) {
            self.invalidate(cx);
        }
        while let Ok((epoch, result)) = self.rx.try_recv() {
            if epoch != self.epoch {
                continue;
            }
            match result {
                ResultValue::Read(result, generation) => {
                    if self.read_ticket != Some(generation) {
                        continue;
                    }
                    self.read_ticket = None;
                    self.read_cancel = None;
                    if self.running.is_none() {
                        self.busy = false;
                    }
                    if generation < self.applied_generation {
                        continue;
                    }
                    match result {
                        Ok(snapshot) => {
                            self.applied_generation = generation;
                            self.publish_status(snapshot, cx);
                        }
                        Err(error) => {
                            self.failed_status(error, cx);
                        }
                    }
                }
                ResultValue::Status(result) => {
                    self.busy = false;
                    let running = self.running.take();
                    match result {
                        Ok(snapshot) => {
                            self.apply_mutation_status(snapshot, cx);
                        }
                        // `runGitOperation`: the failure's dialog, then
                        // the status read again.
                        Err(e) => match running {
                            Some(label) => {
                                let workspace = self.root.as_ref().map(|r| r.display().to_string());
                                self.failure = Some(failure::Failure::new(label, &e, workspace));
                                self.dirty = true;
                                self.dirty_immediate = true;
                                cx.emit(SourceControlEvent::Failure);
                            }
                            None => {
                                self.failed_status(e, cx);
                            }
                        },
                    }
                }
                ResultValue::Watching(watch) => self.git_watch = watch,
                // Silent: a failed fetch keeps the last status.
                ResultValue::Fetched(result) => {
                    self.fetching = false;
                    if result.is_ok() {
                        self.invalidate(cx);
                    }
                }
                ResultValue::History(result, ticket) => {
                    if ticket == self.history_ticket {
                        match result {
                            Ok(history) => {
                                self.history = history;
                                self.history_loaded = true;
                                self.rebuild_timeline();
                            }
                            Err(e) => self.error = Some(e),
                        }
                    }
                }
                ResultValue::Diff(result, selection) => {
                    if selection == self.selection
                        && let Some(detail) = &mut self.detail
                    {
                        detail.publish(result);
                    }
                }
            }
        }
        if !self.busy
            && self.read_ticket.is_none()
            && let Some(operation) = self.queued_operation.take()
        {
            self.operation(operation, cx);
        }
        // No polling: reads come from invalidations, focus and mutations.
        if self.root.is_some()
            && self.dirty
            && !self.busy
            && self.read_ticket.is_none()
            && self.debounce.is_none()
            && (self.focused || self.dirty_immediate)
        {
            self.request_read(self.dirty_immediate, cx);
        }
        // `requestFetch(REMOTE_FETCH_MIN_GAP_MS)` once a remote is known.
        self.reconcile_fetch_target(cx);
        cx.notify();
    }
    fn load_history(&mut self) {
        self.history_cancel.store(true, Ordering::Relaxed);
        self.history_cancel = Arc::new(AtomicBool::new(false));
        self.history_ticket += 1;
        let ticket = self.history_ticket;
        self.task_with(self.history_cancel.clone(), move |root, cancel| {
            ResultValue::History(git_history::history(&root, cancel), ticket)
        });
    }
    /// Open a detail and read its files off the main thread.
    fn open_detail(
        &mut self,
        kind: DetailKind,
        read: impl Fn(PathBuf, &AtomicBool) -> Result<Vec<FileDiff>, String> + Send + Sync + 'static,
        cx: &mut Context<Self>,
    ) {
        self.panel_layout.cancel();
        self.panel_layout.reconcile(&[]);
        self.start_detail(kind, Arc::new(read), cx);
    }
    fn start_detail(&mut self, kind: DetailKind, read: DetailReader, cx: &mut Context<Self>) {
        self.close_detail();
        let selection = self.selection;
        let mut detail = Detail::new(kind);
        detail.reader = Some(read.clone());
        self.detail = Some(detail);
        self.detail_cancel = Arc::new(AtomicBool::new(false));
        self.task_with(self.detail_cancel.clone(), move |root, cancel| {
            ResultValue::Diff(read(root, cancel), selection)
        });
        cx.notify();
    }
    fn close_detail(&mut self) {
        self.detail_cancel.store(true, Ordering::Relaxed);
        self.selection += 1;
        self.detail = None;
    }
    fn retry_detail(&mut self, cx: &mut Context<Self>) {
        if let Some(detail) = &self.detail
            && detail.failed()
            && let Some(read) = detail.reader.clone()
        {
            self.start_detail(detail.kind.clone(), read, cx);
        }
    }
    /// `selectWorkingFile`: the change's diff in its scope.
    fn select(&mut self, change: Change, staged: bool, cx: &mut Context<Self>) {
        let scope = if change.untracked() {
            Scope::Untracked
        } else if staged {
            Scope::Staged
        } else {
            Scope::Unstaged
        };
        let (path, old) = (change.path.clone(), change.original.clone());
        let prefix = self.prefix().to_owned();
        let reader = self.diff_reader.clone();
        self.open_detail(
            DetailKind::Working(Selection { change, scope }),
            move |root, cancel| {
                reader.file_diff(&root, &prefix, &path, old.as_deref(), scope, cancel)
            },
            cx,
        );
    }
    /// `onOpenHistory`.
    pub fn open_history(&mut self, cx: &mut Context<Self>) {
        self.panel_layout.cancel();
        self.panel_layout.reconcile(&[]);
        self.close_detail();
        self.history_open = true;
        self.load_history();
        cx.emit(SourceControlEvent::Surface);
        cx.notify();
    }
    /// `reveal("changes")`: the Header entry and Back show the Changes list.
    pub fn show_changes(&mut self, cx: &mut Context<Self>) {
        if !self.history_open {
            return;
        }
        self.history_open = false;
        if matches!(
            self.detail.as_ref().map(|d| &d.kind),
            Some(DetailKind::Commit(_))
        ) {
            self.close_detail();
        }
        self.selection += 1;
        cx.emit(SourceControlEvent::Surface);
        cx.notify();
    }
    /// History is the surface (`rightSidebarSurface === "history"`).
    pub fn history_open(&self) -> bool {
        self.history_open
    }
    /// The stored surface arriving: History (read once the repository is).
    pub fn restore_history(&mut self, open: bool, cx: &mut Context<Self>) {
        if self.history_open == open {
            return;
        }
        self.history_open = open;
        if open && self.snapshot.is_some() {
            self.load_history();
        }
        cx.notify();
    }
    /// Open the `index`th History commit (capture scenarios).
    #[cfg(feature = "dev-capture")]
    pub fn select_commit(&mut self, index: usize, cx: &mut Context<Self>) -> bool {
        let Some(commit) = self.history.commits.get(index).cloned() else {
            return false;
        };
        let id = commit.id.clone();
        let reader = self.diff_reader.clone();
        self.open_detail(
            DetailKind::Commit(commit),
            move |root, cancel| reader.commit_detail(&root, &id, cancel),
            cx,
        );
        true
    }
    /// A detail or the opened History is still being read.
    #[cfg(feature = "dev-capture")]
    pub fn reading_detail(&self) -> bool {
        self.detail.as_ref().is_some_and(|d| d.files.is_none())
            || (self.history_open && !self.history_loaded)
    }
    /// Open the change at `path` (capture scenarios).
    #[cfg(feature = "dev-capture")]
    pub fn select_path(&mut self, path: &str, staged: bool, cx: &mut Context<Self>) -> bool {
        let Some(change) = self
            .snapshot
            .as_ref()
            .and_then(|s| s.changes.iter().find(|c| c.path == path).cloned())
        else {
            return false;
        };
        self.select(change, staged, cx);
        true
    }
}
impl Drop for SourceControl {
    fn drop(&mut self) {
        self.diff_reader.invalidate();
        self.cancel.store(true, Ordering::Relaxed);
        if let Some(cancel) = &self.read_cancel {
            cancel.store(true, Ordering::Relaxed);
        }
        self.history_cancel.store(true, Ordering::Relaxed);
        self.detail_cancel.store(true, Ordering::Relaxed);
    }
}
/// `.desktop-git-view-action` / `.desktop-git-view-back`: 24px, subtle.
fn view_action(
    id: &'static str,
    icon: &'static str,
    size: f32,
    label: impl Into<SharedString>,
    t: Theme,
) -> IconButton {
    IconButton::new(id, Icon::new(icon).with_size(px(size)))
        .label(label)
        .with_size(px(24.))
        .color(t.subtle)
        .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
}
/// `.desktop-git-view-header`: `min-height: 36px; padding: 4px 10px 2px 14px`.
fn view_header(t: Theme) -> Div {
    h_flex()
        .flex_shrink_0()
        .min_h(px(36.))
        .pt(px(4.))
        .pb(px(2.))
        .pl(px(14.))
        .pr(px(10.))
        .gap(px(6.))
        .justify_between()
        .text_color(t.muted)
}
/// `.desktop-git-view-title`.
fn view_title(text: impl Into<SharedString>, t: Theme) -> Div {
    let m = theme::ty();
    div()
        .flex_1()
        .min_w_0()
        .truncate()
        .text_size(px(m.right.meta))
        .line_height(px(m.right.meta_line_height))
        .font_weight(FontWeight::NORMAL)
        .text_color(t.muted)
        .child(text.into())
}
/// `GitOperationButton`: 24px, filled, primary in the accent.
fn operation_button(
    id: impl Into<ElementId>,
    icon: &'static str,
    label: impl Into<SharedString>,
    primary: bool,
    disabled: bool,
) -> Button {
    Button::new(id)
        .variant(if primary {
            ButtonVariant::FilledPrimary
        } else {
            ButtonVariant::Filled
        })
        .small()
        .icon(icon)
        .label(label)
        .disabled(disabled)
}
/// A working-tree row action (24px, 13px glyph).
fn row_action(
    id: impl Into<ElementId>,
    icon: &'static str,
    label: impl Into<SharedString>,
) -> RowActionButton {
    RowActionButton::new(id, Icon::new(icon).with_size(px(13.)).stroke(2.)).label(label)
}
impl SourceControl {
    /// `SourceControlWorkingTreeRow`.
    fn working_row(
        &self,
        panel: Panel,
        index: usize,
        change: &Change,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let m = theme::ty();
        let staged = panel == Panel::Staged;
        let status = if staged {
            change.index
        } else {
            change.worktree
        };
        let status = match status {
            '?' => 'U',
            ' ' => change.index,
            other => other,
        };
        // `getGitDisplayName`: `old -> new` for a rename (Geist draws the
        // arrow ligature).
        let base = |p: &str| p.rsplit('/').next().unwrap_or(p).to_owned();
        let name = match change.original.as_deref().filter(|o| *o != change.path) {
            Some(old) => format!("{} -> {}", base(old), base(&change.path)),
            None => base(&change.path),
        };
        // `.desktop-working-tree-state` sits on the name's baseline; GPUI
        // text has none to align to, so place it by Geist's metrics.
        let baseline =
            |size: f32, line: f32| (line - size * theme::NORMAL_LINE_HEIGHT) / 2. + size * 1.005;
        let marker_top =
            baseline(m.left.content, m.left.line_height) - baseline(m.ui.micro, m.ui.micro);
        let select = change.clone();
        let stage = change.clone();
        let discard = change.clone();
        // A change elsewhere in the repository is listed, not acted on.
        let owned = self.snapshot.as_ref().is_some_and(|s| s.owns(change));
        let state_label = tf(
            if staged {
                "source-control.action.unstagePath"
            } else {
                "source-control.action.stagePath"
            },
            &[("path", change.path.clone().into())],
        );
        let discard_label = tf(
            "source-control.action.discardPath",
            &[("path", change.path.clone().into())],
        );
        let entry = SidebarRow::new(SharedString::from(format!(
            "git-row-{panel:?}-{}",
            change.path
        )))
        .variant(RowVariant::List)
        .leading(FileIcon::file(change.path.clone(), self.icon_theme.clone()))
        .child(
            h_flex()
                .flex_1()
                .min_w_0()
                .items_start()
                .gap(px(5.))
                .child(div().min_w_0().truncate().child(name))
                .child(
                    div()
                        .flex_shrink_0()
                        .mt(px(marker_top))
                        .text_size(px(m.ui.micro))
                        .line_height(px(m.ui.micro))
                        .text_color(t.text_disabled)
                        .child(status.to_string()),
                ),
        )
        // Every unstaged change can be discarded; an untracked file is
        // deleted (`discardWorkspaceGitPaths`).
        .when(owned && !staged && !change.conflict(), |row| {
            row.action(
                row_action(("discard", index), "undo-2", discard_label)
                    .danger()
                    .on_click(cx.listener(move |s, _, window, cx| {
                        cx.stop_propagation();
                        s.confirm_discard(discard.clone(), window, cx);
                    })),
            )
        })
        .when(owned, |row| {
            row.action(
                row_action(
                    ("stage", index),
                    if staged { "minus" } else { "plus" },
                    state_label,
                )
                .on_click(cx.listener(move |s, _, _, cx| {
                    cx.stop_propagation();
                    s.operation(
                        if staged {
                            Operation::Unstage(stage.clone())
                        } else {
                            Operation::Stage(stage.clone())
                        },
                        cx,
                    )
                })),
            )
        })
        .on_click(cx.listener(move |s, _, _, cx| s.select(select.clone(), staged, cx)));
        // `.desktop-working-tree-list` inline padding (12px each side).
        div()
            .h(px(theme::sidebar_stride()))
            .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .child(entry)
            .into_any_element()
    }
    /// `SourceControlSectionHeader` + the panel's actions.
    fn section_header(
        &self,
        panel: Panel,
        count: usize,
        show_count: bool,
        action: Option<AnyElement>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let host = cx.weak_entity();
        let header = SectionHeader::new(
            SharedString::from(format!("git-section-{panel:?}")),
            tr(if panel == Panel::Unstaged && count == 0 {
                "source-control.label.changes"
            } else if panel == Panel::Merge
                && self
                    .snapshot
                    .as_ref()
                    .is_some_and(|s| s.operation.is_some())
            {
                "source-control.section.operation"
            } else {
                panel.title()
            }),
        )
        .expanded(!self.collapsed.contains(&panel))
        .when(show_count, |h| h.count(count))
        .when_some(action, |h, action| h.action(action))
        .on_toggle(move |_, cx| {
            let _ = host.update(cx, |s, cx| {
                s.panel_layout.cancel();
                if !s.collapsed.remove(&panel) {
                    s.collapsed.insert(panel);
                }
                cx.notify();
            });
        })
        .into_any_element();
        div()
            .debug_selector(move || format!("git-section-{panel:?}"))
            .child(header)
            .into_any_element()
    }
    /// Automatic row-based sizing until a boundary is resized. Explicit
    /// heights retain the same minimum/maximum and can shrink with the window.
    fn panel(&self, panel: Panel, rows: f32, header: AnyElement, body: AnyElement) -> Div {
        let row_h = theme::control();
        let collapsed = self.collapsed.contains(&panel);
        let visible = rows.clamp(0., MAX_VISIBLE_ROWS as f32);
        let max = if collapsed || visible == 0. {
            row_h
        } else {
            row_h * (visible + 1.) + SECTION_BODY_TOP_GAP + visible * 2.
        };
        let min = if collapsed { row_h } else { 72f32.min(max) };
        let measured = self.panel_layout.geometry.clone();
        v_flex()
            .debug_selector(move || format!("git-panel-{panel:?}"))
            .relative()
            .when(collapsed, |d| d.flex_none().h(px(row_h)))
            .when(!collapsed, |d| {
                d.flex_grow(panel.grow())
                    .flex_shrink(1.)
                    .flex_basis(px(0.))
                    .when_some(self.panel_layout.heights[panel as usize], |d, height| {
                        d.flex_grow(0.).flex_basis(px(height))
                    })
            })
            .min_h(px(min))
            .max_h(px(max))
            .overflow_hidden()
            .child(header)
            .when(!collapsed, |d| d.child(body))
            .child(
                canvas(
                    move |bounds, _, _| {
                        measured.borrow_mut()[panel as usize] = Some(panel_layout::Geometry {
                            height: bounds.size.height.into(),
                            min,
                            max,
                        });
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
    }
    fn file_list(&self, panel: Panel, count: usize, cx: &mut Context<Self>) -> AnyElement {
        let scroll = self.panel_scroll[panel as usize].clone();
        let list = uniform_list(
            SharedString::from(format!("git-list-{panel:?}")),
            count,
            cx.processor(move |s, range: std::ops::Range<usize>, _, cx| {
                #[cfg(test)]
                {
                    s.painted_rows += range.len();
                }
                let Some(section) = s.sections.iter().find(|x| x.panel == panel).cloned() else {
                    return vec![];
                };
                range
                    .filter_map(|i| {
                        section
                            .changes
                            .get(i)
                            .map(|c| s.working_row(panel, i, c, cx))
                    })
                    .collect::<Vec<_>>()
            }),
        )
        .flex_1()
        .min_h_0()
        .pt(px(SECTION_BODY_TOP_GAP))
        .track_scroll(&scroll);
        gpui_kit::base::v_flex()
            .flex_1()
            .min_h_0()
            .child(list)
            .child(crate::ui::scrollbar::vertical(
                SharedString::from(format!("git-list-scrollbar-{panel:?}")),
                &scroll,
            ))
            .into_any_element()
    }
    /// `.desktop-git-section-empty` / `.desktop-git-committed-summary` text
    /// under the section title label.
    fn section_note(text: impl Into<SharedString>, t: Theme) -> AnyElement {
        div()
            .flex_shrink_0()
            .min_h(px(26.))
            .mt(px(SECTION_BODY_TOP_GAP))
            .pl(px(metric::SIDEBAR_ROW_LEFT_GAP
                + metric::SIDEBAR_ROW_CONTENT_LEFT
                + 14.
                + 6.))
            .pr(px(
                metric::SIDEBAR_ROW_RIGHT_GAP + metric::SIDEBAR_ROW_CONTENT_RIGHT
            ))
            .flex()
            .items_center()
            .text_size(px(theme::ty().ui.meta))
            .text_color(t.subtle)
            .child(text.into())
            .into_any_element()
    }
    /// `GitIncomingUpdateNotice` in the sync priority region.
    fn incoming_notice(
        &self,
        sync: &git::sync_state::State,
        primary: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        let t = cx.palette();
        let m = theme::ty();
        div()
            .flex_shrink_0()
            .pb(px(13.))
            .mb(px(5.))
            .relative()
            .child(
                h_flex()
                    .mt(px(8.))
                    .mx(px(metric::SIDEBAR_ROW_LEFT_GAP))
                    .pt(px(9.))
                    .pr(px(9.))
                    .pb(px(8.))
                    .pl(px(10.))
                    .gap(px(8.))
                    .rounded(px(8.))
                    .bg(theme::mix(t.text, t.auxiliary(), 0.11))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(px(m.left.content))
                            .line_height(px(m.left.line_height))
                            .text_color(t.muted)
                            .child(tf(
                                "source-control.commit.commits",
                                &[("count", sync.behind.into())],
                            )),
                    )
                    .child(
                        operation_button(
                            "git-pull",
                            "arrow-down",
                            tr(if self.running == Some(Operation::Pull.label()) {
                                "source-control.sync.pulling"
                            } else {
                                "source-control.sync.pull"
                            }),
                            primary,
                            self.busy || sync.pull_disabled,
                        )
                        .debug_selector(|| "git-pull".into())
                        .tooltip(sync.pull_title.clone())
                        // `handlePullGit` runs without a confirmation.
                        .on_click(cx.listener(|s, _, _, cx| s.operation(Operation::Pull, cx))),
                    ),
            )
            .child(
                div()
                    .absolute()
                    .bottom_0()
                    .left(px(metric::SIDEBAR_ROW_LEFT_GAP))
                    .right(px(metric::SIDEBAR_ROW_RIGHT_GAP))
                    .h(px(1.))
                    .bg(theme::alpha(t.divider, 0.64)),
            )
    }
    /// The Changes list (`GitSidebar`): priority notice, resizable panels and
    /// the fixed region with errors.
    fn changes_list(
        &mut self,
        snapshot: &Snapshot,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let t = cx.palette();
        let has = |panel| self.sections.iter().any(|s: &Section| s.panel == panel);
        let conflicts = has(Panel::Merge);
        let operation = snapshot.operation.is_some();
        // `syncBlocked`.
        let blocked = conflicts || operation;
        let sync = git::sync_state::for_snapshot(snapshot);
        let committed = committed_action(snapshot, blocked);
        // `remote.ahead` / `behind`: counted against an existing target only.
        let ahead = if snapshot.remote_exists() {
            snapshot.ahead
        } else {
            0
        };
        let primary = primary_slot(SlotCandidates {
            conflicts,
            // `operationPrimaryAction`: Continue, once nothing conflicts.
            operation,
            sync: sync.behind > 0 && !sync.pull_disabled,
            staged: has(Panel::Staged) && !blocked,
            committed: committed.is_some_and(|(_, disabled)| !disabled),
            stage_and_commit: has(Panel::Unstaged) && !blocked,
        });
        let mut stack = v_flex().flex_1().min_h_0().overflow_hidden();
        let mut panels: Vec<(Panel, Div)> = vec![];
        if conflicts || operation {
            let count = self
                .sections
                .iter()
                .find(|s| s.panel == Panel::Merge)
                .map_or(0, |s| s.changes.len());
            let action = operation.then(|| {
                self.operation_actions(conflicts, primary == Some(PrimarySlot::Operation), cx)
                    .into_any_element()
            });
            let header = self.section_header(Panel::Merge, count, true, action, cx);
            let body = if count > 0 {
                self.file_list(Panel::Merge, count, cx)
            } else {
                div().into_any_element()
            };
            panels.push((
                Panel::Merge,
                self.panel(Panel::Merge, count as f32, header, body),
            ));
        }
        if ahead > 0 || committed.is_some() {
            let action = committed.map(|(kind, disabled)| {
                let (id, label, loading) = match kind {
                    CommittedAction::Publish => (
                        "git-publish",
                        tr("source-control.sync.publish").to_owned(),
                        "source-control.sync.publishing",
                    ),
                    CommittedAction::Push => (
                        "git-push",
                        sync.push_label.clone(),
                        "source-control.sync.pushing",
                    ),
                };
                let op = kind.operation();
                operation_button(
                    id,
                    "arrow-up",
                    if self.running == Some(op.label()) {
                        tr(loading).to_owned()
                    } else {
                        label
                    },
                    primary == Some(PrimarySlot::Committed),
                    self.busy || disabled || (kind == CommittedAction::Push && sync.push_disabled),
                )
                .debug_selector(move || id.into())
                .tooltip(if blocked && !(snapshot.ahead > 0 && snapshot.behind > 0) {
                    tr("source-control.sync.resolveBeforeSync").to_owned()
                } else {
                    sync.push_title.clone()
                })
                // `handlePushGit` / `handlePublishGitBranch` run without a
                // confirmation.
                .on_click(cx.listener(move |s, _, _, cx| s.operation(kind.operation(), cx)))
                .into_any_element()
            });
            let header = self.section_header(Panel::Committed, ahead as usize, true, action, cx);
            let note = Self::section_note(
                if ahead == 0 {
                    tr("source-control.status.empty").to_owned()
                } else {
                    tf(
                        "source-control.committed.ready",
                        &[
                            ("count", (ahead as usize).into()),
                            (
                                "action",
                                match committed {
                                    Some((CommittedAction::Publish, _)) => {
                                        tr("source-control.sync.publish").to_owned()
                                    }
                                    _ => sync.push_label.clone(),
                                }
                                .into(),
                            ),
                        ],
                    )
                },
                t,
            );
            panels.push((
                Panel::Committed,
                self.panel(Panel::Committed, 1.5, header, note),
            ));
        }
        if let Some(section) = self.sections.iter().find(|s| s.panel == Panel::Staged) {
            let count = section.changes.len();
            let action = operation_button(
                "git-commit",
                "plus",
                tr(if self.running == Some("commit") {
                    "source-control.action.committing"
                } else {
                    "source-control.sync.commit"
                }),
                primary == Some(PrimarySlot::Staged),
                // `canCommit`: never over conflicts or an operation.
                self.busy || blocked,
            )
            .tooltip(tr("source-control.sync.commitStaged"))
            .on_click(cx.listener(|s, _, _, cx| s.operation(Operation::Commit(String::new()), cx)));
            let header = self.section_header(
                Panel::Staged,
                count,
                true,
                Some(action.into_any_element()),
                cx,
            );
            panels.push((
                Panel::Staged,
                self.panel(
                    Panel::Staged,
                    count as f32,
                    header,
                    self.file_list(Panel::Staged, count, cx),
                ),
            ));
        }
        if let Some(section) = self.sections.iter().find(|s| s.panel == Panel::Unstaged) {
            let count = section.changes.len();
            let action = operation_button(
                "git-stage-commit",
                "plus",
                tr(if self.running == Some("stage-commit") {
                    "source-control.action.committing"
                } else {
                    "source-control.action.stageCommit"
                }),
                primary == Some(PrimarySlot::StageAndCommit),
                self.busy || blocked,
            )
            .tooltip(tr("source-control.action.stageCommitTitle"))
            .on_click(cx.listener(|s, _, _, cx| s.operation(Operation::StageAndCommit, cx)));
            let header = self.section_header(
                Panel::Unstaged,
                count,
                true,
                Some(action.into_any_element()),
                cx,
            );
            panels.push((
                Panel::Unstaged,
                self.panel(
                    Panel::Unstaged,
                    count as f32,
                    header,
                    self.file_list(Panel::Unstaged, count, cx),
                ),
            ));
        }
        if panels.is_empty() {
            // `showCleanSection`: a "Changes" panel with the empty note.
            let header = self.section_header(Panel::Unstaged, 0, false, None, cx);
            let note = Self::section_note(tr("source-control.status.noLocalChanges"), t);
            panels.push((
                Panel::Unstaged,
                self.panel(Panel::Unstaged, 1.5, header, note),
            ));
        }
        self.panel_layout
            .reconcile(&panels.iter().map(|(id, _)| *id).collect::<Vec<_>>());
        let mut previous = None;
        for (id, panel) in panels {
            if let Some(previous) = previous {
                stack = stack.child(self.section_resize_handle(previous, id, window, cx));
            }
            stack = stack.child(panel);
            previous = Some(id);
        }
        let mut list = v_flex()
            .flex_1()
            .min_h_0()
            .pt(px(metric::SIDEBAR_LIST_PADDING_BLOCK));
        if sync.behind > 0 {
            list = list.child(self.incoming_notice(&sync, primary == Some(PrimarySlot::Sync), cx));
        }
        list = list.child(stack);
        // `.desktop-git-fixed-region`.
        if self.shows_backup_card(snapshot) {
            list = list.child(self.backup_card(cx));
        }
        if let Some(error) = &self.error {
            list = list.child(self.error_banner(error.clone(), cx));
        }
        if snapshot.truncated {
            list = list.child(
                div()
                    .flex_shrink_0()
                    .px(px(
                        metric::SIDEBAR_ROW_LEFT_GAP + metric::SIDEBAR_ROW_CONTENT_LEFT
                    ))
                    .py(px(6.))
                    .text_size(px(theme::ty().left.meta))
                    .text_color(t.warning)
                    .child(tf(
                        "source-control.status.limit",
                        &[("count", 10_000usize.into())],
                    )),
            );
        }
        list
    }
    /// The operation section's actions (`.desktop-git-section-actions`):
    /// Abort after a confirmation, and Continue once nothing conflicts.
    fn operation_actions(&self, conflicts: bool, primary: bool, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        h_flex()
            .flex_none()
            .gap(px(2.))
            .child(
                // `.po-sidebar-icon-button.danger`: tinted at rest.
                IconButton::new(
                    "git-abort-operation",
                    Icon::new("undo-2").with_size(px(13.)).stroke(2.),
                )
                .label(tr("source-control.sync.abort"))
                .with_size(px(24.))
                .danger()
                .color(theme::mix(t.danger, t.muted, 0.72))
                .rounded(px(5.))
                .disabled(self.busy)
                .on_click(cx.listener(|s, _, window, cx| {
                    cx.stop_propagation();
                    s.confirm_abort(window, cx);
                })),
            )
            .when(!conflicts, |d| {
                d.child(
                    operation_button(
                        "git-continue-operation",
                        "check",
                        tr(if self.running == Some("continue") {
                            "source-control.sync.continuing"
                        } else {
                            "source-control.sync.continue"
                        }),
                        primary,
                        self.busy,
                    )
                    .on_click(cx.listener(|s, _, _, cx| s.operation(Operation::Continue, cx))),
                )
            })
    }
    /// `window.confirm(source-control.dialog.abortOperation)` before Abort.
    fn confirm_abort(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let answer = window.prompt(
            PromptLevel::Warning,
            tr("source-control.dialog.abortOperation"),
            None,
            &[tr("source-control.sync.abort"), tr("common.action.cancel")],
            cx,
        );
        cx.spawn(async move |this, cx| {
            if answer.await == Ok(0) {
                let _ = this.update(cx, |s, cx| s.operation(Operation::Abort, cx));
            }
        })
        .detach();
    }
    /// `.desktop-git-operation-error`.
    fn error_banner(&self, error: String, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        h_flex()
            .flex_shrink_0()
            .mx(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .my(px(8.))
            .px(px(10.))
            .py(px(8.))
            .gap(px(6.))
            .rounded(px(8.))
            .bg(theme::alpha(t.danger, 0.08))
            .text_size(px(theme::ty().left.meta))
            .text_color(t.danger)
            .child(div().flex_1().min_w_0().child(error))
            .child(
                view_action(
                    "git-dismiss-error",
                    "x",
                    13.,
                    tr("source-control.action.dismiss"),
                    t,
                )
                .on_click(cx.listener(|s, _, _, cx| {
                    s.error = None;
                    cx.notify();
                })),
            )
    }
    /// `.desktop-git-loading-state` / setup state: centred quiet text.
    fn centered_note(text: impl Into<SharedString>, t: Theme) -> Div {
        let m = theme::ty();
        v_flex()
            .flex_1()
            .min_h(px(120.))
            .items_center()
            .justify_center()
            .gap(px(9.))
            .px(px(18.))
            .py(px(24.))
            .text_size(px(m.right.meta))
            .line_height(px(m.right.meta_line_height))
            .text_color(t.subtle)
            .child(text.into())
    }
    /// `handleDiscardGitPaths`: the system confirmation (`window.confirm`)
    /// before the change is thrown away.
    fn confirm_discard(&mut self, change: Change, window: &mut Window, cx: &mut Context<Self>) {
        let answer = window.prompt(
            PromptLevel::Warning,
            &tf(
                "source-control.dialog.discard.path",
                &[("path", change.path.clone().into())],
            ),
            None,
            &[
                tr("source-control.action.discard"),
                tr("common.action.cancel"),
            ],
            cx,
        );
        cx.spawn(async move |this, cx| {
            if answer.await == Ok(0) {
                let _ = this.update(cx, |s, cx| s.operation(Operation::Discard(change), cx));
            }
        })
        .detach();
    }
    /// `WorkingFileActions`: open the file, stage or unstage it, discard it.
    fn working_actions(&self, selection: &Selection, cx: &mut Context<Self>) -> Div {
        let change = selection.change.clone();
        // Outside the opened folder a change is shown, never acted on.
        if !self.snapshot.as_ref().is_some_and(|s| s.owns(&change)) {
            return h_flex();
        }
        let open_path = self.workspace_path(&change.path);
        let can_open = selection.status() != 'D' && open_path.is_some();
        let open_path = open_path.unwrap_or_default();
        let mut actions = h_flex().flex_none().gap(px(4.)).when(can_open, |d| {
            d.child(
                Button::new("git-detail-open")
                    .variant(ButtonVariant::GitAction)
                    .icon("file-text")
                    .label(tr("source-control.action.openFile"))
                    .disabled(self.busy)
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(SourceControlEvent::OpenFile(open_path.clone()))
                    })),
            )
        });
        if selection.staged() {
            actions = actions.child(
                Button::new("git-detail-unstage")
                    .variant(ButtonVariant::GitAction)
                    .label(tr("source-control.action.unstage"))
                    .disabled(self.busy)
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.operation(Operation::Unstage(change.clone()), cx)
                    })),
            );
        } else {
            let stage = change.clone();
            actions = actions
                .child(
                    Button::new("git-detail-stage")
                        .variant(ButtonVariant::GitAction)
                        .label(tr("source-control.action.stage"))
                        .disabled(self.busy)
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.operation(Operation::Stage(stage.clone()), cx)
                        })),
                )
                .child(
                    Button::new("git-detail-discard")
                        .variant(ButtonVariant::GitActionDanger)
                        .label(tr("source-control.action.discard"))
                        .disabled(self.busy)
                        .on_click(cx.listener(move |s, _, window, cx| {
                            s.confirm_discard(change.clone(), window, cx);
                        })),
                );
        }
        actions
    }
    /// One row of the open detail's list: a commit's summary, then diffs.
    fn detail_row(&self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let Some(detail) = &self.detail else {
            return div().into_any_element();
        };
        if let DetailKind::Commit(commit) = &detail.kind
            && index == 0
        {
            return self.commit_summary(commit, cx);
        }
        let Some(index) = index.checked_sub(detail.lead()) else {
            return div().into_any_element();
        };
        let (Some(Ok(files)), Some(row)) = (&detail.files, detail.rows.get(index)) else {
            return div().into_any_element();
        };
        // Working-tree files open from their binary summary; deleted and
        // committed ones cannot.
        let open_file = match &detail.kind {
            DetailKind::Working(selection)
                if selection.status() != 'D'
                    && self.workspace_path(&selection.change.path).is_some() =>
            {
                let host = cx.weak_entity();
                let prefix = self.prefix().to_owned();
                Some(
                    std::rc::Rc::new(move |path: &str, _: &mut Window, cx: &mut App| {
                        let Some(path) = git::local(&prefix, path).map(str::to_owned) else {
                            return;
                        };
                        let _ =
                            host.update(cx, |_, cx| cx.emit(SourceControlEvent::OpenFile(path)));
                    }) as diff::OpenFile,
                )
            }
            _ => None,
        };
        let context = diff::RowContext {
            files,
            density: detail.density(),
            palette: diff::DiffPalette::new(cx.palette()),
            open_file,
        };
        diff::render_row(row, &context)
    }
    /// `WorkingFileDetail` / the History commit's files: loading, an error,
    /// nothing textual, or the diff list.
    fn detail_view(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let Some(detail) = &self.detail else {
            return div().into_any_element();
        };
        let retry = (detail.failed() && detail.reader.is_some()).then(|| {
            h_flex()
                .flex_none()
                .px(px(detail.density().inline()))
                .py(px(8.))
                .child(
                    Button::new("git-diff-retry")
                        .debug_selector(|| "git-diff-retry".into())
                        .variant(ButtonVariant::Secondary)
                        .label(tr("common.action.retry"))
                        .on_click(cx.listener(|s, _, _, cx| s.retry_detail(cx))),
                )
        });
        if matches!(&detail.files, Some(Ok(files)) if !files.is_empty()) {
            let host = cx.weak_entity();
            return gpui_kit::base::v_flex()
                .flex_1()
                .min_h_0()
                .children(retry)
                .child(
                    list(detail.list.clone(), move |i, _, cx| {
                        host.update(cx, |s, cx| s.detail_row(i, cx))
                            .unwrap_or_else(|_| div().into_any_element())
                    })
                    .flex_1()
                    .min_h_0(),
                )
                .child(crate::ui::scrollbar::vertical(
                    "git-detail-scrollbar",
                    &detail.list,
                ))
                .into_any_element();
        }
        // `.desktop-commit-empty` / `.desktop-utility-empty`: under the
        // commit's summary, or at the top of a working file's detail.
        let summary = match &detail.kind {
            DetailKind::Commit(commit) => Some(self.commit_summary(commit, cx)),
            DetailKind::Working(_) => None,
        };
        let inline = detail.density().inline();
        let note = |text: SharedString, color: Rgba, italic: bool| {
            div()
                .px(px(inline))
                .when(summary.is_none(), |d| d.pt(px(8.)))
                .child(
                    div()
                        .px(px(16.))
                        .py(px(14.))
                        .text_size(px(theme::ty().ui.meta))
                        .line_height(relative(theme::NORMAL_LINE_HEIGHT))
                        .text_color(color)
                        .when(italic, |d| d.font_family(theme::SANS_ITALIC).italic())
                        .child(text),
                )
        };
        let body = match &detail.files {
            None => {
                let label = match &detail.kind {
                    DetailKind::Working(selection)
                        if selection
                            .change
                            .path
                            .to_ascii_lowercase()
                            .ends_with(".docx") =>
                    {
                        tr("source-control.diff.docx.loading").to_owned()
                    }
                    DetailKind::Working(selection) => tf(
                        "source-control.status.loadingDiffFor",
                        &[("path", selection.change.path.clone().into())],
                    ),
                    DetailKind::Commit(_) => tr("source-control.status.loadingDiff").to_owned(),
                };
                Self::centered_note(label, t)
            }
            Some(Err(error)) => note(error.clone().into(), t.danger, false),
            Some(Ok(_)) => note(
                tr(match detail.kind {
                    DetailKind::Working(_) => "source-control.diff.noText",
                    DetailKind::Commit(_) => "source-control.commit.noFileChanges",
                })
                .into(),
                t.subtle,
                true,
            ),
        };
        v_flex()
            .flex_1()
            .min_h_0()
            .children(summary)
            .child(body)
            .children(retry)
            .into_any_element()
    }
}
impl Render for SourceControl {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(test)]
        {
            self.painted_rows = 0;
        }
        let t = cx.palette();
        // `.desktop-git-changes-sidebar` on `--po-surface-auxiliary`.
        let pane = v_flex()
            .size_full()
            .min_h_0()
            .bg(t.auxiliary())
            .text_color(t.text);
        let nested = self.detail.is_some() || self.history_open;
        let working = match self.detail.as_ref().map(|d| &d.kind) {
            Some(DetailKind::Working(selection)) => Some(selection.clone()),
            _ => None,
        };
        let mut header = view_header(t);
        if let Some(selection) = &working {
            // `.desktop-git-changes-detail-header`: Back, then the file's
            // actions at the far edge.
            header = header.pl(px(8.)).child(
                view_action(
                    "git-back",
                    "arrow-left",
                    15.,
                    tr("shared-ui.navigation.back"),
                    t,
                )
                .debug_selector(|| "git-diff-back".into())
                .on_click(cx.listener(|s, _, _, cx| {
                    s.close_detail();
                    cx.notify();
                })),
            );
            header = header.child(self.working_actions(selection, cx));
        } else if nested {
            // `.desktop-git-changes-detail-header` / `.desktop-git-history-header`.
            header = header.pl(px(8.)).justify_start().child(
                view_action(
                    "git-back",
                    "arrow-left",
                    15.,
                    tr("shared-ui.navigation.back"),
                    t,
                )
                .debug_selector(|| "git-diff-back".into())
                .on_click(cx.listener(|s, _, _, cx| {
                    if s.detail.is_none() {
                        s.show_changes(cx);
                    } else {
                        s.close_detail();
                    }
                    cx.notify();
                })),
            );
        }
        if working.is_none() {
            header = header.child(view_title(
                tr(if self.history_open {
                    "source-control.history.title"
                } else {
                    "source-control.label.changes"
                }),
                t,
            ));
        }
        if !nested {
            header = header.child(
                view_action(
                    "git-history",
                    "history",
                    14.,
                    tr("source-control.history.title"),
                    t,
                )
                .on_click(cx.listener(|s, _, _, cx| s.open_history(cx))),
            );
        }
        let pane = pane.child(header).child(self.section_resize_tracking(cx));
        if self.detail.is_some() {
            return pane.child(self.detail_view(cx));
        }
        if self.history_open {
            return pane.child(self.history_view(cx));
        }
        if let Some(snapshot) = self.snapshot.clone() {
            return pane.child(self.changes_list(&snapshot, window, cx));
        }
        let not_repo = self.root.is_some() && self.repository_absent;
        if not_repo {
            // `GitRepositorySetupAction`.
            return pane.child(
                Self::centered_note(tr("source-control.history.inactive"), t).child(
                    operation_button(
                        "git-init",
                        "plus",
                        tr(if self.running == Some(Operation::Init.label()) {
                            "source-control.setup.enabling"
                        } else {
                            "source-control.setup.enable"
                        }),
                        true,
                        self.busy,
                    )
                    .debug_selector(|| "git-init".into())
                    .on_click(cx.listener(|s, _, _, cx| s.operation(Operation::Init, cx))),
                ),
            );
        }
        if let Some(error) = self.error.clone() {
            return pane.child(self.error_banner(error, cx));
        }
        pane.child(Self::centered_note(
            if self.root.is_some() {
                tr("source-control.status.readingGit")
            } else {
                tr("source-control.sync.noLocalRepository")
            },
            t,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    /// `sourceControlWorkflow.test.ts`: the single-branch collaboration policy.
    #[test]
    fn one_primary_action_follows_the_collaboration_policy() {
        let c = SlotCandidates::default;
        let cases = [
            (c(), None),
            (
                SlotCandidates {
                    stage_and_commit: true,
                    ..c()
                },
                Some(PrimarySlot::StageAndCommit),
            ),
            (
                SlotCandidates {
                    staged: true,
                    ..c()
                },
                Some(PrimarySlot::Staged),
            ),
            (
                SlotCandidates {
                    committed: true,
                    ..c()
                },
                Some(PrimarySlot::Committed),
            ),
            (
                SlotCandidates {
                    committed: true,
                    staged: true,
                    ..c()
                },
                Some(PrimarySlot::Staged),
            ),
            (
                SlotCandidates {
                    sync: true,
                    stage_and_commit: true,
                    ..c()
                },
                Some(PrimarySlot::Sync),
            ),
            (
                SlotCandidates {
                    sync: true,
                    staged: true,
                    ..c()
                },
                Some(PrimarySlot::Sync),
            ),
            (
                SlotCandidates {
                    sync: true,
                    committed: true,
                    ..c()
                },
                Some(PrimarySlot::Sync),
            ),
            (
                SlotCandidates {
                    operation: true,
                    sync: true,
                    staged: true,
                    ..c()
                },
                Some(PrimarySlot::Operation),
            ),
            (
                SlotCandidates {
                    conflicts: true,
                    operation: true,
                    sync: true,
                    staged: true,
                    committed: true,
                    ..c()
                },
                None,
            ),
        ];
        for (candidates, expected) in cases {
            assert_eq!(primary_slot(candidates), expected, "{candidates:?}");
        }
    }
    /// `getCommittedPrimaryAction`: Publish, a blocked or diverged Push, or none.
    #[test]
    fn committed_commits_are_published_or_pushed() {
        let target = |exists| {
            Some(git::SyncTarget {
                remote: "origin".into(),
                branch: "main".into(),
                exists,
            })
        };
        let snapshot = |target, ahead, behind, head: &str| Snapshot {
            branch: "main".into(),
            head: head.into(),
            target,
            ahead,
            behind,
            ..Snapshot::default()
        };
        use CommittedAction::{Publish, Push};
        let cases = [
            (
                snapshot(target(false), 0, 0, "abc"),
                false,
                Some((Publish, false)),
            ),
            (
                snapshot(target(false), 0, 0, "abc"),
                true,
                Some((Publish, true)),
            ),
            // Nothing to publish before the first commit, or with no remote.
            (snapshot(target(false), 0, 0, ""), false, None),
            (snapshot(None, 0, 0, "abc"), false, None),
            (
                snapshot(target(true), 2, 0, "abc"),
                false,
                Some((Push, false)),
            ),
            (
                snapshot(target(true), 2, 0, "abc"),
                true,
                Some((Push, true)),
            ),
            (
                snapshot(target(true), 2, 3, "abc"),
                false,
                Some((Push, true)),
            ),
            (snapshot(target(true), 0, 3, "abc"), false, None),
            (snapshot(target(true), 0, 0, "abc"), false, None),
        ];
        for (snapshot, blocked, expected) in cases {
            assert_eq!(
                committed_action(&snapshot, blocked),
                expected,
                "{snapshot:?}"
            );
        }
    }
    #[gpui::test]
    fn stale_workspace_history_and_diff_results_cannot_publish(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(SourceControl::new);
        view.update_in(cx, |s, w, cx| {
            s.epoch = 3;
            s.selection = 9;
            s.history_ticket = 5;
            let commit = CommitSummary {
                id: "abc1234".into(),
                parents: vec![],
                author_name: String::new(),
                author_email: String::new(),
                created_at: None,
                message: "current".into(),
                changes: vec![],
            };
            let mut current = Detail::new(DetailKind::Commit(commit.clone()));
            current.publish(Ok(vec![]));
            s.detail = Some(current);
            s.tx.send((
                2,
                ResultValue::Status(Ok(Snapshot {
                    branch: "old workspace".into(),
                    ..Snapshot::default()
                })),
            ))
            .unwrap();
            s.tx.send((3, ResultValue::Diff(Err("old diff".into()), 8)))
                .unwrap();
            s.tx.send((
                3,
                ResultValue::History(
                    Ok(History {
                        commits: vec![CommitSummary {
                            message: "stale".into(),
                            ..commit.clone()
                        }],
                        head: None,
                    }),
                    4,
                ),
            ))
            .unwrap();
            s.poll(w, cx);
            assert!(s.snapshot.is_none());
            assert!(s.history.commits.is_empty());
            assert!(
                matches!(s.detail.as_ref().unwrap().files, Some(Ok(ref files)) if files.is_empty())
            );
        });
    }
    #[gpui::test]
    fn a_failed_operation_opens_its_dialog_and_a_failed_read_does_not(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(SourceControl::new);
        let failures = std::rc::Rc::new(std::cell::Cell::new(0));
        let seen = failures.clone();
        cx.update(|_, cx| {
            cx.subscribe(&view, move |_, event: &SourceControlEvent, _| {
                if *event == SourceControlEvent::Failure {
                    seen.set(seen.get() + 1);
                }
            })
            .detach()
        });
        view.update_in(cx, |s, w, cx| {
            s.busy = true;
            s.running = Some("push");
            s.tx.send((
                0,
                ResultValue::Status(Err("! [rejected] (fetch first)".into())),
            ))
            .unwrap();
            s.poll(w, cx);
            let failure = s.failure.clone().unwrap();
            assert_eq!(failure.operation, "push");
            assert!(failure.recommends_pull());
            assert!(s.error.is_none() && s.dirty);
            // A status read that fails is the sidebar's own note.
            s.busy = false;
            s.tx.send((0, ResultValue::Status(Err("index locked".into()))))
                .unwrap();
            s.poll(w, cx);
            assert_eq!(s.error.as_deref(), Some("index locked"));
            assert!(s.has_failure());
            // The next run closes the dialog.
            s.busy = false;
            s.operation(Operation::Pull, cx);
            assert!(!s.has_failure());
        });
        cx.run_until_parked();
        assert_eq!(failures.get(), 2);
    }
    /// `GitRemotePrompt`: Cloud on, nowhere to send commits, not dismissed.
    #[gpui::test]
    fn the_backup_card_asks_only_without_a_remote(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(SourceControl::new);
        view.update(cx, |s, cx| {
            let local = Snapshot {
                branch: "main".into(),
                ..Snapshot::default()
            };
            assert!(!s.shows_backup_card(&local));
            s.set_cloud_backup(true, false, cx);
            assert!(s.shows_backup_card(&local));
            for elsewhere in [
                Snapshot {
                    remotes: vec!["origin".into()],
                    ..local.clone()
                },
                Snapshot {
                    cloud_backup: true,
                    ..local.clone()
                },
                Snapshot {
                    upstream: Some("main".into()),
                    ..local.clone()
                },
            ] {
                assert!(!s.shows_backup_card(&elsewhere), "{elsewhere:?}");
            }
            s.backup_dismissed = true;
            assert!(!s.shows_backup_card(&local));
        });
    }
    #[gpui::test]
    fn reads_follow_invalidations_and_the_metadata_watch_not_a_clock(cx: &mut TestAppContext) {
        // Real Git and an OS watcher behind the scheduler.
        cx.executor().allow_parking();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let cancel = AtomicBool::new(false);
        git::operate(&root, &Operation::Init, &cancel).unwrap();
        std::fs::write(root.join("a.md"), "a").unwrap();
        let (view, cx) = cx.add_window_view(SourceControl::new);
        let has = |s: &SourceControl, path: &str| {
            s.snapshot
                .as_ref()
                .is_some_and(|snap| snap.changes.iter().any(|c| c.path == path))
        };
        // A liveness bound only: a fully loaded suite runs many Git processes.
        let settle = |cx: &mut VisualTestContext, done: &dyn Fn(&SourceControl) -> bool| {
            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                cx.run_until_parked();
                cx.executor().advance_clock(Duration::from_millis(50));
                if view.read_with(cx, |s, _| done(s)) {
                    return;
                }
                assert!(Instant::now() < deadline, "the status never arrived");
                std::thread::sleep(Duration::from_millis(5));
            }
        };
        view.update(cx, |s, cx| s.set_workspace(root.clone(), cx));
        settle(cx, &|s| has(s, "a.md") && s.git_watch.is_some());
        // Nothing reads the repository on a clock.
        std::fs::write(root.join("b.md"), "b").unwrap();
        for _ in 0..20 {
            cx.run_until_parked();
            cx.executor().advance_clock(Duration::from_millis(500));
            std::thread::sleep(Duration::from_millis(2));
        }
        view.read_with(cx, |s, _| assert!(!has(s, "b.md")));
        // A burst of invalidations reads once.
        view.update(cx, |s, cx| {
            s.invalidate(cx);
            assert!(s.debounce.is_some());
            s.invalidate(cx);
        });
        settle(cx, &|s| has(s, "b.md"));
        // An index change from outside (a terminal's `git add`) arrives
        // through the metadata watch alone.
        assert!(
            std::process::Command::new("/usr/bin/git")
                .arg("-C")
                .arg(&root)
                .args(["add", "b.md"])
                .status()
                .unwrap()
                .success()
        );
        settle(cx, &|s| {
            s.snapshot
                .as_ref()
                .is_some_and(|snap| snap.changes.iter().any(|c| c.path == "b.md" && c.staged()))
        });
    }
    #[gpui::test]
    fn large_git_snapshot_only_paints_visible_rows(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(SourceControl::new);
        view.update(cx, |s, _| {
            let snapshot = Snapshot {
                branch: "main".into(),
                changes: (0..10_000)
                    .map(|i| Change {
                        path: format!("file-{i}.rs"),
                        original: None,
                        index: ' ',
                        worktree: 'M',
                    })
                    .collect(),
                ..Snapshot::default()
            };
            s.sections = project_sections(&snapshot);
            s.snapshot = Some(snapshot);
        });
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        view.update(cx, |s, _| {
            assert_eq!(s.sections.len(), 1);
            assert_eq!(s.sections[0].changes.len(), 10_000);
            assert!(
                s.painted_rows > 0 && s.painted_rows < 200,
                "painted {} rows",
                s.painted_rows
            );
        });
    }

    #[gpui::test]
    fn a_fetch_finishing_after_a_mutation_cannot_replace_the_mutation_snapshot(
        cx: &mut TestAppContext,
    ) {
        let (view, cx) = cx.add_window_view(SourceControl::new);
        view.update_in(cx, |s, window, cx| {
            s.snapshot = Some(Snapshot {
                branch: "new-mutation".into(),
                ..Default::default()
            });
            s.fetching = true;
            s.tx.send((s.epoch, ResultValue::Fetched(Ok(())))).unwrap();
            s.poll(window, cx);
            assert_eq!(s.snapshot.as_ref().unwrap().branch, "new-mutation");
        });
    }

    #[gpui::test]
    fn native_sync_buttons_use_the_live_state_and_do_not_dispatch_disabled_operations(
        cx: &mut TestAppContext,
    ) {
        let (view, cx) = cx.add_window_view(SourceControl::new);
        // Exercise the actual rendered buttons and listeners. No root is
        // attached, so dispatch is observed without pushing to a network.
        for (ahead, behind, exists, head, busy, conflict, operation, selector, expected) in [
            (
                2,
                0,
                true,
                true,
                false,
                false,
                false,
                "git-push",
                Some(Operation::Push),
            ),
            (2, 3, true, true, false, false, false, "git-push", None),
            (2, 0, true, true, true, false, false, "git-push", None),
            (2, 0, true, true, false, true, false, "git-push", None),
            (2, 0, true, true, false, false, true, "git-push", None),
            (
                0,
                0,
                false,
                true,
                false,
                false,
                false,
                "git-publish",
                Some(Operation::Publish),
            ),
            (
                0,
                3,
                true,
                true,
                false,
                false,
                false,
                "git-pull",
                Some(Operation::Pull),
            ),
            (0, 3, true, true, true, false, false, "git-pull", None),
        ] {
            view.update(cx, |s, cx| {
                let snapshot = Snapshot {
                    branch: "topic".into(),
                    head: if head { "head".into() } else { String::new() },
                    ahead,
                    behind,
                    target: Some(git::SyncTarget {
                        remote: "backup".into(),
                        branch: "topic".into(),
                        exists,
                    }),
                    remotes: vec!["backup".into()],
                    sync_metadata: git::sync_state::Metadata {
                        hosting: git::sync_state::Hosting::Cloud,
                        ..Default::default()
                    },
                    changes: if conflict {
                        vec![Change {
                            path: "conflict.md".into(),
                            original: None,
                            index: 'U',
                            worktree: 'U',
                        }]
                    } else {
                        vec![]
                    },
                    operation: operation.then_some(git::RepositoryOperation::Merge),
                    ..Default::default()
                };
                s.sections = project_sections(&snapshot);
                s.snapshot = Some(snapshot);
                s.busy = busy;
                s.running = None;
                s.queued_operation = None;
                cx.notify();
            });
            cx.run_until_parked();
            cx.update(|window, cx| {
                window.draw(cx).clear(cx);
            });
            if operation {
                assert!(
                    cx.debug_bounds(selector).is_none(),
                    "an active repository operation hides its unavailable sync action"
                );
                continue;
            }
            let bounds = cx
                .debug_bounds(selector)
                .unwrap_or_else(|| panic!("missing {selector}: ahead={ahead}, behind={behind}, busy={busy}, conflict={conflict}, operation={operation}"));
            cx.simulate_click(bounds.center(), Modifiers::default());
            view.read_with(cx, |s, _| {
                assert_eq!(s.running, expected.as_ref().map(Operation::label), "{selector}: ahead={ahead}, behind={behind}, busy={busy}, conflict={conflict}, operation={operation}");
                assert!(s.queued_operation.is_none(), "disabled buttons must not queue an operation");
            });
        }
        for (head, detached, target) in [
            (false, false, true),
            (true, true, false),
            (true, false, false),
        ] {
            view.update(cx, |s, cx| {
                let snapshot = Snapshot {
                    branch: if detached {
                        "HEAD (no branch)".into()
                    } else {
                        "topic".into()
                    },
                    head: if head { "head".into() } else { String::new() },
                    target: target.then(|| git::SyncTarget {
                        remote: "origin".into(),
                        branch: "topic".into(),
                        exists: false,
                    }),
                    ..Default::default()
                };
                s.sections = project_sections(&snapshot);
                s.snapshot = Some(snapshot);
                s.busy = false;
                s.running = None;
                cx.notify();
            });
            cx.run_until_parked();
            cx.update(|window, cx| {
                window.draw(cx).clear(cx);
            });
            assert!(cx.debug_bounds("git-publish").is_none());
            assert!(cx.debug_bounds("git-push").is_none());
        }
    }
}
