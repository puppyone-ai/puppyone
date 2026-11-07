//! Dev-capture scenarios: `PUPPYONE_CAPTURE_SCENARIO` replays a `;`-separated
//! list of UI steps against a real workspace before `PUPPYONE_SCREENSHOT`
//! is taken, through the same entry points the pointer uses, so popups open
//! against their painted triggers. Absent from normal builds.
//!
//! Steps: `select:<path>`, `expand:<path>`, `collapse:<path>`, `open:<path>`,
//! `node-menu:<path>` (the row's "⋮"), `create-menu:<path>` (the row's "+"),
//! `new-menu` (list-end "New"), `context:<x>,<y>` (right click),
//! `submenu` (Custom files), `project-menu`, `location-menu`, `changes`,
//! `agent`, `toggle-explorer`, `home`, `remember:<absolute path>` and
//! `forget:<absolute path>` (a recent project), `create-project:<name>`
//! (the create dialog with a fixed name), `git-diff:<path>` /
//! `git-diff-staged:<path>` (a change's diff in Changes), `git-history`,
//! `git-commit:<index>` (a History commit), `project-entry` (the Project
//! entry launcher), `explorer-drag:<x>` (drag the
//! Explorer's edge to `x` and release), `home-list` (the Homepage's List
//! layout), `home-hover:<index>` (a Homepage entry reached for) and
//! `home-actions:<index>` (its actions menu), `pin:<path>` (a file pinned
//! above the tree), `template` (a template
//! link's card, with `PUPPYONE_TEMPLATE_LAB`), `agents-fixture` /
//! `agents-fixture:open` (the Cloud Header with fixture Agents, open links
//! allowed or not), `agents:<more|invite|agent id>` (their card),
//! `manage-agents`, `agent-chat:<runtime id>` (a new chat on a detected
//! Agent), `agent-settled` (its session prepared or failed),
//! `agent-prompt:<text>` (the chat sends it), `agent-idle` (no turn
//! running), `agent-history` (History with discovery allowed) and
//! `agent-history-open` (its first chat opens), and in a file window `file-menu:<view|settings>` (a
//! title bar menu), `file-edit` (a space typed at the end of the first
//! line) and `blur` (focus leaves the document). The capture waits
//! for the homepage's project activity and an open diff. With
//! `PUPPYONE_CAPTURE_LIVE` the scenario replays in an ordinary foreground
//! window on the display link (`tools/frame-pacing.py` times its frames).
use crate::app::*;
use explorer::{MenuAt, RowTrigger};
use std::collections::VecDeque;

