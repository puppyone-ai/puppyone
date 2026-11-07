//! Shell commands. Keyboard shortcuts and the native menu bar dispatch typed
//! GPUI actions; every action, button and protocol message resolves to one
//! [`Command`] handled by `Shell::command`.
use crate::{localization::t as tr, ui};
use gpui::*;

/// Everything the shell can be asked to do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Undo,
    Redo,
    Save,
    Reload,
    /// Close the active editor (the pane menu's close).
    CloseFile,
    /// ⌘W (`handleEditorShortcut`): the active editor of a project's
    /// documents closes; with none, the window does (the menu's Close Window).
    CloseEditorOrWindow,
    /// ⌃Tab / ⌃⇧Tab: the next or previous editor tab.
    NextEditor,
    PreviousEditor,
    /// View → Toggle Full Screen.
    ToggleFullScreen,
    /// Editor pane menu "Open in default app".
    OpenExternal,
    /// Close this window through its barrier (window close button, or one
    /// window's share of an app quit).
    Quit,
    /// ⌘Q / app menu Quit: every window closes through its own barrier.
    QuitApp,
    QuitWithProcesses,
    CancelProcessQuit,
    /// A close a document could not save for: "Keep Window Open" / "Close
    /// Anyway".
    KeepWindowOpen,
    CloseAnyway,
    /// A file window's unsaved edits on close: Save, Don't Save, Cancel.
    SaveFileAndClose,
    DiscardFileChanges,
    CancelFileClose,
    OpenFolder,
    /// `openProjectLauncher`: the Project entry launcher.
    CreateNew,
    /// `ProjectNavigationFailure` → Retry / Close.
    RetryProjectOpen,
    CloseProjectFailure,
    ToggleExplorer,
    ToggleRightSidebar,
    Settings,
    Feedback,
    // The Header opens its menus directly; capture scenarios and tests
    // drive them through these commands.
    #[cfg_attr(not(feature = "dev-capture"), allow(dead_code))]
    ProjectMenu,
    #[cfg_attr(not(feature = "dev-capture"), allow(dead_code))]
    LocationMenu,
    Home,
    Escape,
    /// ⌘V outside a text field: a template link on the clipboard opens its
    /// card; anything else keeps its usual paste.
    PasteTemplateLink,
    /// ⌘/ or ⇧⌘M in a Markdown document: live view ↔ source
    /// (`isModeToggleShortcut`).
    ToggleMarkdownSource,
    ClearError,
    RetryFileOperation,
    Changes,
    /// Local Header → Share: the Cloud services dialog (`openCloudDialogAt`).
    CloudServices,
    /// Cloud Header → History (`CloudWorkspaceHeaderTools`).
    CloudHistory,
    /// The Cloud conflict notice's "Discard edits and reload".
    ReloadCloudBaseline,
    /// File → Manage Running Sessions (`file.manageExecutions`).
    ManageExecutions,
    /// File/Dock → New Window (`file.newWindow`, ⌘N).
    NewWindow,
    /// App menu → About PuppyOne (the system panel).
    About,
    /// App menu → Check for Updates… (grouped with About).
    CheckForUpdates,
    /// Window menu.
    Minimize,
    Zoom,
    CloseExecutions,
}
impl Command {
    /// The editor host protocol names pane-menu commands (`ClientMessage::Action`).
    pub fn from_protocol(name: &str) -> Option<Self> {
        Some(match name {
            "open-external" => Self::OpenExternal,
            "close-file" => Self::CloseFile,
            "save" => Self::Save,
            "reload" => Self::Reload,
            _ => return None,
        })
    }
}

