//! The product's Excalidraw whiteboard (`ExcalidrawViewer` over its
//! `ExcalidrawDocumentModel`), bundled from its sources by
//! `tools/import-excalidraw.mjs` and running in the system web engine.
//!
//! This side owns the document text the host saves: the page sends the
//! serialized board after every local edit (the SDK's first normalized
//! scene is only the model's baseline, so opening a board never rewrites
//! it); a disk reload or external edit resets the page, which remounts the
//! board; read-only input is the board's view mode; the menu's Undo / Redo
//! reach the board's own history. A link on an element is resolved here
//! (`documentNavigation`): a workspace document opens in the workbench, an
//! address in the browser.
//!
//! The SDK's fonts (13 MB) are not embedded: they are served from disk
//! ([`fonts_dir`]); without them the board's text uses the system's fonts.
use super::{html_visual::script_json, web::WebFrame};
use crate::{
    editor::{
        navigation::{self, Reference, ReferenceContext},
        registry::{SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface},
    },
    platform::webview::{Content, DiskAssets, Entry, Ipc},
    typography::Scale,
};
use gpui::{prelude::*, *};
use serde::Deserialize;
use std::path::{Path, PathBuf};

const SCRIPT: &[u8] = include_bytes!("../../../assets/web/excalidraw.js");
const STYLE: &[u8] = include_bytes!("../../../assets/web/excalidraw.css");
/// `__assets__/excalidraw/…`: the SDK's asset path (`EXCALIDRAW_ASSET_PATH`).
const FONT_PREFIX: &str = "excalidraw";

/// Where the SDK's fonts live: an explicit override, the app bundle's
/// resources, or the developer vendor folder
/// (`tools/fetch-excalidraw-fonts.py`).
pub fn fonts_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PUPPYONE_EXCALIDRAW_ASSETS") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        candidates.push(dir.join("../Resources/excalidraw"));
    }
    candidates
        .push(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join("vendor/excalidraw"));
    candidates.into_iter().find(|p| p.join("fonts").is_dir())
}

/// Messages the page posts.
#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Inbound {
    Ready,
    Content {
        text: String,
    },
    /// An element's link was followed.
    Link {
        link: String,
    },
}

/// `excalidraw`: the whiteboard editor.
pub fn open(request: &SurfaceRequest, _: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let text = match request.input {
        SurfaceInput::Text(text) => text.to_owned(),
        _ => String::new(),
    };
    let root = request
        .workspace
        .as_ref()
        .and_then(|w| w.local_root())
        .map(|r| r.to_string_lossy().into_owned());
    let view = cx.new(|cx| {
        let mut view = WhiteboardView::new(request.name.to_owned(), root, text, request.dark);
        view.show(cx);
        view
    });
    Box::new(WhiteboardSurface { view })
}

/// What the page asked of the workbench.
enum Asked {
    Changed,
    Open(Vec<String>),
}

struct WhiteboardView {
    name: String,
    workspace_root: Option<String>,
    /// The board's text, mirrored from the page's model.
    text: String,
    enabled: bool,
    dark: bool,
    /// The page answers messages (its receiver is installed).
    ready: bool,
    /// The workspace's documents, for links (`resolveWorkspaceReference`).
    references: Option<ReferenceContext>,
    frame: Option<Entity<WebFrame>>,
    _inbox: Option<Task<()>>,
}
impl EventEmitter<Asked> for WhiteboardView {}

