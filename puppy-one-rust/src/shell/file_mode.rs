//! File Mode (`FileModeApp`, `electron/main/file-mode.mjs`): one Markdown,
//! CSV or HTML file in a window of its own, opened from Finder or a second
//! launch. No project, Explorer, Agent, Git or Terminal: a title bar with the
//! file's name centred and the editor's own view switch and settings at its
//! end, over the document. Saves are explicit (⌘S); closing with unsaved
//! edits asks to save, discard or stay.
use super::*;
use crate::{
    editor::workbench::pane::{Action, ItemKind},
    localization::{t as tr, tf},
    theme::metric,
    ui::components::{Icon, IconButton, Menu, MenuItem, MenuVariant, PopoverMenu},
};
use gpui_kit::{
    base::{Selectable as _, h_flex},
    component::Sizable as _,
};
use std::path::Path;

/// `createWindow({ initialFilePath })`: a file window is 860 × 760.
pub const FILE_WINDOW_SIZE: (f32, f32) = (860., 760.);
/// `--file-mode-titlebar-safe-start` beside the macOS traffic lights.
const SAFE_START: f32 = 80.;
/// `.file-mode-window__controls { gap: 3px }`.
const CONTROLS_GAP: f32 = 3.;
/// `EditorViewModeMenu` `MENU_MAX_HEIGHT`.
const VIEW_MENU_MAX_HEIGHT: f32 = 320.;

/// `createFileTarget`: the one file a file window is bound to.
#[derive(Clone, Debug, PartialEq)]
pub struct FileTarget {
    pub path: PathBuf,
    pub root: PathBuf,
    pub name: String,
}
impl FileTarget {
    /// `path` is already canonical.
    pub fn of(path: PathBuf) -> Option<Self> {
        let root = path.parent()?.to_path_buf();
        let name = path.file_name()?.to_string_lossy().into_owned();
        Some(Self { path, root, name })
    }
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

/// Which title bar menu is open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FileMenu {
    View,
    Settings,
}

impl Shell {
    pub(super) fn file_mode(&self) -> bool {
        self.file_target.is_some()
    }
    /// The file window's editor, once its document has a host.
    fn file_editor(&self) -> Option<Entity<crate::editor::host::DocumentEditor>> {
        self.native_hosts.get(&self.files.active_slot()).cloned()
    }
    fn file_menu(
        &self,
        menu: FileMenu,
        trigger: IconButton,
        build: impl FnOnce(Menu) -> Menu + 'static,
    ) -> PopoverMenu {
        let open = self.file_menu == Some(menu);
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
                if *opened != (s.file_menu == Some(menu)) {
                    s.file_menu = opened.then_some(menu);
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
        let editor = self.file_editor()?;
        let controls = editor.read(cx).title_controls(cx);
        let name = self.file_target.as_ref()?.name.clone();
        let action = |action: Action| {
            let editor = editor.downgrade();
            let host = self.weak.clone();
            move |w: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| {
                    s.file_menu = None;
                    cx.notify();
                });
                let _ = editor.update(cx, |e, cx| e.run_title_action(action.clone(), w, cx));
            }
        };
        let size = theme::control();
        let icon = |name: &'static str| Icon::new(name).with_size(px(15.)).stroke(1.85);
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
            let trigger = IconButton::new(
                "file-view-mode",
                icon(current.as_ref().map_or("eye", |o| o.icon)),
            )
            .label(label.clone())
            .tooltip(label)
            .with_size(px(size));
            let items: Vec<MenuItem> = segmented
                .options
                .iter()
                .map(|option| {
                    let selected = option.id == segmented.value;
                    MenuItem::new(option.label.clone())
                        .icon_sized(Icon::new(option.icon).small().stroke(1.85))
                        .checked(selected)
                        .on_click(action(Action::Segment(option.id)))
                })
                .collect();
            row = row.child(self.file_menu(FileMenu::View, trigger, move |menu| {
                menu.max_h(px(VIEW_MENU_MAX_HEIGHT)).list(2., items)
            }));
        }
        if !controls.items.is_empty() {
            let label = tf("editor.panes.actionsFor", &[("name", name.into())]);
            let trigger = IconButton::new("file-settings", icon("ellipsis"))
                .label(label.clone())
                .tooltip(label)
                .with_size(px(size));
            let items: Vec<MenuItem> = controls
                .items
                .iter()
                .map(|item| {
                    let row =
                        MenuItem::new(item.label.clone()).on_click(action(Action::Item(item.id)));
                    match item.kind {
                        ItemKind::Toggle(on) => row.checked(on).stay_open(),
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
    /// divider on the document's colour, the name in the middle of the
    /// window clear of the traffic lights and the file's controls.
    pub(super) fn file_titlebar(&self, w: f32, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().header;
        let name = self
            .file_target
            .as_ref()
            .map(|f| f.name.clone())
            .unwrap_or_default();
        let room = theme::control() * 2. + CONTROLS_GAP;
        let start = if cfg!(target_os = "macos") {
            SAFE_START
        } else {
            0.
        };
        let side = start.max(room);
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
            .bg(t.canvas)
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
                    .min_w_0()
                    .px(px(6.))
                    .truncate()
                    .text_center()
                    .child(name),
            )
            .child(
                h_flex()
                    .flex_1()
                    .min_w(px(side))
                    .justify_end()
                    .children(self.file_controls(cx)),
            )
            // The divider, kept off the window frame's edge pixels.
            .child(
                div()
                    .absolute()
                    .left(px(1.))
                    .right(px(1.))
                    .bottom_0()
                    .h(px(1.))
                    .bg(t.shell_divider),
            )
            .into_any_element()
    }
    /// `askToSaveFile`: unsaved edits when a file window closes.
    pub(super) fn file_close_dialog(&self, cx: &mut Context<Self>) -> AnyElement {
        let name = self
            .file_target
            .as_ref()
            .map(|f| f.name.clone())
            .unwrap_or_default();
        self.simple_modal(
            &tf("native.fileClose.message", &[("name", name.into())]),
            tr("native.fileClose.detail"),
            vec![
                (
                    tr("native.fileClose.cancel"),
                    Command::CancelFileClose,
                    ButtonVariant::Secondary,
                ),
                (
                    tr("native.fileClose.discard"),
                    Command::DiscardFileChanges,
                    ButtonVariant::Secondary,
                ),
                (
                    tr("native.fileClose.save"),
                    Command::SaveFileAndClose,
                    ButtonVariant::Solid,
                ),
            ],
            cx,
        )
        .into_any_element()
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
    }
}
