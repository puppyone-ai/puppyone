//! Right-sidebar Changes surface: port of `GitChangesSidebar.tsx`,
//! `SourceControlSidebar.tsx` and `sidebar/*` (`GitLocalStatusPanels`,
//! `SourceControlSectionHeader`, `SourceControlWorkingTreeRow`,
//! `GitOperationButton`, `GitIncomingUpdateNotice`) with
//! `source-control/styles/*`. Git runs through `platform/git.rs` on a worker.
use crate::{
    localization::{t as tr, tf},
    platform::git::{self, Change, Commit, Operation, Snapshot},
    theme::{self, Theme, metric},
    ui::{Tone, action_button, column, icon_stroke, row, tooltip},
    wake::Wake,
};
use gpui::{prelude::*, *};
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
    History(Result<Vec<Commit>, String>, u64),
    Diff(Result<String, String>, u64),
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
    pub dark: bool,
    busy: bool,
    mutating: bool,
    queued_operation: Option<Operation>,
    dirty: bool,
    last_refresh: Instant,
    history_open: bool,
    history_ticket: u64,
    history_cancel: Arc<AtomicBool>,
    detail_cancel: Arc<AtomicBool>,
    commits: Vec<Commit>,
    sections: Vec<Section>,
    /// Collapsed disclosure panels (`useGitSidebarExpansionState`).
    collapsed: std::collections::HashSet<Panel>,
    selection: u64,
    detail: Option<(String, Vec<String>)>,
    confirm: Option<Operation>,
    layout: crate::features::settings::preference_types::GitSidebarLayout,
    icon_theme: String,
    #[cfg(test)]
    painted_rows: usize,
}
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
            dark: true,
            busy: false,
            mutating: false,
            queued_operation: None,
            dirty: false,
            last_refresh: Instant::now(),
            history_open: false,
            history_ticket: 0,
            history_cancel: Arc::new(AtomicBool::new(false)),
            detail_cancel: Arc::new(AtomicBool::new(false)),
            commits: vec![],
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
        self.commits.clear();
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
                            Ok(c) => self.commits = c,
                            Err(e) => self.error = Some(e),
                        }
                    }
                }
                ResultValue::Diff(result, selection) => {
                    if selection == self.selection {
                        match result {
                            Ok(text) => {
                                if let Some((_, lines)) = &mut self.detail {
                                    *lines = text.lines().take(20_000).map(str::to_owned).collect();
                                    if lines.is_empty() {
                                        lines.push(tr("native.git.noDifferences").into());
                                    }
                                }
                            }
                            Err(e) => self.error = Some(e),
                        }
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
            ResultValue::History(git::history(&root, cancel), ticket)
        });
    }
    fn select(&mut self, change: Change, staged: bool, cx: &mut Context<Self>) {
        self.selection += 1;
        let selection = self.selection;
        self.detail = Some((
            format!(
                "{} · {}",
                change.path,
                tr(if staged {
                    "source-control.label.staged"
                } else {
                    "source-control.label.changes"
                })
            ),
            vec![tr("source-control.status.loadingDiff").to_string()],
        ));
        self.detail_cancel.store(true, Ordering::Relaxed);
        self.detail_cancel = Arc::new(AtomicBool::new(false));
        self.task_with(self.detail_cancel.clone(), move |root, cancel| {
            ResultValue::Diff(git::diff(&root, &change, staged, cancel), selection)
        });
        cx.notify();
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
    t: Theme,
) -> gpui_kit::base::Button {
    let group = SharedString::from(format!("git-view-{id}"));
    gpui_kit::base::Button::new(id)
        .group(group.clone())
        .flex()
        .flex_shrink_0()
        .items_center()
        .justify_center()
        .size(px(24.))
        .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
        .cursor(theme::clickable_cursor())
        .hover(move |s| s.bg(t.hover))
        .child(
            icon_stroke(icon, size, 1.8, t.subtle)
                .group_hover(group, move |s| s.text_color(t.text)),
        )
}
/// `.desktop-git-view-header`: `min-height: 36px; padding: 4px 10px 2px 14px`.
fn view_header(t: Theme) -> Div {
    row()
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
/// `GitOperationButton`: 24px, 7px inline padding, primary in the accent.
fn operation_button(
    id: impl Into<ElementId>,
    icon: &'static str,
    label: impl Into<SharedString>,
    primary: bool,
    disabled: bool,
    t: Theme,
) -> gpui_kit::base::Button {
    let m = theme::ty();
    // `.app-shell:not(.dark) .desktop-git-sidebar` uses the product blue.
    let accent = if t.dark { t.accent } else { t.brand_blue };
    let (bg, fg, hover_bg, hover_fg) = if primary {
        (
            accent,
            t.text_inverse,
            theme::mix(accent, t.text, 0.86),
            t.text_inverse,
        )
    } else {
        (t.control, t.muted, t.control_hover, t.text)
    };
    let (bg, fg) = match (disabled, primary) {
        (true, true) => (theme::mix(accent, t.control, 0.12), t.text_disabled),
        (true, false) => (theme::alpha(t.control, 0.), t.text_disabled),
        _ => (bg, fg),
    };
    gpui_kit::base::Button::new(id)
        .flex()
        .flex_shrink_0()
        .items_center()
        .justify_center()
        .gap(px(if primary { 5. } else { 4. }))
        .h(px(24.))
        .px(px(7.))
        .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
        .bg(bg)
        .text_color(fg)
        .text_size(px(m.right.content))
        .line_height(px(m.right.control_line_height))
        .when(!disabled, |b| {
            b.cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
        })
        .child(icon_stroke(icon, 15., 2.25, fg))
        .child(div().min_w_0().truncate().child(label.into()))
}
/// `.po-sidebar-icon-button` on a working-tree row (24px, 13px glyph).
fn row_icon_button(
    id: impl Into<ElementId>,
    icon: &'static str,
    label: SharedString,
    danger: bool,
    row_group: SharedString,
    t: Theme,
) -> gpui_kit::base::Button {
    let fg = if danger { t.danger } else { t.muted };
    let (hover_bg, hover_fg) = if danger {
        (theme::alpha(t.danger, 0.12), t.danger)
    } else {
        (t.control_hover, t.text)
    };
    gpui_kit::base::Button::new(id)
        .flex()
        .flex_shrink_0()
        .items_center()
        .justify_center()
        .size(px(24.))
        .rounded(px(metric::SIDEBAR_ROW_RADIUS))
        .cursor(theme::clickable_cursor())
        .text_color(fg)
        .invisible()
        .group_hover(row_group, |s| s.visible())
        .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
        .accessibility_label(label.clone())
        .tooltip(tooltip(label))
        .child(icon_stroke(icon, 13., 2., fg))
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
        let t = Theme::new(self.dark);
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
        let name = std::path::Path::new(&change.path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| change.path.clone());
        let group = SharedString::from(format!("git-row-{panel:?}-{index}"));
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
        let entry = row()
            .id(SharedString::from(format!(
                "git-row-{panel:?}-{}",
                change.path
            )))
            .group(group.clone())
            .w_full()
            .h(px(theme::control()))
            .my(px(1.))
            .gap(px(2.))
            .rounded(px(metric::SIDEBAR_ROW_RADIUS))
            .text_color(t.muted)
            .cursor(theme::clickable_cursor())
            .hover(move |d| d.bg(t.hover).text_color(t.text))
            .child(
                row()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .pl(px(metric::SIDEBAR_ROW_CONTENT_LEFT))
                    .gap(px(metric::SIDEBAR_ICON_LABEL_GAP))
                    .text_size(px(m.left.content))
                    .line_height(px(m.left.line_height))
                    .child(
                        img(SharedString::from(crate::file_kind::asset_path(
                            &self.icon_theme,
                            &change.path,
                            false,
                            self.dark,
                        )))
                        .size(px(18.))
                        .flex_shrink_0(),
                    )
                    .child(
                        row()
                            .min_w_0()
                            .items_baseline()
                            .gap(px(5.))
                            .child(div().min_w_0().truncate().child(name))
                            .child(
                                div()
                                    .flex_shrink_0()
                                    .text_size(px(m.ui.micro))
                                    .line_height(px(m.ui.micro))
                                    .text_color(t.text_disabled)
                                    .child(status.to_string()),
                            ),
                    ),
            )
            .when(!staged && !change.untracked() && !change.conflict(), |d| {
                d.child(
                    row_icon_button(
                        ("discard", index),
                        "undo-2",
                        discard_label.into(),
                        true,
                        group.clone(),
                        t,
                    )
                    .on_click(cx.listener(move |s, _, _, cx| {
                        cx.stop_propagation();
                        s.confirm = Some(Operation::Discard(discard.clone()));
                        cx.notify();
                    })),
                )
            })
            .child(
                row_icon_button(
                    ("stage", index),
                    if staged { "minus" } else { "plus" },
                    state_label.into(),
                    false,
                    group,
                    t,
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
    ) -> Div {
        let t = Theme::new(self.dark);
        let m = theme::ty();
        let expanded = !self.collapsed.contains(&panel);
        row()
            .flex_shrink_0()
            .w_full()
            .h(px(theme::control()))
            .pr(px(metric::SIDEBAR_ROW_RIGHT_GAP))
            .child(
                row()
                    .id(SharedString::from(format!("git-section-{panel:?}")))
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .ml(px(metric::SIDEBAR_ROW_LEFT_GAP))
                    .px(px(metric::SIDEBAR_ROW_CONTENT_LEFT))
                    .gap(px(6.))
                    .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                    .text_size(px(m.left.content))
                    .line_height(px(m.left.line_height))
                    .text_color(t.subtle)
                    .cursor(theme::clickable_cursor())
                    .child(icon_stroke(
                        if expanded {
                            "chevron-down"
                        } else {
                            "chevron-right"
                        },
                        14.,
                        2.,
                        t.text_disabled,
                    ))
                    .child(div().flex_shrink_0().child(tr(
                        if panel == Panel::Unstaged && count == 0 {
                            "source-control.label.changes"
                        } else {
                            panel.title()
                        },
                    )))
                    .when(show_count, |d| {
                        d.child(
                            div()
                                .text_size(px(m.left.meta))
                                .text_color(t.text_disabled)
                                .child(count.to_string()),
                        )
                    })
                    .on_click(cx.listener(move |s, _, _, cx| {
                        if !s.collapsed.remove(&panel) {
                            s.collapsed.insert(panel);
                        }
                        cx.notify();
                    })),
            )
            .children(action)
    }
    /// A `desktop-git-resizable-section`: grows by its weight up to its rows
    /// (at most nine), never below 72px, or a single header row collapsed.
    fn panel(&self, panel: Panel, rows: f32, header: Div, body: AnyElement) -> Div {
        let row_h = theme::control();
        if self.collapsed.contains(&panel) {
            return column()
                .flex_none()
                .h(px(row_h))
                .overflow_hidden()
                .child(header);
        }
        let visible = rows.min(MAX_VISIBLE_ROWS as f32);
        let max_h = row_h * (visible + 1.) + SECTION_BODY_TOP_GAP + visible * 2.;
        column()
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
        let t = Theme::new(self.dark);
        let m = theme::ty();
        div()
            .flex_shrink_0()
            .pb(px(13.))
            .mb(px(5.))
            .relative()
            .child(
                row()
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
                            t,
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
        let t = Theme::new(self.dark);
        let primary = primary_slot(snapshot, &self.sections);
        let mut stack = column().flex_1().min_h_0().overflow_hidden();
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
                t,
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
                t,
            )
            .tooltip(tooltip(tr("source-control.sync.commitStaged")))
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
                t,
            )
            .tooltip(tooltip(tr("source-control.action.stageCommitTitle")))
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
        let mut list = column()
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
        let t = Theme::new(self.dark);
        row()
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
                view_action("git-dismiss-error", "x", 13., t)
                    .accessibility_label(tr("source-control.action.dismiss"))
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
        column()
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
        let t = Theme::new(self.dark);
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
                Tone::Danger,
            ),
            Operation::Push => (
                tf("native.git.pushConfirm", &[("target", target.into())]),
                tr("source-control.sync.push").to_owned(),
                Tone::Primary,
            ),
            Operation::Pull => (
                tf("native.git.pullConfirm", &[("target", target.into())]),
                tr("source-control.sync.pull").to_owned(),
                Tone::Primary,
            ),
            _ => (
                tr("source-control.sync.continueTitle").to_owned(),
                tr("source-control.sync.continue").to_owned(),
                Tone::Primary,
            ),
        };
        column()
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
                row()
                    .gap(px(8.))
                    .justify_end()
                    .child(
                        action_button(
                            "git-cancel",
                            tr("common.action.cancel"),
                            None,
                            Tone::Default,
                            false,
                            t,
                        )
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.confirm = None;
                            cx.notify();
                        })),
                    )
                    .child(
                        action_button("git-confirm", action, None, tone, false, t).on_click(
                            cx.listener(|s, _, _, cx| {
                                if let Some(op) = s.confirm.take() {
                                    s.operation(op, cx);
                                }
                            }),
                        ),
                    ),
            )
    }
    fn diff_view(&self, title: String, count: usize, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        column()
            .flex_1()
            .min_h_0()
            .child(
                div()
                    .flex_shrink_0()
                    .px(px(14.))
                    .py(px(8.))
                    .truncate()
                    .text_size(px(theme::ty().left.content))
                    .text_color(t.text)
                    .child(title),
            )
            .child(
                uniform_list(
                    "git-diff",
                    count,
                    cx.processor(|s, range: std::ops::Range<usize>, _, _| {
                        let t = Theme::new(s.dark);
                        range
                            .map(|i| {
                                let line = &s.detail.as_ref().unwrap().1[i];
                                let added = line.starts_with('+') && !line.starts_with("+++");
                                let removed = line.starts_with('-') && !line.starts_with("---");
                                let hunk = line.starts_with("@@");
                                div()
                                    .h(px(20.))
                                    .px(px(14.))
                                    .font_family(theme::MONO)
                                    .text_size(px(theme::ty().ui.caption))
                                    .whitespace_nowrap()
                                    .when(added, |d| d.bg(t.diff_added_bg))
                                    .when(removed, |d| d.bg(t.diff_removed_bg))
                                    .text_color(if added {
                                        t.diff_added_text
                                    } else if removed {
                                        t.diff_removed_text
                                    } else if hunk {
                                        t.subtle
                                    } else {
                                        t.muted
                                    })
                                    .child(line.clone())
                            })
                            .collect::<Vec<_>>()
                    }),
                )
                .flex_1()
                .min_h_0(),
            )
    }
    fn history_view(&self, cx: &mut Context<Self>) -> AnyElement {
        uniform_list(
            "git-log",
            self.commits.len(),
            cx.processor(|s, range: std::ops::Range<usize>, _, cx| {
                let t = Theme::new(s.dark);
                let m = theme::ty();
                range
                    .map(|i| {
                        let c = s.commits[i].clone();
                        column()
                            .id(i)
                            .h(px(52.))
                            .mx(px(metric::SIDEBAR_ROW_LEFT_GAP))
                            .px(px(metric::SIDEBAR_ROW_CONTENT_LEFT))
                            .py(px(7.))
                            .gap(px(2.))
                            .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                            .cursor(theme::clickable_cursor())
                            .text_color(t.muted)
                            .hover(move |d| d.bg(t.hover).text_color(t.text))
                            .child(div().truncate().text_size(px(m.left.content)).child(
                                if c.title.is_empty() {
                                    tr("source-control.commit.noMessage").to_string()
                                } else {
                                    c.title.clone()
                                },
                            ))
                            .child(
                                div()
                                    .text_size(px(m.left.meta))
                                    .text_color(t.subtle)
                                    .truncate()
                                    .child(format!("{} · {} · {}", &c.id[..7], c.author, c.date)),
                            )
                            .on_click(cx.listener(move |s, _, _, cx| {
                                s.selection += 1;
                                let selection = s.selection;
                                s.detail = Some((
                                    c.title.clone(),
                                    vec![tr("source-control.status.readingHistory").to_string()],
                                ));
                                let id = c.id.clone();
                                s.task(move |root, cancel| {
                                    ResultValue::Diff(
                                        git::commit_diff(&root, &id, cancel),
                                        selection,
                                    )
                                });
                                cx.notify();
                            }))
                    })
                    .collect::<Vec<_>>()
            }),
        )
        .flex_1()
        .min_h_0()
        .pt(px(metric::SIDEBAR_LIST_PADDING_BLOCK))
        .into_any_element()
    }
}
impl Render for SourceControl {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(test)]
        {
            self.painted_rows = 0;
        }
        let t = Theme::new(self.dark);
        // `.desktop-git-changes-sidebar` on `--po-surface-auxiliary`.
        let pane = column()
            .size_full()
            .min_h_0()
            .bg(t.auxiliary())
            .text_color(t.text);
        let nested = self.detail.is_some() || self.history_open;
        let mut header = view_header(t);
        if nested {
            // `.desktop-git-changes-detail-header` / `.desktop-git-history-header`.
            header = header.pl(px(8.)).justify_start().child(
                view_action("git-back", "arrow-left", 15., t)
                    .accessibility_label(tr("shared-ui.navigation.back"))
                    .tooltip(tooltip(tr("shared-ui.navigation.back")))
                    .on_click(cx.listener(|s, _, _, cx| {
                        if s.detail.take().is_none() {
                            s.history_open = false;
                        }
                        s.selection += 1;
                        cx.notify();
                    })),
            );
        }
        header = header.child(view_title(
            tr(if self.history_open && self.detail.is_none() {
                "source-control.history.title"
            } else {
                "source-control.label.changes"
            }),
            t,
        ));
        if !nested {
            header = header.child(
                view_action("git-history", "history", 14., t)
                    .accessibility_label(tr("source-control.history.title"))
                    .tooltip(tooltip(tr("source-control.history.title")))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.detail = None;
                        s.history_open = true;
                        s.load_history();
                        cx.notify();
                    })),
            );
        }
        let pane = pane.child(header);
        if let Some(op) = self.confirm.clone() {
            return pane.child(self.confirm_view(&op, cx));
        }
        if let Some((title, lines)) = &self.detail {
            let (title, count) = (title.clone(), lines.len());
            return pane.child(self.diff_view(title, count, cx));
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
                        t,
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
            s.detail = Some(("current".into(), vec!["current diff".into()]));
            s.tx.send((
                2,
                ResultValue::Status(Ok(Snapshot {
                    branch: "old workspace".into(),
                    ..Snapshot::default()
                })),
            ))
            .unwrap();
            s.tx.send((3, ResultValue::Diff(Ok("old diff".into()), 8)))
                .unwrap();
            s.tx.send((
                3,
                ResultValue::History(
                    Ok(vec![Commit {
                        id: "old".into(),
                        title: "stale".into(),
                        author: String::new(),
                        date: String::new(),
                    }]),
                    4,
                ),
            ))
            .unwrap();
            s.poll(w, cx);
            assert!(s.snapshot.is_none());
            assert!(s.commits.is_empty());
            assert_eq!(s.detail.as_ref().unwrap().1, vec!["current diff"]);
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
