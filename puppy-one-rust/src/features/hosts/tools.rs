//! What runs on the other computer for its folder (`DeviceFolderWorkbenchSurface`'s
//! tools, `RemoteTerminalPanel`, `RemoteGitPanel`): a terminal, an Agent
//! launcher and its Changes, each shown only when that computer allows it
//! for this folder, and each running there. Keystrokes go to that computer;
//! nothing runs here. Closing a terminal ends its session there. A commit is
//! sent once; when its outcome is unknown the panel says so and reads again.
use crate::features::terminal::TerminalView;
use crate::localization::{t as tr, tf};
use crate::platform::terminal::{Event, Request as TerminalRequest, Terminal};
use crate::theme;
use crate::ui::appearance::ActiveAppearance as _;
use crate::ui::components::{
    Button, ButtonVariant, Segment, SegmentedControl, Select, SelectOption,
};
use crate::ui::form_input::TextInput;
use crate::workspace::hosts::{
    git::GitRequest,
    lines::HostError,
    protocol::Request,
    remote::{Hosts, runtime},
    ssh::Output,
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Tool {
    Terminal,
    Agent,
    Git,
}
impl Tool {
    pub const ALL: [Tool; 3] = [Tool::Terminal, Tool::Agent, Tool::Git];
    /// `hosts.tools.*`.
    pub fn label(self) -> &'static str {
        tr(match self {
            Self::Terminal => "hosts.tools.terminal",
            Self::Agent => "hosts.tools.agent",
            Self::Git => "hosts.tools.git",
        })
    }
    /// What the folder's computer must allow.
    pub fn capability(self) -> &'static str {
        match self {
            Self::Terminal => "folder.shell",
            Self::Agent => "folder.agent",
            Self::Git => "folder.git",
        }
    }
}
/// The Agents an other computer may launch (`AGENT_LAUNCHERS`).
pub const LAUNCHERS: [&str; 6] = ["claude", "codex", "cursor", "opencode", "pi", "hermes"];

/// The folder the tools are for.
#[derive(Clone)]
pub struct Target {
    pub hosts: Arc<Hosts>,
    pub folder: String,
    pub host: String,
    pub capabilities: Vec<String>,
}
impl Target {
    pub fn tools(&self) -> Vec<Tool> {
        Tool::ALL
            .into_iter()
            .filter(|t| self.capabilities.iter().any(|c| c == t.capability()))
            .collect()
    }
}

/// A terminal's life on the other computer.
#[derive(Clone, Debug, PartialEq, Eq)]
enum State {
    Starting,
    Running,
    Ended(Option<u32>),
    Failed(String),
}
struct Session {
    view: Entity<TerminalView>,
    state: Arc<Mutex<State>>,
}

#[derive(Default)]
struct Changes {
    status: Option<Value>,
    error: Option<String>,
    busy: bool,
}

