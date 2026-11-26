//! `DesktopCreateEntryDialog` on the layer: the form makes the entry, and
//! the shell takes it into the Explorer and the editor
//! ([`DialogEvent::Created`]).
use super::*;
use crate::features::create_new::{CreateEvent, Entry};

impl DialogLayer {
    /// Opens the create form for `kind` in `parent`.
    pub fn create_entry(
        &mut self,
        workspace: Arc<Workspace>,
        parent: PathBuf,
        kind: Entry,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let form = cx.new(|cx| CreateEntryDialog::new(workspace, parent, kind, window, cx));
        cx.subscribe(&form, |s, _, event, cx| {
            s.remove(|m| matches!(m, Modal::CreateEntry(_)), cx);
            match event {
                CreateEvent::Cancel => cx.emit(DialogEvent::Closed),
                CreateEvent::Created {
                    workspace,
                    parent,
                    path,
                    folder,
                    nodes,
                } => cx.emit(DialogEvent::Created {
                    workspace: workspace.clone(),
                    parent: parent.clone(),
                    path: path.clone(),
                    folder: *folder,
                    nodes: nodes.clone(),
                }),
            }
        })
        .detach();
        // The window cannot close while the form writes.
        cx.observe(&form, |_, _, cx| cx.notify()).detach();
        self.open(Modal::CreateEntry(form), cx);
    }
    /// Makes the next free `Untitled` file of `kind` in `parent` at once and
    /// hands it on like the form does, so it opens to be renamed later. If it
    /// cannot be made, the form opens instead and says why when submitted.
    pub fn create_untitled(
        &mut self,
        workspace: Arc<Workspace>,
        parent: PathBuf,
        kind: Entry,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.untitled {
            return;
        }
        self.untitled = true;
        let rx =
            crate::features::create_new::create_untitled(workspace.clone(), parent.clone(), kind);
        cx.spawn_in(window, async move |this, cx| {
            let result = rx.recv().await;
            let _ = this.update_in(cx, |s, window, cx| {
                s.untitled = false;
                match result {
                    Ok(Ok((path, nodes))) => cx.emit(DialogEvent::Created {
                        workspace,
                        parent,
                        path,
                        folder: false,
                        nodes,
                    }),
                    _ => s.create_entry(workspace, parent, kind, window, cx),
                }
                cx.notify();
            });
        })
        .detach();
    }
    /// A new entry is being written: the window waits for it.
    pub fn creating(&self, cx: &App) -> bool {
        self.untitled || self.create_form().is_some_and(|f| f.read(cx).busy())
    }
}
