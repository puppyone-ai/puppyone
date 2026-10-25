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
//! `git-commit:<index>` (a History commit), `explorer-drag:<x>` (drag the
//! Explorer's edge to `x` and release). The capture waits
//! for the homepage's project activity and an open diff.
use super::*;
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
    GitCommit(usize),
    Open(PathBuf),
    NodeMenu(PathBuf),
    CreateMenu(PathBuf),
    NewMenu,
    Context(f32, f32),
    Submenu,
    ExplorerDrag(f32),
    Command(super::Command),
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
                "project-menu" => Step::Command(super::Command::ProjectMenu),
                "location-menu" => Step::Command(super::Command::LocationMenu),
                "changes" => Step::Command(super::Command::Changes),
                "agent" => Step::Command(super::Command::ToggleRightSidebar),
                "toggle-explorer" => Step::Command(super::Command::ToggleExplorer),
                "home" => Step::Command(super::Command::Home),
                other => {
                    eprintln!("Unknown capture step {other:?}");
                    return None;
                }
            })
        })
        .collect()
}
pub(super) struct CaptureScenario {
    steps: VecDeque<Step>,
    /// Frames painted since the last step, so anchors and layout settle.
    frames: u32,
    started: std::time::Instant,
}
impl CaptureScenario {
    pub fn from_env() -> Option<Self> {
        let text = std::env::var("PUPPYONE_CAPTURE_SCENARIO").ok()?;
        Some(Self {
            steps: parse(&text),
            frames: 0,
            started: std::time::Instant::now(),
        })
    }
}
impl Shell {
    /// Runs at most one step per painted frame; `true` once the scenario has
    /// finished and the last state has painted.
    pub(super) fn advance_capture_scenario(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(mut scenario) = self.capture_scenario.take() else {
            return true;
        };
        let done = self.step_capture_scenario(&mut scenario, window, cx);
        self.capture_scenario = Some(scenario);
        if !done {
            window.request_animation_frame();
        }
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
        let workspace_ready = self.files.workspace.is_some()
            && !self.fixture
            && !self.explorer.read(cx).tree().rows.is_empty()
            && !self.files.busy()
            && !self.files.folder_busy;
        let git_ready = self.source_control.read(cx).snapshot.is_some();
        if !(workspace_ready && git_ready) && !timed_out {
            return false;
        }
        scenario.frames += 1;
        if scenario.frames < 3 {
            return false;
        }
        let Some(step) = scenario.steps.front().cloned() else {
            let reading = self.homepage.reading || self.source_control.read(cx).reading_detail();
            return !reading || timed_out;
        };
        if !self.apply_capture_step(&step, window, cx) && !timed_out {
            // Wait for the state the step needs (a loaded folder, a painted row).
            return false;
        }
        scenario.steps.pop_front();
        scenario.frames = 0;
        cx.notify();
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
                if !self.explorer.update(cx, |e, cx| e.capture_select(path, cx)) {
                    return false;
                }
            }
            Step::Expand(path) => {
                if !self.explorer.update(cx, |e, cx| e.capture_expand(path, cx)) {
                    return false;
                }
            }
            Step::Remember(path) => {
                let path = path.clone();
                self.preferences.update(cx, |p, cx| {
                    p.change(|p| p.remember_project(&path, 1_792_800_000), cx)
                });
            }
            Step::Forget(path) => {
                let path = path.clone();
                self.preferences
                    .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
            }
            Step::GitDiff(path, staged) => {
                let (path, staged) = (path.clone(), *staged);
                if !self
                    .source_control
                    .update(cx, |s, cx| s.select_path(&path, staged, cx))
                {
                    return false;
                }
            }
            Step::GitHistory => self.source_control.update(cx, |s, cx| s.open_history(cx)),
            Step::ExplorerDrag(x) => {
                let at = |x: f32| point(px(x), px(400.));
                self.begin_pane_drag(super::Side::Start, at(self.layout.editor.x), cx);
                self.move_pane_drag(at(*x), cx);
                self.end_pane_drag(true, cx);
            }
            Step::GitCommit(index) => {
                let index = *index;
                if !self
                    .source_control
                    .update(cx, |s, cx| s.select_commit(index, cx))
                {
                    return false;
                }
            }
            Step::CreateProject(name) => {
                self.begin_create_project(window, cx);
                if let Some(create) = self.modals.create_project() {
                    let name = name.clone();
                    create.name.update(cx, |input, cx| input.set_text(name, cx));
                }
            }
            Step::Collapse(path) => {
                if self.explorer.read(cx).tree().index_of(path).is_none() {
                    return false;
                }
                self.explorer
                    .update(cx, |e, cx| e.set_expanded(path, false, cx));
            }
            Step::Open(path) => self.files.begin(Intent::OpenFile(path.clone()), &self.wake),
            Step::NodeMenu(path) => {
                let Some(index) = self.explorer.read(cx).tree().index_of(path) else {
                    return false;
                };
                let at = MenuAt::Row(path.clone(), RowTrigger::More);
                self.explorer
                    .update(cx, |e, cx| e.open_node_menu(index, at, cx));
            }
            Step::CreateMenu(path) => {
                let at = MenuAt::Row(path.clone(), RowTrigger::Create);
                self.explorer
                    .update(cx, |e, cx| e.open_create_menu(path.clone(), at, cx));
            }
            Step::NewMenu => self.explorer.update(cx, |e, cx| {
                e.open_create_menu(PathBuf::new(), MenuAt::NewRow, cx)
            }),
            Step::Context(x, y) => {
                let position = point(px(*x), px(*y));
                self.explorer.update(cx, |e, cx| match e.row_at(position) {
                    Some(index) => e.open_node_menu(index, MenuAt::Pointer(position), cx),
                    None => e.open_create_menu(PathBuf::new(), MenuAt::Pointer(position), cx),
                });
            }
            Step::Submenu => self.explorer.update(cx, |e, cx| e.capture_open_submenu(cx)),
            Step::Command(command) => self.command(*command, window, cx),
        }
        self.receive(window, cx);
        true
    }
}