impl WhiteboardView {
    fn new(name: String, workspace_root: Option<String>, text: String, dark: bool) -> Self {
        Self {
            name,
            workspace_root,
            text,
            enabled: true,
            dark,
            ready: false,
            references: None,
            frame: None,
            _inbox: None,
        }
    }
    /// A new engine over the current text, input state and appearance.
    fn show(&mut self, cx: &mut Context<Self>) {
        let boot = serde_json::json!({
            "text": self.text,
            "name": Path::new(&self.name).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(),
            "path": self.name,
            "canEdit": self.enabled,
            "workspaceRoot": self.workspace_root,
            "locale": crate::localization::current_code(),
            "direction": "ltr",
            "messages": crate::localization::messages(&["editor.whiteboard.", "common.", "shared-ui."]),
        });
        let (tx, rx) = async_channel::unbounded::<String>();
        let content = Content {
            root: None,
            source: None,
            entry: Entry::Html(page(&boot, self.dark)),
            max_bytes: 0,
            assets: vec![("excalidraw.js", SCRIPT), ("excalidraw.css", STYLE)],
            ipc: Some(Ipc(tx)),
            policy: None,
            frames: None,
            disk_assets: fonts_dir().map(|dir| DiskAssets {
                prefix: FONT_PREFIX,
                dir,
            }),
        };
        self.ready = false;
        self.frame = Some(cx.new(|_| WebFrame::new(Some(content), self.dark)));
        self._inbox = Some(cx.spawn(async move |this, cx| {
            while let Ok(body) = rx.recv().await {
                let Ok(message) = serde_json::from_str::<Inbound>(&body) else {
                    continue;
                };
                let _ = this.update(cx, |view, cx| view.receive(message, cx));
            }
        }));
        cx.notify();
    }
    fn receive(&mut self, message: Inbound, cx: &mut Context<Self>) {
        match message {
            Inbound::Ready => self.ready = true,
            Inbound::Content { text } => {
                if self.enabled && text != self.text {
                    self.text = text;
                    cx.emit(Asked::Changed);
                }
            }
            Inbound::Link { link } => self.follow(&link, cx),
        }
    }
    /// `onLinkOpen`: only a reference the workspace can open, or an
    /// admitted address; anything else does nothing.
    fn follow(&mut self, link: &str, cx: &mut Context<Self>) {
        let references = self.references.clone();
        let resolve = move |target: &str| references.as_ref().map(|r| r.resolve(target));
        let Some(reference) =
            navigation::resolve(link, Some(&resolve)).filter(navigation::can_open)
        else {
            return;
        };
        match reference {
            Reference::External { href, .. } => cx.open_url(&href),
            Reference::Workspace { candidates, .. } => cx.emit(Asked::Open(candidates)),
            Reference::Denied { .. } => {}
        }
    }
    /// A message to the page's receiver; `false` before it is ready.
    fn post(&mut self, message: serde_json::Value, cx: &mut Context<Self>) -> bool {
        let script = format!(
            "window.__puppyoneWhiteboard&&window.__puppyoneWhiteboard({})",
            script_json(&message)
        );
        self.ready
            && self
                .frame
                .as_ref()
                .is_some_and(|frame| frame.read(cx).evaluate(&script))
    }
    /// State the page must hold: a page that cannot take it yet is rebuilt
    /// from the current state instead.
    fn post_state(&mut self, message: serde_json::Value, cx: &mut Context<Self>) {
        if !self.post(message, cx) {
            self.show(cx);
        }
    }
    fn replace_text(&mut self, text: &str, cx: &mut Context<Self>) {
        if self.text == text {
            return;
        }
        self.text = text.to_owned();
        self.post_state(serde_json::json!({ "type": "reset", "text": text }), cx);
    }
    fn history(&mut self, redo: bool, cx: &mut Context<Self>) {
        if self.ready && self.enabled {
            let direction = if redo { "redo" } else { "undo" };
            self.post(
                serde_json::json!({ "type": "history", "direction": direction }),
                cx,
            );
        }
    }
    fn apply(&mut self, read_only: bool, dark: bool, cx: &mut Context<Self>) {
        let enabled = !read_only;
        if dark != self.dark {
            // The theme is part of the page: rebuild it on the current text.
            self.dark = dark;
            self.enabled = enabled;
            self.show(cx);
        } else if enabled != self.enabled {
            self.enabled = enabled;
            self.post_state(
                serde_json::json!({ "type": "enabled", "value": enabled }),
                cx,
            );
        }
    }
}

/// The entry document: the product's tokens with the native theme's
/// colours over them, the SDK's asset path, then the bundle.
fn page(boot: &serde_json::Value, dark: bool) -> String {
    let tokens: String = crate::theme::pack_tokens(dark)
        .iter()
        .filter(|(name, value)| {
            name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !value.contains(['<', '>', '{', '}', ';'])
        })
        .map(|(name, value)| format!("--po-{name}:{value};"))
        .collect();
    let locale = crate::localization::current_code();
    let scheme = if dark { "dark" } else { "light" };
    // `.desktop-overlay-root` (dialogs.css): the SDK's dialogs and tooltips
    // portal into it, under the page's tokens.
    format!(
        "<!doctype html><html lang=\"{lang}\" class=\"{class}\" data-initial-theme=\"{scheme}\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width\">\
<link rel=\"stylesheet\" href=\"__assets__/excalidraw.css\">\
<style>:root:root:root{{{tokens}color-scheme:{scheme}}}html,body,#root{{height:100%;margin:0;overflow:hidden}}body{{background:var(--po-editor-bg,var(--po-canvas));color:var(--po-text);font-family:var(--po-font-ui)}}#root>.whiteboard-host{{height:100%}}.desktop-overlay-root{{position:relative;z-index:var(--po-overlay-root-z-index,1000);isolation:isolate;color:var(--po-text);font-family:var(--po-font-sans)}}.desktop-overlay-root:empty{{display:none}}</style>\
</head><body><div id=\"root\"></div><div id=\"desktop-overlay-root\" class=\"desktop-overlay-root{dark_class}\"></div>\
<script>window.EXCALIDRAW_ASSET_PATH=new URL(\"__assets__/{FONT_PREFIX}/\",document.baseURI).href;window.__PUPPYONE_WHITEBOARD={boot}</script>\
<script src=\"__assets__/excalidraw.js\"></script></body></html>",
        lang = locale.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', ""),
        class = if dark { "dark" } else { "" },
        dark_class = if dark { " dark" } else { "" },
        boot = script_json(boot),
    )
}