#[derive(Clone, Debug, PartialEq)]
enum Step {
    Select(PathBuf),
    Expand(PathBuf),
    Collapse(PathBuf),
    Remember(PathBuf),
    Forget(PathBuf),
    CreateProject(String),
    GitDiff(String, bool),
    GitHistory,
    ProjectEntry,
    GitCommit(usize),
    Open(PathBuf),
    NodeMenu(PathBuf),
    CreateMenu(PathBuf),
    NewMenu,
    Context(f32, f32),
    Submenu,
    ExplorerDrag(f32),
    Command(crate::app::Command),
    /// `wait:<ms>`: let asynchronous content (a web page) settle.
    Wait(u64),
    HomeList,
    HomeHover(usize),
    HomeActions(usize),
    /// `template`: a template link's card (with `PUPPYONE_TEMPLATE_LAB`).
    Template,
    /// `pin:<path>`: pin a file above the tree.
    Pin(PathBuf),
    AgentsFixture(bool),
    Agents(String),
    ManageAgents,
    FileMenu(crate::app::file_mode::FileMenu),
    FileEdit,
    Blur,
    /// `agent-chat:<runtime id>`: a new chat on a detected Agent.
    AgentChat(String),
    /// `agent-settled`: the chat's session is prepared, or failed.
    AgentSettled,
    /// `agent-prompt:<text>`: the active chat sends `text`.
    AgentPrompt(String),
    /// `agent-idle`: no chat has a running turn.
    AgentIdle,
    /// `agent-history`: the History browser, with discovery allowed.
    AgentHistory,
    /// `agent-history-open`: History opens its first chat.
    AgentHistoryOpen,
}
fn parse(text: &str) -> VecDeque<Step> {
    text.split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|step| {
            let (name, arg) = step.split_once(':').unwrap_or((step, ""));
            let path = || PathBuf::from(arg);
            Some(match name {
                "select" => Step::Select(path()),
                "expand" => Step::Expand(path()),
                "collapse" => Step::Collapse(path()),
                "remember" => Step::Remember(path()),
                "forget" => Step::Forget(path()),
                "create-project" => Step::CreateProject(arg.to_string()),
                "git-diff" => Step::GitDiff(arg.to_string(), false),
                "git-diff-staged" => Step::GitDiff(arg.to_string(), true),
                "git-history" => Step::GitHistory,
                "project-entry" => Step::ProjectEntry,
                "git-commit" => Step::GitCommit(arg.parse().ok()?),
                "open" => Step::Open(path()),
                "node-menu" => Step::NodeMenu(path()),
                "create-menu" => Step::CreateMenu(path()),
                "new-menu" => Step::NewMenu,
                "context" => {
                    let (x, y) = arg.split_once(',')?;
                    Step::Context(x.trim().parse().ok()?, y.trim().parse().ok()?)
                }
                "submenu" => Step::Submenu,
                "explorer-drag" => Step::ExplorerDrag(arg.trim().parse().ok()?),
                "project-menu" => Step::Command(crate::app::Command::ProjectMenu),
                "location-menu" => Step::Command(crate::app::Command::LocationMenu),
                "changes" => Step::Command(crate::app::Command::Changes),
                "agent" => Step::Command(crate::app::Command::ToggleRightSidebar),
                "toggle-explorer" => Step::Command(crate::app::Command::ToggleExplorer),
                "home" => Step::Command(crate::app::Command::Home),
                "wait" => Step::Wait(arg.trim().parse().ok()?),
                "home-list" => Step::HomeList,
                "home-hover" => Step::HomeHover(arg.trim().parse().ok()?),
                "home-actions" => Step::HomeActions(arg.trim().parse().ok()?),
                "template" => Step::Template,
                "pin" => Step::Pin(path()),
                "agents-fixture" => Step::AgentsFixture(arg == "open"),
                "agents" => Step::Agents(arg.to_string()),
                "manage-agents" => Step::ManageAgents,
                "file-menu" => Step::FileMenu(match arg {
                    "settings" => crate::app::file_mode::FileMenu::Settings,
                    _ => crate::app::file_mode::FileMenu::View,
                }),
                "file-edit" => Step::FileEdit,
                "blur" => Step::Blur,
                "agent-chat" => Step::AgentChat(arg.to_string()),
                "agent-settled" => Step::AgentSettled,
                "agent-prompt" => Step::AgentPrompt(arg.to_string()),
                "agent-idle" => Step::AgentIdle,
                "agent-history" => Step::AgentHistory,
                "agent-history-open" => Step::AgentHistoryOpen,
                other => {
                    eprintln!("Unknown capture step {other:?}");
                    return None;
                }
            })
        })
        .collect()
}
pub(in crate::app) struct CaptureScenario {
    steps: VecDeque<Step>,
    /// When the current `wait:` step began.
    waiting: Option<std::time::Instant>,
    /// Frames painted since the last step, so anchors and layout settle.
    frames: u32,
    /// The next step is waiting to run after this frame.
    applying: bool,
    started: std::time::Instant,
}
impl CaptureScenario {
    pub fn from_env() -> Option<Self> {
        let text = std::env::var("PUPPYONE_CAPTURE_SCENARIO").ok()?;
        Some(Self {
            steps: parse(&text),
            waiting: None,
            frames: 0,
            applying: false,
            started: std::time::Instant::now(),
        })
    }
}
impl Shell {
    /// Runs at most one step per painted frame; `true` once the scenario has
    /// finished and the last state has painted.
    /// After a frame: the scenario's next step; `true` once it is done.
    pub(in crate::app) fn advance_capture_scenario(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(mut scenario) = self.frame.capture_scenario.take() else {
            return true;
        };
        let done = self.step_capture_scenario(&mut scenario, window, cx);
        self.frame.capture_scenario = Some(scenario);
        done
    }
    fn step_capture_scenario(
        &mut self,
        scenario: &mut CaptureScenario,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let timed_out = scenario.started.elapsed() > std::time::Duration::from_secs(20);
        // The real workspace and its Git status must be in place first.
        // A file window has no Explorer rows or Git; its file must be open.
        let file = self.file_mode();
        // A file window held loading or showing it cannot open is settled.
        let file_settled = self
            .file
            .as_ref()
            .is_some_and(|f| f.read(cx).shown(cx) != crate::app::file_mode::Shown::Document)
            || file && std::env::var_os("PUPPYONE_FILE_HOLD").is_some();
        let workspace_ready = file_settled
            || self.files(cx).workspace.is_some()
                && !self.session.project.read(cx).record.fixture
                && (file || !self.explorer.session.read(cx).tree().rows.is_empty())
                && (!file || self.files(cx).opened().is_some())
                && !self.files(cx).busy()
                && !self.files(cx).folder_busy;
        let git_ready = file
            || self
                .sidebar
                .read(cx)
                .source_control
                .read(cx)
                .snapshot
                .is_some();
        if !(workspace_ready && git_ready) && !timed_out {
            return false;
        }
        scenario.frames += 1;
        if scenario.frames < 3 {
            return false;
        }
        let Some(step) = scenario.steps.front().cloned() else {
            let reading = self.home.read(cx).reading
                || self
                    .sidebar
                    .read(cx)
                    .source_control
                    .read(cx)
                    .reading_detail();
            return !reading || timed_out;
        };
        if let Step::Wait(ms) = step {
            let began = *scenario.waiting.get_or_insert_with(std::time::Instant::now);
            if began.elapsed() < std::time::Duration::from_millis(ms) {
                return false;
            }
            scenario.waiting = None;
            scenario.steps.pop_front();
            return false;
        }
        // A step changes state, so it runs after the frame, not while it
        // renders: what it changes then reaches every view that shows it.
        if !std::mem::replace(&mut scenario.applying, true) {
            cx.defer_in(window, move |s, window, cx| {
                let Some(mut scenario) = s.frame.capture_scenario.take() else {
                    return;
                };
                scenario.applying = false;
                if !s.apply_capture_step(&step, window, cx) && !timed_out {
                    // Wait for the state the step needs (a loaded folder, a
                    // painted row).
                } else {
                    scenario.steps.pop_front();
                    scenario.frames = 0;
                }
                s.frame.capture_scenario = Some(scenario);
                cx.notify();
            });
        }
        false
    }
    /// `false` while the step cannot run yet.
    fn apply_capture_step(
        &mut self,
        step: &Step,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        match step {
            Step::Select(path) => {
                if !self
                    .explorer
                    .session
                    .update(cx, |e, cx| e.capture_select(path, cx))
                {
                    return false;
                }
            }
            Step::Expand(path) => {
                if !self
                    .explorer
                    .session
                    .update(cx, |e, cx| e.capture_expand(path, cx))
                {
                    return false;
                }
            }
            Step::Remember(path) => {
                let path = path.clone();
                self.prefs.store.update(cx, |p, cx| {
                    p.change(|p| p.remember_project(&path, 1_792_800_000), cx)
                });
            }
            Step::Forget(path) => {
                let path = path.clone();
                self.prefs
                    .store
                    .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
            }
            Step::GitDiff(path, staged) => {
                let (path, staged) = (path.clone(), *staged);
                if !self
                    .sidebar
                    .read(cx)
                    .source_control
                    .clone()
                    .update(cx, |s, cx| s.select_path(&path, staged, cx))
                {
                    return false;
                }
            }
            Step::GitHistory => self
                .sidebar
                .read(cx)
                .source_control
                .clone()
                .update(cx, |s, cx| s.open_history(cx)),
            Step::ProjectEntry => self.home.update(cx, |h, cx| h.open_project_entry(cx)),
            Step::ExplorerDrag(x) => {
                let at = |x: f32| point(px(x), px(400.));
                let (from, to) = (at(self.frame.layout.editor.x), at(*x));
                self.panes.update(cx, |p, cx| {
                    p.begin_drag(crate::app::Side::Start, from, cx);
                    p.move_drag(to, cx);
                    p.end_drag(true, cx);
                });
            }
            Step::GitCommit(index) => {
                let index = *index;
                if !self
                    .sidebar
                    .read(cx)
                    .source_control
                    .clone()
                    .update(cx, |s, cx| s.select_commit(index, cx))
                {
                    return false;
                }
            }
            Step::CreateProject(name) => {
                let name = name.clone();
                self.home
                    .update(cx, |h, cx| h.capture_create_project(name, window, cx));
            }
            Step::Collapse(path) => {
                if self
                    .explorer
                    .session
                    .read(cx)
                    .tree()
                    .index_of(path)
                    .is_none()
                {
                    return false;
                }
                self.explorer
                    .session
                    .update(cx, |e, cx| e.set_expanded(path, false, cx));
            }
            Step::Open(path) => self
                .session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFile(path.clone()))),
            Step::NodeMenu(path) => {
                let Some(index) = self.explorer.session.read(cx).tree().index_of(path) else {
                    return false;
                };
                let at = MenuAt::Row(path.clone(), RowTrigger::More);
                self.explorer
                    .view
                    .update(cx, |e, cx| e.open_node_menu(index, at, cx));
            }
            Step::CreateMenu(path) => {
                let at = MenuAt::Row(path.clone(), RowTrigger::Create);
                self.explorer
                    .view
                    .update(cx, |e, cx| e.open_create_menu(path.clone(), at, cx));
            }
            Step::NewMenu => self.explorer.view.update(cx, |e, cx| {
                e.open_create_menu(PathBuf::new(), MenuAt::NewRow, cx)
            }),
            Step::Context(x, y) => {
                let position = point(px(*x), px(*y));
                self.explorer
                    .view
                    .update(cx, |e, cx| match e.row_at(position, cx) {
                        Some(index) => e.open_node_menu(index, MenuAt::Pointer(position), cx),
                        None => e.open_create_menu(PathBuf::new(), MenuAt::Pointer(position), cx),
                    });
            }
            Step::Submenu => self
                .explorer
                .view
                .update(cx, |e, cx| e.capture_open_submenu(cx)),
            Step::Command(command) => self.command(*command, window, cx),
            Step::Wait(_) => {}
            Step::AgentChat(runtime_id) => {
                if !self
                    .sidebar
                    .read(cx)
                    .workbench
                    .clone()
                    .update(cx, |w, cx| w.capture_new_chat(runtime_id, window, cx))
                {
                    return false;
                }
            }
            Step::AgentSettled => {
                if !self
                    .sidebar
                    .read(cx)
                    .workbench
                    .read(cx)
                    .capture_agent_settled(cx)
                {
                    return false;
                }
            }
            Step::AgentPrompt(text) => {
                if !self
                    .sidebar
                    .read(cx)
                    .workbench
                    .read(cx)
                    .capture_agent_prompt(text, cx)
                {
                    return false;
                }
            }
            Step::AgentIdle => {
                if !self
                    .sidebar
                    .read(cx)
                    .workbench
                    .read(cx)
                    .capture_agent_idle(cx)
                {
                    return false;
                }
            }
            Step::AgentHistory => {
                if !self
                    .sidebar
                    .read(cx)
                    .workbench
                    .clone()
                    .update(cx, |w, cx| w.capture_history(window, cx))
                {
                    return false;
                }
            }
            Step::AgentHistoryOpen => {
                if !self
                    .sidebar
                    .read(cx)
                    .workbench
                    .clone()
                    .update(cx, |w, cx| w.capture_history_open(window, cx))
                {
                    return false;
                }
            }
            Step::HomeList => self.prefs.store.update(cx, |p, cx| {
                p.change(
                    |p| p.homepage_project_layout = crate::features::settings::HomepageLayout::List,
                    cx,
                )
            }),
            Step::HomeHover(index) => {
                let index = *index;
                if !self.home.update(cx, |h, cx| h.capture_hover(index, cx)) {
                    return false;
                }
            }
            Step::HomeActions(index) => {
                let index = *index;
                if !self
                    .home
                    .update(cx, |h, cx| h.capture_actions(index, window, cx))
                {
                    return false;
                }
            }
            Step::Pin(path) => {
                let path = path.clone();
                self.explorer
                    .session
                    .update(cx, |e, cx| e.toggle_pin(&path, cx));
            }
            Step::Template => self.home.update(cx, |h, cx| {
                h.open_template_link(
                    "https://www.puppyone.ai/t/0d3b7a4e-1f2a-4b5c-8d9e-0123456789ab".into(),
                    window,
                    cx,
                )
            }),
            Step::AgentsFixture(open_links) => {
                let client = crate::features::cloud::lab_agents_client(*open_links);
                let name = self.session.project.read(cx).record.name.clone();
                self.cloud.update(cx, |c, cx| {
                    c.capture_hosted = true;
                    c.agents.update(cx, |a, cx| {
                        a.attach_client("lab-project", &name, client, cx)
                    });
                });
            }
            Step::Agents(opener) => {
                use crate::features::cloud::Opener;
                if !self.cloud.read(cx).agents.read(cx).manageable {
                    return false;
                }
                let opener = match opener.as_str() {
                    "more" => Opener::More,
                    "invite" => Opener::Invite,
                    id => Opener::Agent(id.to_owned()),
                };
                self.cloud.update(cx, |c, cx| c.press_agents(opener, cx));
            }
            Step::ManageAgents => {
                if !self.cloud.read(cx).agents.read(cx).manageable {
                    return false;
                }
                self.cloud.update(cx, |c, cx| c.open_manage_agents(cx));
            }
            Step::FileMenu(menu) => {
                if let Some(file) = &self.file {
                    let menu = *menu;
                    file.update(cx, |f, cx| {
                        f.menu = Some(menu);
                        cx.notify();
                    });
                }
            }
            // Typed through the input handler at the end of the first line
            // (invisible there, and nothing scrolls).
            Step::FileEdit => {
                let Some(editor) = self.file.as_ref().and_then(|f| f.read(cx).file_editor(cx))
                else {
                    return false;
                };
                editor.update(cx, |e, cx| {
                    e.focus_document(window, cx);
                    e.lab_type(" ", window, cx);
                });
            }
            Step::Blur => self.frame.focus.focus(window, cx),
        }
        self.receive(window, cx);
        true
    }
}

