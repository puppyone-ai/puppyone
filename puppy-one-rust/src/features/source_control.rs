use crate::{
    localization::{t as tr, tf},
    platform::git::{self, Change, Commit, Operation, Snapshot},
    theme::Theme,
    ui::{Tone, action_button, column, form_input::TextInput, icon_button, row, tooltip},
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
    Status(Result<Snapshot, String>, bool),
    History(Result<Vec<Commit>, String>, u64),
    Diff(Result<String, String>, u64),
}
#[derive(Clone)]
enum GitRow {
    Header(&'static str, usize, usize),
    File(Change, usize),
}
fn project_rows(snapshot: &Snapshot) -> Vec<GitRow> {
    let mut rows = Vec::new();
    for (title, kind) in [
        ("source-control.section.merge", 0),
        ("source-control.section.staged", 1),
        ("source-control.section.unstaged", 2),
    ] {
        let changes = snapshot
            .changes
            .iter()
            .filter(|c| match kind {
                0 => c.conflict(),
                1 => c.staged(),
                // Web folds untracked files into "Unstaged Changes".
                _ => c.unstaged() || c.untracked(),
            })
            .cloned()
            .collect::<Vec<_>>();
        if changes.is_empty() {
            continue;
        }
        rows.push(GitRow::Header(title, changes.len(), kind));
        rows.extend(changes.into_iter().map(|c| GitRow::File(c, kind)));
    }
    rows
}
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
    rows: Vec<GitRow>,
    submitted_message: Option<String>,
    selection: u64,
    detail: Option<(String, Vec<String>)>,
    confirm: Option<Operation>,
    message: Entity<TextInput>,
    layout: crate::features::settings::preference_types::GitSidebarLayout,
    icon_theme: String,
    #[cfg(test)]
    painted_rows: usize,
}
impl SourceControl {
    fn change_row(&self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let t = Theme::new(self.dark);
        let cards =
            self.layout == crate::features::settings::preference_types::GitSidebarLayout::Cards;
        let m = crate::theme::ty();
        match self.rows[index].clone() {
            GitRow::Header(title, count, kind) => {
                let (label, op) = if kind == 1 {
                    (
                        tr("source-control.action.unstageAll"),
                        Operation::UnstageAll,
                    )
                } else {
                    (tr("source-control.action.stageAll"), Operation::StageAll)
                };
                row()
                    .w_full()
                    .h(px(30.))
                    .mt(px(if index == 0 { 4. } else { 10. }))
                    .px(px(12.))
                    .gap(px(6.))
                    .text_size(px(m.left.meta))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.subtle)
                    .when(!cards, |d| d.border_b_1().border_color(t.sidebar_divider))
                    .when(cards && index > 0, |d| {
                        d.border_t_1().border_color(t.sidebar_divider)
                    })
                    .child(tr(title))
                    .child(
                        div()
                            .px(px(6.))
                            .rounded_full()
                            .bg(t.control)
                            .text_size(px(m.ui.caption))
                            .child(count.to_string()),
                    )
                    .child(div().flex_1())
                    .when(kind != 0, |d| {
                        d.child(
                            crate::ui::icon_button(
                                ("all", kind),
                                if kind == 1 { "minus" } else { "plus" },
                                t,
                            )
                            .size(px(24.))
                            .accessibility_label(label)
                            .tooltip(crate::ui::tooltip(label))
                            .on_click(cx.listener(move |s, _, _, cx| s.operation(op.clone(), cx))),
                        )
                    })
                    .into_any_element()
            }
            GitRow::File(change, kind) => {
                let selected = change.clone();
                let stage = change.clone();
                let discard = change.clone();
                let status = if kind == 1 {
                    change.index
                } else {
                    change.worktree
                };
                let status = if status == '?' { 'U' } else { status };
                let color = match status {
                    'A' | 'U' | '?' => t.success,
                    'D' => t.danger,
                    'R' | 'C' => t.accent,
                    _ if kind == 0 => t.danger,
                    _ => t.warning,
                };
                let name = std::path::Path::new(&change.path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| change.path.clone());
                let parent = std::path::Path::new(&change.path)
                    .parent()
                    .map(|p| p.display().to_string())
                    .unwrap_or_default();
                let group = SharedString::from(format!("git-row-{index}"));
                let stage_label = tf(
                    if kind == 1 {
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
                    .id(index)
                    .group(group.clone())
                    .flex_1()
                    .min_w_0()
                    .h(px(crate::theme::control()))
                    .px(px(6.))
                    .gap(px(6.))
                    .rounded(px(crate::theme::metric::SIDEBAR_ROW_RADIUS))
                    .hover(move |d| d.bg(crate::theme::alpha(t.hover, 0.86)))
                    .cursor(crate::theme::clickable_cursor())
                    .text_size(px(m.left.content))
                    .text_color(t.sidebar_text)
                    .child(
                        img(SharedString::from(crate::file_kind::asset_path(
                            &self.icon_theme,
                            &change.path,
                            false,
                            self.dark,
                        )))
                        .size(px(16.))
                        .flex_shrink_0(),
                    )
                    .child(
                        row()
                            .flex_1()
                            .min_w_0()
                            .gap(px(6.))
                            .child(
                                div()
                                    .flex_shrink_0()
                                    .max_w(relative(0.7))
                                    .truncate()
                                    .child(name),
                            )
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .text_size(px(m.left.meta))
                                    .text_color(t.subtle)
                                    .child(parent),
                            ),
                    )
                    .child(
                        row()
                            .gap(px(2.))
                            .invisible()
                            .group_hover(group.clone(), |s| s.visible())
                            .when(kind == 2, |d| {
                                d.child(
                                    crate::ui::icon_button(("discard", index), "undo-2", t)
                                        .size(px(22.))
                                        .accessibility_label(discard_label.clone())
                                        .tooltip(crate::ui::tooltip(discard_label))
                                        .on_click(cx.listener(move |s, _, _, cx| {
                                            cx.stop_propagation();
                                            s.confirm = Some(Operation::Discard(discard.clone()));
                                            cx.notify();
                                        })),
                                )
                            })
                            .child(
                                crate::ui::icon_button(
                                    ("stage", index),
                                    if kind == 1 { "minus" } else { "plus" },
                                    t,
                                )
                                .size(px(22.))
                                .accessibility_label(stage_label.clone())
                                .tooltip(crate::ui::tooltip(stage_label))
                                .on_click(cx.listener(
                                    move |s, _, _, cx| {
                                        cx.stop_propagation();
                                        s.operation(
                                            if kind == 1 {
                                                Operation::Unstage(stage.clone())
                                            } else {
                                                Operation::Stage(stage.clone())
                                            },
                                            cx,
                                        )
                                    },
                                )),
                            ),
                    )
                    .child(
                        div()
                            .w(px(12.))
                            .flex_shrink_0()
                            .text_size(px(m.left.meta))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(color)
                            .child(status.to_string()),
                    )
                    .on_click(
                        cx.listener(move |s, _, _, cx| s.select(selected.clone(), kind == 1, cx)),
                    );
                row().w_full().px(px(6.)).child(entry).into_any_element()
            }
        }
    }
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
            rows: vec![],
            submitted_message: None,
            selection: 0,
            detail: None,
            confirm: None,
            message: cx.new(|cx| {
                TextInput::new(tr("native.git.commitPlaceholder"), true, 10_000, window, cx)
            }),
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
        self.rows.clear();
        self.submitted_message = None;
        self.message.update(cx, |i, cx| i.clear(cx));
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
        self.task(|root, cancel| ResultValue::Status(git::status(&root, cancel), false));
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
        self.submitted_message = if let Operation::Commit(message) = &op {
            Some(message.clone())
        } else {
            None
        };
        self.error = None;
        self.operation_error = false;
        self.detail = None;
        self.selection += 1;
        self.task(move |root, cancel| {
            ResultValue::Status(
                git::operate(&root, &op, cancel),
                matches!(op, Operation::Commit(_)),
            )
        });
        cx.notify();
    }
    fn poll(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        while let Ok((epoch, result)) = self.rx.try_recv() {
            if epoch != self.epoch {
                continue;
            }
            match result {
                ResultValue::Status(result, committed) => {
                    self.busy = false;
                    let was_mutation = self.mutating;
                    self.mutating = false;
                    match result {
                        Ok(snapshot) => {
                            let changed = self.snapshot.as_ref() != Some(&snapshot);
                            if changed {
                                self.rows = project_rows(&snapshot);
                            }
                            self.snapshot = Some(snapshot);
                            if !self.operation_error {
                                self.error = None;
                            }
                            if committed
                                && self.submitted_message.as_deref()
                                    == Some(self.message.read(cx).text())
                            {
                                self.message.update(cx, |i, cx| i.clear(cx));
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
    pub fn badge(&self) -> String {
        self.snapshot
            .as_ref()
            .map(|s| {
                let conflicts = s.changes.iter().filter(|c| c.conflict()).count();
                format!(
                    "{}{}{}{}",
                    if conflicts > 0 {
                        format!("!{conflicts} ")
                    } else {
                        String::new()
                    },
                    if s.changes.is_empty() {
                        String::new()
                    } else {
                        s.changes.len().to_string()
                    },
                    if s.behind > 0 {
                        format!(" ↓{}", s.behind)
                    } else {
                        String::new()
                    },
                    if s.ahead > 0 {
                        format!(" ↑{}", s.ahead)
                    } else {
                        String::new()
                    }
                )
            })
            .unwrap_or_default()
    }
}
impl Drop for SourceControl {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
        self.history_cancel.store(true, Ordering::Relaxed);
        self.detail_cancel.store(true, Ordering::Relaxed);
    }
}
impl Render for SourceControl {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(test)]
        {
            self.painted_rows = 0;
        }
        let t = Theme::new(self.dark);
        self.message.update(cx, |i, _| i.dark = self.dark);
        let mut pane = column()
            .size_full()
            .min_h_0()
            .bg(t.canvas)
            .text_color(t.text)
            .text_size(px(crate::theme::ty().left.content));
        let nested = self.detail.is_some() || self.history_open;
        let m = crate::theme::ty();
        pane = pane.child(
            row()
                .h(px(36.))
                .flex_shrink_0()
                .px(px(8.))
                .gap(px(2.))
                .border_b_1()
                .border_color(t.sidebar_divider)
                .when(nested, |d| {
                    d.child(
                        icon_button("git-back", "chevron-left", t)
                            .accessibility_label(tr("source-control.label.changes"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.detail = None;
                                s.history_open = false;
                                s.selection += 1;
                                cx.notify();
                            })),
                    )
                })
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .px(px(4.))
                        .truncate()
                        .text_size(px(m.ui.label))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(t.text)
                        .child(tr(if self.history_open && self.detail.is_none() {
                            "source-control.history.title"
                        } else {
                            "source-control.label.changes"
                        })),
                )
                .child(
                    icon_button("git-history", "history", t)
                        .accessibility_label(tr("source-control.history.title"))
                        .tooltip(tooltip(tr("source-control.history.title")))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.detail = None;
                            s.history_open = true;
                            s.load_history();
                            cx.notify();
                        })),
                )
                .child(
                    icon_button("git-refresh", "refresh-cw", t)
                        .accessibility_label(tr("source-control.action.refreshGit"))
                        .tooltip(tooltip(tr("source-control.action.refreshGit")))
                        .when(self.busy, |b| b.opacity(0.5))
                        .on_click(cx.listener(|s, _, _, cx| s.refresh(cx))),
                ),
        );
        if let Some(error) = &self.error {
            pane = pane.child(
                row()
                    .px(px(12.))
                    .py(px(8.))
                    .gap(px(6.))
                    .mx(px(8.))
                    .mt(px(8.))
                    .rounded(px(crate::theme::metric::CONTROL_RADIUS))
                    .bg(crate::theme::alpha(t.danger, 0.08))
                    .text_size(px(m.left.meta))
                    .text_color(t.danger)
                    .child(div().flex_1().child(error.clone()))
                    .child(
                        icon_button("git-dismiss-error", "x", t)
                            .accessibility_label(tr("source-control.action.dismiss"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.error = None;
                                s.operation_error = false;
                                cx.notify();
                            })),
                    ),
            );
        }
        if let Some(op) = &self.confirm {
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
                    tf(
                        "native.git.pushConfirm",
                        &[("target", target.clone().into())],
                    ),
                    tr("source-control.sync.push").to_owned(),
                    Tone::Primary,
                ),
                Operation::Pull => (
                    tf(
                        "native.git.pullConfirm",
                        &[("target", target.clone().into())],
                    ),
                    tr("source-control.sync.pull").to_owned(),
                    Tone::Primary,
                ),
                _ => (
                    tr("source-control.sync.continueTitle").to_owned(),
                    tr("source-control.sync.continue").to_owned(),
                    Tone::Primary,
                ),
            };
            return pane.child(
                column()
                    .m(px(8.))
                    .p(px(12.))
                    .gap(px(12.))
                    .rounded(px(crate::theme::metric::CONTROL_RADIUS))
                    .border_1()
                    .border_color(t.divider)
                    .bg(t.panel)
                    .text_size(px(m.left.content))
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
                                .on_click(cx.listener(
                                    |s, _, _, cx| {
                                        s.confirm = None;
                                        cx.notify();
                                    },
                                )),
                            )
                            .child(
                                action_button("git-confirm", action, None, tone, false, t)
                                    .on_click(cx.listener(|s, _, _, cx| {
                                        if let Some(op) = s.confirm.take() {
                                            s.operation(op, cx);
                                        }
                                    })),
                            ),
                    ),
            );
        }
        if let Some((title, lines)) = &self.detail {
            let title = title.clone();
            let count = lines.len();
            return pane
                .child(
                    div()
                        .px(px(12.))
                        .py(px(8.))
                        .truncate()
                        .text_size(px(m.left.content))
                        .font_weight(FontWeight::MEDIUM)
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
                                        .px(px(12.))
                                        .font_family("Menlo")
                                        .text_size(px(crate::theme::ty().editor.code))
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
                                            t.text
                                        })
                                        .child(line.clone())
                                })
                                .collect::<Vec<_>>()
                        }),
                    )
                    .flex_1()
                    .min_h_0(),
                );
        }
        if self.history_open {
            return pane.child(
                uniform_list(
                    "git-log",
                    self.commits.len(),
                    cx.processor(|s, range: std::ops::Range<usize>, _, cx| {
                        let t = Theme::new(s.dark);
                        range
                            .map(|i| {
                                let c = s.commits[i].clone();
                                column()
                                    .id(i)
                                    .h(px(52.))
                                    .mx(px(6.))
                                    .px(px(8.))
                                    .py(px(7.))
                                    .gap(px(2.))
                                    .rounded(px(crate::theme::metric::SIDEBAR_ROW_RADIUS))
                                    .cursor(crate::theme::clickable_cursor())
                                    .hover(move |d| d.bg(t.hover))
                                    .child(div().truncate().text_color(t.sidebar_text).child(
                                        if c.title.is_empty() {
                                            tr("source-control.commit.noMessage").to_string()
                                        } else {
                                            c.title.clone()
                                        },
                                    ))
                                    .child(
                                        div()
                                            .text_size(px(crate::theme::ty().left.meta))
                                            .text_color(t.subtle)
                                            .truncate()
                                            .child(format!(
                                                "{} · {} · {}",
                                                &c.id[..7],
                                                c.author,
                                                c.date
                                            )),
                                    )
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        s.selection += 1;
                                        let selection = s.selection;
                                        s.detail = Some((
                                            c.title.clone(),
                                            vec![
                                                tr("source-control.status.readingHistory")
                                                    .to_string(),
                                            ],
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
                .min_h_0(),
            );
        }
        if let Some(snapshot) = &self.snapshot {
            let branch = if snapshot.branch.is_empty() {
                SharedString::from(tr("source-control.sync.noBranch"))
            } else {
                SharedString::from(snapshot.branch.clone())
            };
            let tracking = match &snapshot.upstream {
                Some(target) => tf(
                    "source-control.sync.tracking",
                    &[("target", target.clone().into())],
                ),
                None => tr("source-control.sync.noTrackingBranch").to_owned(),
            };
            let sync_label = |key: &str, count: u32| -> SharedString {
                if count > 0 {
                    format!("{} {count}", tr(key)).into()
                } else {
                    tr(key).into()
                }
            };
            pane = pane.child(
                column()
                    .flex_shrink_0()
                    .px(px(12.))
                    .py(px(8.))
                    .gap(px(6.))
                    .border_b_1()
                    .border_color(t.sidebar_divider)
                    .child(
                        row()
                            .gap(px(6.))
                            .child(crate::ui::icon_sized("git-branch", 14., t.utility))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(branch),
                            )
                            .when(!snapshot.changes.is_empty(), |d| {
                                d.child(
                                    div()
                                        .px(px(6.))
                                        .rounded_full()
                                        .bg(t.control)
                                        .text_size(px(m.ui.caption))
                                        .text_color(t.muted)
                                        .child(self.badge()),
                                )
                            }),
                    )
                    .child(
                        div()
                            .text_size(px(m.left.meta))
                            .text_color(t.subtle)
                            .truncate()
                            .child(tracking),
                    )
                    .child(
                        row()
                            .gap(px(6.))
                            .child(
                                action_button(
                                    "git-fetch",
                                    tr("native.git.fetch"),
                                    Some("refresh-cw"),
                                    Tone::Default,
                                    self.busy,
                                    t,
                                )
                                .on_click(
                                    cx.listener(|s, _, _, cx| s.operation(Operation::Fetch, cx)),
                                ),
                            )
                            .child(
                                action_button(
                                    "git-pull",
                                    sync_label("source-control.sync.pull", snapshot.behind),
                                    Some("arrow-down"),
                                    Tone::Default,
                                    self.busy || snapshot.upstream.is_none(),
                                    t,
                                )
                                .on_click(cx.listener(
                                    |s, _, _, cx| {
                                        s.confirm = Some(Operation::Pull);
                                        cx.notify();
                                    },
                                )),
                            )
                            .child(
                                action_button(
                                    "git-push",
                                    sync_label("source-control.sync.push", snapshot.ahead),
                                    Some("arrow-up"),
                                    Tone::Default,
                                    self.busy || snapshot.upstream.is_none(),
                                    t,
                                )
                                .on_click(cx.listener(
                                    |s, _, _, cx| {
                                        s.confirm = Some(Operation::Push);
                                        cx.notify();
                                    },
                                )),
                            ),
                    ),
            );
            if snapshot.truncated {
                pane = pane.child(
                    div()
                        .px(px(12.))
                        .py(px(6.))
                        .text_size(px(m.left.meta))
                        .text_color(t.warning)
                        .child(tf(
                            "source-control.status.limit",
                            &[("count", 10_000usize.into())],
                        )),
                );
            }
            let list = uniform_list(
                "git-groups",
                self.rows.len(),
                cx.processor(|s, range: std::ops::Range<usize>, _, cx| {
                    #[cfg(test)]
                    {
                        s.painted_rows += range.len();
                    }
                    range
                        .map(|index| s.change_row(index, cx))
                        .collect::<Vec<_>>()
                }),
            )
            .flex_1()
            .min_h_0();
            if self.rows.is_empty() {
                pane = pane.child(
                    column()
                        .items_center()
                        .gap(px(6.))
                        .p(px(20.))
                        .text_size(px(m.left.content))
                        .text_color(t.muted)
                        .child(crate::ui::icon_sized("check", 18., t.subtle))
                        .child(tr("source-control.status.noLocalChanges")),
                );
            }
            let staged = snapshot.changes.iter().any(|c| c.staged());
            let committing = self.mutating;
            pane = pane.child(list).child(
                column()
                    .flex_shrink_0()
                    .p(px(10.))
                    .border_t_1()
                    .border_color(t.sidebar_divider)
                    .gap(px(8.))
                    .child(self.message.clone())
                    .child(
                        action_button(
                            "git-commit",
                            tr(if committing {
                                "source-control.action.committing"
                            } else {
                                "source-control.sync.commit"
                            }),
                            Some("check"),
                            Tone::Primary,
                            committing || !staged,
                            t,
                        )
                        .w_full()
                        .tooltip(tooltip(tr(if staged {
                            "source-control.sync.commitStaged"
                        } else {
                            "source-control.sync.stageBeforeCommit"
                        })))
                        .on_click(cx.listener(|s, _, _, cx| {
                            let message = s.message.read(cx).text().to_owned();
                            s.operation(Operation::Commit(message), cx);
                        })),
                    ),
            );
        } else if self.root.is_some()
            && !self.busy
            && self
                .error
                .as_deref()
                .is_some_and(|e| e.contains("not a git repository"))
        {
            pane = pane.child(
                column()
                    .items_center()
                    .gap(px(10.))
                    .p(px(20.))
                    .text_size(px(m.left.content))
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .child(tr("source-control.empty.notControlled")),
                    )
                    .child(
                        div()
                            .text_size(px(m.left.meta))
                            .text_color(t.muted)
                            .text_center()
                            .child(tr("source-control.empty.initializeDetail")),
                    )
                    .child(
                        action_button(
                            "git-init",
                            tr("source-control.action.initialize"),
                            Some("git-branch"),
                            Tone::Primary,
                            false,
                            t,
                        )
                        .on_click(cx.listener(|s, _, _, cx| s.operation(Operation::Init, cx))),
                    ),
            );
        } else if self.error.is_none() || self.root.is_none() {
            // A failed read already shows its error; "Reading Git…" would
            // claim work that is not happening.
            pane = pane.child(
                div()
                    .p(px(20.))
                    .text_size(px(m.left.content))
                    .text_color(t.muted)
                    .child(if self.root.is_some() {
                        tr("source-control.status.readingGit")
                    } else {
                        tr("source-control.sync.noLocalRepository")
                    }),
            );
        }
        pane
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
                ResultValue::Status(
                    Ok(Snapshot {
                        branch: "old workspace".into(),
                        ..Snapshot::default()
                    }),
                    false,
                ),
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
            s.rows = project_rows(&snapshot);
            s.snapshot = Some(snapshot);
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        view.update(cx, |s, _| {
            assert_eq!(s.rows.len(), 10_001);
            assert!(
                s.painted_rows > 0 && s.painted_rows < 200,
                "painted {} rows",
                s.painted_rows
            );
        });
    }
}
