//! File operations: rename, delete, move, copy and import run one at a time
//! on a worker through `workspace.rs`. The open document is closed (autosave
//! drained) before an operation touches it, then reopened at its new path.
use super::*;
use crate::{localization::tf, model::Node};

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
pub struct OpOutcome {
    /// Folder listings to refresh (`""` is the root).
    pub listings: Vec<(PathBuf, crate::workspace::Result<Vec<Node>>)>,
    /// New paths of moved/renamed entries: `(old, new)`.
    pub moved: Vec<(PathBuf, PathBuf)>,
    pub select: Option<PathBuf>,
    pub error: Option<String>,
}
impl Shell {
    pub(in crate::shell) fn run_op(
        &mut self,
        op: FileOp,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(ws) = self.files.workspace.clone() else {
            return;
        };
        if self.explorer.op.is_some() {
            return;
        }
        let touched = op.touched();
        if let Some(doc) = &self.files.document
            && touched.iter().any(|p| doc.relative.starts_with(p))
        {
            // Drain autosave and close first; resume when the document is gone.
            self.explorer.reopen = Some(doc.relative.clone());
            self.explorer.queued_op = Some(op);
            self.files.begin(Intent::CloseFile, &self.wake);
            self.receive(window, cx);
            return;
        }
        let (tx, rx) = mpsc::sync_channel(1);
        let wake = self.wake.clone();
        crate::localization::spawn(move || {
            let mut out = OpOutcome {
                listings: vec![],
                moved: vec![],
                select: None,
                error: None,
            };
            let mut folders: Vec<PathBuf> = vec![];
            let fail = |e: String, out: &mut OpOutcome| {
                if out.error.is_none() {
                    out.error = Some(e)
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
            let _ = tx.send(out);
            wake.notify();
        });
        self.explorer.op = Some(rx);
        cx.notify();
    }
    /// Called from `receive`: resume queued operations and apply results.
    pub(in crate::shell) fn poll_file_ops(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.explorer.op.is_none()
            && self.files.document.is_none()
            && !self.files.busy()
            && let Some(op) = self.explorer.queued_op.take()
        {
            self.run_op(op, window, cx);
        }
        let Some(outcome) = self.explorer.op.as_ref().and_then(|rx| rx.try_recv().ok()) else {
            return;
        };
        self.explorer.op = None;
        for (folder, listing) in outcome.listings {
            match listing {
                Ok(nodes) => self.tree.refresh_children(&folder, nodes),
                Err(e) => self.error = Some(e),
            }
        }
        if let Some(path) = outcome.select.clone() {
            self.tree.select(&path, false, false);
        }
        if let Some(error) = outcome.error {
            self.error = Some(tf(
                "workspace.node.error.operationFailedDetail",
                &[("detail", error.into())],
            ));
        }
        if let Some(old) = self.explorer.reopen.take() {
            let target = outcome
                .moved
                .iter()
                .find_map(|(from, to)| old.strip_prefix(from).ok().map(|rest| to.join(rest)));
            if let Some(target) = target {
                self.files.begin(Intent::OpenFile(target), &self.wake);
            }
        }
        cx.notify();
    }
    pub(super) fn paste_into(
        &mut self,
        target: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match self.explorer.clipboard.clone() {
            Some(FileClipboard::Copy(paths)) => {
                self.run_op(FileOp::Copy(paths, target), window, cx)
            }
            Some(FileClipboard::Cut(paths)) => {
                self.explorer.clipboard = None;
                self.run_op(FileOp::Move(paths, target), window, cx)
            }
            None => {}
        }
    }
    pub(super) fn duplicate(
        &mut self,
        paths: Vec<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
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
        self.run_op(FileOp::Copy(siblings, parent), window, cx);
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
                let _ = this.update_in(cx, |s, w, cx| s.run_op(FileOp::Delete(paths), w, cx));
            }
        })
        .detach();
    }
}
