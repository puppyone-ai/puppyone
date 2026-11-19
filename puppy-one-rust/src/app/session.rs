//! The window's session: the documents runtime and its worker wake
//! ([`DocumentSession`]), the record of the project this window shows
//! (`WindowWorkspaceState`, `useWorkspaceSession`), the folder picker in
//! flight, this window's task owner key (`ownerId`) and the title last
//! applied. The shell routes what the runtime reports (`Shell::receive`)
//! to the owners that show it; the editor area works on the documents
//! themselves, every other owner gets a narrow [`SessionView`].
use crate::{
    documents::{ClientMessage, Intent},
    editor::workbench::runtime::Runtime as Documents,
    wake::Wake,
};
use gpui::{prelude::*, *};
use std::path::PathBuf;

/// The documents runtime as an entity: the window's workspace and its open
/// documents (the workbench runtime), with the wake its workers ring. The
/// runtime's own methods are reached through `Deref`; the ones that start
/// work take the wake here.
pub(super) struct DocumentSession {
    files: Documents,
    wake: Wake,
}
/// The workers have news: the window pumps the runtime.
pub(super) struct Woke;
impl EventEmitter<Woke> for DocumentSession {}
impl std::ops::Deref for DocumentSession {
    type Target = Documents;
    fn deref(&self) -> &Documents {
        &self.files
    }
}
impl std::ops::DerefMut for DocumentSession {
    fn deref_mut(&mut self) -> &mut Documents {
        &mut self.files
    }
}
impl DocumentSession {
    /// The window's runtime (the fixture's for captures and tests), its
    /// tasks owned by `owner`.
    pub fn new(fixture: bool, owner: String, cx: &mut Context<Self>) -> Self {
        let mut files = if fixture {
            Documents::default()
        } else {
            Documents::native()
        };
        files.task_scope = owner;
        let (wake, rx) = Wake::channel();
        cx.spawn(async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this.update(cx, |_, cx| cx.emit(Woke)).is_err() {
                    break;
                }
            }
        })
        .detach();
        Self { files, wake }
    }
    /// Rings the window's pump.
    pub fn wake(&self) -> &Wake {
        &self.wake
    }
    /// Replaces the runtime (tests start from a bare one).
    #[cfg(test)]
    pub fn replace(&mut self, files: Documents) {
        self.files = files;
    }
    pub fn begin(&mut self, intent: Intent) {
        self.files.begin(intent, &self.wake);
    }
    pub fn poll(&mut self) {
        self.files.poll(&self.wake);
    }
    pub fn flush_pending_auto_save(&mut self) {
        self.files.flush_pending_auto_save(&self.wake);
    }
    pub fn client_for(&mut self, slot: u64, message: ClientMessage) {
        self.files.client_for(slot, message, &self.wake);
    }
    pub fn close_slot(&mut self, slot: u64) {
        self.files.close_slot(slot, &self.wake);
    }
    pub fn retry_slot_save(&mut self, slot: u64) {
        self.files.retry_slot_save(slot, &self.wake);
    }
    pub fn load_children(&mut self, path: PathBuf) {
        self.files.load_children(path, &self.wake);
    }
    pub fn cancel_quit(&mut self) {
        self.files.cancel_quit(&self.wake);
    }
    pub fn retry_operation(&mut self) {
        self.files.retry_operation(&self.wake);
    }
    pub fn persist_metadata(&mut self, force: bool) {
        self.files.persist_metadata(&self.wake, force);
    }
    pub fn resource_operation(
        &mut self,
        operation: crate::editor::workbench::resource_operations::Operation,
    ) -> Result<(), String> {
        self.files.resource_operation(operation, &self.wake)
    }
    pub fn open_at_edge(
        &mut self,
        path: PathBuf,
        pane: &str,
        direction: crate::editor::workbench::layout::Direction,
        placement: crate::editor::workbench::layout::Placement,
    ) {
        self.files
            .open_at_edge(path, pane, direction, placement, &self.wake);
    }
    pub fn open_device(
        &mut self,
        hosts: std::sync::Arc<crate::workspace::hosts::remote::Hosts>,
        opened: crate::workspace::hosts::device::Opened,
    ) {
        self.files.open_device(hosts, opened, &self.wake);
    }
    pub fn open_cloud(
        &mut self,
        broker: std::sync::Arc<crate::cloud::auth::Broker>,
        binding: crate::cloud::auth::model::Binding,
        project: String,
    ) {
        self.files.open_cloud(broker, binding, project, &self.wake);
    }
}

