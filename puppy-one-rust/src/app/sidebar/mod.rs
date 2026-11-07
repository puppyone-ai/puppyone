//! The left sidebar (`DataWorkspaceFrame`'s `explorer()` and
//! `explorerFooter()`): the Explorer column over its footer navigation.
mod column;
mod footer;
pub(super) use column::ExplorerColumn;
pub(super) use footer::SidebarFooter;
