//! The Explorer's model (`useProjectExplorerSession`, `useDataNodeActions`,
//! `useFileClipboard`, `explorerPins`): the project's tree as listed, its
//! expansion, selection and scroll, the file clipboard and the running
//! operation, the directory subscription, the pins, and the session kept for
//! every project the window has shown. It does no painting; the
//! [`Explorer`](super::Explorer) view reads it and turns input into its
//! commands. The shell hands it listings and operation outcomes and acts on
//! what it asks for ([`SessionEvent`]).
use super::Host;
pub(in crate::app) use crate::editor::workbench::resource_operations::Operation as FileOp;
use crate::{
    editor::workbench::resource_operations::Outcome,
    features::settings::{
        preference_types::{ExplorerPins, FilesVisibility},
        preferences_store::{PreferencesStore, observe_slice},
    },
    localization::tf,
    model::{Node, Tree, Visibility},
    workspace::Workspace,
};
use gpui::*;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone, Debug, PartialEq)]
pub enum FileClipboard {
    Copy(Vec<PathBuf>),
    Cut(Vec<PathBuf>),
}

/// What the session asks of the shell.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) enum SessionEvent {
    /// Background revalidation changed the metadata used by document links.
    ReferencesChanged,
    /// Read a folder's children; they come back through
    /// [`ExplorerSession::children_loaded`].
    LoadChildren(PathBuf),
    /// The workbench drains and rebinds affected Working Copies without
    /// replacing their editor entities.
    ResourceOperation(FileOp),
    /// The directory subscription failed (`service.watch`'s failure): the
    /// workspace notice offers Retry.
    WatchFailed(String),
    /// A later change arrived: the subscription works again.
    WatchRecovered,
    /// The working tree changed under the granted root (the root watcher's
    /// invalidation, `.git` internals excluded): repository status is stale.
    ContentChanged,
    /// A notice.
    Error(String),
}

/// A row the person activated (`onActivate`).
pub(in crate::app) enum Activation {
    /// A file: it opens in the editor.
    File(PathBuf),
    /// A folder opened or closed.
    Folder,
}

/// A project the window showed before: its session, kept to come back to.
struct Retained {
    tree: Tree,
    scroll: UniformListScrollHandle,
    clipboard: Option<FileClipboard>,
    op: bool,
}

pub(in crate::app) struct ExplorerSession {
    tree: Tree,
    /// The workspace the tree lists (`None` before a folder opens).
    workspace: Option<Arc<Workspace>>,
    /// Showing the built-in fixture rows (visual captures and tests).
    fixture: bool,
    preferences: Entity<PreferencesStore>,
    scroll: UniformListScrollHandle,
    clipboard: Option<FileClipboard>,
    /// A file operation is running.
    op: bool,
    /// The running operation reports its failure above the tree
    /// (`DataWorkspace` import and move), not in a dialog.
    op_inline: bool,
    /// `operationError`: a failed import or move, shown above the tree;
    /// folder load failures stay on their own rows.
    operation_error: Option<SharedString>,
    /// Directory subscription of the shown workspace (dropped on switch).
    watch: Option<(crate::workspace::Subscription, Task<()>)>,
    retained: std::collections::BTreeMap<String, Retained>,
    refresh: Option<Task<()>>,
    references:
        std::collections::BTreeMap<String, (u64, Arc<crate::editor::navigation::ReferenceIndex>)>,
}
impl EventEmitter<SessionEvent> for ExplorerSession {}

