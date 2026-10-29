//! Native Explorer: port of `shared-ui/data/ExplorerTree.tsx` with the row
//! actions and menus of `data-workspace/nodeActions.tsx`.
//!
//! The Explorer is its own entity. It owns the workspace tree it shows, the
//! selection, the file clipboard, its menus, file operations and the
//! disclosure motion. The shell tells it where it is painted and what the
//! documents are doing ([`Host`]), hands it folder listings, and acts on what
//! it asks for ([`ExplorerEvent`]): open a file, read a folder, prepare retained
//! documents for a resource operation, show the create or rename dialog,
//! show a notice.
//!
//! - [`rows`]: tree rows and the list-end "New" row, built from
//!   [`SidebarRow`](crate::ui::components::SidebarRow)
//! - [`menus`]: the create and node-action menus on GPUI Kit popovers
//! - [`file_ops`]: rename, move, copy, import and delete on a worker
//! - [`keyboard`]: Explorer key bindings
//! - [`motion`]: the disclosure motion
use crate::{
    features::{
        create_new::create_entry_menu_registry::Entry,
        settings::preferences_store::{PreferencesChanged, PreferencesStore},
    },
    geometry::Rect,
    localization::t as tr,
    model::{Node, Tree, Visibility},
    theme::{self, Theme, metric},
    ui::appearance::ActiveAppearance,
    workspace::Workspace,
};
use gpui::{prelude::*, *};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

mod file_ops;
mod keyboard;
mod menus;
mod motion;
mod rows;

pub(super) use file_ops::FileClipboard;
use file_ops::FileOp;
pub use keyboard::bind_keys;
use menus::ExplorerMenu;
pub(super) use menus::{MenuAt, RowTrigger};
pub(in crate::shell) use rows::DragNodes;

/// What the Explorer reads from the shell, pushed every frame.
#[derive(Clone, Debug, Default, PartialEq)]
pub(in crate::shell) struct Host {
    /// The panel in window coordinates, at its open width (the shell clips it
    /// while the pane moves).
    pub frame: Rect,
    /// The pane is open: rows animate only then.
    pub open: bool,
    /// The document in the editor, workspace-relative.
    pub opened: Option<PathBuf>,
    pub open_resources: Vec<PathBuf>,
    /// A document switch, save or close is in flight.
    pub documents_busy: bool,
    /// A folder listing is loading.
    pub folder_busy: bool,
    /// The folder picker is open.
    pub picking: bool,
}

/// What the Explorer asks of the shell.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::shell) enum ExplorerEvent {
    /// Background revalidation changed the metadata used by document links.
    ReferencesChanged,
    /// Open a workspace file in the editor.
    Open(PathBuf),
    /// Read a folder's children; they come back through
    /// [`Explorer::children_loaded`].
    LoadChildren(PathBuf),
    /// The workbench drains and rebinds affected Working Copies without
    /// replacing their editor entities.
    ResourceOperation(FileOp),
    /// The create form for `entry` in `parent`.
    Create { entry: Entry, parent: PathBuf },
    /// The rename (or change file type) dialog for `path`.
    Rename { path: PathBuf, change_type: bool },
    /// A notice.
    Error(String),
}

