//! The workspace reads web viewers make through the native host
//! (`DataPort.listChildren` / `readFile` / a guarded write), as the
//! product's data port shapes them. Each runs off the main thread.
use crate::workspace::Workspace;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// A workspace entry as the product's `DataNode`.
pub fn data_node(workspace: &Workspace, node: &crate::model::Node) -> Value {
    let path = node.path.to_string_lossy().replace('\\', "/");
    let kind = if node.folder {
        "folder".to_owned()
    } else {
        crate::formats::semantic_kind(&node.name, None, None)
    };
    json!({
        "id": path, "name": node.name, "path": path, "type": kind,
        "source": if workspace.local_root().is_some() { "local" } else { "cloud" },
        "hasChildren": node.folder,
    })
}

/// `listChildren(path)`.
pub fn list(workspace: &Workspace, path: Option<&str>) -> Result<Value, String> {
    let folder = PathBuf::from(path.unwrap_or_default());
    workspace
        .list(&folder)
        .map(|nodes| {
            Value::Array(
                nodes
                    .iter()
                    .map(|node| data_node(workspace, node))
                    .collect(),
            )
        })
        .map_err(|error| error.to_string())
}

/// `readFile(path)` as the product's `FileContent`.
pub fn read(workspace: &Workspace, path: &str) -> Result<Value, String> {
    let relative = Path::new(path);
    let name = relative
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    workspace
        .read(relative)
        .map(|document| {
            json!({
                "path": path, "name": name,
                "type": crate::formats::semantic_kind(&name, None, None),
                "content": document.text,
                "version": document.id,
            })
        })
        .map_err(|error| error.to_string())
}

/// Replace a file the page read as `expected`; a file that changed since is
/// refused (`configure`'s expected content and conditional write).
pub fn write_expected(
    workspace: &Workspace,
    path: &str,
    expected: &str,
    content: &str,
    changed: &str,
) -> Result<Value, String> {
    let document = workspace
        .read(Path::new(path))
        .map_err(|error| error.to_string())?;
    if document.text != expected {
        return Err(changed.to_owned());
    }
    let outcome = workspace
        .save(&document, content)
        .map_err(|error| error.to_string())?;
    if outcome.updated {
        return Err(changed.to_owned());
    }
    Ok(json!({ "content": content, "version": outcome.document.id }))
}