pub struct HostTools {
    target: Option<Target>,
    pub tool: Option<Tool>,
    launcher: &'static str,
    sessions: HashMap<(Tool, &'static str), Session>,
    changes: Changes,
    message: Entity<TextInput>,
}

impl HostTools {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let message = cx.new(|cx| {
            let mut input = TextInput::new(tr("hosts.git.message"), true, 10_000, window, cx);
            input.min_height = 56.;
            input
        });
        cx.observe(&message, |_, _, cx| cx.notify()).detach();
        Self {
            target: None,
            tool: None,
            launcher: "claude",
            sessions: HashMap::new(),
            changes: Changes::default(),
            message,
        }
    }
    /// The folder on screen changed (or left): its sessions there end.
    pub fn set_target(&mut self, target: Option<Target>, cx: &mut Context<Self>) {
        let same = match (&self.target, &target) {
            (Some(a), Some(b)) => a.folder == b.folder && Arc::ptr_eq(&a.hosts, &b.hosts),
            (None, None) => return,
            _ => false,
        };
        if same
            && self.target.as_ref().map(|t| &t.capabilities)
                == target.as_ref().map(|t| &t.capabilities)
        {
            return;
        }
        if !same {
            self.sessions.clear();
            self.changes = Changes::default();
            self.tool = None;
        }
        self.target = target;
        if let Some(tool) = self.tool
            && !self.tools().contains(&tool)
        {
            self.tool = None;
        }
        cx.notify();
    }
    pub fn tools(&self) -> Vec<Tool> {
        self.target.as_ref().map(Target::tools).unwrap_or_default()
    }
    /// Shows `tool` (the Header's entry); `false` when it is not allowed.
    pub fn show(&mut self, tool: Tool, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if !self.tools().contains(&tool) {
            return false;
        }
        self.tool = Some(tool);
        match tool {
            Tool::Git => self.reload(cx),
            Tool::Terminal => self.ensure_session(Tool::Terminal, "shell", window, cx),
            Tool::Agent => self.ensure_session(Tool::Agent, self.launcher, window, cx),
        }
        cx.notify();
        true
    }
    fn ensure_session(
        &mut self,
        tool: Tool,
        launcher: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.sessions.contains_key(&(tool, launcher)) {
            return;
        }
        let Some(target) = self.target.clone() else {
            return;
        };
        let state = Arc::new(Mutex::new(State::Starting));
        let shared = state.clone();
        let view = cx.new(|cx| {
            TerminalView::start(
                move |wake| {
                    let (terminal, bridge) = Terminal::bridged(wake);
                    runtime().spawn(run_terminal(target, launcher, bridge, shared));
                    terminal
                },
                tool == Tool::Agent,
                window,
                cx,
            )
        });
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        self.sessions
            .insert((tool, launcher), Session { view, state });
    }
    fn restart(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(tool) = self.tool else { return };
        let launcher = if tool == Tool::Agent {
            self.launcher
        } else {
            "shell"
        };
        self.sessions.remove(&(tool, launcher));
        self.ensure_session(tool, launcher, window, cx);
        cx.notify();
    }
    fn choose_launcher(
        &mut self,
        launcher: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.launcher = launcher;
        self.ensure_session(Tool::Agent, launcher, window, cx);
        cx.notify();
    }

