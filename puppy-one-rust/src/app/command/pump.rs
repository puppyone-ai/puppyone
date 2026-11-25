//! The documents pump's results routed to their owners, the session's
//! facts handed to the features, and the window's close.
use super::super::*;

/// What one pump of the runtime brought, to the owners that show it,
/// and the window's close once nothing holds it.
impl Shell {
    pub(in crate::app) fn finish_import_opening(
        &mut self,
        path: &std::path::Path,
        opened: bool,
        cx: &mut Context<Self>,
    ) -> bool {
        let pending = self.session.project.update(cx, |p, _| {
            if p.record
                .pending_import
                .as_ref()
                .is_some_and(|(root, _)| root == path)
            {
                p.record.pending_import.take()
            } else {
                None
            }
        });
        let Some((_, attempt)) = pending else {
            return false;
        };
        self.home
            .update(cx, |h, cx| h.finish_import_opening(&attempt, opened, cx));
        true
    }
    pub(in crate::app) fn route_pumped(
        &mut self,
        pumped: project::Pumped,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some((path, message)) = pumped.failure {
            self.session.project.update(cx, |p, _| {
                if p.record
                    .pending_agent_start
                    .as_ref()
                    .is_some_and(|s| s.root == path)
                {
                    p.record.pending_agent_start = None;
                }
            });
            if !self.finish_import_opening(&path, false, cx) {
                self.close_modal(|m| matches!(m, Modal::ProjectFailure { .. }), cx);
                self.open_modal(Modal::ProjectFailure { path, message }, cx);
            }
        }
        // A Cloud opening that failed says why (`ProjectNavigationFailure`).
        if let Some((project, failure)) = pumped.cloud_failure {
            // A link's conversation is not shown in a project that failed.
            self.session.project.update(cx, |p, _| {
                if p.record
                    .pending_agent_session
                    .as_ref()
                    .is_some_and(|(pending, _)| *pending == project)
                {
                    p.record.pending_agent_session = None;
                }
            });
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
            if let Some(root) = ws.local_root() {
                self.finish_import_opening(root, true, cx);
            }
            self.editor.update(cx, |e, cx| e.cancel_gestures(cx));
            if !self.file_mode() {
                explorer.update(cx, |e, cx| e.load_workspace(ws.clone(), nodes, cx));
            }
            // A lone file has no Git or Terminal; an HTML file window binds its
            // parent folder only for the on-demand Local Agent Chat drawer.
            if !self.file_mode() {
                self.sidebar.update(cx, |s, cx| s.enter(&ws, cx));
                if let Some(entered_root) = ws.local_root() {
                    let entered_canon = entered_root
                        .canonicalize()
                        .unwrap_or_else(|_| entered_root.to_path_buf());
                    let matched = self.session.project.update(cx, |p, _| {
                        let same = p.record.pending_agent_start.as_ref().is_some_and(|s| {
                            let target = s.root.canonicalize().unwrap_or_else(|_| s.root.clone());
                            target == entered_canon
                        });
                        if same {
                            p.record.pending_agent_start.take()
                        } else {
                            None
                        }
                    });
                    if let Some(start) = matched {
                        let runtime_id = start.runtime_id.clone();
                        self.prefs.store.update(cx, |store, cx| {
                            store.change(
                                |prefs| {
                                    prefs.agent_routing =
                                        prefs.agent_routing.select_runtime(Some(&runtime_id));
                                },
                                cx,
                            )
                        });
                        self.sidebar.update(cx, |s, cx| {
                            s.launch_agent_start(&start.runtime_id, &start.prompt, window, cx)
                        });
                    }
                }
            } else if self.file.as_ref().is_some_and(|f| f.read(cx).is_html())
                && let Some(root) = ws.local_root()
            {
                let root = root.to_path_buf();
                self.sidebar.update(cx, |s, cx| s.enter_file_mode(root, cx));
            }
            self.close_modal(|m| matches!(m, Modal::Error(_)), cx);
            let root = ws.local_root().map(PathBuf::from);
            let hosted = self.hosted_project(cx);
            // A link's conversation opens in the Project it named, once that
            // Project is in.
            let session = self.session.project.update(cx, |p, _| {
                match (p.record.pending_agent_session.take(), hosted.as_deref()) {
                    (Some((project, session)), Some(open)) if project == open => Some(session),
                    _ => None,
                }
            });
            if let Some(session) = session {
                self.sidebar
                    .update(cx, |s, cx| s.open_hosted_session(session, window, cx));
            }
            self.dialogs.update(cx, |d, cx| {
                d.set_root(root, cx);
                d.set_cloud_project(hosted, cx);
            });
        }
        if let Some((path, result)) = pumped.children {
            explorer.update(cx, |e, cx| e.children_loaded(&path, result, cx));
        }
        if let Some(relative) = pumped.revealed {
            explorer.update(cx, |e, cx| e.reveal(&relative, cx));
        }
    }
    /// The Documents error shows above the dialogs while it is set; a file
    /// of a folder that can't be opened now says so.
    pub(in crate::app) fn sync_dialog_status(&mut self, cx: &mut Context<Self>) {
        let files = &self.files(cx);
        let status = files.error.clone().filter(|_| !files.cloud_conflict());
        let can_retry = files.can_retry_operation();
        let status = status.map(|error| self.home.update(cx, |h, cx| h.file_error(error, cx)));
        self.dialogs
            .update(cx, |d, cx| d.set_status(status, can_retry, cx));
    }
    /// A close in flight finishes once no entry is being created, the
    /// preferences drained and the account can let go; the window then
    /// retires its tasks and leaves.
    pub(in crate::app) fn finish_close(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
    /// saves as it is edited. A file that is gone or too large is never read
    /// (nor one `hold` keeps loading).
    pub(in crate::app) fn bind_file(
        &mut self,
        file: file_mode::FileTarget,
        hold: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.session.docs.update(cx, |d, _| d.file_window = true);
        self.session.project.update(cx, |p, _| p.file_window = true);
        self.panes.update(cx, |p, cx| p.configure_file_mode(cx));
        if file.is_html() {
            let root = file.root.clone();
            self.sidebar.update(cx, |s, cx| s.enter_file_mode(root, cx));
        }
        if file.admission == file_mode::Admission::Readable && !hold {
            self.session.project.update(cx, |p, _| {
                p.record.open_first = Some(PathBuf::from(&file.name))
            });
            let path = file.path.clone();
            self.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenSingleFile(path)));
        }
        let (docs, editor, prefs, sidebar, panes, cloud) = (
            self.session.docs.clone(),
            self.editor.clone(),
            self.prefs.store.clone(),
            self.sidebar.clone(),
            self.panes.clone(),
            self.cloud.clone(),
        );
        let file = cx.new(|cx| {
            file_mode::FileWindow::new(file, docs, editor, prefs, sidebar, panes, cloud, window, cx)
        });
        cx.observe(&file, |_, _, cx| cx.notify()).detach();
        self.file = Some(file);
    }
    /// What the window's features read of the session, handed over when it
    /// changed.
    /// The other computer's folder on screen hands its tools what that
    /// computer allows now; leaving it closes them.
    fn sync_host_tools(&mut self, view: &session::SessionView, cx: &mut Context<Self>) {
        let target = view
            .device
            .as_ref()
            .and_then(|remote| crate::features::hosts::read(cx)?.tools_target(remote));
        let gone = target.is_none();
        self.sidebar.update(cx, |s, cx| {
            if gone {
                s.leave_host_tools(cx);
            }
            s.host_tools.update(cx, |h, cx| h.set_target(target, cx));
        });
    }
    pub(in crate::app) fn sync_session_view(&mut self, cx: &mut Context<Self>) {
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
            device: self.session.project.read(cx).device(cx),
            opening: self.opening(cx),
            file_mode: self.file_mode(),
            home_requested: self.session.project.read(cx).home,
            entries: self.session.project.read(cx).record.entries,
            fixture: self.session.project.read(cx).record.fixture,
        };
        self.sync_host_tools(&view, cx);
        self.home
            .update(cx, |h, cx| h.set_session(view.clone(), cx));
        self.chrome
            .update(cx, |c, cx| c.set_session(view.clone(), cx));
        let popover = self.chrome.read(cx).popover;
        let sandbox = (!home && !self.file_mode())
            .then(|| self.files(cx).workspace.as_ref()?.sandbox_target())
            .flatten();
        // Computer Mode: a local workspace may be one of this computer's
        // computers, whose screen the window shows.
        let local = (!home && !self.file_mode() && sandbox.is_none() && view.device.is_none())
            .then(|| view.root.clone())
            .flatten();
        self.cloud.update(cx, |c, cx| {
            c.set_session(view, cx);
            c.set_popover(popover, cx);
            c.set_screen_target(sandbox, cx);
            c.set_screen_local(local, cx);
        });
        self.guard_cloud_history(cx);
    }

    /// What the Explorer shows of the shell (`Host`), handed over when it
    /// changes: a document opens or closes, the folder picker opens, a pane
    /// opens or closes, the window resizes. The frame is the Explorer's open
    /// plane, which it keeps while its frame moves.
    pub(in crate::app) fn push_explorer_host(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let size = window.viewport_size();
        let (w, h) = (f32::from(size.width), f32::from(size.height));
        let rail = self.chrome.read(cx).rail_width();
        let screen_active = self.cloud.read(cx).screen_shown(cx);
        let panes = self.panes.read(cx);
        let host = Host {
            frame: panes.open_plane(Side::Start, w, h, rail),
            open: panes.explorer().open,
            opened: (!screen_active)
                .then(|| {
                    self.files(cx)
                        .opened()
                        .map(|(_, relative)| relative.to_path_buf())
                })
                .flatten(),
            open_resources: self.files(cx).open_paths(),
            documents_busy: self.files(cx).busy(),
            folder_busy: self.files(cx).folder_busy,
            picking: self.session.project.read(cx).picking,
            screen_active,
        };
        self.explorer
            .view
            .update(cx, |explorer, cx| explorer.set_host(host, cx));
    }
    /// Store the committed pane layout (`setExplorerWidth`,
    /// `setSidebarCollapsed`, `setRightSidebarWidth`).
    pub(in crate::app) fn persist_panes(&mut self, cx: &mut Context<Self>) {
        if self.file_mode() {
            return;
        }
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
