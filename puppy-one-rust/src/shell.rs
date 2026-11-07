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
#[cfg(all(test, target_os = "macos"))]
mod bench;
#[cfg(feature = "dev-capture")]
mod capture_scenario;
mod chrome;
mod cloud_agents_ui;
mod cloud_authority;
mod cloud_publish;
pub(crate) mod coachmarks;
mod command;
mod dialogs;
mod editor_area;
mod editor_workbench;
mod explorer;
mod explorer_column;
mod file_mode;
mod footer;
mod header;
mod home;
mod panes;
mod project;
mod project_actions;
mod project_place;
mod right_sidebar;
mod session;
mod share_panel;
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
use explorer_column::ExplorerColumn;
use footer::SidebarFooter;
use panes::{Layout, PaneEvent, PaneLayout, PaneStack, Side};
use right_sidebar::Surface;
/// The layout of a pane embedded as a cached view: it fills the frame the
/// shell places it in. A cached pane renders again only when its entity is
/// notified (or the window refreshes), so editor scrolling and typing do not
/// rebuild the Explorer or the right sidebar.
fn fill() -> StyleRefinement {
    StyleRefinement::default().size_full()
}

/// Header popovers owned by the shell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Popover {
    Project,
    /// `ProjectPlaceMenu`: where the open project is.
    Place,
    /// `CloudWorkspaceShareDialog`: the Share card under its button.
    Share,
    /// `CloudWorkspaceAgentsPanel`: the Agents card under their marks.
    Agents,
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
    capture_scenario: Option<capture_scenario::CaptureScenario>,
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
            weak.update(cx, |s, cx| {
                if s.files(cx).allow_quit {
                    s.prefs.store.read(cx).drained()
                        && !s.dialogs.read(cx).creating(cx)
                        && (windows::count(cx) > 1
                            || !windows::last_close_quits(cx)
                            || crate::features::cloud::account::close_ready(cx))
                } else {
                    s.command(Command::Quit, window, cx);
                    false
                }
            })
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
        let docs = cx.new(|cx| {
            let mut files = if fixture {
                Documents::default()
            } else {
                Documents::native()
            };
            files.task_scope = key.clone();
            session::DocumentSession::new(files, cx)
        });
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
        let catalog = crate::features::cloud::catalog::global(cx);
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
        let project = cx.new(|_| {
            project::ProjectLifecycle::new(
                docs.clone(),
                preferences.clone(),
                project::WindowProject {
                    name: if fixture {
                        "puppyone".into()
                    } else {
                        String::new()
                    },
                    open_first: if cfg!(test) {
                        None
                    } else {
                        std::env::var_os("PUPPYONE_FILE").map(PathBuf::from)
                    },
                    fixture,
                    ..Default::default()
                },
            )
        });
        let cloud = cx.new(|cx| {
            window_cloud::WindowCloud::new(
                preferences.clone(),
                catalog,
                &dialogs,
                focus.clone(),
                window,
                cx,
            )
        });
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
        // A folder's new name names the window that shows it.
        cx.subscribe_in(&project_actions, window, |s, _, event, w, cx| {
            if let project_actions::ActionsEvent::Renamed { path, name } = event
                && s.workspace_root(cx).as_deref() == Some(path.as_path())
            {
                let name = name.clone();
                s.session.project.update(cx, |p, _| p.record.name = name);
                s.sync_session_view(cx);
                s.sync_window_title(w, cx);
            }
            cx.notify();
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
                    capture_scenario::CaptureScenario::from_env()
                },
                #[cfg(test)]
                frames: 0,
            },
        };
        // The workers' news, and what the editor area asks of the window.
        cx.subscribe_in(&s.session.docs, window, |s, _, _: &session::Woke, w, cx| {
            let shown = |s: &Shell, cx: &App| {
                let files = s.files(cx);
                (
                    files.presentation_key(),
                    files.generation,
                    s.session.project.read(cx).record.name.clone(),
                )
            };
            let before = shown(s, cx);
            s.receive(w, cx);
            if shown(s, cx) != before {
                cx.notify();
            }
        })
        .detach();
        cx.subscribe_in(&s.editor, window, |s, _, event, w, cx| match event {
            editor_area::EditorEvent::Command(command) => s.command(*command, w, cx),
            editor_area::EditorEvent::Pump => {
                s.receive(w, cx);
                cx.notify();
            }
        })
        .detach();
        // A file window's title shows its unsaved edits.
        cx.observe_in(&s.editor, window, |s, _, w, cx| {
            s.sync_window_title(w, cx);
            cx.notify()
        })
        .detach();
        // A dialog of the Agent workbench holds the editors too.
        let workbench = s.sidebar.read(cx).workbench.clone();
        cx.observe_in(&workbench, window, |s, _, w, cx| s.gate_editors(w, cx))
            .detach();
        // Captures can start on a task dialog.
        match std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() {
            Ok("settings") => s.open_modal(Modal::Task(Task::Settings), cx),
            Ok("feedback") => s.open_modal(Modal::Task(Task::Feedback), cx),
            _ => {}
        }
        // The folder picker's answer, and the project as it changes.
        cx.subscribe_in(&s.session.project, window, |s, _, event, w, cx| {
            match event {
                project::ProjectEvent::Error(error) => s.show_error(error.clone(), cx),
                project::ProjectEvent::Retry => s.retry_workspace_surface(cx),
                project::ProjectEvent::Picked => {}
            }
            s.receive(w, cx);
            cx.notify();
        })
        .detach();
        cx.observe(&s.session.project, |_, _, cx| cx.notify())
            .detach();
        // What the Homepage and the project actions ask of the window.
        cx.subscribe_in(&s.home, window, |s, _, event, w, cx| {
            s.home_event(event, w, cx)
        })
        .detach();
        cx.observe(&s.home, |_, _, cx| cx.notify()).detach();
        // What the Header and the rail ask of the window.
        cx.subscribe_in(&s.chrome, window, |s, _, event, w, cx| {
            s.chrome_event(event, w, cx)
        })
        .detach();
        cx.observe(&s.chrome, |_, _, cx| cx.notify()).detach();
        // The dialogs' answers, and the window taking the focus back.
        cx.subscribe_in(&s.dialogs, window, |s, _, event, w, cx| {
            s.dialog_event(event, w, cx)
        })
        .detach();
        // The create form holds the window open while it writes.
        cx.observe(&s.dialogs, |s, _, cx| {
            s.session.docs.read(cx).wake().notify();
            cx.notify()
        })
        .detach();
        cx.subscribe_in(
            &s.prefs.store,
            window,
            |s, _, _: &crate::features::settings::preferences_store::PreferencesChanged, w, cx| {
                s.preferences_changed(w, cx);
                s.refresh_cloud_catalog(false, cx);
                // Cloud turned off revokes a hosted selection.
                s.guard_cloud_authority(w, cx);
                if s.session.project.read(cx).record.restore_last {
                    let last = windows::last_active_project(cx);
                    s.session
                        .project
                        .update(cx, |p, cx| p.restore_last(last, cx));
                    s.receive(w, cx);
                }
            },
        )
        .detach();
        cx.observe_window_appearance(window, |s, w, cx| s.apply_appearance(w, cx))
            .detach();
        // An installed Sub Theme can change on disk (`useSubThemeCatalog`).
        if let Some(catalog) = crate::features::sub_theme_catalog::global(cx) {
            cx.observe_in(&catalog, window, |s, _, w, cx| s.apply_appearance(w, cx))
                .detach();
        }
        // What the Explorer's session needs from the workspace.
        cx.subscribe_in(&s.explorer.session, window, |s, _, event, window, cx| {
            match event {
                SessionEvent::ReferencesChanged => {}
                SessionEvent::LoadChildren(path) => s
                    .session
                    .docs
                    .update(cx, |d, _| d.load_children(path.clone())),
                SessionEvent::ResourceOperation(operation) => {
                    if let Err(error) = s
                        .session
                        .docs
                        .update(cx, |d, _| d.resource_operation(operation.clone()))
                    {
                        s.explorer
                            .session
                            .update(cx, |e, cx| e.operation_failed(cx));
                        s.show_error(error, cx);
                    }
                }
                SessionEvent::Error(error) => s.show_error(error.clone(), cx),
                SessionEvent::WatchFailed(error) => s
                    .session
                    .project
                    .update(cx, |p, _| p.record.notice = Some(error.clone())),
                SessionEvent::WatchRecovered => {
                    s.session.project.update(cx, |p, _| p.record.notice = None)
                }
                // `onWorkspaceActivity` → `invalidateGitStatus("working-tree")`.
                SessionEvent::ContentChanged => {
                    s.sidebar
                        .read(cx)
                        .source_control
                        .clone()
                        .update(cx, |sc, cx| sc.invalidate(cx));
                }
            }
            s.receive(window, cx);
            cx.notify();
        })
        .detach();
        // What the person asks for through the Explorer.
        cx.subscribe_in(&s.explorer.view, window, |s, _, event, window, cx| {
            match event {
                ExplorerEvent::Open(path) => s
                    .session
                    .docs
                    .update(cx, |d, _| d.begin(Intent::OpenFile(path.clone()))),
                ExplorerEvent::Create { entry, parent } => {
                    s.start_create(*entry, parent.clone(), window, cx)
                }
                ExplorerEvent::Rename { path, change_type } => s
                    .dialogs
                    .update(cx, |d, cx| d.rename(path.clone(), *change_type, window, cx)),
                ExplorerEvent::Error(error) => s.show_error(error.clone(), cx),
                ExplorerEvent::CopyLink { path, folder } => {
                    s.cloud.update(cx, |c, cx| c.copy_link(path, *folder, cx))
                }
                ExplorerEvent::Share { path } => {
                    s.cloud.update(cx, |c, cx| c.share_folder(path, window, cx))
                }
            }
            s.receive(window, cx);
            cx.notify();
        })
        .detach();
        cx.observe(&s.prefs.store, |s, _, cx| {
            s.session.docs.read(cx).wake().notify();
            cx.notify()
        })
        .detach();
        // The panes move and resize on their own input; the shell stores what
        // the person committed and keeps the window large enough for them.
        cx.observe(&s.panes, |_, _, cx| cx.notify()).detach();
        cx.subscribe_in(&s.panes, window, |s, _, event, window, cx| match event {
            PaneEvent::Committed => s.persist_panes(cx),
            PaneEvent::OpenChanged => {
                s.constrain_window(window, cx);
                s.push_explorer_host(window, cx);
                s.guard_cloud_history(cx);
            }
            PaneEvent::PulledOut => s.sidebar.update(cx, |s, _| s.pulled_out()),
        })
        .detach();
        // The Explorer's frame follows the window; full screen drops the
        // title.
        cx.observe_window_bounds(window, |s, window, cx| {
            s.push_explorer_host(window, cx);
            s.sync_window_title(window, cx);
        })
        .detach();
        // What the right sidebar's surfaces ask of the window.
        cx.subscribe_in(&s.sidebar, window, |s, _, event, w, cx| {
            s.sidebar_event(event, w, cx)
        })
        .detach();
        cx.observe(&s.sidebar, |_, _, cx| cx.notify()).detach();
        // What the Cloud asks of the window.
        cx.subscribe_in(&s.cloud, window, |s, _, event, w, cx| {
            s.cloud_event(event, w, cx)
        })
        .detach();
        cx.observe(&s.cloud, |_, _, cx| cx.notify()).detach();
        // Leaving the window abandons an editor drag (`blur` cancels).
        cx.observe_window_activation(window, |s, window, cx| {
            let active = window.is_window_active();
            s.sidebar
                .read(cx)
                .source_control
                .clone()
                .update(cx, |sc, cx| sc.set_focused(active, cx));
            if !active {
                s.editor.update(cx, |e, cx| e.cancel_gestures(cx));
            } else {
                cx.set_reduce_motion(crate::platform::accessibility::reduce_motion());
                // The catalog refreshes whenever a window regains focus.
                crate::features::sub_theme_catalog::refresh(cx);
                // `browser-window-focus`: bounded foreground activity.
                crate::features::telemetry::note_foreground(cx);
                // A returning window may probe the Cloud association once.
                s.cloud.update(cx, |c, cx| c.probe(cx));
                // A file window watches nothing: the file is read again
                // when the window comes back (FileModeDocument's `focus`).
                if s.file_mode() {
                    s.session.docs.update(cx, |d, _| d.revalidate());
                    s.receive(window, cx);
                    cx.notify();
                }
            }
        })
        .detach();
        // The Homepage disclosure follows the analytics state.
        if let Some(telemetry) = crate::features::telemetry::global(cx) {
            cx.observe(&telemetry, |_, _, cx| cx.notify()).detach();
        }
        let plan = launch.plan(fixture);
        if let Some(open) = plan.open_first {
            s.session
                .project
                .update(cx, |p, _| p.record.open_first = open);
        }
        #[cfg(feature = "dev-capture")]
        capture_scenario::prepare_surface(&mut s, window, cx);
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
    /// The file's folder is the window's root; only the file shows, and it
    /// saves when asked. A file that is gone or too large is never read
    /// (nor one `hold` keeps loading).
    fn bind_file(
        &mut self,
        file: file_mode::FileTarget,
        hold: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.session.docs.update(cx, |d, _| d.file_window = true);
        self.session.project.update(cx, |p, _| p.file_window = true);
        if file.admission == file_mode::Admission::Readable && !hold {
            self.session.project.update(cx, |p, _| {
                p.record.open_first = Some(PathBuf::from(&file.name))
            });
            let root = file.root.clone();
            self.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFolder(root)));
        }
        let (docs, editor) = (self.session.docs.clone(), self.editor.clone());
        let file = cx.new(|cx| file_mode::FileWindow::new(file, docs, editor, cx));
        cx.subscribe_in(&file, window, |s, _, event, w, cx| {
            let file_mode::FileEvent::Command(command) = event;
            s.command(*command, w, cx)
        })
        .detach();
        self.file = Some(file);
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
    /// What the window's features read of the session, handed over when it
    /// changed.
    fn sync_session_view(&mut self, cx: &mut Context<Self>) {
        let files = &self.files(cx);
        let home = self.home_visible(cx);
        let view = session::SessionView {
            home,
            listing: home || self.chrome.read(cx).popover == Some(Popover::Project),
            workspace: files.workspace.is_some(),
            root: self.workspace_root(cx),
            busy: self.session.project.read(cx).picking
                || files.busy()
                || files.folder_busy
                || files.cloud_opening().is_some(),
            cloud_opening: files.cloud_opening().is_some(),
            restoring: self.restoring(cx),
            name: self.session.project.read(cx).record.name.clone(),
            cloud_project: self.session.project.read(cx).record.cloud.clone(),
            hosted: self.hosted_project(cx),
            opening: self.opening(cx),
            file_mode: self.file_mode(),
            home_requested: self.session.project.read(cx).home,
            entries: self.session.project.read(cx).record.entries,
            fixture: self.session.project.read(cx).record.fixture,
        };
        self.home
            .update(cx, |h, cx| h.set_session(view.clone(), cx));
        self.chrome
            .update(cx, |c, cx| c.set_session(view.clone(), cx));
        let popover = self.chrome.read(cx).popover;
        self.cloud.update(cx, |c, cx| {
            c.set_session(view, cx);
            c.set_popover(popover, cx);
        });
        self.guard_cloud_history(cx);
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
        if let Some((path, message)) = pumped.failure {
            self.close_modal(|m| matches!(m, Modal::ProjectFailure { .. }), cx);
            self.open_modal(Modal::ProjectFailure { path, message }, cx);
        }
        // A Cloud opening that failed says why (`ProjectNavigationFailure`).
        if let Some((project, failure)) = pumped.cloud_failure {
            self.cloud
                .update(cx, |c, cx| c.show_recovery(project, failure, cx));
        }
        // `finishInterceptedClose`: a close a document could not finish asks
        // whether to keep the window or close anyway, instead of the error.
        if pumped.close_refused {
            if !self
                .dialogs
                .read(cx)
                .iter()
                .any(|m| matches!(m, Modal::CloseAnyway))
            {
                self.open_modal(Modal::CloseAnyway, cx);
            }
            self.focus_dialogs(window, cx);
        }
        for (owner, outcome) in pumped.operations {
            self.explorer
                .session
                .update(cx, |e, cx| e.finish_op(&owner, outcome, cx));
        }
        if let Some((ws, nodes)) = pumped.entered {
            self.editor.update(cx, |e, cx| e.cancel_gestures(cx));
            self.explorer
                .session
                .update(cx, |e, cx| e.load_workspace(ws.clone(), nodes, cx));
            if self.file_mode() {
                // A lone file has no Agent, Git or Terminal.
            } else if let Some(root) = ws.local_root() {
                self.sidebar
                    .read(cx)
                    .workbench
                    .clone()
                    .update(cx, |s, cx| s.set_workspace(root.to_owned(), cx));
                self.sidebar
                    .read(cx)
                    .source_control
                    .clone()
                    .update(cx, |s, cx| s.set_workspace(root.to_owned(), cx));
            } else if let Some(target) = ws.agent_target() {
                // `CloudAgentSidebar`: the hosted Agent, not this machine's.
                self.sidebar
                    .read(cx)
                    .workbench
                    .clone()
                    .update(cx, |s, cx| s.set_cloud_workspace(target, cx));
            }
            self.close_modal(|m| matches!(m, Modal::Error(_)), cx);
            let root = ws.local_root().map(PathBuf::from);
            self.dialogs.update(cx, |d, cx| d.set_root(root, cx));
        }
        if let Some((path, result)) = pumped.children {
            self.explorer
                .session
                .update(cx, |e, cx| e.children_loaded(&path, result, cx));
        }
        if let Some(relative) = pumped.revealed {
            self.explorer
                .session
                .update(cx, |e, cx| e.reveal(&relative, cx));
        }
        self.push_explorer_host(window, cx);
        self.sync_editor(window, cx);
        self.sync_dialog_status(cx);
        self.sync_session_view(cx);
        self.sync_window_title(window, cx);
        if self.files(cx).allow_quit && self.dialogs.read(cx).creating(cx) {
            return;
        }
        if self.files(cx).allow_quit && !self.prefs.store.read(cx).drained() {
            if let Some(error) = self.prefs.store.read(cx).error.clone() {
                self.show_error(error, cx);
                self.session.docs.update(cx, |d, _| d.cancel_quit());
                windows::cancel_quit(cx);
                self.sync_editor(window, cx);
            }
            return;
        }
        if self.files(cx).allow_quit {
            // The account owner is process-wide: only the app's end drains
            // it; closing one of several windows (or, on macOS, the last
            // one) leaves it running.
            if windows::count(cx) <= 1 && windows::last_close_quits(cx) {
                match crate::features::cloud::account::prepare_close(cx) {
                    Ok(true) => {}
                    Ok(false) => return,
                    Err(error) => {
                        self.session.docs.update(cx, |d, _| d.cancel_quit());
                        windows::cancel_quit(cx);
                        self.sync_editor(window, cx);
                        self.show_error(error.to_string(), cx);
                        return;
                    }
                }
            }
            let workbench = self.sidebar.read(cx).workbench.clone();
            workbench.update(cx, |s, cx| s.shutdown(cx));
            // Window retirement blocks new editor allocations and waits for
            // this window's admitted tasks to confirm their exit.
            let scheduler = crate::platform::tasks::Scheduler::global();
            let _hold = scheduler.hold_admission();
            let _ = scheduler.retire(&self.session.key, None, None);
            windows::unregister(window.window_handle(), cx);
            window.remove_window();
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
    /// Store the committed pane layout (`setExplorerWidth`,
    /// `setSidebarCollapsed`, `setRightSidebarWidth`).
    fn persist_panes(&mut self, cx: &mut Context<Self>) {
        let stored = self.panes.read(cx).stored();
        self.prefs.store.update(cx, |store, cx| {
            store.change(
                |p| {
                    p.sidebar_collapsed = stored.explorer_collapsed;
                    p.explorer_width = stored.explorer_width;
                    p.right_sidebar_width = stored.right_width;
                },
                cx,
            )
        });
    }
}
impl Shell {
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
        let panes = self
            .panes
            .update(cx, |p, _| p.frames(w, h, rail, reduce_motion));
        self.frame.layout = if self.file_mode() {
            // `.file-mode-window`: the title bar over the document alone.
            Layout::new(w, h, 0., 0., 0.)
        } else {
            panes.layout
        };
        if panes.running {
            window.request_animation_frame();
        }
        #[cfg(feature = "dev-capture")]
        let scenario_done = self.advance_capture_scenario(window, cx);
        #[cfg(not(feature = "dev-capture"))]
        let scenario_done = true;
        if !self.frame.captured
            && scenario_done
            && let Some(path) = std::env::var_os("PUPPYONE_SCREENSHOT")
        {
            self.frame.captured = true;
            let rect = |r: Rect| [r.x, r.y, r.w, r.h];
            let geometry = serde_json::json!({"framework":"GPUI","header":rect(self.frame.layout.header),"explorer":rect(self.frame.layout.explorer),"footer":rect(self.frame.layout.footer),"editor":rect(self.frame.layout.editor),"auxiliary":rect(self.frame.layout.auxiliary),"pixelsPerPoint":window.scale_factor()});
            if let Err(error) = crate::capture::schedule(window, cx, PathBuf::from(path), geometry)
            {
                self.show_error(error.to_string(), cx);
            }
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
impl Shell {}

#[cfg(test)]
mod tests;
