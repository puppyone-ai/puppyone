use crate::{
    documents::Intent,
    editor::workbench::runtime::Runtime as Documents,
    geometry::Rect,
    localization::Locale,
    theme::{self, Theme},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use std::path::PathBuf;
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
use crate::features::settings::preferences_store::Slice;
use command::on_shell_actions;
pub use command::{
    Command, app_menus, bind_keys, dock_menu, on_app_actions, on_global_shell_actions,
};
use dialogs::{DialogEvent, DialogKey, DialogLayer, Modal, Task};
pub(crate) use dialogs::{settings_dialog, task_backdrop};
use explorer::{Explorer, ExplorerEvent, ExplorerSession, Host, SessionEvent};
use explorer_column::ExplorerColumn;
use footer::SidebarFooter;
use panes::{Layout, PaneEvent, PaneLayout, PaneStack, Side, StoredPanes};
use right_sidebar::Surface;
/// The layout of a pane embedded as a cached view: it fills the frame the
/// shell places it in. A cached pane renders again only when its entity is
/// notified (or the window refreshes), so editor scrolling and typing do not
/// rebuild the Explorer or the right sidebar.
fn fill() -> StyleRefinement {
    StyleRefinement::default().size_full()
}

/// What the process-wide appearance is projected from: a change to any of
/// these renders the whole window again; nothing else does.
#[derive(Clone, PartialEq)]
struct AppearanceInputs {
    theme_mode: crate::features::settings::preference_types::ThemeMode,
    sub_theme_ids: crate::features::settings::preference_types::SubThemeIds,
    text_scale: crate::typography::Scale,
    fonts: crate::typography::fonts::Selection,
    pointer_cursors: bool,
    loading_style: crate::ui::loading::LoadingStyle,
    locale: String,
}
impl AppearanceInputs {
    fn of(p: &crate::features::settings::preference_types::Preferences) -> Self {
        Self {
            theme_mode: p.theme_mode,
            sub_theme_ids: p.sub_theme_ids.clone(),
            text_scale: p.text_scale,
            fonts: p.fonts.clone(),
            pointer_cursors: p.pointer_cursors,
            loading_style: p.loading_style,
            locale: p.locale.clone(),
        }
    }
}
/// The parts of the preferences the shell projects only when they change.
#[derive(Default)]
struct PreferenceSlices {
    appearance: Slice<AppearanceInputs>,
    panes: Slice<StoredPanes>,
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
    /// The documents runtime, the owner key and the applied title.
    session: session::WindowSession,
    /// The project this window shows and how it came to show it.
    project: Entity<project::ProjectLifecycle>,
    /// The window's Cloud: catalog, association, publication, Agents, Share.
    cloud: Entity<window_cloud::WindowCloud>,
    /// The Header, its popovers, the project rail and the introductions.
    chrome: Entity<chrome::WindowChrome>,
    dark: bool,
    locale: Locale,
    /// The Explorer's and the right sidebar's frames: open, width, edge
    /// drags and motion.
    panes: Entity<PaneLayout>,
    /// Window dialogs, bottom to top, and the Settings and Help content.
    dialogs: Entity<DialogLayer>,
    /// What the right sidebar shows: the Agent workbench, Changes / History
    /// and a hosted Project's History.
    sidebar: Entity<right_sidebar::RightSidebar>,
    /// A file window's own state (File Mode); `None` for a project window.
    pub(super) file: Option<Entity<file_mode::FileWindow>>,
    weak: WeakEntity<Shell>,
    /// The project's Explorer session (its tree, selection, clipboard and
    /// pins, kept per project) and its view on the left.
    explorer_session: Entity<ExplorerSession>,
    explorer: Entity<Explorer>,
    home: Entity<home::Homepage>,
    preferences: Entity<crate::features::settings::preferences_store::PreferencesStore>,
    preference_slices: PreferenceSlices,
    /// The editor area's hosts, drops, resizes and save notices.
    editor: Entity<editor_area::EditorArea>,
    focus: FocusHandle,
    captured: bool,
    /// Where everything sits this frame (pane motion included).
    layout: Layout,
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
                    s.preferences.read(cx).drained()
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
        cx.subscribe(&project_actions, |s, _, event, cx| {
            if let project_actions::ActionsEvent::Renamed { path, name } = event
                && s.workspace_root(cx).as_deref() == Some(path.as_path())
            {
                let name = name.clone();
                s.project.update(cx, |p, _| p.record.name = name);
                s.sync_session_view(cx);
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
            project,
            session: session::WindowSession {
                docs,
                key: key.clone(),
                title: None,
            },
            cloud,
            chrome,
            dark: std::env::var("PUPPYONE_THEME").as_deref() != Ok("light"),
            locale: Locale::default(),
            panes,
            dialogs,
            sidebar,
            file: None,
            weak: cx.weak_entity(),
            explorer_session: explorer_session.clone(),
            explorer: {
                let owner = crate::features::agent_presence::owner(window);
                cx.new(|cx| {
                    Explorer::new(explorer_session, preferences.clone(), cx)
                        .with_presence_owner(owner)
                })
            },
            home,
            preferences,
            preference_slices: Default::default(),
            editor,
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
        };
        // The workers' news, and what the editor area asks of the window.
        cx.subscribe_in(&s.session.docs, window, |s, _, _: &session::Woke, w, cx| {
            let shown = |s: &Shell, cx: &App| {
                let files = s.files(cx);
                (
                    files.presentation_key(),
                    files.generation,
                    s.project.read(cx).record.name.clone(),
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
        cx.observe(&s.editor, |_, _, cx| cx.notify()).detach();
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
        cx.subscribe_in(&s.project, window, |s, _, event, w, cx| {
            if let project::ProjectEvent::Error(error) = event {
                s.show_error(error.clone(), cx);
            }
            s.receive(w, cx);
            cx.notify();
        })
        .detach();
        cx.observe(&s.project, |_, _, cx| cx.notify()).detach();
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
            &s.preferences,
            window,
            |s, _, _: &crate::features::settings::preferences_store::PreferencesChanged, w, cx| {
                s.preferences_changed(w, cx);
                s.refresh_cloud_catalog(false, cx);
                // Cloud turned off revokes a hosted selection.
                s.guard_cloud_authority(w, cx);
                if s.project.read(cx).record.restore_last {
                    let last = windows::last_active_project(cx);
                    s.project.update(cx, |p, cx| p.restore_last(last, cx));
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
        cx.subscribe_in(&s.explorer_session, window, |s, _, event, window, cx| {
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
                        s.explorer_session
                            .update(cx, |e, cx| e.operation_failed(cx));
                        s.show_error(error, cx);
                    }
                }
                SessionEvent::Error(error) => s.show_error(error.clone(), cx),
                SessionEvent::WatchFailed(error) => s
                    .project
                    .update(cx, |p, _| p.record.notice = Some(error.clone())),
                SessionEvent::WatchRecovered => s.project.update(cx, |p, _| p.record.notice = None),
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
        cx.subscribe_in(&s.explorer, window, |s, _, event, window, cx| {
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
        cx.observe(&s.preferences, |s, _, cx| {
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
        // The Explorer's frame follows the window.
        cx.observe_window_bounds(window, |s, window, cx| s.push_explorer_host(window, cx))
            .detach();
        let settings = s.dialogs.read(cx).settings.clone();
        cx.subscribe_in(&settings, window, |s, _, event, w, cx| {
            use crate::features::settings::SettingsEvent;
            match event {
                SettingsEvent::Close => s.close_tasks(cx),
                SettingsEvent::ModelConfigurationChanged => s
                    .sidebar
                    .read(cx)
                    .workbench
                    .clone()
                    .update(cx, |s, cx| s.reload_agent_configuration(cx)),
                SettingsEvent::ForgetProject(path) => {
                    let path = path.clone();
                    s.preferences
                        .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
                    s.close_tasks(cx);
                    if s.files(cx)
                        .workspace
                        .as_ref()
                        .is_some_and(|ws| ws.local_root() == Some(path.as_path()))
                    {
                        s.command(Command::Home, w, cx);
                    }
                }
            }
            cx.notify();
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
        let own = window.window_handle();
        // Dev builds replay the Homepage intro (Alt+Shift+L, `KeyL`).
        if cfg!(debug_assertions) {
            let shell = cx.weak_entity();
            cx.intercept_keystrokes(move |event, window, cx| {
                let k = &event.keystroke;
                if window.window_handle() != own
                    || !k.key.eq_ignore_ascii_case("l")
                    || !k.modifiers.alt
                    || !k.modifiers.shift
                    || k.modifiers.platform
                    || k.modifiers.control
                {
                    return;
                }
                let _ = shell.update(cx, |s, cx| {
                    if s.home.update(cx, |h, cx| h.replay_intro(cx)) {
                        cx.stop_propagation();
                    }
                });
            })
            .detach();
        }
        // The Homepage disclosure follows the analytics state.
        if let Some(telemetry) = crate::features::telemetry::global(cx) {
            cx.observe(&telemetry, |_, _, cx| cx.notify()).detach();
        }
        let mut workspace = if cfg!(test) || !launch.from_args {
            launch.workspace.clone()
        } else {
            std::env::var_os("PUPPYONE_WORKSPACE").map(PathBuf::from)
        };
        // `findLaunchTargetArg`: the first window opens the folder the
        // command line names (a named file has its own window, from main).
        if !cfg!(test) && launch.from_args {
            let cwd = std::env::current_dir().unwrap_or_default();
            let parsed = windows::parse_launch_args(std::env::args_os().skip(1), &cwd);
            s.project
                .update(cx, |p, _| p.record.open_first = parsed.open);
            if let Some(path) = parsed.target.filter(|p| p.is_dir()) {
                workspace = Some(path);
            }
        }
        #[cfg(feature = "dev-capture")]
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
        // Dev captures open a file window with `PUPPYONE_FILE_MODE`.
        #[cfg(feature = "dev-capture")]
        let file = launch.file.clone().or_else(|| {
            // A path that is not there opens on the unavailable state.
            std::env::var_os("PUPPYONE_FILE_MODE")
                .filter(|_| launch.from_args)
                .map(PathBuf::from)
                .map(|p| p.canonicalize().unwrap_or(p))
        });
        #[cfg(not(feature = "dev-capture"))]
        let file = launch.file.clone();
        if let Some(file) = file.and_then(file_mode::FileTarget::of) {
            #[cfg(feature = "dev-capture")]
            let hold = std::env::var_os("PUPPYONE_FILE_HOLD").is_some();
            #[cfg(not(feature = "dev-capture"))]
            let hold = false;
            s.bind_file(file, hold, window, cx);
        } else if let Some(path) = workspace {
            if launch.open.is_some() {
                s.project
                    .update(cx, |p, _| p.record.open_first = launch.open.clone());
            }
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFolder(path)));
        } else if launch.from_args && !fixture && !cfg!(test) {
            // `readLastActiveWorkspaceComposition`: the last active project.
            s.project.update(cx, |p, _| p.record.restore_last = true);
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
        crate::ui::appearance::Appearance::default()
            .with_dark(s.dark)
            .apply(Some(window), cx);
        s.constrain_window(window, cx);
        s.push_explorer_host(window, cx);
        // What the window shows from its first frame.
        s.sync_session_view(cx);
        s
    }
    /// The preferences changed. Only a change to appearance, type scale or
    /// locale renders the whole window again; every other reader takes its
    /// own part, and the pane layout arrives only when it changed.
    fn preferences_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let appearance = AppearanceInputs::of(&self.preferences.read(cx).state);
        if self
            .preference_slices
            .appearance
            .changed(appearance)
            .is_some()
        {
            self.apply_appearance(window, cx);
        }
        self.apply_projections(cx);
    }
    /// Project persisted appearance/locale preferences onto the process-wide
    /// theme, type scale and catalog. `System` follows the window appearance.
    fn apply_appearance(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        use crate::features::settings::preference_types::ThemeMode;
        let p = self.preferences.read(cx).state.clone();
        self.dark = match p.theme_mode {
            ThemeMode::Dark => true,
            ThemeMode::Light => false,
            ThemeMode::System => matches!(
                window.appearance(),
                WindowAppearance::Dark | WindowAppearance::VibrantDark
            ),
        };
        // Captures pin the appearance (`PUPPYONE_THEME=light|dark`).
        if let Ok(theme) = std::env::var("PUPPYONE_THEME")
            && std::env::var_os("PUPPYONE_SCREENSHOT").is_some()
        {
            self.dark = theme != "light";
        }
        let mut scale = p.text_scale;
        // Captures pin the text size (`PUPPYONE_TEXT_SCALE=small|medium|large`).
        if std::env::var_os("PUPPYONE_SCREENSHOT").is_some() {
            match std::env::var("PUPPYONE_TEXT_SCALE").as_deref() {
                Ok("small") => scale = crate::typography::Scale::Small,
                Ok("large") => scale = crate::typography::Scale::Large,
                Ok("medium") => scale = crate::typography::Scale::Medium,
                _ => {}
            }
        }
        let sub_theme = crate::features::sub_theme_catalog::effective(
            p.sub_theme_ids.get(self.dark),
            self.dark,
            cx,
        );
        crate::ui::appearance::Appearance::new(self.dark, &sub_theme, scale, p.pointer_cursors)
            .with_loading(p.loading_style)
            .with_fonts(p.fonts.normalized())
            .apply(Some(window), cx);
        let code = crate::localization::resolve_preference(
            &p.locale,
            crate::platform::environment::system_languages(),
        );
        crate::localization::set_current(code);
        let theme_menu = crate::features::sub_theme_catalog::sync_menu(
            p.sub_theme_ids.get(self.dark),
            self.dark,
            cx,
        );
        if self.locale.set(code) | theme_menu {
            cx.set_menus(app_menus());
        }
        // Appearance, type scale and locale are process-wide: the cached
        // panes (Explorer, workbench, Changes) read them while rendering, so
        // the whole window renders again.
        window.refresh();
        self.gate_editors(window, cx);
    }
    /// The parts of the preferences other owners read, handed to them; each
    /// takes only a change (nothing here renders the window again).
    fn apply_projections(&mut self, cx: &mut Context<Self>) {
        let p = self.preferences.read(cx).state.clone();
        // The built-in Agent offers PuppyOne compute only while Payments is on.
        crate::cloud::auth::set_payments(p.experimental.payments);
        crate::editor::markdown::core::commands::block_move::set_enabled(
            p.experimental.markdown_block_drag,
        );
        // The pane layout (`useDesktopExplorerFrame`), only when it changed:
        // this window's own commits arrive back here as no change.
        let stored = StoredPanes {
            explorer_collapsed: p.sidebar_collapsed,
            explorer_width: p.explorer_width,
            right_width: p.right_sidebar_width,
        };
        if let Some(stored) = self.preference_slices.panes.changed(stored) {
            let stored = *stored;
            self.panes.update(cx, |p, cx| p.restore(stored, cx));
        }
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
        if file.admission == file_mode::Admission::Readable && !hold {
            self.project.update(cx, |p, _| {
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
        !self.project.read(cx).record.fixture
            && !self.file_mode()
            && !self.opening(cx)
            && (self.project.read(cx).home || self.files(cx).workspace.is_none())
    }
    /// `RestoringWorkspaceScreen`: while the launch reopens the last Project
    /// the window shows a quiet loading mark, never the Homepage.
    fn restoring(&self, cx: &App) -> bool {
        self.project.read(cx).restoring(cx)
    }
    /// A project is on its way into this window.
    fn opening(&self, cx: &App) -> bool {
        self.project.read(cx).opening(cx)
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
            busy: self.project.read(cx).picking
                || files.busy()
                || files.folder_busy
                || files.cloud_opening().is_some(),
            cloud_opening: files.cloud_opening().is_some(),
            restoring: self.restoring(cx),
            name: self.project.read(cx).record.name.clone(),
            cloud_project: self.project.read(cx).record.cloud.clone(),
            hosted: self.hosted_project(cx),
            opening: self.opening(cx),
            file_mode: self.file_mode(),
            home_requested: self.project.read(cx).home,
            entries: self.project.read(cx).record.entries,
            fixture: self.project.read(cx).record.fixture,
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
    /// The Header card or menu that is open: one at a time.
    fn set_popover(&mut self, popover: Option<Popover>, cx: &mut Context<Self>) {
        if self.chrome.read(cx).popover != popover {
            // Share opens on a snapshot of what is open.
            if popover == Some(Popover::Share) {
                let resource = match self.explorer_session.read(cx).selected_folder() {
                    Some(folder) => Some((folder.to_string_lossy().into_owned(), true)),
                    None => self
                        .files(cx)
                        .opened()
                        .map(|(_, relative)| (relative.to_string_lossy().into_owned(), false)),
                };
                self.cloud
                    .update(cx, |c, cx| c.snapshot_share_panel(resource, cx));
            }
            self.chrome.update(cx, |c, cx| c.set_popover(popover, cx));
            self.sync_session_view(cx);
            cx.notify();
        }
    }
    /// What the Header and the rail ask of the window.
    fn chrome_event(
        &mut self,
        event: &chrome::ChromeEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use chrome::ChromeEvent;
        match event {
            ChromeEvent::Command(command) => self.command(*command, window, cx),
            ChromeEvent::Popover(popover) => self.set_popover(*popover, cx),
            ChromeEvent::OpenItem(item) => self.open_item(item, window, cx),
            ChromeEvent::OpenProject(path) => self.open_project(path.clone(), window, cx),
            ChromeEvent::RefreshCatalog => self.refresh_cloud_catalog(true, cx),
            ChromeEvent::OpenSettings(page) => self.open_settings(*page, window, cx),
            // The project rail takes room from the panes.
            ChromeEvent::RailChanged => {
                self.constrain_window(window, cx);
                self.push_explorer_host(window, cx);
            }
        }
    }
    /// What the Cloud asks of the window.
    fn cloud_event(
        &mut self,
        event: &window_cloud::CloudEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use window_cloud::CloudEvent;
        match event {
            CloudEvent::OpenProject(path) => return self.open_project(path.clone(), window, cx),
            CloudEvent::OpenCloud(project) => self.open_cloud(project.clone(), cx),
            CloudEvent::Command(command) => return self.command(*command, window, cx),
            CloudEvent::OpenSettings(page) => return self.open_settings(*page, window, cx),
            CloudEvent::Popover(popover) => return self.set_popover(*popover, cx),
            CloudEvent::Error(error) => self.show_error(error.clone(), cx),
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// `closeWorkspaceSidebars`: collapse the right sidebar and release the
    /// focus it held; drafts, widths and sessions stay.
    fn close_workspace_sidebars(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.sidebar.update(cx, |s, cx| s.collapse(cx));
        self.set_popover(None, cx);
        self.focus.focus(window, cx);
    }
    /// The hosted Project's authority: when it no longer holds, the opening
    /// in flight is cancelled and a Cloud project on screen leaves for the
    /// Homepage.
    pub(super) fn guard_cloud_authority(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let current = if crate::features::flags::cloud_enabled(&self.preferences, cx) {
            cloud_authority::account_key(cx)
        } else {
            None
        };
        let Some(hosted) = self
            .project
            .update(cx, |p, cx| p.revoke_authority(current, cx))
        else {
            return;
        };
        if self.chrome.read(cx).popover == Some(Popover::Share) {
            self.set_popover(None, cx);
        }
        if hosted {
            self.close_workspace_sidebars(window, cx);
            self.receive(window, cx);
        }
        cx.notify();
    }

    /// What the Homepage asks for.
    fn home_event(&mut self, event: &home::HomeEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            home::HomeEvent::OpenProject(path) => {
                return self.open_project(path.clone(), window, cx);
            }
            home::HomeEvent::OpenCloud(project) => {
                self.set_popover(None, cx);
                self.open_cloud(project.clone(), cx);
            }
            home::HomeEvent::OpenCreated {
                path,
                open,
                new_window,
            } => {
                let (path, open) = (path.clone(), open.clone());
                if *new_window {
                    cx.defer(move |cx| {
                        if let Err(error) = windows::open_created(path, open, cx) {
                            eprintln!("Could not open the new window: {error:#}");
                        }
                    });
                    return;
                }
                self.set_popover(None, cx);
                self.project
                    .update(cx, |p, cx| p.open_created(path, open, cx));
            }
            home::HomeEvent::Command(command) => return self.command(*command, window, cx),
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// Opens an entry of the Header's project menu in this window: a local
    /// folder, or a Cloud project (`selectCloudProject`).
    fn open_item(
        &mut self,
        item: &crate::workspace::cloud::catalog::Item,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_popover(None, cx);
        match (&item.local_path, &item.cloud_project) {
            (Some(path), _) => self.open_project(PathBuf::from(path), window, cx),
            (None, Some(project)) => self.open_cloud(project.clone(), cx),
            _ => {}
        }
        cx.notify();
    }
    /// The pixel lab's Homepage (`shell-home-*`): no fixture workspace and
    /// no capture of its own. `played` starts after the intro, as if it had
    /// already run; otherwise it plays (held by `PUPPYONE_MOTION_AT`).
    #[cfg(feature = "dev-capture")]
    pub fn lab_home(&mut self, played: bool, cx: &mut Context<Self>) {
        self.project.update(cx, |p, _| p.record.fixture = false);
        self.captured = true;
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
    /// The Settings page `page`, opened.
    fn open_settings(
        &mut self,
        page: crate::features::settings::Page,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let settings = self.dialogs.read(cx).settings.clone();
        settings.update(cx, |settings, cx| settings.select_page(page, cx));
        self.command(Command::Settings, window, cx);
    }
    /// What the dialog layer asks of the window.
    fn dialog_event(&mut self, event: &DialogEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            DialogEvent::Command(command) => return self.command(*command, window, cx),
            DialogEvent::Closed => self.focus.focus(window, cx),
            DialogEvent::Error(error) => {
                self.show_error(error.clone(), cx);
                self.focus.focus(window, cx);
            }
            DialogEvent::Rename { path, name } => {
                let (path, name) = (path.clone(), name.clone());
                self.explorer_session
                    .update(cx, |session, cx| session.rename(path, name, cx));
                self.focus.focus(window, cx);
            }
            DialogEvent::Created {
                workspace,
                parent,
                path,
                folder,
                nodes,
            } => {
                self.focus.focus(window, cx);
                if !self
                    .files(cx)
                    .workspace
                    .as_ref()
                    .is_some_and(|ws| std::sync::Arc::ptr_eq(ws, workspace))
                {
                    return;
                }
                if let Err(error) = nodes {
                    self.show_error(
                        crate::localization::tf(
                            "native.create.refreshFailed",
                            &[("error", error.to_string().into())],
                        ),
                        cx,
                    );
                }
                let listing = nodes.as_ref().ok().cloned();
                let (parent, path) = (parent.clone(), path.clone());
                self.explorer_session
                    .update(cx, |e, cx| e.entry_created(&parent, listing, &path, cx));
                if !folder && !self.files(cx).allow_quit {
                    self.session
                        .docs
                        .update(cx, |d, _| d.begin(Intent::OpenFile(path)))
                }
            }
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// Open the create form for `kind` in `parent` (the Explorer's menus).
    fn start_create(
        &mut self,
        kind: crate::features::create_new::create_entry_menu_registry::Entry,
        parent: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(ws) = self.files(cx).workspace.clone() else {
            return;
        };
        if self.files(cx).busy() || self.modal(cx) || !kind.available() {
            return;
        }
        self.dialogs
            .update(cx, |d, cx| d.create_entry(ws, parent, kind, window, cx));
    }
    /// Pumps the documents runtime and hands what came of it to the owners
    /// that show it; then the window may close.
    fn receive(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        crate::platform::watchdog::activity("shell.receive");
        let pumped = self.project.update(cx, |p, cx| p.pump(cx));
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
            self.explorer_session
                .update(cx, |e, cx| e.finish_op(&owner, outcome, cx));
        }
        if let Some((ws, nodes)) = pumped.entered {
            self.editor.update(cx, |e, cx| e.cancel_gestures(cx));
            self.explorer_session
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
            self.explorer_session
                .update(cx, |e, cx| e.children_loaded(&path, result, cx));
        }
        if let Some(relative) = pumped.revealed {
            self.explorer_session
                .update(cx, |e, cx| e.reveal(&relative, cx));
        }
        self.push_explorer_host(window, cx);
        self.sync_editor(window, cx);
        self.sync_dialog_status(cx);
        self.sync_session_view(cx);
        if self.files(cx).allow_quit && self.dialogs.read(cx).creating(cx) {
            return;
        }
        if self.files(cx).allow_quit && !self.preferences.read(cx).drained() {
            if let Some(error) = self.preferences.read(cx).error.clone() {
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
            dark: self.dark,
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
    /// `useHomepageCloudProjects`: load or revalidate the account catalog.
    pub(super) fn refresh_cloud_catalog(&mut self, retry: bool, cx: &mut Context<Self>) {
        self.cloud.update(cx, |c, cx| c.refresh_catalog(retry, cx));
    }
    /// The hosted Project this window shows (a Cloud workspace, no local root).
    fn hosted_project(&self, cx: &App) -> Option<String> {
        self.project.read(cx).hosted(cx)
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
    /// What the right sidebar's surfaces ask of the window.
    fn sidebar_event(
        &mut self,
        event: &right_sidebar::SidebarEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use right_sidebar::SidebarEvent;
        match event {
            SidebarEvent::OpenFile(path) => {
                let path = path.clone();
                self.session
                    .docs
                    .update(cx, |d, _| d.begin(Intent::OpenFile(path)));
            }
            // `handleAgentOpenFile`: a path inside the chat's project opens
            // in the editor.
            SidebarEvent::OpenAgentFile { root, path } => {
                use crate::features::desktop_agent::domain::agent_workspace_path::resolve_agent_workspace_provider_path as resolve;
                if let Some(path) = resolve(&root.to_string_lossy(), path) {
                    let path = root.join(path);
                    self.session
                        .docs
                        .update(cx, |d, _| d.begin(Intent::OpenFile(path)));
                }
                return cx.notify();
            }
            SidebarEvent::OpenSettings(page) => return self.open_settings(*page, window, cx),
            // A hosted run's accepted changes: reread the Cloud tree and
            // revalidate the open document (a draft is kept).
            SidebarEvent::CloudPublished => {
                if self.hosted_project(cx).is_none() {
                    return;
                }
                self.explorer_session
                    .update(cx, |e, cx| e.refresh_published(cx));
                self.session.docs.update(cx, |d, _| d.observe_publication());
            }
            SidebarEvent::Closed => self.focus.focus(window, cx),
        }
        self.receive(window, cx);
        cx.notify();
    }
    pub(super) fn open_cloud(&mut self, project: String, cx: &mut Context<Self>) {
        if let Err(error) = self.project.update(cx, |p, cx| p.open_cloud(project, cx)) {
            self.show_error(error, cx);
        }
        cx.notify();
    }
    /// The local project this window shows.
    pub fn workspace_root(&self, cx: &App) -> Option<PathBuf> {
        self.project.read(cx).root(cx)
    }
    /// Switch to a remembered project (`onSelectProject`).
    pub(super) fn open_project(
        &mut self,
        path: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_popover(None, cx);
        self.project.update(cx, |p, cx| p.open_project(path, cx));
        self.receive(window, cx);
        cx.notify();
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
            picking: self.project.read(cx).picking,
        };
        self.explorer
            .update(cx, |explorer, cx| explorer.set_host(host, cx));
    }
    /// `DesktopSidebarFooterNavigation`: Settings, Help and the busy cue.
    fn footer(&self, cx: &mut Context<Self>) -> SidebarFooter {
        let busy = self.project.read(cx).picking
            || self.files(cx).busy()
            || self.files(cx).folder_busy
            || self.explorer_session.read(cx).busy();
        let shell = cx.weak_entity();
        SidebarFooter::new(move |command, window, cx| {
            let _ = shell.update(cx, |s, cx| s.command(command, window, cx));
        })
        .task(self.dialogs.read(cx).task())
        .busy(busy)
    }
    /// `resolveWindowTitle`: "PuppyOne - <project>" with the folder as the
    /// represented file; nothing in full screen, where macOS shows it.
    /// A file window is titled by its file and shows when it is unsaved.
    fn sync_window_title(&mut self, window: &mut Window, cx: &App) {
        let target = self.file.as_ref().map(|f| f.read(cx).target.clone());
        let (title, path, edited) = match target {
            Some(file) => (
                file.name.clone(),
                Some(file.path.clone()),
                self.files(cx).dirty,
            ),
            None => {
                let root = self.workspace_root(cx);
                let title = if root.is_some() && !self.project.read(cx).record.name.is_empty() {
                    format!(
                        "{} - {}",
                        windows::APP_NAME,
                        self.project.read(cx).record.name
                    )
                } else {
                    windows::APP_NAME.to_owned()
                };
                (title, root, false)
            }
        };
        let title = if window.is_fullscreen() {
            String::new()
        } else {
            title
        };
        let next = (title, path, edited);
        if self.session.title.as_ref() != Some(&next) {
            window.set_window_title(&next.0);
            window.set_document_path(next.1.as_deref());
            window.set_window_edited(next.2);
            self.session.title = Some(next);
        }
    }
    /// Store the committed pane layout (`setExplorerWidth`,
    /// `setSidebarCollapsed`, `setRightSidebarWidth`).
    fn persist_panes(&mut self, cx: &mut Context<Self>) {
        let stored = self.panes.read(cx).stored();
        self.preferences.update(cx, |store, cx| {
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
            self.frames += 1;
        }
        let size = window.viewport_size();
        let w = f32::from(size.width);
        let h = f32::from(size.height);
        let rail = self.chrome.read(cx).rail_width();
        let reduce_motion = cx.reduce_motion();
        let panes = self
            .panes
            .update(cx, |p, _| p.frames(w, h, rail, reduce_motion));
        self.layout = if self.file_mode() {
            // `.file-mode-window`: the title bar over the document alone.
            Layout::new(w, h, 0., 0., 0.)
        } else {
            panes.layout
        };
        if panes.running {
            window.request_animation_frame();
        }
        self.sync_window_title(window, cx);
        #[cfg(feature = "dev-capture")]
        let scenario_done = self.advance_capture_scenario(window, cx);
        #[cfg(not(feature = "dev-capture"))]
        let scenario_done = true;
        if !self.captured
            && scenario_done
            && let Some(path) = std::env::var_os("PUPPYONE_SCREENSHOT")
        {
            self.captured = true;
            let rect = |r: Rect| [r.x, r.y, r.w, r.h];
            let geometry = serde_json::json!({"framework":"GPUI","header":rect(self.layout.header),"explorer":rect(self.layout.explorer),"footer":rect(self.layout.footer),"editor":rect(self.layout.editor),"auxiliary":rect(self.layout.auxiliary),"pixelsPerPoint":window.scale_factor()});
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
            .track_focus(&self.focus);
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
                let (explorer, footer) = (self.layout.explorer, self.layout.footer);
                let plane = Rect::new(
                    explorer.x,
                    explorer.y,
                    explorer.w,
                    footer.bottom() - explorer.y,
                );
                let column = ExplorerColumn::new(self.explorer.clone()).footer(self.footer(cx));
                stack = stack.start(plane, column);
            }
            if !home && panes.end.is_some() {
                // The 8px sash overlays the pane edge (`.po-pane-edge-resize-handle`);
                // content starts at the divider like the product's.
                stack = stack.end(self.layout.auxiliary, self.sidebar.clone());
            }
            stack
                .main(at(self.layout.editor).child(self.editor.clone()))
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
                .then_some(self.layout.explorer);
            root = root.children(self.project.read(cx).preparation(
                w,
                h,
                explorer,
                self.layout.editor,
                cx,
            ));
        }
        // A file window draws its own title bar.
        if !file {
            root = root.child(at(self.layout.header).child(self.chrome.clone()));
        }
        if !home && !opening && !file {
            root = root.children(panes::edges(&self.panes, &panes, w, rail, window, cx));
        }
        if !home && !opening {
            root = root.children(self.notices(w, cx));
        }
        let chrome = self.chrome.read(cx);
        root = root.child(chrome.project_actions.clone());
        root = root.child(chrome.coachmarks.clone());
        root.child(self.dialogs.clone())
    }
}
impl Shell {
    /// `FloatingNoticeStack`s over the workspace: the workspace surface
    /// notice (`.desktop-workspace-notice-stack`: 12px below the top, 16px
    /// in from the editor's end) and the document session's held-back Cloud
    /// conflict (`.editor-notice-stack`: 48px / 12px).
    fn notices(&self, w: f32, cx: &mut Context<Self>) -> Vec<AnyElement> {
        use crate::{
            localization::t as tr,
            ui::components::{
                FloatingNotice, NoticeAction, NoticePlacement, NoticeStack, NoticeTone,
            },
        };
        let editor = self.layout.editor;
        let end = w - editor.right();
        let mut layers = vec![];
        // `.desktop-workspace-notice-stack`: the local folder's Cloud notice
        // leads the workspace's own warning.
        let mut folder_notice = self.cloud.read(cx).local_folder_notice_view(cx);
        if folder_notice.is_some() && self.project.read(cx).record.notice.is_none() {
            layers.push(
                NoticeStack::new(
                    NoticePlacement::TopEnd,
                    editor.y + 12.,
                    end + 16.,
                    (editor.w - 40.).min(400.),
                )
                .children(folder_notice.take())
                .into_any_element(),
            );
        }
        if let Some(message) = &self.project.read(cx).record.notice {
            let host = self.weak.clone();
            let dismiss = self.weak.clone();
            layers.push(
                NoticeStack::new(
                    NoticePlacement::TopEnd,
                    editor.y + 12.,
                    end + 16.,
                    (editor.w - 40.).min(400.),
                )
                .children(folder_notice.take())
                .child(
                    FloatingNotice::new("workspace-notice", message.clone())
                        .tone(NoticeTone::Warning)
                        .action(NoticeAction::new(
                            "workspace-notice-retry",
                            tr("common.action.retry"),
                            move |_, cx| {
                                let _ = host.update(cx, |s, cx| s.retry_workspace_surface(cx));
                            },
                        ))
                        .on_dismiss(move |_, cx| {
                            let _ = dismiss.update(cx, |s, cx| {
                                s.project.update(cx, |p, _| p.record.notice = None);
                                cx.notify();
                            });
                        }),
                )
                .into_any_element(),
            );
        }
        // `editor-notice-stack`: the active document's save failure.
        if let Some(detail) = self.files(cx).save_error.clone().filter(|e| {
            !self.files(cx).cloud_conflict()
                && self.editor.read(cx).dismissed_save_error.as_ref() != Some(e)
        }) {
            let dismiss = self.weak.clone();
            let dismissed = detail.clone();
            layers.push(
                NoticeStack::new(
                    NoticePlacement::TopEnd,
                    editor.y + 48.,
                    end + 12.,
                    (editor.w - 24.).min(420.),
                )
                .child(
                    FloatingNotice::new(
                        "editor-save-failure",
                        crate::localization::tf(
                            "editor.session.saveFailedDetail",
                            &[(
                                "detail",
                                detail.chars().take(300).collect::<String>().into(),
                            )],
                        ),
                    )
                    .tone(NoticeTone::Danger)
                    .on_dismiss(move |_, cx| {
                        let _ = dismiss.update(cx, |s, cx| {
                            let dismissed = dismissed.clone();
                            s.editor
                                .update(cx, |e, _| e.dismissed_save_error = Some(dismissed));
                            cx.notify();
                        });
                    }),
                )
                .into_any_element(),
            );
        }
        if self.files(cx).cloud_conflict() {
            let host = self.weak.clone();
            layers.push(
                NoticeStack::new(
                    NoticePlacement::TopEnd,
                    editor.y + 48.,
                    end + 12.,
                    (editor.w - 24.).min(420.),
                )
                .child(
                    FloatingNotice::new(
                        "editor-session-notice",
                        tr("editor.session.cloudConflict"),
                    )
                    .tone(NoticeTone::Danger)
                    .action(
                        NoticeAction::new(
                            "editor-session-reload",
                            tr("editor.session.discardAndReload"),
                            move |w, cx| {
                                let _ = host.update(cx, |s, cx| {
                                    s.command(Command::ReloadCloudBaseline, w, cx)
                                });
                            },
                        )
                        .emphasis(),
                    ),
                )
                .into_any_element(),
            );
        }
        layers
    }
    /// `resumeWorkspace`: a hosted Project opens again explicitly (its
    /// retained documents rebind to the new lease); a local folder
    /// subscribes again. Both reread what the Explorer has loaded.
    fn retry_workspace_surface(&mut self, cx: &mut Context<Self>) {
        self.project.update(cx, |p, _| p.record.notice = None);
        match self.hosted_project(cx) {
            Some(project) => self.open_cloud(project, cx),
            None => self.explorer_session.update(cx, |e, cx| e.resubscribe(cx)),
        }
        cx.notify();
    }
}

#[cfg(test)]
mod tests;
