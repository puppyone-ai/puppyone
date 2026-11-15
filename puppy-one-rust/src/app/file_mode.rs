//! File Mode (`FileModeApp`, `electron/main/file-mode.mjs`): one Markdown,
//! CSV or HTML file in a window of its own, opened from Finder or a second
//! launch.
//!
//! Markdown and CSV keep a focused reading/editing Header (`Edit`, `Source`).
//! Standalone HTML pages (`*.html` / `*.htm`) upgrade the 40px Header into an
//! instant interactive workspace:
//! - Leading file pill with Auto-Snapshot history (`v1 → v2 → …`) & folder actions
//! - Dynamic JS runtime error self-heal pill (hidden when 0 errors)
//! - Instant HTML actions: Reload/Reset (`↻`), Visual Edit (`✎`), Pick Element
//!   for Agent (`🎯`), Retina `<canvas>` Pen/Annotate (`🖊`), Screenshot (`✂`)
//! - Code & Local Agent split: Source Split (`</>`) + Local Agent `Chat` (`⌘L`)
//! - Cloud conversion: Brand Blue `Share` popover (live link + QR matrix / 1-click
//!   Cloud publish) + `⋯` More menu (Fullscreen presentation with laser pointer,
//!   Full-page stitched screenshot, Open in Browser, Reveal in Finder, Open Folder)

use super::{
    editor_area::EditorArea,
    header::TitleBar,
    panes::PaneLayout,
    right_sidebar::{RightSidebar, Surface as SidebarSurface},
    session::DocumentSession,
    window_cloud::WindowCloud,
    windows,
};
use crate::{
    editor::{
        host::DocumentEditor,
        viewers::{
            html_tools::{
                HtmlJsError, HtmlToolAction, HtmlToolEvent, HtmlToolMode, HtmlToolSnapshot,
            },
            text::{DOCUMENT_EDITING_TOGGLE_ID, DOCUMENT_SOURCE_PANEL_TOGGLE_ID},
        },
        workbench::pane::{Action, ItemKind},
    },
    features::{cloud::account as cloud_account, settings::PreferencesStore},
    geometry::Rect,
    localization::{t as tr, tf},
    platform::desktop,
    theme::{self, metric},
    ui::{
        agent_brands,
        appearance::ActiveAppearance,
        components::{
            Button, ButtonVariant, FileIcon, Icon, Menu, MenuItem, MenuVariant, PopoverMenu,
            ProductIcon, SurfaceFrame,
        },
        loading::{LoaderSize, LoadingMark, Tone},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Selectable as _, h_flex, v_flex},
    component::Sizable as _,
};
use std::path::{Path, PathBuf};

actions!(
    html_file_window,
    [
        HtmlReload,
        HtmlPickElement,
        HtmlAnnotate,
        HtmlScreenshot,
        HtmlToggleChat,
        HtmlToggleFullscreen,
    ]
);

const HTML_KEY_CONTEXT: &str = "HtmlFileWindow";

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-r", HtmlReload, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("ctrl-r", HtmlReload, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("cmd-shift-c", HtmlPickElement, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("ctrl-shift-c", HtmlPickElement, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("cmd-d", HtmlAnnotate, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("ctrl-d", HtmlAnnotate, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("cmd-shift-s", HtmlScreenshot, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("ctrl-shift-s", HtmlScreenshot, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("cmd-l", HtmlToggleChat, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("ctrl-l", HtmlToggleChat, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("cmd-shift-f", HtmlToggleFullscreen, Some(HTML_KEY_CONTEXT)),
        KeyBinding::new("ctrl-shift-f", HtmlToggleFullscreen, Some(HTML_KEY_CONTEXT)),
    ]);
}

/// `createWindow({ initialFilePath })`: a file window is 860 × 760.
pub const FILE_WINDOW_SIZE: (f32, f32) = (860., 760.);
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
/// Maximum retained in-memory auto-snapshots for standalone HTML files.
const MAX_HTML_SNAPSHOTS: usize = 8;

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

    pub fn is_html(&self) -> bool {
        let lower = self.name.to_ascii_lowercase();
        lower.ends_with(".html") || lower.ends_with(".htm")
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HtmlSnapshot {
    pub version: usize,
    pub text: String,
    pub initial: bool,
}

#[derive(Clone, Debug)]
struct ScreenshotToast {
    png: Vec<u8>,
    label: String,
}

/// Which Header menu is open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FileMenu {
    File,
    View,
    Share,
    Settings,
}

/// A file window's own state: the bound file, Header popovers, HTML snapshots
/// and screenshot clipboard banner.
pub struct FileWindow {
    pub target: FileTarget,
    pub(super) menu: Option<FileMenu>,
    docs: Entity<DocumentSession>,
    editor: Entity<EditorArea>,
    prefs: Entity<PreferencesStore>,
    sidebar: Entity<RightSidebar>,
    panes: Entity<PaneLayout>,
    cloud: Entity<WindowCloud>,
    focus: FocusHandle,
    weak: WeakEntity<Self>,
    observed_host: Option<(EntityId, Subscription)>,
    snapshots: Vec<HtmlSnapshot>,
    next_snapshot_version: usize,
    active_snapshot: Option<usize>,
    toast: Option<ScreenshotToast>,
    share_copied: bool,
}

impl FileWindow {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn new(
        target: FileTarget,
        docs: Entity<DocumentSession>,
        editor: Entity<EditorArea>,
        prefs: Entity<PreferencesStore>,
        sidebar: Entity<RightSidebar>,
        panes: Entity<PaneLayout>,
        cloud: Entity<WindowCloud>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.observe_in(&editor, window, |this, _, window, cx| {
            this.record_snapshot_if_needed(cx);
            this.ensure_host_observed(window, cx);
            cx.notify();
        })
        .detach();
        cx.observe(&prefs, |_, _, cx| cx.notify()).detach();
        cx.observe(&panes, |_, _, cx| cx.notify()).detach();
        cx.observe(&sidebar, |_, _, cx| cx.notify()).detach();
        cx.observe(&cloud, |_, _, cx| cx.notify()).detach();
        cx.observe_in(&docs, window, |this, _, window, cx| {
            this.record_snapshot_if_needed(cx);
            this.ensure_host_observed(window, cx);
            cx.notify();
        })
        .detach();
        let mut this = Self {
            target,
            menu: None,
            docs,
            editor,
            prefs,
            sidebar,
            panes,
            cloud,
            focus: cx.focus_handle(),
            weak: cx.weak_entity(),
            observed_host: None,
            snapshots: Vec::new(),
            next_snapshot_version: 1,
            active_snapshot: None,
            toast: None,
            share_copied: false,
        };
        this.record_snapshot_if_needed(cx);
        this.ensure_host_observed(window, cx);
        this
    }