pub(in crate::shell) struct Explorer {
    tree: Tree,
    /// The workspace the tree lists (`None` before a folder opens).
    workspace: Option<Arc<Workspace>>,
    /// Showing the built-in fixture rows (visual captures and tests).
    fixture: bool,
    preferences: Entity<PreferencesStore>,
    host: Host,
    weak: WeakEntity<Self>,
    focus: FocusHandle,
    scroll: UniformListScrollHandle,
    clipboard: Option<FileClipboard>,
    /// The open create or node-action menu.
    menu: Option<ExplorerMenu>,
    /// The running file operation.
    op: bool,
    /// The running operation reports its failure above the tree
    /// (`DataWorkspace` import and move), not in a dialog.
    op_inline: bool,
    /// `operationError`: a failed import or move, shown above the tree;
    /// folder load failures stay on their own rows.
    operation_error: Option<SharedString>,
    retained: std::collections::BTreeMap<String, RetainedExplorer>,
    refresh: Option<Task<()>>,
    references:
        std::collections::BTreeMap<String, (u64, Arc<crate::editor::navigation::ReferenceIndex>)>,
    /// The disclosure motion of the visible rows.
    motion: motion::TreeMotion,
    #[cfg(test)]
    pub painted_rows: usize,
    /// Times the Explorer rendered (it is a cached view in the shell).
    #[cfg(test)]
    pub renders: usize,
}
struct RetainedExplorer {
    tree: Tree,
    scroll: UniformListScrollHandle,
    clipboard: Option<FileClipboard>,
    op: bool,
}
impl EventEmitter<ExplorerEvent> for Explorer {}
impl Focusable for Explorer {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

fn parent_of(path: &Path) -> PathBuf {
    path.parent().unwrap_or(Path::new("")).to_owned()
}

impl Explorer {
    /// An empty Explorer, or the fixture rows for captures and tests.
    pub fn new(
        fixture: bool,
        preferences: Entity<PreferencesStore>,
        cx: &mut Context<Self>,
    ) -> Self {
        // Hidden files and exclude patterns follow the preference.
        cx.subscribe(&preferences, |s, _, _: &PreferencesChanged, cx| {
            s.apply_visibility(cx)
        })
        .detach();
        // Icon theme and Create New configuration are read when painting.
        cx.observe(&preferences, |_, _, cx| cx.notify()).detach();
        let mut explorer = Self {
            tree: if fixture {
                Tree::fixture()
            } else {
                Tree::new()
            },
            workspace: None,
            fixture,
            preferences,
            host: Host::default(),
            weak: cx.weak_entity(),
            focus: cx.focus_handle(),
            scroll: UniformListScrollHandle::new(),
            clipboard: None,
            menu: None,
            op: false,
            op_inline: false,
            operation_error: None,
            retained: Default::default(),
            refresh: None,
            references: Default::default(),
            motion: motion::TreeMotion::default(),
            #[cfg(test)]
            painted_rows: 0,
            #[cfg(test)]
            renders: 0,
        };
        explorer.apply_visibility(cx);
        explorer
    }
    fn apply_visibility(&mut self, cx: &mut Context<Self>) {
        let files = &self.preferences.read(cx).state.files;
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

    // ---------------------------------------------------------- from the shell
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
    /// The shell's state this frame; also commits the visible rows to the
    /// disclosure motion and keeps frames coming while it runs. A file
    /// operation waiting on the open document resumes once nothing is open.
    ///
    /// The shell embeds the Explorer as a cached view, so the Explorer
    /// renders again only when notified: when what the shell pushes
    /// changes, and on every frame of the disclosure motion (the frame it
    /// requests is the shell's, which is rendering).
    pub fn sync(&mut self, host: Host, window: &mut Window, cx: &mut Context<Self>) {
        let changed = self.host != host;
        self.host = host;
        let animate = self.host.open && !cx.reduce_motion();
        let moving = self.motion.sync(
            self.tree.id,
            self.tree.revision,
            &self.tree.rows,
            theme::sidebar_stride(),
            animate,
        );
        if moving {
            window.request_animation_frame();
        }
        if changed || moving {
            cx.notify();
        }
    }
    /// Restore the workspace's Explorer session, then revalidate its listings.
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
        if self.workspace.as_ref().is_some_and(|ws| key(ws) == next) {
            return;
        }
        let visibility = self.tree.visibility.clone();
        // The banner belongs to the project whose operation failed.
        self.operation_error = None;
        self.op_inline = false;
        let empty = RetainedExplorer {
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
        let previous = RetainedExplorer {
            tree: std::mem::replace(&mut self.tree, restored.tree),
            scroll: std::mem::replace(&mut self.scroll, restored.scroll),
            clipboard: std::mem::replace(&mut self.clipboard, restored.clipboard),
            op: std::mem::replace(&mut self.op, restored.op),
        };
        if let Some(old) = self.workspace.replace(workspace) {
            self.retained.insert(key(&old), previous);
        }
        self.tree.rebuild();
        self.apply_visibility(cx);
        self.fixture = false;
        self.menu = None;
        if revalidate {
            self.refresh_loaded_folders(cx);
        }
        cx.notify();
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
                            cx.emit(ExplorerEvent::Error(error.to_string()))
                        }
                        Err(error) => {
                            if let Some(node) = s.tree.find_mut(&path) {
                                node.error = Some(error.to_string());
                            }
                        }
                    }
                }
                s.tree.rebuild();
                cx.emit(ExplorerEvent::ReferencesChanged);
                cx.notify();
            });
        }));
    }
    /// A folder's listing came back ([`ExplorerEvent::LoadChildren`]).
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
    /// The rename dialog's answer.
    pub fn rename(&mut self, path: PathBuf, name: String, cx: &mut Context<Self>) {
        self.run_op(FileOp::Rename { path, name }, cx);
    }
    /// Closes the open menu; `false` when none was open.
    pub fn dismiss_menu(&mut self, cx: &mut Context<Self>) -> bool {
        let open = self.menu.take().is_some();
        if open {
            cx.notify();
        }
        open
    }
    /// A file operation is running.
    pub fn busy(&self) -> bool {
        self.op
    }
    #[cfg(any(test, feature = "dev-capture"))]
    pub fn tree(&self) -> &Tree {
        &self.tree
    }

    // ------------------------------------------------------------------ rows
    /// `onActivate`: a folder opens or closes, a file opens in the editor.
    /// Nothing opens while the documents or the folder picker are busy.
    pub fn open_row(&mut self, index: usize, cx: &mut Context<Self>) {
        if self.host.picking || self.host.documents_busy || self.host.folder_busy {
            return;
        }
        let Some(item) = self.tree.rows.get(index).cloned() else {
            return;
        };
        self.tree.selected = item.path.clone();
        if item.folder {
            if self.tree.toggle(&item.path) {
                cx.emit(ExplorerEvent::LoadChildren(item.path));
            }
        } else if !self.fixture {
            cx.emit(ExplorerEvent::Open(item.path));
        }
        cx.notify();
    }
    /// Expands or collapses `path`, reading it first if it never was.
    pub fn set_expanded(&mut self, path: &Path, expanded: bool, cx: &mut Context<Self>) {
        if self.tree.set_expanded(path, expanded) {
            cx.emit(ExplorerEvent::LoadChildren(path.to_owned()));
        }
        cx.notify();
    }
}