fn parent_of(path: &Path) -> PathBuf {
    path.parent().unwrap_or(Path::new("")).to_owned()
}
fn relative(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

impl ExplorerSession {
    /// An empty session, or the fixture rows for captures and tests.
    pub fn new(
        fixture: bool,
        preferences: Entity<PreferencesStore>,
        cx: &mut Context<Self>,
    ) -> Self {
        // Hidden files and exclude patterns refilter the tree.
        observe_slice(
            &preferences,
            |store| store.state.files.clone(),
            |s: &mut Self, files, cx| s.apply_visibility(files, cx),
            cx,
        )
        .detach();
        let mut session = Self {
            tree: if fixture {
                Tree::fixture()
            } else {
                Tree::new()
            },
            workspace: None,
            fixture,
            preferences: preferences.clone(),
            scroll: UniformListScrollHandle::new(),
            clipboard: None,
            op: false,
            op_inline: false,
            operation_error: None,
            watch: None,
            retained: Default::default(),
            refresh: None,
            references: Default::default(),
        };
        let files = preferences.read(cx).state.files.clone();
        session.apply_visibility(&files, cx);
        session
    }
    fn apply_visibility(&mut self, files: &FilesVisibility, cx: &mut Context<Self>) {
        let visibility = Visibility {
            show_hidden: files.show_hidden_files,
            patterns: files.exclude_patterns.clone(),
        };
        if self.tree.visibility != visibility {
            self.tree.visibility = visibility;
            self.tree.rebuild();
            cx.notify();
        }
    }

    // ----------------------------------------------------------------- reads
    pub fn tree(&self) -> &Tree {
        &self.tree
    }
    pub fn workspace(&self) -> Option<&Arc<Workspace>> {
        self.workspace.as_ref()
    }
    /// What the shown workspace allows (nothing before one opens).
    pub fn capabilities(&self) -> crate::workspace::contracts::Capabilities {
        self.workspace
            .as_ref()
            .map(|ws| ws.capabilities())
            .unwrap_or_default()
    }
    pub fn fixture(&self) -> bool {
        self.fixture
    }
    pub fn scroll(&self) -> &UniformListScrollHandle {
        &self.scroll
    }
    pub fn clipboard(&self) -> Option<&FileClipboard> {
        self.clipboard.as_ref()
    }
    /// A file operation is running.
    pub fn busy(&self) -> bool {
        self.op
    }
    pub fn operation_error(&self) -> Option<&SharedString> {
        self.operation_error.as_ref()
    }
    /// The listed entry at `path` is a folder.
    pub fn is_folder(&self, path: &Path) -> bool {
        self.tree.is_folder(path)
    }
    /// The selected folder (Share's folder target), if a folder is selected.
    pub fn selected_folder(&self) -> Option<PathBuf> {
        let selected = &self.tree.selected;
        if selected.as_os_str().is_empty() {
            return None;
        }
        self.tree
            .rows
            .iter()
            .find(|r| &r.path == selected && r.folder)
            .map(|r| r.path.clone())
    }
    /// Metadata uses every hydrated node, including collapsed descendants.
    /// Retained editors resolve against their owner, never the active project.
    pub fn reference_context(
        &mut self,
        workspace: &Workspace,
        path: &Path,
    ) -> Option<crate::editor::navigation::ReferenceContext> {
        use crate::editor::navigation::{Document, ReferenceContext, ReferenceIndex};
        let key = |workspace: &Workspace| {
            crate::editor::workbench::catalog::resource_key(
                &workspace
                    .resource_id(Path::new(""))
                    .expect("workspace root"),
            )
        };
        let owner = key(workspace);
        let tree = if self.workspace.as_ref().is_some_and(|ws| key(ws) == owner) {
            &self.tree
        } else {
            &self.retained.get(&owner)?.tree
        };
        let cached = self.references.get(&owner);
        if cached.is_none_or(|(revision, _)| *revision != tree.revision) {
            fn collect(nodes: &[Node], out: &mut Vec<Document>) {
                for node in nodes {
                    if !node.folder {
                        out.push(Document {
                            path: node.path.to_string_lossy().into_owned(),
                            name: node.name.clone(),
                        });
                    }
                    collect(&node.children, out);
                }
            }
            let mut documents = Vec::new();
            collect(&tree.roots, &mut documents);
            let index = cached
                .filter(|(_, index)| index.matches(&documents))
                .map(|(_, index)| index.clone())
                .unwrap_or_else(|| Arc::new(ReferenceIndex::new(documents)));
            self.references
                .insert(owner.clone(), (tree.revision, index));
        }
        Some(ReferenceContext {
            source: path.to_string_lossy().into_owned(),
            index: self.references[&owner].1.clone(),
        })
    }

    // ------------------------------------------------------------- workspace
    /// Restore the workspace's session, then revalidate its listings.
    pub fn load_workspace(
        &mut self,
        workspace: Arc<Workspace>,
        roots: Vec<Node>,
        cx: &mut Context<Self>,
    ) {
        let key = |ws: &Workspace| {
            crate::editor::workbench::catalog::resource_key(
                &ws.resource_id(Path::new("")).expect("workspace root"),
            )
        };
        let next = key(&workspace);
        if let Some(current) = self.workspace.clone()
            && key(&current) == next
        {
            // The same storage under a new lease: keep the tree, bind it to
            // the new provider and revalidate what is loaded.
            if !Arc::ptr_eq(&current, &workspace) {
                self.workspace = Some(workspace.clone());
                self.watch = None;
                if !self.fixture || cfg!(test) {
                    self.subscribe_tree(&workspace, cx);
                }
                self.refresh_loaded_folders(cx);
                cx.notify();
            }
            return;
        }
        let visibility = self.tree.visibility.clone();
        // The banner belongs to the project whose operation failed.
        self.operation_error = None;
        self.op_inline = false;
        let empty = Retained {
            tree: Tree {
                roots,
                visibility,
                ..Tree::new()
            },
            scroll: UniformListScrollHandle::new(),
            clipboard: None,
            op: false,
        };
        let cached = self.retained.remove(&next);
        let revalidate = cached.is_some();
        let restored = cached.unwrap_or(empty);
        self.refresh = None;
        let previous = Retained {
            tree: std::mem::replace(&mut self.tree, restored.tree),
            scroll: std::mem::replace(&mut self.scroll, restored.scroll),
            clipboard: std::mem::replace(&mut self.clipboard, restored.clipboard),
            op: std::mem::replace(&mut self.op, restored.op),
        };
        self.watch = None;
        if !self.fixture || cfg!(test) {
            self.subscribe_tree(&workspace, cx);
        }
        if let Some(old) = self.workspace.replace(workspace) {
            self.retained.insert(key(&old), previous);
        }
        self.tree.rebuild();
        let files = self.preferences.read(cx).state.files.clone();
        self.apply_visibility(&files, cx);
        self.fixture = false;
        if revalidate {
            self.refresh_loaded_folders(cx);
        }
        cx.notify();
    }
    /// Directory subscription: external changes (Agents, terminals, other
    /// apps) reread the loaded folders; one reset per coalesced burst.
    fn subscribe_tree(&mut self, workspace: &Arc<Workspace>, cx: &mut Context<Self>) {
        let (tx, rx) = async_channel::bounded::<()>(1);
        let notify: crate::workspace::ports::Notify = Arc::new(move || {
            let _ = tx.try_send(());
        });
        let Ok(subscription) = workspace.watch_root(notify) else {
            return;
        };
        let task = cx.spawn(async move |this, cx| {
            while rx.recv().await.is_ok() {
                let alive = this.update(cx, |s, cx| {
                    use crate::workspace::ports::WatchEvent;
                    match s.watch.as_ref().and_then(|(sub, _)| sub.next()) {
                        Some(WatchEvent::Invalidated) => {
                            cx.emit(SessionEvent::WatchRecovered);
                            cx.emit(SessionEvent::ContentChanged);
                            if !s.op {
                                s.refresh_loaded_folders(cx);
                            }
                        }
                        Some(WatchEvent::Failed(error)) => {
                            cx.emit(SessionEvent::WatchFailed(error.to_string()))
                        }
                        None => {}
                    }
                });
                if alive.is_err() {
                    break;
                }
            }
        });
        self.watch = Some((subscription, task));
    }
    /// Retry after a failed subscription: subscribe again and reread what is
    /// loaded.
    pub fn resubscribe(&mut self, cx: &mut Context<Self>) {
        let Some(workspace) = self.workspace.clone() else {
            return;
        };
        self.watch = None;
        self.subscribe_tree(&workspace, cx);
        self.refresh_loaded_folders(cx);
    }
    /// A Cloud publication: reread what is loaded (`onPublication`).
    pub fn refresh_published(&mut self, cx: &mut Context<Self>) {
        self.refresh_loaded_folders(cx);
    }
    fn refresh_loaded_folders(&mut self, cx: &mut Context<Self>) {
        let Some(workspace) = self.workspace.clone() else {
            return;
        };
        let tree_id = self.tree.id;
        let paths = self.tree.loaded_folders();
        let read = cx.background_executor().spawn(async move {
            paths
                .into_iter()
                .map(|path| {
                    let result = workspace.list(&path);
                    (path, result)
                })
                .collect::<Vec<_>>()
        });
        self.refresh = Some(cx.spawn(async move |this, cx| {
            let listings = read.await;
            let _ = this.update(cx, |s, cx| {
                if s.tree.id != tree_id {
                    return;
                }
                for (path, listing) in listings {
                    match listing {
                        Ok(nodes) => s.tree.refresh_children(&path, nodes),
                        Err(error) if path.as_os_str().is_empty() => {
                            cx.emit(SessionEvent::Error(error.to_string()))
                        }
                        Err(error) => {
                            if let Some(node) = s.tree.find_mut(&path) {
                                node.error = Some(error.to_string());
                            }
                        }
                    }
                }
                s.tree.rebuild();
                cx.emit(SessionEvent::ReferencesChanged);
                cx.notify();
            });
        }));
    }
    /// A folder's listing came back ([`SessionEvent::LoadChildren`]).
    pub fn children_loaded(
        &mut self,
        path: &Path,
        children: crate::workspace::Result<Vec<Node>>,
        cx: &mut Context<Self>,
    ) {
        match children {
            // The root reread of `retry_root`.
            Ok(nodes) if path.as_os_str().is_empty() => self.tree.refresh_children(path, nodes),
            Err(error) if path.as_os_str().is_empty() => {
                self.operation_error = Some(error.to_string().into())
            }
            Ok(nodes) => self.tree.attach_children(path, nodes),
            Err(error) => self.tree.fail_children(path, error.to_string()),
        }
        cx.notify();
    }
    /// The create form made `path` in `parent`; `listing` is the parent's
    /// fresh listing (`None` when it could not be read). The new entry is
    /// selected either way.
    pub fn entry_created(
        &mut self,
        parent: &Path,
        listing: Option<Vec<Node>>,
        path: &Path,
        cx: &mut Context<Self>,
    ) {
        match listing {
            Some(nodes) if parent.as_os_str().is_empty() => {
                self.tree.refresh_children(parent, nodes)
            }
            Some(nodes) => self.tree.attach_children(parent, nodes),
            None => {}
        }
        self.tree.select(path, false, false);
        cx.notify();
    }

    // ------------------------------------------------------ expansion, focus
    /// The editor opened `path`: the selection follows it.
    pub fn reveal(&mut self, path: &Path, cx: &mut Context<Self>) {
        let mut changed = false;
        for parent in path.ancestors().skip(1) {
            if let Some(node) = self.tree.find_mut(parent)
                && node.folder
                && node.loaded
                && !node.expanded
            {
                node.expanded = true;
                changed = true;
            }
        }
        if changed {
            self.tree.rebuild();
        }
        self.tree.selected = path.to_path_buf();
        cx.notify();
    }
    /// `onActivate`: a folder opens or closes (read first if it never was), a
    /// file is selected to open. Nothing activates while `host` is busy, nor
    /// a fixture file.
    pub fn activate(
        &mut self,
        index: usize,
        host: &Host,
        cx: &mut Context<Self>,
    ) -> Option<Activation> {
        if host.picking || host.documents_busy || host.folder_busy {
            return None;
        }
        let item = self.tree.rows.get(index).cloned().filter(|r| !r.status)?;
        self.tree.selected = item.path.clone();
        cx.notify();
        if item.folder {
            if self.tree.toggle(&item.path) {
                cx.emit(SessionEvent::LoadChildren(item.path));
            }
            Some(Activation::Folder)
        } else {
            (!self.fixture).then_some(Activation::File(item.path))
        }
    }
    /// A click with ⌘ (toggle) or ⇧ (range), or a plain selection.
    pub fn select(&mut self, path: &Path, additive: bool, range: bool, cx: &mut Context<Self>) {
        self.tree.select(path, additive, range);
        cx.notify();
    }
    /// Expands or collapses `path`, reading it first if it never was.
    pub fn set_expanded(&mut self, path: &Path, expanded: bool, cx: &mut Context<Self>) {
        if self.tree.set_expanded(path, expanded) {
            cx.emit(SessionEvent::LoadChildren(path.to_owned()));
        }
        cx.notify();
    }
    /// `onRetryFolder`: read a failed folder again.
    pub fn retry_folder(&mut self, path: &Path, cx: &mut Context<Self>) {
        if self.tree.retry_folder(path) {
            cx.emit(SessionEvent::LoadChildren(path.to_owned()));
        }
        cx.notify();
    }

    // ------------------------------------------------------- file operations
    pub fn set_clipboard(&mut self, clipboard: FileClipboard, cx: &mut Context<Self>) {
        self.clipboard = Some(clipboard);
        cx.notify();
    }
    pub fn run_op(&mut self, op: FileOp, cx: &mut Context<Self>) {
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
        cx.emit(SessionEvent::ResourceOperation(op));
        cx.notify();
    }
    pub fn operation_failed(&mut self, cx: &mut Context<Self>) {
        self.op = false;
        self.op_inline = false;
        cx.notify();
    }
    pub fn finish_op(&mut self, owner: &str, outcome: Outcome, cx: &mut Context<Self>) {
        let active = self
            .workspace
            .as_ref()
            .and_then(|ws| ws.resource_id(Path::new("")).ok())
            .map(|id| crate::editor::workbench::catalog::resource_key(&id));
        let is_active = active.as_deref() == Some(owner);
        if is_active {
            self.carry_pins(&outcome.moved, &outcome.removed, cx);
        }
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
                    Err(error) => cx.emit(SessionEvent::Error(error.to_string())),
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
            cx.emit(SessionEvent::Error(tf(
                "workspace.node.error.operationFailedDetail",
                &[("detail", error.into())],
            )));
        }
        cx.notify();
    }
    /// `onRetryFolder(null)`: dismiss the operation error and reread the root.
    pub fn retry_root(&mut self, cx: &mut Context<Self>) {
        self.operation_error = None;
        if self.workspace.is_some() {
            cx.emit(SessionEvent::LoadChildren(PathBuf::new()));
        }
        cx.notify();
    }
    /// Into a folder: what was copied is copied there, what was cut moves.
    pub fn paste_into(&mut self, target: PathBuf, cx: &mut Context<Self>) {
        match self.clipboard.clone() {
            Some(FileClipboard::Copy(paths)) => self.run_op(FileOp::Copy(paths, target), cx),
            Some(FileClipboard::Cut(paths)) => {
                self.clipboard = None;
                self.run_op(FileOp::Move(paths, target), cx)
            }
            None => {}
        }
    }
    /// The rename dialog's answer.
    pub fn rename(&mut self, path: PathBuf, name: String, cx: &mut Context<Self>) {
        self.run_op(FileOp::Rename { path, name }, cx);
    }
    pub fn duplicate(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        if !paths.is_empty() {
            self.run_op(FileOp::Duplicate(paths), cx);
        }
    }
    /// Entries dragged onto `target`: those already there, or onto
    /// themselves, stay.
    pub fn move_into(&mut self, paths: &[PathBuf], target: &Path, cx: &mut Context<Self>) {
        let paths: Vec<PathBuf> = paths
            .iter()
            .filter(|p| !target.starts_with(p) && parent_of(p) != target)
            .cloned()
            .collect();
        if !paths.is_empty() {
            self.run_op(FileOp::Move(paths, target.to_owned()), cx)
        }
    }

    // ------------------------------------------------------------------ pins
    /// `getExplorerPinsProjectKey`: the project's folder, or its Cloud
    /// storage.
    fn pins_key(&self) -> Option<String> {
        let workspace = self.workspace.as_ref()?;
        Some(match workspace.local_root() {
            Some(root) => root.to_string_lossy().into_owned(),
            None => workspace
                .resource_id(Path::new(""))
                .ok()?
                .storage
                .as_str()
                .to_owned(),
        })
    }
    /// This project's pins (`Preferences::explorer_pins`, shared by its
    /// windows).
    pub fn pins(&self, cx: &App) -> ExplorerPins {
        self.pins_key()
            .and_then(|key| {
                self.preferences
                    .read(cx)
                    .state
                    .explorer_pins
                    .get(&key)
                    .cloned()
            })
            .unwrap_or_default()
    }
    /// `path` can be pinned: one file of a project.
    pub fn pinnable(&self, path: &Path) -> bool {
        !self.tree.is_folder(path) && self.pins_key().is_some()
    }
    fn change_pins(&self, change: impl FnOnce(&mut ExplorerPins), cx: &mut App) {
        let Some(key) = self.pins_key() else {
            return;
        };
        self.preferences
            .update(cx, |p, cx| p.change(|p| p.change_pins(&key, change), cx));
    }
    /// The node menu's Pin / Unpin.
    pub fn toggle_pin(&mut self, path: &Path, cx: &mut Context<Self>) {
        let path = relative(path);
        self.change_pins(|pins| pins.toggle(&path), cx);
    }
    /// The tree folds away under the pins, or comes back.
    pub fn set_files_collapsed(&mut self, collapsed: bool, cx: &mut Context<Self>) {
        self.change_pins(|pins| pins.set_files_collapsed(collapsed), cx);
    }
    /// A file operation's moves and deletions carry their pins.
    fn carry_pins(&self, moved: &[(PathBuf, PathBuf)], removed: &[PathBuf], cx: &mut App) {
        let mut pins = self.pins(cx);
        let mut changed = false;
        for (from, to) in moved {
            changed |= pins.rebase(&relative(from), &relative(to));
        }
        for path in removed {
            changed |= pins.remove_under(&relative(path));
        }
        if changed {
            self.change_pins(|stored| *stored = pins, cx);
        }
    }
}

/// Dev-capture scenario steps (`PUPPYONE_CAPTURE_SCENARIO`); `false` while
/// a step cannot run yet.
#[cfg(feature = "dev-capture")]
impl ExplorerSession {
    pub fn capture_select(&mut self, path: &Path, cx: &mut Context<Self>) -> bool {
        if self.tree.index_of(path).is_none() {
            return false;
        }
        self.tree.select(path, false, false);
        cx.notify();
        true
    }
    /// Done once `path` shows expanded (its listing may still be loading).
    pub fn capture_expand(&mut self, path: &Path, cx: &mut Context<Self>) -> bool {
        let Some(index) = self.tree.index_of(path) else {
            return false;
        };
        if self.tree.rows[index].expanded {
            return true;
        }
        self.set_expanded(path, true, cx);
        false
    }
}

/// Tests look inside.
#[cfg(test)]
impl ExplorerSession {
    pub fn tree_mut(&mut self) -> &mut Tree {
        &mut self.tree
    }
}

#[cfg(test)]
mod tests;