    pub fn is_html(&self) -> bool {
        self.target.is_html()
    }

    pub(super) fn dismiss_escape(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if self.menu.take().is_some() {
            self.share_copied = false;
            cx.notify();
            return true;
        }
        if self.is_html()
            && let Some(editor) = self.file_editor(cx)
            && editor
                .read(cx)
                .html_tool_state()
                .is_some_and(|s| s.mode != HtmlToolMode::None)
        {
            editor.update(cx, |e, cx| e.set_html_tool(HtmlToolMode::None, window, cx));
            cx.notify();
            return true;
        }
        false
    }

    #[cfg(test)]
    pub fn snapshots(&self) -> &[HtmlSnapshot] {
        &self.snapshots
    }

    #[cfg(test)]
    pub fn active_snapshot_version(&self) -> Option<usize> {
        self.active_snapshot
    }

    #[cfg(test)]
    pub fn has_screenshot_toast(&self) -> bool {
        self.toast.is_some()
    }

    #[cfg(test)]
    pub fn paste_toast_to_chat(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(toast) = self.toast.take() {
            let prompt = tr("fileMode.html.promptScreenshot").to_owned();
            self.open_and_stage_chat(
                Some(("html-screenshot.png".into(), toast.png)),
                &prompt,
                window,
                cx,
            );
            cx.notify();
        }
    }

    fn record_snapshot_if_needed(&mut self, cx: &App) {
        if !self.is_html() {
            return;
        }
        let docs = self.docs.read(cx);
        if docs.dirty || docs.saving() {
            return;
        }
        let Some(doc) = &docs.document else {
            return;
        };
        if self.snapshots.last().is_some_and(|s| s.text == doc.text) {
            return;
        }
        // If user restored an earlier snapshot whose text equals `doc.text`, keep its version.
        if let Some(active_ver) = self.active_snapshot
            && let Some(existing) = self.snapshots.iter().find(|s| s.version == active_ver)
            && existing.text == doc.text
        {
            return;
        }
        let version = self.next_snapshot_version;
        self.next_snapshot_version += 1;
        let initial = self.snapshots.is_empty();
        self.snapshots.push(HtmlSnapshot {
            version,
            text: doc.text.clone(),
            initial,
        });
        if self.snapshots.len() > MAX_HTML_SNAPSHOTS {
            self.snapshots.remove(0);
        }
        self.active_snapshot = Some(version);
    }

    pub fn restore_snapshot(
        &mut self,
        version: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(text) = self
            .snapshots
            .iter()
            .find(|s| s.version == version)
            .map(|s| s.text.clone())
        else {
            return;
        };
        self.active_snapshot = Some(version);
        self.menu = None;
        if let Some(editor) = self.file_editor(cx) {
            editor.update(cx, |e, cx| e.replace_document_text(&text, window, cx));
        }
        cx.notify();
    }

