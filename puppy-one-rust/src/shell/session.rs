//! The window's session: the documents runtime and its worker wake, the
//! record of the project this window shows (`WindowWorkspaceState`,
//! `useWorkspaceSession`), the folder picker in flight, this window's task
//! owner key (`ownerId`) and the title last applied. The shell routes what
//! the runtime reports (`Shell::receive`) to the owners that show it; the
//! owners get narrow snapshots, never the runtime itself.
use crate::{editor::workbench::runtime::Runtime as Documents, wake::Wake};
use std::path::PathBuf;

pub(super) struct WindowSession {
    pub files: Documents,
    pub wake: Wake,
    pub project: WindowProject,
    /// The folder picker is open.
    pub picking: bool,
    /// This window's budget owner (`ownerId`), shared with its hosts.
    pub key: String,
    /// The window title, represented file and edited mark last applied.
    pub title: Option<(String, Option<PathBuf>, bool)>,
    /// The person asked for the Homepage over the open project.
    pub home: bool,
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
    /// A project is on its way in and the window shows its preparation.
    pub opening: bool,
    /// A file window (File Mode): one file, no project.
    pub file_mode: bool,
}

/// The project this window shows and how it came to show it: its name, the
/// hosted Project and the account it opened under, the launch's restore of
/// the last project, the document to open first, and the notices about the
/// workspace. The documents themselves are the editor's.
#[derive(Default)]
pub(super) struct WindowProject {
    /// The shown project's name (the Header's project button).
    pub name: String,
    /// The hosted Project this window opened (links, Share, History).
    pub cloud: Option<String>,
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
    pub open_first: Option<std::path::PathBuf>,
    /// How many projects this window has entered (`workspaceEntryIntent`).
    pub entries: u64,
    /// `workspaceSurfaceError`: the workspace's change subscription failed.
    pub notice: Option<String>,
    /// A Cloud recovery's Details disclosure is open.
    pub recovery_details: bool,
    /// The visual fixture project shows (captures and tests start on it).
    pub fixture: bool,
}
