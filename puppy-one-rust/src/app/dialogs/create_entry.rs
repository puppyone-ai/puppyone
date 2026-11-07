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
    /// The create form is writing its entry: the window waits for it.
    pub fn creating(&self, cx: &App) -> bool {
        self.create_form().is_some_and(|f| f.read(cx).busy())
    }
}
