use crate::{
    documents::{ClientMessage, Documents, Intent},
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
#[cfg(feature = "dev-capture")]
mod capture_scenario;
mod command;
mod create_new;
mod explorer;
mod footer;
mod header;
mod home;
mod modals;
mod panes;
mod project_menu;
mod rename;
pub(crate) mod tasks;
use command::on_shell_actions;
pub use command::{Command, app_menus, bind_keys, on_global_shell_actions};
use explorer::{Explorer, ExplorerEvent, Host};
use footer::SidebarFooter;
use modals::{Modal, Modals, Task};
use panes::{Layout, Panes, RightContent, Side, StoredPanes};
use tasks::TaskUi;
/// Header popovers owned by the shell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Popover {
    Project,
    Location,
}
pub struct Shell {
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
                if s.files.allow_quit
                    && s.preferences.read(cx).drained()
                    && !s.modals.create_entry().is_some_and(|f| f.read(cx).busy())
                {
                    true
                } else {
                    s.command(Command::Quit, window, cx);
                    false
                }
            })
            .unwrap_or(true)
        });
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this
                    .update_in(cx, |s, w, cx| {
                        let before = (s.files.presentation_key(), s.project.clone());
                        s.receive(w, cx);
                        let after = (s.files.presentation_key(), s.project.clone());
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
        let preferences = cx.new(|cx| {
            if fixture {
                crate::features::settings::preferences_store::PreferencesStore::memory()
            } else {
                crate::features::settings::preferences_store::PreferencesStore::new(cx)
            }
        });
        let mut s = Self {
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
            popover: None,
            home: false,
            recent_projects: vec![],
            weak: cx.weak_entity(),
            explorer: cx.new(|cx| Explorer::new(fixture, preferences.clone(), cx)),
            homepage: Default::default(),
            task_ui: TaskUi::new(preferences.clone(), window, cx),
            preferences,
            pending: false,
            files: Documents::default(),
            native: cx.new(crate::editor::host::DocumentEditor::new),
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
            },
        )
        .detach();
        cx.observe_window_appearance(window, |s, w, cx| s.apply_preferences(w, cx))
            .detach();
        // What the Explorer asks for.
        cx.subscribe_in(&s.explorer, window, |s, _, event, window, cx| {
            match event {
                ExplorerEvent::Open(path) => s.files.begin(Intent::OpenFile(path.clone()), &s.wake),
                ExplorerEvent::LoadChildren(path) => s.files.load_children(path.clone(), &s.wake),
                ExplorerEvent::CloseDocument => s.files.begin(Intent::CloseFile, &s.wake),
                ExplorerEvent::Create { entry, parent } => {
                    s.start_create(*entry, parent.clone(), window, cx)
                }
                ExplorerEvent::Rename { path, change_type } => {
                    s.begin_rename(path.clone(), *change_type, window, cx)
                }
                ExplorerEvent::Error(error) => s.show_error(error.clone()),
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
                    if s.files.workspace.as_ref().is_some_and(|ws| ws.path == path) {
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
                s.end_pane_drag(false, cx);
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
        cx.subscribe_in(&s.native, window, |s, _, event, window, cx| {
            // Pane menu commands (open in default app, close) are the shell's.
            if let ClientMessage::Action { action } = event {
                if let Some(command) = Command::from_protocol(action) {
                    s.command(command, window, cx);
                }
                return;
            }
            s.files.client(event.clone(), &s.wake);
            cx.notify();
        })
        .detach();
        cx.subscribe_in(&s.task_ui.message, window, |_, _, event, _, cx| {
            if matches!(event, ui::form_input::InputEvent::Changed) {
                cx.notify();
            }
        })
        .detach();
        let mut args = if cfg!(test) {
            vec![]
        } else {
            std::env::args_os().skip(1).collect::<Vec<_>>()
        }
        .into_iter();
        let mut workspace = if cfg!(test) {
            None
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
            .apply(Some(window), cx);
        self.recent_projects = p.recent_projects.clone();
        let hidden = p.local_agents.hidden_agent_ids.clone();
        let loading = p.loading_animation.clone();
        self.workbench
            .update(cx, |w, cx| w.set_preferences(hidden, loading, cx));
        let (layout, icons) = (p.git_sidebar_layout, p.file_icon_theme.clone());
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
        cx.notify();
    }
    /// A dialog takes the window: the modal layer, or the Documents error.
    fn modal(&self) -> bool {
        !self.modals.is_empty() || self.files.error.is_some()
    }
    /// A notice over everything else; a later one replaces it.
    fn show_error(&mut self, error: impl Into<String>) {
        self.modals.open(Modal::Error(error.into()));
    }
    /// Escape on the topmost dialog, each with its own cancel: the Documents
    /// error, then the top of the modal layer. Creating an entry is not
    /// abandoned midway.
    fn dismiss_modal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.files.error.take().is_some() {
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
            Some(Modal::Error(_)) => {
                self.modals.remove(|m| matches!(m, Modal::Error(_)));
            }
            None => {}
        }
    }
    fn pick_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.pending || self.files.busy() {
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
                            s.files.begin(Intent::OpenFolder(path), &s.wake);
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
                    && let Some(doc) = &self.files.document
                {
                    self.files
                        .outgoing
                        .push(crate::documents::HostMessage::History {
                            id: doc.id.clone(),
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
                        Err(e) => self.show_error(e),
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
            Command::ClearError => {
                self.modals.remove(|m| matches!(m, Modal::Error(_)));
                self.files.error = None;
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
        let previous = self.files.opened().map(|(id, _)| id.to_owned());
        self.files.poll(&self.wake);
        if let Some(nodes) = self.files.tree_update.take() {
            let ws = self.files.workspace.clone().unwrap();
            self.explorer
                .update(cx, |e, cx| e.load_workspace(ws.clone(), nodes, cx));
            let root = ws.path.clone();
            self.workbench
                .update(cx, |s, cx| s.set_workspace(root.clone(), cx));
            self.source_control
                .update(cx, |s, cx| s.set_workspace(root, cx));
            self.project = ws
                .path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            self.fixture = false;
            self.modals.remove(|m| matches!(m, Modal::Error(_)));
            self.home = false;
            let opened = ws.path.clone();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or_default();
            if !cfg!(test) {
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
                self.files.allow_quit = false;
            }
            return;
        }
        if self.files.allow_quit {
            self.workbench.update(cx, |s, cx| s.shutdown(cx));
            window.remove_window();
        }
    }
    fn sync_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let mut focus_native = false;
        // Snapshot -> open -> loaded -> thaw settle synchronously with the
        // native editor; a few rounds cover replies that queue new messages.
        for _ in 0..4 {
            if self.files.outgoing.is_empty() {
                break;
            }
            let messages = std::mem::take(&mut self.files.outgoing);
            for message in messages {
                focus_native |= matches!(message, crate::documents::HostMessage::Open { .. });
                let replies = self
                    .native
                    .update(cx, |s, cx| s.receive(&message, window, cx));
                for reply in replies {
                    self.files.client(reply, &self.wake);
                }
            }
        }
        // The workbench close dialog is window-level too.
        let modal = self.modal() || self.workbench.read(cx).dialog_open();
        let home = self.home_visible();
        self.native.update(cx, |s, cx| {
            s.gate(modal || home || self.files.busy(), self.dark, cx)
        });
        if focus_native && !modal && !self.files.busy() {
            self.native
                .update(cx, |editor, cx| editor.focus_document(window, cx));
        }
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
            .is_some_and(|ws| ws.path == path)
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
        at(r)
            .bg(cx.palette().canvas)
            .when(self.files.opened().is_some(), |d| {
                d.child(at(Rect::new(0., 0., r.w, r.h)).child(self.native.clone()))
            })
    }
    /// Compact `ProjectSwitcherRail`: one mark per remembered project.
    fn project_rail(&self, h: f32, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let current = self.files.workspace.as_ref().map(|ws| ws.path.clone());
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
        .busy(busy.then(|| self.preferences.read(cx).state.loading_animation.clone()))
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
        self.refresh_home_activity(cx);
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
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|s, e: &MouseUpEvent, _, cx| {
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
                .child(at(self.layout.explorer).child(self.explorer.clone()))
                .child(at(self.layout.footer).child(self.footer(cx)));
            root = root.child(clipped(panes.left_clip, w, h, explorer));
        }
        if (self.panes.right().open || panes.right_clip.is_some()) && !home {
            // The 8px sash overlays the pane edge (`.po-pane-edge-resize-handle`);
            // content starts at the divider like the product's.
            let auxiliary = at(self.layout.auxiliary).bg(t.auxiliary()).child(
                if self.panes.content() == RightContent::Changes {
                    self.source_control.clone().into_any_element()
                } else {
                    self.workbench.clone().into_any_element()
                },
            );
            root = root.child(clipped(panes.right_clip, w, h, auxiliary));
        }
        if self.rail && !home {
            root = root.child(self.project_rail(h, cx));
        }
        root = root.child(self.header(cx));
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
        root.children(self.modal_layer(w, h, cx))
    }
}
impl Shell {
    /// The modal layer, bottom to top, with the Documents error above it.
    fn modal_layer(&self, w: f32, h: f32, cx: &mut Context<Self>) -> Vec<AnyElement> {
        use crate::localization::t as tr;
        let error = |shell: &Self, message: &str, cx: &mut Context<Self>| {
            shell
                .simple_modal(
                    tr("native.error.title"),
                    message,
                    vec![(
                        tr("common.action.close"),
                        Command::ClearError,
                        ButtonVariant::Solid,
                    )],
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
                Modal::Error(message) => error(self, message, cx),
            })
            .collect();
        if let Some(message) = &self.files.error {
            layer.push(error(self, message, cx));
        }
        layer
    }
}

#[cfg(test)]
mod tests;
