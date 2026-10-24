//! Native Explorer: port of `shared-ui/data/ExplorerTree.tsx`, the row actions
//! and menus of `data-workspace/nodeActions.tsx`, and the sidebar footer
//! navigation (`DesktopSidebarFooterNavigation`). File operations run on a
//! worker through `workspace.rs`; the open document is closed (autosave drained)
//! before a rename, move or delete touches it, then reopened at its new path.
use super::*;
use crate::geometry::menu_position::{self, CreatePlacement};
use crate::{
    features::create_new::create_entry_menu_registry::Entry,
    localization::{t as tr, tf},
    model::Node,
    theme::metric,
    ui::{
        icon_sized, icon_stroke,
        menu::{MenuEntry, MenuItem, MenuStyle, menu_surface_styled},
        tooltip,
    },
};
use std::{cell::RefCell, collections::HashMap, path::Path, rc::Rc, sync::mpsc};

#[derive(Clone)]
pub(super) struct DragNodes {
    pub paths: Vec<PathBuf>,
    pub label: SharedString,
    pub dark: bool,
}
impl Render for DragNodes {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let t = Theme::new(self.dark);
        div()
            .px(px(10.))
            .py(px(6.))
            .rounded(px(6.))
            .bg(t.menu_bg)
            .border_1()
            .border_color(t.border)
            .text_color(t.text)
            .text_size(px(theme::ty().left.content))
            .child(self.label.clone())
    }
}
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
fn parent_of(path: &Path) -> PathBuf {
    path.parent().unwrap_or(Path::new("")).to_owned()
}
/// Which row trigger owns the open menu (`explorerOpenActionMenu.trigger`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowTrigger {
    /// The folder row's "+" (`createMenuOpen`).
    Create,
    /// The row's "⋮" (`nodeMenuOpen`), also lit by a right click on the row.
    More,
}
#[derive(Clone, Debug, PartialEq)]
pub enum ExplorerMenuKind {
    /// `DesktopCreateEntryMenu` for a parent folder (`""` is the workspace root).
    Create {
        parent: PathBuf,
        placement: CreatePlacement,
        /// Custom files submenu (`desktop-create-entry-submenu-wrap[data-open]`).
        submenu_open: bool,
    },
    /// `DesktopNodeActionMenu` for the selection (`primary` is the clicked row).
    Node {
        paths: Vec<PathBuf>,
        primary: PathBuf,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub struct ExplorerMenu {
    /// `DesktopCreateEntryAnchor`: the trigger's rectangle, or a zero-size
    /// rectangle at the pointer for context menus.
    pub anchor: Rect,
    pub kind: ExplorerMenuKind,
    /// `launcherPath`: the row whose actions stay revealed while the menu is open.
    pub launcher: Option<PathBuf>,
}
impl ExplorerMenu {
    /// `explorerOpenActionMenu` for a row: the node menu lights its launcher's
    /// "⋮"; a create menu not launched from the list end lights the "+" of
    /// its parent folder's row.
    pub fn row_trigger(&self, path: &Path) -> Option<RowTrigger> {
        match &self.kind {
            ExplorerMenuKind::Node { .. } => {
                (self.launcher.as_deref() == Some(path)).then_some(RowTrigger::More)
            }
            ExplorerMenuKind::Create {
                parent, placement, ..
            } => (*placement != CreatePlacement::AutoEnd
                && !parent.as_os_str().is_empty()
                && parent == path)
                .then_some(RowTrigger::Create),
        }
    }
    fn sidebar_launcher(&self) -> bool {
        matches!(
            self.kind,
            ExplorerMenuKind::Create {
                placement: CreatePlacement::AutoEnd,
                ..
            }
        )
    }
}
/// Resolved frame of an open Explorer menu and its optional submenu.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct ExplorerMenuFrame {
    pub menu: Rect,
    pub style: MenuStyle,
    pub submenu: Option<Rect>,
}
/// `.tree-row-actions` geometry inside a painted row: the "⋮" button sits
/// 4px from the row's end, the "+" 2px before it, both vertically centred.
pub(super) fn row_action_rect(row: Rect, trigger: RowTrigger) -> Rect {
    let size = metric::TREE_ROW_ACTION_SIZE;
    let y = row.y + (row.h - size) / 2.;
    let more = row.right() - metric::TREE_ROW_ACTION_INSET - size;
    match trigger {
        RowTrigger::More => Rect::new(more, y, size, size),
        RowTrigger::Create => Rect::new(more - metric::TREE_ROW_ACTION_GAP - size, y, size, size),
    }
}
/// Last painted window-space bounds of Explorer rows (keyed by path) and of
/// the list-end "New" row, so a trigger opens its menu against its own
/// rectangle (`event.currentTarget.getBoundingClientRect()`).
#[derive(Clone, Default)]
pub(super) struct RowAnchors {
    rows: Rc<RefCell<HashMap<PathBuf, Rect>>>,
    new_row: Rc<std::cell::Cell<Option<Rect>>>,
}
impl RowAnchors {
    pub fn row(&self, path: &Path) -> Option<Rect> {
        self.rows.borrow().get(path).copied()
    }
    pub fn new_row(&self) -> Option<Rect> {
        self.new_row.get()
    }
    /// Placed in a row's padding-free stride wrapper: records the row inside
    /// its 1px block margins.
    fn measure_row(&self, path: PathBuf) -> impl IntoElement {
        let rows = self.rows.clone();
        canvas(
            move |bounds, _, _| {
                rows.borrow_mut().insert(path, row_rect_of(bounds));
            },
            |_, _, _, _| {},
        )
        .absolute()
        .top_0()
        .left_0()
        .size_full()
    }
    fn measure_new_row(&self) -> impl IntoElement {
        let cell = self.new_row.clone();
        canvas(
            move |bounds, _, _| cell.set(Some(row_rect_of(bounds))),
            |_, _, _, _| {},
        )
        .absolute()
        .top_0()
        .left_0()
        .size_full()
    }
}
/// A stride wrapper's bounds minus the row's `margin: 1px 0`.
fn row_rect_of(bounds: Bounds<Pixels>) -> Rect {
    Rect::new(
        f32::from(bounds.origin.x),
        f32::from(bounds.origin.y) + 1.,
        f32::from(bounds.size.width),
        f32::from(bounds.size.height) - 2.,
    )
}
/// `getPlatformShortcut`: the primary modifier glyph on macOS.
fn shortcut(key: &str) -> String {
    if cfg!(target_os = "macos") {
        format!("⌘{key}")
    } else {
        format!("Ctrl+{key}")
    }
}
/// `--tree-row-selected-bg`: `linear-gradient(90deg, selected 96% 0%,
/// selected 88% calc(100% - 36px), selected 62% 100%)`. GPUI gradients take
/// two stops, so the three-stop ramp is two adjoining quads.
fn selected_row_gradient(width: f32, t: Theme) -> Div {
    let tail = 36f32.min(width);
    let stop = |weight: f32, at: f32| linear_color_stop(theme::alpha(t.selected, weight), at);
    row()
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .child(
            div()
                .h_full()
                .w(px(width - tail))
                .rounded_l(px(metric::SIDEBAR_ROW_RADIUS))
                .bg(linear_gradient(90., stop(0.96, 0.), stop(0.88, 1.))),
        )
        .child(
            div()
                .h_full()
                .w(px(tail))
                .rounded_r(px(metric::SIDEBAR_ROW_RADIUS))
                .bg(linear_gradient(90., stop(0.88, 0.), stop(0.62, 1.))),
        )
}
/// `po-overflow-dots--vertical`: three 2px squares, 2px apart.
pub(super) fn overflow_dots(color: Rgba) -> Div {
    column()
        .gap(px(2.))
        .items_center()
        .children((0..3).map(move |_| div().size(px(2.)).bg(color)))
}

/// A deferred menu command against the shell.
type ShellAction = Box<dyn Fn(&mut Shell, &mut Window, &mut Context<Shell>)>;
impl Shell {
    // ---------------------------------------------------------------- menus
    /// `resolveVisibleCreateNewMenuItems`: the configured main entries and the
    /// Custom files submenu, with unavailable experiments removed.
    fn create_menu_items(&self, cx: &App) -> (Vec<Entry>, Vec<Entry>) {
        let prefs = &self.preferences.read(cx).state;
        let available = |e: &Entry| *e != Entry::Puppyflow || prefs.experimental.puppy_flow_files;
        let submenu: Vec<Entry> = prefs
            .create_new
            .submenu
            .iter()
            .copied()
            .filter(available)
            .collect();
        let main = prefs
            .create_new
            .main
            .iter()
            .copied()
            .filter(|e| {
                if *e == Entry::CustomFiles {
                    !submenu.is_empty()
                } else {
                    available(e)
                }
            })
            .collect();
        (main, submenu)
    }
    /// `CreateEntryGlyph` (18px file glyph in the active icon theme).
    fn create_glyph(&self, entry: Entry, cx: &App) -> AnyElement {
        let icon_theme = self.preferences.read(cx).state.file_icon_theme.clone();
        let (name, folder) = match entry {
            Entry::Folder => ("folder".to_owned(), true),
            e => (format!("x{}", e.extension()), false),
        };
        img(SharedString::from(crate::file_kind::asset_path(
            &icon_theme,
            &name,
            folder,
            self.dark,
        )))
        .size(px(18.))
        .flex_shrink_0()
        .into_any_element()
    }
    fn create_item(&self, entry: Entry, parent: PathBuf, cx: &App) -> MenuItem {
        let host = self.weak.clone();
        MenuItem::new(tr(entry.label_key()), move |w, cx| {
            let parent = parent.clone();
            let _ = host.update(cx, |s, cx| {
                s.popover = None;
                s.start_create(entry, Some(parent), w, cx)
            });
        })
        .icon_element(self.create_glyph(entry, cx))
        .disabled(!entry.available())
    }
    /// `DesktopCreateEntryMenu` rows; the Custom files row is a submenu trigger.
    fn create_entries(&self, parent: PathBuf, submenu_open: bool, cx: &App) -> Vec<MenuEntry> {
        let (main, _) = self.create_menu_items(cx);
        let mut entries = vec![MenuEntry::Item(self.create_item(
            Entry::Folder,
            parent.clone(),
            cx,
        ))];
        if !main.is_empty() {
            entries.push(MenuEntry::Separator);
        }
        let t = Theme::new(self.dark);
        for entry in main {
            if entry != Entry::CustomFiles {
                entries.push(MenuEntry::Item(self.create_item(entry, parent.clone(), cx)));
                continue;
            }
            let open = self.weak.clone();
            let hover = self.weak.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(tr("workspace.node.customFiles"), move |_, cx| {
                    let _ = open.update(cx, |s, cx| s.set_create_submenu(true, cx));
                })
                .icon("workflow")
                .open(submenu_open)
                .trailing(
                    icon_stroke("chevron-right", 14., 2., t.text_disabled)
                        .opacity(0.86)
                        .into_any_element(),
                )
                .on_hover(move |hovered, _, cx| {
                    let hovered = *hovered;
                    let _ = hover.update(cx, |s, cx| s.hover_create_submenu(hovered, cx));
                }),
            ));
        }
        entries
    }
    fn create_submenu_entries(&self, parent: PathBuf, cx: &App) -> Vec<MenuEntry> {
        let (_, submenu) = self.create_menu_items(cx);
        submenu
            .into_iter()
            .map(|entry| MenuEntry::Item(self.create_item(entry, parent.clone(), cx)))
            .collect()
    }
    /// Keeps the Custom files submenu open while the pointer is on its trigger
    /// or on the submenu, and closes it 180ms after it leaves both.
    fn hover_create_submenu(&mut self, hovered: bool, cx: &mut Context<Self>) {
        self.submenu_hover_epoch += 1;
        if hovered {
            self.set_create_submenu(true, cx);
            return;
        }
        let epoch = self.submenu_hover_epoch;
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(180))
                .await;
            let _ = this.update(cx, |s, cx| {
                if s.submenu_hover_epoch == epoch {
                    s.set_create_submenu(false, cx);
                }
            });
        })
        .detach();
    }
    pub(super) fn set_create_submenu(&mut self, open: bool, cx: &mut Context<Self>) {
        if let Some(Popover::Explorer(ExplorerMenu {
            kind: ExplorerMenuKind::Create { submenu_open, .. },
            ..
        })) = &mut self.popover
            && *submenu_open != open
        {
            *submenu_open = open;
            cx.notify();
        }
    }
    fn node_entries(&self, paths: Vec<PathBuf>, primary: PathBuf, anchor: Rect) -> Vec<MenuEntry> {
        let host = self.weak.clone();
        let count = paths.len();
        let single = count == 1;
        let folder = self.tree.is_folder(&primary);
        let ws = self.files.workspace.clone();
        let act = |f: ShellAction| {
            let host = host.clone();
            move |w: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| {
                    s.popover = None;
                    f(s, w, cx);
                    cx.notify()
                });
            }
        };
        let absolute = ws
            .as_ref()
            .and_then(|ws| ws.absolute(&primary).ok())
            .unwrap_or_default();
        let copy_text = absolute.display().to_string();
        let mut entries = vec![
            MenuEntry::Item(
                MenuItem::new(
                    tr("workspace.node.copyPath"),
                    act(Box::new(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(copy_text.clone()))
                    })),
                )
                .icon("copy"),
            ),
            MenuEntry::Separator,
        ];
        if folder {
            let parent = primary.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(
                    tr("workspace.node.newFileOrFolder"),
                    act(Box::new(move |s, _, cx| {
                        s.open_create_menu(parent.clone(), anchor, CreatePlacement::BelowStart, cx)
                    })),
                )
                .icon("folder-plus"),
            ));
            let target = primary.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(
                    tr("workspace.node.pasteIntoFolder"),
                    act(Box::new(move |s, w, cx| {
                        s.paste_into(target.clone(), w, cx)
                    })),
                )
                .icon("clipboard-paste")
                .shortcut(shortcut("V"))
                .disabled(self.clipboard.is_none()),
            ));
            entries.push(MenuEntry::Separator);
        }
        let copy_paths = paths.clone();
        entries.push(MenuEntry::Item(
            MenuItem::new(
                tf("workspace.node.copyItems", &[("count", count.into())]),
                act(Box::new(move |s, _, _| {
                    s.clipboard = Some(FileClipboard::Copy(copy_paths.clone()))
                })),
            )
            .icon("copy")
            .shortcut(shortcut("C")),
        ));
        let cut_paths = paths.clone();
        entries.push(MenuEntry::Item(
            MenuItem::new(
                tf("workspace.node.cutItems", &[("count", count.into())]),
                act(Box::new(move |s, _, _| {
                    s.clipboard = Some(FileClipboard::Cut(cut_paths.clone()))
                })),
            )
            .icon("scissors")
            .shortcut(shortcut("X")),
        ));
        let duplicate_paths = paths.clone();
        entries.push(MenuEntry::Item(
            MenuItem::new(
                tf("workspace.node.duplicateItems", &[("count", count.into())]),
                act(Box::new(move |s, w, cx| {
                    s.duplicate(duplicate_paths.clone(), w, cx)
                })),
            )
            .icon("copy-plus")
            .shortcut(shortcut("D")),
        ));
        entries.push(MenuEntry::Separator);
        if single && !folder {
            let path = absolute.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(
                    tr("workspace.node.openDefaultApp"),
                    act(Box::new(move |s, _, _| {
                        if let Err(e) = crate::platform::desktop::open(&path) {
                            s.error = Some(e)
                        }
                    })),
                )
                .icon("external-link"),
            ));
        }
        if single {
            let reveal = absolute.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(
                    tr("workspace.node.revealInFinder"),
                    act(Box::new(move |s, _, _| {
                        if let Err(e) = crate::platform::desktop::reveal(&reveal) {
                            s.error = Some(e)
                        }
                    })),
                )
                .icon("folder-open"),
            ));
            let path = primary.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(
                    tr("workspace.node.rename"),
                    act(Box::new(move |s, w, cx| {
                        s.begin_rename(path.clone(), false, w, cx)
                    })),
                )
                .icon("pencil"),
            ));
        }
        if single && !folder {
            let path = primary.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(
                    tr("workspace.node.changeType"),
                    act(Box::new(move |s, w, cx| {
                        s.begin_rename(path.clone(), true, w, cx)
                    })),
                )
                .icon("file-text"),
            ));
        }
        let delete_paths = paths;
        entries.push(MenuEntry::Item(
            MenuItem::new(
                tf("workspace.node.deleteItems", &[("count", count.into())]),
                act(Box::new(move |s, w, cx| {
                    s.confirm_delete(delete_paths.clone(), w, cx)
                })),
            )
            .danger()
            .icon("trash-2"),
        ));
        entries
    }
    fn viewport(&self) -> (f32, f32) {
        (self.layout.header.w, self.layout.editor.bottom())
    }
    /// `DesktopNodeActionMenu` / `DesktopCreateEntryMenu` placement, recomputed
    /// every frame like the product's render-time position.
    pub(super) fn explorer_menu_frame(&self, menu: &ExplorerMenu, cx: &App) -> ExplorerMenuFrame {
        let t = Theme::new(self.dark);
        let count = |entries: &[MenuEntry]| {
            entries
                .iter()
                .fold((0, 0), |(items, separators), e| match e {
                    MenuEntry::Separator => (items, separators + 1),
                    _ => (items + 1, separators),
                })
        };
        match &menu.kind {
            ExplorerMenuKind::Node { paths, primary } => {
                let style = MenuStyle::sidebar_action(t);
                let (items, separators) =
                    count(&self.node_entries(paths.clone(), primary.clone(), menu.anchor));
                let (left, top) = menu_position::sidebar_action_menu_origin(
                    menu.anchor,
                    menu_position::NODE_ACTION_MENU_WIDTH,
                    style.estimated_height(items, separators),
                    self.viewport(),
                );
                ExplorerMenuFrame {
                    menu: Rect::new(
                        left,
                        top,
                        menu_position::NODE_ACTION_MENU_WIDTH,
                        style.outer_height(items, separators),
                    ),
                    style,
                    submenu: None,
                }
            }
            ExplorerMenuKind::Create {
                placement,
                submenu_open,
                ..
            } => {
                let style = if menu.sidebar_launcher() {
                    MenuStyle::sidebar_launcher(t)
                } else {
                    MenuStyle::surface(t)
                };
                let (main, submenu) = self.create_menu_items(cx);
                let (items, separators) = (1 + main.len(), usize::from(!main.is_empty()));
                let width = menu_position::create_menu_width(menu.anchor, *placement);
                let (left, top) = menu_position::create_menu_origin(
                    menu.anchor,
                    *placement,
                    width,
                    style.estimated_height(items, separators),
                    self.viewport(),
                );
                let frame = Rect::new(left, top, width, style.outer_height(items, separators));
                let submenu = main
                    .iter()
                    .position(|e| *e == Entry::CustomFiles)
                    .filter(|_| *submenu_open)
                    .map(|index| {
                        // `.desktop-create-entry-submenu`: `top: -4px` and
                        // `inset-inline-start: calc(100% + 4px)` of its row.
                        let separators = if style.hide_separators { 0. } else { 1. };
                        let row_y = top
                            + 1.
                            + style.padding
                            + (1 + index) as f32 * style.item_height
                            + separators * metric::MENU_SEPARATOR_BLOCK;
                        let row_left = left + 1. + style.padding;
                        let row_right = left + width - 1. - style.padding;
                        let x = if menu_position::create_submenu_opens_at_end(
                            left,
                            width,
                            self.viewport().0,
                        ) {
                            row_right + menu_position::CREATE_ENTRY_SUBMENU_GAP
                        } else {
                            row_left
                                - menu_position::CREATE_ENTRY_SUBMENU_GAP
                                - menu_position::CREATE_ENTRY_SUBMENU_WIDTH
                        };
                        Rect::new(
                            x,
                            row_y - 4.,
                            menu_position::CREATE_ENTRY_SUBMENU_WIDTH,
                            style.outer_height(submenu.len(), 0),
                        )
                    });
                ExplorerMenuFrame {
                    menu: frame,
                    style,
                    submenu,
                }
            }
        }
    }
    /// `openCreateEntryMenu`.
    pub(super) fn open_create_menu(
        &mut self,
        parent: PathBuf,
        anchor: Rect,
        placement: CreatePlacement,
        cx: &mut Context<Self>,
    ) {
        if self.files.workspace.is_none() {
            return;
        }
        self.popover = Some(Popover::Explorer(ExplorerMenu {
            anchor,
            kind: ExplorerMenuKind::Create {
                parent,
                placement,
                submenu_open: false,
            },
            launcher: None,
        }));
        cx.notify();
    }
    /// `openNodeActionMenu`: the menu acts on the selection when the row is
    /// part of it, otherwise on the row alone. A right click also selects the
    /// row (`onContextMenu`); the "⋮" trigger leaves the selection alone.
    pub(super) fn open_node_menu(
        &mut self,
        index: usize,
        anchor: Rect,
        select: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(row) = self.tree.rows.get(index).cloned() else {
            return;
        };
        let in_selection = self.tree.selection.contains(&row.path);
        if select && !in_selection {
            self.tree.select(&row.path, false, false);
        }
        let paths = if in_selection || select {
            self.tree.selected_roots()
        } else {
            vec![row.path.clone()]
        };
        self.popover = Some(Popover::Explorer(ExplorerMenu {
            anchor,
            kind: ExplorerMenuKind::Node {
                paths,
                primary: row.path.clone(),
            },
            launcher: Some(row.path),
        }));
        cx.notify();
    }
    /// The row's own trigger rectangle (falls back to the pointer).
    fn row_trigger_anchor(&self, path: &Path, trigger: RowTrigger, pointer: Point<Pixels>) -> Rect {
        self.row_anchors
            .row(path)
            .map(|row| row_action_rect(row, trigger))
            .unwrap_or_else(|| {
                menu_position::point_anchor(f32::from(pointer.x), f32::from(pointer.y))
            })
    }
    /// `sidebarCreateMenuOpen` toggle of the list-end "New" row.
    fn toggle_new_row_menu(&mut self, pointer: Point<Pixels>, cx: &mut Context<Self>) {
        let open = self
            .popover
            .as_ref()
            .is_some_and(|p| matches!(p, Popover::Explorer(m) if m.sidebar_launcher()));
        if open {
            self.popover = None;
            cx.notify();
            return;
        }
        let anchor = self.row_anchors.new_row().unwrap_or_else(|| {
            menu_position::point_anchor(f32::from(pointer.x), f32::from(pointer.y))
        });
        self.open_create_menu(PathBuf::new(), anchor, CreatePlacement::AutoEnd, cx);
    }
    pub(super) fn explorer_popup(&self, menu: &ExplorerMenu, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let frame = self.explorer_menu_frame(menu, cx);
        let (entries, submenu) = match &menu.kind {
            ExplorerMenuKind::Create {
                parent,
                submenu_open,
                ..
            } => (
                self.create_entries(parent.clone(), *submenu_open, cx),
                frame
                    .submenu
                    .map(|_| self.create_submenu_entries(parent.clone(), cx)),
            ),
            ExplorerMenuKind::Node { paths, primary } => (
                self.node_entries(paths.clone(), primary.clone(), menu.anchor),
                None,
            ),
        };
        let (_, vh) = self.viewport();
        let trigger = menu.anchor;
        let submenu_rect = frame.submenu;
        let main = frame.menu;
        let mut layer = div().absolute().size_full().child(
            div()
                .absolute()
                .left(px(main.x))
                .top(px(main.y))
                .w(px(main.w))
                .max_h(px(vh - 24.))
                .child(
                    menu_surface_styled("explorer-menu", entries, frame.style, t)
                        .w_full()
                        .max_h(px(vh - 24.)),
                )
                .on_mouse_down_out(cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                    // `data-desktop-sidebar-menu-trigger` hands off to its own
                    // click; the submenu is part of this menu.
                    let p = (f32::from(e.position.x), f32::from(e.position.y));
                    if trigger.contains(p) || submenu_rect.is_some_and(|r| r.contains(p)) {
                        return;
                    }
                    s.popover = None;
                    cx.notify();
                })),
        );
        if let (Some(rect), Some(entries)) = (frame.submenu, submenu) {
            let hover = self.weak.clone();
            layer = layer.child(
                div()
                    .id("explorer-submenu-host")
                    .absolute()
                    .left(px(rect.x))
                    .top(px(rect.y))
                    .w(px(rect.w))
                    .on_hover(move |hovered, _, cx| {
                        let hovered = *hovered;
                        let _ = hover.update(cx, |s, cx| s.hover_create_submenu(hovered, cx));
                    })
                    .child(
                        menu_surface_styled("explorer-submenu", entries, frame.style, t)
                            .w_full()
                            .max_h(px(vh - 24.)),
                    ),
            );
        }
        layer
    }

    // ----------------------------------------------------------- operations
    pub(super) fn run_op(&mut self, op: FileOp, window: &mut Window, cx: &mut Context<Self>) {
        let Some(ws) = self.files.workspace.clone() else {
            return;
        };
        if self.file_op.is_some() {
            return;
        }
        let touched = op.touched();
        if let Some(doc) = &self.files.document
            && touched.iter().any(|p| doc.relative.starts_with(p))
        {
            // Drain autosave and close first; resume when the document is gone.
            self.reopen = Some(doc.relative.clone());
            self.queued_op = Some(op);
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
        self.file_op = Some(rx);
        cx.notify();
    }
    /// Called from `receive`: resume queued operations and apply results.
    pub(super) fn poll_file_ops(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.file_op.is_none()
            && self.files.document.is_none()
            && !self.files.busy()
            && let Some(op) = self.queued_op.take()
        {
            self.run_op(op, window, cx);
        }
        let Some(outcome) = self.file_op.as_ref().and_then(|rx| rx.try_recv().ok()) else {
            return;
        };
        self.file_op = None;
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
        if let Some(old) = self.reopen.take() {
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
        match self.clipboard.clone() {
            Some(FileClipboard::Copy(paths)) => {
                self.run_op(FileOp::Copy(paths, target), window, cx)
            }
            Some(FileClipboard::Cut(paths)) => {
                self.clipboard = None;
                self.run_op(FileOp::Move(paths, target), window, cx)
            }
            None => {}
        }
    }
    fn duplicate(&mut self, paths: Vec<PathBuf>, window: &mut Window, cx: &mut Context<Self>) {
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
    fn confirm_delete(&mut self, paths: Vec<PathBuf>, window: &mut Window, cx: &mut Context<Self>) {
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
    /// `DesktopNodeRenameDialog`; `change_type` opens it as "Change file type"
    /// (`renameFocus: "type"`), where the extension is part of the name.
    fn begin_rename(
        &mut self,
        path: PathBuf,
        change_type: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.rename_type = change_type;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let input = cx.new(|cx| {
            let mut input = ui::form_input::TextInput::new("", false, 255, window, cx);
            input.submit_on_enter = true;
            input.set_text(name, cx);
            input
        });
        cx.subscribe_in(&input, window, |s, _, event, w, cx| {
            if matches!(event, ui::form_input::InputEvent::Submit) {
                s.submit_rename(w, cx)
            }
        })
        .detach();
        input.read(cx).focus_handle(cx).focus(window, cx);
        self.rename = Some((path, input));
        cx.notify();
    }
    pub(super) fn submit_rename(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((path, input)) = self.rename.take() else {
            return;
        };
        let name = input.read(cx).text().trim().to_owned();
        if name.is_empty() {
            self.error = Some(tr("workspace.node.error.nameRequired").into());
        } else if name == "." || name == ".." || name.contains(['/', '\\']) {
            self.error = Some(tr("workspace.node.error.nameInvalid").into());
        } else {
            self.run_op(FileOp::Rename { path, name }, window, cx);
        }
        self.focus.focus(window, cx);
        cx.notify();
    }
    pub(super) fn rename_view(
        &self,
        w: f32,
        h: f32,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let t = Theme::new(self.dark);
        let (_, input) = self.rename.as_ref().unwrap();
        input.update(cx, |i, _| i.dark = self.dark);
        let width = (w - 64.).clamp(280., 400.);
        let height = 196.;
        self.dialog_host(cx).popup(
            self.modal_card(Rect::new(
                (w - width) / 2.,
                (h - height) / 2.,
                width,
                height,
            ))
            .child(
                column()
                    .p(px(20.))
                    .gap(px(14.))
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.title))
                            .font_weight(FontWeight::MEDIUM)
                            .child(tr(if self.rename_type {
                                "workspace.node.changeType"
                            } else {
                                "workspace.node.rename"
                            })),
                    )
                    .child(
                        column()
                            .gap(px(6.))
                            .child(
                                div()
                                    .text_size(px(theme::ty().ui.meta))
                                    .text_color(t.subtle)
                                    .child(tr("workspace.node.name")),
                            )
                            .child(input.clone()),
                    )
                    .child(
                        row()
                            .justify_end()
                            .gap(px(6.))
                            .child(
                                ui::action_button(
                                    "cancel-rename",
                                    tr("common.action.cancel"),
                                    None,
                                    ui::Tone::Default,
                                    false,
                                    t,
                                )
                                .on_click(cx.listener(
                                    |s, _, w, cx| {
                                        s.rename = None;
                                        s.focus.focus(w, cx);
                                        cx.notify()
                                    },
                                )),
                            )
                            .child(
                                ui::action_button(
                                    "save-rename",
                                    tr("common.action.save"),
                                    None,
                                    ui::Tone::Primary,
                                    false,
                                    t,
                                )
                                .on_click(cx.listener(|s, _, w, cx| s.submit_rename(w, cx))),
                            ),
                    ),
            ),
        )
    }

    // ------------------------------------------------------------ selection
    fn click_row(
        &mut self,
        index: usize,
        modifiers: Modifiers,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(row) = self.tree.rows.get(index).cloned() else {
            return;
        };
        self.explorer_focus.focus(window, cx);
        if modifiers.platform || modifiers.shift {
            self.tree
                .select(&row.path, modifiers.platform, modifiers.shift);
            cx.notify();
            return;
        }
        self.tree.select(&row.path, false, false);
        self.open_row(index, window, cx);
    }
    fn explorer_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        let primary = event.keystroke.modifiers.platform;
        let current = self.tree.index_of(&self.tree.selected);
        let len = self.tree.rows.len();
        if len == 0 {
            return;
        }
        let go = |s: &mut Shell, index: usize, w: &mut Window, cx: &mut Context<Shell>| {
            s.tree
                .select(&s.tree.rows[index].path.clone(), false, false);
            s.scroll.scroll_to_item(index, ScrollStrategy::Center);
            if !s.tree.rows[index].folder {
                s.open_row(index, w, cx);
            }
            cx.notify();
        };
        match (key, primary) {
            ("down", false) => go(
                self,
                current.map_or(0, |i| (i + 1).min(len - 1)),
                window,
                cx,
            ),
            ("up", false) => go(self, current.map_or(0, |i| i.saturating_sub(1)), window, cx),
            ("home", false) => go(self, 0, window, cx),
            ("end", false) => go(self, len - 1, window, cx),
            ("right", false) => {
                if let Some(i) = current {
                    let row = self.tree.rows[i].clone();
                    if row.folder && !row.expanded {
                        if self.tree.set_expanded(&row.path, true) {
                            self.files.load_children(row.path, &self.wake);
                        }
                        cx.notify();
                    } else if i + 1 < len {
                        go(self, i + 1, window, cx)
                    }
                }
            }
            ("left", false) => {
                if let Some(i) = current {
                    let row = self.tree.rows[i].clone();
                    if row.folder && row.expanded {
                        self.tree.set_expanded(&row.path, false);
                        cx.notify();
                    } else if let Some(parent) = self.tree.index_of(&parent_of(&row.path)) {
                        go(self, parent, window, cx)
                    }
                }
            }
            ("enter", false) => {
                if let Some(i) = current {
                    self.open_row(i, window, cx)
                }
            }
            ("c", true) => {
                self.clipboard = Some(FileClipboard::Copy(self.tree.selected_roots()));
            }
            ("x", true) => {
                self.clipboard = Some(FileClipboard::Cut(self.tree.selected_roots()));
                cx.notify();
            }
            ("v", true) => {
                let target = current
                    .map(|i| {
                        let r = &self.tree.rows[i];
                        if r.folder {
                            r.path.clone()
                        } else {
                            parent_of(&r.path)
                        }
                    })
                    .unwrap_or_default();
                self.paste_into(target, window, cx)
            }
            ("d", true) => self.duplicate(self.tree.selected_roots(), window, cx),
            ("backspace", true) | ("delete", true) => {
                self.confirm_delete(self.tree.selected_roots(), window, cx)
            }
            _ => return,
        }
        cx.stop_propagation();
    }

    // ------------------------------------------------------------- render
    fn explorer_row(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let t = Theme::new(self.dark);
        let Some(item) = self.tree.rows.get(index).cloned() else {
            return self.list_end_row(cx);
        };
        let icon_theme = self.preferences.read(cx).state.file_icon_theme.clone();
        let width = self.layout.explorer.w - 2. * metric::SIDEBAR_ROW_LEFT_GAP;
        let depth = (item.depth as f32 * metric::TREE_INDENT).min((width - 64.).max(0.));
        let active = self.tree.selected == item.path;
        let selected = active || self.tree.selection.contains(&item.path);
        // `data-action-menu-open` and the trigger that owns it.
        let trigger = match &self.popover {
            Some(Popover::Explorer(menu)) => menu.row_trigger(&item.path),
            _ => None,
        };
        let open = trigger.is_some();
        let cut = matches!(&self.clipboard, Some(FileClipboard::Cut(p)) if p.contains(&item.path));
        // `.tree-row` colour: sidebar text, raised to text when hovered,
        // selected, active or holding an open menu.
        let lit = selected || open;
        let fg = if lit { t.text } else { t.sidebar_text };
        let group = SharedString::from(format!("tree-row-{index}"));
        let drag_paths = if self.tree.selection.contains(&item.path) {
            self.tree.selected_roots()
        } else {
            vec![item.path.clone()]
        };
        let drop_target = if item.folder {
            item.path.clone()
        } else {
            parent_of(&item.path)
        };
        let import_target = drop_target.clone();
        // `TreeDisclosureMarker` (12px, stroke 1.6, opacity .82) or the 18px file glyph.
        let glyph: AnyElement = if item.folder {
            icon_sized(
                if item.expanded {
                    "tree-disclosure-open"
                } else {
                    "tree-disclosure"
                },
                12.,
                fg,
            )
            .opacity(0.82)
            .group_hover(group.clone(), move |s| s.text_color(t.text))
            .into_any_element()
        } else {
            img(SharedString::from(crate::file_kind::asset_path(
                &icon_theme,
                &item.name,
                false,
                self.dark,
            )))
            .size(px(18.))
            .flex_shrink_0()
            .into_any_element()
        };
        // `.tree-row-actions`: absolutely placed 4px from the end, revealed by
        // hover or by an open menu (`[data-action-menu-open]`).
        let action = |id: (&'static str, usize), expanded: bool| {
            gpui_kit::base::Button::new(id)
                .flex()
                .items_center()
                .justify_center()
                .flex_shrink_0()
                .size(px(metric::TREE_ROW_ACTION_SIZE))
                .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
                .text_color(if expanded { t.text } else { t.muted })
                .cursor(theme::clickable_cursor())
                .when(expanded, |b| b.bg(t.control_hover))
                .hover(move |s| s.bg(t.control_hover).text_color(t.text))
        };
        let mut actions = row()
            .absolute()
            .top_0()
            .bottom_0()
            .right(px(metric::TREE_ROW_ACTION_INSET))
            .gap(px(metric::TREE_ROW_ACTION_GAP))
            .when(!open, |d| {
                d.invisible().group_hover(group.clone(), |s| s.visible())
            });
        let action_count = if item.folder { 2 } else { 1 };
        if item.folder {
            let parent = item.path.clone();
            let expanded = trigger == Some(RowTrigger::Create);
            let plus_group = SharedString::from(format!("tree-row-create-{index}"));
            actions = actions.child(
                action(("row-create", index), expanded)
                    .group(plus_group.clone())
                    .accessibility_label(tr("workspace.node.createNew"))
                    .tooltip(tooltip(tr("workspace.node.createNew")))
                    .child(
                        icon_stroke(
                            "plus",
                            metric::TREE_ROW_ACTION_ICON,
                            2.,
                            if expanded { t.text } else { t.muted },
                        )
                        .group_hover(plus_group, move |s| s.text_color(t.text)),
                    )
                    .on_click(cx.listener(move |s, e: &ClickEvent, _, cx| {
                        cx.stop_propagation();
                        let anchor =
                            s.row_trigger_anchor(&parent, RowTrigger::Create, e.position());
                        s.open_create_menu(parent.clone(), anchor, CreatePlacement::BelowStart, cx)
                    })),
            );
        }
        let more = tf(
            "workspace.node.moreActionsFor",
            &[("name", item.name.clone().into())],
        );
        let more_open = trigger == Some(RowTrigger::More);
        let more_group = SharedString::from(format!("tree-row-more-{index}"));
        let more_path = item.path.clone();
        actions = actions.child(
            action(("row-more", index), more_open)
                .group(more_group.clone())
                .accessibility_label(more.clone())
                .tooltip(tooltip(tr("workspace.node.moreActions")))
                .child(
                    div()
                        .text_color(if more_open { t.text } else { t.muted })
                        .group_hover(more_group, move |s| s.text_color(t.text))
                        .child(overflow_dots(if more_open { t.text } else { t.muted })),
                )
                .on_click(cx.listener(move |s, e: &ClickEvent, _, cx| {
                    cx.stop_propagation();
                    let anchor = s.row_trigger_anchor(&more_path, RowTrigger::More, e.position());
                    s.open_node_menu(index, anchor, false, cx)
                })),
        );
        // `--tree-row-action-reserve`: the content's end padding while the
        // actions show (one button 32px, two 56px).
        let reserve = if action_count == 2 { 56. } else { 32. };
        let label = row()
            .flex_1()
            .min_w_0()
            .items_baseline()
            .gap(px(5.))
            .child(div().min_w_0().truncate().child(item.display.clone()))
            .children(item.extension.clone().map(|ext| {
                // `.tree-label-extension` with its `· ` prefix.
                div()
                    .flex_shrink_0()
                    .text_size(px(theme::ty().left.meta))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.subtle)
                    .child(format!("· {ext}"))
            }));
        let guides = (0..item
            .depth
            .min(((width - 40.).max(0.) / metric::TREE_INDENT) as usize))
            .map(|level| {
                div()
                    .absolute()
                    .top(px(-1.))
                    .bottom(px(-1.))
                    .left(px(metric::TREE_ROW_CONTENT_LEFT
                        + metric::SIDEBAR_ICON_SLOT / 2.
                        + level as f32 * metric::TREE_INDENT))
                    .w(px(1.))
                    .bg(t.guide)
            });
        let dark = self.dark;
        let drag_label: SharedString = if drag_paths.len() > 1 {
            tf(
                "workspace.node.copyItems",
                &[("count", drag_paths.len().into())],
            )
            .into()
        } else {
            item.name.clone().into()
        };
        // `--tree-row-hover-bg` (hover at 86%); selected and active rows rest on
        // it and take `--tree-row-selected-bg` when hovered or holding a menu.
        let resting_bg = theme::alpha(t.hover, 0.86);
        let row_width = width;
        let inner =
            row()
                .id(("tree-row", index))
                .group(group.clone())
                .relative()
                .w_full()
                .h(px(theme::control()))
                .my(px(1.))
                .pl(px(metric::TREE_ROW_CONTENT_LEFT + depth))
                .pr(px(if open {
                    reserve
                } else {
                    metric::SIDEBAR_ROW_CONTENT_RIGHT
                }))
                .gap(px(metric::TREE_ROW_ICON_LABEL_GAP))
                .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                .text_size(px(theme::ty().left.content))
                .line_height(px(theme::ty().left.line_height))
                .font_weight(FontWeight::NORMAL)
                .text_color(fg)
                .cursor(theme::clickable_cursor())
                .map(|d| {
                    if selected {
                        // Resting backplate, replaced by the gradient on hover.
                        d.child(
                            div()
                                .absolute()
                                .size_full()
                                .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                                .bg(resting_bg)
                                .when(open, |d| d.invisible())
                                .group_hover(group.clone(), |s| s.invisible()),
                        )
                        .child(
                            selected_row_gradient(row_width, t).when(!open, |d| {
                                d.invisible().group_hover(group.clone(), |s| s.visible())
                            }),
                        )
                    } else if open {
                        // `--po-menu-trigger-row-open-background`.
                        d.bg(t.hover)
                    } else {
                        d
                    }
                })
                .hover(move |s| {
                    let s = s.text_color(t.text).pr(px(reserve));
                    if selected || open {
                        s
                    } else {
                        s.bg(resting_bg)
                    }
                })
                .children(guides)
                .child(
                    div()
                        .size(px(metric::SIDEBAR_ICON_SLOT))
                        .flex_shrink_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .when(cut, |d| d.opacity(0.48))
                        .child(glyph),
                )
                .child(label.when(cut, |d| d.opacity(0.48)))
                .children(item.error.clone().map(|error| {
                    let retry = item.path.clone();
                    row()
                        .flex_shrink(1.)
                        .min_w_0()
                        .gap(px(6.))
                        .text_size(px(theme::ty().left.meta))
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .text_color(t.danger)
                                .child(SharedString::from(error)),
                        )
                        .child(
                            div()
                                .id(("tree-row-retry", index))
                                .flex_shrink_0()
                                .px(px(4.))
                                .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                                .text_color(t.text)
                                .hover(move |d| d.bg(t.hover))
                                .cursor(theme::clickable_cursor())
                                .child(tr("common.action.retry"))
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    cx.stop_propagation();
                                    if s.tree.set_expanded(&retry, true) {
                                        s.files.load_children(retry.clone(), &s.wake);
                                    }
                                    cx.notify();
                                })),
                        )
                }))
                .child(actions)
                .on_click(cx.listener(move |s, e: &ClickEvent, w, cx| {
                    s.click_row(index, e.modifiers(), w, cx)
                }))
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        // `getContextMenuAnchorRect`: the pointer.
                        let anchor = menu_position::point_anchor(
                            f32::from(e.position.x),
                            f32::from(e.position.y),
                        );
                        s.open_node_menu(index, anchor, true, cx)
                    }),
                )
                .on_drag(
                    DragNodes {
                        paths: drag_paths,
                        label: drag_label,
                        dark,
                    },
                    |drag, _, _, cx| cx.new(|_| drag.clone()),
                )
                .drag_over::<DragNodes>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.18)))
                .drag_over::<ExternalPaths>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.18)))
                .on_drop(cx.listener(move |s, drag: &DragNodes, w, cx| {
                    let paths: Vec<PathBuf> = drag
                        .paths
                        .iter()
                        .filter(|p| !drop_target.starts_with(p) && parent_of(p) != drop_target)
                        .cloned()
                        .collect();
                    if !paths.is_empty() {
                        s.run_op(FileOp::Move(paths, drop_target.clone()), w, cx)
                    }
                }))
                .on_drop(cx.listener(move |s, paths: &ExternalPaths, w, cx| {
                    s.run_op(
                        FileOp::Import(paths.paths().to_vec(), import_target.clone()),
                        w,
                        cx,
                    )
                }));
        div()
            .relative()
            .h(px(theme::sidebar_stride()))
            .w_full()
            .child(self.row_anchors.measure_row(item.path.clone()))
            .child(inner)
            .into_any_element()
    }
    /// `desktop-explorer-list-end-create`: the "New" tree row after the last
    /// item. Its command text is quieter than a file row
    /// (`mix(subtle 68%, sidebar)`, UI meta size), lifts to subtle on hover and
    /// to text while its menu is open.
    fn list_end_row(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = Theme::new(self.dark);
        let open = matches!(
            &self.popover,
            Some(Popover::Explorer(menu)) if matches!(menu.kind, ExplorerMenuKind::Create {
                placement: CreatePlacement::AutoEnd,
                ..
            })
        );
        let enabled = self.files.workspace.is_some() && self.preferences.read(cx).loaded;
        let quiet = theme::mix(t.subtle, t.sidebar, 0.68);
        let fg = if open { t.text } else { quiet };
        let hover_fg = if open { t.text } else { t.subtle };
        let group = SharedString::from("explorer-new");
        div()
            .relative()
            .h(px(theme::sidebar_stride()))
            .w_full()
            .child(self.row_anchors.measure_new_row())
            .child(
                row()
                    .id("explorer-new")
                    .group(group.clone())
                    .relative()
                    .w_full()
                    .h(px(theme::control()))
                    .my(px(1.))
                    .pl(px(metric::TREE_ROW_CONTENT_LEFT))
                    .pr(px(metric::SIDEBAR_ROW_CONTENT_RIGHT))
                    .gap(px(metric::TREE_ROW_ICON_LABEL_GAP))
                    .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                    .text_size(px(theme::ty().ui.meta))
                    .line_height(px(theme::ty().left.line_height))
                    .font_weight(FontWeight::NORMAL)
                    .text_color(fg)
                    .when(enabled, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(move |s| s.bg(theme::alpha(t.hover, 0.86)).text_color(hover_fg))
                            .on_click(cx.listener(|s, e: &ClickEvent, _, cx| {
                                s.toggle_new_row_menu(e.position(), cx)
                            }))
                    })
                    .when(!enabled, |d| d.opacity(0.5))
                    .child(
                        div()
                            .size(px(metric::SIDEBAR_ICON_SLOT))
                            .flex()
                            .flex_shrink_0()
                            .items_center()
                            .justify_center()
                            .opacity(0.76)
                            .child(
                                icon_stroke("plus", 14., 2.2, fg)
                                    .group_hover(group, move |s| s.text_color(hover_fg)),
                            ),
                    )
                    .child(tr("workspace.explorer.new")),
            )
            .into_any_element()
    }
    pub(super) fn explorer(&self, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let loading = self.tree.rows.is_empty() && (self.files.folder_busy || self.pending);
        let empty = self.tree.rows.is_empty() && !loading && self.files.workspace.is_some();
        let mut column_el = at(self.layout.explorer).flex().flex_col().bg(t.sidebar);
        if loading || empty {
            column_el = column_el.child(
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
            );
        }
        let count =
            self.tree.rows.len() + usize::from(self.files.workspace.is_some() || self.fixture);
        let column_el = column_el.child(
            div()
                .id("explorer-tree")
                .flex_1()
                .min_h_0()
                .track_focus(&self.explorer_focus)
                .key_context("Explorer")
                .on_key_down(cx.listener(|s, e: &KeyDownEvent, w, cx| s.explorer_key(e, w, cx)))
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(|s, e: &MouseDownEvent, _, cx| {
                        // `onExplorerRootContextMenu`: create at the pointer.
                        let anchor = menu_position::point_anchor(
                            f32::from(e.position.x),
                            f32::from(e.position.y),
                        );
                        s.open_create_menu(PathBuf::new(), anchor, CreatePlacement::BelowStart, cx)
                    }),
                )
                .drag_over::<DragNodes>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.05)))
                .drag_over::<ExternalPaths>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.05)))
                .on_drop(cx.listener(|s, drag: &DragNodes, w, cx| {
                    let paths: Vec<PathBuf> = drag
                        .paths
                        .iter()
                        .filter(|p| !parent_of(p).as_os_str().is_empty())
                        .cloned()
                        .collect();
                    if !paths.is_empty() {
                        s.run_op(FileOp::Move(paths, PathBuf::new()), w, cx)
                    }
                }))
                .on_drop(cx.listener(|s, paths: &ExternalPaths, w, cx| {
                    s.run_op(
                        FileOp::Import(paths.paths().to_vec(), PathBuf::new()),
                        w,
                        cx,
                    )
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
                            range
                                .map(|index| s.explorer_row(index, cx))
                                .collect::<Vec<_>>()
                        }),
                    )
                    .size_full()
                    .pt(px(12.))
                    .pb(px(6.))
                    .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
                    .track_scroll(&self.scroll),
                ),
        );
        column_el.child(self.tree_bottom_fade(t))
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
    /// `DesktopSidebarFooterNavigation` as the workspace sidebar mounts it:
    /// Settings, then the Help launcher (`DesktopHelpLauncher`) in the utility
    /// slot. The product removes the Git surface from the footer
    /// (`useWorkspaceSurfaceContent` filters `git`); Changes lives in the Header.
    /// With the navigation at the bottom the footer has no divider
    /// (`--data-explorer-footer-divider-width: 0px`).
    pub(super) fn footer(&self, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        // `.desktop-sidebar-footer-button[data-navigation-item="settings"]` and
        // `.desktop-help-launcher`: compact square, 14px icon at stroke 1.65 in
        // the utility colour; hover and open states raise the icon to text.
        let utility = |id: &'static str, icon: &'static str, label: String, active: bool| {
            let group = SharedString::from(format!("footer-{id}"));
            gpui_kit::base::Button::new(id)
                .group(group.clone())
                .accessibility_label(label.clone())
                .selected(active)
                .flex()
                .flex_shrink_0()
                .items_center()
                .justify_center()
                .size(px(theme::control_compact()))
                .rounded(px(metric::CONTROL_RADIUS))
                .cursor(theme::clickable_cursor())
                .when(active, |b| b.bg(t.selected))
                .when(!active, |b| b.hover(move |s| s.bg(t.hover)))
                .tooltip(tooltip(label))
                .child(
                    icon_sized(
                        icon,
                        metric::SIDEBAR_UTILITY_ICON,
                        if active { t.text } else { t.sidebar_utility },
                    )
                    .group_hover(group, move |s| s.text_color(t.text)),
                )
        };
        at(self.layout.footer)
            .bg(t.sidebar)
            .flex()
            .items_center()
            .justify_between()
            .py(px(metric::SIDEBAR_NAVIGATION_PADDING_BALANCED))
            .px(px(metric::SIDEBAR_NAVIGATION_PADDING_INLINE))
            .gap(px(metric::SIDEBAR_NAV_GAP))
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .gap(px(metric::SIDEBAR_NAV_GAP))
                    .child(
                        utility(
                            "settings",
                            "settings-compact",
                            tr("shell.navigation.settings").into(),
                            self.settings,
                        )
                        .on_click(cx.listener(|s, _, w, cx| s.command(Command::Settings, w, cx))),
                    )
                    .child(
                        utility(
                            "feedback",
                            "feedback-help",
                            tr("shell.feedback.label").into(),
                            self.help,
                        )
                        .on_click(cx.listener(|s, _, w, cx| s.command(Command::Feedback, w, cx))),
                    ),
            )
            // Native-only progress cue until file-operation notices are ported
            // (the product shows them in `FloatingNoticeStack`).
            .when(
                self.pending
                    || self.files.busy()
                    || self.files.folder_busy
                    || self.file_op.is_some(),
                |d| {
                    let preset = self.preferences.read(cx).state.loading_animation.clone();
                    d.child(ui::pulse_grid::pulse_grid(
                        "footer-busy",
                        &preset,
                        ui::pulse_grid::PulseSize::Sm,
                        t.subtle,
                    ))
                },
            )
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
