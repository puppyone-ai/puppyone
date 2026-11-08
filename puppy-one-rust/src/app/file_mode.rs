//! File Mode (`FileModeApp`, `electron/main/file-mode.mjs`): one Markdown,
//! CSV or HTML file in a window of its own, opened from Finder or a second
//! launch. No project, Explorer, Agent, Git or Terminal: a title bar with the
//! file's name centred and the editor's own view switch and settings at its
//! end, floating over the document with no fill. Edits are saved as they
//! are made, as in a project window: no save step, no unsaved mark, no
//! question on close; closing flushes what was just typed, and a write that
//! fails keeps the window open (the project window's close coordinator).
//!
//! The document fills the window from its top edge and keeps the bar's row
//! as room above its content at rest (`--po-editor-chrome-inset-block-start`);
//! scrolled, content passes beneath the bar and fades out across its row,
//! and the name fades while reading further down. The controls show only
//! while the pointer is in the top third of the window or a menu is open.
//! An HTML page is a native web view, which nothing can float over, so it
//! starts below the bar.
//!
//! The document area follows `FileModeApp`: `PageLoading` until the file is
//! found, `FileUnavailable` when it is gone or over the editor's 1 MB limit,
//! and text that is not UTF-8 opens read-only under a notice.
//!
//! [`FileWindow`] is the entity a file window shows instead of the project
//! panes: the title bar and the document area over the window's documents
//! runtime and editor area. Its answers to the close question go back to
//! the window ([`FileEvent`]).
use super::{editor_area::EditorArea, session::DocumentSession};
use crate::{
    editor::workbench::pane::{Action, ItemKind},
    geometry::Rect,
    localization::{t as tr, tf},
    theme::{self, metric},
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, Icon, Menu, MenuItem, MenuVariant, PopoverMenu},
        loading::{LoaderSize, LoadingMark, Tone},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Selectable as _, h_flex},
    component::Sizable as _,
};
use std::path::{Path, PathBuf};

/// `createWindow({ initialFilePath })`: a file window is 860 × 760.
pub const FILE_WINDOW_SIZE: (f32, f32) = (860., 760.);
/// `--file-mode-titlebar-safe-start` beside the macOS traffic lights.
const SAFE_START: f32 = 80.;
/// `.file-mode-window__controls { gap: 3px }`.
const CONTROLS_GAP: f32 = 3.;
/// `PANE_HANDLE_REVEAL_RATIO`: chrome appears in the top third.
const PANE_HANDLE_REVEAL_RATIO: f32 = 1. / 3.;
/// `EditorViewModeMenu` `MENU_MAX_HEIGHT`.
const VIEW_MENU_MAX_HEIGHT: f32 = 320.;
/// `MAX_EDITOR_BYTES`: a file window opens nothing larger.
pub const MAX_EDITOR_BYTES: u64 = 1024 * 1024;
/// `.file-mode-window__notice { padding: 8px 16px }` around one header line.
const NOTICE_PADDING: (f32, f32) = (8., 16.);
/// `.editor-state--stacked`: `gap: 7px; padding: 24px`, lines at most 520px.
const STATE_GAP: f32 = 7.;
const STATE_PADDING: f32 = 24.;
const STATE_LINE_MAX: f32 = 520.;

/// What the bound file was when the window opened (`openBoundFile`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Admission {
    Readable,
    /// `initialFile.tooLarge`: over `MAX_EDITOR_BYTES`.
    TooLarge,
    /// Gone, or not a file (`resolveNode` failed).
    Unavailable,
}

/// `createFileTarget`: the one file a file window is bound to.
#[derive(Clone, Debug, PartialEq)]
pub struct FileTarget {
    pub path: PathBuf,
    pub root: PathBuf,
    pub name: String,
    pub admission: Admission,
}
impl FileTarget {
    /// `path` is already canonical.
    pub fn of(path: PathBuf) -> Option<Self> {
        let root = path.parent()?.to_path_buf();
        let name = path.file_name()?.to_string_lossy().into_owned();
        let admission = match std::fs::metadata(&path) {
            Ok(meta) if !meta.is_file() => Admission::Unavailable,
            Ok(meta) if meta.len() > MAX_EDITOR_BYTES => Admission::TooLarge,
            Ok(_) => Admission::Readable,
            Err(_) => Admission::Unavailable,
        };
        Some(Self {
            path,
            root,
            name,
            admission,
        })
    }
}

