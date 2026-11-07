//! The documents pump's results routed to their owners, the session's
//! facts handed to the features, and the window's close.
use super::super::*;

/// What one pump of the runtime brought, to the owners that show it,
/// and the window's close once nothing holds it.
impl Shell {
    pub(in crate::shell) fn route_pumped(
        &mut self,
        pumped: project::Pumped,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some((path, message)) = pumped.failure {
            self.close_modal(|m| matches!(m, Modal::ProjectFailure { .. }), cx);
            self.open_modal(Modal::ProjectFailure { path, message }, cx);
        }
        // A Cloud opening that failed says why (`ProjectNavigationFailure`).
        if let Some((project, failure)) = pumped.cloud_failure {
            self.cloud
                .update(cx, |c, cx| c.show_recovery(project, failure, cx));
        }
        // `finishInterceptedClose`: a close a document could not finish
        // asks whether to keep the window or close anyway, instead of the
        // error.
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
        let explorer = self.explorer.session.clone();
        for (owner, outcome) in pumped.operations {
            explorer.update(cx, |e, cx| e.finish_op(&owner, outcome, cx));
        }
        if let Some((ws, nodes)) = pumped.entered {
            self.editor.update(cx, |e, cx| e.cancel_gestures(cx));
            explorer.update(cx, |e, cx| e.load_workspace(ws.clone(), nodes, cx));
            // A lone file has no Agent, Git or Terminal.
            if !self.file_mode() {
                self.sidebar.update(cx, |s, cx| s.enter(&ws, cx));
            }
            self.close_modal(|m| matches!(m, Modal::Error(_)), cx);
            let root = ws.local_root().map(PathBuf::from);
            self.dialogs.update(cx, |d, cx| d.set_root(root, cx));
        }
        if let Some((path, result)) = pumped.children {
            explorer.update(cx, |e, cx| e.children_loaded(&path, result, cx));
        }
        if let Some(relative) = pumped.revealed {
            explorer.update(cx, |e, cx| e.reveal(&relative, cx));
        }
    }
    /// A close in flight finishes once no entry is being created, the
    /// preferences drained and the account can let go; the window then
    /// retires its tasks and leaves.
    pub(in crate::shell) fn finish_close(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.dialogs.read(cx).creating(cx) {
            return;
        }
        if !self.prefs.store.read(cx).drained() {
            if let Some(error) = self.prefs.store.read(cx).error.clone() {
                self.show_error(error, cx);
                self.session.docs.update(cx, |d, _| d.cancel_quit());
                windows::cancel_quit(cx);
                self.sync_editor(window, cx);
            }
            return;
        }
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
    /// The file's folder is the window's root; only the file shows, and it
    /// saves when asked. A file that is gone or too large is never read
    /// (nor one `hold` keeps loading).
    pub(in crate::shell) fn bind_file(
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
    /// What the window's features read of the session, handed over when it
    /// changed.
    pub(in crate::shell) fn sync_session_view(&mut self, cx: &mut Context<Self>) {
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
    /// Store the committed pane layout (`setExplorerWidth`,
    /// `setSidebarCollapsed`, `setRightSidebarWidth`).
    pub(in crate::shell) fn persist_panes(&mut self, cx: &mut Context<Self>) {
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