macro_rules! shell_actions {
    ($($action:ident => $command:ident),* $(,)?) => {
        actions!(shell, [$($action),*]);
        /// Route each shell action on `element` to `handler`.
        pub fn on_shell_actions<E: InteractiveElement>(
            element: E,
            handler: impl Fn(Command, &mut Window, &mut App) + Clone + 'static,
        ) -> E {
            let mut element = element;
            $(
                let h = handler.clone();
                element = element.on_action(move |_: &$action, window, cx| h(Command::$command, window, cx));
            )*
            element
        }
        /// Global handlers, for menu bar actions dispatched with nothing focused.
        pub fn on_global_shell_actions(cx: &mut App, handler: impl Fn(Command, &mut App) + Clone + 'static) {
            $(
                let h = handler.clone();
                cx.on_action(move |_: &$action, cx| h(Command::$command, cx));
            )*
        }
    };
}
shell_actions! {
    ToggleExplorer => ToggleExplorer,
    ToggleRightSidebar => ToggleRightSidebar,
    OpenSettings => Settings,
    OpenFolder => OpenFolder,
    Save => Save,
    Reload => Reload,
    CloseFile => CloseFile,
    Quit => QuitApp,
    Escape => Escape,
    PasteTemplateLink => PasteTemplateLink,
    ToggleMarkdownSource => ToggleMarkdownSource,
    ManageExecutions => ManageExecutions,
    NewWindow => NewWindow,
    About => About,
    CheckForUpdates => CheckForUpdates,
    Minimize => Minimize,
    Zoom => Zoom,
    CloseWindow => CloseEditorOrWindow,
    OpenHelp => Feedback,
    NextEditor => NextEditor,
    PreviousEditor => PreviousEditor,
    ToggleFullScreen => ToggleFullScreen,
}

/// The Dock menu (`createDockMenuTemplate`).
pub fn dock_menu() -> Vec<MenuItem> {
    vec![MenuItem::action(tr("native.dock.newWindow"), NewWindow)]
}

pub fn bind_keys(cx: &mut App) {
    for modifier in ["cmd", "ctrl"] {
        let key = |k: &str| format!("{modifier}-{k}");
        // The product's own shortcuts: the menu's ⌘, ⌘N ⌘W ⌘Q, ⌘S in a
        // document, ⌘/ and ⇧⌘M for Markdown's view, ⌘V on the Homepage.
        cx.bind_keys([
            KeyBinding::new(&key(","), OpenSettings, None),
            KeyBinding::new(&key("s"), Save, None),
            KeyBinding::new(&key("w"), CloseWindow, None),
            KeyBinding::new(&key("q"), Quit, None),
            KeyBinding::new(&key("n"), NewWindow, None),
            KeyBinding::new(&key("/"), ToggleMarkdownSource, None),
            KeyBinding::new(&key("shift-m"), ToggleMarkdownSource, None),
            KeyBinding::new(&key("v"), PasteTemplateLink, Some("Homepage")),
        ]);
    }
    cx.bind_keys([
        KeyBinding::new("ctrl-tab", NextEditor, None),
        KeyBinding::new("ctrl-shift-tab", PreviousEditor, None),
        KeyBinding::new("ctrl-cmd-f", ToggleFullScreen, None),
    ]);
    cx.bind_keys([
        KeyBinding::new("cmd-h", HideApp, None),
        KeyBinding::new("alt-cmd-h", HideOtherApps, None),
        KeyBinding::new("cmd-m", Minimize, None),
    ]);
    cx.bind_keys([KeyBinding::new("escape", Escape, None)]);
    super::explorer::bind_keys(cx);
}

/// The native menu bar (`createApplicationMenuTemplate`); rebuilt when the
/// locale changes. The product localizes its own commands; Electron's role
/// items and menus (`menu-item-roles`) keep Electron's English labels, and
/// the page-only View items (reload, developer tools, page zoom) have no
/// native window to act on.
pub fn app_menus() -> Vec<Menu> {
    let app = super::windows::APP_NAME;
    vec![
        Menu {
            disabled: false,
            name: app.into(),
            items: vec![
                MenuItem::action(format!("About {app}"), About),
                MenuItem::action(tr("native.menu.checkForUpdates"), CheckForUpdates),
                MenuItem::separator(),
                MenuItem::action(tr("native.menu.settings"), OpenSettings),
                MenuItem::separator(),
                MenuItem::os_submenu("Services", SystemMenuType::Services),
                MenuItem::separator(),
                MenuItem::action(format!("Hide {app}"), HideApp),
                MenuItem::action("Hide Others", HideOtherApps),
                MenuItem::action("Show All", ShowAllApps),
                MenuItem::separator(),
                MenuItem::action(format!("Quit {app}"), Quit),
            ],
        },
        Menu {
            disabled: false,
            name: tr("native.menu.file").into(),
            items: vec![
                MenuItem::action(tr("native.dock.newWindow"), NewWindow),
                MenuItem::separator(),
                MenuItem::action(tr("native.execution.title"), ManageExecutions),
                MenuItem::action("Close Window", CloseWindow),
            ],
        },
        ui::input::edit_menu(),
        Menu {
            disabled: false,
            name: "View".into(),
            items: vec![MenuItem::action("Toggle Full Screen", ToggleFullScreen)],
        },
        crate::features::sub_theme_catalog::theme_menu(|key| tr(key).into()),
        // AppKit adds Bring All to Front and the window list to the menu
        // named "Window".
        Menu {
            disabled: false,
            name: "Window".into(),
            items: vec![
                MenuItem::action("Minimize", Minimize),
                MenuItem::action("Zoom", Zoom),
            ],
        },
        Menu {
            disabled: false,
            name: "Help".into(),
            items: vec![],
        },
    ]
}
// App-level visibility commands need no window.
actions!(shell, [HideApp, HideOtherApps, ShowAllApps]);
/// The application-scoped menu actions (hide/show).
pub fn on_app_actions(cx: &mut App) {
    cx.on_action(|_: &HideApp, cx| cx.hide());
    cx.on_action(|_: &HideOtherApps, cx| cx.hide_other_apps());
    cx.on_action(|_: &ShowAllApps, cx| cx.unhide_other_apps());
    // Theme menu: the selection belongs to the effective colour mode.
    use crate::features::sub_theme_catalog::{self, OpenThemesFolder, SelectSubTheme};
    use crate::ui::appearance::ActiveAppearance as _;
    cx.on_action(|_: &OpenThemesFolder, cx| sub_theme_catalog::open_directory(cx));
    cx.on_action(|action: &SelectSubTheme, cx| {
        let Some(store) = super::windows::preferences(cx) else {
            return;
        };
        let (dark, id) = (cx.is_dark(), action.id.clone());
        store.update(cx, |p, cx| p.change(|p| p.sub_theme_ids.set(dark, id), cx));
    });
}