/// A file window's own state: the bound file, the title bar menu that is
/// open, and whether the pointer is near the top.
pub struct FileWindow {
    pub target: FileTarget,
    pub(super) menu: Option<FileMenu>,
    /// `useEditorPaneChromeReveal`: the pointer is in the top third.
    pub(super) revealed: bool,
    docs: Entity<DocumentSession>,
    editor: Entity<EditorArea>,
    weak: WeakEntity<Self>,
}
impl FileWindow {
    pub(super) fn new(
        target: FileTarget,
        docs: Entity<DocumentSession>,
        editor: Entity<EditorArea>,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.observe(&editor, |_, _, cx| cx.notify()).detach();
        Self {
            target,
            menu: None,
            revealed: false,
            docs,
            editor,
            weak: cx.weak_entity(),
        }
    }
}

/// What the document area shows (`FileModeApp`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Shown {
    /// `PageLoading variant="fill"`: the file is not found yet.
    Loading,
    /// `FileUnavailable`, with the size limit it is over.
    Unavailable(Option<u64>),
    Document,
}

/// `isFileModeFile`: Markdown, CSV and HTML (an `.htm`/`.html` page, not a
/// server template) open on their own.
pub fn is_file_mode_file(path: &Path) -> bool {
    let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_lowercase()) else {
        return false;
    };
    match crate::formats::of(&name).id.as_str() {
        "markdown" | "csv" => true,
        "html" => name.ends_with(".html") || name.ends_with(".htm"),
        _ => false,
    }
}

/// `.file-mode-window__action`: an icon command of the project titlebar's
/// size (`--desktop-chrome-control-size` × `--desktop-titlebar-control-height`).
fn title_action(id: &'static str, icon: Icon, label: String, width: f32) -> Button {
    Button::new(id)
        .variant(ButtonVariant::TitlebarInk)
        .icon(icon)
        .accessibility_label(label.clone())
        .tooltip(label)
        .w(px(width))
        .px_0()
}

/// Which title bar menu is open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FileMenu {
    View,
    Settings,
}

