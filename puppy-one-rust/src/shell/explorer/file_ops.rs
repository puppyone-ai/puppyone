//! Explorer submits resource mutations to the retained workbench owner.
//! Saving, execution, reconciliation and document rebinding are not view lifetime.
use super::*;
pub use crate::editor::workbench::resource_operations::Operation as FileOp;
use crate::editor::workbench::resource_operations::Outcome;
use crate::localization::tf;

#[derive(Clone, Debug, PartialEq)]
pub enum FileClipboard {
    Copy(Vec<PathBuf>),
    Cut(Vec<PathBuf>),
}
impl Explorer {
    pub(super) fn run_op(&mut self, op: FileOp, cx: &mut Context<Self>) {
        if self.op || self.workspace.is_none() {
            return;
        }
        self.refresh = None;
        self.op = true;
        // `DataWorkspace`: import and move clear the previous operation error
        // and report their own failure above the tree.
        self.op_inline = matches!(op, FileOp::Move(..) | FileOp::Import(..));
        if self.op_inline {
            self.operation_error = None;
        }
        cx.emit(ExplorerEvent::ResourceOperation(op));
        cx.notify();
    }
    pub(in crate::shell) fn operation_failed(&mut self, cx: &mut Context<Self>) {
        self.op = false;
        self.op_inline = false;
        cx.notify();
    }
    pub(in crate::shell) fn finish_op(
        &mut self,
        owner: &str,
        outcome: Outcome,
        cx: &mut Context<Self>,
    ) {
        let active = self
            .workspace
            .as_ref()
            .and_then(|ws| ws.resource_id(Path::new("")).ok())
            .map(|id| crate::editor::workbench::catalog::resource_key(&id));
        let is_active = active.as_deref() == Some(owner);
        let inline = is_active && std::mem::take(&mut self.op_inline);
        let tree = if is_active {
            self.op = false;
            Some(&mut self.tree)
        } else if let Some(saved) = self.retained.get_mut(owner) {
            saved.op = false;
            Some(&mut saved.tree)
        } else {
            None
        };
        if let Some(tree) = tree {
            for (from, to) in &outcome.moved {
                tree.rebind(from, to);
            }
            for path in &outcome.removed {
                tree.remove_selection(path);
            }
            for (folder, listing) in outcome.listings {
                match listing {
                    Ok(nodes) => tree.refresh_children(&folder, nodes),
                    Err(error) => cx.emit(ExplorerEvent::Error(error.to_string())),
                }
            }
            if let Some(path) = outcome.select {
                tree.select(&path, false, false);
            }
        }
        if let Some(error) = outcome.error.clone()
            && inline
        {
            self.operation_error = Some(error.into());
        } else if let Some(error) = outcome.error {
            cx.emit(ExplorerEvent::Error(tf(
                "workspace.node.error.operationFailedDetail",
                &[("detail", error.into())],
            )));
        }
        cx.notify();
    }
    /// `onRetryFolder(null)`: dismiss the operation error and reread the root.
    pub(super) fn retry_root(&mut self, cx: &mut Context<Self>) {
        self.operation_error = None;
        if self.workspace.is_some() {
            cx.emit(ExplorerEvent::LoadChildren(PathBuf::new()));
        }
        cx.notify();
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
        if !paths.is_empty() {
            self.run_op(FileOp::Duplicate(paths), cx);
        }
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