struct WhiteboardSurface {
    view: Entity<WhiteboardView>,
}
impl ViewerSurface for WhiteboardSurface {
    fn set_reference_context(&self, context: Option<ReferenceContext>, cx: &mut App) {
        self.view.update(cx, |view, _| view.references = context);
    }
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        Some(
            cx.subscribe(&self.view, move |_, asked: &Asked, cx| match asked {
                Asked::Changed => events(SurfaceEvent::Changed, cx),
                Asked::Open(paths) => events(SurfaceEvent::OpenPaths(paths.clone()), cx),
            }),
        )
    }
    fn text(&self, cx: &App) -> Option<String> {
        Some(self.view.read(cx).text.clone())
    }
    fn replace_text(&self, text: &str, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| view.replace_text(text, cx));
    }
    fn rebind_name(&self, name: &str, cx: &mut App) {
        let name = name.to_owned();
        self.view.update(cx, |view, _| view.name = name);
    }
    fn undo(&self, redo: bool, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| view.history(redo, cx));
    }
    fn apply(&self, read_only: bool, dark: bool, _: Scale, _: &mut Window, cx: &mut App) {
        self.view
            .update(cx, |view, cx| view.apply(read_only, dark, cx));
    }
}

impl Render for WhiteboardView {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().children(self.frame.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_page_carries_the_board_and_names_the_sdk_assets() {
        let boot = serde_json::json!({ "text": "{\"type\":\"</script>\"}" });
        let html = page(&boot, true);
        assert!(html.contains(r#"class="dark" data-initial-theme="dark""#));
        assert!(html.contains("color-scheme:dark"));
        assert!(html.contains(r#"new URL("__assets__/excalidraw/",document.baseURI)"#));
        assert!(html.contains(r#"id="desktop-overlay-root" class="desktop-overlay-root dark""#));
        assert!(!html.contains("\"</script>"));
        assert_eq!(
            serde_json::from_str::<Inbound>(r#"{"type":"link","link":"notes/a.md"}"#).unwrap(),
            Inbound::Link {
                link: "notes/a.md".into()
            }
        );
    }

    #[test]
    fn the_bundle_rewrites_the_font_fallback_and_carries_the_host_patches() {
        let script = std::str::from_utf8(SCRIPT).unwrap();
        assert!(!script.contains("esm.sh"), "no network font fallback");
        assert!(script.contains("__assets__/excalidraw/"));
        // The product's host patches: the desktop breakpoint and the
        // themed overlay host (their marker comments are minified away).
        assert!(script.contains(r#"matchMedia?.("(pointer: coarse)")"#));
        assert!(script.contains(r#"getElementById("desktop-overlay-root")??document.body"#));
        let style = std::str::from_utf8(STYLE).unwrap();
        assert!(style.contains("url(excalidraw/fonts/Assistant/Assistant-Regular.woff2)"));
    }

    #[test]
    fn the_listed_fonts_are_the_ones_installed() {
        let manifest: serde_json::Value =
            serde_json::from_str(include_str!("../../../assets/web/excalidraw-fonts.json"))
                .unwrap();
        let fonts = manifest["fonts"].as_object().unwrap();
        for family in ["Assistant/", "Excalifont/", "Virgil/", "Xiaolai/"] {
            assert!(fonts.keys().any(|k| k.starts_with(family)), "{family}");
        }
        // Where they are installed, each is the listed file.
        if let Some(dir) = fonts_dir() {
            for name in fonts.keys().take(8) {
                assert!(dir.join("fonts").join(name).is_file(), "{name}");
            }
        }
    }

    #[gpui::test]
    fn board_edits_become_the_document_and_links_open_their_documents(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view =
                WhiteboardView::new("boards/plan.excalidraw".into(), None, "{}".into(), false);
            view.show(cx);
            view.ready = true;
            view
        });
        let surface = WhiteboardSurface { view: view.clone() };
        let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let log = seen.clone();
        let _subscription = cx.update(|_, cx| {
            surface.subscribe(
                std::rc::Rc::new(move |event, _| log.borrow_mut().push(event)),
                cx,
            )
        });
        let board = "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[]}\n";
        view.update(cx, |v, cx| {
            v.receive(Inbound::Content { text: board.into() }, cx)
        });
        cx.run_until_parked();
        assert_eq!(*seen.borrow(), [SurfaceEvent::Changed]);
        assert_eq!(cx.update(|_, cx| surface.text(cx)).as_deref(), Some(board));
        // A link without a workspace to resolve it opens nothing.
        view.update(cx, |v, cx| {
            v.receive(
                Inbound::Link {
                    link: "notes/a.md".into(),
                },
                cx,
            )
        });
        cx.run_until_parked();
        assert_eq!(seen.borrow().len(), 1);
        // Read-only refuses the page's edits; a disk reload is the new text.
        cx.update(|window, cx| surface.apply(true, false, Scale::default(), window, cx));
        view.update(cx, |v, cx| {
            v.receive(Inbound::Content { text: "x".into() }, cx)
        });
        cx.run_until_parked();
        assert_eq!(seen.borrow().len(), 1);
        cx.update(|window, cx| surface.replace_text("{}", window, cx));
        assert_eq!(cx.update(|_, cx| surface.text(cx)).as_deref(), Some("{}"));
    }
}