    // ----------------------------------------------------------- Changes
    fn call(
        &mut self,
        request: GitRequest,
        cx: &mut Context<Self>,
        done: impl FnOnce(&mut Self, Result<Value, String>, &mut Context<Self>) + 'static,
    ) {
        let Some(target) = self.target.clone() else {
            return;
        };
        let host = target.host.clone();
        let task = cx.background_executor().spawn(async move {
            runtime()
                .block_on(target.hosts.request(&target.folder, &Request::Git(request)))
                .map_err(|error| git_failure(&error, &host))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                done(s, result, cx);
                cx.notify();
            });
        })
        .detach();
    }
    pub fn reload(&mut self, cx: &mut Context<Self>) {
        self.call(
            GitRequest {
                op: "status".into(),
                ..Default::default()
            },
            cx,
            |s, result, _| match result {
                Ok(status) => {
                    s.changes.status = Some(status);
                    s.changes.error = None;
                }
                Err(error) => s.changes.error = Some(error),
            },
        );
    }
    fn run(&mut self, request: GitRequest, cx: &mut Context<Self>) {
        if self.changes.busy {
            return;
        }
        self.changes.busy = true;
        let commit = request.op == "commit";
        self.call(request, cx, move |s, result, cx| {
            s.changes.busy = false;
            match result {
                Ok(_) if commit => s.message.update(cx, |m, cx| m.clear(cx)),
                Ok(_) => {}
                Err(error) => s.changes.error = Some(error),
            }
            s.reload(cx);
        });
        cx.notify();
    }
    fn commit(&mut self, cx: &mut Context<Self>) {
        let message = self.message.read(cx).text().trim().to_owned();
        if message.is_empty() {
            return;
        }
        self.run(
            GitRequest {
                op: "commit".into(),
                message: Some(message),
                ..Default::default()
            },
            cx,
        );
    }
    fn paths(&self, key: &str) -> Vec<String> {
        self.changes
            .status
            .as_ref()
            .and_then(|s| s[key].as_array())
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|e| e["path"].as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Tests: the Changes panel's last status, and the running session.
    #[cfg(test)]
    pub fn status(&self) -> Option<&Value> {
        self.changes.status.as_ref()
    }
    #[cfg(test)]
    pub fn session(&self, tool: Tool) -> Option<(Entity<TerminalView>, bool)> {
        let launcher = if tool == Tool::Agent {
            self.launcher
        } else {
            "shell"
        };
        self.sessions
            .get(&(tool, launcher))
            .map(|s| (s.view.clone(), *s.state.lock().unwrap() == State::Running))
    }

    // ------------------------------------------------------------ render
    fn render_tabs(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let shown = self.tool;
        let host = cx.weak_entity();
        SegmentedControl::new("host-tools-tabs").segments(self.tools().into_iter().map(|tool| {
            let host = host.clone();
            Segment::new(tool.label())
                .selected(shown == Some(tool))
                .on_select(move |window, cx| {
                    let _ = host.update(cx, |s, cx| s.show(tool, window, cx));
                })
        }))
    }
    fn render_launcher(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let host = cx.weak_entity();
        let current = self.launcher;
        h_flex()
            .gap(px(8.))
            .items_center()
            .text_size(px(theme::ty().ui.caption))
            .text_color(cx.palette().muted)
            .child(tr("hosts.tools.agentChoice"))
            .child(Select::new(
                "host-tools-launcher",
                launcher_name(current),
                move |_| {
                    LAUNCHERS
                        .into_iter()
                        .map(|launcher| {
                            let host = host.clone();
                            SelectOption::new(launcher_name(launcher))
                                .selected(launcher == current)
                                .on_select(move |window, cx| {
                                    let _ = host.update(cx, |s, cx| {
                                        s.choose_launcher(launcher, window, cx)
                                    });
                                })
                        })
                        .collect()
                },
            ))
    }
    fn render_terminal(&self, tool: Tool, cx: &mut Context<Self>) -> AnyElement {
        let launcher = if tool == Tool::Agent {
            self.launcher
        } else {
            "shell"
        };
        let Some(session) = self.sessions.get(&(tool, launcher)) else {
            return div().into_any_element();
        };
        let t = cx.palette();
        let host = self
            .target
            .as_ref()
            .map(|t| t.host.clone())
            .unwrap_or_default();
        let state = session.state.lock().unwrap().clone();
        let line = match &state {
            State::Starting => Some(tf(
                "hosts.terminal.starting",
                &[("host", host.as_str().into())],
            )),
            State::Running => None,
            State::Ended(Some(code)) => Some(tf(
                "hosts.terminal.exited",
                &[("status", code.to_string().into())],
            )),
            State::Ended(None) => Some(tr("hosts.terminal.ended").to_owned()),
            State::Failed(code) => Some(tf(
                &format!("hosts.terminal.error.{code}"),
                &[("host", host.as_str().into())],
            )),
        };
        let ended = matches!(state, State::Ended(_) | State::Failed(_));
        v_flex()
            .size_full()
            .min_h_0()
            .when_some(line, |d, line| {
                d.child(
                    h_flex()
                        .debug_selector(|| "host-terminal-status".into())
                        .gap(px(8.))
                        .px(px(8.))
                        .py(px(6.))
                        .items_center()
                        .text_size(px(theme::ty().ui.caption))
                        .text_color(t.muted)
                        .child(div().flex_1().min_w_0().child(line))
                        .when(ended, |d| {
                            d.child(
                                Button::new("host-terminal-restart")
                                    .variant(ButtonVariant::Outline)
                                    .label(tr("hosts.terminal.restart"))
                                    .on_click(
                                        cx.listener(|s, _, window, cx| s.restart(window, cx)),
                                    ),
                            )
                        }),
                )
            })
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .p(px(4.))
                    .child(session.view.clone()),
            )
            .into_any_element()
    }
    fn render_changes(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        if self
            .changes
            .status
            .as_ref()
            .is_some_and(|s| s["isRepo"] == false)
        {
            return div()
                .p(px(8.))
                .text_size(px(ty.body))
                .text_color(t.muted)
                .child(tr("hosts.git.noRepository"))
                .into_any_element();
        }
        let busy = self.changes.busy;
        let staged = self.paths("stagedEntries");
        let mut changed = self.paths("unstagedEntries");
        changed.extend(self.paths("untrackedEntries"));
        let branch = self
            .changes
            .status
            .as_ref()
            .and_then(|s| s["branch"].as_str())
            .unwrap_or_default()
            .to_owned();
        let row = |id: (&'static str, usize),
                   path: String,
                   sign: &'static str,
                   op: &'static str,
                   cx: &mut Context<Self>| {
            let request = GitRequest {
                op: op.into(),
                paths: vec![path.clone()],
                ..Default::default()
            };
            h_flex()
                .gap(px(8.))
                .items_center()
                .min_h(px(24.))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_size(px(ty.caption))
                        .child(path),
                )
                .child(
                    Button::new(id)
                        .variant(ButtonVariant::GitAction)
                        .label(sign)
                        .disabled(busy)
                        .on_click(cx.listener(move |s, _, _, cx| s.run(request.clone(), cx))),
                )
        };
        let section = |title: &'static str, count: usize| {
            div()
                .font_weight(FontWeight::MEDIUM)
                .text_size(px(ty.caption))
                .child(format!("{} · {count}", tr(title)))
        };
        let staged_rows: Vec<_> = staged
            .iter()
            .enumerate()
            .map(|(i, p)| row(("host-git-unstage", i), p.clone(), "−", "unstage", cx))
            .collect();
        let changed_rows: Vec<_> = changed
            .iter()
            .enumerate()
            .map(|(i, p)| row(("host-git-stage", i), p.clone(), "+", "stage", cx))
            .collect();
        let clean = staged.is_empty() && changed.is_empty() && self.changes.status.is_some();
        let can_commit =
            !busy && !staged.is_empty() && !self.message.read(cx).text().trim().is_empty();
        v_flex()
            .id("host-git")
            .debug_selector(|| "host-git".into())
            .size_full()
            .overflow_y_scroll()
            .gap(px(8.))
            .p(px(8.))
            .child(
                h_flex()
                    .gap(px(8.))
                    .items_center()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .font_weight(FontWeight::MEDIUM)
                            .child(branch),
                    )
                    .child(
                        Button::new("host-git-refresh")
                            .variant(ButtonVariant::Ghost)
                            .label(tr("hosts.catalog.refresh"))
                            .disabled(busy)
                            .on_click(cx.listener(|s, _, _, cx| s.reload(cx))),
                    ),
            )
            .when_some(self.changes.error.clone(), |d, error| {
                d.child(
                    div()
                        .debug_selector(|| "host-git-error".into())
                        .text_size(px(ty.caption))
                        .text_color(t.danger)
                        .child(error),
                )
            })
            .child(
                div()
                    .rounded(px(6.))
                    .border_1()
                    .border_color(t.border)
                    .px(px(8.))
                    .py(px(6.))
                    .child(self.message.clone()),
            )
            .child(
                Button::new("host-git-commit")
                    .variant(ButtonVariant::FilledPrimary)
                    .label(tr("hosts.git.commit"))
                    .disabled(!can_commit)
                    .on_click(cx.listener(|s, _, _, cx| s.commit(cx))),
            )
            .child(
                h_flex()
                    .gap(px(8.))
                    .items_center()
                    .child(section("hosts.git.staged", staged.len()))
                    .when(!staged.is_empty(), |d| {
                        d.child(
                            Button::new("host-git-unstage-all")
                                .variant(ButtonVariant::GitAction)
                                .label(tr("hosts.git.unstageAll"))
                                .disabled(busy)
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.run(
                                        GitRequest {
                                            op: "unstage_all".into(),
                                            ..Default::default()
                                        },
                                        cx,
                                    )
                                })),
                        )
                    }),
            )
            .children(staged_rows)
            .child(
                h_flex()
                    .gap(px(8.))
                    .items_center()
                    .child(section("hosts.git.changes", changed.len()))
                    .when(!changed.is_empty(), |d| {
                        d.child(
                            Button::new("host-git-stage-all")
                                .variant(ButtonVariant::GitAction)
                                .label(tr("hosts.git.stageAll"))
                                .disabled(busy)
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.run(
                                        GitRequest {
                                            op: "stage_all".into(),
                                            ..Default::default()
                                        },
                                        cx,
                                    )
                                })),
                        )
                    }),
            )
            .when(clean, |d| {
                d.child(
                    div()
                        .text_size(px(ty.caption))
                        .text_color(t.muted)
                        .child(tr("hosts.git.clean")),
                )
            })
            .children(changed_rows)
            .into_any_element()
    }
}

