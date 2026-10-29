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
mod cloud_publish;
mod cloud_switch;
mod command;
mod create_new;
mod editor_workbench;
mod explorer;
mod footer;
mod header;
mod home;
mod modals;
mod panes;
mod project_actions;
mod project_menu;
mod rename;
pub(crate) mod tasks;
pub mod windows;
use command::on_shell_actions;
pub use command::{
    Command, app_menus, bind_keys, dock_menu, on_app_actions, on_global_shell_actions,
};
use explorer::{Explorer, ExplorerEvent, Host};
use footer::SidebarFooter;
use modals::{Modal, Modals, Task};
use panes::{Layout, Panes, RightContent, Side, StoredPanes};
use tasks::TaskUi;
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
    Location,
}
pub struct Shell {
    /// This window's budget owner (`ownerId`), shared with its hosts.
    window_key: String,
    /// The shared Cloud account catalog (Homepage / Header rows).
    pub(super) cloud_catalog: Entity<crate::features::cloud_catalog::CloudCatalog>,
    /// The hosted Project this window opened (links, Share, History).
    cloud_project: Option<String>,
    /// The account (user, session generation, API) the Cloud this window
    /// opened, prepares or keeps alive belongs to.
    cloud_authority: Option<String>,
    /// `workspaceSurfaceError`: the workspace's change subscription failed.
    workspace_notice: Option<String>,
    /// A Cloud recovery's Details disclosure is open.
    recovery_details: bool,
    /// `ProjectRowActions` of a remembered Project, at the pointer.
    project_actions: Option<(PathBuf, Point<Pixels>)>,
    /// The first publication of this window's checkout.
    cloud_publish: Entity<crate::features::cloud_publish::CloudPublish>,
    /// The published Project the association was last refreshed for.
    publish_reported: Option<String>,
    /// Launch without a project: open the last active one once preferences load.
    restore_last: bool,
    project: String,
    dark: bool,
    locale: Locale,
    /// The Explorer and the right sidebar.
    panes: Panes,
    /// The project rail (`ProjectSwitcherRail`) replaces the Header's project
    /// button.
    rail: bool,
    /// Window dialogs, bottom to top.
    modals: Modals,
    workbench: Entity<crate::features::workbench::Workbench>,
    source_control: Entity<crate::features::source_control::SourceControl>,
    /// The hosted Project's History sidebar (Cloud Header).
    cloud_history: Entity<crate::features::source_control::CloudHistory>,
    /// The open checkout's Cloud association (Header location).
    repository_cloud: Entity<crate::features::repository_cloud::RepositoryCloud>,
    /// A Header switch to the Cloud Computer in progress.
    cloud_switch: Option<cloud_switch::CloudSwitch>,
    /// The local host kept alive while Cloud shows, and the Cloud host kept
    /// alive while local shows.
    retained_local: Option<cloud_switch::Retained>,
    retained_cloud: Option<cloud_switch::Retained>,
    popover: Option<Popover>,
    /// Homepage requested from the project menu (`goToHomepage`).
    home: bool,
    recent_projects: Vec<crate::features::settings::preference_types::RecentProject>,
    weak: WeakEntity<Shell>,
    /// The workspace tree on the left.
    explorer: Entity<Explorer>,
    homepage: home::Homepage,
    task_ui: TaskUi,
    preferences: Entity<crate::features::settings::preferences_store::PreferencesStore>,
    pending: bool,
    files: Documents,
    native: Entity<crate::editor::host::DocumentEditor>,
    native_hosts: std::collections::BTreeMap<u64, Entity<crate::editor::host::DocumentEditor>>,
    editor_resize: Option<editor_workbench::EditorResize>,
    editor_drop: Option<editor_workbench::EditorDrop>,
    editor_tab_focus: std::collections::BTreeMap<u64, FocusHandle>,
    fixture: bool,
    startup_file: Option<PathBuf>,
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
                            s.project.clone(),
                        );
                        s.receive(w, cx);
                        let after = (
                            s.files.presentation_key(),
                            s.files.generation,
                            s.project.clone(),
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
            window_key: format!("window:{:?}", window.window_handle().window_id()),
            cloud_catalog: crate::features::cloud_catalog::global(cx),
            cloud_project: None,
            cloud_authority: None,
            workspace_notice: None,
            recovery_details: false,
            project_actions: None,
            cloud_publish: Self::new_cloud_publish(cx),
            publish_reported: None,
            restore_last: false,
            project: if fixture {
                "puppyone".into()
            } else {
                String::new()
            },
            dark: std::env::var("PUPPYONE_THEME").as_deref() != Ok("light"),
            locale: Locale::default(),
            panes: Panes::new(
                std::env::var("PUPPYONE_RIGHT").as_deref() == Ok("1"),
                if std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() == Ok("changes") {
                    RightContent::Changes
                } else {
                    RightContent::Workbench
                },
            ),
            rail: false,
            modals: Default::default(),
            workbench: cx.new(|cx| crate::features::workbench::Workbench::new(window, cx)),
            source_control: cx
                .new(|cx| crate::features::source_control::SourceControl::new(window, cx)),
            cloud_history: cx.new(crate::features::source_control::CloudHistory::new),
            repository_cloud: Self::new_repository_cloud(cx),
            cloud_switch: None,
            retained_local: None,
            retained_cloud: None,
            popover: None,
            home: false,
            recent_projects: vec![],
            weak: cx.weak_entity(),
            explorer: cx.new(|cx| Explorer::new(fixture, preferences.clone(), cx)),
            homepage: Default::default(),
            task_ui: TaskUi::new(preferences.clone(), window, cx),
            preferences,
            pending: false,
            files: if fixture {
                Documents::default()
            } else {
                Documents::native()
            },
            native: cx.new(crate::editor::host::DocumentEditor::new),
            native_hosts: Default::default(),
            editor_resize: None,
            editor_drop: None,
            editor_tab_focus: Default::default(),
            fixture,
            startup_file: if cfg!(test) {
                None
            } else {
                std::env::var_os("PUPPYONE_FILE").map(PathBuf::from)
            },
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
        s.native_hosts.insert(0, s.native.clone());
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
                s.apply_preferences(w, cx);
                s.refresh_cloud_catalog(false, cx);
                if s.restore_last && s.preferences.read(cx).loaded {
                    s.restore_last = false;
                    if let Some(path) = windows::last_active_project(cx)
                        && s.files.workspace.is_none()
                    {
                        s.open_project(path, w, cx);
                    }
                }
            },
        )
        .detach();
        cx.observe_window_appearance(window, |s, w, cx| s.apply_preferences(w, cx))
            .detach();
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
                ExplorerEvent::WatchFailed(error) => s.workspace_notice = Some(error.clone()),
                ExplorerEvent::WatchRecovered => s.workspace_notice = None,
                ExplorerEvent::CopyLink { path, folder } => s.copy_cloud_link(path, *folder, cx),
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
        s.workbench.update(cx, |workbench, _| {
            workbench.set_preference_store(preferences)
        });
        cx.subscribe_in(
            &s.workbench,
            window,
            |s, _, event: &crate::features::workbench::WorkbenchEvent, w, cx| match event {
                crate::features::workbench::WorkbenchEvent::OpenModelConnections => {
                    s.task_ui.settings.update(cx, |settings, cx| {
                        settings.select_page(crate::features::settings::Page::ModelConnections, cx)
                    });
                    s.command(Command::Settings, w, cx);
                }
            },
        )
        .detach();
        // Leaving the window abandons a pane drag (`blur` cancels).
        cx.observe_window_activation(window, |s, window, cx| {
            if !window.is_window_active() {
                s.editor_drop = None;
                s.end_pane_drag(false, cx);
                s.end_editor_resize(false, cx);
            } else {
                cx.set_reduce_motion(crate::platform::accessibility::reduce_motion());
                // A returning window may probe the Cloud association once.
                s.repository_cloud.update(cx, |r, cx| r.probe(cx));
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
                if s.editor_drop.take().is_some() {
                    cx.stop_active_drag(window);
                    cx.stop_propagation();
                    cx.notify();
                }
                if s.editor_resize.is_some() {
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
        // The Header's Changes status follows the Git snapshot.
        cx.observe(&s.source_control, |_, _, cx| cx.notify())
            .detach();
        // Changes "Open file" (`onOpenFile`): the file in the editor.
        cx.subscribe_in(&s.source_control, window, |s, _, event, window, cx| {
            let crate::features::source_control::SourceControlEvent::OpenFile(path) = event;
            s.files
                .begin(Intent::OpenFile(PathBuf::from(path)), &s.wake);
            s.receive(window, cx);
            cx.notify();
        })
        .detach();
        // History's Close and Back leave the sidebar closed on the workbench.
        cx.subscribe_in(&s.cloud_history, window, |s, _, event, window, cx| {
            let crate::features::source_control::CloudHistoryEvent::Close = event;
            s.close_cloud_history(cx);
            s.focus.focus(window, cx);
            cx.notify();
        })
        .detach();
        cx.subscribe_in(&s.native, window, |s, _, event, window, cx| {
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
        cx.subscribe_in(&s.task_ui.message, window, |_, _, event, _, cx| {
            if matches!(event, ui::form_input::InputEvent::Changed) {
                cx.notify();
            }
        })
        .detach();
        let mut args = if cfg!(test) || !launch.from_args {
            vec![]
        } else {
            std::env::args_os().skip(1).collect::<Vec<_>>()
        }
        .into_iter();
        let mut workspace = if cfg!(test) || !launch.from_args {
            launch.workspace.clone()
        } else {
            std::env::var_os("PUPPYONE_WORKSPACE").map(PathBuf::from)
        };
        while let Some(arg) = args.next() {
            if arg == "--workspace" {
                workspace = args.next().map(PathBuf::from);
            } else if arg == "--file" {
                s.startup_file = args.next().map(PathBuf::from);
            } else if !arg.to_string_lossy().starts_with('-') && workspace.is_none() {
                workspace = Some(PathBuf::from(arg));
            } else {
                s.show_error(crate::localization::t("native.usage"));
            }
        }
        #[cfg(feature = "dev-capture")]
        if std::env::var_os("PUPPYONE_SCREENSHOT").is_some() {
            let surface = std::env::var("PUPPYONE_CAPTURE_SURFACE").unwrap_or_default();
            if surface == "changes" {
                s.panes.open_right();
            }
            if surface == "agent-empty"
                || surface == "agent-transcript"
                || surface == "agent-failed"
            {
                s.panes.open_right();
                s.workbench.update(cx, |workbench, cx| {
                    workbench.visual_fixture(surface == "agent-transcript", window, cx)
                });
            }
        }
        if let Some(path) = workspace {
            s.files.begin(Intent::OpenFolder(path), &s.wake);
        } else if launch.from_args && !fixture && !cfg!(test) {
            // `readLastActiveWorkspaceComposition`: the last active project.
            s.restore_last = true;
        }
        windows::register(window.window_handle(), cx.weak_entity(), cx);
        cx.observe(&s.cloud_catalog, |_, _, cx| cx.notify())
            .detach();
        if let Some(project) = launch.cloud.clone() {
            s.open_cloud(project, cx);
        }
        // Until preferences load: the default Sub Theme in the start-up mode.
        crate::ui::appearance::Appearance::default()
            .with_dark(s.dark)
            .apply(Some(window), cx);
        s
    }
    /// Project persisted appearance/locale preferences onto the process-wide
    /// theme, type scale and catalog. `System` follows the window appearance.
    fn apply_preferences(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
        crate::ui::appearance::Appearance::new(self.dark, &p.theme_pack, scale, p.pointer_cursors)
            .with_loading(p.loading_style)
            .apply(Some(window), cx);
        self.recent_projects = p.recent_projects.clone();
        let hidden = p.local_agents.hidden_agent_ids.clone();
        self.workbench
            .update(cx, |w, cx| w.set_preferences(hidden, cx));
        let (layout, icons) = (p.git_sidebar_layout, p.file_icon_theme.clone());
        let history_icons = icons.clone();
        self.cloud_history
            .update(cx, |h, cx| h.set_icon_theme(history_icons, cx));
        self.source_control
            .update(cx, |s, cx| s.set_presentation(layout, icons, cx));
        self.rail = p.project_switcher_rail;
        // The pane layout (`useDesktopExplorerFrame`).
        self.panes.restore(StoredPanes {
            explorer_collapsed: p.sidebar_collapsed,
            explorer_width: p.explorer_width,
            right_width: p.right_sidebar_width,
        });
        let code = crate::localization::resolve_preference(
            &p.locale,
            crate::platform::environment::system_languages(),
        );
        crate::localization::set_current(code);
        if self.locale.set(code) {
            cx.set_menus(app_menus());
        }
        // Appearance, type scale and locale are process-wide: the cached
        // panes (Explorer, workbench, Changes) read them while rendering, so
        // the whole window renders again.
        window.refresh();
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
            Some(Modal::Task(_)) => self.close_tasks(window, cx),
            Some(Modal::CreateEntry(form)) => {
                if !form.read(cx).busy() {
                    self.modals.remove(|m| matches!(m, Modal::CreateEntry(_)));
                    self.focus.focus(window, cx);
                }
            }
            Some(Modal::CreateProject(_)) => self.close_create_project(window, cx),
            Some(Modal::Rename(_)) => self.cancel_rename(window, cx),
            Some(Modal::ConfirmQuit) => {
                self.modals.remove(|m| matches!(m, Modal::ConfirmQuit));
            }
            Some(Modal::Executions) => {
                self.modals.remove(|m| matches!(m, Modal::Executions));
            }
            Some(Modal::About) => {
                self.modals.remove(|m| matches!(m, Modal::About));
            }
            Some(Modal::Share { .. }) => {
                self.modals.remove(|m| matches!(m, Modal::Share { .. }));
            }
            Some(Modal::Error(_)) => {
                self.modals.remove(|m| matches!(m, Modal::Error(_)));
            }
            Some(Modal::CloudSwitch) => self.cancel_cloud_switch(cx),
            Some(Modal::RenameProject(_) | Modal::UnlinkProject(_)) => {
                self.modals
                    .remove(|m| matches!(m, Modal::RenameProject(_) | Modal::UnlinkProject(_)));
            }
            Some(Modal::CloudRecovery { .. }) => {
                self.modals
                    .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
            }
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
        match command {
            Command::Minimize => {
                window.minimize_window();
                return;
            }
            Command::Zoom => {
                window.zoom_window();
                return;
            }
            Command::About => {
                self.popover = None;
                self.modals.remove(|m| matches!(m, Modal::About));
                self.modals.open(Modal::About);
                self.modal_focus.focus(window, cx);
                cx.notify();
                return;
            }
            Command::CloseAbout => {
                self.modals.remove(|m| matches!(m, Modal::About));
                self.focus.focus(window, cx);
                cx.notify();
                return;
            }
            // Check for Updates: the General page owns update status.
            Command::CheckForUpdates => {
                self.task_ui.settings.update(cx, |s, cx| {
                    s.select_page(crate::features::settings::Page::General, cx)
                });
                self.command(Command::Settings, window, cx);
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
            Command::Quit if self.workbench.read(cx).has_running(cx) => {
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
            // Escape answers the topmost dialog; ⌘W closes a window task
            // (Settings, Help, Create entry) on top instead of the file.
            Command::Escape if self.modal() => {
                self.dismiss_modal(window, cx);
                self.receive(window, cx);
                cx.notify();
                return;
            }
            Command::CloseFile
                if matches!(
                    self.modals.top(),
                    Some(Modal::Task(_) | Modal::CreateEntry(_))
                ) =>
            {
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
                    self.task_ui.clear(cx);
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
            Command::ToggleExplorer => {
                self.panes.toggle_explorer();
                self.persist_panes(cx);
            }
            Command::ToggleRightSidebar => self.panes.toggle_workbench(),
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
                self.task_ui.message.focus_handle(cx).focus(window, cx);
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
                self.popover = if self.popover == Some(Popover::Location) {
                    None
                } else {
                    Some(Popover::Location)
                };
            }
            Command::Home => {
                self.popover = None;
                self.explorer.update(cx, |e, cx| e.dismiss_menu(cx));
                self.home = true;
            }
            // With no dialog open, Escape closes a menu.
            // Escape cancels an in-place Cloud preparation; the workbench
            // behind it stays.
            Command::Escape if self.cloud_switch.is_some() => self.cancel_cloud_switch(cx),
            // Escape inside History goes back (`CloudWorkspaceHistorySidebar`).
            Command::Escape
                if self.panes.shows(RightContent::CloudHistory)
                    && self
                        .cloud_history
                        .read(cx)
                        .focus_handle()
                        .contains_focused(window, cx) =>
            {
                self.cloud_history.update(cx, |h, cx| h.back(cx));
            }
            Command::Escape => {
                let closed = self.explorer.update(cx, |e, cx| e.dismiss_menu(cx));
                if !closed && self.popover.take().is_some() {
                    self.project_focus.focus(window, cx);
                }
            }
            Command::ToggleMarkdownSource => {
                if !self.files.busy() && !self.modal() {
                    self.native
                        .update(cx, |s, cx| s.command("source", window, cx));
                }
            }
            Command::RetryFileOperation => {
                self.modals.remove(|m| matches!(m, Modal::Error(_)));
                self.files.error = None;
                self.files.retry_operation(&self.wake);
            }
            Command::ClearError => {
                self.modals.remove(|m| matches!(m, Modal::Error(_)));
                self.files.error = None;
            }
            Command::ShareCloud => {
                // One snapshot when Share opens owns the copied locator: the
                // selected folder, else the active document, else the root.
                let url = self.share_url(cx);
                self.popover = None;
                self.modals.remove(|m| matches!(m, Modal::Share { .. }));
                self.modals.open(Modal::Share { url, copied: None });
                self.modal_focus.focus(window, cx);
            }
            Command::CopyShareLink => {
                if let Some(Modal::Share {
                    url: Some(url),
                    copied,
                }) = self.modals.top_mut()
                {
                    cx.write_to_clipboard(ClipboardItem::new_string(url.clone()));
                    *copied = Some(true);
                }
            }
            Command::CloseShare => {
                self.modals.remove(|m| matches!(m, Modal::Share { .. }));
                self.focus.focus(window, cx);
            }
            Command::CloudHistory => {
                let Some(project) = self.hosted_project() else {
                    return;
                };
                self.popover = None;
                if self.panes.toggle_cloud_history() {
                    let opened = self.cloud_history.update(cx, |h, cx| h.open(&project, cx));
                    if opened {
                        self.cloud_history
                            .read(cx)
                            .focus_handle()
                            .clone()
                            .focus(window, cx);
                    } else {
                        self.close_cloud_history(cx);
                    }
                } else {
                    self.cloud_history.update(cx, |h, cx| h.close(cx));
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
                if self.panes.toggle_changes() {
                    self.source_control.update(cx, |s, cx| s.refresh(cx));
                }
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
            self.task_ui.clear(cx);
        }
        self.modals.remove(|m| matches!(m, Modal::Task(_)));
        self.focus.focus(window, cx);
    }
    fn receive(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        crate::platform::watchdog::activity("shell.receive");
        let previous = self.files.opened().map(|(id, _)| id.to_owned());
        self.files.poll(&self.wake);
        // A Header switch shows its own recovery; any other Cloud opening
        // (a hosted-only window) reports its failure copy.
        if self.cloud_switch.is_none()
            && let Some(failure) = self.files.take_cloud_failure()
        {
            self.recovery_details = false;
            self.modals
                .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
            self.modals.open(Modal::CloudRecovery {
                project: self.cloud_project.clone().unwrap_or_default(),
                failure,
            });
        }
        for (owner, outcome) in std::mem::take(&mut self.files.operation_results) {
            self.explorer
                .update(cx, |e, cx| e.finish_op(&owner, outcome, cx));
        }
        if let Some(nodes) = self.files.tree_update.take() {
            self.editor_drop = None;
            self.end_editor_resize(false, cx);
            let ws = self.files.workspace.clone().unwrap();
            self.explorer
                .update(cx, |e, cx| e.load_workspace(ws.clone(), nodes, cx));
            if let Some(root) = ws.local_root() {
                self.workbench
                    .update(cx, |s, cx| s.set_workspace(root.to_owned(), cx));
                self.source_control
                    .update(cx, |s, cx| s.set_workspace(root.to_owned(), cx));
            }
            self.project = ws.name().to_owned();
            self.fixture = false;
            self.modals.remove(|m| matches!(m, Modal::Error(_)));
            self.home = false;
            let opened = ws.local_root().map(PathBuf::from);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or_default();
            if !cfg!(test)
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
            && let Some(path) = self.startup_file.take()
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
            // The account owner is process-wide: only the last window drains
            // it; closing one of several windows leaves it running.
            if windows::count(cx) <= 1 {
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
            self.workbench.update(cx, |s, cx| s.shutdown(cx));
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
        let active = self.files.active_slot();
        let mut focus_native = self
            .native_hosts
            .get(&active)
            .is_some_and(|e| e != &self.native);
        for _ in 0..4 {
            let messages = self.files.take_outgoing();
            if messages.is_empty() {
                break;
            }
            for (slot, message) in messages {
                if let std::collections::btree_map::Entry::Vacant(entry) =
                    self.native_hosts.entry(slot)
                {
                    self.editor_tab_focus.insert(slot, cx.focus_handle());
                    let owner = cx.entity_id();
                    let editor = cx.new(|cx| {
                        let mut editor = crate::editor::host::DocumentEditor::new(cx);
                        editor.workbench = true;
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
                                    } else if let Some((direction, placement)) = match action
                                        .as_str()
                                    {
                                        "split-right" => Some((
                                            crate::editor::workbench::layout::Direction::Horizontal,
                                            crate::editor::workbench::layout::Placement::Second,
                                        )),
                                        "split-left" => Some((
                                            crate::editor::workbench::layout::Direction::Horizontal,
                                            crate::editor::workbench::layout::Placement::First,
                                        )),
                                        "split-down" => Some((
                                            crate::editor::workbench::layout::Direction::Vertical,
                                            crate::editor::workbench::layout::Placement::Second,
                                        )),
                                        "split-up" => Some((
                                            crate::editor::workbench::layout::Direction::Vertical,
                                            crate::editor::workbench::layout::Placement::First,
                                        )),
                                        _ => None,
                                    } {
                                        if let Some(mut state) = s.files.state_mut() {
                                            if placement == crate::editor::workbench::layout::Placement::Second {
                                                state.split(direction);
                                            } else {
                                            let active = state.layout.active.clone();
                                            state.layout.split(&active, direction, placement, None);
                                            }
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
                let references = self.files.slot(slot).and_then(|files| {
                    let workspace = files.workspace.as_ref()?;
                    let (_, path) = files.opened()?;
                    self.explorer.update(cx, |explorer, _| {
                        explorer.reference_context(workspace, path)
                    })
                });
                let replies = self.native_hosts[&slot].update(cx, |s, cx| {
                    s.set_reference_context(references, cx);
                    s.receive(&message, window, cx)
                });
                for reply in replies {
                    self.files.client_for(slot, reply, &self.wake);
                }
            }
        }
        let retained = self.files.retained_slots();
        self.native_hosts.retain(|id, _| retained.contains(id));
        self.editor_tab_focus.retain(|id, _| retained.contains(id));
        if let Some(editor) = self.native_hosts.get(&active) {
            self.native = editor.clone();
        }
        let modal = self.modal() || self.workbench.read(cx).dialog_open();
        let home = self.home_visible();
        let visible = self.files.visible_slots();
        for (slot, editor) in &self.native_hosts {
            let references = self.files.slot(*slot).and_then(|files| {
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
            self.native
                .update(cx, |editor, cx| editor.focus_document(window, cx));
        }
    }
    /// `useHomepageCloudProjects`: load or revalidate the account catalog.
    pub(super) fn refresh_cloud_catalog(&mut self, retry: bool, cx: &mut Context<Self>) {
        let enabled = crate::features::flags::cloud_enabled(&self.preferences, cx);
        self.cloud_catalog
            .update(cx, |c, cx| c.ensure(enabled, retry, cx));
    }
    /// The hosted Project this window shows (a Cloud workspace, no local root).
    fn hosted_project(&self) -> Option<String> {
        self.files
            .workspace
            .as_ref()
            .filter(|ws| ws.local_root().is_none())
            .and(self.cloud_project.clone())
    }
    fn close_cloud_history(&mut self, cx: &mut Context<Self>) {
        self.panes.close_cloud_history();
        self.cloud_history.update(cx, |h, cx| h.close(cx));
    }
    /// `useCloudWorkspaceSidebar`: History lives only in the scope it opened
    /// in (Project, account, session generation, API) and only while the
    /// sidebar is open; anything else closes it and drops its reads.
    fn guard_cloud_history(&mut self, cx: &mut Context<Self>) {
        if self.panes.content() != RightContent::CloudHistory {
            return;
        }
        let project = self.hosted_project();
        let valid =
            self.panes.right().open && self.cloud_history.read(cx).matches(project.as_deref(), cx);
        if !valid {
            self.close_cloud_history(cx);
        }
    }
    /// Explicit Cloud opening of a hosted Project root in this window.
    /// `cloudWorkspaceShareResource`: the selected folder, else the active
    /// document, else the authorized root.
    fn share_url(&self, cx: &App) -> Option<String> {
        let (_, binding) = crate::features::cloud_account::broker_and_binding(cx)?;
        let project = self.cloud_project.clone()?;
        let (path, folder) = match self.explorer.read(cx).selected_folder() {
            Some(folder) => (folder, true),
            None => match self.files.opened() {
                Some((_, relative)) => (relative.to_path_buf(), false),
                None => (PathBuf::new(), true),
            },
        };
        crate::workspace::cloud::locator::resource_url(
            binding.environment.web(),
            &project,
            &path.to_string_lossy(),
            folder,
        )
        .ok()
    }
    fn copy_cloud_link(&mut self, path: &std::path::Path, folder: bool, cx: &mut Context<Self>) {
        let link = crate::features::cloud_account::broker_and_binding(cx)
            .zip(self.cloud_project.clone())
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
        let account = cloud_switch::account_key(cx);
        if self.files.cloud_opening().is_some()
            && self.cloud_project.as_deref() == Some(project.as_str())
            && self.cloud_authority == account
            && account.is_some()
        {
            return;
        }
        self.cloud_project = Some(project.clone());
        self.cloud_authority = account;
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
        let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
        if let Some(other) = windows::window_showing(&canonical, window.window_handle(), cx) {
            // `createOrRevealWindow`: one project, one window.
            let _ = other.update(cx, |_, w, _| w.activate_window());
            return;
        }
        if self
            .files
            .workspace
            .as_ref()
            .is_some_and(|ws| ws.local_root() == Some(path.as_path()))
        {
            self.home = false;
        } else if !self.pending && !self.files.busy() {
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
            canvas = canvas.child(at(Rect::new(0., 0., r.w, r.h)).child(self.native.clone()));
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
        for (index, project) in self.recent_projects.iter().take(12).enumerate() {
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
                        let path = path.clone();
                        cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                            cx.stop_propagation();
                            s.open_project_actions(path.clone(), e.position, cx)
                        })
                    })
                    .on_click(cx.listener(move |s, _, w, cx| s.open_project(path.clone(), w, cx))),
            );
        }
        rail.child(
            IconButton::new("rail-plus", "plus")
                .label(crate::localization::t("shell.workspaceSwitcher.addProject"))
                .size(px(theme::control()))
                .on_click(cx.listener(|s, _, w, cx| s.command(Command::OpenFolder, w, cx))),
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
    /// The Header (`DesktopWindowChrome`). The homepage shows only Sign in;
    /// a workspace shows the Explorer's expand button while it is closed, the
    /// project switcher (unless the project rail has it), and Changes and the
    /// Agent entry as the Header elements preference allows.
    fn header(&self, cx: &mut Context<Self>) -> header::TitleBar {
        use crate::localization::t as tr;
        let home = self.home_visible();
        let (centered, changes, agent) = {
            let p = &self.preferences.read(cx).state;
            (
                p.experimental.centered_project_in_header,
                // A hosted Project has no local Git: its Header tools are
                // Share, History and the Agent (`CloudWorkspaceHeaderTools`).
                !home
                    && self
                        .files
                        .workspace
                        .as_ref()
                        .is_some_and(|ws| ws.local_root().is_some())
                    && p.header_changes,
                !home && p.header_terminal,
            )
        };
        let project = !home && !self.rail && (self.files.workspace.is_some() || self.fixture);
        // `.desktop-titlebar[data-workspace-kind="cloud"]`: the Header wears
        // the Cloud colour wherever the screen shows the Cloud Computer.
        let mut bar = header::TitleBar::new()
            .cloud(!home && self.header_location(cx).0 == cloud_switch::Place::Cloud);
        if !home && !self.panes.explorer().open {
            bar = bar.leading(
                IconButton::new("expand-explorer", "panel-left")
                    .label(tr("shared-ui.explorer.expandSidebar"))
                    .w(px(theme::control()))
                    .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                    .on_click(cx.listener(|s, _, w, cx| s.command(Command::ToggleExplorer, w, cx))),
            );
        }
        if project && !centered {
            bar = bar.leading(self.project_context(cx));
        }
        if !home && self.files.state().is_some() {
            bar = bar.tabs(self.editor_tabs(cx));
        }
        if changes {
            use gpui_kit::base::Selectable as _;
            let status = header::GitTitlebarStatus::of(self.source_control.read(cx));
            bar = bar.action(
                header::ChangesButton::new(status)
                    .selected(self.panes.shows(RightContent::Changes))
                    .on_click(cx.listener(|s, _, w, cx| s.command(Command::Changes, w, cx))),
            );
        }
        let hosted = self.hosted_project().is_some();
        if hosted {
            bar = bar.action(
                header::share_entry()
                    .on_click(cx.listener(|s, _, w, cx| s.command(Command::ShareCloud, w, cx))),
            );
            // Ready once the account is signed in; the hosted opening only
            // admits Project roots, so History never widens a Scope.
            use gpui_kit::base::Disableable as _;
            bar = bar.action(
                header::history_entry(self.panes.shows(RightContent::CloudHistory))
                    .disabled(!crate::features::cloud_account::has_account(cx))
                    .on_click(cx.listener(|s, _, w, cx| s.command(Command::CloudHistory, w, cx))),
            );
        }
        if (changes || hosted) && agent {
            bar = bar.divider(cx);
        }
        if agent {
            bar = bar.action(
                header::agent_entry(self.panes.shows(RightContent::Workbench)).on_click(
                    cx.listener(|s, _, w, cx| s.command(Command::ToggleRightSidebar, w, cx)),
                ),
            );
        }
        // `cloudAccountStatus` follows Cloud: with the experiment off the
        // Homepage shows no Sign in (the account stays in Settings).
        if home && crate::features::flags::cloud_enabled(&self.preferences, cx) {
            // Account identity is public state, not permission to open Cloud files.
            bar = bar.action(
                header::account_entry(crate::features::cloud_account::has_account(cx)).on_click(
                    cx.listener(|s, _, w, cx| {
                        s.command(Command::Settings, w, cx);
                        s.task_ui.settings.update(cx, |settings, cx| {
                            settings.select_page(crate::features::settings::Page::Account, cx)
                        });
                    }),
                ),
            );
        }
        if project && centered {
            bar = bar.centered(self.project_context(cx));
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
        let Some(changed) = self.panes.end_drag(commit) else {
            return;
        };
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
            self.editor_drop = None;
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
        self.layout = panes.layout;
        if panes.running {
            window.request_animation_frame();
        }
        self.sync_editor(window, cx);
        self.sync_explorer(window, cx);
        self.guard_cloud_history(cx);
        self.sync_repository_cloud(cx);
        self.sync_cloud_publish(cx);
        self.guard_cloud_authority(window, cx);
        self.advance_cloud_switch(cx);
        self.refresh_home_activity(cx);
        self.sync_open_history(cx);
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
        let mut root = div()
            .id("gpui-shell")
            .relative()
            .size_full()
            .font_family("Geist")
            .font_weight(FontWeight::NORMAL)
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
                    if s.editor_resize.is_some() {
                        s.move_editor_resize(e.position, cx);
                        s.end_editor_resize(true, cx);
                    }
                    if s.panes.dragging().is_some() {
                        s.move_pane_drag(e.position, cx);
                        s.end_pane_drag(true, cx);
                    }
                }),
            )
            .child(self.editor(cx));
        let weak = cx.weak_entity();
        root = on_shell_actions(root, move |command, window, cx| {
            let _ = weak.update(cx, |s, cx| s.command(command, window, cx));
        });
        let home = self.home_visible();
        if home {
            root = root.child(self.home_view(cx));
        }
        // A closing pane stays painted, clipped to its frame, until it has closed.
        if (self.panes.explorer().open || panes.left_clip.is_some()) && !home {
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
        if (self.panes.right().open || panes.right_clip.is_some()) && !home {
            // The 8px sash overlays the pane edge (`.po-pane-edge-resize-handle`);
            // content starts at the divider like the product's.
            let auxiliary =
                at(self.layout.auxiliary)
                    .bg(t.auxiliary())
                    .child(match self.panes.content() {
                        RightContent::Changes => self
                            .source_control
                            .clone()
                            .cached(fill())
                            .into_any_element(),
                        RightContent::CloudHistory => {
                            self.cloud_history.clone().cached(fill()).into_any_element()
                        }
                        RightContent::Workbench => {
                            self.workbench.clone().cached(fill()).into_any_element()
                        }
                    });
            root = root.child(clipped(panes.right_clip, w, h, auxiliary));
        }
        if self.rail && !home {
            root = root.child(self.project_rail(h, cx));
        }
        root = root.child(at(self.layout.header).child(self.header(cx)));
        // Each frame owns its edge while it is on screen; a closed right
        // sidebar keeps its lane at the window edge.
        if !home && self.layout.editor.x > rail + 0.5 {
            root = root.child(self.sash(true, cx));
        }
        if !home {
            if self.layout.editor.right() < w - 0.5 {
                root = root.child(self.sash(false, cx));
            } else if !self.panes.right().open {
                root = root.child(self.collapsed_right_edge(w, cx));
            }
        }
        if !home {
            root = root.children(self.notices(w));
        }
        root = root.children(self.project_actions_menu(cx));
        root.children(self.modal_layer(w, h, cx))
    }
}
impl Shell {
    /// `FloatingNoticeStack`s over the workspace: the workspace surface
    /// notice (`.desktop-workspace-notice-stack`: 12px below the top, 16px
    /// in from the editor's end) and the document session's held-back Cloud
    /// conflict (`.editor-notice-stack`: 48px / 12px).
    fn notices(&self, w: f32) -> Vec<AnyElement> {
        use crate::{
            localization::t as tr,
            ui::components::{
                FloatingNotice, NoticeAction, NoticePlacement, NoticeStack, NoticeTone,
            },
        };
        let editor = self.layout.editor;
        let end = w - editor.right();
        let mut layers = vec![];
        if let Some(message) = &self.workspace_notice {
            let host = self.weak.clone();
            let dismiss = self.weak.clone();
            layers.push(
                NoticeStack::new(
                    NoticePlacement::TopEnd,
                    editor.y + 12.,
                    end + 16.,
                    (editor.w - 40.).min(400.),
                )
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
                                s.workspace_notice = None;
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
        self.workspace_notice = None;
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
                Modal::Task(Task::Feedback) => self.feedback_view(w, cx).into_any_element(),
                Modal::CreateEntry(form) => self
                    .create_entry_view(form.clone(), w, h, cx)
                    .into_any_element(),
                Modal::CreateProject(create) => {
                    self.create_project_dialog(create, cx).into_any_element()
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
                Modal::Executions => self.executions_dialog(cx).into_any_element(),
                Modal::About => self.about_dialog(cx).into_any_element(),
                Modal::Share { url, copied } => self
                    .share_dialog(url.clone(), *copied, cx)
                    .into_any_element(),
                Modal::Error(message) => error(self, message, cx),
                Modal::CloudSwitch => self.cloud_switch_dialog(cx).into_any_element(),
                Modal::RenameProject(rename) => {
                    self.project_rename_dialog(rename, cx).into_any_element()
                }
                Modal::UnlinkProject(path) => {
                    self.project_unlink_dialog(path, cx).into_any_element()
                }
                Modal::CloudRecovery { project, failure } => self
                    .cloud_open_recovery_dialog(project, failure, cx)
                    .into_any_element(),
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
