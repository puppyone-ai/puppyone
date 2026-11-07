//! The window's commands: what each [`Command`] does to the window and
//! the owners it routes to.
use super::super::*;

impl Shell {
    /// Escape on the topmost dialog, each with its own cancel: the Documents
    /// error, then the top of the dialog layer.
    pub(in crate::app) fn dismiss_modal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
    pub(in crate::app) fn pick_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
    pub(in crate::app) fn close_tasks(&mut self, cx: &mut Context<Self>) {
        self.dialogs.update(cx, |d, cx| d.close_tasks(cx));
    }
    /// A project's editor tabs and the active one's index, while they show
    /// (`activeView === "data"` with editors): what ⌘W and ⌃Tab act on.
    pub(in crate::app) fn open_editors(&self, cx: &App) -> Option<(Vec<String>, usize)> {
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