impl Render for HostTools {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let host = self
            .target
            .as_ref()
            .map(|t| t.host.clone())
            .unwrap_or_default();
        let content = match self.tool {
            Some(Tool::Git) => self.render_changes(cx),
            Some(tool) => self.render_terminal(tool, cx),
            None => div().into_any_element(),
        };
        v_flex()
            .debug_selector(|| "host-tools".into())
            .size_full()
            .min_h_0()
            .child(
                v_flex()
                    .gap(px(6.))
                    .p(px(6.))
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.caption))
                            .text_color(cx.palette().subtle)
                            .child(tf("hosts.tools.title", &[("host", host.into())])),
                    )
                    .child(self.render_tabs(cx))
                    .when(self.tool == Some(Tool::Agent), |d| {
                        d.child(self.render_launcher(cx))
                    }),
            )
            .child(div().flex_1().min_h_0().child(content))
    }
}

fn launcher_name(launcher: &str) -> &'static str {
    tr(&format!("terminal.launcher.{launcher}.name"))
}
/// What the Changes panel says of a refusal (`RemoteGitPanel.call`).
fn git_failure(error: &HostError, host: &str) -> String {
    if error.outcome_unknown {
        return tf("hosts.git.unconfirmed", &[("host", host.into())]);
    }
    let key = if error.code == "folder_unavailable" {
        "hosts.git.error.not_allowed"
    } else {
        "hosts.git.error.failed"
    };
    tf(key, &[("host", host.into())])
}

