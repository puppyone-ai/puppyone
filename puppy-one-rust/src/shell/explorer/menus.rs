//! Explorer menus: `DesktopCreateEntryMenu` (new file or folder, with the
//! Custom files submenu) and `DesktopNodeActionMenu` (copy path, clipboard,
//! duplicate, reveal, rename, delete).
//!
//! GPUI Kit places, layers and dismisses them: a row's "+" / "⋮" and the
//! list-end "New" row own a [`PopoverMenu`], a right click opens an
//! [`AnchoredMenu`] at the pointer. The shell holds which one is open.
use super::*;
use crate::{
    features::create_new::create_entry_menu_registry::Entry,
    localization::tf,
    ui::components::{AnchoredMenu, FileIcon, Icon, Menu, MenuItem, MenuVariant, PopoverMenu},
};
use gpui_kit::{base::Selectable, component::Sizable as _};

/// `CREATE_ENTRY_MENU_WIDTH` (the Custom files submenu is as wide).
const CREATE_MENU_WIDTH: f32 = 184.;
/// `NODE_ACTION_MENU_WIDTH`.
const NODE_MENU_WIDTH: f32 = 224.;
/// `SIDEBAR_ACTION_MENU_GAP` / the 6px gap of `getCreateEntryMenuPosition`.
const NODE_MENU_GAP: f32 = 4.;
const CREATE_MENU_GAP: f32 = 6.;

