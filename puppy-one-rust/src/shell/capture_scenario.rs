//! Dev-capture scenarios: `PUPPYONE_CAPTURE_SCENARIO` replays a `;`-separated
//! list of UI steps against a real workspace before `PUPPYONE_SCREENSHOT`
//! is taken, through the same entry points the pointer uses, so popups open
//! against their painted triggers. Absent from normal builds.
//!
//! Steps: `select:<path>`, `expand:<path>`, `open:<path>`,
//! `node-menu:<path>` (the row's "⋮"), `create-menu:<path>` (the row's "+"),
//! `new-menu` (list-end "New"), `context:<x>,<y>` (right click),
//! `submenu` (Custom files), `project-menu`, `location-menu`, `changes`,
//! `agent`.
use super::*;
use crate::geometry::menu_position::{self, CreatePlacement};
use explorer::{RowTrigger, row_action_rect};
use std::collections::VecDeque;

#[derive(Clone, Debug, PartialEq)]
enum Step {
    Select(PathBuf),
    Expand(PathBuf),
    Open(PathBuf),
    NodeMenu(PathBuf),
    CreateMenu(PathBuf),
    NewMenu,
    Context(f32, f32),
    Submenu,
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
                "open" => Step::Open(path()),
                "node-menu" => Step::NodeMenu(path()),
                "create-menu" => Step::CreateMenu(path()),
                "new-menu" => Step::NewMenu,
                "context" => {
                    let (x, y) = arg.split_once(',')?;
                    Step::Context(x.trim().parse().ok()?, y.trim().parse().ok()?)
                }
                "submenu" => Step::Submenu,
                "project-menu" => Step::Command(super::Command::ProjectMenu),
                "location-menu" => Step::Command(super::Command::LocationMenu),
                "changes" => Step::Command(super::Command::Changes),
                "agent" => Step::Command(super::Command::ToggleRightSidebar),
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
            && !self.tree.rows.is_empty()
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
            return true;
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
                if self.tree.index_of(path).is_none() {
                    return false;
                }
                self.tree.select(path, false, false);
            }
            Step::Expand(path) => {
                let Some(index) = self.tree.index_of(path) else {
                    return false;
                };
                if !self.tree.rows[index].expanded {
                    if self.tree.set_expanded(path, true) {
                        self.files.load_children(path.clone(), &self.wake);
                    }
                    return false;
                }
            }
            Step::Open(path) => self.files.begin(Intent::OpenFile(path.clone()), &self.wake),
            Step::NodeMenu(path) => {
                let (Some(index), Some(row)) =
                    (self.tree.index_of(path), self.row_anchors.row(path))
                else {
                    return false;
                };
                self.open_node_menu(index, row_action_rect(row, RowTrigger::More), false, cx);
            }
            Step::CreateMenu(path) => {
                let Some(row) = self.row_anchors.row(path) else {
                    return false;
                };
                self.open_create_menu(
                    path.clone(),
                    row_action_rect(row, RowTrigger::Create),
                    CreatePlacement::BelowStart,
                    cx,
                );
            }
            Step::NewMenu => {
                let Some(row) = self.row_anchors.new_row() else {
                    return false;
                };
                self.open_create_menu(PathBuf::new(), row, CreatePlacement::AutoEnd, cx);
            }
            Step::Context(x, y) => {
                let anchor = menu_position::point_anchor(*x, *y);
                let hit = self.tree.rows.iter().enumerate().find_map(|(index, r)| {
                    self.row_anchors
                        .row(&r.path)
                        .filter(|rect| rect.contains((*x, *y)))
                        .map(|_| index)
                });
                match hit {
                    Some(index) => self.open_node_menu(index, anchor, true, cx),
                    None => self.open_create_menu(
                        PathBuf::new(),
                        anchor,
                        CreatePlacement::BelowStart,
                        cx,
                    ),
                }
            }
            Step::Submenu => self.set_create_submenu(true, cx),
            Step::Command(command) => self.command(*command, window, cx),
        }
        self.receive(window, cx);
        true
    }
}