impl FileWindow {
    pub(super) fn shown(&self, cx: &App) -> Shown {
        match self.target.admission {
            Admission::Unavailable => Shown::Unavailable(None),
            Admission::TooLarge => Shown::Unavailable(Some(MAX_EDITOR_BYTES)),
            _ if self.docs.read(cx).workspace.is_none() => Shown::Loading,
            _ => Shown::Document,
        }
    }
    /// The file window's editor, once its document has a host.
    pub(super) fn file_editor(
        &self,
        cx: &App,
    ) -> Option<Entity<crate::editor::host::DocumentEditor>> {
        self.editor
            .read(cx)
            .host(self.docs.read(cx).active_slot())
            .cloned()
    }
    fn file_menu(
        &self,
        menu: FileMenu,
        trigger: Button,
        build: impl FnOnce(Menu) -> Menu + 'static,
    ) -> PopoverMenu {
        let open = self.menu == Some(menu);
        let host = self.weak.clone();
        PopoverMenu::new(match menu {
            FileMenu::View => "file-view-menu",
            FileMenu::Settings => "file-settings-menu",
        })
        .anchor(Anchor::TopRight)
        .offset(px(4.))
        .open(open)
        .on_open_change(move |opened, _, cx| {
            let _ = host.update(cx, |s, cx| {
                if *opened != (s.menu == Some(menu)) {
                    s.menu = opened.then_some(menu);
                    cx.notify();
                }
            });
        })
        .trigger(trigger.selected(open))
        .menu(move |surface, _, _| build(surface.variant(MenuVariant::Default)))
    }
    /// `FileControls`: the view as one control showing the current view,
    /// anything else behind the pane's menu.
    fn file_controls(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let editor = self.file_editor(cx)?;
        let controls = editor.read(cx).title_controls(cx);
        let name = self.target.name.clone();
        let action = |action: Action| {
            let editor = editor.downgrade();
            let host = self.weak.clone();
            move |w: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| {
                    s.menu = None;
                    cx.notify();
                });
                let _ = editor.update(cx, |e, cx| e.run_title_action(action.clone(), w, cx));
            }
        };
        let size = theme::control();
        let icon = |name: &'static str| Icon::new(name).with_size(px(15.)).stroke(1.85);
        let subtle = cx.palette().subtle;
        let mut row = h_flex().flex_none().items_center().gap(px(CONTROLS_GAP));
        if let Some(segmented) = controls.segmented.clone() {
            let current = segmented
                .options
                .iter()
                .find(|o| o.id == segmented.value)
                .or(segmented.options.first())
                .cloned();
            let label = match &current {
                Some(option) => format!("{}: {}", segmented.label, option.label),
                None => segmented.label.to_string(),
            };
            let trigger = title_action(
                "file-view-mode",
                icon(current.as_ref().map_or("eye", |o| o.icon)),
                label,
                size,
            );
            let items: Vec<MenuItem> = segmented
                .options
                .iter()
                .map(|option| {
                    // `EditorViewModeMenu`: each view with its 15px icon, the
                    // current one with a quiet check at the end.
                    let selected = option.id == segmented.value;
                    let item = MenuItem::new(option.label.clone())
                        .icon_sized(icon(option.icon))
                        .on_click(action(Action::Segment(option.id)));
                    if selected {
                        item.trailing(
                            Icon::new("check")
                                .with_size(px(14.))
                                .stroke(1.85)
                                .color(subtle),
                        )
                    } else {
                        item
                    }
                })
                .collect();
            row = row.child(self.file_menu(FileMenu::View, trigger, move |menu| {
                menu.max_h(px(VIEW_MENU_MAX_HEIGHT)).list(2., items)
            }));
        }
        if !controls.items.is_empty() {
            let label = tf("editor.panes.actionsFor", &[("name", name.into())]);
            let trigger = title_action("file-settings", icon("ellipsis"), label.to_string(), size);
            let items: Vec<MenuItem> =
                controls
                    .items
                    .iter()
                    .map(|item| {
                        let row = MenuItem::new(item.label.clone())
                            .on_click(action(Action::Item(item.id)));
                        // `EditorPaneActionsMenu`: a toggle's check sits in the
                        // icon slot, an empty slot while it is off.
                        match item.kind {
                            ItemKind::Toggle(on) => row
                                .icon_element(
                                    div()
                                        .size(px(metric::MENU_ICON_SLOT))
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .children(on.then(|| {
                                            Icon::new("check").with_size(px(14.)).stroke(2.)
                                        })),
                                )
                                .stay_open(),
                            ItemKind::Command { disabled } => row.disabled(disabled),
                        }
                    })
                    .collect();
            row = row.child(self.file_menu(FileMenu::Settings, trigger, move |menu| {
                menu.list(2., items)
            }));
        }
        Some(row.into_any_element())
    }
    /// `.file-mode-window__titlebar`: the project titlebar's geometry and
    /// type, but no bar of its own — no fill or divider — over the
    /// document; the name in the middle of the window clear of the traffic
    /// lights and the file's controls. Pressing it still moves the window.
    fn file_titlebar(&self, w: f32, scrolled: bool, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().header;
        // `opened?.target.name`: nothing until the file is found.
        let name = if matches!(self.shown(cx), Shown::Loading | Shown::Unavailable(None)) {
            String::new()
        } else {
            self.target.name.clone()
        };
        let room = theme::control() * 2. + CONTROLS_GAP;
        let start = if cfg!(target_os = "macos") {
            SAFE_START
        } else {
            0.
        };
        let side = start.max(room);
        // While reading further down, the name steps back until the pointer
        // nears the top; the controls show only then, or with a menu open.
        let revealed = self.revealed || self.menu.is_some();
        let controls = self.file_controls(cx).map(|controls| {
            div()
                .id("file-mode-controls")
                .debug_selector(|| "file-mode-controls".into())
                .opacity(if revealed { 1. } else { 0. })
                .child(controls)
        });
        div()
            .id("file-mode-titlebar")
            .absolute()
            .top_0()
            .left_0()
            .w(px(w))
            .h(px(metric::CHROME_HEIGHT))
            .px(px(6.))
            .flex()
            .items_center()
            .text_color(t.muted)
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .on_mouse_down(MouseButton::Left, |e, window, _| {
                if e.click_count == 2 {
                    window.zoom_window();
                } else {
                    window.start_window_move();
                }
            })
            .child(div().flex_1().min_w(px(side)))
            .child(
                div()
                    .id("file-mode-name")
                    .debug_selector(|| "file-mode-name".into())
                    .min_w_0()
                    .px(px(6.))
                    .truncate()
                    .text_center()
                    .opacity(if scrolled && !revealed { 0. } else { 1. })
                    .child(name),
            )
            .child(
                h_flex()
                    .flex_1()
                    .min_w(px(side))
                    .justify_end()
                    .children(controls),
            )
            .into_any_element()
    }
    /// `.file-mode-window__document`: the document (under the encoding
    /// notice when it only reads), or what stands in for it.
    fn file_document(&self, r: Rect, page: bool, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let area = div()
            .absolute()
            .left(px(r.x))
            .top(px(r.y))
            .w(px(r.w))
            .h(px(r.h))
            .bg(t.canvas)
            .flex()
            .flex_col();
        match self.shown(cx) {
            Shown::Loading => area.items_center().justify_center().child(
                LoadingMark::new("file-mode-loading")
                    .area()
                    .size(LoaderSize::Md)
                    .tone(Tone::Neutral),
            ),
            Shown::Unavailable(limit) => {
                let ty = theme::ty().ui;
                // `line-height: normal`, as Chromium rounds it.
                let normal = |size: f32| px((size * theme::NORMAL_LINE_HEIGHT).round());
                let line = |text: String| {
                    div()
                        .max_w(px(STATE_LINE_MAX))
                        .line_height(normal(ty.meta))
                        .child(text)
                };
                area.items_center()
                    .justify_center()
                    .gap(px(STATE_GAP))
                    .p(px(STATE_PADDING))
                    .text_center()
                    .text_size(px(ty.meta))
                    .text_color(t.subtle)
                    .child(
                        div()
                            .text_size(px(ty.body))
                            .line_height(normal(ty.body))
                            .font_weight(FontWeight(680.))
                            .text_color(t.text)
                            .child(tr("editor.unavailable.title")),
                    )
                    .children(limit.map(|limit| {
                        line(tf(
                            "editor.unavailable.resourceLimit",
                            &[(
                                "limit",
                                format!("{} MB", (limit as f64 / 1024. / 1024.).round()).into(),
                            )],
                        ))
                    }))
            }
            Shown::Document => {
                let ty = theme::ty().header;
                // A notice sits where the document would start, below the
                // title bar's row (a page already starts there).
                let notice = self.editor.read(cx).read_only(cx).then(|| {
                    div()
                        .flex_none()
                        .when(!page, |d| d.mt(px(metric::CHROME_HEIGHT)))
                        .py(px(NOTICE_PADDING.0))
                        .px(px(NOTICE_PADDING.1))
                        .text_color(t.muted)
                        .text_size(px(ty.content))
                        .line_height(px(ty.line_height))
                        .child(tr("editor.fileMode.readOnlyEncoding"))
                });
                let slot = self.docs.read(cx).active_slot();
                let editor_area = self.editor.read(cx);
                let document = editor_area.host(slot).map(|editor| {
                    div()
                        .relative()
                        .flex_1()
                        .min_h_0()
                        .child(editor.clone())
                        .children(editor_area.save_chip(slot, cx))
                });
                area.children(notice).children(document)
            }
        }
    }
}

