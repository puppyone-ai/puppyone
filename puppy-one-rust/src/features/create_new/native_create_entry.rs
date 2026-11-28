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

/// `Untitled.md`, else `Untitled 2.md`, `Untitled 3.md`, …: the first name
/// `taken` does not hold, compared without case as most file systems do.
pub fn untitled_name(kind: Entry, taken: &[String]) -> String {
    let taken: std::collections::HashSet<String> = taken.iter().map(|n| n.to_lowercase()).collect();
    let ext = kind.extension();
    (1..)
        .map(|n| match n {
            1 => format!("Untitled{ext}"),
            n => format!("Untitled {n}{ext}"),
        })
        .find(|name| !taken.contains(&name.to_lowercase()))
        .unwrap_or_default()
}

/// Makes the next free `Untitled` file of `kind` in `parent`. Someone else
/// may take that name first, so a refused name moves on to the next one.
pub fn create_untitled(
    workspace: Arc<Workspace>,
    parent: PathBuf,
    kind: Entry,
) -> async_channel::Receiver<Created> {
    let (tx, rx) = async_channel::bounded(1);
    crate::localization::spawn(move || {
        let mut taken: Vec<String> = workspace
            .list(&parent)
            .map(|nodes| nodes.into_iter().map(|n| n.name).collect())
            .unwrap_or_default();
        let mut result = Err(String::new());
        for _ in 0..3 {
            let name = untitled_name(kind, &taken);
            match workspace.create_entry(&parent, &name, false, kind.initial_text()) {
                Ok(path) => {
                    result = Ok((path, workspace.list(&parent).map_err(|e| e.to_string())));
                    break;
                }
                Err(e) => {
                    result = Err(e.to_string());
                    taken.push(name);
                }
            }
        }
        let _ = tx.send_blocking(result);
    });
    rx
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{editor::registry, features::create_new::create_entry_draft::normalize_name};
    use std::{path::Path, time::Duration};

    #[test]
    fn untitled_files_take_the_first_free_number_without_case() {
        let taken = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();
        assert_eq!(untitled_name(Entry::Markdown, &[]), "Untitled.md");
        assert_eq!(
            untitled_name(Entry::Markdown, &taken(&["untitled.MD", "Untitled 2.md"])),
            "Untitled 3.md"
        );
        assert_eq!(
            untitled_name(Entry::Csv, &taken(&["Untitled.md"])),
            "Untitled.csv"
        );
        assert_eq!(
            untitled_name(Entry::Whiteboard, &taken(&["Untitled.excalidraw"])),
            "Untitled 2.excalidraw"
        );
    }

    #[test]
    fn an_untitled_file_is_made_next_to_the_ones_already_there() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Untitled.md"), "kept").unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let (path, nodes) = create_untitled(workspace, PathBuf::new(), Entry::Markdown)
            .recv_blocking()
            .unwrap()
            .unwrap();
        assert_eq!(path, Path::new("Untitled 2.md"));
        assert!(nodes.unwrap().iter().any(|n| n.name == "Untitled 2.md"));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("Untitled.md")).unwrap(),
            "kept"
        );
    }

    #[test]
    fn both_whiteboard_extensions_create_real_editable_documents_without_renaming_them() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        for (typed, expected) in [
            ("Sketch.excalidraw", "Sketch.excalidraw"),
            ("Second.EXCALIDRAW.JSON", "Second.EXCALIDRAW.JSON"),
            ("Third", "Third.excalidraw"),
        ] {
            let name = normalize_name(Entry::Whiteboard, typed).unwrap();
            assert_eq!(name, expected);
            let (path, nodes) = rt
                .block_on(async {
                    tokio::time::timeout(
                        Duration::from_secs(5),
                        create(workspace.clone(), PathBuf::new(), name, Entry::Whiteboard).recv(),
                    )
                    .await
                })
                .expect("creation completed within the fixture budget")
                .unwrap()
                .unwrap();
            assert_eq!(path, Path::new(expected));
            assert!(nodes.is_ok());
            let bytes = std::fs::read_to_string(dir.path().join(&path)).unwrap();
            let board: serde_json::Value = serde_json::from_str(&bytes).unwrap();
            assert_eq!(board["type"], "excalidraw");
            assert_eq!(board["version"], 2);
            assert_eq!(board["elements"], serde_json::json!([]));
            assert_eq!(board["files"], serde_json::json!({}));
            let doc = registry::EditorDocument::local(expected);
            let resolved = registry::resolve(&doc);
            assert_eq!(resolved.format.id, "excalidraw");
            assert_eq!(resolved.format.semantic_kind(), "whiteboard");
            assert!(resolved.format.is_text_like());
            assert_eq!(resolved.viewer.id, "excalidraw");
            assert_eq!(resolved.viewer.source(), registry::Source::Content);
            assert!(resolved.viewer.editable(&resolved.view_match(&doc), &bytes));
            assert!(resolved.viewer.policy.source_toggle);
            // The actual creation port must not overwrite an already edited board.
            std::fs::write(dir.path().join(&path), "saved edits").unwrap();
            let again = rt
                .block_on(async {
                    tokio::time::timeout(
                        Duration::from_secs(5),
                        create(
                            workspace.clone(),
                            PathBuf::new(),
                            expected.into(),
                            Entry::Whiteboard,
                        )
                        .recv(),
                    )
                    .await
                })
                .unwrap()
                .unwrap();
            assert!(again.is_err());
            assert_eq!(
                std::fs::read_to_string(dir.path().join(&path)).unwrap(),
                "saved edits"
            );
        }
    }
}
