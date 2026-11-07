use crate::{
    documents::Intent,
    editor::workbench::runtime::Runtime as Documents,
    geometry::Rect,
    localization::Locale,
    theme::{self, Theme},
    ui::{
        self,
        appearance::ActiveAppearance,
        components::{ButtonVariant, IconButton},
    },
};
use gpui::{prelude::*, *};
use std::path::PathBuf;
#[cfg(all(test, target_os = "macos"))]
mod bench;
#[cfg(feature = "dev-capture")]
mod capture_scenario;
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
mod project_menu;
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
    /// `ProjectRowActions` of a remembered Project, at the pointer.
    project_actions: Entity<project_actions::ProjectActions>,
    dark: bool,
    locale: Locale,
    /// The Explorer's and the right sidebar's frames: open, width, edge
    /// drags and motion.
    panes: Entity<PaneLayout>,
    /// The project rail (`ProjectSwitcherRail`) replaces the Header's project
    /// button.
    rail: bool,
    /// Window dialogs, bottom to top, and the Settings and Help content.
    dialogs: Entity<DialogLayer>,
    /// What the right sidebar shows: the Agent workbench, Changes / History
    /// and a hosted Project's History.
    sidebar: right_sidebar::RightSidebar,
    /// A file window's own state (File Mode); `None` for a project window.
    pub(super) file: Option<Entity<file_mode::FileWindow>>,
    popover: Option<Popover>,
    weak: WeakEntity<Shell>,
    /// Header introductions (`useHeaderCoachmarks`).
    coachmarks: coachmarks::Coachmarks,
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
    project_focus: FocusHandle,
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
        let mut s = Self {
            project: cx.new(|_| {
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
            }),
            session: session::WindowSession {
                docs,
                key: key.clone(),
                title: None,
            },
            cloud: cx.new(|cx| {
                window_cloud::WindowCloud::new(
                    preferences.clone(),
                    catalog,
                    &dialogs,
                    focus.clone(),
                    window,
                    cx,
                )
            }),
            project_actions,
            dark: std::env::var("PUPPYONE_THEME").as_deref() != Ok("light"),
            locale: Locale::default(),
            panes: {
                let right = std::env::var("PUPPYONE_RIGHT").as_deref() == Ok("1");
                cx.new(|cx| PaneLayout::new(right, window, cx))
            },
            rail: false,
            dialogs,
            sidebar: right_sidebar::RightSidebar::new(
                if std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() == Ok("changes") {
                    right_sidebar::Surface::Git
                } else {
                    right_sidebar::Surface::Agent
                },
                window,
                cx,
            ),
            file: None,
            popover: None,
            weak: cx.weak_entity(),
            coachmarks: Default::default(),
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
            project_focus: cx.focus_handle(),
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
        cx.observe_in(&s.sidebar.workbench, window, |s, _, w, cx| {
            s.gate_editors(w, cx)
        })
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
        cx.subscribe(&s.project_actions, |s, _, event, cx| {
            match event {
                project_actions::ActionsEvent::Opened => s.set_popover(None, cx),
                project_actions::ActionsEvent::Renamed { path, name } => {
                    if s.workspace_root(cx).as_deref() == Some(path.as_path()) {
                        s.project.update(cx, |p, _| p.record.name = name.clone());
                    }
                }
            }
            cx.notify();
        })
        .detach();
        cx.observe(&s.project_actions, |_, _, cx| cx.notify())
            .detach();
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
                        .source_control
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
            PaneEvent::PulledOut => s.sidebar.pulled_out(),
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
                    .workbench
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
        let preferences = s.preferences.clone();
        s.sidebar.workbench.update(cx, |workbench, _| {
            workbench.set_preference_store(preferences)
        });
        cx.subscribe_in(
            &s.sidebar.workbench,
            window,
            |s, _, event: &crate::features::workbench::WorkbenchEvent, w, cx| match event {
                crate::features::workbench::WorkbenchEvent::OpenModelConnections => {
                    s.open_settings(crate::features::settings::Page::ModelConnections, w, cx)
                }
                // `openSettingsDialog("account")`.
                crate::features::workbench::WorkbenchEvent::OpenAccount => {
                    s.open_settings(crate::features::settings::Page::Account, w, cx)
                }
                // `handleAgentOpenFile`: a path inside the chat's project
                // opens in the editor.
                crate::features::workbench::WorkbenchEvent::OpenAgentFile { root, path } => {
                    if let Some(path) = crate::features::desktop_agent::domain::agent_workspace_path::resolve_agent_workspace_provider_path(
                        &root.to_string_lossy(),
                        path,
                    ) {
                        s.session.docs.update(cx, |d, _| d.begin(Intent::OpenFile(root.join(path))));
                    }
                }
                // A hosted run's accepted changes: reread the Cloud tree and
                // revalidate the open document (a draft is kept).
                crate::features::workbench::WorkbenchEvent::CloudPublished => {
                    if s.hosted_project(cx).is_some() {
                        s.explorer_session
                            .update(cx, |e, cx| e.refresh_published(cx));
                        s.session.docs.update(cx, |d, _| d.observe_publication());
                        s.receive(w, cx);
                    }
                }
            },
        )
        .detach();
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
                .source_control
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
        // An open Header introduction closes on Escape wherever focus is
        // (`dismissOnEscape`, a capturing document listener that lets the
        // key go on).
        {
            let shell = cx.weak_entity();
            cx.intercept_keystrokes(move |event, window, cx| {
                if window.window_handle() != own || event.keystroke.key != "escape" {
                    return;
                }
                let _ = shell.update(cx, |s, cx| s.dismiss_coachmark_on_escape(cx));
            })
            .detach();
        }
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
        // The Header's Changes status follows the Git snapshot.
        cx.observe(&s.sidebar.source_control, |_, _, cx| cx.notify())
            .detach();
        // Changes "Open file" (`onOpenFile`): the file in the editor.
        // History and Back store the surface (`rightSidebarSurface`).
        cx.subscribe_in(
            &s.sidebar.source_control,
            window,
            |s, _, event, window, cx| {
                use crate::features::source_control::SourceControlEvent;
                match event {
                    SourceControlEvent::OpenFile(path) => {
                        s.session
                            .docs
                            .update(cx, |d, _| d.begin(Intent::OpenFile(PathBuf::from(path))));
                        s.receive(window, cx);
                    }
                    SourceControlEvent::Surface => s.sidebar.store(&s.preferences, cx),
                }
                cx.notify();
            },
        )
        .detach();
        // History's Close and Back leave the sidebar closed on the workbench.
        cx.subscribe_in(
            &s.sidebar.cloud_history,
            window,
            |s, _, event, window, cx| {
                let crate::features::source_control::CloudHistoryEvent::Close = event;
                s.close_cloud_history(cx);
                s.focus.focus(window, cx);
                cx.notify();
            },
        )
        .detach();
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
                s.sidebar.workbench.update(cx, |workbench, cx| {
                    workbench.visual_fixture_panel(surface == "agent-panel", window, cx)
                });
            }
            if surface == "agent-empty" || surface == "agent-transcript" {
                s.panes.update(cx, |p, cx| p.set_right_open(true, cx));
                s.sidebar.workbench.update(cx, |workbench, cx| {
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
        self.apply_projections(window, cx);
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
    fn apply_projections(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let p = self.preferences.read(cx).state.clone();
        // The built-in Agent offers PuppyOne compute only while Payments is on.
        crate::cloud::auth::set_payments(p.experimental.payments);
        crate::editor::markdown::core::commands::block_move::set_enabled(
            p.experimental.markdown_block_drag,
        );
        let hidden = p.local_agents.hidden_agent_ids.clone();
        let (routing, payments) = (p.agent_routing.clone(), p.experimental.payments);
        self.sidebar
            .workbench
            .update(cx, |w, cx| w.set_preferences(hidden, routing, payments, cx));
        let (layout, icons) = (p.git_sidebar_layout, p.file_icon_theme.clone());
        let history_icons = icons.clone();
        self.sidebar
            .cloud_history
            .update(cx, |h, cx| h.set_icon_theme(history_icons, cx));
        self.sidebar
            .source_control
            .update(cx, |s, cx| s.set_presentation(layout, icons, cx));
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
        // The surface the closed sidebar opens on (`rightSidebarSurface`).
        if self.preferences.read(cx).loaded {
            let open = self.panes.read(cx).right().open;
            self.sidebar.restore(p.right_sidebar_surface, open, cx);
        }
        // The project rail takes room from the panes.
        let rail_changed = self.rail != p.project_switcher_rail;
        self.rail = p.project_switcher_rail;
        if rail_changed {
            self.constrain_window(window, cx);
            self.push_explorer_host(window, cx);
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
            listing: home || self.popover == Some(Popover::Project),
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
        };
        self.home
            .update(cx, |h, cx| h.set_session(view.clone(), cx));
        let popover = self.popover;
        self.cloud.update(cx, |c, cx| {
            c.set_session(view, cx);
            c.set_popover(popover, cx);
        });
        self.guard_cloud_history(cx);
    }
    /// The Header card or menu that is open: one at a time.
    fn set_popover(&mut self, popover: Option<Popover>, cx: &mut Context<Self>) {
        if self.popover != popover {
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
            self.popover = popover;
            self.sync_session_view(cx);
            cx.notify();
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
        if self.sidebar.is(Surface::CloudHistory) {
            self.sidebar.close_cloud_history(cx);
        }
        self.panes.update(cx, |p, cx| p.set_right_open(false, cx));
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
        if self.popover == Some(Popover::Share) {
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
    /// Escape on the topmost dialog, each with its own cancel: the Documents
    /// error, then the top of the dialog layer.
    fn dismiss_modal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.files(cx).cloud_conflict()
            && self
                .session
                .docs
                .update(cx, |d, _| d.error.take())
                .is_some()
        {
            return;
        }
        self.dialogs.update(cx, |d, cx| d.dismiss_top(window, cx));
    }
    fn pick_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.project.update(cx, |p, cx| p.pick(window, cx)) {
            self.push_explorer_host(window, cx);
        }
    }
    pub fn command(&mut self, command: Command, window: &mut Window, cx: &mut Context<Self>) {
        crate::platform::watchdog::activity("shell.command");
        if command == Command::QuitApp {
            windows::quit_all(cx);
            return;
        }
        // A file window has no project to leave, browse or share, and
        // `FileModeApp` takes no Settings or Help request; its one file is
        // never closed out of it.
        if self.file_mode()
            && matches!(
                command,
                Command::Home
                    | Command::ProjectMenu
                    | Command::LocationMenu
                    | Command::ToggleExplorer
                    | Command::ToggleRightSidebar
                    | Command::Changes
                    | Command::CloudServices
                    | Command::CloudHistory
                    | Command::OpenFolder
                    | Command::CreateNew
                    | Command::Settings
                    | Command::Feedback
                    | Command::CloseFile
            )
        {
            return;
        }
        match command {
            Command::Minimize => {
                window.minimize_window();
                return;
            }
            // Before any dialog's own handling: a dialog takes no ⌘W.
            Command::CloseEditorOrWindow => {
                if self.open_editors(cx).is_some() {
                    self.session
                        .docs
                        .update(cx, |d, _| d.begin(Intent::CloseFile));
                    self.receive(window, cx);
                    cx.notify();
                } else {
                    self.command(Command::Quit, window, cx);
                }
                return;
            }
            Command::Zoom => {
                window.zoom_window();
                return;
            }
            // `role: "about"`: the system's About panel.
            Command::About => {
                crate::platform::desktop::show_about_panel();
                return;
            }
            // `checkForUpdatesFromNativeMenu`: this build has no update
            // service, so the native answer is `createUnavailableDialog`.
            Command::CheckForUpdates => {
                let message = crate::localization::tf(
                    "native.update.manual.unavailable.message",
                    &[("appName", windows::APP_NAME.into())],
                );
                let detail = crate::localization::t("native.update.manual.unavailable.detail");
                // Only OK: nothing waits for the answer.
                drop(window.prompt(
                    PromptLevel::Info,
                    &message,
                    Some(detail),
                    &[PromptButton::ok(crate::localization::t(
                        "native.update.manual.ok",
                    ))],
                    cx,
                ));
                return;
            }
            _ => {}
        }
        if command == Command::NewWindow {
            cx.defer(|cx| {
                let _ = windows::open(None, cx);
            });
            return;
        }
        if command == Command::Quit {
            self.editor.update(cx, |e, cx| e.end_resize(false, cx));
        }
        match command {
            // `askToSaveFile`: a file window with unsaved edits asks first.
            Command::Quit if self.file_mode() && self.files(cx).dirty => {
                if let Some(file) = self.file.clone() {
                    file.update(cx, |f, cx| f.ask_to_save(window, cx));
                }
                return;
            }
            Command::SaveFileAndClose => {
                self.session.docs.update(cx, |d, _| d.begin(Intent::Quit));
                self.receive(window, cx);
                cx.notify();
                return;
            }
            Command::DiscardFileChanges => {
                self.session.docs.update(cx, |d, _| d.abandon_unsaved());
                self.receive(window, cx);
                cx.notify();
                return;
            }
            Command::CancelFileClose => {
                windows::cancel_quit(cx);
                self.focus.focus(window, cx);
                cx.notify();
                return;
            }
            Command::Quit if self.sidebar.workbench.read(cx).has_running(cx) => {
                self.open_modal(Modal::ConfirmQuit, cx);
                self.focus.focus(window, cx);
                cx.notify();
                return;
            }
            Command::QuitWithProcesses => {
                self.close_modal(|m| matches!(m, Modal::ConfirmQuit), cx);
                self.session.docs.update(cx, |d, _| d.begin(Intent::Quit));
                self.receive(window, cx);
                cx.notify();
                return;
            }
            Command::CancelProcessQuit => {
                self.close_modal(|m| matches!(m, Modal::ConfirmQuit), cx);
                windows::cancel_quit(cx);
                cx.notify();
                return;
            }
            Command::KeepWindowOpen => {
                self.close_modal(|m| matches!(m, Modal::CloseAnyway), cx);
                windows::cancel_quit(cx);
                self.focus.focus(window, cx);
                cx.notify();
                return;
            }
            Command::CloseAnyway => {
                self.close_modal(|m| matches!(m, Modal::CloseAnyway), cx);
                self.session.docs.update(cx, |d, _| d.abandon_unsaved());
                self.receive(window, cx);
                cx.notify();
                return;
            }
            // Escape answers the topmost dialog (Help → Feedback ignores it,
            // `dismiss_modal`).
            Command::Escape if self.modal(cx) => {
                self.dismiss_modal(window, cx);
                self.receive(window, cx);
                cx.notify();
                return;
            }
            _ => {}
        }
        // While a task dialog is open the shell's other commands wait;
        // ⌘, toggles Settings (from Help, it switches and drops the draft).
        if let Some(task) = self.dialogs.read(cx).task() {
            match command {
                Command::Settings if task == Task::Settings => self.close_tasks(cx),
                Command::Settings => {
                    let root = self.workspace_root(cx);
                    self.dialogs.update(cx, |d, cx| {
                        d.feedback.update(cx, |f, cx| f.reset(cx));
                        d.set_root(root, cx);
                        d.open(Modal::Task(Task::Settings), cx);
                    });
                    self.focus.focus(window, cx);
                }
                Command::Quit => self.session.docs.update(cx, |d, _| d.begin(Intent::Quit)),
                _ => {}
            }
            self.receive(window, cx);
            cx.notify();
            return;
        }
        match command {
            Command::Undo | Command::Redo => {
                if !self.modal(cx)
                    && !self.files(cx).busy()
                    && let Some(id) = self.files(cx).document.as_ref().map(|doc| doc.id.clone())
                {
                    self.session.docs.update(cx, |d, _| {
                        d.outgoing.push(crate::documents::HostMessage::History {
                            id,
                            redo: command == Command::Redo,
                        })
                    });
                }
            }
            Command::Save => self.session.docs.update(cx, |d, _| d.begin(Intent::Save)),
            Command::Reload => self.session.docs.update(cx, |d, _| d.begin(Intent::Reload)),
            Command::CloseFile => self
                .session
                .docs
                .update(cx, |d, _| d.begin(Intent::CloseFile)),
            // Pane menu "Open in default app" (`EditorPaneActionsMenu`).
            Command::OpenExternal => {
                if let (Some(ws), Some((_, relative))) =
                    (&self.files(cx).workspace, self.files(cx).opened())
                {
                    match ws.absolute(relative) {
                        Ok(path) => {
                            if let Err(e) = crate::platform::desktop::open(&path) {
                                self.show_error(e, cx);
                            }
                        }
                        Err(e) => self.show_error(e.to_string(), cx),
                    }
                }
            }
            Command::Quit => self.session.docs.update(cx, |d, _| d.begin(Intent::Quit)),
            Command::OpenFolder => self.pick_workspace(window, cx),
            Command::CreateNew => self.home.update(cx, |h, cx| h.open_project_entry(cx)),
            Command::RetryProjectOpen => {
                let failed = self.dialogs.read(cx).failed_project();
                self.close_modal(|m| matches!(m, Modal::ProjectFailure { .. }), cx);
                if let Some(path) = failed {
                    self.open_project(path, window, cx);
                }
            }
            Command::CloseProjectFailure => {
                self.close_modal(|m| matches!(m, Modal::ProjectFailure { .. }), cx);
            }
            Command::ToggleExplorer => {
                self.panes.update(cx, |p, cx| p.toggle_explorer(cx));
            }
            Command::ToggleRightSidebar => {
                let open = self.panes.read(cx).right().open;
                let open = self.sidebar.toggle_agent(open, &self.preferences, cx);
                self.panes.update(cx, |p, cx| p.set_right_open(open, cx));
            }
            Command::Settings => {
                self.set_popover(None, cx);
                self.explorer.update(cx, |e, cx| e.dismiss_menu(cx));
                let root = self.workspace_root(cx);
                self.dialogs.update(cx, |d, cx| {
                    d.set_root(root, cx);
                    d.open(Modal::Task(Task::Settings), cx)
                });
                self.focus_dialogs(window, cx);
            }
            Command::Feedback => {
                self.set_popover(None, cx);
                self.explorer.update(cx, |e, cx| e.dismiss_menu(cx));
                self.open_modal(Modal::Task(Task::Feedback), cx);
                let feedback = self.dialogs.read(cx).feedback.clone();
                let message = feedback.read(cx).message.focus_handle(cx);
                message.focus(window, cx);
            }
            Command::ProjectMenu => {
                let next = (self.popover != Some(Popover::Project)).then_some(Popover::Project);
                self.set_popover(next, cx);
                self.project_focus.focus(window, cx);
            }
            Command::LocationMenu => {
                let next = (self.popover != Some(Popover::Place)).then_some(Popover::Place);
                self.set_popover(next, cx);
            }
            Command::Home => {
                self.set_popover(None, cx);
                self.explorer.update(cx, |e, cx| e.dismiss_menu(cx));
                if !self.home_visible(cx) {
                    self.home.update(cx, |h, _| h.hold_list());
                }
                self.project.update(cx, |p, _| p.home = true);
            }
            // With no dialog open, Escape closes a menu.
            // Escape cancels a Cloud opening; whatever showed stays.
            Command::Escape if self.files(cx).cloud_opening().is_some() => {
                self.session.docs.update(cx, |d, _| d.cancel_cloud());
            }
            // Escape inside History goes back (`CloudWorkspaceHistorySidebar`).
            Command::Escape
                if self.right_shows(Surface::CloudHistory, cx)
                    && self
                        .sidebar
                        .cloud_history
                        .read(cx)
                        .focus_handle()
                        .contains_focused(window, cx) =>
            {
                self.sidebar.cloud_history.update(cx, |h, cx| h.back(cx));
            }
            Command::Escape => {
                let closed = self.explorer.update(cx, |e, cx| e.dismiss_menu(cx));
                if !closed && self.popover.take().is_some() {
                    self.project_focus.focus(window, cx);
                }
            }
            Command::PasteTemplateLink => {
                if !self.modal(cx) && !self.file_mode() {
                    let text = cx
                        .read_from_clipboard()
                        .and_then(|item| item.text())
                        .unwrap_or_default();
                    if crate::platform::templates::link::looks_like(&text) {
                        let url = text.trim().to_owned();
                        self.home
                            .update(cx, |h, cx| h.open_template_link(url, window, cx));
                    }
                }
            }
            // Only Markdown's viewer takes the shortcut (`MarkdownViewer`'s
            // `enableModeToggleShortcut`).
            Command::ToggleMarkdownSource => {
                let front = self.editor.read(cx).front.clone();
                let markdown = front.read(cx).viewer_id() == Some("markdown");
                if markdown && !self.files(cx).busy() && !self.modal(cx) && !self.home_visible(cx) {
                    front.update(cx, |s, cx| s.command("source", window, cx));
                }
            }
            Command::NextEditor | Command::PreviousEditor => {
                if let Some((editors, active)) = self.open_editors(cx) {
                    let step = if command == Command::NextEditor {
                        1
                    } else {
                        editors.len() - 1
                    };
                    let next = (active + step) % editors.len();
                    self.session
                        .docs
                        .update(cx, |d, _| d.activate(&editors[next]));
                    self.sync_editor(window, cx);
                }
            }
            Command::ToggleFullScreen => window.toggle_fullscreen(),
            Command::RetryFileOperation => {
                self.close_modal(|m| matches!(m, Modal::Error(_)), cx);
                self.session.docs.update(cx, |d, _| d.error = None);
                self.session.docs.update(cx, |d, _| d.retry_operation());
            }
            Command::ClearError => {
                self.close_modal(|m| matches!(m, Modal::Error(_)), cx);
                self.session.docs.update(cx, |d, _| d.error = None);
            }
            Command::CloudServices => self
                .cloud
                .update(cx, |c, cx| c.open_share(String::new(), window, cx)),
            Command::CloudHistory => {
                let Some(project) = self.hosted_project(cx) else {
                    return;
                };
                self.set_popover(None, cx);
                let open = self.panes.read(cx).right().open;
                let open = self.sidebar.toggle_cloud_history(open, &project, cx);
                self.panes.update(cx, |p, cx| p.set_right_open(open, cx));
                if open {
                    let history = self.sidebar.cloud_history.read(cx).focus_handle().clone();
                    history.focus(window, cx);
                } else {
                    self.focus.focus(window, cx);
                }
            }
            Command::ReloadCloudBaseline => {
                self.session
                    .docs
                    .update(cx, |d, _| d.reload_cloud_baseline());
                self.receive(window, cx);
            }
            Command::ManageExecutions => {
                self.set_popover(None, cx);
                self.close_modal(|m| matches!(m, Modal::Executions), cx);
                self.open_modal(Modal::Executions, cx);
                self.focus_dialogs(window, cx);
            }
            Command::CloseExecutions => {
                self.close_modal(|m| matches!(m, Modal::Executions), cx);
                self.focus.focus(window, cx);
            }
            Command::Changes => {
                if self.files(cx).workspace.is_none() {
                    return;
                }
                let open = self.panes.read(cx).right().open;
                let open = self.sidebar.toggle_git(open, &self.preferences, cx);
                self.panes.update(cx, |p, cx| p.set_right_open(open, cx));
                self.focus.focus(window, cx);
            }
            _ => {}
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// Closes Settings or Help; Help's draft goes with it, and the window
    /// takes the focus back ([`DialogEvent::Closed`]).
    fn close_tasks(&mut self, cx: &mut Context<Self>) {
        self.dialogs.update(cx, |d, cx| d.close_tasks(cx));
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
                    .workbench
                    .update(cx, |s, cx| s.set_workspace(root.to_owned(), cx));
                self.sidebar
                    .source_control
                    .update(cx, |s, cx| s.set_workspace(root.to_owned(), cx));
            } else if let Some(target) = ws.agent_target() {
                // `CloudAgentSidebar`: the hosted Agent, not this machine's.
                self.sidebar
                    .workbench
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
            self.sidebar.workbench.update(cx, |s, cx| s.shutdown(cx));
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
            modal: self.modal(cx) || self.sidebar.workbench.read(cx).dialog_open(),
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
    /// History closed itself (Close, Back): the sidebar closes on it.
    fn close_cloud_history(&mut self, cx: &mut Context<Self>) {
        if self.sidebar.is(Surface::CloudHistory) {
            self.panes.update(cx, |p, cx| p.set_right_open(false, cx));
        }
        self.sidebar.close_cloud_history(cx);
    }
    /// A project's editor tabs and the active one's index, while they show
    /// (`activeView === "data"` with editors): what ⌘W and ⌃Tab act on.
    fn open_editors(&self, cx: &App) -> Option<(Vec<String>, usize)> {
        if self.file_mode() || self.home_visible(cx) {
            return None;
        }
        let catalog = &self.files(cx).state()?.catalog;
        let editors: Vec<String> = catalog.editors.iter().map(|e| e.id.clone()).collect();
        let active = editors
            .iter()
            .position(|id| Some(id) == catalog.active.as_ref())?;
        Some((editors, active))
    }
    /// The right sidebar is open on `surface`.
    fn right_shows(&self, surface: Surface, cx: &App) -> bool {
        self.panes.read(cx).right().open && self.sidebar.is(surface)
    }
    /// History out of its scope closes (`useCloudWorkspaceSidebar`).
    fn guard_cloud_history(&mut self, cx: &mut Context<Self>) {
        let project = self.hosted_project(cx);
        let open = self.panes.read(cx).right().open;
        if self
            .sidebar
            .guard_cloud_history(open, project.as_deref(), cx)
        {
            self.panes.update(cx, |p, cx| p.set_right_open(false, cx));
        }
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
    /// Compact `ProjectSwitcherRail`: one mark per remembered project.
    fn project_rail(&self, h: f32, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let current = self
            .files(cx)
            .workspace
            .as_ref()
            .and_then(|ws| ws.local_root().map(PathBuf::from));
        let mut rail = at(Rect::new(
            0.,
            theme::HEADER,
            self.rail_width(),
            h - theme::HEADER,
        ))
        .bg(t.sidebar)
        .border_r_1()
        .border_color(t.sidebar_divider)
        .flex()
        .flex_col()
        .items_center()
        .pt(px(12.))
        .gap(px(6.));
        let recent = self.preferences.read(cx).state.recent_projects.clone();
        for (index, project) in recent.iter().take(12).enumerate() {
            let active = current.as_ref() == Some(&project.path);
            let initial = project
                .name
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            let path = project.path.clone();
            rail = rail.child(
                gpui_kit::base::Button::new(("rail-project", index))
                    .accessibility_label(crate::localization::tf(
                        "shell.workspaceSwitcher.projectTitle",
                        &[("project", project.name.clone().into())],
                    ))
                    .selected(active)
                    .size(px(theme::control()))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(8.))
                    .border_1()
                    .border_color(if active {
                        t.border_strong
                    } else {
                        t.border_subtle
                    })
                    .bg(if active { t.selected } else { t.control })
                    .text_size(px(theme::ty().ui.label))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if active { t.text } else { t.muted })
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover))
                    .tooltip(ui::components::tooltip(project.name.clone()))
                    .child(initial)
                    .on_mouse_down(MouseButton::Right, {
                        let target = project_actions::Target::Local {
                            path: path.clone(),
                            name: project.name.clone(),
                        };
                        cx.listener(move |s, e: &MouseDownEvent, w, cx| {
                            cx.stop_propagation();
                            let at = Bounds::new(e.position, size(px(0.), px(0.)));
                            let (target, viewport) = (target.clone(), w.viewport_size());
                            s.project_actions
                                .update(cx, |a, cx| a.open(target, at, false, viewport, None, cx))
                        })
                    })
                    .on_click(cx.listener(move |s, _, w, cx| s.open_project(path.clone(), w, cx))),
            );
        }
        rail.child(
            IconButton::new("rail-plus", "plus")
                .label(crate::localization::t("shell.workspaceSwitcher.addProject"))
                .size(px(theme::control()))
                .on_click(cx.listener(|s, _, w, cx| s.command(Command::CreateNew, w, cx))),
        )
    }
    /// The width the panes share: the window, less the project rail.
    fn rail_width(&self) -> f32 {
        if self.rail {
            theme::metric::PROJECT_RAIL_WIDTH
        } else {
            0.
        }
    }
    /// What the Explorer shows of the shell (`Host`), handed over when it
    /// changes: a document opens or closes, the folder picker opens, a pane
    /// opens or closes, the window resizes. The frame is the Explorer's open
    /// plane, which it keeps while its frame moves.
    fn push_explorer_host(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let size = window.viewport_size();
        let (w, h) = (f32::from(size.width), f32::from(size.height));
        let rail = self.rail_width();
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
    /// The project being entered in this window, named as its Header will
    /// name it (`projectOpening.projectName`).
    pub(super) fn opening_project_name(&self, cx: &App) -> Option<String> {
        if self.files(cx).cloud_opening().is_some() {
            let project = self.project.read(cx).record.cloud.as_deref()?;
            return Some(
                self.home
                    .read(cx)
                    .project_items(cx)
                    .into_iter()
                    .find(|i| i.cloud_project.as_deref() == Some(project))
                    .map(|i| i.label)
                    .unwrap_or_else(|| project.to_owned()),
            );
        }
        let root = self.files(cx).preparing_root()?;
        Some(
            self.preferences
                .read(cx)
                .state
                .recent_projects
                .iter()
                .find(|p| p.path == root)
                .map(|p| p.name.clone())
                .or_else(|| root.file_name().map(|n| n.to_string_lossy().into_owned()))
                .unwrap_or_default(),
        )
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
    /// The Header (`DesktopWindowChrome`).
    ///
    /// - The Homepage names the product (once there are projects) and holds
    ///   the account (`HomepageCloudStatus`).
    /// - A local folder: the Explorer's expand button while it is closed,
    ///   the project and its place, then the app status, Share, Changes and
    ///   the Agent entry, each group set off by a rule.
    /// - A Cloud project (`CloudWorkspaceHeaderTools`): Share, a rule and
    ///   the Agent entry, on the Cloud's own Header tint.
    fn header(&self, cx: &mut Context<Self>) -> header::TitleBar {
        use crate::localization::t as tr;
        let home = self.home_visible(cx);
        if home {
            let mut bar = header::TitleBar::new();
            let home = self.home.read(cx);
            let empty = home.project_items(cx).is_empty();
            if !empty || home.list_held() {
                bar = bar.leading(header::brand_name(cx));
            }
            if crate::features::flags::cloud_enabled(&self.preferences, cx) {
                let (retry, account) = (self.weak.clone(), self.weak.clone());
                bar = bar.action(header::cloud_status(
                    &self.cloud.read(cx).catalog,
                    self.files(cx).cloud_opening().is_some(),
                    empty,
                    move |_, cx| {
                        let _ = retry.update(cx, |s, cx| s.refresh_cloud_catalog(true, cx));
                    },
                    move |window, cx| {
                        let _ = account.update(cx, |s, cx| {
                            s.open_settings(crate::features::settings::Page::Account, window, cx)
                        });
                    },
                    cx,
                ));
            }
            return bar;
        }
        // `ProjectWindow` while another project is on its way in: the
        // Header states that project and its location, and what belongs to
        // the project on screen steps out of it.
        let opening = self.opening(cx);
        let hosted = if opening {
            self.files(cx).cloud_opening().is_some()
        } else {
            self.hosted_project(cx).is_some() || self.cloud.read(cx).capture_hosted()
        };
        let (changes, agent, tabs) = {
            let p = &self.preferences.read(cx).state;
            (
                !hosted
                    && self
                        .files(cx)
                        .workspace
                        .as_ref()
                        .is_some_and(|ws| ws.local_root().is_some())
                    && p.header_changes,
                p.header_terminal || hosted,
                p.experimental.editor_tabs_in_header,
            )
        };
        let project = !self.rail
            && (self.files(cx).workspace.is_some()
                || self.project.read(cx).record.fixture
                || opening);
        let mut bar = header::TitleBar::new().cloud(hosted);
        if !self.panes.read(cx).explorer().open {
            bar = bar.leading(
                IconButton::new("expand-explorer", "panel-left")
                    .label(tr("shared-ui.explorer.expandSidebar"))
                    .w(px(theme::control()))
                    .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                    .on_click(cx.listener(|s, _, w, cx| s.command(Command::ToggleExplorer, w, cx))),
            );
        }
        if project {
            bar = bar.leading(self.project_context(cx));
        }
        if opening {
            return bar;
        }
        // `enableEditorTabsInHeader`: the editor's tabs move into the Header.
        if tabs && self.files(cx).state().is_some() {
            bar = bar.tabs(self.editor.read(cx).tabs(cx));
        }
        if hosted {
            if let Some(agents) = self.cloud.read(cx).agents_control(cx) {
                bar = bar.action(agents);
            }
            bar = bar
                .action(self.cloud.read(cx).share_control(cx))
                .divider(cx);
        } else {
            // `cloudEnabled && shareEnabled`: a local folder's Cloud services.
            let share = self.workspace_root(cx).is_some()
                && crate::features::flags::share_enabled(&self.preferences, cx);
            if share {
                bar =
                    bar.action(header::share_entry().on_click(
                        cx.listener(|s, _, w, cx| s.command(Command::CloudServices, w, cx)),
                    ));
                if changes || agent {
                    bar = bar.divider(cx);
                }
            }
            if changes {
                use gpui_kit::base::Selectable as _;
                let status = header::GitTitlebarStatus::of(self.sidebar.source_control.read(cx));
                let introduced = self.coachmarks.active == Some(coachmarks::Coachmark::Changes);
                let button = header::ChangesButton::new(status)
                    .selected(self.right_shows(Surface::Git, cx))
                    .coachmark(introduced)
                    .on_click(cx.listener(|s, _, w, cx| s.command(Command::Changes, w, cx)))
                    .into_any_element();
                bar = bar.action(self.coachmark_anchor(coachmarks::Coachmark::Changes, button, cx));
                if agent {
                    bar = bar.divider(cx);
                }
            }
        }
        if agent {
            let introduced = self.coachmarks.active == Some(coachmarks::Coachmark::Agent);
            let button = header::agent_entry(self.right_shows(Surface::Agent, cx))
                .when(introduced, |b| b.variant(ButtonVariant::TitlebarCoachmark))
                .on_click(cx.listener(|s, _, w, cx| s.command(Command::ToggleRightSidebar, w, cx)))
                .into_any_element();
            bar = bar.action(self.coachmark_anchor(coachmarks::Coachmark::Agent, button, cx));
        }
        bar
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
        let rail = self.rail_width();
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
        let overlay = !self.dialogs.read(cx).is_empty() || self.popover.is_some();
        crate::web_host::set_overlay(window, overlay);
        crate::web_host::frame_drawn(window);
        #[cfg(test)]
        {
            self.frames += 1;
        }
        let size = window.viewport_size();
        let w = f32::from(size.width);
        let h = f32::from(size.height);
        let rail = self.rail_width();
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
        self.sync_coachmarks(cx);
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
                let content = div()
                    .size_full()
                    .bg(t.auxiliary())
                    .child(self.sidebar.content());
                stack = stack.end(self.layout.auxiliary, content);
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
        if self.rail && !home && !file {
            root = root.child(self.project_rail(h, cx));
        }
        let opening = !home && self.opening(cx);
        if opening {
            let explorer =
                Some(self.layout.explorer).filter(|_| self.panes.read(cx).explorer().open);
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
            root = root.child(at(self.layout.header).child(self.header(cx)));
        }
        if !home && !opening && !file {
            root = root.children(panes::edges(&self.panes, &panes, w, rail, window, cx));
        }
        if !home && !opening {
            root = root.children(self.notices(w, cx));
        }
        root = root.child(self.project_actions.clone());
        root = root.children(self.coachmark_overlay(w, cx));
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
