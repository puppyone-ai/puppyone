//! Right-sidebar Changes surface: port of `GitChangesSidebar.tsx`,
//! `SourceControlSidebar.tsx` and `sidebar/*` (`GitLocalStatusPanels`,
//! `SourceControlSectionHeader`, `SourceControlWorkingTreeRow`,
//! `GitOperationButton`, `GitIncomingUpdateNotice`) with
//! `source-control/styles/*`. Git runs through `platform/git.rs` on a worker.
//! A selected change opens its file diff in place (`WorkingFileDetail` over
//! the format-aware `diff` registry).
mod diff;
mod history;

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
    Status(Result<Snapshot, String>),
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
/// A file diff list (Changes detail or a History commit) and its rows.
struct Detail {
    kind: DetailKind,
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
    Sync,
    Staged,
    Committed,
    StageAndCommit,
}
fn primary_slot(snapshot: &Snapshot, sections: &[Section]) -> Option<PrimarySlot> {
    let has = |panel| sections.iter().any(|s| s.panel == panel);
    if has(Panel::Merge) {
        None
    } else if snapshot.behind > 0 && snapshot.upstream.is_some() {
        Some(PrimarySlot::Sync)
    } else if has(Panel::Staged) {
        Some(PrimarySlot::Staged)
    } else if snapshot.ahead > 0 && snapshot.upstream.is_some() {
        Some(PrimarySlot::Committed)
    } else if has(Panel::Unstaged) {
        Some(PrimarySlot::StageAndCommit)
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
    pub error: Option<String>,
    operation_error: bool,
    busy: bool,
    mutating: bool,
    queued_operation: Option<Operation>,
    dirty: bool,
    last_refresh: Instant,
    history_open: bool,
    history_ticket: u64,
    history_cancel: Arc<AtomicBool>,
    detail_cancel: Arc<AtomicBool>,
    history: History,
    /// History has been read at least once (an empty one is final).
    history_loaded: bool,
    timeline: Vec<history::TimelineRow>,
    timeline_list: ListState,
    /// Collapsed days of the timeline (local `YYYY-MM-DD`).
    collapsed_days: std::collections::HashSet<String>,
    /// The commit id just copied (its icon reads "copied" briefly).
    copied: Option<String>,
    sections: Vec<Section>,
    /// Collapsed disclosure panels (`useGitSidebarExpansionState`).
    collapsed: std::collections::HashSet<Panel>,
    selection: u64,
    detail: Option<Detail>,
    confirm: Option<Operation>,
    layout: crate::features::settings::preference_types::GitSidebarLayout,
    icon_theme: String,
    #[cfg(test)]
    painted_rows: usize,
}
impl EventEmitter<SourceControlEvent> for SourceControl {}
impl SourceControl {
    /// Appearance → Git sidebar layout and file icon theme.
    pub fn set_presentation(
        &mut self,
        layout: crate::features::settings::preference_types::GitSidebarLayout,
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
            error: None,
            operation_error: false,
            busy: false,
            mutating: false,
            queued_operation: None,
            dirty: false,
            last_refresh: Instant::now(),
            history_open: false,
            history_ticket: 0,
            history_cancel: Arc::new(AtomicBool::new(false)),
            detail_cancel: Arc::new(AtomicBool::new(false)),
            history: History::default(),
            history_loaded: false,
            timeline: vec![],
            timeline_list: ListState::new(0, ListAlignment::Top, px(400.)),
            collapsed_days: Default::default(),
            copied: None,
            sections: vec![],
            collapsed: Default::default(),
            selection: 0,
            detail: None,
            confirm: None,
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
        self.cancel.store(true, Ordering::Relaxed);
        self.history_cancel.store(true, Ordering::Relaxed);
        self.detail_cancel.store(true, Ordering::Relaxed);
        self.cancel = Arc::new(AtomicBool::new(false));
        self.epoch += 1;
        self.root = Some(root);
        self.snapshot = None;
        self.error = None;
        self.operation_error = false;
        self.busy = false;
        self.mutating = false;
        self.queued_operation = None;
        self.history_open = false;
        self.detail = None;
        self.confirm = None;
        self.history = History::default();
        self.history_loaded = false;
        self.collapsed_days.clear();
        self.rebuild_timeline();
        self.sections.clear();
        self.refresh(cx);
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
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            self.dirty = true;
            return;
        }
        if self.root.is_none() {
            return;
        }
        self.busy = true;
        self.dirty = false;
        self.last_refresh = Instant::now();
        self.task(|root, cancel| ResultValue::Status(git::status(&root, cancel)));
        cx.notify();
    }
    fn operation(&mut self, op: Operation, cx: &mut Context<Self>) {
        if self.busy {
            if !self.mutating {
                self.queued_operation = Some(op);
            }
            return;
        }
        self.busy = true;
        self.mutating = true;
        self.error = None;
        self.operation_error = false;
        self.detail = None;
        self.selection += 1;
        self.task(move |root, cancel| ResultValue::Status(git::operate(&root, &op, cancel)));
        cx.notify();
    }
    fn poll(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        while let Ok((epoch, result)) = self.rx.try_recv() {
            if epoch != self.epoch {
                continue;
            }
            match result {
                ResultValue::Status(result) => {
                    self.busy = false;
                    let was_mutation = self.mutating;
                    self.mutating = false;
                    match result {
                        Ok(snapshot) => {
                            let changed = self.snapshot.as_ref() != Some(&snapshot);
                            if changed {
                                self.sections = project_sections(&snapshot);
                            }
                            self.snapshot = Some(snapshot);
                            if !self.operation_error {
                                self.error = None;
                            }
                            if self.history_open && changed {
                                self.load_history();
                            }
                        }
                        Err(e) => {
                            if was_mutation || !self.operation_error {
                                self.error = Some(e);
                                self.operation_error = was_mutation;
                            }
                        }
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
            && let Some(operation) = self.queued_operation.take()
        {
            self.operation(operation, cx);
        }
        if self.root.is_some()
            && (self.dirty
                || (window.is_window_active()
                    && self.last_refresh.elapsed() > Duration::from_secs(3)))
        {
            self.refresh(cx);
        }
        if self.root.is_some() {
            self.wake.after(Duration::from_secs(3));
        }
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
        read: impl FnOnce(PathBuf, &AtomicBool) -> Result<Vec<FileDiff>, String> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        self.selection += 1;
        let selection = self.selection;
        self.detail = Some(Detail::new(kind));
        self.detail_cancel.store(true, Ordering::Relaxed);
        self.detail_cancel = Arc::new(AtomicBool::new(false));
        self.task_with(self.detail_cancel.clone(), move |root, cancel| {
            ResultValue::Diff(read(root, cancel), selection)
        });
        cx.notify();
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
        self.open_detail(
            DetailKind::Working(Selection { change, scope }),
            move |root, cancel| git_diff::file_diff(&root, &path, old.as_deref(), scope, cancel),
            cx,
        );
    }
    /// `onOpenHistory`.
    pub fn open_history(&mut self, cx: &mut Context<Self>) {
        self.detail = None;
        self.history_open = true;
        self.load_history();
        cx.notify();
    }
    /// Open the `index`th History commit (capture scenarios).
    #[cfg_attr(not(feature = "dev-capture"), allow(dead_code))]
    pub fn select_commit(&mut self, index: usize, cx: &mut Context<Self>) -> bool {
        let Some(commit) = self.history.commits.get(index).cloned() else {
            return false;
        };
        let id = commit.id.clone();
        self.open_detail(
            DetailKind::Commit(commit),
            move |root, cancel| git_diff::commit_detail(&root, &id, cancel),
            cx,
        );
        true
    }
    /// A detail or the opened History is still being read.
    #[cfg_attr(not(feature = "dev-capture"), allow(dead_code))]
    pub fn reading_detail(&self) -> bool {
        self.detail.as_ref().is_some_and(|d| d.files.is_none())
            || (self.history_open && !self.history_loaded)
    }
    /// Open the change at `path` (capture scenarios).
    #[cfg_attr(not(feature = "dev-capture"), allow(dead_code))]
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
        self.cancel.store(true, Ordering::Relaxed);
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
        .when(!staged && !change.conflict(), |row| {
            row.action(
                row_action(("discard", index), "undo-2", discard_label)
                    .danger()
                    .on_click(cx.listener(move |s, _, _, cx| {
                        cx.stop_propagation();
                        s.confirm = Some(Operation::Discard(discard.clone()));
                        cx.notify();
                    })),
            )
        })
        .action(
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
        SectionHeader::new(
            SharedString::from(format!("git-section-{panel:?}")),
            tr(if panel == Panel::Unstaged && count == 0 {
                "source-control.label.changes"
            } else {
                panel.title()
            }),
        )
        .expanded(!self.collapsed.contains(&panel))
        .when(show_count, |h| h.count(count))
        .when_some(action, |h, action| h.action(action))
        .on_toggle(move |_, cx| {
            let _ = host.update(cx, |s, cx| {
                if !s.collapsed.remove(&panel) {
                    s.collapsed.insert(panel);
                }
                cx.notify();
            });
        })
        .into_any_element()
    }
    /// A `desktop-git-resizable-section`: grows by its weight up to its rows
    /// (at most nine), never below 72px, or a single header row collapsed.
    fn panel(&self, panel: Panel, rows: f32, header: AnyElement, body: AnyElement) -> Div {
        let row_h = theme::control();
        if self.collapsed.contains(&panel) {
            return v_flex()
                .flex_none()
                .h(px(row_h))
                .overflow_hidden()
                .child(header);
        }
        let visible = rows.min(MAX_VISIBLE_ROWS as f32);
        let max_h = row_h * (visible + 1.) + SECTION_BODY_TOP_GAP + visible * 2.;
        v_flex()
            .flex_grow(panel.grow())
            .flex_shrink(1.)
            .flex_basis(px(0.))
            .min_h(px(72f32.min(max_h)))
            .max_h(px(max_h))
            .overflow_hidden()
            .child(header)
            .child(body)
    }
    /// `.desktop-git-section-resizer`: 12px with a 1px line 5px down.
    fn section_divider(t: Theme) -> Div {
        div()
            .flex_shrink_0()
            .h(px(SECTION_DIVIDER_HEIGHT))
            .pt(px(5.))
            .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .child(div().h(px(1.)).w_full().bg(t.sidebar_divider))
    }
    fn file_list(&self, panel: Panel, count: usize, cx: &mut Context<Self>) -> AnyElement {
        uniform_list(
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
    fn incoming_notice(&self, behind: u32, primary: bool, cx: &mut Context<Self>) -> Div {
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
                                &[("count", (behind as usize).into())],
                            )),
                    )
                    .child(
                        operation_button(
                            "git-pull",
                            "arrow-down",
                            tr("source-control.sync.pull"),
                            primary,
                            self.busy,
                        )
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.confirm = Some(Operation::Pull);
                            cx.notify();
                        })),
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
    fn changes_list(&self, snapshot: &Snapshot, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let primary = primary_slot(snapshot, &self.sections);
        let mut stack = v_flex().flex_1().min_h_0().overflow_hidden();
        let mut panels: Vec<Div> = vec![];
        if let Some(section) = self.sections.iter().find(|s| s.panel == Panel::Merge) {
            let count = section.changes.len();
            let header = self.section_header(Panel::Merge, count, true, None, cx);
            panels.push(self.panel(
                Panel::Merge,
                count as f32,
                header,
                self.file_list(Panel::Merge, count, cx),
            ));
        }
        if snapshot.ahead > 0 && snapshot.upstream.is_some() {
            let push = tr("source-control.sync.push");
            let action = operation_button(
                "git-push",
                "arrow-up",
                push,
                primary == Some(PrimarySlot::Committed),
                self.busy,
            )
            .on_click(cx.listener(|s, _, _, cx| {
                s.confirm = Some(Operation::Push);
                cx.notify();
            }));
            let header = self.section_header(
                Panel::Committed,
                snapshot.ahead as usize,
                true,
                Some(action.into_any_element()),
                cx,
            );
            let note = Self::section_note(
                tf(
                    "source-control.committed.ready",
                    &[
                        ("count", (snapshot.ahead as usize).into()),
                        ("action", push.into()),
                    ],
                ),
                t,
            );
            panels.push(self.panel(Panel::Committed, 1.5, header, note));
        }
        if let Some(section) = self.sections.iter().find(|s| s.panel == Panel::Staged) {
            let count = section.changes.len();
            let action = operation_button(
                "git-commit",
                "plus",
                tr(if self.mutating {
                    "source-control.action.committing"
                } else {
                    "source-control.sync.commit"
                }),
                primary == Some(PrimarySlot::Staged),
                self.busy,
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
            panels.push(self.panel(
                Panel::Staged,
                count as f32,
                header,
                self.file_list(Panel::Staged, count, cx),
            ));
        }
        if let Some(section) = self.sections.iter().find(|s| s.panel == Panel::Unstaged) {
            let count = section.changes.len();
            let conflicts = self.sections.iter().any(|s| s.panel == Panel::Merge);
            let action = operation_button(
                "git-stage-commit",
                "plus",
                tr("source-control.action.stageCommit"),
                primary == Some(PrimarySlot::StageAndCommit),
                self.busy || conflicts,
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
            panels.push(self.panel(
                Panel::Unstaged,
                count as f32,
                header,
                self.file_list(Panel::Unstaged, count, cx),
            ));
        }
        if panels.is_empty() {
            // `showCleanSection`: a "Changes" panel with the empty note.
            let header = self.section_header(Panel::Unstaged, 0, false, None, cx);
            let note = Self::section_note(tr("source-control.status.noLocalChanges"), t);
            panels.push(self.panel(Panel::Unstaged, 1.5, header, note));
        }
        for (index, panel) in panels.into_iter().enumerate() {
            if index > 0 {
                stack = stack.child(Self::section_divider(t));
            }
            stack = stack.child(panel);
        }
        let mut list = v_flex()
            .flex_1()
            .min_h_0()
            .pt(px(metric::SIDEBAR_LIST_PADDING_BLOCK));
        if snapshot.behind > 0 && snapshot.upstream.is_some() {
            list = list.child(self.incoming_notice(
                snapshot.behind,
                primary == Some(PrimarySlot::Sync),
                cx,
            ));
        }
        list = list.child(stack);
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
                    s.operation_error = false;
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
    fn confirm_view(&self, op: &Operation, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let target = self
            .snapshot
            .as_ref()
            .and_then(|s| s.upstream.clone())
            .unwrap_or_else(|| tr("native.git.upstream").to_owned());
        let (label, action, tone) = match op {
            Operation::Discard(c) => (
                tf(
                    "source-control.dialog.discard.path",
                    &[("path", c.path.clone().into())],
                ),
                tr("source-control.action.discard").to_owned(),
                ButtonVariant::OutlineDanger,
            ),
            Operation::Push => (
                tf("native.git.pushConfirm", &[("target", target.into())]),
                tr("source-control.sync.push").to_owned(),
                ButtonVariant::OutlinePrimary,
            ),
            Operation::Pull => (
                tf("native.git.pullConfirm", &[("target", target.into())]),
                tr("source-control.sync.pull").to_owned(),
                ButtonVariant::OutlinePrimary,
            ),
            _ => (
                tr("source-control.sync.continueTitle").to_owned(),
                tr("source-control.sync.continue").to_owned(),
                ButtonVariant::OutlinePrimary,
            ),
        };
        v_flex()
            .mx(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .mt(px(metric::SIDEBAR_LIST_PADDING_BLOCK))
            .p(px(12.))
            .gap(px(12.))
            .rounded(px(8.))
            .border_1()
            .border_color(t.border_subtle)
            .bg(theme::alpha(t.control, 0.36))
            .text_size(px(theme::ty().left.content))
            .text_color(t.muted)
            .child(label)
            .child(
                h_flex()
                    .gap(px(8.))
                    .justify_end()
                    .child(
                        Button::new("git-cancel")
                            .label(tr("common.action.cancel"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.confirm = None;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("git-confirm")
                            .variant(tone)
                            .label(action)
                            .on_click(cx.listener(|s, _, _, cx| {
                                if let Some(op) = s.confirm.take() {
                                    s.operation(op, cx);
                                }
                            })),
                    ),
            )
    }
    /// `WorkingFileActions`: open the file, stage or unstage it, discard it.
    fn working_actions(&self, selection: &Selection, cx: &mut Context<Self>) -> Div {
        let change = selection.change.clone();
        let can_open = selection.status() != 'D';
        let open_path = change.path.clone();
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
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.confirm = Some(Operation::Discard(change.clone()));
                            cx.notify();
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
            DetailKind::Working(selection) if selection.status() != 'D' => {
                let host = cx.weak_entity();
                Some(
                    std::rc::Rc::new(move |path: &str, _: &mut Window, cx: &mut App| {
                        let path = path.to_owned();
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
        if matches!(&detail.files, Some(Ok(files)) if !files.is_empty()) {
            let host = cx.weak_entity();
            return list(detail.list.clone(), move |i, _, cx| {
                host.update(cx, |s, cx| s.detail_row(i, cx))
                    .unwrap_or_else(|_| div().into_any_element())
            })
            .flex_1()
            .min_h_0()
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
            .into_any_element()
    }
}
impl Render for SourceControl {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
                .on_click(cx.listener(|s, _, _, cx| {
                    s.detail = None;
                    s.selection += 1;
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
                .on_click(cx.listener(|s, _, _, cx| {
                    if s.detail.take().is_none() {
                        s.history_open = false;
                    }
                    s.selection += 1;
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
        let pane = pane.child(header);
        if let Some(op) = self.confirm.clone() {
            return pane.child(self.confirm_view(&op, cx));
        }
        if self.detail.is_some() {
            return pane.child(self.detail_view(cx));
        }
        if self.history_open {
            return pane.child(self.history_view(cx));
        }
        if let Some(snapshot) = self.snapshot.clone() {
            return pane.child(self.changes_list(&snapshot, cx));
        }
        let not_repo = self.root.is_some()
            && !self.busy
            && self
                .error
                .as_deref()
                .is_some_and(|e| e.contains("not a git repository"));
        if not_repo {
            // `GitRepositorySetupAction`.
            return pane.child(
                Self::centered_note(tr("source-control.history.inactive"), t).child(
                    operation_button(
                        "git-init",
                        "plus",
                        tr("source-control.setup.enable"),
                        true,
                        false,
                    )
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
            let _ = w.draw(cx);
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
}
