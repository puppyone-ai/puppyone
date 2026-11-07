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
            if self.session.project.update(cx, |p, cx| p.pick(window, cx)) {
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
                    self.frame.focus.focus(window, cx);
                    cx.notify();
                    return;
                }
                Command::Quit if self.sidebar.read(cx).workbench.read(cx).has_running(cx) => {
                    self.open_modal(Modal::ConfirmQuit, cx);
                    self.frame.focus.focus(window, cx);
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
                    self.frame.focus.focus(window, cx);
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
                        self.frame.focus.focus(window, cx);
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
                    self.explorer.view.update(cx, |e, cx| e.dismiss_menu(cx));
                    let root = self.workspace_root(cx);
                    self.dialogs.update(cx, |d, cx| {
                        d.set_root(root, cx);
                        d.open(Modal::Task(Task::Settings), cx)
                    });
                    self.focus_dialogs(window, cx);
                }
                Command::Feedback => {
                    self.set_popover(None, cx);
                    self.explorer.view.update(cx, |e, cx| e.dismiss_menu(cx));
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
                    self.explorer.view.update(cx, |e, cx| e.dismiss_menu(cx));
                    if !self.home_visible(cx) {
                        self.home.update(cx, |h, _| h.hold_list());
                    }
                    self.session.project.update(cx, |p, _| p.home = true);
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
                    let closed = self.explorer.view.update(cx, |e, cx| e.dismiss_menu(cx));
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
                        self.frame.focus.focus(window, cx);
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
                    self.frame.focus.focus(window, cx);
                }
                Command::Changes => {
                    if self.files(cx).workspace.is_none() {
                        return;
                    }
                    self.sidebar.update(cx, |s, cx| s.toggle_git(cx));
                    self.frame.focus.focus(window, cx);
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

    /// What the window's owners ask of it.
    impl Shell {
        /// The Header card or menu that is open: one at a time.
        pub(in crate::shell) fn set_popover(
            &mut self,
            popover: Option<Popover>,
            cx: &mut Context<Self>,
        ) {
            if self.chrome.read(cx).popover != popover {
                // Share opens on a snapshot of what is open.
                if popover == Some(Popover::Share) {
                    let resource = match self.explorer.session.read(cx).selected_folder() {
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
        pub(in crate::shell) fn chrome_event(
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
        pub(in crate::shell) fn cloud_event(
            &mut self,
            event: &window_cloud::CloudEvent,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            use window_cloud::CloudEvent;
            match event {
                CloudEvent::OpenProject(path) => {
                    return self.open_project(path.clone(), window, cx);
                }
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
        pub(in crate::shell) fn close_workspace_sidebars(
            &mut self,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            self.sidebar.update(cx, |s, cx| s.collapse(cx));
            self.set_popover(None, cx);
            self.frame.focus.focus(window, cx);
        }
        /// The hosted Project's authority: when it no longer holds, the opening
        /// in flight is cancelled and a Cloud project on screen leaves for the
        /// Homepage.
        pub(in crate::shell) fn guard_cloud_authority(
            &mut self,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            let current = if crate::features::flags::cloud_enabled(&self.prefs.store, cx) {
                cloud_authority::account_key(cx)
            } else {
                None
            };
            let Some(hosted) = self
                .session
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
        pub(in crate::shell) fn home_event(
            &mut self,
            event: &home::HomeEvent,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
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
                    self.session
                        .project
                        .update(cx, |p, cx| p.open_created(path, open, cx));
                }
                home::HomeEvent::Command(command) => return self.command(*command, window, cx),
            }
            self.receive(window, cx);
            cx.notify();
        }
        /// Opens an entry of the Header's project menu in this window: a local
        /// folder, or a Cloud project (`selectCloudProject`).
        pub(in crate::shell) fn open_item(
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
        /// The Settings page `page`, opened.
        pub(in crate::shell) fn open_settings(
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
        pub(in crate::shell) fn dialog_event(
            &mut self,
            event: &DialogEvent,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            match event {
                DialogEvent::Command(command) => return self.command(*command, window, cx),
                DialogEvent::Closed => self.frame.focus.focus(window, cx),
                DialogEvent::Error(error) => {
                    self.show_error(error.clone(), cx);
                    self.frame.focus.focus(window, cx);
                }
                DialogEvent::ModelConfigurationChanged => {
                    let workbench = self.sidebar.read(cx).workbench.clone();
                    workbench.update(cx, |w, cx| w.reload_agent_configuration(cx));
                }
                DialogEvent::ForgetProject(path) => {
                    let path = path.clone();
                    self.prefs
                        .store
                        .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
                    if self.workspace_root(cx).as_deref() == Some(path.as_path()) {
                        return self.command(Command::Home, window, cx);
                    }
                }
                DialogEvent::Rename { path, name } => {
                    let (path, name) = (path.clone(), name.clone());
                    self.explorer
                        .session
                        .update(cx, |session, cx| session.rename(path, name, cx));
                    self.frame.focus.focus(window, cx);
                }
                DialogEvent::Created {
                    workspace,
                    parent,
                    path,
                    folder,
                    nodes,
                } => {
                    self.frame.focus.focus(window, cx);
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
                    self.explorer
                        .session
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
        pub(in crate::shell) fn start_create(
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
        /// What the right sidebar's surfaces ask of the window.
        pub(in crate::shell) fn sidebar_event(
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
                    self.explorer
                        .session
                        .update(cx, |e, cx| e.refresh_published(cx));
                    self.session.docs.update(cx, |d, _| d.observe_publication());
                }
                SidebarEvent::Closed => self.frame.focus.focus(window, cx),
            }
            self.receive(window, cx);
            cx.notify();
        }
        pub(in crate::shell) fn open_cloud(&mut self, project: String, cx: &mut Context<Self>) {
            if let Err(error) = self
                .session
                .project
                .update(cx, |p, cx| p.open_cloud(project, cx))
            {
                self.show_error(error, cx);
            }
            cx.notify();
        }
        /// Switch to a remembered project (`onSelectProject`).
        pub(in crate::shell) fn open_project(
            &mut self,
            path: PathBuf,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            self.set_popover(None, cx);
            self.session
                .project
                .update(cx, |p, cx| p.open_project(path, cx));
            self.receive(window, cx);
            cx.notify();
        }
        /// `resumeWorkspace`: a hosted Project opens again explicitly (its
        /// retained documents rebind to the new lease); a local folder
        /// subscribes again. Both reread what the Explorer has loaded.
        pub(in crate::shell) fn retry_workspace_surface(&mut self, cx: &mut Context<Self>) {
            match self.hosted_project(cx) {
                Some(project) => self.open_cloud(project, cx),
                None => self.explorer.session.update(cx, |e, cx| e.resubscribe(cx)),
            }
            cx.notify();
        }
        /// `useHomepageCloudProjects`: load or revalidate the account catalog.
        pub(in crate::shell) fn refresh_cloud_catalog(
            &mut self,
            retry: bool,
            cx: &mut Context<Self>,
        ) {
            self.cloud.update(cx, |c, cx| c.refresh_catalog(retry, cx));
        }
    }
}
