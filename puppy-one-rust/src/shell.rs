use crate::{
    documents::{ClientMessage, Intent},
    editor::workbench::runtime::Runtime as Documents,
    geometry::Rect,
    localization::Locale,
    theme::{self, Theme},
    ui::{
        self,
        appearance::ActiveAppearance,
        components::{ButtonVariant, IconButton, ResizeHandle},
    },
    wake::Wake,
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
mod create_new;
mod editor_area;
mod editor_workbench;
mod explorer;
mod file_mode;
mod footer;
mod header;
mod home;
mod modals;
mod panes;
mod project_actions;
mod project_menu;
mod project_opening;
mod project_place;
mod rename;
mod right_sidebar;
mod share_panel;
pub(crate) mod tasks;
mod window_cloud;
mod window_project;
pub mod windows;
use crate::features::settings::preferences_store::Slice;
use command::on_shell_actions;
pub use command::{
    Command, app_menus, bind_keys, dock_menu, on_app_actions, on_global_shell_actions,
};
use explorer::{Explorer, ExplorerEvent, Host};
use footer::SidebarFooter;
use modals::{Modal, Modals, Task};
use panes::{Layout, Panes, Side, StoredPanes};
use right_sidebar::Surface;
use tasks::TaskUi;
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
    /// This window's budget owner (`ownerId`), shared with its hosts.
    window_key: String,
    /// The window's Cloud: catalog, association, publication, Agents, Share.
    cloud: window_cloud::WindowCloud,
    /// The project this window shows and how it came to show it.
    window: window_project::WindowProject,
    /// `ProjectRowActions` of a remembered Project, at the pointer.
    project_actions: Option<project_actions::ActionsMenu>,
    dark: bool,
    locale: Locale,
    /// The Explorer and the right sidebar.
    panes: Panes,
    /// The project rail (`ProjectSwitcherRail`) replaces the Header's project
    /// button.
    rail: bool,
    /// Window dialogs, bottom to top.
    modals: Modals,
    /// What the right sidebar shows: the Agent workbench, Changes / History
    /// and a hosted Project's History.
    sidebar: right_sidebar::RightSidebar,
    /// The window title, represented file and edited mark last applied.
    window_title: Option<(String, Option<PathBuf>, bool)>,
    /// A file window's own state (File Mode); `None` for a project window.
    pub(super) file: Option<file_mode::FileWindow>,
    popover: Option<Popover>,
    weak: WeakEntity<Shell>,
    /// Header introductions (`useHeaderCoachmarks`).
    coachmarks: coachmarks::Coachmarks,
    /// The workspace tree on the left.
    explorer: Entity<Explorer>,
    homepage: home::Homepage,
    task_ui: TaskUi,
    /// Help → Feedback (`DesktopHelpLauncher`).
    feedback: Entity<crate::features::feedback::Feedback>,
    cloud_services: Entity<crate::features::cloud_services::CloudServices>,
    preferences: Entity<crate::features::settings::preferences_store::PreferencesStore>,
    preference_slices: PreferenceSlices,
    pending: bool,
    files: Documents,
    /// The editor area's hosts, drops, resizes and save notices.
    editor: editor_area::EditorArea,
    wake: Wake,
    focus: FocusHandle,
    project_focus: FocusHandle,
    modal_focus: FocusHandle,
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
/// `content` (laid out in window coordinates) shown only inside `clip`, a
/// moving pane frame; unclipped when the pane is settled.
fn clipped(clip: Option<Rect>, w: f32, h: f32, content: Div) -> Div {
    match clip {
        None => content,
        Some(r) => at(r).overflow_hidden().child(
            div()
                .absolute()
                .left(px(-r.x))
                .top(px(-r.y))
                .w(px(w))
                .h(px(h))
                .child(content),
        ),
    }
}
impl Shell {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (wake, rx) = Wake::channel();
        let fixture = cfg!(test)
            || std::env::var_os("PUPPYONE_FIXTURE").is_some()
            || std::env::var_os("PUPPYONE_SCREENSHOT").is_some();
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        let weak = cx.weak_entity();
        window.on_window_should_close(cx, move |window, cx| {
            weak.update(cx, |s, cx| {
                if s.files.allow_quit {
                    s.preferences.read(cx).drained()
                        && !s.modals.create_entry().is_some_and(|f| f.read(cx).busy())
                        && (windows::count(cx) > 1
                            || !windows::last_close_quits(cx)
                            || crate::features::cloud_account::close_ready(cx))
                } else {
                    s.command(Command::Quit, window, cx);
                    false
                }
            })
            .unwrap_or(true)
        });
        if let Some(account) = cx
            .try_global::<crate::features::cloud_account::CloudAccountService>()
            .map(|s| s.0.clone())
        {
            cx.observe(&account, |s, _, cx| {
                s.refresh_cloud_catalog(false, cx);
                s.wake.notify();
                cx.notify();
            })
            .detach();
        }
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this
                    .update_in(cx, |s, w, cx| {
                        let before = (
                            s.files.presentation_key(),
                            s.files.generation,
                            s.window.name.clone(),
                        );
                        s.receive(w, cx);
                        let after = (
                            s.files.presentation_key(),
                            s.files.generation,
                            s.window.name.clone(),
                        );
                        if before != after {
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        // One preference owner for every window; per-window state stays here.
        let launch = windows::take_launch(cx);
        let preferences = windows::shared_preferences(fixture, cx);
        let mut s = Self {
            window_key: crate::features::agent_presence::owner(window),
            cloud: window_cloud::WindowCloud::new(
                crate::features::cloud_catalog::global(cx),
                Self::new_cloud_publish(cx),
                Self::new_repository_cloud(cx),
                cx.new(|_| crate::features::cloud_agents::CloudAgents::new()),
            ),
            window: window_project::WindowProject {
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
            project_actions: None,
            dark: std::env::var("PUPPYONE_THEME").as_deref() != Ok("light"),
            locale: Locale::default(),
            panes: Panes::new(std::env::var("PUPPYONE_RIGHT").as_deref() == Ok("1")),
            rail: false,
            modals: Default::default(),
            sidebar: right_sidebar::RightSidebar::new(
                if std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() == Ok("changes") {
                    right_sidebar::Surface::Git
                } else {
                    right_sidebar::Surface::Agent
                },
                window,
                cx,
            ),
            window_title: None,
            file: None,
            popover: None,
            weak: cx.weak_entity(),
            coachmarks: Default::default(),
            explorer: {
                let owner = crate::features::agent_presence::owner(window);
                cx.new(|cx| {
                    Explorer::new(fixture, preferences.clone(), cx).with_presence_owner(owner)
                })
            },
            homepage: Default::default(),
            task_ui: TaskUi::new(preferences.clone(), window, cx),
            feedback: cx.new(|cx| crate::features::feedback::Feedback::new(window, cx)),
            cloud_services: cx
                .new(|cx| crate::features::cloud_services::CloudServices::new(window, cx)),
            preferences,
            preference_slices: Default::default(),
            pending: false,
            files: if fixture {
                Documents::default()
            } else {
                Documents::native()
            },
            editor: editor_area::EditorArea::new(cx.new(crate::editor::host::DocumentEditor::new)),
            wake,
            focus,
            project_focus: cx.focus_handle(),
            modal_focus: cx.focus_handle(),
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
        s.files.task_scope = s.window_key.clone();
        s.editor.hosts.insert(0, s.editor.front.clone());
        // Agent file presence over the editor panes.
        if let Some(presence) = crate::features::agent_presence::store(cx) {
            cx.observe(&presence, |_, _, cx| cx.notify()).detach();
        }
        // Captures can start on a task dialog.
        match std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() {
            Ok("settings") => s.modals.open(Modal::Task(Task::Settings)),
            Ok("feedback") => s.modals.open(Modal::Task(Task::Feedback)),
            _ => {}
        }
        cx.subscribe_in(
            &s.preferences,
            window,
            |s, _, _: &crate::features::settings::preferences_store::PreferencesChanged, w, cx| {
                s.preferences_changed(w, cx);
                s.refresh_cloud_catalog(false, cx);
                if s.window.restore_last && s.preferences.read(cx).loaded {
                    s.window.restore_last = false;
                    if let Some(path) = windows::last_active_project(cx)
                        && s.files.workspace.is_none()
                    {
                        s.open_project(path, w, cx);
                        // Only an opening that started holds the screen (the
                        // Project may already show in another window).
                        s.window.restoring_open = s.files.opening_root();
                    }
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
        // What the Explorer asks for.
        cx.subscribe_in(&s.explorer, window, |s, _, event, window, cx| {
            match event {
                ExplorerEvent::ReferencesChanged => {}
                ExplorerEvent::Open(path) => s.files.begin(Intent::OpenFile(path.clone()), &s.wake),
                ExplorerEvent::LoadChildren(path) => s.files.load_children(path.clone(), &s.wake),
                ExplorerEvent::ResourceOperation(operation) => {
                    if let Err(error) = s.files.resource_operation(operation.clone(), &s.wake) {
                        s.explorer.update(cx, |e, cx| e.operation_failed(cx));
                        s.show_error(error);
                    }
                }
                ExplorerEvent::Create { entry, parent } => {
                    s.start_create(*entry, parent.clone(), window, cx)
                }
                ExplorerEvent::Rename { path, change_type } => {
                    s.begin_rename(path.clone(), *change_type, window, cx)
                }
                ExplorerEvent::Error(error) => s.show_error(error.clone()),
                ExplorerEvent::WatchFailed(error) => s.window.notice = Some(error.clone()),
                ExplorerEvent::WatchRecovered => s.window.notice = None,
                // `onWorkspaceActivity` → `invalidateGitStatus("working-tree")`.
                ExplorerEvent::ContentChanged => {
                    s.sidebar
                        .source_control
                        .update(cx, |sc, cx| sc.invalidate(cx));
                }
                ExplorerEvent::CopyLink { path, folder } => s.copy_cloud_link(path, *folder, cx),
                ExplorerEvent::Share { path } => s.share_folder(path, window, cx),
            }
            s.receive(window, cx);
            cx.notify();
        })
        .detach();
        cx.observe(&s.preferences, |s, _, cx| {
            s.wake.notify();
            cx.notify()
        })
        .detach();
        cx.subscribe_in(&s.task_ui.settings, window, |s, _, event, w, cx| {
            use crate::features::settings::SettingsEvent;
            match event {
                SettingsEvent::Close => s.close_tasks(w, cx),
                SettingsEvent::ModelConfigurationChanged => s
                    .sidebar
                    .workbench
                    .update(cx, |s, cx| s.reload_agent_configuration(cx)),
                SettingsEvent::ForgetProject(path) => {
                    let path = path.clone();
                    s.preferences
                        .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
                    s.close_tasks(w, cx);
                    if s.files
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
                    s.task_ui.settings.update(cx, |settings, cx| {
                        settings.select_page(crate::features::settings::Page::ModelConnections, cx)
                    });
                    s.command(Command::Settings, w, cx);
                }
                // `openSettingsDialog("account")`.
                crate::features::workbench::WorkbenchEvent::OpenAccount => {
                    s.task_ui.settings.update(cx, |settings, cx| {
                        settings.select_page(crate::features::settings::Page::Account, cx)
                    });
                    s.command(Command::Settings, w, cx);
                }
                // `handleAgentOpenFile`: a path inside the chat's project
                // opens in the editor.
                crate::features::workbench::WorkbenchEvent::OpenAgentFile { root, path } => {
                    if let Some(path) = crate::features::desktop_agent::domain::agent_workspace_path::resolve_agent_workspace_provider_path(
                        &root.to_string_lossy(),
                        path,
                    ) {
                        s.files
                            .begin(Intent::OpenFile(root.join(path)), &s.wake);
                    }
                }
                // A hosted run's accepted changes: reread the Cloud tree and
                // revalidate the open document (a draft is kept).
                crate::features::workbench::WorkbenchEvent::CloudPublished => {
                    if s.hosted_project().is_some() {
                        s.explorer.update(cx, |e, cx| e.refresh_published(cx));
                        s.files.observe_publication();
                        s.receive(w, cx);
                    }
                }
            },
        )
        .detach();
        cx.observe(&s.cloud.agents, |_, _, cx| cx.notify()).detach();
        // A hidden window is not polled for its Agents, and catches up
        // when it returns.
        let agents = s.cloud.agents.downgrade();
        window
            .observe_window_visibility(move |visibility, _, cx| {
                let _ = agents.update(cx, |a, cx| a.set_visible(visibility.is_visible(), cx));
            })
            .detach();
        // Leaving the window abandons a pane drag (`blur` cancels).
        cx.observe_window_activation(window, |s, window, cx| {
            let active = window.is_window_active();
            s.sidebar
                .source_control
                .update(cx, |sc, cx| sc.set_focused(active, cx));
            if !active {
                s.editor.drop = None;
                s.end_pane_drag(false, cx);
                s.end_editor_resize(false, cx);
            } else {
                cx.set_reduce_motion(crate::platform::accessibility::reduce_motion());
                // The catalog refreshes whenever a window regains focus.
                crate::features::sub_theme_catalog::refresh(cx);
                // `browser-window-focus`: bounded foreground activity.
                crate::features::telemetry::note_foreground(cx);
                // A returning window may probe the Cloud association once.
                s.cloud.repository.update(cx, |r, cx| r.probe(cx));
                // A file window watches nothing: the file is read again
                // when the window comes back (FileModeDocument's `focus`).
                if s.file_mode() {
                    s.files.revalidate();
                    s.receive(window, cx);
                    cx.notify();
                }
            }
        })
        .detach();
        // Escape rolls a pane drag back wherever focus is (TS listens on
        // `window` in the capture phase): intercepted before any binding.
        let shell = cx.weak_entity();
        let own = window.window_handle();
        cx.intercept_keystrokes(move |event, window, cx| {
            if window.window_handle() != own || event.keystroke.key != "escape" {
                return;
            }
            let _ = shell.update(cx, |s, cx| {
                if s.editor.drop.take().is_some() {
                    cx.stop_active_drag(window);
                    cx.stop_propagation();
                    cx.notify();
                }
                if s.editor.resize.is_some() {
                    s.end_editor_resize(false, cx);
                    cx.stop_propagation();
                }
                if s.panes.dragging().is_some() {
                    s.end_pane_drag(false, cx);
                    cx.stop_propagation();
                }
            });
        })
        .detach();
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
                    if s.replay_home_intro(cx) {
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
                        s.files
                            .begin(Intent::OpenFile(PathBuf::from(path)), &s.wake);
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
        cx.subscribe_in(&s.editor.front, window, |s, _, event, window, cx| {
            // Pane menu commands (open in default app, close) are the shell's.
            if let ClientMessage::Action { action } = event {
                if s.files.state().is_some() {
                    return;
                }
                if let Some(command) = Command::from_protocol(action) {
                    s.command(command, window, cx);
                }
                return;
            }
            s.files.client_for(0, event.clone(), &s.wake);
            cx.notify();
        })
        .detach();
        cx.subscribe(
            &s.cloud_services,
            |s, _, _: &crate::features::cloud_services::Close, cx| {
                s.modals.remove(|m| matches!(m, Modal::CloudServices));
                cx.notify();
            },
        )
        .detach();
        cx.subscribe(
            &s.cloud_services,
            |s, _, _: &crate::features::cloud_services::ResumePublication, cx| {
                s.resume_publication(cx)
            },
        )
        .detach();
        // Its close button is the only way out; the draft is already gone.
        cx.subscribe_in(
            &s.feedback,
            window,
            |s, _, _: &crate::features::feedback::Close, window, cx| {
                s.close_tasks(window, cx);
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
            s.window.open_first = parsed.open;
            if let Some(path) = parsed.target.filter(|p| p.is_dir()) {
                workspace = Some(path);
            }
        }
        #[cfg(feature = "dev-capture")]
        if std::env::var_os("PUPPYONE_SCREENSHOT").is_some() {
            let surface = std::env::var("PUPPYONE_CAPTURE_SURFACE").unwrap_or_default();
            if surface == "changes" {
                s.panes.set_right_open(true);
            }
            if surface == "agent-panel" || surface == "agent-panel-empty" {
                s.panes.set_right_open(true);
                s.sidebar.workbench.update(cx, |workbench, cx| {
                    workbench.visual_fixture_panel(surface == "agent-panel", window, cx)
                });
            }
            if surface == "agent-empty" || surface == "agent-transcript" {
                s.panes.set_right_open(true);
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
            // The file's folder is the window's root; only the file shows,
            // and it saves when asked. A file that is gone or too large is
            // never read.
            s.files.file_window = true;
            #[cfg(feature = "dev-capture")]
            let hold = std::env::var_os("PUPPYONE_FILE_HOLD").is_some();
            #[cfg(not(feature = "dev-capture"))]
            let hold = false;
            if file.admission == file_mode::Admission::Readable && !hold {
                s.window.open_first = Some(PathBuf::from(&file.name));
                s.files
                    .begin(Intent::OpenFolder(file.root.clone()), &s.wake);
            }
            s.file = Some(file_mode::FileWindow::new(file));
        } else if let Some(path) = workspace {
            if launch.open.is_some() {
                s.window.open_first = launch.open.clone();
            }
            s.files.begin(Intent::OpenFolder(path), &s.wake);
        } else if launch.from_args && !fixture && !cfg!(test) {
            // `readLastActiveWorkspaceComposition`: the last active project.
            s.window.restore_last = true;
        }
        windows::register(window.window_handle(), cx.weak_entity(), cx);
        cx.observe(&s.cloud.catalog, |_, _, cx| cx.notify())
            .detach();
        // `DesktopDialogRoot`'s focus keeper: a control disabled or removed
        // while it holds focus drops focus out of the dialog; focus returns
        // to the nearest surface still there (the dialog's own).
        cx.on_focus_lost(window, |s, window, cx| {
            if !s.modals.is_empty()
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
    }
    /// The parts of the preferences other owners read, handed to them; each
    /// takes only a change (nothing here renders the window again).
    fn apply_projections(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let p = self.preferences.read(cx).state.clone();
        // The built-in Agent offers PuppyOne compute only while Payments is on.
        crate::cloud_auth::set_payments(p.experimental.payments);
        crate::editor::markdown::core::commands::block_move::set_enabled(
            p.experimental.markdown_block_drag,
        );
        self.homepage.recent = p.recent_projects.clone();
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
        self.rail = p.project_switcher_rail;
        // The pane layout (`useDesktopExplorerFrame`), only when it changed:
        // this window's own commits arrive back here as no change.
        let stored = StoredPanes {
            explorer_collapsed: p.sidebar_collapsed,
            explorer_width: p.explorer_width,
            right_width: p.right_sidebar_width,
        };
        if let Some(stored) = self.preference_slices.panes.changed(stored) {
            self.panes.restore(*stored);
        }
        // The surface the closed sidebar opens on (`rightSidebarSurface`).
        if self.preferences.read(cx).loaded {
            let open = self.panes.right().open;
            self.sidebar.restore(p.right_sidebar_surface, open, cx);
        }
        let _ = window;
    }
    /// A dialog takes the window: the modal layer, or the Documents error.
    fn modal(&self) -> bool {
        // A held-back Cloud conflict is a floating notice, not a dialog.
        !self.modals.is_empty() || (self.files.error.is_some() && !self.files.cloud_conflict())
    }
    /// A notice over everything else; a later one replaces it.
    fn show_error(&mut self, error: impl Into<String>) {
        self.modals.open(Modal::Error(error.into()));
    }
    /// Escape on the topmost dialog, each with its own cancel: the Documents
    /// error, then the top of the modal layer. Creating an entry is not
    /// abandoned midway.
    fn dismiss_modal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.files.cloud_conflict() && self.files.error.take().is_some() {
            return;
        }
        match self.modals.top() {
            // Help → Feedback leaves only by its close button ("can only be
            // dismissed with its close button").
            Some(Modal::Task(Task::Feedback)) => {}
            Some(Modal::Task(_)) => self.close_tasks(window, cx),
            Some(Modal::CreateEntry(form)) => {
                if !form.read(cx).busy() {
                    self.modals.remove(|m| matches!(m, Modal::CreateEntry(_)));
                    self.focus.focus(window, cx);
                }
            }
            Some(Modal::CreateProject(_)) => self.close_create_project(window, cx),
            Some(Modal::TemplateImport(_)) => self.dismiss_template(window, cx),
            Some(Modal::ImportRepository(_)) => self.close_import(window, cx),
            Some(Modal::Rename(_)) => self.cancel_rename(window, cx),
            Some(Modal::ConfirmQuit) => {
                self.modals.remove(|m| matches!(m, Modal::ConfirmQuit));
            }
            Some(Modal::CloseAnyway) => {
                self.modals.remove(|m| matches!(m, Modal::CloseAnyway));
                windows::cancel_quit(cx);
            }
            Some(Modal::Executions) => {
                self.modals.remove(|m| matches!(m, Modal::Executions));
            }
            Some(Modal::ProjectEntry) => self.close_project_entry(cx),
            Some(Modal::ProjectFailure { .. }) => {
                self.modals
                    .remove(|m| matches!(m, Modal::ProjectFailure { .. }));
            }
            Some(Modal::Error(_)) => {
                self.modals.remove(|m| matches!(m, Modal::Error(_)));
            }
            Some(Modal::CloudPublish) => {
                self.modals.remove(|m| matches!(m, Modal::CloudPublish));
            }
            Some(Modal::ConfirmPublish) => {
                self.modals.remove(|m| matches!(m, Modal::ConfirmPublish));
            }
            Some(Modal::ReplaceCloud(replace)) => {
                // A replacement on its way cannot be dismissed.
                if !replace.busy {
                    self.modals.remove(|m| matches!(m, Modal::ReplaceCloud(_)));
                }
            }
            Some(Modal::CloudServices) => self.cloud_services.update(cx, |s, cx| s.close(cx)),
            // A change on its way cannot be dismissed (`onClose` is withheld).
            Some(Modal::RenameProject(_) | Modal::ConfirmProject(_)) => {
                self.modals.remove(|m| match m {
                    Modal::RenameProject(r) => !r.pending,
                    Modal::ConfirmProject(c) => !c.pending,
                    _ => false,
                });
                self.homepage.actions = None;
            }
            Some(Modal::CloudRecovery { .. }) => {
                self.modals
                    .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
            }
            Some(Modal::ManageAgents) => self.close_manage_agents(window, cx),
            None => {}
        }
    }
    fn pick_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.pending || self.files.busy() || self.files.folder_busy {
            return;
        }
        self.pending = true;
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some(crate::localization::t("onboarding.action.openLocalFolder").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = prompt.await;
            let _ = this.update_in(cx, |s, w, cx| {
                s.pending = false;
                match result {
                    Ok(Ok(Some(paths))) => {
                        if let Some(path) = paths.into_iter().next() {
                            s.open_project(path, w, cx);
                        }
                    }
                    Ok(Err(e)) => s.show_error(e.to_string()),
                    Err(e) => s.show_error(e.to_string()),
                    _ => {}
                }
                s.receive(w, cx);
                cx.notify();
            });
        })
        .detach();
    }
    pub fn command(&mut self, command: Command, window: &mut Window, cx: &mut Context<Self>) {
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
                if self.open_editors().is_some() {
                    self.files.begin(Intent::CloseFile, &self.wake);
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
            self.end_editor_resize(false, cx);
        }
        match command {
            // `askToSaveFile`: a file window with unsaved edits asks first.
            Command::Quit if self.file_mode() && self.files.dirty => {
                self.ask_to_save_file(window, cx);
                return;
            }
            Command::SaveFileAndClose => {
                self.files.begin(Intent::Quit, &self.wake);
                self.receive(window, cx);
                cx.notify();
                return;
            }
            Command::DiscardFileChanges => {
                self.files.abandon_unsaved();
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
                self.modals.open(Modal::ConfirmQuit);
                self.focus.focus(window, cx);
                cx.notify();
                return;
            }
            Command::QuitWithProcesses => {
                self.modals.remove(|m| matches!(m, Modal::ConfirmQuit));
                self.files.begin(Intent::Quit, &self.wake);
                self.receive(window, cx);
                cx.notify();
                return;
            }
            Command::CancelProcessQuit => {
                self.modals.remove(|m| matches!(m, Modal::ConfirmQuit));
                windows::cancel_quit(cx);
                cx.notify();
                return;
            }
            Command::KeepWindowOpen => {
                self.modals.remove(|m| matches!(m, Modal::CloseAnyway));
                windows::cancel_quit(cx);
                self.focus.focus(window, cx);
                cx.notify();
                return;
            }
            Command::CloseAnyway => {
                self.modals.remove(|m| matches!(m, Modal::CloseAnyway));
                self.files.abandon_unsaved();
                self.receive(window, cx);
                cx.notify();
                return;
            }
            // Escape answers the topmost dialog (Help → Feedback ignores it,
            // `dismiss_modal`).
            Command::Escape if self.modal() => {
                self.dismiss_modal(window, cx);
                self.receive(window, cx);
                cx.notify();
                return;
            }
            _ => {}
        }
        // While a task dialog is open the shell's other commands wait;
        // ⌘, toggles Settings (from Help, it switches and drops the draft).
        if let Some(task) = self.modals.task() {
            match command {
                Command::Settings if task == Task::Settings => self.close_tasks(window, cx),
                Command::Settings => {
                    self.feedback.update(cx, |f, cx| f.reset(cx));
                    self.modals.open(Modal::Task(Task::Settings));
                    self.focus.focus(window, cx);
                }
                Command::Quit => self.files.begin(Intent::Quit, &self.wake),
                _ => {}
            }
            self.receive(window, cx);
            cx.notify();
            return;
        }
        match command {
            Command::Undo | Command::Redo => {
                if !self.modal()
                    && !self.files.busy()
                    && let Some(id) = self.files.document.as_ref().map(|doc| doc.id.clone())
                {
                    self.files
                        .outgoing
                        .push(crate::documents::HostMessage::History {
                            id,
                            redo: command == Command::Redo,
                        });
                }
            }
            Command::Save => self.files.begin(Intent::Save, &self.wake),
            Command::Reload => self.files.begin(Intent::Reload, &self.wake),
            Command::CloseFile => self.files.begin(Intent::CloseFile, &self.wake),
            // Pane menu "Open in default app" (`EditorPaneActionsMenu`).
            Command::OpenExternal => {
                if let (Some(ws), Some((_, relative))) =
                    (&self.files.workspace, self.files.opened())
                {
                    match ws.absolute(relative) {
                        Ok(path) => {
                            if let Err(e) = crate::platform::desktop::open(&path) {
                                self.show_error(e);
                            }
                        }
                        Err(e) => self.show_error(e.to_string()),
                    }
                }
            }
            Command::Quit => self.files.begin(Intent::Quit, &self.wake),
            Command::OpenFolder => self.pick_workspace(window, cx),
            Command::CreateNew => self.open_project_entry(cx),
            Command::RetryProjectOpen => {
                let failed = self.modals.iter().find_map(|m| match m {
                    Modal::ProjectFailure { path, .. } => Some(path.clone()),
                    _ => None,
                });
                self.modals
                    .remove(|m| matches!(m, Modal::ProjectFailure { .. }));
                if let Some(path) = failed {
                    self.open_project(path, window, cx);
                }
            }
            Command::CloseProjectFailure => {
                self.modals
                    .remove(|m| matches!(m, Modal::ProjectFailure { .. }));
            }
            Command::ToggleExplorer => {
                self.panes.toggle_explorer();
                self.persist_panes(cx);
            }
            Command::ToggleRightSidebar => {
                let open =
                    self.sidebar
                        .toggle_agent(self.panes.right().open, &self.preferences, cx);
                self.panes.set_right_open(open);
            }
            Command::Settings => {
                self.popover = None;
                self.explorer.update(cx, |e, cx| e.dismiss_menu(cx));
                self.modals.open(Modal::Task(Task::Settings));
                self.modal_focus.focus(window, cx);
            }
            Command::Feedback => {
                self.popover = None;
                self.explorer.update(cx, |e, cx| e.dismiss_menu(cx));
                self.modals.open(Modal::Task(Task::Feedback));
                let message = self.feedback.read(cx).message.focus_handle(cx);
                message.focus(window, cx);
            }
            Command::ProjectMenu => {
                self.popover = if self.popover == Some(Popover::Project) {
                    None
                } else {
                    Some(Popover::Project)
                };
                self.project_focus.focus(window, cx);
            }
            Command::LocationMenu => {
                self.popover = if self.popover == Some(Popover::Place) {
                    None
                } else {
                    Some(Popover::Place)
                };
            }
            Command::Home => {
                self.popover = None;
                self.explorer.update(cx, |e, cx| e.dismiss_menu(cx));
                if !self.home_visible() {
                    self.hold_home_list();
                }
                self.homepage.open = true;
            }
            // With no dialog open, Escape closes a menu.
            // Escape cancels a Cloud opening; whatever showed stays.
            Command::Escape if self.files.cloud_opening().is_some() => {
                self.files.cancel_cloud();
            }
            // Escape inside History goes back (`CloudWorkspaceHistorySidebar`).
            Command::Escape
                if self.right_shows(Surface::CloudHistory)
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
                if !self.modal() && !self.file_mode() {
                    let text = cx
                        .read_from_clipboard()
                        .and_then(|item| item.text())
                        .unwrap_or_default();
                    if crate::platform::templates::link::looks_like(&text) {
                        self.open_template_link(text.trim().to_owned(), window, cx);
                    }
                }
            }
            // Only Markdown's viewer takes the shortcut (`MarkdownViewer`'s
            // `enableModeToggleShortcut`).
            Command::ToggleMarkdownSource => {
                let markdown = self.editor.front.read(cx).viewer_id() == Some("markdown");
                if markdown && !self.files.busy() && !self.modal() && !self.home_visible() {
                    self.editor
                        .front
                        .update(cx, |s, cx| s.command("source", window, cx));
                }
            }
            Command::NextEditor | Command::PreviousEditor => {
                if let Some((editors, active)) = self.open_editors() {
                    let step = if command == Command::NextEditor {
                        1
                    } else {
                        editors.len() - 1
                    };
                    let next = (active + step) % editors.len();
                    self.files.activate(&editors[next]);
                    self.sync_editor(window, cx);
                }
            }
            Command::ToggleFullScreen => window.toggle_fullscreen(),
            Command::RetryFileOperation => {
                self.modals.remove(|m| matches!(m, Modal::Error(_)));
                self.files.error = None;
                self.files.retry_operation(&self.wake);
            }
            Command::ClearError => {
                self.modals.remove(|m| matches!(m, Modal::Error(_)));
                self.files.error = None;
            }
            Command::CloudServices => self.open_cloud_share(String::new(), window, cx),
            Command::CloudHistory => {
                let Some(project) = self.hosted_project() else {
                    return;
                };
                self.popover = None;
                let open = self
                    .sidebar
                    .toggle_cloud_history(self.panes.right().open, &project, cx);
                self.panes.set_right_open(open);
                if open {
                    let history = self.sidebar.cloud_history.read(cx).focus_handle().clone();
                    history.focus(window, cx);
                } else {
                    self.focus.focus(window, cx);
                }
            }
            Command::ReloadCloudBaseline => {
                self.files.reload_cloud_baseline();
                self.receive(window, cx);
            }
            Command::ManageExecutions => {
                self.popover = None;
                self.modals.remove(|m| matches!(m, Modal::Executions));
                self.modals.open(Modal::Executions);
                self.modal_focus.focus(window, cx);
            }
            Command::CloseExecutions => {
                self.modals.remove(|m| matches!(m, Modal::Executions));
                self.focus.focus(window, cx);
            }
            Command::Changes => {
                if self.files.workspace.is_none() {
                    return;
                }
                let open = self
                    .sidebar
                    .toggle_git(self.panes.right().open, &self.preferences, cx);
                self.panes.set_right_open(open);
                self.focus.focus(window, cx);
            }
            _ => {}
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// Closes Settings or Help; Help's draft goes with it.
    fn close_tasks(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.modals.task() == Some(Task::Feedback) {
            self.feedback.update(cx, |f, cx| f.reset(cx));
        }
        self.modals.remove(|m| matches!(m, Modal::Task(_)));
        self.focus.focus(window, cx);
    }
    fn receive(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        crate::platform::watchdog::activity("shell.receive");
        let previous = self.files.opened().map(|(id, _)| id.to_owned());
        self.files.poll(&self.wake);
        if let Some((path, message)) = self.files.root_failure.take() {
            self.window.restoring_open = false;
            self.modals
                .remove(|m| matches!(m, Modal::ProjectFailure { .. }));
            self.modals.open(Modal::ProjectFailure { path, message });
        }
        if self.window.restoring_open && self.files.workspace.is_some() {
            self.window.restoring_open = false;
        }
        // A Cloud opening that failed says why (`ProjectNavigationFailure`).
        if let Some(failure) = self.files.take_cloud_failure() {
            self.window.recovery_details = false;
            self.modals
                .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
            self.modals.open(Modal::CloudRecovery {
                project: self.window.cloud.clone().unwrap_or_default(),
                failure,
            });
        }
        // `finishInterceptedClose`: a close a document could not finish asks
        // whether to keep the window or close anyway, instead of the error.
        if std::mem::take(&mut self.files.close_refused) {
            self.files.error = None;
            if !self.modals.iter().any(|m| matches!(m, Modal::CloseAnyway)) {
                self.modals.open(Modal::CloseAnyway);
            }
            self.modal_focus.focus(window, cx);
        }
        for (owner, outcome) in std::mem::take(&mut self.files.operation_results) {
            self.explorer
                .update(cx, |e, cx| e.finish_op(&owner, outcome, cx));
        }
        if let Some(nodes) = self.files.tree_update.take() {
            self.editor.drop = None;
            self.end_editor_resize(false, cx);
            let ws = self.files.workspace.clone().unwrap();
            self.explorer
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
            self.window.name = ws.name().to_owned();
            self.window.entries += 1;
            self.window.fixture = false;
            self.modals.remove(|m| matches!(m, Modal::Error(_)));
            self.homepage.open = false;
            let opened = ws.local_root().map(PathBuf::from);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or_default();
            // A file window's folder is not a project to remember.
            if !cfg!(test)
                && self.file.is_none()
                && let Some(opened) = opened
            {
                self.preferences.update(cx, |p, cx| {
                    p.change(|p| p.remember_project(&opened, now), cx)
                });
            }
        }
        if let Some((path, result)) = self.files.children_update.take() {
            self.explorer
                .update(cx, |e, cx| e.children_loaded(&path, result, cx));
        }
        if let Some((id, relative)) = self.files.opened()
            && previous.as_deref() != Some(id)
        {
            let relative = relative.to_path_buf();
            self.explorer.update(cx, |e, cx| e.reveal(&relative, cx));
        }
        if self.files.workspace.is_some()
            && !self.files.busy()
            && let Some(path) = self.window.open_first.take()
        {
            self.files.begin(Intent::OpenFile(path), &self.wake);
        }
        self.sync_editor(window, cx);
        if self.files.allow_quit
            && self
                .modals
                .create_entry()
                .is_some_and(|f| f.read(cx).busy())
        {
            return;
        }
        if self.files.allow_quit && !self.preferences.read(cx).drained() {
            if let Some(error) = self.preferences.read(cx).error.clone() {
                self.show_error(error);
                self.files.cancel_quit(&self.wake);
                windows::cancel_quit(cx);
                self.sync_editor(window, cx);
            }
            return;
        }
        if self.files.allow_quit {
            // The account owner is process-wide: only the app's end drains
            // it; closing one of several windows (or, on macOS, the last
            // one) leaves it running.
            if windows::count(cx) <= 1 && windows::last_close_quits(cx) {
                match crate::features::cloud_account::prepare_close(cx) {
                    Ok(true) => {}
                    Ok(false) => return,
                    Err(error) => {
                        self.files.cancel_quit(&self.wake);
                        windows::cancel_quit(cx);
                        self.sync_editor(window, cx);
                        self.show_error(error.to_string());
                        return;
                    }
                }
            }
            self.sidebar.workbench.update(cx, |s, cx| s.shutdown(cx));
            // Window retirement blocks new editor allocations and waits for
            // this window's admitted tasks to confirm their exit.
            let scheduler = crate::platform::tasks::Scheduler::global();
            let _hold = scheduler.hold_admission();
            let _ = scheduler.retire(&self.window_key, None, None);
            windows::unregister(window.window_handle(), cx);
            window.remove_window();
        }
    }
    fn sync_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.files.persist_metadata(&self.wake, false);
        let file = self.file_mode();
        let active = self.files.active_slot();
        let mut focus_native = self
            .editor
            .hosts
            .get(&active)
            .is_some_and(|e| e != &self.editor.front);
        for _ in 0..4 {
            let messages = self.files.take_outgoing();
            if messages.is_empty() {
                break;
            }
            for (slot, message) in messages {
                if let std::collections::btree_map::Entry::Vacant(entry) =
                    self.editor.hosts.entry(slot)
                {
                    self.editor.tab_focus.insert(slot, cx.focus_handle());
                    let owner = cx.entity_id();
                    let file_mode = self.file.is_some();
                    let editor = cx.new(|cx| {
                        let mut editor = crate::editor::host::DocumentEditor::new(cx);
                        editor.workbench = true;
                        editor.file_mode = file_mode;
                        editor.pane_drag =
                            Some(crate::editor::workbench::pane::PaneDrag { owner, slot });
                        editor
                    });
                    cx.subscribe_in(
                        &editor,
                        window,
                        move |s, _, event: &ClientMessage, window, cx| {
                            if let ClientMessage::Action { action } = event {
                                if s.files.visible_slots().contains(&slot) && !s.modal() {
                                    s.focus_editor_slot(slot);
                                    if action == "close-file" {
                                        if let Some(mut state) = s.files.state_mut() {
                                            let active = state.layout.active.clone();
                                            state.close_pane(&active);
                                        }
                                    } else if let Some(command) = Command::from_protocol(action) {
                                        s.command(command, window, cx);
                                    }
                                    s.sync_editor(window, cx);
                                }
                            } else {
                                s.files.client_for(slot, event.clone(), &s.wake);
                            }
                            cx.notify();
                        },
                    )
                    .detach();
                    entry.insert(editor);
                }
                focus_native |= slot == active
                    && matches!(
                        message,
                        crate::documents::HostMessage::Open { .. }
                            | crate::documents::HostMessage::OpenResource { .. }
                    );
                let references = self.files.slot(slot).filter(|_| !file).and_then(|files| {
                    let workspace = files.workspace.as_ref()?;
                    let (_, path) = files.opened()?;
                    self.explorer.update(cx, |explorer, _| {
                        explorer.reference_context(workspace, path)
                    })
                });
                let workspace = self
                    .files
                    .slot(slot)
                    .filter(|_| !file)
                    .and_then(|files| files.workspace.clone());
                let replies = self.editor.hosts[&slot].update(cx, |s, cx| {
                    s.set_reference_context(references, cx);
                    s.set_workspace(workspace);
                    s.receive(&message, window, cx)
                });
                for reply in replies {
                    self.files.client_for(slot, reply, &self.wake);
                }
            }
        }
        let retained = self.files.retained_slots();
        self.editor.hosts.retain(|id, _| retained.contains(id));
        self.editor.tab_focus.retain(|id, _| retained.contains(id));
        if let Some(editor) = self.editor.hosts.get(&active) {
            self.editor.front = editor.clone();
        }
        let modal = self.modal() || self.sidebar.workbench.read(cx).dialog_open();
        let home = self.home_visible();
        let visible = self.files.visible_slots();
        let read_only = self.file_read_only();
        for (slot, editor) in &self.editor.hosts {
            // A lone file has no neighbours (`EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT`).
            let references = self.files.slot(*slot).filter(|_| !file).and_then(|files| {
                let workspace = files.workspace.as_ref()?;
                let (_, path) = files.opened()?;
                self.explorer.update(cx, |explorer, _| {
                    explorer.reference_context(workspace, path)
                })
            });
            let blocked = modal
                || home
                || !visible.contains(slot)
                || self
                    .files
                    .slot(*slot)
                    .is_none_or(|f| f.busy() || f.allow_quit);
            editor.update(cx, |s, cx| {
                s.set_reference_context(references, cx);
                s.read_only = read_only;
                s.gate(blocked, self.dark, window, cx);
            });
        }
        if home || (active == 0 && self.files.state().is_some()) {
            self.focus.focus(window, cx);
            focus_native = false;
        }
        #[cfg(feature = "dev-capture")]
        if std::env::var_os("PUPPYONE_SCREENSHOT").is_some()
            && std::env::var("PUPPYONE_EDITOR_FOCUS").as_deref() == Ok("0")
        {
            focus_native = false;
        }
        if focus_native && !modal && !self.files.busy() {
            self.editor
                .front
                .update(cx, |editor, cx| editor.focus_document(window, cx));
        }
    }
    /// `useHomepageCloudProjects`: load or revalidate the account catalog.
    pub(super) fn refresh_cloud_catalog(&mut self, retry: bool, cx: &mut Context<Self>) {
        let enabled = crate::features::flags::cloud_enabled(&self.preferences, cx);
        self.cloud
            .catalog
            .update(cx, |c, cx| c.ensure(enabled, retry, cx));
    }
    /// Captures: the Header shows the Cloud tools.
    fn capture_hosted(&self) -> bool {
        #[cfg(feature = "dev-capture")]
        return self.cloud.capture_hosted;
        #[cfg(not(feature = "dev-capture"))]
        false
    }
    /// The hosted Project this window shows (a Cloud workspace, no local root).
    fn hosted_project(&self) -> Option<String> {
        self.files
            .workspace
            .as_ref()
            .filter(|ws| ws.local_root().is_none())
            .and(self.window.cloud.clone())
    }
    /// `openShareWizard`: the open Project's Share section, starting from
    /// `path` (empty is the whole Project). A hosted Project is its own;
    /// a checkout's is the one it resolved to.
    fn open_cloud_share(&mut self, path: String, window: &mut Window, cx: &mut Context<Self>) {
        self.popover = None;
        let project = self.hosted_project().or_else(|| {
            let cloud = self.cloud.repository.read(cx);
            cloud.context.project().map(str::to_owned)
        });
        match project {
            Some(project) => {
                use crate::features::cloud_services::Section;
                let share = crate::features::flags::share_enabled(&self.preferences, cx);
                self.cloud_services.update(cx, |s, cx| {
                    s.share = share;
                    s.open(project, Section::Share, cx);
                    s.start_from(path, cx);
                });
                self.report_publication(cx);
                self.modals.open(Modal::CloudServices);
                self.modal_focus.focus(window, cx);
            }
            // No Cloud Project yet: the value page and its publisher.
            None => self.put_in_cloud(window, cx),
        }
    }
    /// "Share with…": `providerPath`, the folder relative to the Project.
    fn share_folder(
        &mut self,
        path: &std::path::Path,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !crate::features::flags::share_enabled(&self.preferences, cx) {
            return;
        }
        let path: Vec<_> = path
            .components()
            .map(|part| part.as_os_str().to_string_lossy())
            .collect();
        self.open_cloud_share(path.join("/"), window, cx);
    }
    /// History closed itself (Close, Back): the sidebar closes on it.
    fn close_cloud_history(&mut self, cx: &mut Context<Self>) {
        if self.sidebar.is(Surface::CloudHistory) {
            self.panes.set_right_open(false);
        }
        self.sidebar.close_cloud_history(cx);
    }
    /// A project's editor tabs and the active one's index, while they show
    /// (`activeView === "data"` with editors): what ⌘W and ⌃Tab act on.
    fn open_editors(&self) -> Option<(Vec<String>, usize)> {
        if self.file_mode() || self.home_visible() {
            return None;
        }
        let catalog = &self.files.state()?.catalog;
        let editors: Vec<String> = catalog.editors.iter().map(|e| e.id.clone()).collect();
        let active = editors
            .iter()
            .position(|id| Some(id) == catalog.active.as_ref())?;
        Some((editors, active))
    }
    /// The right sidebar is open on `surface`.
    fn right_shows(&self, surface: Surface) -> bool {
        self.panes.right().open && self.sidebar.is(surface)
    }
    /// History out of its scope closes (`useCloudWorkspaceSidebar`).
    fn guard_cloud_history(&mut self, cx: &mut Context<Self>) {
        let project = self.hosted_project();
        let open = self.panes.right().open;
        if self
            .sidebar
            .guard_cloud_history(open, project.as_deref(), cx)
        {
            self.panes.set_right_open(false);
        }
    }
    /// Explicit Cloud opening of a hosted Project root in this window.
    /// `cloudWorkspaceShareResource`: the selected folder, else the active
    /// document, else the authorized root.
    fn copy_cloud_link(&mut self, path: &std::path::Path, folder: bool, cx: &mut Context<Self>) {
        let link = crate::features::cloud_account::broker_and_binding(cx)
            .zip(self.window.cloud.clone())
            .ok_or("Cloud link unavailable")
            .and_then(|((_, binding), project)| {
                crate::workspace::cloud::locator::resource_url(
                    binding.environment.web(),
                    &project,
                    &path.to_string_lossy(),
                    folder,
                )
            });
        match link {
            Ok(link) => cx.write_to_clipboard(ClipboardItem::new_string(link)),
            Err(detail) => self.show_error(crate::localization::tf(
                "workspace.node.error.operationFailedDetail",
                &[("detail", detail.into())],
            )),
        }
    }
    pub(super) fn open_cloud(&mut self, project: String, cx: &mut Context<Self>) {
        // `ProjectNavigation.select`: the same target while it is pending
        // joins that opening; another one replaces it.
        let account = cloud_authority::account_key(cx);
        if self.files.cloud_opening().is_some()
            && self.window.cloud.as_deref() == Some(project.as_str())
            && self.window.authority == account
            && account.is_some()
        {
            return;
        }
        self.window.cloud = Some(project.clone());
        self.window.authority = account;
        let Some((broker, binding)) = crate::features::cloud_account::broker_and_binding(cx) else {
            self.show_error(crate::localization::t(
                "cloud.message.project-sign-in-required",
            ));
            return;
        };
        self.files.open_cloud(broker, binding, project, &self.wake);
        cx.notify();
    }
    /// The local project this window shows.
    pub fn workspace_root(&self) -> Option<PathBuf> {
        self.files
            .workspace
            .as_ref()
            .and_then(|ws| ws.local_root().map(PathBuf::from))
    }
    /// Switch to a remembered project (`onSelectProject`).
    pub(super) fn open_project(
        &mut self,
        path: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.popover = None;
        if self
            .files
            .workspace
            .as_ref()
            .is_some_and(|ws| ws.local_root() == Some(path.as_path()))
        {
            self.homepage.open = false;
        } else if !self.pending && !self.files.navigation_blocked() {
            // `ProjectNavigation.select`: a newer choice replaces the one
            // still opening.
            self.files.begin(Intent::OpenFolder(path), &self.wake);
        }
        self.receive(window, cx);
        cx.notify();
    }
    fn editor(&self, cx: &mut Context<Self>) -> Div {
        // A project with no open document shows the quiet editor canvas.
        let r = self.layout.editor;
        let mut canvas = at(r).bg(cx.palette().canvas);
        if let Some(state) = self.files.state() {
            canvas =
                canvas.child(self.editor_node(&state.layout.root, Rect::new(0., 0., r.w, r.h), cx));
        } else if self.files.opened().is_some() {
            canvas = canvas.child(at(Rect::new(0., 0., r.w, r.h)).child(self.editor.front.clone()));
        }
        canvas
    }
    /// Compact `ProjectSwitcherRail`: one mark per remembered project.
    fn project_rail(&self, h: f32, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let current = self
            .files
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
        for (index, project) in self.homepage.recent.iter().take(12).enumerate() {
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
                            s.open_project_actions(target.clone(), at, false, w.viewport_size(), cx)
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
    /// `.po-pane-edge-resize-handle` + `.po-pane-edge-chrome`: an 8px
    /// transparent hit lane whose only paint is the 1px divider — the
    /// Explorer's own last column, the right sidebar's first — plus the
    /// adjacent hover / active stroke (and ring while dragging).
    fn sash(&self, left: bool, cx: &mut Context<Self>) -> ResizeHandle {
        use gpui_kit::base::Disableable as _;
        let t = cx.palette();
        // The frames' edges, also mid-motion: the main pane follows them.
        let x = if left {
            self.layout.editor.x - 1.
        } else {
            self.layout.editor.right()
        };
        let side = if left { Side::Start } else { Side::End };
        // A pane that is closing (or previewing closed) keeps its edge
        // painted but cannot be grabbed (`onPointerDown` while collapsed).
        let grabbable = self.panes.pane(side).open;
        ResizeHandle::new(
            if left { "left-sash" } else { "right-sash" },
            Axis::Horizontal,
        )
        .divider(t.sidebar_divider)
        .stroke_at(1.)
        .resizing(self.panes.dragging() == Some(side))
        .disabled(!grabbable)
        .on_drag_start(
            cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                s.begin_pane_drag(side, e.position, cx)
            }),
        )
        .absolute()
        .left(px(x))
        .top(px(self.layout.editor.y))
        .w(px(theme::metric::PANE_SASH))
        .h(px(self.layout.editor.h))
    }
    /// `.po-collapsed-pane-edge-handle--inline-end`: a closed right
    /// sidebar keeps a 12px lane at the window edge to pull it back out,
    /// marked by a faint line that firms up on hover.
    fn collapsed_right_edge(&self, w: f32, cx: &mut Context<Self>) -> ResizeHandle {
        let t = cx.palette();
        let lane = theme::pane::COLLAPSED_EDGE_HIT;
        ResizeHandle::new("right-collapsed-edge", Axis::Horizontal)
            .stroke_at(lane - 1.)
            .rest(theme::alpha(t.shell_divider, 0.72))
            .hover(t.border_strong)
            .cursor(CursorStyle::ResizeLeft)
            .on_drag_start(cx.listener(|s, e: &MouseDownEvent, _, cx| {
                s.begin_pane_drag(Side::End, e.position, cx)
            }))
            .absolute()
            .left(px(w - lane))
            .top(px(self.layout.editor.y))
            .w(px(lane))
            .h(px(self.layout.editor.h))
    }
    /// The width the panes share: the window, less the project rail.
    fn rail_width(&self) -> f32 {
        if self.rail {
            theme::metric::PROJECT_RAIL_WIDTH
        } else {
            0.
        }
    }
    /// What the Explorer needs from the shell this frame (`Host`).
    fn sync_explorer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let host = Host {
            frame: self.layout.explorer,
            open: self.panes.explorer().open,
            opened: self
                .files
                .opened()
                .map(|(_, relative)| relative.to_path_buf()),
            open_resources: self.files.open_paths(),
            documents_busy: self.files.busy(),
            folder_busy: self.files.folder_busy,
            picking: self.pending,
        };
        self.explorer
            .update(cx, |explorer, cx| explorer.sync(host, window, cx));
    }
    /// `DesktopSidebarFooterNavigation`: Settings, Help and the busy cue.
    fn footer(&self, cx: &mut Context<Self>) -> SidebarFooter {
        let busy = self.pending
            || self.files.busy()
            || self.files.folder_busy
            || self.explorer.read(cx).busy();
        let shell = cx.weak_entity();
        SidebarFooter::new(move |command, window, cx| {
            let _ = shell.update(cx, |s, cx| s.command(command, window, cx));
        })
        .task(self.modals.task())
        .busy(busy)
    }
    /// The project being entered in this window, named as its Header will
    /// name it (`projectOpening.projectName`).
    pub(super) fn opening_project_name(&self, cx: &App) -> Option<String> {
        if self.files.cloud_opening().is_some() {
            let project = self.window.cloud.as_deref()?;
            return Some(
                self.project_items(cx)
                    .into_iter()
                    .find(|i| i.cloud_project.as_deref() == Some(project))
                    .map(|i| i.label)
                    .unwrap_or_else(|| project.to_owned()),
            );
        }
        let root = self.files.preparing_root()?;
        Some(
            self.homepage
                .recent
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
    fn sync_window_title(&mut self, window: &mut Window) {
        let (title, path, edited) = match self.file.as_ref().map(|f| &f.target) {
            Some(file) => (file.name.clone(), Some(file.path.clone()), self.files.dirty),
            None => {
                let root = self.workspace_root();
                let title = if root.is_some() && !self.window.name.is_empty() {
                    format!("{} - {}", windows::APP_NAME, self.window.name)
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
        if self.window_title.as_ref() != Some(&next) {
            window.set_window_title(&next.0);
            window.set_document_path(next.1.as_deref());
            window.set_window_edited(next.2);
            self.window_title = Some(next);
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
        let home = self.home_visible();
        if home {
            let mut bar = header::TitleBar::new();
            let has_projects = !self.project_items(cx).is_empty() || self.homepage.list_held();
            if has_projects {
                bar = bar.leading(header::brand_name(cx));
            }
            if crate::features::flags::cloud_enabled(&self.preferences, cx) {
                bar = bar.action(self.homepage_account(cx));
            }
            return bar;
        }
        // `ProjectWindow` while another project is on its way in: the
        // Header states that project and its location, and what belongs to
        // the project on screen steps out of it.
        let opening = self.opening();
        let hosted = if opening {
            self.files.cloud_opening().is_some()
        } else {
            self.hosted_project().is_some() || self.capture_hosted()
        };
        let (changes, agent, tabs) = {
            let p = &self.preferences.read(cx).state;
            (
                !hosted
                    && self
                        .files
                        .workspace
                        .as_ref()
                        .is_some_and(|ws| ws.local_root().is_some())
                    && p.header_changes,
                p.header_terminal || hosted,
                p.experimental.editor_tabs_in_header,
            )
        };
        let project =
            !self.rail && (self.files.workspace.is_some() || self.window.fixture || opening);
        let mut bar = header::TitleBar::new().cloud(hosted);
        if !self.panes.explorer().open {
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
        if tabs && self.files.state().is_some() {
            bar = bar.tabs(self.editor_tabs(cx));
        }
        if hosted {
            if let Some(agents) = self.agents_control(cx) {
                bar = bar.action(agents);
            }
            bar = bar.action(self.share_control(cx)).divider(cx);
        } else {
            // `cloudEnabled && shareEnabled`: a local folder's Cloud services.
            let share = self.workspace_root().is_some()
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
                    .selected(self.right_shows(Surface::Git))
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
            let button = header::agent_entry(self.right_shows(Surface::Agent))
                .when(introduced, |b| b.variant(ButtonVariant::TitlebarCoachmark))
                .on_click(cx.listener(|s, _, w, cx| s.command(Command::ToggleRightSidebar, w, cx)))
                .into_any_element();
            bar = bar.action(self.coachmark_anchor(coachmarks::Coachmark::Agent, button, cx));
        }
        bar
    }
    /// Start dragging a pane edge (`useCollapsiblePaneResize`).
    fn begin_pane_drag(&mut self, side: Side, position: Point<Pixels>, cx: &mut Context<Self>) {
        let available = self.layout.header.w - self.rail_width();
        self.panes.begin_drag(side, position, available);
        cx.stop_propagation();
        cx.notify();
    }
    /// The pointer moved during a pane drag: only the preview changes.
    fn move_pane_drag(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        if self.panes.move_drag(position) {
            cx.notify();
        }
    }
    /// Release commits the gesture once; Escape (or losing the window)
    /// rolls the preview back.
    fn end_pane_drag(&mut self, commit: bool, cx: &mut Context<Self>) {
        let was_open = self.panes.right().open;
        let Some(changed) = self.panes.end_drag(commit) else {
            return;
        };
        if !was_open && self.panes.right().open {
            self.sidebar.pulled_out();
        }
        if changed {
            self.persist_panes(cx);
        }
        cx.notify();
    }
    /// Store the committed pane layout (`setExplorerWidth`,
    /// `setSidebarCollapsed`, `setRightSidebarWidth`).
    fn persist_panes(&mut self, cx: &mut Context<Self>) {
        let stored = self.panes.stored();
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
    fn constrain_window(&mut self, window: &mut Window) {
        // A file window has no panes: the window's own 720 × 520 holds.
        if self.file_mode() {
            return;
        }
        let Some(minimum) = self.panes.take_window_minimum(self.rail_width()) else {
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
        // Native web content draws above GPUI: overlays hide it, and only
        // surfaces painted in this frame stay visible.
        crate::web_host::set_overlay(window, !self.modals.is_empty() || self.popover.is_some());
        crate::web_host::frame_drawn(window);
        if !cx.has_active_drag() {
            self.editor.drop = None;
            self.homepage.dragging_path = None;
        }
        #[cfg(test)]
        {
            self.frames += 1;
        }
        let size = window.viewport_size();
        let w = f32::from(size.width);
        let h = f32::from(size.height);
        let rail = self.rail_width();
        self.constrain_window(window);
        let panes = self.panes.frame(w, h, rail, cx.reduce_motion());
        self.layout = if self.file_mode() {
            // `.file-mode-window`: the title bar over the document alone.
            Layout::new(w, h, 0., 0., 0.)
        } else {
            panes.layout
        };
        if panes.running {
            window.request_animation_frame();
        }
        self.sync_editor(window, cx);
        self.sync_explorer(window, cx);
        self.guard_cloud_history(cx);
        self.sync_cloud_agents(cx);
        self.sync_repository_cloud(cx);
        self.sync_cloud_publish(cx);
        self.guard_cloud_authority(window, cx);
        self.refresh_home_activity(cx);
        self.sync_first_run(cx);
        self.sync_home_intro(window, cx);
        self.sync_coachmarks(cx);
        self.sync_window_title(window);
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
                self.show_error(error.to_string());
            }
        }
        let t = cx.palette();
        // ⌘V on the Homepage takes a template link (`onPaste`); elsewhere a
        // paste belongs to what is focused.
        let homepage = self.home_visible();
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
            .track_focus(&self.focus)
            .on_mouse_move(cx.listener(|s, e: &MouseMoveEvent, _, cx| {
                s.move_pane_drag(e.position, cx);
                s.move_editor_resize(e.position, cx);
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|s, e: &MouseUpEvent, _, cx| {
                    if s.editor.resize.is_some() {
                        s.move_editor_resize(e.position, cx);
                        s.end_editor_resize(true, cx);
                    }
                    if s.panes.dragging().is_some() {
                        s.move_pane_drag(e.position, cx);
                        s.end_pane_drag(true, cx);
                    }
                }),
            )
            .child(if self.file_mode() {
                self.file_document(cx)
            } else {
                self.editor(cx)
            });
        let weak = cx.weak_entity();
        root = on_shell_actions(root, move |command, window, cx| {
            let _ = weak.update(cx, |s, cx| s.command(command, window, cx));
        });
        let home = self.home_visible();
        if home {
            root = root.child(if self.first_run_sign_in(cx) {
                self.first_run_view(cx).into_any_element()
            } else {
                self.home_view(window, cx)
            });
        }
        // A closing pane stays painted, clipped to its frame, until it has closed.
        let file = self.file_mode();
        if (self.panes.explorer().open || panes.left_clip.is_some()) && !home && !file {
            let explorer = div()
                .absolute()
                .top_0()
                .left_0()
                .size_full()
                .child(at(self.layout.explorer).child(self.explorer.clone().cached(fill())))
                .when(self.layout.footer.h > 0., |d| {
                    d.child(at(self.layout.footer).child(self.footer(cx)))
                });
            root = root.child(clipped(panes.left_clip, w, h, explorer));
        }
        if (self.panes.right().open || panes.right_clip.is_some()) && !home && !file {
            // The 8px sash overlays the pane edge (`.po-pane-edge-resize-handle`);
            // content starts at the divider like the product's.
            let auxiliary = at(self.layout.auxiliary)
                .bg(t.auxiliary())
                .child(self.sidebar.content());
            root = root.child(clipped(panes.right_clip, w, h, auxiliary));
        }
        if self.rail && !home && !file {
            root = root.child(self.project_rail(h, cx));
        }
        let opening = !home && self.opening();
        if opening {
            root = root.children(self.project_preparation(w, h, cx));
        }
        // The intro's curtain covers the window under the Header, whose
        // titlebar stays above it (`z-index: 60` over the curtain's 3).
        if home {
            root = root.children(self.home_intro_curtain(w, h, cx));
        }
        root = if file {
            root.child(self.file_titlebar(w, cx))
        } else {
            root.child(at(self.layout.header).child(self.header(cx)))
        };
        // Each frame owns its edge while it is on screen; a closed right
        // sidebar keeps its lane at the window edge.
        if !home && !opening && !file && self.layout.editor.x > rail + 0.5 {
            root = root.child(self.sash(true, cx));
        }
        if !home && !opening && !file {
            if self.layout.editor.right() < w - 0.5 {
                root = root.child(self.sash(false, cx));
            } else if !self.panes.right().open {
                root = root.child(self.collapsed_right_edge(w, cx));
            }
        }
        if !home && !opening {
            root = root.children(self.notices(w, cx));
        }
        root = root.children(self.project_actions_menu(cx));
        root = root.children(self.coachmark_overlay(w, cx));
        root.children(self.modal_layer(w, h, cx))
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
        let mut folder_notice = self.local_folder_notice_view(cx);
        if folder_notice.is_some() && self.window.notice.is_none() {
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
        if let Some(message) = &self.window.notice {
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
                                s.window.notice = None;
                                cx.notify();
                            });
                        }),
                )
                .into_any_element(),
            );
        }
        // `editor-notice-stack`: the active document's save failure.
        if let Some(detail) = self.files.save_error.clone().filter(|e| {
            !self.files.cloud_conflict() && self.editor.dismissed_save_error.as_ref() != Some(e)
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
                            s.editor.dismissed_save_error = Some(dismissed.clone());
                            cx.notify();
                        });
                    }),
                )
                .into_any_element(),
            );
        }
        if self.files.cloud_conflict() {
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
        self.window.notice = None;
        match self.hosted_project() {
            Some(project) => self.open_cloud(project, cx),
            None => self.explorer.update(cx, |e, cx| e.resubscribe(cx)),
        }
        cx.notify();
    }
    /// The modal layer, bottom to top, with the Documents error above it.
    fn modal_layer(&self, w: f32, h: f32, cx: &mut Context<Self>) -> Vec<AnyElement> {
        use crate::localization::t as tr;
        let error = |shell: &Self, message: &str, cx: &mut Context<Self>| {
            shell
                .simple_modal(
                    tr("native.error.title"),
                    message,
                    {
                        let mut actions = vec![(
                            tr("common.action.close"),
                            Command::ClearError,
                            ButtonVariant::Secondary,
                        )];
                        if shell.files.can_retry_operation() {
                            actions.push((
                                tr("common.action.retry"),
                                Command::RetryFileOperation,
                                ButtonVariant::Solid,
                            ));
                        }
                        actions
                    },
                    cx,
                )
                .into_any_element()
        };
        let mut layer: Vec<AnyElement> = self
            .modals
            .iter()
            .map(|modal| match modal {
                Modal::Task(Task::Settings) => self.settings_view(w, h, cx).into_any_element(),
                Modal::Task(Task::Feedback) => self.feedback.clone().into_any_element(),
                Modal::CreateEntry(form) => self
                    .create_entry_view(form.clone(), w, h, cx)
                    .into_any_element(),
                Modal::CreateProject(create) => {
                    self.create_project_dialog(create, cx).into_any_element()
                }
                Modal::TemplateImport(import) => {
                    self.template_import_dialog(import, cx).into_any_element()
                }
                Modal::ImportRepository(import) => {
                    self.import_dialog(import, cx).into_any_element()
                }
                Modal::Rename(rename) => self.rename_dialog(rename, cx).into_any_element(),
                Modal::ConfirmQuit => self
                    .simple_modal(
                        tr("native.quit.title"),
                        tr("native.quit.detail"),
                        vec![
                            (
                                tr("native.quit.cancel"),
                                Command::CancelProcessQuit,
                                ButtonVariant::Secondary,
                            ),
                            (
                                tr("native.quit.confirm"),
                                Command::QuitWithProcesses,
                                ButtonVariant::SolidDanger,
                            ),
                        ],
                        cx,
                    )
                    .into_any_element(),
                Modal::CloseAnyway => self
                    .simple_modal(
                        tr("native.documentClose.message"),
                        tr("native.documentClose.detail"),
                        vec![
                            (
                                tr("native.documentClose.closeAnyway"),
                                Command::CloseAnyway,
                                ButtonVariant::Secondary,
                            ),
                            (
                                tr("native.documentClose.keepOpen"),
                                Command::KeepWindowOpen,
                                ButtonVariant::Solid,
                            ),
                        ],
                        cx,
                    )
                    .into_any_element(),
                Modal::Executions => self.executions_dialog(cx).into_any_element(),
                Modal::ProjectEntry => self.project_entry_dialog(cx).into_any_element(),
                Modal::ProjectFailure { message, .. } => {
                    self.project_failure_dialog(message, cx).into_any_element()
                }
                Modal::Error(message) => error(self, message, cx),
                Modal::CloudPublish => self.cloud_publish_dialog(cx).into_any_element(),
                Modal::ConfirmPublish => self.publish_confirmation_dialog(cx).into_any_element(),
                Modal::ReplaceCloud(replace) => {
                    self.replace_cloud_dialog(replace, cx).into_any_element()
                }
                Modal::CloudServices => self.cloud_services.clone().into_any_element(),
                Modal::RenameProject(rename) => {
                    self.project_rename_dialog(rename, cx).into_any_element()
                }
                Modal::ConfirmProject(confirm) => {
                    self.project_confirm_dialog(confirm, cx).into_any_element()
                }
                Modal::CloudRecovery { project, failure } => self
                    .cloud_open_recovery_dialog(project, failure, cx)
                    .into_any_element(),
                Modal::ManageAgents => self.manage_agents_dialog(cx).into_any_element(),
            })
            .collect();
        if self.files.cloud_conflict() {
            // Shown as the editor's floating notice (`notices`).
        } else if let Some(message) = &self.files.error {
            layer.push(error(self, message, cx));
        }
        layer
    }
}

#[cfg(test)]
mod tests;
