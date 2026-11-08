use crate::{
    documents::Intent,
    editor::workbench::runtime::Runtime as Documents,
    geometry::Rect,
    theme::{self, Theme},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use std::path::PathBuf;
mod appearance;
mod audience;
mod chrome;
mod dev;
pub use chrome::Popover;
mod cloud_agents_ui;
mod cloud_authority;
mod cloud_publish;
pub(crate) mod coachmarks;
mod command;
mod dialogs;
mod editor_area;
mod editor_workbench;
mod explorer;
mod file_mode;
mod header;
mod home;
mod panes;
mod project;
mod project_actions;
mod project_place;
mod right_sidebar;
mod session;
mod sidebar;
mod window_cloud;
pub mod windows;
use command::on_shell_actions;
pub use command::{
    Command, app_menus, bind_keys, dock_menu, on_app_actions, on_global_shell_actions,
};
use dialogs::{DialogEvent, DialogKey, DialogLayer, Modal, Task};
#[cfg(feature = "dev-capture")]
pub(crate) use dialogs::{settings_dialog, task_backdrop};
use explorer::{Explorer, ExplorerEvent, ExplorerSession, Host, SessionEvent};
use panes::{Layout, PaneEvent, PaneLayout, PaneStack, Side};
use right_sidebar::Surface;
use sidebar::{ExplorerColumn, SidebarFooter};
/// The layout of a pane embedded as a cached view: it fills the frame the
/// shell places it in. A cached pane renders again only when its entity is
/// notified (or the window refreshes), so editor scrolling and typing do not
/// rebuild the Explorer or the right sidebar.
fn fill() -> StyleRefinement {
    StyleRefinement::default().size_full()
}

pub struct Shell {
    /// The documents runtime, the project lifecycle, the owner key and the
    /// applied title.
    session: session::WindowSession,
    /// The shared preferences and what the window projects of them.
    prefs: appearance::WindowPreferences,
    /// The Explorer's and the right sidebar's frames: open, width, edge
    /// drags and motion.
    panes: Entity<PaneLayout>,
    /// The project's Explorer session (its tree, selection, clipboard and
    /// pins, kept per project) and its view on the left.
    explorer: explorer::ExplorerPane,
    /// The editor area's hosts, drops, resizes and save notices.
    editor: Entity<editor_area::EditorArea>,
    /// What the right sidebar shows: the Agent workbench, Changes / History
    /// and a hosted Project's History.
    sidebar: Entity<right_sidebar::RightSidebar>,
    /// The Header, its popovers, the project rail and the introductions.
    chrome: Entity<chrome::WindowChrome>,
    home: Entity<home::Homepage>,
    /// The window's Cloud: catalog, association, publication, Agents, Share.
    cloud: Entity<window_cloud::WindowCloud>,
    /// Window dialogs, bottom to top, and the Settings and Help content.
    dialogs: Entity<DialogLayer>,
    /// A file window's own state (File Mode); `None` for a project window.
    pub(super) file: Option<Entity<file_mode::FileWindow>>,
    /// The window's own focus and where everything sat last frame.
    frame: WindowFrame,
}
/// The window as a frame: its own focus, where everything sits this frame
/// (pane motion included), and the capture taken of it.
struct WindowFrame {
    focus: FocusHandle,
    layout: Layout,
    captured: bool,
    #[cfg(feature = "dev-capture")]
    capture_scenario: Option<dev::capture_scenario::CaptureScenario>,
    #[cfg(test)]
    frames: usize,
}
fn at(r: Rect) -> Div {
    div()
        .absolute()
        .left(px(r.x))
        .top(px(r.y))
        .w(px(r.w))
        .h(px(r.h))
}
impl Shell {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let fixture = cfg!(test)
            || std::env::var_os("PUPPYONE_FIXTURE").is_some()
            || std::env::var_os("PUPPYONE_SCREENSHOT").is_some();
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        let weak = cx.weak_entity();
        window.on_window_should_close(cx, move |window, cx| {
            weak.update(cx, |s, cx| s.should_close(window, cx))
                .unwrap_or(true)
        });
        crate::features::cloud::account::observe(window, cx, |s, window, cx| {
            s.refresh_cloud_catalog(false, cx);
            s.guard_cloud_authority(window, cx);
            s.session.docs.read(cx).wake().notify();
            cx.notify();
        })
        .detach();
        // One preference owner for every window; per-window state stays here.
        let launch = windows::take_launch(cx);
        let preferences = windows::shared_preferences(fixture, cx);
        let explorer_session = cx.new(|cx| ExplorerSession::new(fixture, preferences.clone(), cx));
        let key = crate::features::agent_presence::owner(window);
        let docs = cx.new(|cx| session::DocumentSession::new(fixture, key.clone(), cx));
        let editor = cx.new(|cx| {
            editor_area::EditorArea::new(
                docs.clone(),
                explorer_session.clone(),
                preferences.clone(),
                focus.clone(),
                key.clone(),
                window,
                cx,
            )
        });
        let dialogs = cx.new(|cx| DialogLayer::new(preferences.clone(), key.clone(), window, cx));
        let catalog = crate::features::cloud::global_catalog(cx);
        let panes = {
            let right = std::env::var("PUPPYONE_RIGHT").as_deref() == Ok("1");
            cx.new(|cx| PaneLayout::new(right, window, cx))
        };
        let project_actions = cx.new(|cx| {
            project_actions::ProjectActions::new(
                preferences.clone(),
                catalog.clone(),
                &dialogs,
                focus.clone(),
                cx,
            )
        });
        let home = cx.new(|cx| {
            home::Homepage::new(
                preferences.clone(),
                catalog.clone(),
                project_actions.clone(),
                &dialogs,
                focus.clone(),
                window,
                cx,
            )
        });
        let project =
            cx.new(|_| project::ProjectLifecycle::new(docs.clone(), preferences.clone(), fixture));
        let sidebar = cx.new(|cx| {
            right_sidebar::RightSidebar::new(
                if std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() == Ok("changes") {
                    right_sidebar::Surface::Git
                } else {
                    right_sidebar::Surface::Agent
                },
                preferences.clone(),
                panes.clone(),
                window,
                cx,
            )
        });
        let cloud = cx.new(|cx| {
            window_cloud::WindowCloud::new(
                preferences.clone(),
                catalog,
                sidebar.read(cx).source_control.clone(),
                &dialogs,
                focus.clone(),
                window,
                cx,
            )
        });
        let coachmarks = cx.new(|cx| {
            coachmarks::HeaderCoachmarks::new(
                preferences.clone(),
                sidebar.clone(),
                dialogs.clone(),
                window,
                cx,
            )
        });
        let chrome = cx.new(|cx| {
            chrome::WindowChrome::new(
                chrome::Owners {
                    preferences: preferences.clone(),
                    docs: docs.clone(),
                    project: project.clone(),
                    panes: panes.clone(),
                    sidebar: sidebar.clone(),
                    home: home.clone(),
                    cloud: cloud.clone(),
                    editor: editor.clone(),
                },
                project_actions.clone(),
                coachmarks.clone(),
                cx,
            )
        });
        cx.subscribe_in(&project_actions, window, |s, _, event, w, cx| {
            s.project_actions_event(event, w, cx)
        })
        .detach();
        // The introduction's primary action opens what it introduces.
        cx.subscribe_in(&coachmarks, window, |s, _, event, w, cx| {
            let coachmarks::Introduce(command) = event;
            s.command(*command, w, cx)
        })
        .detach();
        let mut s = Self {
            session: session::WindowSession {
                docs,
                project,
                key: key.clone(),
                title: None,
            },
            explorer: explorer::ExplorerPane {
                view: cx.new(|cx| {
                    Explorer::new(explorer_session.clone(), preferences.clone(), cx)
                        .with_presence_owner(key.clone())
                }),
                session: explorer_session,
            },
            prefs: appearance::WindowPreferences::new(preferences),
            panes,
            editor,
            sidebar,
            chrome,
            home,
            cloud,
            dialogs,
            file: None,
            frame: WindowFrame {
                focus,
                captured: false,
                layout: Layout::new(1280., 800., theme::pane::DEFAULT_EXPLORER_WIDTH, 0., 0.),
                #[cfg(feature = "dev-capture")]
                capture_scenario: if cfg!(test) {
                    None
                } else {
                    dev::capture_scenario::CaptureScenario::from_env()
                },
                #[cfg(test)]
                frames: 0,
            },
        };
        // What each owner asks of the window, and drawing again when it
        // changes.
        s.wire(&s.session.docs.clone(), Self::woke, window, cx);
        s.wire(&s.session.project.clone(), Self::project_event, window, cx);
        s.wire(&s.editor.clone(), Self::editor_event, window, cx);
        s.wire(&s.home.clone(), Self::home_event, window, cx);
        s.wire(&s.chrome.clone(), Self::chrome_event, window, cx);
        s.wire(&s.dialogs.clone(), Self::dialog_event, window, cx);
        s.wire(&s.sidebar.clone(), Self::sidebar_event, window, cx);
        s.wire(&s.cloud.clone(), Self::cloud_event, window, cx);
        s.wire(&s.panes.clone(), Self::pane_event, window, cx);
        s.wire(
            &s.explorer.session.clone(),
            Self::explorer_session_event,
            window,
            cx,
        );
        s.wire(&s.explorer.view.clone(), Self::explorer_event, window, cx);
        s.wire(&s.prefs.store.clone(), Self::preferences_event, window, cx);
        // A file window's title shows its unsaved edits.
        cx.observe_in(&s.editor, window, |s, _, w, cx| s.sync_window_title(w, cx))
            .detach();
        // A dialog of the Agent workbench holds the editors too.
        let workbench = s.sidebar.read(cx).workbench.clone();
        cx.observe_in(&workbench, window, |s, _, w, cx| s.gate_editors(w, cx))
            .detach();
        // The create form holds the window open while it writes; the
        // preferences drain before it closes.
        cx.observe(&s.dialogs, |s, _, cx| {
            s.session.docs.read(cx).wake().notify()
        })
        .detach();
        cx.observe(&s.prefs.store, |s, _, cx| {
            s.session.docs.read(cx).wake().notify()
        })
        .detach();
        cx.observe_window_appearance(window, |s, w, cx| s.apply_appearance(w, cx))
            .detach();
        // An installed Sub Theme can change on disk (`useSubThemeCatalog`).
        if let Some(catalog) = crate::features::sub_theme_catalog::global(cx) {
            cx.observe_in(&catalog, window, |s, _, w, cx| s.apply_appearance(w, cx))
                .detach();
        }
        // The Explorer's frame follows the window; full screen drops the
        // title.
        cx.observe_window_bounds(window, |s, window, cx| {
            s.push_explorer_host(window, cx);
            s.sync_window_title(window, cx);
        })
        .detach();
        cx.observe_window_activation(window, Self::window_activated)
            .detach();
        // The Homepage disclosure follows the analytics state.
        if let Some(telemetry) = crate::features::telemetry::global(cx) {
            cx.observe(&telemetry, |_, _, cx| cx.notify()).detach();
        }
        // Captures can start on a task dialog.
        match std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() {
            Ok("settings") => s.open_modal(Modal::Task(Task::Settings), cx),
            Ok("feedback") => s.open_modal(Modal::Task(Task::Feedback), cx),
            _ => {}
        }
        let plan = launch.plan(fixture);
        if let Some(open) = plan.open_first {
            s.session
                .project
                .update(cx, |p, _| p.record.open_first = open);
        }
        #[cfg(feature = "dev-capture")]
        dev::capture_scenario::prepare_surface(&mut s, window, cx);
        if let Some(file) = plan
            .file
            .and_then(|(path, hold)| file_mode::FileTarget::of(path).map(|file| (file, hold)))
        {
            s.bind_file(file.0, file.1, window, cx);
        } else if let Some(path) = plan.workspace {
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFolder(path)));
        } else if plan.restore_last {
            s.session
                .project
                .update(cx, |p, _| p.record.restore_last = true);
        }
        windows::register(window.window_handle(), cx.weak_entity(), cx);
        // `DesktopDialogRoot`'s focus keeper: a control disabled or removed
        // while it holds focus drops focus out of the dialog; focus returns
        // to the nearest surface still there (the dialog's own).
        cx.on_focus_lost(window, |s, window, cx| {
            if !s.dialogs.read(cx).is_empty()
                && let Some(target) = window.focus_lost_restore_target(cx)
            {
                target.focus(window, cx);
            }
        })
        .detach();
        // Until preferences load: the default Sub Theme in the start-up mode.
        s.prefs.apply_default(window, cx);
        s.constrain_window(window, cx);
        s.push_explorer_host(window, cx);
        // What the window shows from its first frame.
        s.sync_session_view(cx);
        s.sync_window_title(window, cx);
        s
    }
    /// The preferences changed: the appearance (the whole window renders
    /// again) and the pane layout, when they did.
    fn preferences_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (appearance, panes) = self.prefs.changed(window, cx);
        if appearance {
            self.gate_editors(window, cx);
        }
        if let Some(stored) = panes {
            self.panes.update(cx, |p, cx| p.restore(stored, cx));
        }
    }
    /// The window appearance or an installed Sub Theme changed.
    fn apply_appearance(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.prefs.apply(window, cx);
        self.gate_editors(window, cx);
    }
    /// The window takes `owner`'s events (`on`) and draws again when it
    /// changes.
    fn wire<T: EventEmitter<E>, E: 'static>(
        &self,
        owner: &Entity<T>,
        on: fn(&mut Self, &E, &mut Window, &mut Context<Self>),
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.route(owner, on, window, cx);
        cx.observe(owner, |_, _, cx| cx.notify()).detach();
    }
    /// The window takes `owner`'s events (`on`).
    fn route<T: EventEmitter<E>, E: 'static>(
        &self,
        owner: &Entity<T>,
        on: fn(&mut Self, &E, &mut Window, &mut Context<Self>),
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        cx.subscribe_in(owner, window, move |s, _, event, w, cx| on(s, event, w, cx))
            .detach();
    }
    /// A file window (File Mode): one file, no project.
    pub(super) fn file_mode(&self) -> bool {
        self.file.is_some()
    }
    /// The documents runtime, read.
    fn files<'a>(&self, cx: &'a App) -> &'a Documents {
        self.session.docs.read(cx)
    }
    /// Web hides the workspace chrome on the homepage; so does the native shell.
    fn home_visible(&self, cx: &App) -> bool {
        // A project on its way in takes the window from the Homepage.
        !self.session.project.read(cx).record.fixture
            && !self.file_mode()
            && !self.opening(cx)
            && (self.session.project.read(cx).home || self.files(cx).workspace.is_none())
    }
    /// `RestoringWorkspaceScreen`: while the launch reopens the last Project
    /// the window shows a quiet loading mark, never the Homepage.
    fn restoring(&self, cx: &App) -> bool {
        self.session.project.read(cx).restoring(cx)
    }
    /// A project is on its way into this window.
    fn opening(&self, cx: &App) -> bool {
        self.session.project.read(cx).opening(cx)
    }

    /// The pixel lab's Homepage (`shell-home-*`): no fixture workspace and
    /// no capture of its own. `played` starts after the intro, as if it had
    /// already run; otherwise it plays (held by `PUPPYONE_MOTION_AT`).
    #[cfg(feature = "dev-capture")]
    pub fn lab_home(&mut self, played: bool, cx: &mut Context<Self>) {
        self.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        self.frame.captured = true;
        self.home.update(cx, |h, _| h.lab(played));
        self.sync_session_view(cx);
    }
    /// A dialog takes the window: the dialog layer, or the Documents error.
    fn modal(&self, cx: &App) -> bool {
        // A held-back Cloud conflict is a floating notice, not a dialog.
        !self.dialogs.read(cx).is_empty()
            || (self.files(cx).error.is_some() && !self.files(cx).cloud_conflict())
    }
    /// A notice over everything else; a later one replaces it.
    fn show_error(&mut self, error: impl Into<String>, cx: &mut Context<Self>) {
        let error = error.into();
        self.dialogs.update(cx, |d, cx| d.show_error(error, cx));
    }
    fn open_modal(&mut self, modal: Modal, cx: &mut Context<Self>) {
        self.dialogs.update(cx, |d, cx| d.open(modal, cx));
    }
    /// Closes the window dialogs that match.
    fn close_modal(&mut self, matches: impl Fn(&Modal) -> bool, cx: &mut Context<Self>) {
        self.dialogs
            .update(cx, |d, cx| while d.remove(&matches, cx).is_some() {});
    }
    /// The dialog layer takes the keyboard.
    fn focus_dialogs(&self, window: &mut Window, cx: &mut App) {
        let focus = self.dialogs.read(cx).focus_handle().clone();
        focus.focus(window, cx);
    }
    /// Pumps the documents runtime and hands what came of it to the owners
    /// that show it; then the window may close.
    fn receive(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        crate::platform::watchdog::activity("shell.receive");
        let pumped = self.session.project.update(cx, |p, cx| p.pump(cx));
        self.route_pumped(pumped, window, cx);
        self.push_explorer_host(window, cx);
        self.sync_editor(window, cx);
        self.sync_dialog_status(cx);
        self.sync_session_view(cx);
        self.sync_window_title(window, cx);
        if self.files(cx).allow_quit {
            self.finish_close(window, cx);
        }
    }
    /// The Documents error shows above the dialogs while it is set.
    fn sync_dialog_status(&mut self, cx: &mut Context<Self>) {
        let files = &self.files(cx);
        let status = files.error.clone().filter(|_| !files.cloud_conflict());
        let can_retry = files.can_retry_operation();
        self.dialogs
            .update(cx, |d, cx| d.set_status(status, can_retry, cx));
    }
    /// What the window holds over the editors: a dialog (here or in the
    /// Agent workbench), the Homepage, the appearance.
    fn editor_gate(&self, cx: &App) -> editor_area::EditorGate {
        editor_area::EditorGate {
            modal: self.modal(cx) || self.sidebar.read(cx).workbench.read(cx).dialog_open(),
            home: self.home_visible(cx),
            dark: self.prefs.dark,
        }
    }
    /// The window's gate over the editors changed.
    fn gate_editors(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let gate = self.editor_gate(cx);
        self.editor.update(cx, |e, cx| e.set_gate(gate, window, cx));
    }
    /// The editor area takes the runtime's messages under the window's gate.
    fn sync_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let gate = self.editor_gate(cx);
        let file_mode = self.file_mode();
        self.editor.update(cx, |e, cx| {
            e.set_file_mode(file_mode);
            e.set_gate(gate, window, cx);
            e.sync(window, cx)
        });
    }
    /// The hosted Project this window shows (a Cloud workspace, no local root).
    fn hosted_project(&self, cx: &App) -> Option<String> {
        self.session.project.read(cx).hosted(cx)
    }
    /// The right sidebar is open on `surface`.
    fn right_shows(&self, surface: Surface, cx: &App) -> bool {
        self.sidebar.read(cx).shows(surface, cx)
    }
    /// History out of its scope closes (`useCloudWorkspaceSidebar`).
    fn guard_cloud_history(&mut self, cx: &mut Context<Self>) {
        let project = self.hosted_project(cx);
        self.sidebar
            .update(cx, |s, cx| s.guard_cloud_history(project.as_deref(), cx));
    }
    /// The local project this window shows.
    pub fn workspace_root(&self, cx: &App) -> Option<PathBuf> {
        self.session.project.read(cx).root(cx)
    }
    /// What the Explorer shows of the shell (`Host`), handed over when it
    /// changes: a document opens or closes, the folder picker opens, a pane
    /// opens or closes, the window resizes. The frame is the Explorer's open
    /// plane, which it keeps while its frame moves.
    fn push_explorer_host(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let size = window.viewport_size();
        let (w, h) = (f32::from(size.width), f32::from(size.height));
        let rail = self.chrome.read(cx).rail_width();
        let panes = self.panes.read(cx);
        let host = Host {
            frame: panes.open_plane(Side::Start, w, h, rail),
            open: panes.explorer().open,
            opened: self
                .files(cx)
                .opened()
                .map(|(_, relative)| relative.to_path_buf()),
            open_resources: self.files(cx).open_paths(),
            documents_busy: self.files(cx).busy(),
            folder_busy: self.files(cx).folder_busy,
            picking: self.session.project.read(cx).picking,
        };
        self.explorer
            .view
            .update(cx, |explorer, cx| explorer.set_host(host, cx));
    }
    /// `DesktopSidebarFooterNavigation`: Settings, Help and the busy cue.
    fn footer(&self, cx: &mut Context<Self>) -> SidebarFooter {
        let busy = self.session.project.read(cx).picking
            || self.files(cx).busy()
            || self.files(cx).folder_busy
            || self.explorer.session.read(cx).busy();
        let shell = cx.weak_entity();
        SidebarFooter::new(move |command, window, cx| {
            let _ = shell.update(cx, |s, cx| s.command(command, window, cx));
        })
        .task(self.dialogs.read(cx).task())
        .busy(busy)
    }
    /// The window's title follows the project or the file.
    fn sync_window_title(&mut self, window: &mut Window, cx: &App) {
        let file = self.file.as_ref().map(|f| {
            let target = &f.read(cx).target;
            (
                target.name.clone(),
                target.path.clone(),
                self.files(cx).dirty,
            )
        });
        let root = self.workspace_root(cx);
        let name = self.session.project.read(cx).record.name.clone();
        self.session.apply_title(window, file, root, &name);
    }
    /// The native window cannot be resized below the open panes' minima; a
    /// window already narrower (a pane opened in a small window) widens to
    /// fit, like the product's `setMinimumSize` + `setSize`. Full screen
    /// cannot grow, so the layout keeps its minimum width there.
    fn constrain_window(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // A file window has no panes: the window's own 720 × 520 holds.
        if self.file_mode() {
            return;
        }
        let rail = self.chrome.read(cx).rail_width();
        let Some(minimum) = self.panes.update(cx, |p, _| p.take_window_minimum(rail)) else {
            return;
        };
        let floor = size(px(minimum), px(theme::pane::WINDOW_MIN_HEIGHT));
        crate::native_window::set_content_min_size(window, floor);
        let viewport = window.viewport_size();
        if f32::from(viewport.width) < minimum && !window.is_fullscreen() {
            window.resize(size(px(minimum), viewport.height));
        }
    }
    /// After a frame: a capture's scenario steps (dev builds), and once it
    /// is done the window is captured as it is.
    fn capture_tick(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.frame.captured {
            return;
        }
        #[cfg(feature = "dev-capture")]
        if !self.advance_capture_scenario(window, cx) {
            // The next frame steps again.
            return cx.notify();
        }
        let Some(path) = std::env::var_os("PUPPYONE_SCREENSHOT") else {
            return;
        };
        self.frame.captured = true;
        let layout = self.frame.layout;
        /// The window's regions beside its screenshot.
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Geometry {
            framework: &'static str,
            header: [f32; 4],
            explorer: [f32; 4],
            footer: [f32; 4],
            editor: [f32; 4],
            auxiliary: [f32; 4],
            pixels_per_point: f32,
        }
        let rect = |r: Rect| [r.x, r.y, r.w, r.h];
        let geometry = Geometry {
            framework: "GPUI",
            header: rect(layout.header),
            explorer: rect(layout.explorer),
            footer: rect(layout.footer),
            editor: rect(layout.editor),
            auxiliary: rect(layout.auxiliary),
            pixels_per_point: window.scale_factor(),
        };
        if let Err(error) = crate::capture::schedule(window, cx, PathBuf::from(path), &geometry) {
            self.show_error(error.to_string(), cx);
        }
    }
}
impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::platform::watchdog::activity("shell.render");
        // Native web content draws above GPUI: overlays hide it, and only
        // surfaces painted in this frame stay visible.
        let overlay = !self.dialogs.read(cx).is_empty() || self.chrome.read(cx).popover.is_some();
        crate::web_host::set_overlay(window, overlay);
        crate::web_host::frame_drawn(window);
        #[cfg(test)]
        {
            self.frame.frames += 1;
        }
        let size = window.viewport_size();
        let w = f32::from(size.width);
        let h = f32::from(size.height);
        let rail = self.chrome.read(cx).rail_width();
        let reduce_motion = cx.reduce_motion();
        // This frame's layout (reading it advances the panes' motion).
        let panes = self.panes.read(cx).frames(w, h, rail, reduce_motion);
        self.frame.layout = if self.file_mode() {
            // `.file-mode-window`: the title bar over the document alone.
            Layout::new(w, h, 0., 0., 0.)
        } else {
            panes.layout
        };
        if panes.running {
            window.request_animation_frame();
        }
        // A capture steps its scenario after each frame, then is taken.
        if !self.frame.captured && std::env::var_os("PUPPYONE_SCREENSHOT").is_some() {
            cx.defer_in(window, |s, w, cx| s.capture_tick(w, cx));
        }
        let t = cx.palette();
        // ⌘V on the Homepage takes a template link (`onPaste`); elsewhere a
        // paste belongs to what is focused.
        let homepage = self.home_visible(cx);
        let mut root = div()
            .id("gpui-shell")
            .when(homepage, |d| d.key_context("Homepage"))
            .relative()
            .size_full()
            .font(crate::ui::fonts::font(
                crate::typography::fonts::Role::Ui,
                cx,
            ))
            .text_size(px(theme::font_size(theme::FONT)))
            .text_color(t.text)
            .track_focus(&self.frame.focus);
        let file = self.file_mode();
        let home = self.home_visible(cx);
        // The panes' frames under the editor; the Homepage and a file window
        // show none.
        root = root.child(if file {
            self.file
                .clone()
                .map(|f| f.into_any_element())
                .unwrap_or_else(|| Empty.into_any_element())
        } else {
            let mut stack = PaneStack::new();
            if !home && panes.start.is_some() {
                let (explorer, footer) = (self.frame.layout.explorer, self.frame.layout.footer);
                let plane = Rect::new(
                    explorer.x,
                    explorer.y,
                    explorer.w,
                    footer.bottom() - explorer.y,
                );
                let column =
                    ExplorerColumn::new(self.explorer.view.clone()).footer(self.footer(cx));
                stack = stack.start(plane, column);
            }
            if !home && panes.end.is_some() {
                // The 8px sash overlays the pane edge (`.po-pane-edge-resize-handle`);
                // content starts at the divider like the product's.
                stack = stack.end(self.frame.layout.auxiliary, self.sidebar.clone());
            }
            stack
                .main(at(self.frame.layout.editor).child(self.editor.clone()))
                .into_any_element()
        });
        let weak = cx.weak_entity();
        root = on_shell_actions(root, move |command, window, cx| {
            let _ = weak.update(cx, |s, cx| s.command(command, window, cx));
        });
        // The Homepage, with its intro's curtain over the window under the
        // Header.
        if home {
            root = root.child(self.home.clone());
        }
        if self.chrome.read(cx).rail_shown() && !home && !file {
            root = root.child(self.chrome.read(cx).rail(h, cx));
        }
        let opening = !home && self.opening(cx);
        if opening {
            let explorer = self
                .panes
                .read(cx)
                .explorer()
                .open
                .then_some(self.frame.layout.explorer);
            root = root.children(self.session.project.read(cx).preparation(
                w,
                h,
                explorer,
                self.frame.layout.editor,
                cx,
            ));
        }
        // A file window draws its own title bar.
        if !file {
            root = root.child(at(self.frame.layout.header).child(self.chrome.clone()));
        }
        if !home && !opening && !file {
            root = root.children(panes::edges(&self.panes, &panes, w, rail, window, cx));
        }
        // `FloatingNoticeStack`s over the workspace: its own notices and
        // the editor's (save failure, held-back Cloud conflict).
        if !home && !opening {
            let (editor, end) = (
                self.frame.layout.editor,
                w - self.frame.layout.editor.right(),
            );
            let folder = self.cloud.read(cx).local_folder_notice_view(cx);
            let project = self.session.project.downgrade();
            root = root
                .children(
                    self.session
                        .project
                        .read(cx)
                        .notices(editor, end, folder, project),
                )
                .children(self.editor.read(cx).notices(editor, end, cx));
        }
        let chrome = self.chrome.read(cx);
        root = root.child(chrome.project_actions.clone());
        root = root.child(chrome.coachmarks.clone());
        root.child(self.dialogs.clone())
    }
}

#[cfg(test)]
mod tests;