pub(super) struct WindowSession {
    /// The documents runtime.
    pub docs: Entity<DocumentSession>,
    /// The project this window shows and how it came to show it.
    pub project: Entity<super::project::ProjectLifecycle>,
    /// This window's budget owner (`ownerId`), shared with its hosts.
    pub key: String,
    /// The window title, represented file and edited mark last applied.
    pub title: Option<(String, Option<PathBuf>, bool)>,
}

/// What the window's features read of its session, handed to them when it
/// changes (after each pump of the documents runtime).
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct SessionView {
    /// The window shows the Homepage.
    pub home: bool,
    /// The Homepage or the Header's project menu lists the projects.
    pub listing: bool,
    /// A workspace is open.
    pub workspace: bool,
    /// The open local project's folder.
    pub root: Option<PathBuf>,
    /// The documents, the folder or the picker are busy, or a Cloud
    /// project is on its way in.
    pub busy: bool,
    /// A Cloud project is on its way in.
    pub cloud_opening: bool,
    /// The launch reopens the last project (`RestoringWorkspaceScreen`).
    pub restoring: bool,
    /// The shown project's name.
    pub name: String,
    /// The hosted Project this window opened (`None` for a local folder).
    pub cloud_project: Option<String>,
    /// The hosted Project on screen: a Cloud workspace with no local root.
    pub hosted: Option<String>,
    /// The other computer's folder on screen.
    pub device: Option<crate::workspace::cloud::catalog::RemoteFolder>,
    /// A project is on its way in and the window shows its preparation.
    pub opening: bool,
    /// A file window (File Mode): one file, no project.
    pub file_mode: bool,
    /// The person asked for the Homepage over the open project.
    pub home_requested: bool,
    /// How many projects this window has entered.
    pub entries: u64,
    /// The visual fixture project shows.
    pub fixture: bool,
}

impl WindowSession {
    /// `resolveWindowTitle`: "PuppyOne - <project>" with the project's
    /// folder as the represented file (`root`, with its `name`); nothing in
    /// full screen, where macOS shows it. A file window (`file`: its name,
    /// its path, unsaved) is titled by its file and shows when it is
    /// unsaved. Applied only when it changed.
    pub fn apply_title(
        &mut self,
        window: &mut Window,
        file: Option<(String, PathBuf, bool)>,
        root: Option<PathBuf>,
        name: &str,
    ) {
        let project = root.is_some().then_some(name);
        let (title, path, edited) = match file {
            Some((title, path, dirty)) => (Some(title), Some(path), dirty),
            None => (None, root, false),
        };
        let title = window_title(title, project, window.is_fullscreen());
        let next = (title, path, edited);
        if self.title.as_ref() != Some(&next) {
            window.set_window_title(&next.0);
            window.set_document_path(next.1.as_deref());
            window.set_window_edited(next.2);
            self.title = Some(next);
        }
    }
}

/// `resolveWindowTitle`: a file window's file, else "PuppyOne - <project>"
/// (the app alone without a project); nothing in full screen, so the native
/// reveal bar carries no application title.
fn window_title(file: Option<String>, project: Option<&str>, fullscreen: bool) -> String {
    if fullscreen {
        return String::new();
    }
    let app = super::windows::application_name();
    match (file, project) {
        (Some(file), _) => file,
        (None, Some(name)) if !name.is_empty() => format!("{app} - {name}"),
        (None, _) => app.to_owned(),
    }
}

#[cfg(test)]
mod title_tests {
    use super::*;
    use core::prelude::v1::test;

    /// `titlebarDragRegionArchitecture`: the full-screen reveal bar is free
    /// of application titles, and leaving full screen restores the title.
    #[test]
    fn full_screen_shows_no_title_and_leaving_it_restores_one() {
        let app = super::super::windows::application_name();
        assert_eq!(window_title(None, Some("notes"), true), "");
        assert_eq!(window_title(Some("plan.md".into()), None, true), "");
        assert_eq!(
            window_title(None, Some("notes"), false),
            format!("{app} - notes")
        );
        assert_eq!(window_title(None, Some(""), false), app);
        assert_eq!(window_title(None, None, false), app);
        assert_eq!(
            window_title(Some("plan.md".into()), Some("notes"), false),
            "plan.md"
        );
    }
}
