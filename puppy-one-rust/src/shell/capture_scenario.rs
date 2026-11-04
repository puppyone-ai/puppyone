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
//! `home-actions:<index>` (its actions menu), `template` (a template
//! link's card, with `PUPPYONE_TEMPLATE_LAB`), `agents-fixture` /
//! `agents-fixture:open` (the Cloud Header with fixture Agents, open links
//! allowed or not), `agents:<more|invite|agent id>` (their card) and
//! `manage-agents`. The capture waits
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
    ProjectEntry,
    GitCommit(usize),
    Open(PathBuf),
    NodeMenu(PathBuf),
    CreateMenu(PathBuf),
    NewMenu,
    Context(f32, f32),
    Submenu,
    ExplorerDrag(f32),
    Command(super::Command),
    /// `wait:<ms>`: let asynchronous content (a web page) settle.
    Wait(u64),
    HomeList,
    HomeHover(usize),
    HomeActions(usize),
    /// `template`: a template link's card (with `PUPPYONE_TEMPLATE_LAB`).
    Template,
    AgentsFixture(bool),
    Agents(String),
    ManageAgents,
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
                "project-menu" => Step::Command(super::Command::ProjectMenu),
                "location-menu" => Step::Command(super::Command::LocationMenu),
                "changes" => Step::Command(super::Command::Changes),
                "agent" => Step::Command(super::Command::ToggleRightSidebar),
                "toggle-explorer" => Step::Command(super::Command::ToggleExplorer),
                "home" => Step::Command(super::Command::Home),
                "wait" => Step::Wait(arg.trim().parse().ok()?),
                "home-list" => Step::HomeList,
                "home-hover" => Step::HomeHover(arg.trim().parse().ok()?),
                "home-actions" => Step::HomeActions(arg.trim().parse().ok()?),
                "template" => Step::Template,
                "agents-fixture" => Step::AgentsFixture(arg == "open"),
                "agents" => Step::Agents(arg.to_string()),
                "manage-agents" => Step::ManageAgents,
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
    /// When the current `wait:` step began.
    waiting: Option<std::time::Instant>,
    /// Frames painted since the last step, so anchors and layout settle.
    frames: u32,
    started: std::time::Instant,
}
impl CaptureScenario {
    pub fn from_env() -> Option<Self> {
        let text = std::env::var("PUPPYONE_CAPTURE_SCENARIO").ok()?;
        Some(Self {
            steps: parse(&text),
            waiting: None,
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
        // A file window has no Explorer rows or Git; its file must be open.
        let file = self.file_mode();
        let workspace_ready = self.files.workspace.is_some()
            && !self.fixture
            && (file || !self.explorer.read(cx).tree().rows.is_empty())
            && (!file || self.files.opened().is_some())
            && !self.files.busy()
            && !self.files.folder_busy;
        let git_ready = file || self.source_control.read(cx).snapshot.is_some();
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
        if let Step::Wait(ms) = step {
            let began = *scenario.waiting.get_or_insert_with(std::time::Instant::now);
            if began.elapsed() < std::time::Duration::from_millis(ms) {
                return false;
            }
            scenario.waiting = None;
            scenario.steps.pop_front();
            return false;
        }
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
            Step::ProjectEntry => self.open_project_entry(cx),
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
                    create
                        .destination
                        .name
                        .update(cx, |input, cx| input.set_text(name, cx));
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
            Step::Wait(_) => {}
            Step::HomeList => self.preferences.update(cx, |p, cx| {
                p.change(
                    |p| {
                        p.homepage_project_layout =
                            crate::features::settings::preference_types::HomepageLayout::List
                    },
                    cx,
                )
            }),
            Step::HomeHover(index) => {
                let Some(item) = self.visible_projects(cx).into_iter().nth(*index) else {
                    return false;
                };
                self.homepage.hovered = Some(item.id);
            }
            Step::HomeActions(index) => {
                let Some(item) = self.visible_projects(cx).into_iter().nth(*index) else {
                    return false;
                };
                let Some(target) = super::project_actions::Target::of(&item) else {
                    return true;
                };
                let bounds = self
                    .homepage
                    .action_bounds
                    .get(&item.id)
                    .map(|b| b.get())
                    .unwrap_or_default();
                if bounds.size.width <= px(0.) {
                    return false;
                }
                self.homepage.hovered = Some(item.id.clone());
                self.homepage.actions = Some(item.id);
                self.open_project_actions(target, bounds, true, window.viewport_size(), cx);
            }
            Step::Template => self.open_template_link(
                "https://www.puppyone.ai/t/0d3b7a4e-1f2a-4b5c-8d9e-0123456789ab".into(),
                window,
                cx,
            ),
            Step::AgentsFixture(open_links) => {
                self.capture_hosted = true;
                let client = crate::features::cloud_agents::lab_client(*open_links);
                let name = self.project.clone();
                self.cloud_agents.update(cx, |a, cx| {
                    a.attach_client("lab-project", &name, client, cx)
                });
            }
            Step::Agents(opener) => {
                use crate::features::cloud_agents::Opener;
                if !self.cloud_agents.read(cx).manageable {
                    return false;
                }
                let opener = match opener.as_str() {
                    "more" => Opener::More,
                    "invite" => Opener::Invite,
                    id => Opener::Agent(id.to_owned()),
                };
                self.press_agents(opener, cx);
            }
            Step::ManageAgents => {
                if !self.cloud_agents.read(cx).manageable {
                    return false;
                }
                self.open_manage_agents(cx);
            }
        }
        self.receive(window, cx);
        true
    }
}
