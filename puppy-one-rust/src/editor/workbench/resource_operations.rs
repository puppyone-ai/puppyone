//! Resource mutations retain Working Copies. Mirrors documentResourceOperations:
//! drain, mutate once, reconcile addresses, then release the scoped barrier.
//! Workers use the admitted Provider; neither Explorer nor a viewer owns I/O.
use crate::{
    model::Node,
    workspace::{self, Document, PreviewResource, Workspace},
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone, Debug, PartialEq)]
pub enum Operation {
    Rename { path: PathBuf, name: String },
    Delete(Vec<PathBuf>),
    Move(Vec<PathBuf>, PathBuf),
    Copy(Vec<PathBuf>, PathBuf),
    Duplicate(Vec<PathBuf>),
    Import(Vec<PathBuf>, PathBuf),
}
impl Operation {
    pub fn normalized(mut self) -> Self {
        let paths = match &mut self {
            Self::Rename { .. } => return self,
            Self::Delete(paths)
            | Self::Move(paths, _)
            | Self::Copy(paths, _)
            | Self::Duplicate(paths)
            | Self::Import(paths, _) => paths,
        };
        let mut unique = Vec::new();
        for path in paths.drain(..) {
            if unique.iter().any(|p: &PathBuf| path.starts_with(p)) {
                continue;
            }
            unique.retain(|p| !p.starts_with(&path));
            unique.push(path);
        }
        *paths = unique;
        self
    }
    pub fn sources(&self) -> Vec<PathBuf> {
        match self {
            Self::Rename { path, .. } => vec![path.clone()],
            Self::Delete(paths)
            | Self::Move(paths, _)
            | Self::Copy(paths, _)
            | Self::Duplicate(paths) => paths.clone(),
            Self::Import(..) => vec![],
        }
    }
    pub fn destinations(&self) -> Vec<PathBuf> {
        match self {
            Self::Rename { path, name } => vec![parent(path).join(name)],
            Self::Move(paths, folder) => paths
                .iter()
                .filter_map(|p| p.file_name().map(|n| folder.join(n)))
                .collect(),
            Self::Copy(_, folder) | Self::Import(_, folder) => vec![folder.clone()],
            Self::Duplicate(paths) => paths.iter().map(|p| parent(p)).collect(),
            Self::Delete(_) => vec![],
        }
    }
    pub fn allowed(&self, caps: workspace::contracts::Capabilities) -> bool {
        match self {
            Self::Rename { .. } => caps.rename,
            Self::Delete(_) => caps.remove,
            Self::Move(..) => caps.move_entry,
            Self::Copy(..) | Self::Duplicate(_) => caps.copy,
            Self::Import(..) => caps.import,
        }
    }
    pub fn changes_identity(&self) -> bool {
        matches!(self, Self::Rename { .. } | Self::Move(..) | Self::Delete(_))
    }
}
pub struct Binding {
    pub slot: u64,
    pub path: PathBuf,
    pub document: Option<Document>,
}
pub enum Update {
    Document(u64, Document),
    Resource(u64, PathBuf, PreviewResource),
    Removed(u64),
}
#[derive(Clone, Debug)]
enum State {
    Applied,
    Failed(String),
    Unknown(String),
}
#[derive(Clone, Debug)]
struct Mutation {
    from: PathBuf,
    to: Option<PathBuf>,
    state: State,
}
#[derive(Clone, Debug, Default)]
pub struct Receipt {
    mutations: Vec<Mutation>,
    errors: Vec<String>,
    select: Option<PathBuf>,
}
#[derive(Default)]
pub struct Outcome {
    pub listings: Vec<(PathBuf, workspace::Result<Vec<Node>>)>,
    pub moved: Vec<(PathBuf, PathBuf)>,
    pub removed: Vec<PathBuf>,
    pub select: Option<PathBuf>,
    pub error: Option<String>,
}
pub struct Completed {
    pub receipt: Receipt,
    pub updates: Vec<Update>,
    pub outcome: Outcome,
    pub uncertain: bool,
}
fn parent(path: &Path) -> PathBuf {
    path.parent().unwrap_or(Path::new("")).into()
}
fn relocated(path: &Path, from: &Path, to: &Path) -> Option<PathBuf> {
    let rest = path.strip_prefix(from).ok()?;
    Some(if rest.as_os_str().is_empty() {
        to.into()
    } else {
        to.join(rest)
    })
}
fn classify(ws: &Workspace, from: &Path, to: Option<&Path>, error: String) -> State {
    // Any rejection may follow an actual mutation. Confirm the source remains
    // before unfreezing; a retry of Unknown only queries, never mutates again.
    match (
        ws.entry_exists(from),
        to.map(|p| ws.entry_exists(p)).transpose(),
    ) {
        (Ok(true), Ok(None | Some(false))) => State::Failed(error),
        _ => State::Unknown(error),
    }
}
pub fn execute(
    ws: Arc<Workspace>,
    op: &Operation,
    bindings: &[Binding],
    previous: Option<Receipt>,
) -> Completed {
    let retry = previous.is_some();
    let mut receipt = previous.unwrap_or_default();
    let mut folders = op.sources().iter().map(|p| parent(p)).collect::<Vec<_>>();
    folders.extend(op.destinations().iter().map(|p| {
        if op.changes_identity() {
            parent(p)
        } else {
            p.clone()
        }
    }));
    if !retry {
        let mut apply = |from: &Path, to: Option<PathBuf>, result: workspace::Result<()>| {
            let state = match result {
                Ok(()) => State::Applied,
                Err(error) => classify(&ws, from, to.as_deref(), error.to_string()),
            };
            if matches!(state, State::Applied) {
                receipt.select = to.clone();
            }
            receipt.mutations.push(Mutation {
                from: from.into(),
                to,
                state,
            });
        };
        match op {
            Operation::Rename { path, name } => {
                let to = parent(path).join(name);
                if &to != path {
                    apply(path, Some(to), ws.rename_entry(path, name).map(|_| ()));
                }
            }
            Operation::Move(paths, folder) => {
                for path in paths {
                    let to = path.file_name().map(|name| folder.join(name));
                    if to.as_ref() == Some(path) {
                        continue;
                    }
                    apply(path, to, ws.move_entry(path, folder).map(|_| ()));
                }
            }
            Operation::Delete(paths) => {
                for path in paths {
                    apply(path, None, ws.remove_entry(path));
                }
            }
            Operation::Copy(paths, folder) | Operation::Import(paths, folder) => {
                for path in paths {
                    let result = if matches!(op, Operation::Copy(..)) {
                        ws.copy_entry(path, folder)
                    } else {
                        ws.import_external(path, folder)
                    };
                    match result {
                        Ok(path) => receipt.select = Some(path),
                        Err(error) => receipt.errors.push(error.to_string()),
                    }
                }
            }
            Operation::Duplicate(paths) => {
                for path in paths {
                    match ws.copy_entry(path, &parent(path)) {
                        Ok(path) => receipt.select = Some(path),
                        Err(error) => receipt.errors.push(error.to_string()),
                    }
                }
            }
        }
    }
    let mut errors = receipt.errors.clone();
    let mut updates = vec![];
    let mut uncertain = false;
    let mut moved = vec![];
    let mut removed = vec![];
    for mutation in &mut receipt.mutations {
        if retry && let State::Unknown(error) = &mutation.state {
            match (
                ws.entry_exists(&mutation.from),
                mutation.to.as_ref().map(|p| ws.entry_exists(p)).transpose(),
            ) {
                (Ok(false), Ok(None | Some(true))) => mutation.state = State::Applied,
                (Ok(true), Ok(None | Some(false))) => mutation.state = State::Failed(error.clone()),
                _ => {}
            }
        }
        match &mutation.state {
            State::Failed(error) => {
                errors.push(error.clone());
                continue;
            }
            State::Unknown(error) => {
                errors.push(error.clone());
                uncertain = true;
                continue;
            }
            State::Applied => {}
        }
        let start = updates.len();
        let mut failure = None;
        for binding in bindings
            .iter()
            .filter(|b| b.path.starts_with(&mutation.from))
        {
            if let Some(to) = &mutation.to {
                let path = relocated(&binding.path, &mutation.from, to).unwrap();
                let update = match &binding.document {
                    Some(document) => ws
                        .rebind(document, &path)
                        .map(|doc| Update::Document(binding.slot, doc)),
                    None => ws
                        .resource(&path)
                        .map(|resource| Update::Resource(binding.slot, path, resource)),
                };
                match update {
                    Ok(update) => updates.push(update),
                    Err(error) => {
                        failure = Some(error.to_string());
                        break;
                    }
                }
            } else {
                updates.push(Update::Removed(binding.slot));
            }
        }
        if let Some(error) = failure {
            updates.truncate(start);
            uncertain = true;
            errors.push(error);
        } else if let Some(to) = &mutation.to {
            moved.push((mutation.from.clone(), to.clone()));
            receipt.select = Some(to.clone());
        } else {
            removed.push(mutation.from.clone());
        }
    }
    folders.sort();
    folders.dedup();
    let listings = folders
        .into_iter()
        .map(|p| {
            let rows = ws.list(&p);
            (p, rows)
        })
        .collect();
    Completed {
        outcome: Outcome {
            listings,
            moved,
            removed,
            select: receipt.select.clone(),
            error: (!errors.is_empty()).then(|| errors.join("\n")),
        },
        receipt,
        updates,
        uncertain,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding(ws: &Workspace, path: &str, slot: u64) -> Binding {
        Binding {
            slot,
            path: path.into(),
            document: Some(ws.read(Path::new(path)).unwrap()),
        }
    }
    #[test]
    fn directory_move_rebinds_all_descendants_and_keeps_editing_ids() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("from")).unwrap();
        std::fs::create_dir(root.path().join("to")).unwrap();
        for name in ["a.md", "b.csv"] {
            std::fs::write(root.path().join("from").join(name), name).unwrap();
        }
        let ws = Workspace::open(root.path()).unwrap();
        let bindings = vec![binding(&ws, "from/a.md", 1), binding(&ws, "from/b.csv", 2)];
        let result = execute(
            ws.clone(),
            &Operation::Move(vec!["from".into()], "to".into()),
            &bindings,
            None,
        );
        assert!(!result.uncertain && result.outcome.error.is_none());
        assert_eq!(result.updates.len(), 2);
        for update in result.updates {
            let Update::Document(id, document) = update else {
                panic!("text binding")
            };
            assert_eq!(
                document.id,
                bindings[id as usize - 1].document.as_ref().unwrap().id
            );
            assert!(document.relative.starts_with("to/from"));
            ws.save(&document, "after move").unwrap();
            assert_eq!(ws.read(&document.relative).unwrap().text, "after move");
        }
        assert!(!root.path().join("from").exists());
    }
    #[test]
    fn lost_rename_receipt_is_reconciled_without_replaying_the_mutation() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("old.md"), "retained").unwrap();
        let ws = Workspace::open(root.path()).unwrap();
        let bindings = vec![binding(&ws, "old.md", 1)];
        ws.rename_entry(Path::new("old.md"), "new.md").unwrap();
        let receipt = Receipt {
            mutations: vec![Mutation {
                from: "old.md".into(),
                to: Some("new.md".into()),
                state: State::Unknown("lost response".into()),
            }],
            ..Default::default()
        };
        let result = execute(
            ws,
            &Operation::Rename {
                path: "old.md".into(),
                name: "new.md".into(),
            },
            &bindings,
            Some(receipt),
        );
        assert!(!result.uncertain && result.outcome.error.is_none());
        assert!(matches!(&result.updates[0], Update::Document(1, doc) if doc.text == "retained"));
    }
    #[test]
    fn mismatching_destination_keeps_the_receipt_for_later_reconciliation() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("old.md"), "retained").unwrap();
        let ws = Workspace::open(root.path()).unwrap();
        let bindings = vec![binding(&ws, "old.md", 1)];
        ws.rename_entry(Path::new("old.md"), "new.md").unwrap();
        std::fs::write(root.path().join("new.md"), "external").unwrap();
        let receipt = Receipt {
            mutations: vec![Mutation {
                from: "old.md".into(),
                to: Some("new.md".into()),
                state: State::Applied,
            }],
            ..Default::default()
        };
        let op = Operation::Rename {
            path: "old.md".into(),
            name: "new.md".into(),
        };
        let result = execute(ws.clone(), &op, &bindings, Some(receipt));
        assert!(result.uncertain && result.updates.is_empty());
        assert_eq!(
            std::fs::read_to_string(root.path().join("new.md")).unwrap(),
            "external"
        );
        std::fs::write(root.path().join("new.md"), "retained").unwrap();
        let result = execute(ws, &op, &bindings, Some(result.receipt));
        assert!(!result.uncertain && result.updates.len() == 1);
    }
    #[test]
    fn failed_delete_reconciliation_releases_the_unchanged_source() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("keep.md"), "kept").unwrap();
        let ws = Workspace::open(root.path()).unwrap();
        let bindings = vec![binding(&ws, "keep.md", 1)];
        let receipt = Receipt {
            mutations: vec![Mutation {
                from: "keep.md".into(),
                to: None,
                state: State::Unknown("transport failed".into()),
            }],
            ..Default::default()
        };
        let result = execute(
            ws,
            &Operation::Delete(vec!["keep.md".into()]),
            &bindings,
            Some(receipt),
        );
        assert!(!result.uncertain && result.outcome.error.is_some());
        assert!(result.updates.is_empty());
        assert_eq!(
            std::fs::read_to_string(root.path().join("keep.md")).unwrap(),
            "kept"
        );
    }
}
