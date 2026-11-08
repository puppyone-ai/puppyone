//! The project this window shows and how it came to show it
//! (`WindowWorkspaceState`, `useWorkspaceSession`, `ProjectNavigation`):
//! entering a folder or a Cloud project, the launch's restore of the last
//! one, the folder picker, a failed or refused opening, the account a
//! hosted Project was opened under, and the wait while one is on its way
//! ([`preparation`]).
//!
//! [`ProjectLifecycle`] is an entity over the window's documents runtime.
//! The window pumps it ([`ProjectLifecycle::pump`]) and hands what came of
//! the pump ([`Pumped`]) to the owners that show it; what the picker finds
//! later arrives as a [`ProjectEvent`].
mod notices;
mod preparation;

use super::session::DocumentSession;
use crate::documents::Intent;
use crate::editor::workbench::resource_operations::Outcome;
use crate::features::settings::PreferencesStore;
use crate::model::Node;
use crate::workspace;
use crate::workspace::Workspace;
use crate::workspace::cloud::opening::Failure;
use gpui::{prelude::*, *};
use std::{path::PathBuf, sync::Arc};

/// The project this window shows and how it came to show it: its name, the
/// hosted Project and the account it opened under, the launch's restore of
/// the last project, the document to open first, and the notices about the
/// workspace. The documents themselves are the runtime's.
#[derive(Default)]
pub(super) struct WindowProject {
    /// The shown project's name (the Header's project button).
    pub name: String,
    /// The hosted Project this window opened (links, Share, History).
    pub cloud: Option<String>,
    /// The other computer's folder this window opened, and its name.
    pub device: Option<(crate::workspace::cloud::catalog::RemoteFolder, String)>,
    /// The account (user, session generation, API) the Cloud this window
    /// opened, prepares or keeps alive belongs to.
    pub authority: Option<String>,
    /// Launch without a project: open the last active one once preferences
    /// load (`readLastActiveWorkspaceComposition`).
    pub restore_last: bool,
    /// The launch's last Project is opening (`RestoringWorkspaceScreen`).
    pub restoring_open: bool,
    /// The project's document to open first (`initialOpenPath`), relative
    /// to the project.
    pub open_first: Option<PathBuf>,
    /// How many projects this window has entered (`workspaceEntryIntent`).
    pub entries: u64,
    /// `workspaceSurfaceError`: the workspace's change subscription failed.
    pub notice: Option<String>,
    /// The visual fixture project shows (captures and tests start on it).
    pub fixture: bool,
}

/// What the picker found, later, and what the notices ask.
pub(super) enum ProjectEvent {
    /// The folder picker closed: the window pumps the runtime again.
    Picked,
    Error(String),
    /// The workspace notice's Retry (`resumeWorkspace`).
    Retry,
}

/// What one pump of the runtime brought.
#[derive(Default)]
pub(super) struct Pumped {
    /// A local project that could not open, and why.
    pub failure: Option<(PathBuf, String)>,
    /// A Cloud opening that failed: the Project and why.
    pub cloud_failure: Option<(String, Failure)>,
    /// A close a document could not finish (`finishInterceptedClose`).
    pub close_refused: bool,
    /// Resource operations that finished, by owner.
    pub operations: Vec<(String, Outcome)>,
    /// A project was entered: its workspace and first listing.
    pub entered: Option<(Arc<Workspace>, Vec<Node>)>,
    /// A folder's listing.
    pub children: Option<(PathBuf, workspace::Result<Vec<Node>>)>,
    /// Another document came to the front: its path in the project.
    pub revealed: Option<PathBuf>,
}

pub(super) struct ProjectLifecycle {
    docs: Entity<DocumentSession>,
    preferences: Entity<PreferencesStore>,
    pub record: WindowProject,
    /// The folder picker is open.
    pub picking: bool,
    /// The person asked for the Homepage over the open project.
    pub home: bool,
    /// The window is a file window: its folder is not a project to
    /// remember.
    pub file_window: bool,
    /// `useHostFolderRestore`: the launch restored nothing else, so the
    /// other computer's folder this account last had open may reopen, once.
    pub device_restore: bool,
}
impl EventEmitter<ProjectEvent> for ProjectLifecycle {}

