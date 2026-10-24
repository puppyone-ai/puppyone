//! Native Explorer: port of `shared-ui/data/ExplorerTree.tsx`, the row actions
//! and menus of `data-workspace/nodeActions.tsx`, and the sidebar footer
//! navigation (`DesktopSidebarFooterNavigation`). File operations run on a
//! worker through `workspace.rs`; the open document is closed (autosave drained)
//! before a rename, move or delete touches it, then reopened at its new path.
use super::*;
use crate::{
    features::create_new::create_entry_menu_registry::Entry,
    localization::{t as tr, tf},
    model::Node,
    theme::metric,
    ui::{
        icon_sized,
        menu::{MenuEntry, MenuItem, menu_surface},
        tooltip,
    },
};
use std::{collections::HashMap, path::Path, sync::mpsc};

#[derive(Clone, Debug, PartialEq)]
pub enum ExplorerMenuKind {
    /// "Create" menu for a parent folder (`""` is the workspace root).
    Create { parent: PathBuf },
    /// Node actions for the selection (`primary` is the clicked row).
    Node {
        paths: Vec<PathBuf>,
        primary: PathBuf,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub struct ExplorerMenu {
    pub bounds: Rect,
    pub kind: ExplorerMenuKind,
}
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
/// `shortStatus` + `.tree-row.status-*` colours from the Git snapshot.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum GitMark {
    Modified,
    Created,
    Deleted,
    Moved,
}
impl GitMark {
    fn letter(self) -> &'static str {
        match self {
            Self::Modified => "M",
            Self::Created => "A",
            Self::Deleted => "D",
            Self::Moved => "R",
        }
    }
    fn color(self, t: Theme) -> Rgba {
        match self {
            Self::Modified => t.warning,
            Self::Created => t.success,
            Self::Deleted => t.danger,
            Self::Moved => t.accent,
        }
    }
}
pub fn git_marks(snapshot: Option<&crate::platform::git::Snapshot>) -> HashMap<PathBuf, GitMark> {
    let mut marks = HashMap::new();
    for change in snapshot.map(|s| s.changes.as_slice()).unwrap_or_default() {
        let mark = if change.untracked() || change.index == 'A' {
            GitMark::Created
        } else if change.index == 'D' || change.worktree == 'D' {
            GitMark::Deleted
        } else if change.index == 'R' || change.worktree == 'R' {
            GitMark::Moved
        } else {
            GitMark::Modified
        };
        marks.insert(PathBuf::from(&change.path), mark);
    }
    marks
}

const NODE_MENU_WIDTH: f32 = 224.;
const CREATE_MENU_WIDTH: f32 = 184.;
fn menu_height(entries: &[MenuEntry]) -> f32 {
    entries
        .iter()
        .map(|e| match e {
            MenuEntry::Separator => 9.,
            MenuEntry::Section(_) => 23.,
            _ => theme::control(),
        })
        .sum::<f32>()
        + 2. * metric::MENU_PADDING
        + 2.
}

