//! File Mode (`FileModeApp`, `electron/main/file-mode.mjs`): one Markdown,
//! CSV or HTML file in a window of its own, opened from Finder or a second
//! launch.
//!
//! Markdown and CSV keep a focused reading/editing Header (`Edit`, `Source`).
//! A standalone HTML page (`*.html` / `*.htm`) keeps the same quiet Header:
//! the file's name, and at the end only what a page is for:
//! - `Edit` (visual editing), `Chat` (the Agent on this Mac, `⌘L`), `Share`
//!   (put it in Cloud for a link) and `⋯` (reload, source, presentation,
//!   full-page screenshot, the file's place on disk)
//! - while Chat is open, the tools that point the Agent at the page: pick an
//!   element, annotate, screenshot
//! - a script error pill, only while the page has thrown

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
        workbench::pane::{Action, Item, ItemKind},
    },
    features::{cloud::account as cloud_account, settings::PreferencesStore},
    geometry::Rect,
    localization::{t as tr, tf},
    platform::desktop,
    theme::{self, metric},
    ui::{
        appearance::ActiveAppearance,
        components::{
            Button, ButtonVariant, FileIcon, FloatingNotice, Icon, Menu, MenuItem, MenuVariant,
            NoticeAction, NoticePlacement, NoticeStack, NoticeTone, PopoverMenu, ProductIcon,
            SurfaceFrame,
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

/// A screenshot just copied, offered to the Agent for a moment.
#[derive(Clone, Debug)]
struct ScreenshotToast {
    png: Vec<u8>,
    /// Which copy this is: a later one keeps its own lifetime.
    generation: usize,
}
/// How long the copied screenshot is offered.
const TOAST_LIFETIME: std::time::Duration = std::time::Duration::from_secs(6);

/// Which Header menu is open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FileMenu {
    View,
    Share,
    Settings,
}

/// A file window's own state: the bound file, Header popovers and the
/// screenshot clipboard banner.
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
            this.ensure_host_observed(window, cx);
            cx.notify();
        })
        .detach();
        cx.observe(&prefs, |_, _, cx| cx.notify()).detach();
        cx.observe(&panes, |_, _, cx| cx.notify()).detach();
        cx.observe(&sidebar, |_, _, cx| cx.notify()).detach();
        cx.observe(&cloud, |_, _, cx| cx.notify()).detach();
        cx.observe_in(&docs, window, |this, _, window, cx| {
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
            toast: None,
            share_copied: false,
        };
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
                HtmlToolEvent::CopyScreenshot { png, .. } => {
                    let image = gpui::Image::from_bytes(gpui::ImageFormat::Png, png.clone());
                    cx.write_to_clipboard(ClipboardItem::new_image(&image));
                    self.show_toast(png, cx);
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

    /// Offers a copied screenshot to the Agent until it is used, dismissed
    /// or [`TOAST_LIFETIME`] passes.
    fn show_toast(&mut self, png: Vec<u8>, cx: &mut Context<Self>) {
        let generation = self.toast.as_ref().map_or(0, |t| t.generation) + 1;
        self.toast = Some(ScreenshotToast { png, generation });
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(TOAST_LIFETIME).await;
            let _ = this.update(cx, |s, cx| {
                if s.toast.as_ref().is_some_and(|t| t.generation == generation) {
                    s.toast = None;
                    cx.notify();
                }
            });
        })
        .detach();
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
    file_mode_extensions()
        .iter()
        .any(|extension| name.len() > extension.len() && name.ends_with(extension))
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

/// The viewer's own settings (`Contribution::items`) as menu rows; a
/// toggle keeps its menu open.
fn setting_rows<F: Fn(&mut Window, &mut App) + 'static>(
    items: &[Item],
    action: impl Fn(Action) -> F,
) -> Vec<MenuItem> {
    items
        .iter()
        .map(|item| {
            let row = MenuItem::new(item.label.clone()).on_click(action(Action::Item(item.id)));
            match item.kind {
                ItemKind::Toggle(on) => row
                    .icon_element(
                        div()
                            .size(px(metric::MENU_ICON_SLOT))
                            .flex()
                            .items_center()
                            .justify_center()
                            .children(on.then(|| Icon::new("check").with_size(px(14.)).stroke(2.))),
                    )
                    .stay_open(),
                ItemKind::Command { disabled } => row.disabled(disabled),
            }
        })
        .collect()
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
                let card = SurfaceFrame::popover_card("html-share-card")
                    .stroke(t.border)
                    .w(px(300.))
                    .p(px(14.))
                    .gap(px(12.))
                    .child(
                        v_flex()
                            .gap(px(4.))
                            .child(
                                div()
                                    .text_size(px(ty.body))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(t.text)
                                    .child(tr("fileMode.html.shareTitle")),
                            )
                            .child(
                                div()
                                    .text_size(px(ty.meta))
                                    .text_color(t.muted)
                                    .child(tr("fileMode.html.shareSubtitle")),
                            ),
                    );
                let cloud_cta = |id: &'static str, label: &str| {
                    Button::new(id)
                        .w_full()
                        .variant(ButtonVariant::FilledPrimary)
                        .icon(
                            Icon::product(ProductIcon::Cloud)
                                .with_size(px(14.))
                                .stroke(1.9),
                        )
                        .label(tr(label))
                };
                if let Some(url) = live_url.clone() {
                    let copy_url = url.clone();
                    let host_copy = host_body.clone();
                    return card.child(
                        h_flex()
                            .items_center()
                            .gap(px(6.))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .px(px(8.))
                                    .py(px(5.))
                                    .rounded(px(6.))
                                    .bg(t.inset)
                                    .border_1()
                                    .border_color(t.divider)
                                    .truncate()
                                    .text_size(px(ty.meta))
                                    .text_color(t.text)
                                    .child(url.clone()),
                            )
                            .child(
                                Button::new("html-share-copy-link")
                                    .small()
                                    .variant(ButtonVariant::Outline)
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
                                    .tooltip(tr("fileMode.html.openInBrowser"))
                                    .on_click(move |_, _, cx| cx.open_url(&url)),
                            ),
                    );
                }
                let dismiss_click = dismiss.clone();
                if let Some(email) = signed_in.clone() {
                    let cloud = cloud_entity.clone();
                    let root = file_root.clone();
                    let name = file_name.clone();
                    card.child(
                        div()
                            .text_size(px(ty.meta))
                            .text_color(t.subtle)
                            .truncate()
                            .child(email),
                    )
                    .child(
                        cloud_cta("html-share-publish-cta", "fileMode.html.sharePublishCta")
                            .on_click(move |_, w, cx| {
                                dismiss_click(w, cx);
                                cloud.update(cx, |c, cx| {
                                    c.open_file_mode_publish(root.clone(), name.clone(), cx);
                                });
                            }),
                    )
                } else {
                    card.child(
                        cloud_cta("html-share-signin-cta", "fileMode.html.shareSignInCta")
                            .on_click(move |_, w, cx| {
                                dismiss_click(w, cx);
                                if cloud_account::available(cx) {
                                    cloud_account::sign_in(cx);
                                } else {
                                    cx.open_url("https://www.puppyone.ai");
                                }
                            }),
                    )
                }
            })
    }

    /// The file's icon and name at the Header's start.
    fn file_title(&self, cx: &App) -> Stateful<Div> {
        let t = cx.palette();
        let ty = theme::ty().header;
        let icon_theme = self.prefs.read(cx).state.file_icon_theme.clone();
        h_flex()
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
            )
    }

    /// An HTML page's Header: its name (and a pill while the page has
    /// thrown), then `Edit`, the Agent's page tools while Chat is open,
    /// `Chat`, `Share` and `⋯`.
    fn html_file_header(
        &self,
        editor: Entity<DocumentEditor>,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> TitleBar {
        let t = cx.palette();
        let tool_state: HtmlToolSnapshot = editor.read(cx).html_tool_state().unwrap_or_default();
        let controls = editor.read(cx).title_controls(cx);
        let chat_open = self.sidebar.read(cx).shows(SidebarSurface::Agent, cx);
        let mut bar = TitleBar::new().leading(self.file_title(cx));

        // The page threw: a quiet count beside its name hands the errors
        // to the Agent.
        if !tool_state.js_errors.is_empty() {
            let ty = theme::ty().header;
            let tip: SharedString = tr("fileMode.html.jsErrorTooltip").into();
            let count = h_flex()
                .items_center()
                .gap(px(5.))
                .px(px(2.))
                .text_color(t.danger)
                .text_size(px(ty.content))
                .line_height(px(ty.line_height))
                .child(
                    Icon::new("triangle-alert")
                        .with_size(px(13.))
                        .stroke(1.9)
                        .color(t.danger),
                )
                .child(tf(
                    "fileMode.html.jsErrorPill",
                    &[("count", tool_state.js_errors.len().to_string().into())],
                ));
            let host = self.weak.clone();
            bar = bar.leading(
                Button::new("file-mode-js-error")
                    .variant(ButtonVariant::Titlebar)
                    .accessibility_label(tip.clone())
                    .tooltip(tip)
                    .trailing(count)
                    .on_click(move |_, w, cx| {
                        let _ = host.update(cx, |s, cx| s.stage_js_errors_to_chat(w, cx));
                    }),
            );
        }

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
        let toggle = |id: &'static str| controls.toggles.iter().find(|sw| sw.id == id);

        if let Some(edit) = toggle(DOCUMENT_EDITING_TOGGLE_ID) {
            let run = pane_action(Action::Item(edit.id));
            bar = bar.action(
                header_action(edit.id, icon(edit.icon), edit.label.clone())
                    .selected(edit.checked)
                    .on_click(move |_, w, cx| run(w, cx)),
            );
        }

        // Pointing the Agent at the page belongs to Chat: these show while
        // it is open, or while one of them is still on.
        let pointing = matches!(
            tool_state.mode,
            HtmlToolMode::PickElement | HtmlToolMode::Annotate | HtmlToolMode::Screenshot
        );
        if chat_open || pointing {
            let tool = |id: &'static str, glyph: &'static str, label: &str, mode: HtmlToolMode| {
                let host = self.weak.clone();
                header_action(id, icon(glyph), tr(label).into())
                    .debug_selector(|| id.into())
                    .selected(tool_state.mode == mode)
                    .on_click(move |_, w, cx| {
                        let _ = host.update(cx, |s, cx| s.toggle_html_tool(mode, w, cx));
                    })
            };
            let mut annotate = tool(
                "html-tool-annotate",
                "highlighter",
                "fileMode.html.annotate",
                HtmlToolMode::Annotate,
            );
            if tool_state.has_annotations {
                annotate = annotate.trailing(div().size(px(5.)).rounded_full().bg(t.brand_blue));
            }
            bar = bar
                .divider(cx)
                .action(tool(
                    "html-tool-pick",
                    "mouse-pointer-2",
                    "fileMode.html.pick",
                    HtmlToolMode::PickElement,
                ))
                .action(annotate)
                .action(tool(
                    "html-tool-screenshot",
                    "scissors",
                    "fileMode.html.screenshot",
                    HtmlToolMode::Screenshot,
                ));
        }

        {
            let host = self.weak.clone();
            bar = bar.action(
                header_action(
                    "html-tool-chat",
                    icon("agent-entry"),
                    tr("fileMode.html.chatTooltip").into(),
                )
                .debug_selector(|| "html-tool-chat".into())
                .selected(chat_open)
                .on_click(move |_, w, cx| {
                    let _ = host.update(cx, |s, cx| s.toggle_chat(w, cx));
                }),
            );
        }

        {
            let share_tip: SharedString = tr("fileMode.html.shareTooltip").into();
            let share = Button::new("html-tool-share")
                .variant(ButtonVariant::Titlebar)
                .label(tr("fileMode.html.share"))
                .accessibility_label(share_tip.clone())
                .tooltip(share_tip);
            bar = bar.action(self.share_popover(share, cx));
        }

        let more_label: SharedString = tf(
            "editor.panes.actionsFor",
            &[("name", self.target.name.clone().into())],
        )
        .into();
        let more_trigger = header_action("file-settings", icon("ellipsis"), more_label);
        let host_reload = self.weak.clone();
        let host_present = self.weak.clone();
        let host_capture = self.weak.clone();
        let host_clear = self.weak.clone();
        let mut page = vec![
            MenuItem::new(tr("fileMode.html.reload"))
                .icon("refresh-cw")
                .shortcut("⌘R")
                .on_click(move |w, cx| {
                    let _ = host_reload.update(cx, |s, cx| {
                        s.menu = None;
                        s.run_html_action(HtmlToolAction::ReloadAndReset, w, cx);
                    });
                }),
        ];
        if let Some(source) = toggle(DOCUMENT_SOURCE_PANEL_TOGGLE_ID) {
            page.push(
                MenuItem::new(source.label.clone())
                    .icon(source.icon)
                    .checked(source.checked)
                    .on_click(pane_action(Action::Item(source.id))),
            );
        }
        let mut show = vec![
            MenuItem::new(tr(if window.is_fullscreen() {
                "fileMode.html.exitFullscreen"
            } else {
                "fileMode.html.presentFullscreen"
            }))
            .icon("monitor")
            .shortcut("⇧⌘F")
            .on_click(move |w, cx| {
                let _ = host_present.update(cx, |s, cx| {
                    s.menu = None;
                    s.toggle_fullscreen_presentation(w, cx);
                });
            }),
            MenuItem::new(tr("fileMode.html.captureFullPage"))
                .icon("image")
                .on_click(move |w, cx| {
                    let _ = host_capture.update(cx, |s, cx| {
                        s.menu = None;
                        s.run_html_action(HtmlToolAction::CaptureFullPage, w, cx);
                    });
                }),
        ];
        if tool_state.has_annotations {
            show.push(
                MenuItem::new(tr("fileMode.html.clearAnnotations"))
                    .icon("trash-2")
                    .on_click(move |w, cx| {
                        let _ = host_clear.update(cx, |s, cx| {
                            s.menu = None;
                            s.run_html_action(HtmlToolAction::ClearAnnotations, w, cx);
                        });
                    }),
            );
        }
        let browser_path = self.target.path.clone();
        let finder_path = self.target.path.clone();
        let folder = self.target.root.clone();
        let name = self.target.name.clone();
        let place = vec![
            MenuItem::new(tr("fileMode.html.openInBrowser"))
                .icon("globe-2")
                .on_click(move |_, _| {
                    let _ = desktop::open(&browser_path);
                }),
            MenuItem::new(tr("fileMode.html.revealInFinder"))
                .product_icon(ProductIcon::Folder)
                .on_click(move |_, _| {
                    let _ = desktop::reveal(&finder_path);
                }),
            MenuItem::new(tr("fileMode.html.openFolderAsProject"))
                .icon("external-link")
                .on_click(move |_, cx| {
                    let _ = windows::open_created(folder.clone(), Some(PathBuf::from(&name)), cx);
                }),
        ];
        let extra = setting_rows(&controls.items, pane_action);
        bar.action(self.file_menu(
            FileMenu::Settings,
            Anchor::TopRight,
            more_trigger,
            move |menu| {
                let menu = menu
                    .list(2., page)
                    .separator()
                    .list(2., show)
                    .separator()
                    .list(2., place);
                if extra.is_empty() {
                    menu
                } else {
                    menu.separator().list(2., extra)
                }
            },
        ))
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
            let items = setting_rows(&controls.items, action);
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
                    .debug_selector(|| "file-mode-unavailable".into())
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
                        .debug_selector(|| "file-mode-encoding-notice".into())
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
                // The copied screenshot floats at the document's end corner
                // (over the page, `ui::native_cover`) and offers itself to
                // the Agent.
                let toast = self.toast.as_ref().map(|toast| {
                    let png = toast.png.clone();
                    let host_send = self.weak.clone();
                    let host_close = self.weak.clone();
                    NoticeStack::new(NoticePlacement::BottomEnd, 16., 16., (r.w - 32.).min(400.))
                        .child(
                            FloatingNotice::new("file-mode-toast", tr("fileMode.html.toastCopied"))
                                .tone(NoticeTone::Success)
                                .action(NoticeAction::new(
                                    "file-mode-toast-send",
                                    tr("fileMode.html.toastPasteChat"),
                                    move |w, cx| {
                                        let bytes = png.clone();
                                        let _ = host_send.update(cx, |s, cx| {
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
                                    },
                                ))
                                .on_dismiss(move |_, cx| {
                                    let _ = host_close.update(cx, |s, cx| {
                                        s.toast = None;
                                        cx.notify();
                                    });
                                }),
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
                area.children(notice).children(document).children(toast)
            }
        }
    }
}

impl Render for FileWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::web_host::frame_drawn(window);
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
    fn file_mode_admission_matches_the_published_extensions_and_requires_a_stem() {
        for name in [
            "a.md",
            "a.markdown",
            "A.MD",
            "/x/y/a.mdx",
            "a.csv",
            "A.CSV",
            "a.html",
            "a.htm",
            "/x/y/A.HTML",
            "/x/review.agent.md",
        ] {
            assert!(is_file_mode_file(Path::new(name)), "{name}");
        }
        for name in [
            "a.pdf", "a.yaml", "a.png", "a", "a.xlsx", "a.tsv", "a.ejs", "a.jsp", "a.php", ".md",
            "/x/.csv", "", "/",
        ] {
            assert!(!is_file_mode_file(Path::new(name)), "{name}");
        }
        let extensions = file_mode_extensions();
        for extension in &extensions {
            assert_eq!(extension, &extension.to_lowercase());
            assert!(extension.starts_with('.'));
            assert!(
                !extensions
                    .iter()
                    .any(|other| other != extension && extension.ends_with(other))
            );
            assert!(is_file_mode_file(Path::new(&format!("note{extension}"))));
            assert!(
                !is_file_mode_file(Path::new(extension)),
                "bare extension: {extension}"
            );
        }
        assert!(
            !extensions
                .iter()
                .any(|extension| extension == ".agent.md" || extension == ".ejs")
        );
    }

    #[test]
    fn a_file_over_the_editor_limit_is_never_read() {
        let temp = tempfile::tempdir().unwrap();
        let (small, large) = (temp.path().join("small.md"), temp.path().join("large.md"));
        std::fs::write(&small, "# Small\n").unwrap();
        std::fs::write(&large, vec![b'x'; MAX_EDITOR_BYTES as usize + 1]).unwrap();
        assert_eq!(
            FileTarget::of(small.clone()).unwrap().admission,
            Admission::Readable
        );
        assert_eq!(
            FileTarget::of(large).unwrap().admission,
            Admission::TooLarge
        );
        std::fs::File::create(&small)
            .unwrap()
            .set_len(MAX_EDITOR_BYTES)
            .unwrap();
        assert_eq!(
            FileTarget::of(small).unwrap().admission,
            Admission::Readable
        );
        assert_eq!(
            FileTarget::of(temp.path().join("missing.md"))
                .unwrap()
                .admission,
            Admission::Unavailable
        );
        let folder = FileTarget::of(temp.path().to_path_buf()).unwrap();
        assert_eq!(folder.admission, Admission::Unavailable);
    }
}