impl FileWindow {
    /// Whether the document is an HTML page (a native web view).
    fn page(&self, cx: &App) -> bool {
        self.file_editor(cx)
            .is_some_and(|e| e.read(cx).viewer_id() == Some("html"))
    }
    /// `useEditorPaneChromeReveal`: the pointer moved to `y` of a window
    /// `height` tall, or left it.
    pub(super) fn point(&mut self, y: Option<f32>, height: f32, cx: &mut Context<Self>) {
        let revealed = y.is_some_and(|y| y < height * PANE_HANDLE_REVEAL_RATIO);
        if self.revealed != revealed {
            self.revealed = revealed;
            cx.notify();
        }
    }
}

impl Render for FileWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let size = window.viewport_size();
        let (w, h) = (f32::from(size.width), f32::from(size.height));
        let t = cx.palette();
        let page = self.page(cx);
        let notice = self.editor.read(cx).read_only(cx);
        // `.file-mode-window`: one surface from the window's top edge; the
        // editor keeps the bar's row as room above its content.
        let inset = if page || notice {
            0.
        } else {
            metric::CHROME_HEIGHT
        };
        let editor = self.file_editor(cx);
        if let Some(editor) = &editor {
            editor.update(cx, |e, cx| e.set_chrome_inset(inset, cx));
        }
        let (scroll, pinned) = editor.map_or((0., false), |e| e.read(cx).scroll_state(cx));
        let scrolled = scroll > 0.;
        let top = if page { metric::CHROME_HEIGHT } else { 0. };
        let area = Rect::new(0., top, w, h - top);
        // Content scrolled up to the window's edge fades across the bar's
        // row instead of meeting a line; never a pinned header row, which is
        // already the edge, nor a page with its own background.
        let fade = (scrolled && !pinned && !page).then(|| {
            div()
                .absolute()
                .top_0()
                .left_0()
                .w(px(w))
                .h(px(metric::CHROME_HEIGHT))
                .bg(linear_gradient(
                    180.,
                    linear_color_stop(t.canvas, 0.),
                    linear_color_stop(theme::alpha(t.canvas, 0.), 1.),
                ))
        });
        div()
            .id("file-mode-window")
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .on_mouse_move(cx.listener(move |s, e: &MouseMoveEvent, _, cx| {
                s.point(Some(f32::from(e.position.y)), h, cx)
            }))
            .on_hover(cx.listener(move |s, hovered: &bool, _, cx| {
                if !*hovered {
                    s.point(None, h, cx)
                }
            }))
            .child(self.file_document(area, page, cx))
            .children(fade)
            .child(self.file_titlebar(w, scrolled, cx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn markdown_csv_and_html_pages_open_on_their_own() {
        for (name, opens) in [
            ("notes.md", true),
            ("Notes.MARKDOWN", true),
            ("table.csv", true),
            ("page.html", true),
            ("page.htm", true),
            ("view.php", false),
            ("photo.png", false),
            ("main.rs", false),
        ] {
            assert_eq!(is_file_mode_file(Path::new(name)), opens, "{name}");
        }
        let target = FileTarget::of(PathBuf::from("/a/b/notes.md")).unwrap();
        assert_eq!(target.root, PathBuf::from("/a/b"));
        assert_eq!(target.name, "notes.md");
        assert_eq!(target.admission, Admission::Unavailable);
    }

    #[test]
    fn a_file_over_the_editor_limit_is_never_read() {
        let temp = tempfile::tempdir().unwrap();
        let (small, large) = (temp.path().join("small.md"), temp.path().join("large.md"));
        std::fs::write(&small, "# Small\n").unwrap();
        std::fs::write(&large, vec![b'x'; MAX_EDITOR_BYTES as usize + 1]).unwrap();
        assert_eq!(
            FileTarget::of(small).unwrap().admission,
            Admission::Readable
        );
        assert_eq!(
            FileTarget::of(large).unwrap().admission,
            Admission::TooLarge
        );
        let folder = FileTarget::of(temp.path().to_path_buf()).unwrap();
        assert_eq!(folder.admission, Admission::Unavailable);
    }
}