/// Dev-capture scenario steps (`PUPPYONE_CAPTURE_SCENARIO`); `false` while
/// a step cannot run yet.
#[cfg(feature = "dev-capture")]
impl Explorer {
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
    /// The Custom files submenu opens without a hover.
    pub fn capture_open_submenu(&mut self, cx: &mut Context<Self>) {
        if let Some(menu) = &mut self.menu {
            menu.submenu_open = true;
            cx.notify();
        }
    }
    /// The tree row under a window point (rows stack from the list's 12px
    /// top padding, one stride each).
    pub fn row_at(&self, position: Point<Pixels>) -> Option<usize> {
        let (x, y) = (f32::from(position.x), f32::from(position.y));
        let list = self.host.frame;
        if x < list.x || x >= list.right() {
            return None;
        }
        let offset = f32::from(self.scroll.0.borrow().base_handle.offset().y);
        let row = (y - list.y - 12. - offset) / theme::sidebar_stride();
        (row >= 0.)
            .then_some(row as usize)
            .filter(|index| *index < self.tree.rows.len())
    }
}
/// Tests look inside.
#[cfg(test)]
impl Explorer {
    pub fn tree_mut(&mut self) -> &mut Tree {
        &mut self.tree
    }
    pub fn menu(&self) -> Option<&ExplorerMenu> {
        self.menu.as_ref()
    }
    pub fn clipboard(&self) -> Option<&FileClipboard> {
        self.clipboard.as_ref()
    }
    pub fn motion(&self) -> &motion::TreeMotion {
        &self.motion
    }
    pub fn scroll(&self) -> &UniformListScrollHandle {
        &self.scroll
    }
}

