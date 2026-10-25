//! Shell composition adapter; menus/form share the feature's registry and preference owner.
use super::*;
use crate::features::create_new::{
    create_entry_dialog::{CreateEntryDialog, CreateEvent},
    create_entry_menu_registry::Entry,
};
impl Shell {
    /// Open the create form for `kind` in `parent` (the Explorer's menus).
    pub(super) fn start_create(
        &mut self,
        kind: Entry,
        parent: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(ws) = self.files.workspace.clone() else {
            return;
        };
        if self.files.busy() || self.modal() || !kind.available() {
            return;
        }
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
                        if let Err(error) = nodes {
                            s.show_error(crate::localization::tf(
                                "native.create.refreshFailed",
                                &[("error", error.to_string().into())],
                            ));
                        }
                        let listing = nodes.as_ref().ok().cloned();
                        s.explorer
                            .update(cx, |e, cx| e.entry_created(parent, listing, path, cx));
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