/// A deferred menu command against the shell.
type ShellAction = Box<dyn Fn(&mut Shell, &mut Window, &mut Context<Shell>)>;
impl Shell {
    // ---------------------------------------------------------------- menus
    fn create_entries(&self, parent: PathBuf, cx: &App) -> Vec<MenuEntry> {
        let t = Theme::new(self.dark);
        let settings = self.preferences.read(cx).state.create_new.clone();
        let icon_theme = self.preferences.read(cx).state.file_icon_theme.clone();
        let host = self.weak.clone();
        let item = |entry: Entry| {
            let host = host.clone();
            let parent = parent.clone();
            let (name, folder) = match entry {
                Entry::Folder => ("folder".to_owned(), true),
                e => (format!("x{}", e.extension()), false),
            };
            MenuEntry::Item(
                MenuItem::new(tr(entry.label_key()), move |w, cx| {
                    let parent = parent.clone();
                    let _ = host.update(cx, |s, cx| {
                        s.popover = None;
                        s.start_create(entry, Some(parent), w, cx)
                    });
                })
                .icon_element(
                    img(SharedString::from(crate::file_kind::asset_path(
                        &icon_theme,
                        &name,
                        folder,
                        self.dark,
                    )))
                    .size(px(16.))
                    .into_any_element(),
                )
                .disabled(!entry.available()),
            )
        };
        let mut entries = vec![item(Entry::Folder), MenuEntry::Separator];
        for entry in &settings.main {
            if *entry == Entry::CustomFiles {
                if !settings.submenu.is_empty() {
                    entries.push(MenuEntry::Section(
                        tr(Entry::CustomFiles.label_key()).into(),
                    ));
                    for e in &settings.submenu {
                        entries.push(item(*e));
                    }
                }
            } else {
                entries.push(item(*entry));
            }
        }
        let _ = t;
        entries
    }
    fn node_entries(&self, paths: Vec<PathBuf>, primary: PathBuf, cx: &App) -> Vec<MenuEntry> {
        let t = Theme::new(self.dark);
        let host = self.weak.clone();
        let count = paths.len();
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
        let mut entries = vec![MenuEntry::Item(
            MenuItem::new(
                tr("workspace.node.copyPath"),
                act(Box::new(move |_, _, cx| {
                    cx.write_to_clipboard(ClipboardItem::new_string(copy_text.clone()))
                })),
            )
            .icon("copy", t),
        )];
        if folder && count == 1 {
            let parent = primary.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(
                    tr("workspace.node.newFileOrFolder"),
                    act(Box::new(move |s, _, cx| {
                        s.open_create_menu(parent.clone(), None, cx)
                    })),
                )
                .icon("folder-plus", t),
            ));
            if self.clipboard.is_some() {
                let target = primary.clone();
                entries.push(MenuEntry::Item(
                    MenuItem::new(
                        tr("workspace.node.pasteIntoFolder"),
                        act(Box::new(move |s, w, cx| {
                            s.paste_into(target.clone(), w, cx)
                        })),
                    )
                    .icon("clipboard-paste", t)
                    .shortcut("⌘V", t),
                ));
            }
        }
        entries.push(MenuEntry::Separator);
        let copy_paths = paths.clone();
        entries.push(MenuEntry::Item(
            MenuItem::new(
                tf("workspace.node.copyItems", &[("count", count.into())]),
                act(Box::new(move |s, _, _| {
                    s.clipboard = Some(FileClipboard::Copy(copy_paths.clone()))
                })),
            )
            .icon("copy", t)
            .shortcut("⌘C", t),
        ));
        let cut_paths = paths.clone();
        entries.push(MenuEntry::Item(
            MenuItem::new(
                tf("workspace.node.cutItems", &[("count", count.into())]),
                act(Box::new(move |s, _, _| {
                    s.clipboard = Some(FileClipboard::Cut(cut_paths.clone()))
                })),
            )
            .icon("scissors", t)
            .shortcut("⌘X", t),
        ));
        let duplicate_paths = paths.clone();
        entries.push(MenuEntry::Item(
            MenuItem::new(
                tf("workspace.node.duplicateItems", &[("count", count.into())]),
                act(Box::new(move |s, w, cx| {
                    s.duplicate(duplicate_paths.clone(), w, cx)
                })),
            )
            .icon("copy-plus", t)
            .shortcut("⌘D", t),
        ));
        entries.push(MenuEntry::Separator);
        if !folder && count == 1 {
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
                .icon("external-link", t),
            ));
        }
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
            .icon("folder-open", t),
        ));
        if count == 1 {
            let path = primary.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(
                    tr("workspace.node.rename"),
                    act(Box::new(move |s, w, cx| {
                        s.begin_rename(path.clone(), w, cx)
                    })),
                )
                .icon("pencil", t),
            ));
        }
        entries.push(MenuEntry::Separator);
        let delete_paths = paths;
        entries.push(MenuEntry::Item(
            MenuItem::new(
                tf("workspace.node.deleteItems", &[("count", count.into())]),
                act(Box::new(move |s, w, cx| {
                    s.confirm_delete(delete_paths.clone(), w, cx)
                })),
            )
            .danger()
            .icon("trash-2", t)
            .shortcut("⌘⌫", t),
        ));
        let _ = cx;
        entries
    }
    fn place_menu(&self, at_point: Point<Pixels>, width: f32, height: f32) -> Rect {
        let (w, h) = (self.layout.header.w, self.layout.footer.bottom());
        let x = f32::from(at_point.x).min(w - width - 8.).max(8.);
        let mut y = f32::from(at_point.y);
        if y + height > h - 8. {
            y = (y - height).max(theme::HEADER + 4.);
        }
        Rect::new(x, y, width, height.min(h - theme::HEADER - 16.))
    }
    pub(super) fn open_create_menu(
        &mut self,
        parent: PathBuf,
        at_point: Option<Point<Pixels>>,
        cx: &mut Context<Self>,
    ) {
        if self.files.workspace.is_none() {
            return;
        }
        let height = menu_height(&self.create_entries(parent.clone(), cx));
        let anchor = at_point.unwrap_or_else(|| {
            point(
                px(self.layout.explorer.x + 12.),
                px(self.layout.footer.y - height - 4.),
            )
        });
        self.popover = Some(Popover::Explorer(ExplorerMenu {
            bounds: self.place_menu(anchor, CREATE_MENU_WIDTH, height),
            kind: ExplorerMenuKind::Create { parent },
        }));
        cx.notify();
    }
    fn open_node_menu(&mut self, index: usize, at_point: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(row) = self.tree.rows.get(index).cloned() else {
            return;
        };
        if !self.tree.selection.contains(&row.path) {
            self.tree.select(&row.path, false, false);
        }
        let paths = self.tree.selected_roots();
        let height = menu_height(&self.node_entries(paths.clone(), row.path.clone(), cx));
        self.popover = Some(Popover::Explorer(ExplorerMenu {
            bounds: self.place_menu(at_point, NODE_MENU_WIDTH, height),
            kind: ExplorerMenuKind::Node {
                paths,
                primary: row.path,
            },
        }));
        cx.notify();
    }
    pub(super) fn explorer_popup(
        &self,
        menu: &ExplorerMenu,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let t = Theme::new(self.dark);
        let entries = match &menu.kind {
            ExplorerMenuKind::Create { parent } => self.create_entries(parent.clone(), cx),
            ExplorerMenuKind::Node { paths, primary } => {
                self.node_entries(paths.clone(), primary.clone(), cx)
            }
        };
        at(menu.bounds)
            .id("explorer-popup")
            .child(menu_surface("explorer-menu", entries, t).size_full())
            .on_mouse_down_out(cx.listener(|s, _, _, cx| {
                s.popover = None;
                cx.notify();
            }))
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
    fn begin_rename(&mut self, path: PathBuf, window: &mut Window, cx: &mut Context<Self>) {
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
                            .child(tr("workspace.node.rename")),
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
        let mark = self.git_marks.get(&item.path).copied();
        let cut = matches!(&self.clipboard, Some(FileClipboard::Cut(p)) if p.contains(&item.path));
        let fg = mark
            .map(|m| m.color(t))
            .unwrap_or(if selected { t.text } else { t.sidebar_text });
        let group = SharedString::from(format!("tree-row-{index}"));
        let path = item.path.clone();
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
        let glyph: AnyElement = if item.folder {
            icon_sized(
                if item.expanded {
                    "chevron-down"
                } else {
                    "chevron-right"
                },
                12.,
                fg,
            )
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
        // `.tree-row-actions`: absolutely placed; the label reserves room only on hover.
        let mut actions = row()
            .absolute()
            .top_0()
            .bottom_0()
            .right(px(4.))
            .gap(px(2.))
            .invisible()
            .group_hover(group.clone(), |s| s.visible());
        if item.folder {
            let parent = item.path.clone();
            actions = actions.child(
                ui::icon_button(("row-create", index), "plus", t)
                    .size(px(metric::TREE_ROW_ACTION_SIZE))
                    .accessibility_label(tr("workspace.node.createNew"))
                    .tooltip(tooltip(tr("workspace.node.createNew")))
                    .on_click(cx.listener(move |s, e: &ClickEvent, _, cx| {
                        cx.stop_propagation();
                        s.open_create_menu(parent.clone(), Some(e.position()), cx)
                    })),
            );
        }
        let more = tf(
            "workspace.node.moreActionsFor",
            &[("name", item.name.clone().into())],
        );
        actions = actions.child(
            ui::icon_button(("row-more", index), "ellipsis", t)
                .size(px(metric::TREE_ROW_ACTION_SIZE))
                .accessibility_label(more.clone())
                .tooltip(tooltip(tr("workspace.node.moreActions")))
                .on_click(cx.listener(move |s, e: &ClickEvent, _, cx| {
                    cx.stop_propagation();
                    s.open_node_menu(index, e.position(), cx)
                })),
        );
        let reserve = if item.folder {
            2. * metric::TREE_ROW_ACTION_SIZE + 6.
        } else {
            metric::TREE_ROW_ACTION_SIZE + 4.
        };
        let label = row()
            .flex_1()
            .min_w_0()
            .gap(px(5.))
            .group_hover(group.clone(), move |s| s.pr(px(reserve)))
            .child(div().min_w_0().truncate().child(item.display.clone()))
            .children(item.extension.clone().map(|ext| {
                div()
                    .flex_shrink_0()
                    .text_size(px(theme::ty().left.meta))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.subtle)
                    .child(format!(".{ext}"))
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
                        + 9.
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
        let inner =
            row()
                .id(("tree-row", index))
                .group(group)
                .relative()
                .w_full()
                .h(px(theme::control()))
                .my(px(1.))
                .pl(px(metric::TREE_ROW_CONTENT_LEFT + depth))
                .pr(px(metric::SIDEBAR_ROW_CONTENT_RIGHT))
                .gap(px(metric::TREE_ROW_ICON_LABEL_GAP))
                .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                .text_size(px(theme::ty().left.content))
                .line_height(px(18.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(fg)
                .cursor(theme::clickable_cursor())
                .when(selected, |d| d.bg(theme::alpha(t.selected, 0.92)))
                .hover(move |d| {
                    d.bg(if selected {
                        t.selected
                    } else {
                        theme::alpha(t.hover, 0.86)
                    })
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
                .children(mark.map(|m| {
                    div()
                        .flex_shrink_0()
                        .text_size(px(theme::ty().left.meta))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(m.color(t))
                        .child(m.letter())
                }))
                .child(actions)
                .on_click(cx.listener(move |s, e: &ClickEvent, w, cx| {
                    s.click_row(index, e.modifiers(), w, cx)
                }))
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        s.open_node_menu(index, e.position, cx)
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
        let _ = path;
        div()
            .h(px(theme::sidebar_stride()))
            .w_full()
            .child(inner)
            .into_any_element()
    }
    /// `desktop-explorer-list-end-create`: the "New" tree row after the last item.
    fn list_end_row(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = Theme::new(self.dark);
        let open = matches!(
            &self.popover,
            Some(Popover::Explorer(ExplorerMenu {
                kind: ExplorerMenuKind::Create { .. },
                ..
            }))
        );
        let enabled = self.files.workspace.is_some() && self.preferences.read(cx).loaded;
        div()
            .h(px(theme::sidebar_stride()))
            .w_full()
            .child(
                row()
                    .id("explorer-new")
                    .w_full()
                    .h(px(theme::control()))
                    .my(px(1.))
                    .pl(px(metric::TREE_ROW_CONTENT_LEFT))
                    .gap(px(metric::TREE_ROW_ICON_LABEL_GAP))
                    .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                    .text_size(px(theme::ty().left.content))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.sidebar_text)
                    .when(open, |d| d.bg(theme::alpha(t.hover, 0.86)))
                    .when(enabled, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(move |s| s.bg(theme::alpha(t.hover, 0.86)).text_color(t.text))
                            .on_click(cx.listener(|s, e: &ClickEvent, _, cx| {
                                if matches!(s.popover, Some(Popover::Explorer(_))) {
                                    s.popover = None;
                                    cx.notify();
                                } else {
                                    s.open_create_menu(PathBuf::new(), Some(e.position()), cx)
                                }
                            }))
                    })
                    .when(!enabled, |d| d.opacity(0.5))
                    .child(
                        div()
                            .size(px(metric::SIDEBAR_ICON_SLOT))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(icon_sized("plus", 14., t.sidebar_text)),
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
        column_el.child(
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
                        s.open_create_menu(PathBuf::new(), Some(e.position), cx)
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
        )
    }
    /// `DesktopSidebarFooterNavigation`: Changes, Settings and Help.
    pub(super) fn footer(&self, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let status = self.git_status(cx);
        let changes_open = self.changes && self.right_open;
        let changes_label = if status.incoming > 0 {
            tf(
                "shell.navigation.remoteChangeCount",
                &[
                    ("label", tr("shell.navigation.changes").into()),
                    ("count", status.incoming.into()),
                ],
            )
        } else if status.local > 0 {
            tf(
                "shell.navigation.workspaceChangesDetected",
                &[("label", tr("shell.navigation.changes").into())],
            )
        } else {
            tr("shell.navigation.changes").into()
        };
        let nav = |id: &'static str, icon: &'static str, size: f32, label: String, active: bool| {
            gpui_kit::base::Button::new(id)
                .accessibility_label(label.clone())
                .selected(active)
                .relative()
                .flex()
                .items_center()
                .justify_center()
                .size(px(theme::control()))
                .rounded(px(metric::CONTROL_RADIUS))
                .cursor(theme::clickable_cursor())
                .when(active, |b| b.bg(t.selected))
                .hover(move |s| s.bg(t.hover))
                .tooltip(tooltip(label))
                .child(icon_sized(
                    icon,
                    size,
                    if active { t.text } else { t.muted },
                ))
        };
        let mut changes = nav(
            "nav-changes",
            "git-branch",
            18.,
            changes_label,
            changes_open,
        )
        .on_click(cx.listener(|s, _, w, cx| s.command("changes", w, cx)));
        if status.incoming > 0 {
            changes = changes.child(
                div()
                    .absolute()
                    .top(px(3.))
                    .right(px(2.))
                    .min_w(px(14.))
                    .h(px(14.))
                    .px(px(3.))
                    .rounded_full()
                    .bg(t.accent)
                    .text_size(px(10.))
                    .text_color(t.text_inverse)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(status.incoming.min(99).to_string()),
            );
        } else if status.local > 0 {
            changes = changes.child(
                div()
                    .absolute()
                    .top(px(6.))
                    .right(px(6.))
                    .size(px(6.))
                    .rounded_full()
                    .bg(t.warning),
            );
        }
        at(self.layout.footer)
            .bg(t.sidebar)
            .border_t_1()
            .border_color(t.sidebar_divider)
            .flex()
            .items_center()
            .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .gap(px(4.))
            .when(self.files.workspace.is_some(), |d| d.child(changes))
            .child(
                nav(
                    "settings",
                    "settings",
                    16.,
                    tr("shell.navigation.settings").into(),
                    self.settings,
                )
                .on_click(cx.listener(|s, _, w, cx| s.command("settings", w, cx))),
            )
            .child(
                nav(
                    "feedback",
                    "circle-help",
                    16.,
                    tr("shell.feedback.label").into(),
                    self.help,
                )
                .on_click(cx.listener(|s, _, w, cx| s.command("feedback", w, cx))),
            )
            .when(
                self.pending
                    || self.files.busy()
                    || self.files.folder_busy
                    || self.file_op.is_some(),
                |d| {
                    let preset = self.preferences.read(cx).state.loading_animation.clone();
                    d.child(div().flex_1()).child(ui::pulse_grid::pulse_grid(
                        "footer-busy",
                        &preset,
                        ui::pulse_grid::PulseSize::Sm,
                        t.subtle,
                    ))
                },
            )
    }
}