/// A row's menu trigger (`explorerOpenActionMenu.trigger`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowTrigger {
    /// The folder row's "+".
    Create,
    /// The row's "⋮".
    More,
}
/// Where an open menu hangs.
#[derive(Clone, Debug, PartialEq)]
pub enum MenuAt {
    /// Below a row's "+" or "⋮".
    Row(PathBuf, RowTrigger),
    /// Below the list-end "New" row, end aligned.
    NewRow,
    /// A context menu at the pointer.
    Pointer(Point<Pixels>),
}
#[derive(Clone, Debug, PartialEq)]
pub enum MenuKind {
    /// Create in a parent folder (`""` is the workspace root).
    Create { parent: PathBuf },
    /// Act on the selection; `primary` is the row the menu was opened from.
    Node {
        paths: Vec<PathBuf>,
        primary: PathBuf,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub struct ExplorerMenu {
    pub kind: MenuKind,
    pub at: MenuAt,
    /// The Custom files submenu opens without a hover.
    pub submenu_open: bool,
}
impl ExplorerMenu {
    /// Which trigger of `path`'s row the menu lights (`data-action-menu-open`):
    /// its own, or for a context menu the one it stands in for.
    pub fn row_trigger(&self, path: &Path) -> Option<RowTrigger> {
        match (&self.at, &self.kind) {
            (MenuAt::Row(row, trigger), _) => (row == path).then_some(*trigger),
            (MenuAt::Pointer(_), MenuKind::Node { primary, .. }) => {
                (primary == path).then_some(RowTrigger::More)
            }
            (MenuAt::Pointer(_), MenuKind::Create { parent }) => {
                (parent == path).then_some(RowTrigger::Create)
            }
            (MenuAt::NewRow, _) => None,
        }
    }
    fn variant(&self) -> MenuVariant {
        match (&self.at, &self.kind) {
            (MenuAt::NewRow, _) => MenuVariant::SidebarLauncher,
            (_, MenuKind::Node { .. }) => MenuVariant::SidebarAction,
            (_, MenuKind::Create { .. }) => MenuVariant::Default,
        }
    }
}
/// Fills a menu surface with an Explorer menu's rows.
type MenuFill = Box<dyn FnOnce(Menu) -> Menu>;
/// A menu command against the shell.
type ShellAction = Box<dyn Fn(&mut Shell, &mut Window, &mut Context<Shell>)>;

/// `getPlatformShortcut`: the primary modifier glyph on macOS.
fn shortcut(key: &str) -> String {
    if cfg!(target_os = "macos") {
        format!("⌘{key}")
    } else {
        format!("Ctrl+{key}")
    }
}

impl Shell {
    // ------------------------------------------------------------ open state
    /// `openCreateEntryMenu`.
    pub(in crate::shell) fn open_create_menu(
        &mut self,
        parent: PathBuf,
        at: MenuAt,
        cx: &mut Context<Self>,
    ) {
        if self.files.workspace.is_none() {
            return;
        }
        self.explorer.menu = Some(ExplorerMenu {
            kind: MenuKind::Create { parent },
            at,
            submenu_open: false,
        });
        cx.notify();
    }
    /// `openNodeActionMenu`: the menu acts on the selection when the row is
    /// part of it, otherwise on the row alone. A right click also selects the
    /// row (`onContextMenu`); the "⋮" leaves the selection alone.
    pub(in crate::shell) fn open_node_menu(
        &mut self,
        index: usize,
        at: MenuAt,
        cx: &mut Context<Self>,
    ) {
        let Some(row) = self.tree.rows.get(index).cloned() else {
            return;
        };
        let select = matches!(at, MenuAt::Pointer(_));
        let in_selection = self.tree.selection.contains(&row.path);
        if select && !in_selection {
            self.tree.select(&row.path, false, false);
        }
        let paths = if in_selection || select {
            self.tree.selected_roots()
        } else {
            vec![row.path.clone()]
        };
        self.explorer.menu = Some(ExplorerMenu {
            kind: MenuKind::Node {
                paths,
                primary: row.path,
            },
            at,
            submenu_open: false,
        });
        cx.notify();
    }
    /// Closes the menu if it is still the one at `at`.
    fn close_menu_at(&mut self, at: &MenuAt, cx: &mut Context<Self>) {
        if self.explorer.menu.as_ref().is_some_and(|m| m.at == *at) {
            self.explorer.menu = None;
            cx.notify();
        }
    }

    // -------------------------------------------------------------- surfaces
    /// A trigger and the menu it owns, open while the shell's menu hangs
    /// from it; `open` opens it from a click.
    pub(super) fn menu_trigger<T: Selectable + IntoElement + 'static>(
        &self,
        id: impl Into<ElementId>,
        at: MenuAt,
        trigger: T,
        open: impl Fn(&mut Shell, &mut Context<Shell>) + 'static,
        cx: &App,
    ) -> PopoverMenu {
        let menu = self.explorer.menu.as_ref().filter(|m| m.at == at);
        let (anchor, gap, width) = match &at {
            MenuAt::Row(_, RowTrigger::More) => (Anchor::TopLeft, NODE_MENU_GAP, NODE_MENU_WIDTH),
            MenuAt::NewRow => (
                Anchor::TopRight,
                CREATE_MENU_GAP,
                // The sidebar launcher spans its row.
                CREATE_MENU_WIDTH.max(self.layout.explorer.w - 2. * metric::SIDEBAR_ROW_LEFT_GAP),
            ),
            _ => (Anchor::TopLeft, CREATE_MENU_GAP, CREATE_MENU_WIDTH),
        };
        let host = self.weak.clone();
        let mut popover = PopoverMenu::new(id)
            .anchor(anchor)
            .offset(px(gap))
            .open(menu.is_some())
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    if *opened {
                        open(s, cx)
                    } else {
                        s.close_menu_at(&at, cx)
                    }
                });
            })
            .trigger(trigger);
        if let Some(menu) = menu {
            let variant = menu.variant();
            let fill = self.menu_fill(menu, cx);
            popover =
                popover.menu(move |surface, _, _| fill(surface.variant(variant).w(px(width))));
        }
        popover
    }
    /// The open context menu, pinned at the pointer.
    pub(super) fn context_menu(&self, cx: &App) -> Option<AnchoredMenu> {
        let menu = self.explorer.menu.as_ref()?;
        let MenuAt::Pointer(position) = menu.at else {
            return None;
        };
        let (gap, width) = match menu.kind {
            MenuKind::Node { .. } => (NODE_MENU_GAP, NODE_MENU_WIDTH),
            MenuKind::Create { .. } => (CREATE_MENU_GAP, CREATE_MENU_WIDTH),
        };
        let surface = self.menu_fill(menu, cx)(
            Menu::new("explorer-context-menu")
                .variant(menu.variant())
                .w(px(width)),
        );
        let host = self.weak.clone();
        let at = menu.at.clone();
        Some(
            AnchoredMenu::new(
                "explorer-context",
                position + point(px(0.), px(gap)),
                surface,
            )
            .on_dismiss(move |_, cx| {
                let _ = host.update(cx, |s, cx| s.close_menu_at(&at, cx));
            }),
        )
    }
    fn menu_fill(&self, menu: &ExplorerMenu, cx: &App) -> MenuFill {
        match &menu.kind {
            MenuKind::Create { parent } => {
                self.create_menu(parent.clone(), menu.variant(), menu.submenu_open, cx)
            }
            MenuKind::Node { paths, primary } => {
                // "New file or folder" reopens as the row's create menu (or
                // at the same pointer).
                let create_at = match &menu.at {
                    MenuAt::Pointer(p) => MenuAt::Pointer(*p),
                    _ => MenuAt::Row(primary.clone(), RowTrigger::Create),
                };
                self.node_menu(paths.clone(), primary.clone(), create_at)
            }
        }
    }

    // ----------------------------------------------------------- create menu
    /// `resolveVisibleCreateNewMenuItems`: the configured main entries and the
    /// Custom files submenu, with unavailable experiments removed.
    fn create_menu_entries(&self, cx: &App) -> (Vec<Entry>, Vec<Entry>) {
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
    /// `DesktopCreateEntryMenu`: Folder, then the main entries; Custom files
    /// opens its submenu.
    fn create_menu(
        &self,
        parent: PathBuf,
        variant: MenuVariant,
        submenu_open: bool,
        cx: &App,
    ) -> MenuFill {
        let (main, submenu) = self.create_menu_entries(cx);
        let icon_theme: SharedString = self
            .preferences
            .read(cx)
            .state
            .file_icon_theme
            .clone()
            .into();
        let host = self.weak.clone();
        // `CreateEntryGlyph`: the 18px file glyph in the active icon theme.
        let item = move |entry: Entry| {
            let glyph = match entry {
                Entry::Folder => FileIcon::folder(icon_theme.clone()),
                e => FileIcon::file(format!("x{}", e.extension()), icon_theme.clone()),
            };
            let (host, parent) = (host.clone(), parent.clone());
            MenuItem::new(tr(entry.label_key()))
                .icon_element(glyph)
                .disabled(!entry.available())
                .on_click(move |w, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.explorer.menu = None;
                        s.start_create(entry, Some(parent.clone()), w, cx)
                    });
                })
        };
        Box::new(move |mut menu| {
            menu = menu.item(item(Entry::Folder));
            if !main.is_empty() {
                menu = menu.separator();
            }
            for entry in main {
                if entry != Entry::CustomFiles {
                    menu = menu.item(item(entry));
                    continue;
                }
                let (item, submenu) = (item.clone(), submenu.clone());
                menu = menu.item(
                    MenuItem::new(tr("workspace.node.customFiles"))
                        .icon("workflow")
                        .trailing(Icon::new("chevron-right").small().stroke(2.).opacity(0.86))
                        .open_submenu(submenu_open)
                        .submenu(move |_, _| {
                            Menu::new("explorer-create-submenu")
                                .variant(variant)
                                .items(submenu.iter().map(|entry| item(*entry)))
                        }),
                );
            }
            menu
        })
    }

    // ------------------------------------------------------------- node menu
    fn node_menu(&self, paths: Vec<PathBuf>, primary: PathBuf, create_at: MenuAt) -> MenuFill {
        let host = self.weak.clone();
        let act = move |f: ShellAction| {
            let host = host.clone();
            move |w: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| {
                    s.explorer.menu = None;
                    f(s, w, cx);
                    cx.notify()
                });
            }
        };
        let count = paths.len();
        let single = count == 1;
        let folder = self.tree.is_folder(&primary);
        let absolute = self
            .files
            .workspace
            .as_ref()
            .and_then(|ws| ws.absolute(&primary).ok())
            .unwrap_or_default();
        // `None` is a separator.
        let mut rows: Vec<Option<MenuItem>> = vec![];
        let copy_text = absolute.display().to_string();
        rows.push(Some(
            MenuItem::new(tr("workspace.node.copyPath"))
                .icon("copy")
                .on_click(act(Box::new(move |_, _, cx| {
                    cx.write_to_clipboard(ClipboardItem::new_string(copy_text.clone()))
                }))),
        ));
        rows.push(None);
        if folder {
            let parent = primary.clone();
            rows.push(Some(
                MenuItem::new(tr("workspace.node.newFileOrFolder"))
                    .icon("folder-plus")
                    .on_click(act(Box::new(move |s, _, cx| {
                        s.open_create_menu(parent.clone(), create_at.clone(), cx)
                    }))),
            ));
            let target = primary.clone();
            rows.push(Some(
                MenuItem::new(tr("workspace.node.pasteIntoFolder"))
                    .icon("clipboard-paste")
                    .shortcut(shortcut("V"))
                    .disabled(self.explorer.clipboard.is_none())
                    .on_click(act(Box::new(move |s, w, cx| {
                        s.paste_into(target.clone(), w, cx)
                    }))),
            ));
            rows.push(None);
        }
        let copy = paths.clone();
        rows.push(Some(
            MenuItem::new(tf("workspace.node.copyItems", &[("count", count.into())]))
                .icon("copy")
                .shortcut(shortcut("C"))
                .on_click(act(Box::new(move |s, _, _| {
                    s.explorer.clipboard = Some(FileClipboard::Copy(copy.clone()))
                }))),
        ));
        let cut = paths.clone();
        rows.push(Some(
            MenuItem::new(tf("workspace.node.cutItems", &[("count", count.into())]))
                .icon("scissors")
                .shortcut(shortcut("X"))
                .on_click(act(Box::new(move |s, _, _| {
                    s.explorer.clipboard = Some(FileClipboard::Cut(cut.clone()))
                }))),
        ));
        let duplicate = paths.clone();
        rows.push(Some(
            MenuItem::new(tf(
                "workspace.node.duplicateItems",
                &[("count", count.into())],
            ))
            .icon("copy-plus")
            .shortcut(shortcut("D"))
            .on_click(act(Box::new(move |s, w, cx| {
                s.duplicate(duplicate.clone(), w, cx)
            }))),
        ));
        rows.push(None);
        if single && !folder {
            let path = absolute.clone();
            rows.push(Some(
                MenuItem::new(tr("workspace.node.openDefaultApp"))
                    .icon("external-link")
                    .on_click(act(Box::new(move |s, _, _| {
                        if let Err(e) = crate::platform::desktop::open(&path) {
                            s.error = Some(e)
                        }
                    }))),
            ));
        }
        if single {
            let reveal = absolute.clone();
            rows.push(Some(
                MenuItem::new(tr("workspace.node.revealInFinder"))
                    .icon("folder-open")
                    .on_click(act(Box::new(move |s, _, _| {
                        if let Err(e) = crate::platform::desktop::reveal(&reveal) {
                            s.error = Some(e)
                        }
                    }))),
            ));
            let path = primary.clone();
            rows.push(Some(
                MenuItem::new(tr("workspace.node.rename"))
                    .icon("pencil")
                    .on_click(act(Box::new(move |s, w, cx| {
                        s.begin_rename(path.clone(), false, w, cx)
                    }))),
            ));
        }
        if single && !folder {
            let path = primary.clone();
            rows.push(Some(
                MenuItem::new(tr("workspace.node.changeType"))
                    .icon("file-text")
                    .on_click(act(Box::new(move |s, w, cx| {
                        s.begin_rename(path.clone(), true, w, cx)
                    }))),
            ));
        }
        let delete = paths;
        rows.push(Some(
            MenuItem::new(tf("workspace.node.deleteItems", &[("count", count.into())]))
                .icon("trash-2")
                .danger()
                .on_click(act(Box::new(move |s, w, cx| {
                    s.confirm_delete(delete.clone(), w, cx)
                }))),
        ));
        Box::new(move |menu| {
            rows.into_iter().fold(menu, |menu, row| match row {
                Some(item) => menu.item(item),
                None => menu.separator(),
            })
        })
    }
}
