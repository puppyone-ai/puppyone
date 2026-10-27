//! File operations: rename, delete, move, copy and import run one at a time
//! on a worker through `workspace.rs`, and land back in the Explorer when the
//! worker answers. The open document is closed first (the shell drains its
//! autosave) when an operation touches it, then reopened at its new path.
use super::*;
use crate::localization::tf;

#[derive(Clone, Debug, PartialEq)]
pub enum FileClipboard {
    Copy(Vec<PathBuf>),
    Cut(Vec<PathBuf>),
}
#[derive(Clone, Debug)]
pub enum FileOp {
    Rename { path: PathBuf, name: String },
    Delete(Vec<PathBuf>),
    Move(Vec<PathBuf>, PathBuf),
    Copy(Vec<PathBuf>, PathBuf),
    Import(Vec<PathBuf>, PathBuf),
}
impl FileOp {
    /// Workspace entries whose identity changes (the open document must close first).
    fn touched(&self) -> Vec<PathBuf> {
        match self {
            Self::Rename { path, .. } => vec![path.clone()],
            Self::Delete(paths) | Self::Move(paths, _) => paths.clone(),
            Self::Copy(..) | Self::Import(..) => vec![],
        }
    }
}
struct OpOutcome {
    /// Folder listings to refresh (`""` is the root).
    pub listings: Vec<(PathBuf, crate::workspace::Result<Vec<Node>>)>,
    /// New paths of moved/renamed entries: `(old, new)`.
    pub moved: Vec<(PathBuf, PathBuf)>,
    pub select: Option<PathBuf>,
    pub error: Option<String>,
}
impl Explorer {
    pub(super) fn run_op(&mut self, op: FileOp, cx: &mut Context<Self>) {
        let Some(ws) = self.workspace.clone() else {
            return;
        };
        if self.op.is_some() {
            return;
        }
        let caps = ws.capabilities();
        let allowed = match &op {
            FileOp::Rename { .. } => caps.rename,
            FileOp::Delete(_) => caps.remove,
            FileOp::Move(..) => caps.move_entry,
            FileOp::Copy(..) => caps.copy,
            FileOp::Import(..) => caps.import,
        };
        if !allowed {
            cx.emit(ExplorerEvent::Error(
                crate::workspace::Error::unsupported().to_string(),
            ));
            return;
        }
        let touched = op.touched();
        if let Some(relative) = &self.host.opened
            && touched.iter().any(|p| relative.starts_with(p))
        {
            // Close first; `sync` resumes once the document is gone.
            self.reopen = Some(relative.clone());
            self.queued_op = Some(op);
            cx.emit(ExplorerEvent::CloseDocument);
            return;
        }
        let (tx, rx) = async_channel::bounded(1);
        let owner = ws.clone();
        crate::localization::spawn(move || {
            let mut out = OpOutcome {
                listings: vec![],
                moved: vec![],
                select: None,
                error: None,
            };
            let mut folders: Vec<PathBuf> = vec![];
            let fail = |e: crate::workspace::Error, out: &mut OpOutcome| {
                if out.error.is_none() {
                    out.error = Some(e.to_string())
                }
            };
            match &op {
                FileOp::Rename { path, name } => match ws.rename_entry(path, name) {
                    Ok(new) => {
                        folders.push(parent_of(path));
                        out.moved.push((path.clone(), new.clone()));
                        out.select = Some(new);
                    }
                    Err(e) => fail(e, &mut out),
                },
                FileOp::Delete(paths) => {
                    for path in paths {
                        folders.push(parent_of(path));
                        if let Err(e) = ws.remove_entry(path) {
                            fail(e, &mut out)
                        }
                    }
                }
                FileOp::Move(paths, target) => {
                    folders.push(target.clone());
                    for path in paths {
                        folders.push(parent_of(path));
                        match ws.move_entry(path, target) {
                            Ok(new) => {
                                out.moved.push((path.clone(), new.clone()));
                                out.select = Some(new);
                            }
                            Err(e) => fail(e, &mut out),
                        }
                    }
                }
                FileOp::Copy(paths, target) => {
                    folders.push(target.clone());
                    for path in paths {
                        match ws.copy_entry(path, target) {
                            Ok(new) => out.select = Some(new),
                            Err(e) => fail(e, &mut out),
                        }
                    }
                }
                FileOp::Import(paths, target) => {
                    folders.push(target.clone());
                    for path in paths {
                        match ws.import_external(path, target) {
                            Ok(new) => out.select = Some(new),
                            Err(e) => fail(e, &mut out),
                        }
                    }
                }
            }
            folders.sort();
            folders.dedup();
            for folder in folders {
                let listing = ws.list(&folder);
                out.listings.push((folder, listing));
            }
            let _ = tx.send_blocking(out);
        });
        self.op = Some(cx.spawn(async move |this, cx| {
            let outcome = rx.recv().await;
            let _ = this.update(cx, |s, cx| {
                if !s
                    .workspace
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &owner))
                {
                    return;
                }
                s.op = None;
                if let Ok(outcome) = outcome {
                    s.finish_op(outcome, cx);
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    /// The worker answered: refresh the listings it touched, select the
    /// result, and reopen the document it moved.
    fn finish_op(&mut self, outcome: OpOutcome, cx: &mut Context<Self>) {
        for (folder, listing) in outcome.listings {
            match listing {
                Ok(nodes) => self.tree.refresh_children(&folder, nodes),
                Err(e) => cx.emit(ExplorerEvent::Error(e.to_string())),
            }
        }
        if let Some(path) = outcome.select.clone() {
            self.tree.select(&path, false, false);
        }
        if let Some(error) = outcome.error {
            cx.emit(ExplorerEvent::Error(tf(
                "workspace.node.error.operationFailedDetail",
                &[("detail", error.into())],
            )));
        }
        if let Some(old) = self.reopen.take() {
            let target = outcome.moved.iter().find_map(|(from, to)| {
                let rest = old.strip_prefix(from).ok()?;
                // The document itself moved: joining an empty rest would
                // leave a trailing separator that opens nothing.
                Some(if rest.as_os_str().is_empty() {
                    to.clone()
                } else {
                    to.join(rest)
                })
            });
            if let Some(target) = target {
                cx.emit(ExplorerEvent::Open(target));
            }
        }
    }
    pub(super) fn paste_into(&mut self, target: PathBuf, cx: &mut Context<Self>) {
        match self.clipboard.clone() {
            Some(FileClipboard::Copy(paths)) => self.run_op(FileOp::Copy(paths, target), cx),
            Some(FileClipboard::Cut(paths)) => {
                self.clipboard = None;
                self.run_op(FileOp::Move(paths, target), cx)
            }
            None => {}
        }
    }
    pub(super) fn duplicate(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        // Duplicates land next to their source (`forceDuplicateName`). One file
        // operation runs at a time, so a mixed-parent selection duplicates the
        // entries that share the first entry's folder.
        let Some(parent) = paths.first().map(|p| parent_of(p)) else {
            return;
        };
        let siblings = paths
            .into_iter()
            .filter(|p| parent_of(p) == parent)
            .collect();
        self.run_op(FileOp::Copy(siblings, parent), cx);
    }
    pub(super) fn confirm_delete(
        &mut self,
        paths: Vec<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if paths.is_empty() {
            return;
        }
        let message = if paths.len() == 1 {
            tf(
                "workspace.node.confirmDeleteOne",
                &[(
                    "name",
                    paths[0]
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default()
                        .into(),
                )],
            )
        } else {
            tf(
                "workspace.node.confirmDeleteMany",
                &[("count", paths.len().into())],
            )
        };
        let delete = tf(
            "workspace.node.deleteItems",
            &[("count", paths.len().into())],
        );
        let answer = window.prompt(
            PromptLevel::Warning,
            &message,
            None,
            &[delete.as_str(), tr("common.action.cancel")],
            cx,
        );
        cx.spawn_in(window, async move |this, cx| {
            if answer.await == Ok(0) {
                let _ = this.update(cx, |s, cx| s.run_op(FileOp::Delete(paths), cx));
            }
        })
        .detach();
    }
}
