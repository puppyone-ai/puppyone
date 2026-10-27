//! Native creation port: immutable request, one result, capability-scoped I/O.
use super::create_entry_menu_registry::Entry;
use crate::{model::Node, workspace::Workspace};
use std::{path::PathBuf, sync::Arc};
pub type Created = Result<(PathBuf, Result<Vec<Node>, String>), String>;
pub fn create(
    workspace: Arc<Workspace>,
    parent: PathBuf,
    name: String,
    kind: Entry,
) -> async_channel::Receiver<Created> {
    let (tx, rx) = async_channel::bounded(1);
    crate::localization::spawn(move || {
        let result = workspace
            .create_entry(&parent, &name, kind == Entry::Folder, kind.initial_text())
            .map(|path| (path, workspace.list(&parent).map_err(|e| e.to_string())))
            .map_err(|e| e.to_string());
        let _ = tx.send_blocking(result);
    });
    rx
}