/// The window's command router: what each [`Command`] does to the window
/// and the owners it routes to.
mod route {
    use super::super::*;

    impl Shell {
        /// Escape on the topmost dialog, each with its own cancel: the Documents
        /// error, then the top of the dialog layer.
        pub(in crate::shell) fn dismiss_modal(
            &mut self,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
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
        pub(in crate::shell) fn pick_workspace(
            &mut self,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
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
                Command::Quit if self.sidebar.read(cx).workbench.read(cx).has_running(cx) => {
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
                    self.sidebar.update(cx, |s, cx| s.toggle_agent(cx));
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
                    let open = self.chrome.read(cx).popover;
                    let next = (open != Some(Popover::Project)).then_some(Popover::Project);
                    self.set_popover(next, cx);
                    let focus = self.chrome.read(cx).project_focus.clone();
                    focus.focus(window, cx);
                }
                Command::LocationMenu => {
                    let open = self.chrome.read(cx).popover;
                    let next = (open != Some(Popover::Place)).then_some(Popover::Place);
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
                            .read(cx)
                            .cloud_history
                            .read(cx)
                            .focus_handle()
                            .contains_focused(window, cx) =>
                {
                    self.sidebar
                        .read(cx)
                        .cloud_history
                        .clone()
                        .update(cx, |h, cx| h.back(cx));
                }
                Command::Escape => {
                    let closed = self.explorer.update(cx, |e, cx| e.dismiss_menu(cx));
                    if !closed && self.chrome.read(cx).popover.is_some() {
                        self.set_popover(None, cx);
                        let focus = self.chrome.read(cx).project_focus.clone();
                        focus.focus(window, cx);
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
                    if markdown
                        && !self.files(cx).busy()
                        && !self.modal(cx)
                        && !self.home_visible(cx)
                    {
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
                    let open = self
                        .sidebar
                        .update(cx, |s, cx| s.toggle_cloud_history(&project, cx));
                    if open {
                        let history = self
                            .sidebar
                            .read(cx)
                            .cloud_history
                            .read(cx)
                            .focus_handle()
                            .clone();
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
                    self.sidebar.update(cx, |s, cx| s.toggle_git(cx));
                    self.focus.focus(window, cx);
                }
                _ => {}
            }
            self.receive(window, cx);
            cx.notify();
        }
        /// Closes Settings or Help; Help's draft goes with it, and the window
        /// takes the focus back ([`DialogEvent::Closed`]).
        pub(in crate::shell) fn close_tasks(&mut self, cx: &mut Context<Self>) {
            self.dialogs.update(cx, |d, cx| d.close_tasks(cx));
        }
        /// A project's editor tabs and the active one's index, while they show
        /// (`activeView === "data"` with editors): what ⌘W and ⌃Tab act on.
        pub(in crate::shell) fn open_editors(&self, cx: &App) -> Option<(Vec<String>, usize)> {
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
    }
}