impl ProjectLifecycle {
    /// A window's project: the fixture's for captures and tests, else none
    /// yet (a launch's `PUPPYONE_FILE` opens first once one is in).
    pub fn new(
        docs: Entity<DocumentSession>,
        preferences: Entity<PreferencesStore>,
        fixture: bool,
    ) -> Self {
        let record = WindowProject {
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
        };
        Self {
            docs,
            preferences,
            record,
            picking: false,
            home: false,
            file_window: false,
            device_restore: false,
        }
    }
    fn files<'a>(&self, cx: &'a App) -> &'a crate::editor::workbench::runtime::Runtime {
        self.docs.read(cx)
    }
    /// The local project this window shows.
    pub fn root(&self, cx: &App) -> Option<PathBuf> {
        self.files(cx)
            .workspace
            .as_ref()
            .and_then(|ws| ws.local_root().map(PathBuf::from))
    }
    /// The hosted Project this window shows (a Cloud workspace, no local root).
    pub fn hosted(&self, cx: &App) -> Option<String> {
        self.files(cx)
            .workspace
            .as_ref()
            .filter(|ws| ws.local_root().is_none() && !Self::on_device(ws))
            .and(self.record.cloud.clone())
    }
    fn on_device(ws: &Workspace) -> bool {
        ws.resource_id(std::path::Path::new(""))
            .is_ok_and(|id| id.storage.as_str().starts_with("puppyone-device://"))
    }
    /// The other computer's folder this window shows.
    pub fn device(&self, cx: &App) -> Option<crate::workspace::cloud::catalog::RemoteFolder> {
        let ws = self.files(cx).workspace.as_ref()?;
        let (remote, _) = self.record.device.as_ref()?;
        let storage = ws.resource_id(std::path::Path::new("")).ok()?.storage;
        (Self::on_device(ws) && storage.as_str().contains(&remote.folder)).then(|| remote.clone())
    }
    /// A project is on its way into this window.
    pub fn opening(&self, cx: &App) -> bool {
        let files = self.files(cx);
        files.cloud_opening().is_some()
            || files.preparing_root().is_some()
            || files.preparing_device().is_some()
    }
    /// `RestoringWorkspaceScreen`: while the launch reopens the last Project
    /// the window shows a quiet loading mark, never the Homepage.
    pub fn restoring(&self, cx: &App) -> bool {
        self.files(cx).workspace.is_none()
            && (self.record.restore_last || self.record.restoring_open)
    }

    /// Polls the runtime and keeps the record: a project entered names the
    /// window (and is remembered), a failed restore ends the wait, and the
    /// document to open first opens once the project is in.
    pub fn pump(&mut self, cx: &mut Context<Self>) -> Pumped {
        let previous = self.files(cx).opened().map(|(id, _)| id.to_owned());
        let mut pumped = self.docs.update(cx, |d, _| {
            d.poll();
            Pumped {
                failure: d.root_failure.take(),
                cloud_failure: None,
                close_refused: std::mem::take(&mut d.close_refused),
                operations: std::mem::take(&mut d.operation_results),
                entered: None,
                children: d.children_update.take(),
                revealed: None,
            }
        });
        if pumped.failure.is_some() {
            self.record.restoring_open = false;
        }
        if self.record.restoring_open && self.files(cx).workspace.is_some() {
            self.record.restoring_open = false;
        }
        if let Some(failure) = self.docs.update(cx, |d, _| d.take_cloud_failure()) {
            pumped.cloud_failure = Some((self.record.cloud.clone().unwrap_or_default(), failure));
        }
        if pumped.close_refused {
            self.docs.update(cx, |d, _| d.error = None);
        }
        if let Some(nodes) = self.docs.update(cx, |d, _| d.tree_update.take()) {
            let ws = self.files(cx).workspace.clone().unwrap();
            self.record.name = ws.name().to_owned();
            self.record.entries += 1;
            self.record.fixture = false;
            self.home = false;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or_default();
            // Another computer's folder is remembered as that computer's, for
            // the account (`recordRecentHostFolder`).
            if !cfg!(test)
                && Self::on_device(&ws)
                && let Some((remote, name)) = self.record.device.clone()
                && let Some((_, binding)) = crate::features::cloud::account::broker_and_binding(cx)
            {
                crate::features::hosts::remember(crate::features::hosts::Recent {
                    deployment: binding.environment.api().to_owned(),
                    account_id: binding.user.clone(),
                    device_id: remote.device,
                    folder_id: remote.folder,
                    name,
                    host_name: remote.host,
                    writable: remote.writable,
                });
            }
            // A file window's folder is not a project to remember.
            if !cfg!(test)
                && !self.file_window
                && let Some(opened) = ws.local_root().map(PathBuf::from)
            {
                self.preferences.update(cx, |p, cx| {
                    p.change(|p| p.remember_project(&opened, now), cx)
                });
            }
            pumped.entered = Some((ws, nodes));
        }
        if let Some((id, relative)) = self.files(cx).opened()
            && previous.as_deref() != Some(id)
        {
            pumped.revealed = Some(relative.to_path_buf());
        }
        if self.files(cx).workspace.is_some()
            && !self.files(cx).busy()
            && let Some(path) = self.record.open_first.take()
        {
            self.docs.update(cx, |d, _| d.begin(Intent::OpenFile(path)));
        }
        pumped
    }
    /// Switch to a remembered project (`onSelectProject`): the one shown
    /// leaves the Homepage; another starts opening.
    pub fn open_project(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        let files = self.files(cx);
        if files
            .workspace
            .as_ref()
            .is_some_and(|ws| ws.local_root() == Some(path.as_path()))
        {
            self.home = false;
        } else if !self.picking && !files.navigation_blocked() {
            // `ProjectNavigation.select`: a newer choice replaces the one
            // still opening.
            self.docs
                .update(cx, |d, _| d.begin(Intent::OpenFolder(path)));
        }
        cx.notify();
    }
    /// A project just created opens here on `open`.
    pub fn open_created(&mut self, path: PathBuf, open: Option<PathBuf>, cx: &mut Context<Self>) {
        self.open_project(path, cx);
        if self.files(cx).busy() {
            self.record.open_first = open;
        }
    }
    /// Explicit Cloud opening of a hosted Project root in this window;
    /// `Err` with what to say when nobody is signed in.
    pub fn open_cloud(&mut self, project: String, cx: &mut Context<Self>) -> Result<(), String> {
        // `ProjectNavigation.select`: the same target while it is pending
        // joins that opening; another one replaces it.
        let account = super::cloud_authority::account_key(cx);
        if self.files(cx).cloud_opening().is_some()
            && self.record.cloud.as_deref() == Some(project.as_str())
            && self.record.authority == account
            && account.is_some()
        {
            return Ok(());
        }
        self.record.cloud = Some(project.clone());
        self.record.device = None;
        self.record.authority = account;
        let Some((broker, binding)) = crate::features::cloud::account::broker_and_binding(cx)
        else {
            return Err(crate::localization::t("cloud.message.project-sign-in-required").into());
        };
        self.docs
            .update(cx, |d, _| d.open_cloud(broker, binding, project));
        cx.notify();
        Ok(())
    }
    /// Another of the owner's computers' folder, in this window
    /// (`selectHostFolder`); `Err` with what to say when it cannot be
    /// reached from this account.
    pub fn open_device(
        &mut self,
        remote: crate::workspace::cloud::catalog::RemoteFolder,
        name: String,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        let Some((_, binding)) = crate::features::cloud::account::broker_and_binding(cx) else {
            return Err(crate::localization::t("cloud.message.project-sign-in-required").into());
        };
        let Some(hosts) = crate::features::hosts::read(cx).and_then(|c| c.hosts()) else {
            return Err(crate::localization::t("hosts.folder.denied").into());
        };
        if self.files(cx).preparing_device() == Some(remote.folder.as_str()) {
            return Ok(());
        }
        let opened = crate::workspace::hosts::device::Opened {
            api: binding.environment.api().to_owned(),
            account: binding.user.clone(),
            device: remote.device.clone(),
            folder: remote.folder.clone(),
            name: name.clone(),
            host: remote.host.clone(),
            writable: remote.writable,
        };
        self.record.cloud = None;
        self.record.device = Some((remote, name));
        self.record.authority = super::cloud_authority::account_key(cx);
        self.docs.update(cx, |d, _| d.open_device(hosts, opened));
        cx.notify();
        Ok(())
    }
    /// The folder picker, unless something is already on its way.
    pub fn pick(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let files = self.files(cx);
        if self.picking || files.busy() || files.folder_busy {
            return false;
        }
        self.picking = true;
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some(crate::localization::t("onboarding.action.openLocalFolder").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = prompt.await;
            let _ = this.update(cx, |s, cx| {
                s.picking = false;
                match result {
                    Ok(Ok(Some(paths))) => {
                        if let Some(path) = paths.into_iter().next() {
                            s.open_project(path, cx);
                        }
                    }
                    Ok(Err(e)) => cx.emit(ProjectEvent::Error(e.to_string())),
                    Err(e) => cx.emit(ProjectEvent::Error(e.to_string())),
                    _ => {}
                }
                cx.emit(ProjectEvent::Picked);
            });
        })
        .detach();
        cx.notify();
        true
    }
    /// `readLastActiveWorkspaceComposition`: once the preferences load, a
    /// launch without a project opens the last one (`last`, unless it
    /// already shows elsewhere).
    pub fn restore_last(&mut self, last: Option<PathBuf>, cx: &mut Context<Self>) {
        if !self.record.restore_last || !self.preferences.read(cx).loaded {
            return;
        }
        self.record.restore_last = false;
        if let Some(path) = last
            && self.files(cx).workspace.is_none()
        {
            self.open_project(path, cx);
            // Only an opening that started holds the screen (the Project
            // may already show in another window).
            self.record.restoring_open = self.files(cx).opening_root();
        } else {
            self.device_restore = !self.file_window;
        }
    }
    /// The account's last open folder on another computer, once its account
    /// and access side are known; an offline computer shows as offline
    /// inside the folder, never as a stale copy.
    pub fn restore_device(&mut self, cx: &mut Context<Self>) -> bool {
        if !self.device_restore {
            return false;
        }
        if self.files(cx).workspace.is_some() || self.opening(cx) {
            self.device_restore = false;
            return false;
        }
        let Some((_, binding)) = crate::features::cloud::account::broker_and_binding(cx) else {
            return false;
        };
        if !crate::features::flags::host_devices_enabled(&self.preferences, cx)
            || crate::features::hosts::read(cx)
                .and_then(|c| c.hosts())
                .is_none()
        {
            return false;
        }
        self.device_restore = false;
        let Some(last) =
            crate::features::hosts::last_active(binding.environment.api(), &binding.user)
        else {
            return false;
        };
        let remote = crate::workspace::cloud::catalog::RemoteFolder {
            device: last.device_id,
            host: last.host_name,
            folder: last.folder_id,
            writable: last.writable,
            capabilities: vec![],
            online: true,
            paused: false,
        };
        self.open_device(remote, last.name, cx).is_ok()
    }
    /// Leaving the other computer's folder for the Homepage: it is no longer
    /// what a new window reopens.
    pub fn leave_device(&mut self, cx: &mut Context<Self>) {
        if self.device(cx).is_none() || cfg!(test) {
            return;
        }
        if let Some((_, binding)) = crate::features::cloud::account::broker_and_binding(cx) {
            crate::features::hosts::forget_last_active(binding.environment.api(), &binding.user);
        }
    }
    /// The hosted Project's authority under `current` (the account now, or
    /// `None` with Cloud off). When it no longer holds, the opening in
    /// flight is cancelled; `Some(true)` when a Cloud project on screen
    /// leaves for the Homepage.
    pub fn revoke_authority(
        &mut self,
        current: Option<String>,
        cx: &mut Context<Self>,
    ) -> Option<bool> {
        if self.record.authority.is_none() || self.record.authority == current {
            return None;
        }
        self.record.authority = None;
        self.docs.update(cx, |d, _| d.cancel_cloud());
        let hosted = self.hosted(cx).is_some() || self.device(cx).is_some();
        if hosted {
            self.docs.update(cx, |d, _| d.deactivate());
            self.home = true;
        }
        self.record.cloud = None;
        self.record.device = None;
        cx.notify();
        Some(hosted)
    }
}