    fn ensure_host_observed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(host) = self.file_editor(cx) else {
            return;
        };
        let id = host.entity_id();
        if self
            .observed_host
            .as_ref()
            .is_some_and(|(oid, _)| *oid == id)
        {
            return;
        }
        let sub = cx.observe_in(&host, window, |this, host, window, cx| {
            this.drain_html_events(&host, window, cx);
            cx.notify();
        });
        self.observed_host = Some((id, sub));
        self.drain_html_events(&host, window, cx);
    }

    fn drain_html_events(
        &mut self,
        host: &Entity<DocumentEditor>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let events = host.update(cx, |e, _| e.take_html_events());
        for ev in events {
            match ev {
                HtmlToolEvent::StateChanged => {}
                HtmlToolEvent::ElementPicked {
                    selector,
                    lines,
                    html_snippet,
                    ..
                } => {
                    let lines_str = match lines {
                        Some((a, b)) if a == b => format!(" (L{a})"),
                        Some((a, b)) => format!(" (L{a}–L{b})"),
                        None => String::new(),
                    };
                    let snippet = if html_snippet.is_empty() {
                        format!("<{selector}>")
                    } else {
                        html_snippet
                    };
                    let prompt = tf(
                        "fileMode.html.promptPicked",
                        &[
                            ("selector", selector.into()),
                            ("lines", lines_str.into()),
                            ("snippet", snippet.into()),
                        ],
                    );
                    self.open_and_stage_chat(None, &prompt, window, cx);
                }
                HtmlToolEvent::CopyScreenshot { png, label } => {
                    let image = gpui::Image::from_bytes(gpui::ImageFormat::Png, png.clone());
                    cx.write_to_clipboard(ClipboardItem::new_image(&image));
                    self.toast = Some(ScreenshotToast { png, label });
                }
                HtmlToolEvent::SendAnnotatedToAgent { png, stroke_count } => {
                    let image = gpui::Image::from_bytes(gpui::ImageFormat::Png, png.clone());
                    cx.write_to_clipboard(ClipboardItem::new_image(&image));
                    let count = stroke_count.max(1);
                    let prompt = tf(
                        "fileMode.html.promptAnnotated",
                        &[("count", count.to_string().into())],
                    );
                    self.open_and_stage_chat(
                        Some(("annotated-page.png".into(), png)),
                        &prompt,
                        window,
                        cx,
                    );
                }
            }
        }
    }

    pub fn toggle_chat(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.is_html() {
            return;
        }
        let open = self.panes.read(cx).right().open;
        if open {
            self.panes.update(cx, |p, cx| p.set_right_open(false, cx));
        } else {
            self.ensure_chat_drawer_open(window, cx);
        }
        cx.notify();
    }

    fn ensure_chat_drawer_open(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<Entity<crate::features::desktop_agent::AgentChatTabPanel>> {
        let root = self.target.root.clone();
        self.sidebar.update(cx, |s, cx| s.enter_file_mode(root, cx));
        self.panes.update(cx, |p, cx| p.set_right_open(true, cx));
        let sidebar = self.sidebar.clone();
        sidebar.update(cx, |s, cx| s.ensure_active_chat(window, cx))
    }

    pub fn open_and_stage_chat(
        &mut self,
        png: Option<(String, Vec<u8>)>,
        prompt: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let rel_name = self.target.name.clone();
        if let Some(panel) = self.ensure_chat_drawer_open(window, cx) {
            panel.update(cx, |p, cx| {
                p.stage_html_context(&rel_name, png, prompt, window, cx);
            });
        }
    }

    pub fn stage_js_errors_to_chat(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let errors: Vec<HtmlJsError> = self
            .file_editor(cx)
            .and_then(|e| e.read(cx).html_tool_state())
            .map(|s| s.js_errors)
            .unwrap_or_default();
        if errors.is_empty() {
            return;
        }
        let formatted = errors
            .iter()
            .enumerate()
            .map(|(idx, err)| match (err.line, err.column) {
                (Some(l), Some(c)) => format!("{}. [L{l}:{c}] {}", idx + 1, err.message),
                (Some(l), None) => format!("{}. [L{l}] {}", idx + 1, err.message),
                _ => format!("{}. {}", idx + 1, err.message),
            })
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = tf(
            "fileMode.html.promptFixErrors",
            &[
                ("count", errors.len().to_string().into()),
                ("errors", formatted.into()),
            ],
        );
        self.open_and_stage_chat(None, &prompt, window, cx);
    }

    pub fn toggle_html_tool(
        &mut self,
        wanted: HtmlToolMode,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(editor) = self.file_editor(cx) else {
            return;
        };
        let current = editor
            .read(cx)
            .html_tool_state()
            .map(|s| s.mode)
            .unwrap_or(HtmlToolMode::None);
        let next = if current == wanted {
            HtmlToolMode::None
        } else {
            wanted
        };
        editor.update(cx, |e, cx| e.set_html_tool(next, window, cx));
        cx.notify();
    }

    pub fn run_html_action(
        &mut self,
        action: HtmlToolAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(editor) = self.file_editor(cx) {
            editor.update(cx, |e, cx| e.trigger_html_action(action, window, cx));
        }
        cx.notify();
    }

    fn toggle_fullscreen_presentation(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let entering = !window.is_fullscreen();
        window.toggle_fullscreen();
        if let Some(editor) = self.file_editor(cx) {
            let mode = if entering {
                HtmlToolMode::Laser
            } else {
                HtmlToolMode::None
            };
            editor.update(cx, |e, cx| e.set_html_tool(mode, window, cx));
        }
        cx.notify();
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

/// `createFileModeExtensions`: every extension a file window opens, from
/// the file format registry. One list decides File Mode, the CLI's
/// declaration in Info.plist and the protocol's `hello`.
pub fn file_mode_extensions() -> Vec<String> {
    let mut extensions: Vec<String> = vec![".html".into(), ".htm".into()];
    for format in crate::formats::all() {
        if matches!(format.id.as_str(), "markdown" | "csv") {
            for extension in &format.extensions {
                let extension = extension.to_lowercase();
                if extension.starts_with('.') && !extensions.contains(&extension) {
                    extensions.push(extension);
                }
            }
        }
    }
    // `.agent.md` adds nothing once `.md` is listed.
    let covered = |extension: &String, all: &[String]| {
        all.iter()
            .any(|other| other != extension && extension.ends_with(other.as_str()))
    };
    let mut kept: Vec<String> = extensions
        .iter()
        .filter(|e| !covered(e, &extensions))
        .cloned()
        .collect();
    kept.sort();
    kept
}

/// `.file-mode-window__action`: a compact Header icon button (`28 × 24`).
fn header_action(id: &'static str, icon: Icon, label: SharedString) -> Button {
    Button::new(id)
        .variant(ButtonVariant::Titlebar)
        .icon(icon)
        .accessibility_label(label.clone())
        .tooltip(label)
        .w(px(theme::control_compact()))
        .px_0()
}

/// Renders a crisp deterministic 21×21 QR-style visual code matrix for a live
/// Cloud URL using pure GPUI primitives (zero external crate overhead).
fn render_qr_matrix(url: &str, t: &theme::Theme) -> Div {
    const N: usize = 21;
    let digest = blake3::hash(url.as_bytes());
    let bytes = digest.as_bytes();
    let finder = |r: usize, c: usize, r0: usize, c0: usize| -> Option<bool> {
        if r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7 {
            let dr = r - r0;
            let dc = c - c0;
            let border = dr == 0 || dr == 6 || dc == 0 || dc == 6;
            let core = (2..=4).contains(&dr) && (2..=4).contains(&dc);
            return Some(border || core);
        }
        if r + 1 >= r0 && r < r0 + 8 && c + 1 >= c0 && c < c0 + 8 {
            return Some(false);
        }
        None
    };
    let cell_px = 5.;
    let ink = t.text;
    let mut grid = v_flex()
        .p(px(8.))
        .rounded(px(8.))
        .bg(t.canvas)
        .border_1()
        .border_color(t.border)
        .gap_0();
    for r in 0..N {
        let mut row = h_flex().gap_0();
        for c in 0..N {
            let on = finder(r, c, 0, 0)
                .or_else(|| finder(r, c, 0, N - 7))
                .or_else(|| finder(r, c, N - 7, 0))
                .unwrap_or_else(|| {
                    if r == 6 || c == 6 {
                        (r + c) % 2 == 0
                    } else {
                        let bit_idx = (r * N + c) % (bytes.len() * 8);
                        (bytes[bit_idx / 8] >> (bit_idx % 8)) & 1 == 1
                    }
                });
            row = row.child(div().size(px(cell_px)).when(on, |d| d.bg(ink)));
        }
        grid = grid.child(row);
    }
    grid
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
    pub(super) fn file_editor(&self, cx: &App) -> Option<Entity<DocumentEditor>> {
        self.editor
            .read(cx)
            .host(self.docs.read(cx).active_slot())
            .cloned()
    }

    fn file_menu(
        &self,
        menu: FileMenu,
        anchor: Anchor,
        trigger: Button,
        build: impl FnOnce(Menu) -> Menu + 'static,
    ) -> PopoverMenu {
        let open = self.menu == Some(menu);
        let host = self.weak.clone();
        PopoverMenu::new(match menu {
            FileMenu::File => "file-context-menu",
            FileMenu::View => "file-view-menu",
            FileMenu::Share => "file-share-menu",
            FileMenu::Settings => "file-settings-menu",
        })
        .anchor(anchor)
        .offset(px(4.))
        .open(open)
        .on_open_change(move |opened, _, cx| {
            let _ = host.update(cx, |s, cx| {
                if *opened != (s.menu == Some(menu)) {
                    s.menu = opened.then_some(menu);
                    if !*opened {
                        s.share_copied = false;
                    }
                    cx.notify();
                }
            });
        })
        .trigger(trigger.open(open))
        .menu(move |surface, _, _| build(surface.variant(MenuVariant::Default)))
    }

    fn share_popover(&self, trigger: Button, cx: &App) -> PopoverMenu {
        let open = self.menu == Some(FileMenu::Share);
        let host = self.weak.clone();
        let host_body = self.weak.clone();
        let cloud_entity = self.cloud.clone();
        let file_root = self.target.root.clone();
        let file_name = self.target.name.clone();
        let copied_now = self.share_copied;

        let signed_in = cloud_account::snapshot(cx)
            .as_ref()
            .and_then(|s| s.account.as_ref())
            .map(|a| a.email.clone());
        let web_origin = cloud_account::environment(cx)
            .map(|e| e.web().to_owned())
            .unwrap_or_else(|| "https://www.puppyone.ai".into());
        let published_id = self.cloud.read(cx).publish.read(cx).published.clone();
        let live_url =
            published_id.map(|id| format!("{}/projects/{}", web_origin.trim_end_matches('/'), id));

        PopoverMenu::new("file-share-popover")
            .anchor(Anchor::TopRight)
            .offset(px(6.))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    if *opened != (s.menu == Some(FileMenu::Share)) {
                        s.menu = opened.then_some(FileMenu::Share);
                        if !*opened {
                            s.share_copied = false;
                        }
                        cx.notify();
                    }
                });
            })
            .trigger(trigger.open(open))
            .content(move |dismiss, _, cx| {
                let t = cx.palette();
                let ty = theme::ty().ui;
                let benefit = |icon_name: &'static str, text: SharedString| {
                    h_flex()
                        .items_start()
                        .gap(px(8.))
                        .child(
                            div().mt(px(2.)).flex_none().child(
                                Icon::new(icon_name)
                                    .with_size(px(14.))
                                    .stroke(1.85)
                                    .color(t.brand_blue),
                            ),
                        )
                        .child(
                            div()
                                .flex_1()
                                .text_size(px(ty.meta))
                                .text_color(t.muted)
                                .child(text),
                        )
                };

                let mut card = SurfaceFrame::popover_card("html-share-card")
                    .radius(10.)
                    .stroke(t.border)
                    .w(px(316.))
                    .p(px(14.))
                    .gap(px(12.))
                    .child(
                        v_flex()
                            .gap(px(4.))
                            .child(
                                h_flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .child(
                                        Icon::product(ProductIcon::Cloud)
                                            .with_size(px(15.))
                                            .stroke(1.9)
                                            .color(t.brand_blue),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(ty.body))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(t.text)
                                            .child(tr("fileMode.html.shareTitle")),
                                    ),
                            )
                            .child(
                                div()
                                    .text_size(px(ty.meta))
                                    .text_color(t.subtle)
                                    .child(tr("fileMode.html.shareSubtitle")),
                            ),
                    );

                if let Some(url) = live_url.clone() {
                    let copy_url = url.clone();
                    let open_url = url.clone();
                    let host_copy = host_body.clone();
                    card = card
                        .child(
                            h_flex()
                                .items_center()
                                .gap(px(6.))
                                .px(px(8.))
                                .py(px(6.))
                                .rounded(px(6.))
                                .bg(t.inset)
                                .border_1()
                                .border_color(t.divider)
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .truncate()
                                        .text_size(px(ty.meta))
                                        .text_color(t.text)
                                        .child(url.clone()),
                                )
                                .child(
                                    Button::new("html-share-copy-link")
                                        .small()
                                        .variant(ButtonVariant::FilledPrimary)
                                        .icon(if copied_now { "check" } else { "copy" })
                                        .label(tr(if copied_now {
                                            "fileMode.html.shareCopied"
                                        } else {
                                            "fileMode.html.shareCopyLink"
                                        }))
                                        .on_click(move |_, _, cx| {
                                            cx.write_to_clipboard(ClipboardItem::new_string(
                                                copy_url.clone(),
                                            ));
                                            let _ = host_copy.update(cx, |s, cx| {
                                                s.share_copied = true;
                                                cx.notify();
                                            });
                                        }),
                                )
                                .child(
                                    Button::new("html-share-open-link")
                                        .small()
                                        .variant(ButtonVariant::Outline)
                                        .icon("external-link")
                                        .accessibility_label(tr("fileMode.html.openInBrowser"))
                                        .on_click(move |_, _, cx| {
                                            cx.open_url(&open_url);
                                        }),
                                ),
                        )
                        .child(
                            v_flex()
                                .items_center()
                                .gap(px(6.))
                                .py(px(4.))
                                .child(render_qr_matrix(&url, &t))
                                .child(
                                    div()
                                        .text_size(px(ty.meta))
                                        .text_color(t.subtle)
                                        .child(tr("fileMode.html.shareQrHint")),
                                ),
                        );
                } else {
                    card = card.child(
                        v_flex()
                            .gap(px(8.))
                            .p(px(10.))
                            .rounded(px(8.))
                            .bg(theme::alpha(t.inset, 0.65))
                            .child(benefit(
                                "link-2",
                                tr("fileMode.html.shareBenefitLink").into(),
                            ))
                            .child(benefit(
                                "sparkles",
                                tr("fileMode.html.shareBenefitQr").into(),
                            ))
                            .child(benefit("bot", tr("fileMode.html.shareBenefitAgent").into())),
                    );
                    if let Some(email) = signed_in {
                        let cloud_for_click = cloud_entity.clone();
                        let root_for_click = file_root.clone();
                        let name_for_click = file_name.clone();
                        let dismiss_click = dismiss.clone();
                        card = card
                            .child(
                                div()
                                    .text_size(px(ty.meta))
                                    .text_color(t.subtle)
                                    .truncate()
                                    .child(email),
                            )
                            .child(
                                Button::new("html-share-publish-cta")
                                    .w_full()
                                    .variant(ButtonVariant::FilledPrimary)
                                    .icon(
                                        Icon::product(ProductIcon::Cloud)
                                            .with_size(px(14.))
                                            .stroke(1.9),
                                    )
                                    .label(tr("fileMode.html.sharePublishCta"))
                                    .on_click(move |_, w, cx| {
                                        dismiss_click(w, cx);
                                        cloud_for_click.update(cx, |c, cx| {
                                            c.open_file_mode_publish(
                                                root_for_click.clone(),
                                                name_for_click.clone(),
                                                cx,
                                            );
                                        });
                                    }),
                            );
                    } else {
                        let dismiss_click = dismiss.clone();
                        card = card.child(
                            Button::new("html-share-signin-cta")
                                .w_full()
                                .variant(ButtonVariant::FilledPrimary)
                                .icon(
                                    Icon::product(ProductIcon::Cloud)
                                        .with_size(px(14.))
                                        .stroke(1.9),
                                )
                                .label(tr("fileMode.html.shareSignInCta"))
                                .on_click(move |_, w, cx| {
                                    dismiss_click(w, cx);
                                    if cloud_account::available(cx) {
                                        cloud_account::sign_in(cx);
                                    } else {
                                        cx.open_url("https://www.puppyone.ai");
                                    }
                                }),
                        );
                    }
                }
                card
            })
    }

    fn html_file_header(
        &self,
        editor: Entity<DocumentEditor>,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> TitleBar {
        let t = cx.palette();
        let ty = theme::ty().header;
        let icon_theme = self.prefs.read(cx).state.file_icon_theme.clone();
        let tool_state: HtmlToolSnapshot = editor.read(cx).html_tool_state().unwrap_or_default();
        let controls = editor.read(cx).title_controls(cx);

        // -------------------- Leading Zone: File Pill + Snapshots + JS Error Self-Heal Pill
        let ver_badge = self.active_snapshot.map(|v| {
            div()
                .px(px(5.))
                .py(px(1.))
                .rounded(px(4.))
                .bg(theme::alpha(t.brand_blue, 0.14))
                .text_size(px(11.))
                .text_color(t.brand_blue)
                .child(format!("v{v}"))
        });
        let pill_content = h_flex()
            .id("file-mode-title")
            .debug_selector(|| "file-mode-title".into())
            .items_center()
            .min_w_0()
            .max_w(px(220.))
            .gap(px(metric::MENU_ITEM_GAP))
            .text_color(t.text)
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .child(FileIcon::file(self.target.name.clone(), icon_theme).size_px(15.))
            .child(
                div()
                    .id("file-mode-name")
                    .debug_selector(|| "file-mode-name".into())
                    .min_w_0()
                    .truncate()
                    .child(self.target.name.clone()),
            )
            .children(ver_badge)
            .child(
                Icon::new("chevron-down")
                    .with_size(px(12.))
                    .stroke(1.9)
                    .color(t.subtle),
            );
        let file_trigger = Button::new("file-mode-context-btn")
            .variant(ButtonVariant::Titlebar)
            .accessibility_label(self.target.name.clone())
            .trailing(pill_content);

        let snapshots = self.snapshots.clone();
        let active_ver = self.active_snapshot;
        let host_for_snap = self.weak.clone();
        let file_path_reveal = self.target.path.clone();
        let proj_root = self.target.root.clone();
        let proj_file = self.target.name.clone();
        let subtle = t.subtle;

        let leading_menu = self.file_menu(
            FileMenu::File,
            Anchor::TopLeft,
            file_trigger,
            move |mut menu| {
                if !snapshots.is_empty() {
                    let mut snap_items = Vec::new();
                    for snap in snapshots.iter().rev() {
                        let ver = snap.version;
                        let is_cur = active_ver == Some(ver);
                        let desc = if is_cur {
                            tr("fileMode.html.snapshotCurrent")
                        } else if snap.initial {
                            tr("fileMode.html.snapshotInitial")
                        } else {
                            tr("fileMode.html.snapshotSaved")
                        };
                        let host = host_for_snap.clone();
                        let row = MenuItem::new(format!("v{ver} · {desc}"))
                            .icon_sized(Icon::new("history").with_size(px(14.)).stroke(1.8))
                            .on_click(move |w, cx| {
                                let _ = host.update(cx, |s, cx| s.restore_snapshot(ver, w, cx));
                            });
                        let row = if is_cur {
                            row.trailing(
                                Icon::new("check")
                                    .with_size(px(14.))
                                    .stroke(1.85)
                                    .color(subtle),
                            )
                        } else {
                            row
                        };
                        snap_items.push(row);
                    }
                    menu = menu.list(2., snap_items).separator();
                }
                let reveal_path = file_path_reveal.clone();
                let open_root = proj_root.clone();
                let open_name = proj_file.clone();
                menu.list(
                    2.,
                    vec![
                        MenuItem::new(tr("fileMode.html.revealInFinder"))
                            .icon_sized(
                                Icon::product(ProductIcon::Folder)
                                    .with_size(px(14.))
                                    .stroke(1.8),
                            )
                            .on_click(move |_, _| {
                                let _ = desktop::reveal(&reveal_path);
                            }),
                        MenuItem::new(tr("fileMode.html.openFolderAsProject"))
                            .icon_sized(Icon::new("external-link").with_size(px(14.)).stroke(1.8))
                            .on_click(move |_, cx| {
                                let _ = windows::open_created(
                                    open_root.clone(),
                                    Some(PathBuf::from(&open_name)),
                                    cx,
                                );
                            }),
                    ],
                )
            },
        );

        let mut bar = TitleBar::new().leading(leading_menu);

        // Quick 1-click snapshot undo when >= 2 snapshots exist
        if self.snapshots.len() >= 2 {
            let cur_idx = self
                .active_snapshot
                .and_then(|v| self.snapshots.iter().position(|s| s.version == v))
                .unwrap_or(self.snapshots.len() - 1);
            if cur_idx > 0 {
                let prev_ver = self.snapshots[cur_idx - 1].version;
                let tip: SharedString = tf(
                    "fileMode.html.quickRestore",
                    &[("version", format!("v{prev_ver}").into())],
                )
                .into();
                let host = self.weak.clone();
                bar = bar.leading(
                    header_action(
                        "file-mode-quick-restore",
                        Icon::new("undo-2").with_size(px(14.)).stroke(1.85),
                        tip,
                    )
                    .on_click(move |_, w, cx| {
                        let _ = host.update(cx, |s, cx| s.restore_snapshot(prev_ver, w, cx));
                    }),
                );
            }
        }

        // Dynamic JS Error Self-Heal Pill (completely hidden when 0 errors!)
        if !tool_state.js_errors.is_empty() {
            let err_label: SharedString = tf(
                "fileMode.html.jsErrorPill",
                &[("count", tool_state.js_errors.len().to_string().into())],
            )
            .into();
            let host = self.weak.clone();
            bar = bar.leading(
                Button::new("file-mode-js-error")
                    .small()
                    .variant(ButtonVariant::OutlineDanger)
                    .icon(Icon::new("triangle-alert").with_size(px(13.)).stroke(1.9))
                    .label(err_label.clone())
                    .tooltip(err_label)
                    .on_click(move |_, w, cx| {
                        let _ = host.update(cx, |s, cx| s.stage_js_errors_to_chat(w, cx));
                    }),
            );
        }

        // -------------------- Trailing Group 1: Instant HTML Actions (NO mobile viewport preview!)
        let icon = |name: &'static str| Icon::new(name).with_size(px(15.)).stroke(1.8);
        let pane_action = |action: Action| {
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

        // 1. Reload / Reset State (`↻`)
        {
            let host = self.weak.clone();
            bar = bar.action(
                header_action(
                    "html-tool-reload",
                    icon("refresh-cw"),
                    tr("fileMode.html.reload").into(),
                )
                .on_click(move |_, w, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.run_html_action(HtmlToolAction::ReloadAndReset, w, cx);
                    });
                }),
            );
        }

        // 2. Visual Edit (`✎`)
        if let Some(edit_toggle) = controls
            .toggles
            .iter()
            .find(|sw| sw.id == DOCUMENT_EDITING_TOGGLE_ID)
        {
            let run = pane_action(Action::Item(edit_toggle.id));
            bar = bar.action(
                header_action(
                    edit_toggle.id,
                    icon(edit_toggle.icon),
                    edit_toggle.label.clone(),
                )
                .selected(edit_toggle.checked)
                .on_click(move |_, w, cx| run(w, cx)),
            );
        }

        // 3. Pick Element (`🎯`)
        {
            let host = self.weak.clone();
            bar = bar.action(
                header_action(
                    "html-tool-pick",
                    icon("mouse-pointer-2"),
                    tr("fileMode.html.pick").into(),
                )
                .selected(tool_state.mode == HtmlToolMode::PickElement)
                .on_click(move |_, w, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.toggle_html_tool(HtmlToolMode::PickElement, w, cx);
                    });
                }),
            );
        }

        // 4. Pen / Annotate (`🖊`)
        {
            let host = self.weak.clone();
            let mut btn = header_action(
                "html-tool-annotate",
                icon("agent-glyph-pen"),
                tr("fileMode.html.annotate").into(),
            )
            .selected(tool_state.mode == HtmlToolMode::Annotate)
            .on_click(move |_, w, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.toggle_html_tool(HtmlToolMode::Annotate, w, cx);
                });
            });
            if tool_state.has_annotations {
                btn = btn.trailing(div().size(px(5.)).rounded_full().bg(t.brand_blue));
            }
            bar = bar.action(btn);
        }

        // 5. Screenshot (`✂`)
        {
            let host = self.weak.clone();
            bar = bar.action(
                header_action(
                    "html-tool-screenshot",
                    icon("scissors"),
                    tr("fileMode.html.screenshot").into(),
                )
                .selected(tool_state.mode == HtmlToolMode::Screenshot)
                .on_click(move |_, w, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.toggle_html_tool(HtmlToolMode::Screenshot, w, cx);
                    });
                }),
            );
        }

        bar = bar.divider(cx);

        // -------------------- Trailing Group 2: Code Split (`</>`) + Local Agent `Chat`
        if let Some(src_toggle) = controls
            .toggles
            .iter()
            .find(|sw| sw.id == DOCUMENT_SOURCE_PANEL_TOGGLE_ID)
        {
            let run = pane_action(Action::Item(src_toggle.id));
            bar = bar.action(
                header_action(
                    src_toggle.id,
                    icon(src_toggle.icon),
                    src_toggle.label.clone(),
                )
                .selected(src_toggle.checked)
                .on_click(move |_, w, cx| run(w, cx)),
            );
        }

        {
            let chat_open = self.sidebar.read(cx).shows(SidebarSurface::Agent, cx);
            let brand = self.sidebar.read(cx).active_agent_brand(cx);
            let chat_inner = h_flex()
                .items_center()
                .gap(px(5.))
                .px(px(2.))
                .child(match brand {
                    Some(b) => agent_brands::image(b, t.dark, 14.).into_any_element(),
                    None => icon("agent-entry").into_any_element(),
                })
                .child(
                    div()
                        .text_size(px(ty.content))
                        .line_height(px(ty.line_height))
                        .child(tr("fileMode.html.chat")),
                );
            let host = self.weak.clone();
            let chat_tip: SharedString = tr("fileMode.html.chatTooltip").into();
            bar = bar.action(
                Button::new("html-tool-chat")
                    .variant(ButtonVariant::Titlebar)
                    .accessibility_label(chat_tip.clone())
                    .tooltip(chat_tip)
                    .selected(chat_open)
                    .trailing(chat_inner)
                    .on_click(move |_, w, cx| {
                        let _ = host.update(cx, |s, cx| s.toggle_chat(w, cx));
                    }),
            );
        }

        bar = bar.divider(cx);

        // -------------------- Trailing Group 3: Brand Blue `Share` CTA + `⋯` More Menu
        {
            let share_tip: SharedString = tr("fileMode.html.shareTooltip").into();
            let share_btn = Button::new("html-tool-share")
                .small()
                .variant(ButtonVariant::FilledPrimary)
                .icon(
                    Icon::product(ProductIcon::Cloud)
                        .with_size(px(13.))
                        .stroke(1.9),
                )
                .label(tr("fileMode.html.share"))
                .accessibility_label(share_tip.clone())
                .tooltip(share_tip);
            bar = bar.action(self.share_popover(share_btn, cx));
        }

        {
            let more_label: SharedString = tf(
                "editor.panes.actionsFor",
                &[("name", self.target.name.clone().into())],
            )
            .into();
            let more_trigger = header_action("file-settings", icon("ellipsis"), more_label);
            let is_fullscreen = window.is_fullscreen();
            let has_annotations = tool_state.has_annotations;
            let host_fs = self.weak.clone();
            let host_fp = self.weak.clone();
            let host_clr = self.weak.clone();
            let browser_path = self.target.path.clone();
            let finder_path = self.target.path.clone();
            let proj_root = self.target.root.clone();
            let proj_name = self.target.name.clone();
            let extra_items: Vec<MenuItem> =
                controls
                    .items
                    .iter()
                    .map(|item| {
                        let row = MenuItem::new(item.label.clone())
                            .on_click(pane_action(Action::Item(item.id)));
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

            bar = bar.action(self.file_menu(
                FileMenu::Settings,
                Anchor::TopRight,
                more_trigger,
                move |mut menu| {
                    let mut top_group = vec![
                        MenuItem::new(tr(if is_fullscreen {
                            "fileMode.html.exitFullscreen"
                        } else {
                            "fileMode.html.presentFullscreen"
                        }))
                        .icon_sized(Icon::new("monitor").with_size(px(14.)).stroke(1.8))
                        .on_click(move |w, cx| {
                            let _ = host_fs.update(cx, |s, cx| {
                                s.menu = None;
                                s.toggle_fullscreen_presentation(w, cx);
                            });
                        }),
                        MenuItem::new(tr("fileMode.html.captureFullPage"))
                            .icon_sized(Icon::new("scissors").with_size(px(14.)).stroke(1.8))
                            .on_click(move |w, cx| {
                                let _ = host_fp.update(cx, |s, cx| {
                                    s.menu = None;
                                    s.run_html_action(HtmlToolAction::CaptureFullPage, w, cx);
                                });
                            }),
                    ];
                    if has_annotations {
                        top_group.push(
                            MenuItem::new(tr("fileMode.html.clearAnnotations"))
                                .icon_sized(Icon::new("trash-2").with_size(px(14.)).stroke(1.8))
                                .on_click(move |w, cx| {
                                    let _ = host_clr.update(cx, |s, cx| {
                                        s.menu = None;
                                        s.run_html_action(HtmlToolAction::ClearAnnotations, w, cx);
                                    });
                                }),
                        );
                    }
                    menu = menu.list(2., top_group).separator().list(
                        2.,
                        vec![
                            MenuItem::new(tr("fileMode.html.openInBrowser"))
                                .icon_sized(Icon::new("globe-2").with_size(px(14.)).stroke(1.8))
                                .on_click(move |_, _| {
                                    let _ = desktop::open(&browser_path);
                                }),
                            MenuItem::new(tr("fileMode.html.revealInFinder"))
                                .icon_sized(
                                    Icon::product(ProductIcon::Folder)
                                        .with_size(px(14.))
                                        .stroke(1.8),
                                )
                                .on_click(move |_, _| {
                                    let _ = desktop::reveal(&finder_path);
                                }),
                            MenuItem::new(tr("fileMode.html.openFolderAsProject"))
                                .icon_sized(
                                    Icon::new("external-link").with_size(px(14.)).stroke(1.8),
                                )
                                .on_click(move |_, cx| {
                                    let _ = windows::open_created(
                                        proj_root.clone(),
                                        Some(PathBuf::from(&proj_name)),
                                        cx,
                                    );
                                }),
                        ],
                    );
                    if !extra_items.is_empty() {
                        menu = menu.separator().list(2., extra_items);
                    }
                    menu
                },
            ));
        }

        bar
    }

    /// `FileHeaderContext` + `FileControls` inside the product `Header`.
    fn file_header(&self, window: &Window, cx: &mut Context<Self>) -> TitleBar {
        if self.is_html()
            && self.target.admission == Admission::Readable
            && let Some(editor) = self.file_editor(cx)
        {
            return self.html_file_header(editor, window, cx);
        }

        let t = cx.palette();
        let ty = theme::ty().header;
        let icon_theme = self.prefs.read(cx).state.file_icon_theme.clone();
        let title = h_flex()
            .id("file-mode-title")
            .debug_selector(|| "file-mode-title".into())
            .min_w_0()
            .max_w_full()
            .px(px(6.))
            .gap(px(metric::MENU_ITEM_GAP))
            .text_color(t.muted)
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .child(FileIcon::file(self.target.name.clone(), icon_theme).size_px(15.))
            .child(
                div()
                    .id("file-mode-name")
                    .debug_selector(|| "file-mode-name".into())
                    .min_w_0()
                    .truncate()
                    .child(self.target.name.clone()),
            );
        let mut bar = TitleBar::new().leading(title);
        if self.target.admission != Admission::Readable {
            return bar;
        }
        let Some(editor) = self.file_editor(cx) else {
            return bar;
        };
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
        let icon = |name: &'static str| Icon::new(name).with_size(px(15.)).stroke(1.8);
        let subtle = t.subtle;

        for toggle in &controls.toggles {
            let run = action(Action::Item(toggle.id));
            bar = bar.action(
                header_action(toggle.id, icon(toggle.icon), toggle.label.clone())
                    .selected(toggle.checked)
                    .on_click(move |_, w, cx| run(w, cx)),
            );
        }

        if let Some(segmented) = controls.segmented.clone() {
            let current = segmented
                .options
                .iter()
                .find(|o| o.id == segmented.value)
                .or(segmented.options.first())
                .cloned();
            let label: SharedString = match &current {
                Some(option) => format!("{}: {}", segmented.label, option.label).into(),
                None => segmented.label.clone(),
            };
            let trigger = header_action(
                "file-view-mode",
                icon(current.as_ref().map_or("eye", |o| o.icon)),
                label,
            );
            let items: Vec<MenuItem> = segmented
                .options
                .iter()
                .map(|option| {
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
            bar = bar.action(self.file_menu(
                FileMenu::View,
                Anchor::TopRight,
                trigger,
                move |menu| menu.max_h(px(VIEW_MENU_MAX_HEIGHT)).list(2., items),
            ));
        }

        if !controls.items.is_empty()
            && (!controls.toggles.is_empty() || controls.segmented.is_some())
        {
            bar = bar.divider(cx);
        }

        if !controls.items.is_empty() {
            let label: SharedString =
                tf("editor.panes.actionsFor", &[("name", name.into())]).into();
            let trigger = header_action("file-settings", icon("ellipsis"), label);
            let items: Vec<MenuItem> =
                controls
                    .items
                    .iter()
                    .map(|item| {
                        let row = MenuItem::new(item.label.clone())
                            .on_click(action(Action::Item(item.id)));
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
            bar = bar.action(self.file_menu(
                FileMenu::Settings,
                Anchor::TopRight,
                trigger,
                move |menu| menu.list(2., items),
            ));
        }

        bar
    }

    /// `.file-mode-window__document`: the document (under the encoding
    /// notice and screenshot clipboard toast), or what stands in for it.
    fn file_document(&self, r: Rect, cx: &mut Context<Self>) -> Stateful<Div> {
        let t = cx.palette();
        let area = div()
            .id("file-mode-document")
            .occlude()
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
                let notice = self.editor.read(cx).read_only(cx).then(|| {
                    div()
                        .id("file-mode-encoding-notice")
                        .flex_none()
                        .py(px(NOTICE_PADDING.0))
                        .px(px(NOTICE_PADDING.1))
                        .border_b_1()
                        .border_color(t.divider)
                        .text_color(t.muted)
                        .text_size(px(ty.content))
                        .line_height(px(ty.line_height))
                        .child(tr("editor.fileMode.readOnlyEncoding"))
                });
                let toast_bar = self.toast.as_ref().map(|toast| {
                    let msg = tf(
                        "fileMode.html.toastCopied",
                        &[("label", toast.label.clone().into())],
                    );
                    let png = toast.png.clone();
                    let host_paste = self.weak.clone();
                    let host_close = self.weak.clone();
                    h_flex()
                        .id("file-mode-toast")
                        .flex_none()
                        .items_center()
                        .justify_between()
                        .gap(px(8.))
                        .py(px(6.))
                        .px(px(12.))
                        .bg(theme::alpha(t.brand_blue, 0.10))
                        .border_b_1()
                        .border_color(t.divider)
                        .child(
                            h_flex()
                                .items_center()
                                .gap(px(6.))
                                .min_w_0()
                                .child(
                                    Icon::new("check")
                                        .with_size(px(14.))
                                        .stroke(2.)
                                        .color(t.success),
                                )
                                .child(
                                    div()
                                        .text_size(px(ty.content))
                                        .line_height(px(ty.line_height))
                                        .text_color(t.text)
                                        .truncate()
                                        .child(msg),
                                ),
                        )
                        .child(
                            h_flex()
                                .items_center()
                                .gap(px(4.))
                                .child(
                                    Button::new("file-mode-toast-paste")
                                        .small()
                                        .variant(ButtonVariant::FilledPrimary)
                                        .icon(
                                            Icon::new("clipboard-paste")
                                                .with_size(px(13.))
                                                .stroke(1.9),
                                        )
                                        .label(tr("fileMode.html.toastPasteChat"))
                                        .on_click(move |_, w, cx| {
                                            let bytes = png.clone();
                                            let _ = host_paste.update(cx, |s, cx| {
                                                s.toast = None;
                                                let prompt =
                                                    tr("fileMode.html.promptScreenshot").to_owned();
                                                s.open_and_stage_chat(
                                                    Some(("html-screenshot.png".into(), bytes)),
                                                    &prompt,
                                                    w,
                                                    cx,
                                                );
                                                cx.notify();
                                            });
                                        }),
                                )
                                .child(
                                    Button::new("file-mode-toast-dismiss")
                                        .small()
                                        .variant(ButtonVariant::Titlebar)
                                        .icon(Icon::new("x").with_size(px(13.)).stroke(1.9))
                                        .accessibility_label("Dismiss")
                                        .on_click(move |_, _, cx| {
                                            let _ = host_close.update(cx, |s, cx| {
                                                s.toast = None;
                                                cx.notify();
                                            });
                                        }),
                                ),
                        )
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
                area.children(notice).children(toast_bar).children(document)
            }
        }
    }
}

impl Render for FileWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::web_host::frame_drawn(window);
        self.record_snapshot_if_needed(cx);
        self.ensure_host_observed(window, cx);
        let size = window.viewport_size();
        let (w, h) = (f32::from(size.width), f32::from(size.height));
        let top = metric::CHROME_HEIGHT;
        let panes = self.panes.read(cx).frames(w, h, 0., cx.reduce_motion());
        let split_open = self.is_html()
            && (panes.end.is_some()
                || self.panes.read(cx).right().open
                || self.panes.read(cx).dragging().is_some());
        let doc_w = if split_open {
            panes.layout.editor.w.clamp(0., w)
        } else {
            w
        };
        let aux_plane = (split_open && panes.end.is_some()).then_some(panes.layout.auxiliary);
        let area = Rect::new(0., top, doc_w, (h - top).max(0.));
        div()
            .id("file-mode-window")
            .when(self.is_html(), |d| {
                d.key_context(HTML_KEY_CONTEXT)
                    .track_focus(&self.focus)
                    .on_action(cx.listener(|s, _: &HtmlReload, w, cx| {
                        s.run_html_action(HtmlToolAction::ReloadAndReset, w, cx);
                    }))
                    .on_action(cx.listener(|s, _: &HtmlPickElement, w, cx| {
                        s.toggle_html_tool(HtmlToolMode::PickElement, w, cx);
                    }))
                    .on_action(cx.listener(|s, _: &HtmlAnnotate, w, cx| {
                        s.toggle_html_tool(HtmlToolMode::Annotate, w, cx);
                    }))
                    .on_action(cx.listener(|s, _: &HtmlScreenshot, w, cx| {
                        s.toggle_html_tool(HtmlToolMode::Screenshot, w, cx);
                    }))
                    .on_action(cx.listener(|s, _: &HtmlToggleChat, w, cx| {
                        s.toggle_chat(w, cx);
                    }))
                    .on_action(cx.listener(|s, _: &HtmlToggleFullscreen, w, cx| {
                        s.toggle_fullscreen_presentation(w, cx);
                    }))
            })
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .children(aux_plane.map(|plane| {
                div()
                    .absolute()
                    .left(px(plane.x))
                    .top(px(plane.y))
                    .w(px(plane.w))
                    .h(px(plane.h))
                    .child(self.sidebar.clone())
            }))
            .child(self.file_document(area, cx))
            .child(
                div()
                    .id("file-mode-header")
                    .absolute()
                    .top_0()
                    .left_0()
                    .w(px(w))
                    .h(px(top))
                    .child(self.file_header(window, cx)),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// The list the product publishes (v0.4.4 5e87974ef
    /// `createFileModeExtensions` over `shared/fileFormats.json`).
    #[test]
    fn a_file_window_opens_the_products_extensions() {
        assert_eq!(
            file_mode_extensions(),
            [
                ".copilotmd",
                ".csv",
                ".htm",
                ".html",
                ".jmd",
                ".litcoffee",
                ".markdn",
                ".markdown",
                ".md",
                ".mdown",
                ".mdtext",
                ".mdtxt",
                ".mdwn",
                ".mdx",
                ".mkd",
                ".mkdn",
                ".ron",
                ".ronn",
                ".workbook",
            ]
        );
    }

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