/// Captures can start on a surface (`PUPPYONE_CAPTURE_SURFACE`): Changes,
/// or the Agent panel over its visual fixture.
pub(in crate::app) fn prepare_surface(s: &mut Shell, window: &mut Window, cx: &mut Context<Shell>) {
    if std::env::var_os("PUPPYONE_SCREENSHOT").is_some() {
        let surface = std::env::var("PUPPYONE_CAPTURE_SURFACE").unwrap_or_default();
        if surface == "changes" {
            s.panes.update(cx, |p, cx| p.set_right_open(true, cx));
        }
        if surface == "agent-panel" || surface == "agent-panel-empty" {
            s.panes.update(cx, |p, cx| p.set_right_open(true, cx));
            s.sidebar
                .read(cx)
                .workbench
                .clone()
                .update(cx, |workbench, cx| {
                    workbench.visual_fixture_panel(surface == "agent-panel", window, cx)
                });
        }
        if surface == "agent-empty" || surface == "agent-transcript" {
            s.panes.update(cx, |p, cx| p.set_right_open(true, cx));
            s.sidebar
                .read(cx)
                .workbench
                .clone()
                .update(cx, |workbench, cx| {
                    workbench.visual_fixture_panel(surface == "agent-transcript", window, cx)
                });
        }
    }
}
