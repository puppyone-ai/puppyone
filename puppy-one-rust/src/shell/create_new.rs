//! Shell composition adapter; menus/form share the feature's registry and preference owner.
use super::*;
use crate::features::create_new::{
    create_entry_dialog::{CreateEntryDialog, CreateEvent},
    create_entry_menu_registry::Entry,
};
impl Shell {
    /// Open the create form for `kind` in `parent` (defaults to the selection's folder).
    pub(super) fn start_create(
        &mut self,
        kind: Entry,
        parent: Option<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(ws) = self.files.workspace.clone() else {
            return;
        };
        if self.files.busy() || self.modal() || !kind.available() {
            return;
        }
        let parent = parent.unwrap_or_else(|| {
            self.tree
                .rows
                .iter()
                .find(|r| r.path == self.tree.selected)
                .map(|r| {
                    if r.folder {
                        r.path.clone()
                    } else {
                        r.path
                            .parent()
                            .unwrap_or(std::path::Path::new(""))
                            .to_owned()
                    }
                })
                .unwrap_or_default()
        });
        let form = cx.new(|cx| CreateEntryDialog::new(ws, parent, kind, window, cx));
        cx.subscribe_in(&form, window, |s, _, event, w, cx| {
            match event {
                CreateEvent::Cancel => {
                    s.modals.remove(|m| matches!(m, Modal::CreateEntry(_)));
                    s.focus.focus(w, cx)
                }
                CreateEvent::Created {
                    workspace,
                    parent,
                    path,
                    folder,
                    nodes,
                } => {
                    if s.files
                        .workspace
                        .as_ref()
                        .is_some_and(|ws| std::sync::Arc::ptr_eq(ws, workspace))
                    {
                        match nodes {
                            Ok(nodes) if parent.as_os_str().is_empty() => {
                                s.tree.refresh_children(parent, nodes.clone())
                            }
                            Ok(nodes) => s.tree.attach_children(parent, nodes.clone()),
                            Err(error) => s.show_error(crate::localization::tf(
                                "native.create.refreshFailed",
                                &[("error", error.to_string().into())],
                            )),
                        }
                        s.tree.select(path, false, false);
                        s.modals.remove(|m| matches!(m, Modal::CreateEntry(_)));
                        if !folder && !s.files.allow_quit {
                            s.files.begin(Intent::OpenFile(path.clone()), &s.wake)
                        }
                        s.receive(w, cx);
                    }
                }
            }
            cx.notify();
        })
        .detach();
        cx.observe(&form, |s, _, cx| {
            s.wake.notify();
            cx.notify();
        })
        .detach();
        self.modals.open(Modal::CreateEntry(form));
        cx.notify();
    }
}
