//! What the window's owners ask of it: their events routed to the window
//! and to each other.
use super::super::*;

/// What the window's owners ask of it.
impl Shell {
    /// The Header card or menu that is open: one at a time.
    pub(in crate::app) fn set_popover(&mut self, popover: Option<Popover>, cx: &mut Context<Self>) {
        if self.chrome.read(cx).popover != popover {
            self.chrome.update(cx, |c, cx| c.set_popover(popover, cx));
            self.sync_session_view(cx);
            cx.notify();
        }
    }
    /// What the Header and the rail ask of the window.
    pub(in crate::app) fn chrome_event(
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
            ChromeEvent::HostTool(tool) => {
                let tool = *tool;
                self.sidebar
                    .update(cx, |s, cx| s.toggle_host_tool(tool, window, cx));
            }
            ChromeEvent::Navigate(navigate) => self.navigate(navigate.clone(), window, cx),
            // The project rail takes room from the panes.
            ChromeEvent::RailChanged => {
                self.constrain_window(window, cx);
                self.push_explorer_host(window, cx);
            }
        }
    }
    /// What the Cloud asks of the window.
    pub(in crate::app) fn cloud_event(
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
            CloudEvent::OpenSettings(page) => return self.open_settings(*page, window, cx),
            CloudEvent::Popover(popover) => return self.set_popover(*popover, cx),
            CloudEvent::Error(error) => self.show_error(error.clone(), cx),
            // `onCreated`: the spaces read again, then the new one's
            // Members, ready for an invitation.
            CloudEvent::SpaceCreated(space) => {
                crate::features::cloud::global_spaces(cx)
                    .update(cx, |spaces, cx| spaces.ensure(true, true, true, cx));
                return self.open_space_settings(space.clone(), true, window, cx);
            }
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// `closeWorkspaceSidebars`: collapse the right sidebar and release the
    /// focus it held; drafts, widths and sessions stay.
    pub(in crate::app) fn close_workspace_sidebars(
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
    pub(in crate::app) fn guard_cloud_authority(
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
        if hosted {
            self.close_workspace_sidebars(window, cx);
            self.receive(window, cx);
        }
        cx.notify();
    }
    /// What the Homepage asks for.
    pub(in crate::app) fn home_event(
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
            home::HomeEvent::OpenDevice(remote, name) => {
                self.set_popover(None, cx);
                self.open_device(remote.clone(), name.clone(), cx);
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
            home::HomeEvent::PublishToSpace { path, space } => {
                let (path, space) = (path.clone(), space.clone());
                self.cloud
                    .update(cx, |c, cx| c.request_publish(path, space, cx));
            }
            home::HomeEvent::ShareFolder { path } => {
                let path = path.clone();
                self.cloud
                    .update(cx, |c, cx| c.request_device_sharing(path, window, cx));
            }
            home::HomeEvent::Command(command) => return self.command(*command, window, cx),
            home::HomeEvent::ManageSpace(space) => {
                return self.open_space_settings(space.clone(), false, window, cx);
            }
            // A file error of that folder says why.
            home::HomeEvent::WindowFolder => {}
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// A row of a Homepage project's "Who can open it": copy it to a team
    /// (opening it first), open its Cloud copy, or open it to my devices.
    pub(in crate::app) fn home_audience_action(
        &mut self,
        action: audience::AudienceAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use audience::AudienceAction as A;
        match action {
            A::CopyToTeam { path, space } => self
                .cloud
                .update(cx, |c, cx| c.request_publish(path, space, cx)),
            A::OpenCloud(project) => {
                self.set_popover(None, cx);
                self.open_cloud(project, cx);
            }
            other => self
                .cloud
                .update(cx, |c, cx| c.run_audience_action(other, window, cx)),
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// Opens an entry of the Header's project menu in this window: a local
    /// folder, or a Cloud project (`selectCloudProject`).
    pub(in crate::app) fn open_item(
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
    /// `ProjectFolderNotices` and `LocalFolderCloudNotice`: what is said
    /// about the window's folder, the one that cannot be opened first.
    pub(in crate::app) fn folder_notices(
        &self,
        cx: &App,
    ) -> Vec<crate::ui::components::FloatingNotice> {
        self.home
            .read(cx)
            .folder_notice()
            .into_iter()
            .chain(self.cloud.read(cx).local_folder_notice_view(cx))
            .collect()
    }
    /// The Settings page `page`, opened.
    pub(in crate::app) fn open_settings(
        &mut self,
        page: crate::features::settings::Page,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.show_settings(page, None, false, window, cx);
    }
    /// `openSpaceSettings`: Settings › Members of one space; `invite` puts
    /// the keyboard in its invitation field.
    pub(in crate::app) fn open_space_settings(
        &mut self,
        space: String,
        invite: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let page = crate::features::settings::Page::Space;
        self.show_settings(page, Some(space), invite, window, cx);
    }
    fn show_settings(
        &mut self,
        page: crate::features::settings::Page,
        space: Option<String>,
        invite: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // `resolveSettingsSpace`: the space the opener named, else the
        // hosted Project's on screen.
        let hosted = self.hosted_project(cx);
        let handle = invite.then(|| window.window_handle());
        let settings = self.dialogs.read(cx).settings.clone();
        settings.update(cx, |settings, cx| {
            settings.set_space_context(hosted, space, handle);
            settings.select_page(page, cx)
        });
        self.command(Command::Settings, window, cx);
    }
    /// `WindowNavigationRows`: what a row of the place menu asks.
    pub(in crate::app) fn navigate(
        &mut self,
        navigate: chrome::navigation::Navigate,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::features::settings::Page;
        use chrome::navigation::Navigate;
        self.set_popover(None, cx);
        match navigate {
            Navigate::Home => self.command(Command::Home, window, cx),
            // `showHomepagePlace`: the Homepage scrolls to the place, from
            // wherever the window was.
            Navigate::ShowPlace(place) => {
                self.home.update(cx, |h, cx| h.focus_place(&place, cx));
                if !self.home_visible(cx) {
                    self.command(Command::Home, window, cx);
                }
            }
            Navigate::CreateSpace => self
                .cloud
                .update(cx, |c, cx| c.open_create_space(window, cx)),
            Navigate::OpenAccount => self.open_settings(Page::Account, window, cx),
            Navigate::OpenSettings => self.open_settings(Page::General, window, cx),
            Navigate::SignIn => crate::features::cloud::account::sign_in(cx),
        }
        cx.notify();
    }
    /// What the dialog layer asks of the window.
    pub(in crate::app) fn dialog_event(
        &mut self,
        event: &DialogEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            DialogEvent::Command(command) => return self.command(*command, window, cx),
            DialogEvent::OpenImport => {
                self.home.update(cx, |h, cx| h.begin_import(window, cx));
            }
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
    pub(in crate::app) fn start_create(
        &mut self,
        kind: crate::features::create_new::Entry,
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
    pub(in crate::app) fn sidebar_event(
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
                use crate::features::desktop_agent::resolve_agent_workspace_provider_path as resolve;
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
    /// A project's menu acted: who can open it, or a folder's new name,
    /// which names the window that shows it.
    pub(in crate::app) fn project_actions_event(
        &mut self,
        event: &super::super::project_actions::ActionsEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use super::super::project_actions::ActionsEvent;
        if let ActionsEvent::Audience(action) = event {
            self.home_audience_action(action.clone(), window, cx);
        }
        if let ActionsEvent::Renamed { path, name } = event
            && self.workspace_root(cx).as_deref() == Some(path.as_path())
        {
            let name = name.clone();
            self.session.project.update(cx, |p, _| p.record.name = name);
            self.sync_session_view(cx);
            self.sync_window_title(window, cx);
        }
        cx.notify();
    }
    pub(in crate::app) fn open_cloud(&mut self, project: String, cx: &mut Context<Self>) {
        if let Err(error) = self
            .session
            .project
            .update(cx, |p, cx| p.open_cloud(project, cx))
        {
            self.show_error(error, cx);
        }
        cx.notify();
    }
    /// `useHostFolderRestore`, when its account and access side are known.
    pub(in crate::app) fn restore_device(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self
            .session
            .project
            .update(cx, |p, cx| p.restore_device(cx))
        {
            self.receive(window, cx);
            cx.notify();
        }
    }
    /// Another of my computers' folder, in this window.
    pub(in crate::app) fn open_device(
        &mut self,
        remote: crate::workspace::cloud::catalog::RemoteFolder,
        name: String,
        cx: &mut Context<Self>,
    ) {
        if let Err(error) = self
            .session
            .project
            .update(cx, |p, cx| p.open_device(remote, name, cx))
        {
            self.show_error(error, cx);
        }
        // What the folder allows can change on its computer at any time.
        crate::features::hosts::global(cx).update(cx, |h, cx| h.ensure(true, true, true, cx));
        cx.notify();
    }
    /// Switch to a remembered project (`onSelectProject`).
    pub(in crate::app) fn open_project(
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
    pub(in crate::app) fn retry_workspace_surface(&mut self, cx: &mut Context<Self>) {
        match self.hosted_project(cx) {
            Some(project) => self.open_cloud(project, cx),
            None => self.explorer.session.update(cx, |e, cx| e.resubscribe(cx)),
        }
        cx.notify();
    }
    /// `useHomepageCloudProjects`: load or revalidate the account catalog.
    pub(in crate::app) fn refresh_cloud_catalog(&mut self, retry: bool, cx: &mut Context<Self>) {
        self.cloud.update(cx, |c, cx| c.refresh_catalog(retry, cx));
    }
}

/// What the runtime, the Explorer, the panes and the window ask of it.
impl Shell {
    /// The workers' news: the window pumps the runtime, and draws again
    /// when what it shows changed.
    pub(in crate::app) fn woke(
        &mut self,
        _: &session::Woke,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let shown = |s: &Shell, cx: &App| {
            let files = s.files(cx);
            (
                files.presentation_key(),
                files.generation,
                s.session.project.read(cx).record.name.clone(),
            )
        };
        let before = shown(self, cx);
        self.receive(window, cx);
        if shown(self, cx) != before {
            cx.notify();
        }
    }
    /// The folder picker's answer, and the workspace notice's Retry.
    pub(in crate::app) fn project_event(
        &mut self,
        event: &project::ProjectEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            project::ProjectEvent::Error(error) => self.show_error(error.clone(), cx),
            project::ProjectEvent::Retry => self.retry_workspace_surface(cx),
            project::ProjectEvent::Picked => {}
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// A pane menu command, or the runtime asked for something.
    pub(in crate::app) fn editor_event(
        &mut self,
        event: &editor_area::EditorEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            editor_area::EditorEvent::Command(command) => self.command(*command, window, cx),
            editor_area::EditorEvent::Pump => {
                self.receive(window, cx);
                cx.notify();
            }
        }
    }
    /// The panes move and resize on their own input; the window stores
    /// what the person committed and stays large enough for them.
    pub(in crate::app) fn pane_event(
        &mut self,
        event: &PaneEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            PaneEvent::Committed => self.persist_panes(cx),
            PaneEvent::OpenChanged => {
                self.constrain_window(window, cx);
                self.push_explorer_host(window, cx);
                self.guard_cloud_history(cx);
            }
            PaneEvent::PulledOut => self.sidebar.update(cx, |s, _| s.pulled_out()),
        }
    }
    /// What the Explorer's session needs from the workspace.
    pub(in crate::app) fn explorer_session_event(
        &mut self,
        event: &SessionEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            SessionEvent::ReferencesChanged => {}
            SessionEvent::LoadChildren(path) => {
                let path = path.clone();
                self.session.docs.update(cx, |d, _| d.load_children(path))
            }
            SessionEvent::ResourceOperation(operation) => {
                let operation = operation.clone();
                if let Err(error) = self
                    .session
                    .docs
                    .update(cx, |d, _| d.resource_operation(operation))
                {
                    self.explorer
                        .session
                        .update(cx, |e, cx| e.operation_failed(cx));
                    self.show_error(error, cx);
                }
            }
            SessionEvent::Error(error) => self.show_error(error.clone(), cx),
            SessionEvent::WatchFailed(error) => {
                let error = error.clone();
                self.session
                    .project
                    .update(cx, |p, _| p.record.notice = Some(error))
            }
            SessionEvent::WatchRecovered => self
                .session
                .project
                .update(cx, |p, _| p.record.notice = None),
            // `onWorkspaceActivity` → `invalidateGitStatus("working-tree")`.
            SessionEvent::ContentChanged => {
                let source_control = self.sidebar.read(cx).source_control.clone();
                source_control.update(cx, |sc, cx| sc.invalidate(cx));
            }
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// What the person asks for through the Explorer.
    pub(in crate::app) fn explorer_event(
        &mut self,
        event: &ExplorerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            ExplorerEvent::Open(path) => {
                let path = path.clone();
                self.session
                    .docs
                    .update(cx, |d, _| d.begin(Intent::OpenFile(path)))
            }
            ExplorerEvent::Create { entry, parent } => {
                self.start_create(*entry, parent.clone(), window, cx)
            }
            ExplorerEvent::Rename { path, change_type } => self
                .dialogs
                .update(cx, |d, cx| d.rename(path.clone(), *change_type, window, cx)),
            ExplorerEvent::Error(error) => self.show_error(error.clone(), cx),
            ExplorerEvent::CopyLink { path, folder } => self
                .cloud
                .update(cx, |c, cx| c.copy_link(path, *folder, cx)),
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// The preferences changed: the window's projections, the catalog,
    /// a hosted selection Cloud turned off revokes, and the launch's
    /// restore once they load.
    pub(in crate::app) fn preferences_event(
        &mut self,
        _: &crate::features::settings::PreferencesChanged,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.preferences_changed(window, cx);
        self.refresh_cloud_catalog(false, cx);
        self.guard_cloud_authority(window, cx);
        if self.session.project.read(cx).record.restore_last {
            let last = windows::last_active_project(cx);
            self.session
                .project
                .update(cx, |p, cx| p.restore_last(last, cx));
            self.receive(window, cx);
        }
    }
    /// The window came forward or went behind.
    pub(in crate::app) fn window_activated(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let active = window.is_window_active();
        let source_control = self.sidebar.read(cx).source_control.clone();
        source_control.update(cx, |sc, cx| sc.set_focused(active, cx));
        if !active {
            // Leaving the window abandons an editor drag (`blur` cancels).
            self.editor.update(cx, |e, cx| e.cancel_gestures(cx));
            return;
        }
        cx.set_reduce_motion(crate::platform::accessibility::reduce_motion());
        // The catalog refreshes whenever a window regains focus.
        crate::features::sub_theme_catalog::refresh(cx);
        // `browser-window-focus`: bounded foreground activity.
        crate::features::telemetry::note_foreground(cx);
        // A returning window may probe the Cloud association once.
        self.cloud.update(cx, |c, cx| c.probe(cx));
        // A file window watches nothing: the file is read again when the
        // window comes back (FileModeDocument's `focus`).
        if self.file_mode() {
            self.session.docs.update(cx, |d, _| d.revalidate());
            self.receive(window, cx);
            cx.notify();
        }
    }
    /// The window's close button: a close in flight finishes once the
    /// preferences drained, no entry is being created and the account
    /// can let go; otherwise the close starts (through the documents).
    pub(in crate::app) fn should_close(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.files(cx).allow_quit {
            self.prefs.store.read(cx).drained()
                && !self.dialogs.read(cx).creating(cx)
                && (windows::count(cx) > 1
                    || !windows::last_close_quits(cx)
                    || crate::features::cloud::account::close_ready(cx))
        } else {
            self.command(Command::Quit, window, cx);
            false
        }
    }
}
