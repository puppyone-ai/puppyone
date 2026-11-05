//! The project this window shows and how it came to show it
//! (`WindowWorkspaceState`, `useWorkspaceSession`): its name, the hosted
//! Project and the account it opened under, the launch's restore of the last
//! project, the document to open first, and the notices about the workspace.
//! The documents themselves are the editor's; this is the window's record.
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