/// One terminal or Agent on the other computer, bridged to its view until
/// either side ends it (`remote-exec-client.mjs`).
async fn run_terminal(
    target: Target,
    launcher: &'static str,
    bridge: crate::platform::terminal::Bridge,
    state: Arc<Mutex<State>>,
) {
    let crate::platform::terminal::Bridge { requests, outlet } = bridge;
    let set = |next: State| {
        *state.lock().unwrap() = next;
        outlet.notify();
    };
    let opened = async {
        let access = target.hosts.access(&target.folder).await?;
        access.session(launcher, 80, 24).await
    };
    let mut session = match opened.await {
        Ok(channel) => channel,
        Err(error) => {
            let code = if error.code == "network_unavailable" {
                "device_disconnected".to_owned()
            } else {
                error.code
            };
            return set(State::Failed(code));
        }
    };
    set(State::Running);
    // The view's requests arrive on a blocking channel; carry them over.
    let (forward, mut asked) = tokio::sync::mpsc::unbounded_channel();
    std::thread::spawn(move || {
        while let Ok(request) = requests.recv() {
            if forward.send(request).is_err() {
                break;
            }
        }
    });
    let mut status = None;
    loop {
        tokio::select! {
            output = session.next() => match output {
                Output::Data(bytes) => {
                    if !outlet.send(Event::Data(bytes)) {
                        break;
                    }
                }
                Output::Exit(code) => status = Some(code),
                Output::Closed => break,
            },
            request = asked.recv() => match request {
                Some(TerminalRequest::Input(bytes)) => {
                    if bytes.len() <= 64 * 1024 {
                        session.input(&bytes).await;
                    }
                }
                Some(TerminalRequest::Resize(rows, cols)) => session.resize(cols, rows).await,
                // The view was closed here: the session ends there.
                None => {
                    session.close().await;
                    return;
                }
            },
        }
    }
    if let Some(code) = status {
        outlet.send(Event::Exit(code));
    }
    set(State::Ended(status));
}
