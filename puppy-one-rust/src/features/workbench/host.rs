//! What the shell hands the workbench (`AuxiliaryWorkbenchPanel`'s
//! `renderLauncher`, and the contributions' `prepare` for a saved tab). The
//! workbench owns the topology and hosts items; it never names the Agent
//! chat, the terminal or the hosted Agent. The shell's launcher creates
//! their items and places them with [`super::Workbench::place`].
use super::{Id, RetainedItem, WorkbenchItem};
use gpui::{AnyElement, App, Rgba, Window};
use std::{
    path::{Path, PathBuf},
    rc::Rc,
};

/// Where a launcher is shown (`WorkbenchLauncherContext`) and what the
/// project still admits (`ProjectWorkbenchStore.canCreate`).
#[derive(Clone, Debug)]
pub struct LauncherContext {
    pub group: Id,
    /// The launcher tab; `None` when the empty workbench shows the launcher
    /// without a tab.
    pub tab: Option<Id>,
    pub width: f32,
    pub can_chat: bool,
    pub can_terminal: bool,
}

/// What the workbench shows after a change. The host hears it once the
/// change's update has finished, never from inside a call it made.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WorkbenchView {
    pub root: Option<PathBuf>,
    /// The window's open projects (the Agent host authorizes their roots).
    pub roots: Vec<PathBuf>,
    /// The resources the shown project's chats have open.
    pub open_chats: Vec<String>,
}

/// A contribution's `retryCreation`.
pub type CreationRetry = Rc<dyn Fn(&mut Window, &mut App)>;

/// The shell's part of the workbench.
pub trait WorkbenchHost {
    /// A launcher tab's content (`renderLauncher(context)`).
    fn launcher(&self, context: LauncherContext, cx: &mut App) -> AnyElement;
    /// A launcher tab's own title while it shows something other than the
    /// launcher (History), and its mark in `color`.
    fn launcher_title(&self, tab: Id, cx: &App) -> Option<String>;
    fn launcher_mark(&self, tab: Id, color: Rgba, cx: &App) -> Option<AnyElement>;
    /// The item a saved tab of `root` reopens as (`restore*`).
    fn reopen(
        &self,
        root: &Path,
        tab: Id,
        item: &RetainedItem,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<Rc<dyn WorkbenchItem>, String>;
    /// After every workbench change.
    fn changed(&self, view: WorkbenchView, cx: &mut App);
    /// `tab` left its project.
    fn tab_removed(&self, tab: Id, cx: &mut App);
    /// The window's projects closed.
    fn shutdown(&self, cx: &mut App);
}