impl Render for Explorer {
    /// The panel: the virtual tree with its drop target, context menu and the
    /// fade into the footer.
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(test)]
        {
            self.renders += 1;
            self.painted_rows = 0;
        }
        let t = cx.palette();
        let loading = self.tree.rows.is_empty() && (self.host.folder_busy || self.host.picking);
        let empty = self.tree.rows.is_empty() && !loading && self.workspace.is_some();
        let operation_error = self.operation_error.clone().filter(|_| !loading);
        let count = self.tree.rows.len() + usize::from(self.workspace.is_some() || self.fixture);
        let tree = div()
            .id("explorer-tree")
            .flex_1()
            .min_h_0()
            .track_focus(&self.focus)
            .key_context(keyboard::CONTEXT)
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(|s, e: &MouseDownEvent, _, cx| {
                    // `onExplorerRootContextMenu`: create at the pointer.
                    s.open_create_menu(PathBuf::new(), MenuAt::Pointer(e.position), cx)
                }),
            )
            .drag_over::<rows::DragNodes>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.05)))
            .drag_over::<ExternalPaths>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.05)))
            .on_drop(cx.listener(|s, drag: &rows::DragNodes, _, cx| {
                if !drag.belongs_to(&s.workspace) {
                    return;
                }
                let paths: Vec<PathBuf> = drag
                    .paths
                    .iter()
                    .filter(|p| !parent_of(p).as_os_str().is_empty())
                    .cloned()
                    .collect();
                if !paths.is_empty() {
                    s.run_op(FileOp::Move(paths, PathBuf::new()), cx)
                }
            }))
            .on_drop(cx.listener(|s, paths: &ExternalPaths, _, cx| {
                s.run_op(FileOp::Import(paths.paths().to_vec(), PathBuf::new()), cx)
            }))
            .child(
                uniform_list(
                    "explorer",
                    count,
                    cx.processor(move |s, range: std::ops::Range<usize>, _, cx| {
                        #[cfg(test)]
                        {
                            s.painted_rows += range.len();
                        }
                        // The first row in view also paints the ghosts of
                        // rows that just went away.
                        let first = range.start;
                        range
                            .map(|index| s.explorer_row(index, index == first, cx))
                            .collect::<Vec<_>>()
                    }),
                )
                .size_full()
                .pt(px(12.))
                .pb(px(6.))
                .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
                .track_scroll(&self.scroll),
            );
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.sidebar)
            .children(
                operation_error
                    .clone()
                    .map(|error| self.operation_error_banner(error, empty, t, cx)),
            )
            .when((loading || empty) && operation_error.is_none(), |d| {
                d.child(
                    div()
                        .px(px(
                            metric::SIDEBAR_ROW_LEFT_GAP + metric::TREE_ROW_CONTENT_LEFT
                        ))
                        .pt(px(12.))
                        .text_size(px(theme::ty().left.meta))
                        .text_color(t.subtle)
                        .child(tr(if loading {
                            "shared-ui.explorer.loadingWorkspace"
                        } else {
                            "shared-ui.explorer.emptyFolder"
                        })),
                )
            })
            .child(self.on_explorer_actions(tree, cx))
            .when(theme::footer() > 0., |d| d.child(self.tree_bottom_fade(t)))
            .children(self.context_menu(cx))
    }
}
impl Explorer {
    /// `.explorer-tree-error-banner` above a tree with rows, or the root meta
    /// row of an empty tree: the failed import or move with its Retry.
    fn operation_error_banner(
        &self,
        error: SharedString,
        empty: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let retry = div()
            .id("explorer-operation-retry")
            .flex_shrink_0()
            .ml(px(8.))
            .text_color(t.text)
            .cursor(theme::clickable_cursor())
            .child(tr("common.action.retry"))
            .on_click(cx.listener(|s, _, _, cx| {
                cx.stop_propagation();
                s.retry_root(cx);
            }));
        let text = div().min_w_0().child(error);
        if empty {
            // `ExplorerTreeMetaRow depth={0}` with `role="alert"`.
            return div()
                .flex()
                .items_center()
                .px(px(
                    metric::SIDEBAR_ROW_LEFT_GAP + metric::TREE_ROW_CONTENT_LEFT
                ))
                .pt(px(12.))
                .text_size(px(theme::ty().left.meta))
                .text_color(t.danger)
                .child(text)
                .child(retry)
                .into_any_element();
        }
        div()
            .id("explorer-operation-error")
            .flex()
            .flex_none()
            .items_start()
            .mt(px(6.))
            .mb(px(4.))
            .ml(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .mr(px(metric::SIDEBAR_ROW_RIGHT_GAP))
            .px(px(8.))
            .py(px(6.))
            .border_1()
            .border_color(theme::alpha(t.danger, 0.24))
            .rounded(px(metric::SIDEBAR_ROW_RADIUS))
            .bg(theme::mix(t.danger, t.sidebar, 0.08))
            .text_color(t.danger)
            .text_size(px(theme::ty().left.meta))
            .line_height(relative(1.4))
            .child(text.flex_1())
            .child(retry)
            .into_any_element()
    }
    /// `.explorer-tree-shell::after` with the navigation at the bottom: while rows
    /// remain below the viewport the tree fades into the footer, which has no
    /// divider. Read at paint time so the fade follows every scroll frame.
    fn tree_bottom_fade(&self, t: Theme) -> impl IntoElement {
        let scroll = self.scroll.clone();
        let sidebar = t.sidebar;
        canvas(
            |_, _, _| {},
            move |bounds, _, window, _| {
                let fade = {
                    let state = scroll.0.borrow();
                    let (offset, max) =
                        (state.base_handle.offset(), state.base_handle.max_offset());
                    bottom_fade(f32::from(offset.y), f32::from(max.y))
                };
                if fade <= 0. {
                    return;
                }
                // linear-gradient(to top, sidebar 0%, sidebar/78% 46%, transparent 100%)
                // at height 18px x fade and opacity fade. GPUI gradients have two stops,
                // so the curve is two quads joined on a device-pixel row.
                let scale = window.scale_factor();
                let bottom = f32::from(bounds.bottom());
                let top = bottom - metric::SIDEBAR_NAVIGATION_FADE_SIZE * fade;
                let mid = ((bottom - (bottom - top) * 0.46) * scale).round() / scale;
                let left = bounds.origin.x;
                let width = bounds.size.width;
                let band = |from: f32, to: f32, y0: f32, y1: f32| {
                    fill(
                        Bounds::new(point(left, px(y0)), size(width, px(y1 - y0))),
                        linear_gradient(
                            0.,
                            linear_color_stop(theme::alpha(sidebar, from * fade), 0.),
                            linear_color_stop(theme::alpha(sidebar, to * fade), 1.),
                        ),
                    )
                };
                window.paint_quad(band(1., 0.78, mid, bottom));
                window.paint_quad(band(0.78, 0., top, mid));
            },
        )
        .absolute()
        .left_0()
        .right_0()
        .bottom_0()
        .h(px(metric::SIDEBAR_NAVIGATION_FADE_SIZE))
    }
}
/// `useScrollEdgeState` bottom fade: the remaining scroll over a 24px distance,
/// zero unless the list overflows by more than 1px. `offset_y` is GPUI's
/// (non-positive) scroll offset, `max_y` the maximum scroll distance.
pub(super) fn bottom_fade(offset_y: f32, max_y: f32) -> f32 {
    const FADE_DISTANCE: f32 = 24.;
    const OVERFLOW_THRESHOLD: f32 = 1.;
    if max_y <= OVERFLOW_THRESHOLD {
        return 0.;
    }
    let scroll_top = (-offset_y).clamp(0., max_y);
    ((max_y - scroll_top) / FADE_DISTANCE).clamp(0., 1.)
}

#[cfg(test)]
mod tests;
