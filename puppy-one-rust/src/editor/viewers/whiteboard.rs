//! The product's Excalidraw whiteboard (`ExcalidrawViewer` over its
//! `ExcalidrawDocumentModel`), decoupled from the base binary as an on-demand
//! Viewer Pack (`puppyone.excalidraw`, `platform::viewer_packs`) and paired
//! with the native JSON source editor (`Mode::Source`).
//!
//! Until the person installs the Whiteboard pack, opening a `.excalidraw`
//! document presents a native card offering one-click pack installation or
//! immediate JSON source editing; once installed, the board mounts in place
//! without reopening the tab.
//!
//! This side owns the document text the host saves: the page sends the
//! serialized board after every local edit (the SDK's first normalized
//! scene is only the model's baseline, so opening a board never rewrites
//! it); a disk reload or external edit resets the page, which remounts the
//! board; read-only input is the board's view mode; the menu's Undo / Redo
//! reach the board's own history. A link on an element is resolved here
//! (`documentNavigation`): a workspace document opens in the workbench, an
//! address in the browser.
use super::{
    code,
    html_visual::script_json,
    web::{WebFrame, parse_find_result},
};
use crate::{
    editor::{
        navigation::{self, Reference, ReferenceContext},
        registry::{
            AssetReader, DocumentAssets, HostCommand, PaneEntries, PaneItemId, PaneSegmentId,
            SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface,
        },
        workbench::{
            find::FindEvent,
            pane::{Segment, Segmented},
            view_state::SurfaceViewState,
        },
    },
    localization::t,
    platform::{
        viewer_packs::{self, ExcalidrawPack},
        webview::{Content, DiskAssets, Entry, Ipc, ResourceSource, Source},
    },
    theme,
    typography::Scale,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, Icon},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{base::Disableable as _, component::Sizable as _};
use serde::Deserialize;
use std::{cell::Cell, path::Path, rc::Rc, sync::Arc};

/// `__assets__/excalidraw/…`: the SDK's asset path (`EXCALIDRAW_ASSET_PATH`).
const FONT_PREFIX: &str = "excalidraw";
const EMBED_MAX_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Board,
    Source,
}

/// Messages the page posts.
#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Inbound {
    Ready { generation: u64 },
    Content { generation: u64, text: String },
    Link { generation: u64, link: String },
}

/// Workspace files by workspace-relative path, for embedded pages.
struct Workspace(AssetReader);
impl ResourceSource for Workspace {
    fn read(&self, relative: &Path) -> Option<Vec<u8>> {
        (self.0)(relative)
    }
}

enum Asked {
    Changed,
    Open(Vec<String>),
    FindResult { current: usize, total: usize },
    ViewSource,
}

/// `excalidraw`: the whiteboard editor with on-demand pack installation and JSON source mode.
pub fn open(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let surface = open_with_pack(request, None, window, cx);
    surface.board.update(cx, |view, cx| {
        view.start_load(viewer_packs::load_excalidraw, cx)
    });
    Box::new(surface)
}

/// The board over a stand-in pack: the host protocol without the SDK.
#[cfg(test)]
pub(crate) fn open_with_fixture_pack(
    request: &SurfaceRequest,
    window: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    let pack = ExcalidrawPack {
        version: "fixture".into(),
        script: Arc::from([]),
        style: Arc::from([]),
        dir: std::env::temp_dir(),
    };
    Box::new(open_with_pack(request, Some(pack), window, cx))
}

fn open_with_pack(
    request: &SurfaceRequest,
    pack: Option<ExcalidrawPack>,
    window: &mut Window,
    cx: &mut App,
) -> WhiteboardSurface {
    let text = match request.input {
        SurfaceInput::Text(text) => text.to_owned(),
        _ => String::new(),
    };
    let source: Rc<dyn ViewerSurface> =
        Rc::from(code::open_with(request, Some("json"), false, window, cx));
    let root = request
        .workspace
        .as_ref()
        .and_then(|w| w.local_root())
        .map(|r| r.to_string_lossy().into_owned());
    let assets = request.assets.clone();
    let references = request.references.clone();
    let mode = Rc::new(Cell::new(Mode::Board));
    let board = cx.new(|cx| {
        let mut view = WhiteboardView::new(request.name.to_owned(), root, text, request.dark);
        view.assets = assets;
        view.references = references;
        view.pack = pack;
        view.show(cx);
        view
    });
    let host = cx.new(|cx| {
        let mode_ref = mode.clone();
        let source_ref = source.clone();
        let _sub = cx.subscribe_in(
            &board,
            window,
            move |host: &mut WhiteboardHost, _, asked: &Asked, window, cx| {
                if matches!(asked, Asked::ViewSource) && mode_ref.get() != Mode::Source {
                    let latest = host.board.read(cx).text.clone();
                    source_ref.replace_text(&latest, window, cx);
                    host.board.update(cx, |view, cx| view.set_active(false, cx));
                    mode_ref.set(Mode::Source);
                    if let Some(focus) = source_ref.focus_handle(cx) {
                        focus.focus(window, cx);
                    }
                    cx.notify();
                }
            },
        );
        WhiteboardHost {
            mode: mode.clone(),
            board: board.clone(),
            source: source.clone(),
            _sub,
        }
    });
    WhiteboardSurface {
        mode,
        board,
        source,
        host,
    }
}

struct WhiteboardHost {
    mode: Rc<Cell<Mode>>,
    board: Entity<WhiteboardView>,
    source: Rc<dyn ViewerSurface>,
    _sub: Subscription,
}
impl Render for WhiteboardHost {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        match self.mode.get() {
            Mode::Board => self.board.clone().into_any_element(),
            Mode::Source => self.source.element(),
        }
    }
}

struct WhiteboardView {
    name: String,
    workspace_root: Option<String>,
    text: String,
    enabled: bool,
    dark: bool,
    ready: bool,
    generation: u64,
    /// The page edited since it took its text: the undo history exists only
    /// in the SDK, so the page is kept from eviction (`VW-20`, `WB-01`).
    history: bool,
    active: bool,
    references: Option<ReferenceContext>,
    assets: Option<DocumentAssets>,
    pack: Option<ExcalidrawPack>,
    loading: bool,
    installing: bool,
    install_error: Option<String>,
    frame: Option<Entity<WebFrame>>,
    _inbox: Option<Task<()>>,
    _installer: Option<Task<()>>,
    _loader: Option<Task<()>>,
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
            generation: 1,
            history: false,
            active: true,
            references: None,
            assets: None,
            pack: None,
            loading: false,
            installing: false,
            install_error: None,
            frame: None,
            _inbox: None,
            _installer: None,
            _loader: None,
        }
    }

    fn advance_generation(&mut self) {
        self.generation = self
            .generation
            .checked_add(1)
            .expect("whiteboard generation exhausted");
    }

    fn show(&mut self, cx: &mut Context<Self>) {
        self.advance_generation();
        let Some(pack) = self.pack.clone() else {
            self.ready = false;
            self.frame = None;
            self._inbox = None;
            cx.notify();
            return;
        };
        let (tx, rx) = async_channel::unbounded::<String>();
        let content = self.content(pack, Ipc(tx));
        self.ready = false;
        self.history = false;
        let weak = cx.weak_entity();
        self.frame = Some(cx.new(|_| {
            let mut frame = WebFrame::new(Some(content), self.dark);
            // The per-window engine cap may release the page while hidden; the
            // recreated page boots from the current entry and reports ready.
            frame.set_on_recreated(Some(Rc::new(move |cx| {
                let _ = weak.update(cx, |view, _| view.ready = false);
            })));
            frame
        }));
        self._inbox = Some(cx.spawn(async move |this, cx| {
            while let Ok(body) = rx.recv().await {
                if let Some((current, total)) = parse_find_result(&body) {
                    let _ = this.update(cx, |_, cx| cx.emit(Asked::FindResult { current, total }));
                    continue;
                }
                let Ok(message) = serde_json::from_str::<Inbound>(&body) else {
                    continue;
                };
                let _ = this.update(cx, |view, cx| view.receive(message, cx));
            }
        }));
        cx.notify();
    }

    /// The page a recreated engine boots: the document, its input state and
    /// generation as they are now.
    fn entry(&self) -> String {
        let boot = serde_json::json!({
            "text": self.text,
            "name": Path::new(&self.name).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(),
            "path": self.name,
            "canEdit": self.enabled && self.active,
            "generation": self.generation,
            "workspaceRoot": self.workspace_root,
            "locale": crate::localization::current_code(),
            "direction": "ltr",
            "messages": crate::localization::messages(&["editor.whiteboard.", "common.", "shared-ui.", "editor.html."]),
            "assets": self.assets.is_some(),
        });
        page(&boot, self.dark)
    }

    fn sync_entry(&self, cx: &mut Context<Self>) {
        if let Some(frame) = &self.frame {
            let entry = self.entry();
            frame.update(cx, |f, _| f.update_entry_html(entry));
        }
    }

    fn content(&self, pack: ExcalidrawPack, ipc: Ipc) -> Content {
        Content {
            root: None,
            source: self
                .assets
                .as_ref()
                .map(|a| Source(Arc::new(Workspace(a.read.clone())) as Arc<dyn ResourceSource>)),
            entry: Entry::Html(self.entry()),
            max_bytes: EMBED_MAX_BYTES,
            assets: Vec::new(),
            ipc: Some(ipc),
            policy: None,
            frames: None,
            disk_assets: Some(DiskAssets {
                prefix: FONT_PREFIX,
                dir: pack.dir,
                bundles: vec![
                    ("excalidraw.js", pack.script),
                    ("excalidraw.css", pack.style),
                ],
            }),
            locked: false,
        }
    }

    fn start_load(
        &mut self,
        load: impl FnOnce() -> Option<ExcalidrawPack> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        if self.loading || self.installing || self.pack.is_some() {
            return;
        }
        self.loading = true;
        cx.notify();
        let (tx, rx) = async_channel::bounded(1);
        // The cache may need to read and hash every SDK font. Never run that
        // disk work in the UI executor, including its first poll.
        std::thread::spawn(move || {
            let _ = tx.send_blocking(load());
        });
        self._loader = Some(cx.spawn(async move |this, cx| {
            let pack = rx.recv().await.unwrap_or(None);
            let _ = this.update(cx, |view, cx| {
                view.loading = false;
                view.pack = pack;
                // show reads current text, mode and read-only state; the load
                // result carries assets only, never an old document snapshot.
                view.show(cx);
            });
        }));
    }

    fn start_install(&mut self, cx: &mut Context<Self>) {
        if self.loading || self.installing {
            return;
        }
        self.installing = true;
        self.install_error = None;
        cx.notify();
        let (tx, rx) = async_channel::bounded::<Result<ExcalidrawPack, String>>(1);
        std::thread::spawn(move || {
            let _ = tx.send_blocking(viewer_packs::install_excalidraw());
        });
        self._installer = Some(cx.spawn(async move |this, cx| {
            let Ok(result) = rx.recv().await else {
                return;
            };
            let _ = this.update(cx, |view, cx| {
                view.installing = false;
                match result {
                    Ok(pack) => {
                        view.install_error = None;
                        view.pack = Some(pack);
                        view.show(cx);
                    }
                    Err(error) => {
                        view.install_error = Some(error);
                        cx.notify();
                    }
                }
            });
        }));
    }

    fn receive(&mut self, message: Inbound, cx: &mut Context<Self>) {
        match message {
            Inbound::Ready { generation } if generation == self.generation => {
                self.ready = self.frame.is_some();
            }
            Inbound::Content { generation, text } => {
                if self.ready
                    && self.active
                    && self.enabled
                    && generation == self.generation
                    && text != self.text
                {
                    self.text = text;
                    self.hold_history(true, cx);
                    self.sync_entry(cx);
                    cx.emit(Asked::Changed);
                }
            }
            Inbound::Link { generation, link }
                if self.ready && self.active && generation == self.generation =>
            {
                self.follow(&link, cx)
            }
            _ => {}
        }
    }

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
        self.advance_generation();
        // The reset replaces the scene and the SDK's history with it.
        self.hold_history(false, cx);
        self.sync_entry(cx);
        if self.pack.is_some() {
            self.post_state(
                serde_json::json!({ "type": "reset", "text": text, "generation": self.generation }),
                cx,
            );
        } else {
            cx.notify();
        }
    }

    fn set_active(&mut self, active: bool, cx: &mut Context<Self>) {
        if self.active == active {
            return;
        }
        self.active = active;
        self.advance_generation();
        self.sync_entry(cx);
        if self.pack.is_some() {
            self.post_state(serde_json::json!({ "type": "enabled", "value": self.enabled && active, "generation": self.generation }), cx);
        }
    }

    fn hold_history(&mut self, held: bool, cx: &mut Context<Self>) {
        if self.history != held {
            self.history = held;
            if let Some(frame) = &self.frame {
                frame.update(cx, |f, _| f.set_pinned(held));
            }
        }
    }

    fn history(&mut self, redo: bool, cx: &mut Context<Self>) {
        if self.ready && self.active && self.enabled {
            let direction = if redo { "redo" } else { "undo" };
            self.post(
                serde_json::json!({ "type": "history", "direction": direction }),
                cx,
            );
        }
    }

    fn apply(&mut self, read_only: bool, dark: bool, cx: &mut Context<Self>) {
        let enabled = !read_only;
        let changed = enabled != self.enabled;
        let restyled = dark != self.dark;
        self.enabled = enabled;
        if changed {
            self.advance_generation();
        }
        if restyled {
            self.dark = dark;
            if self.pack.is_none() {
                self.enabled = enabled;
                cx.notify();
                return;
            }
            let message =
                serde_json::json!({ "type": "theme", "dark": dark, "css": theme_css(dark) });
            if !self.post(message, cx) {
                self.enabled = enabled;
                self.show(cx);
                return;
            }
        }
        if changed || restyled {
            self.sync_entry(cx);
        }
        if changed && self.pack.is_some() {
            self.post_state(
                serde_json::json!({ "type": "enabled", "value": enabled && self.active, "generation": self.generation }),
                cx,
            );
        }
    }
}

fn theme_css(dark: bool) -> String {
    let tokens: String = crate::theme::pack_tokens(dark)
        .iter()
        .filter(|(name, value)| {
            name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !value.contains(['<', '>', '{', '}', ';'])
        })
        .map(|(name, value)| format!("--po-{name}:{value};"))
        .collect();
    let scheme = if dark { "dark" } else { "light" };
    format!(":root:root:root{{{tokens}color-scheme:{scheme}}}")
}

/// The native acceptance process uses the same boot document and assets as the viewer.
#[cfg(all(target_os = "macos", feature = "dev-capture"))]
pub(crate) fn probe_content(pack: ExcalidrawPack, text: String, ipc: Ipc) -> Content {
    WhiteboardView::new("board.excalidraw".into(), None, text, false).content(pack, ipc)
}

fn page(boot: &serde_json::Value, dark: bool) -> String {
    let locale = crate::localization::current_code();
    let scheme = if dark { "dark" } else { "light" };
    format!(
        "<!doctype html><html lang=\"{lang}\" class=\"{class}\" data-initial-theme=\"{scheme}\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width\">\
<link rel=\"stylesheet\" href=\"__assets__/excalidraw.css\">\
<style id=\"po-theme\">{theme}</style><style>html,body,#root{{height:100%;margin:0;overflow:hidden}}body{{background:var(--po-editor-bg,var(--po-canvas));color:var(--po-text);font-family:var(--po-font-ui)}}#root>.whiteboard-host{{height:100%}}.desktop-overlay-root{{position:relative;z-index:var(--po-overlay-root-z-index,1000);isolation:isolate;color:var(--po-text);font-family:var(--po-font-sans)}}.desktop-overlay-root:empty{{display:none}}</style>\
</head><body><div id=\"root\"></div><div id=\"desktop-overlay-root\" class=\"desktop-overlay-root{dark_class}\"></div>\
<script>window.EXCALIDRAW_ASSET_PATH=new URL(\"__assets__/{FONT_PREFIX}/\",document.baseURI).href;window.__PUPPYONE_WHITEBOARD={boot}</script>\
<script src=\"__assets__/excalidraw.js\"></script></body></html>",
        lang = locale.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', ""),
        class = if dark { "dark" } else { "" },
        dark_class = if dark { " dark" } else { "" },
        boot = script_json(boot),
        theme = theme_css(dark),
    )
}

struct WhiteboardSurface {
    mode: Rc<Cell<Mode>>,
    board: Entity<WhiteboardView>,
    source: Rc<dyn ViewerSurface>,
    host: Entity<WhiteboardHost>,
}

#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
impl crate::editor::registry::SurfaceTestProbe for WhiteboardSurface {
    #[cfg(any(test, feature = "test-support"))]
    fn page_deliver(&self, body: &str, cx: &mut App) -> bool {
        let Ok(message) = serde_json::from_str::<Inbound>(body) else {
            return false;
        };
        self.board.update(cx, |view, cx| view.receive(message, cx));
        true
    }
    #[cfg(any(test, feature = "test-support"))]
    fn page_generation(&self, cx: &App) -> Option<u64> {
        Some(self.board.read(cx).generation)
    }
    #[cfg(test)]
    fn page_entry(&self, cx: &App) -> Option<String> {
        let frame = self.board.read(cx).frame.clone()?;
        frame.read(cx).entry_html().map(str::to_owned)
    }
    #[cfg(test)]
    fn page_view(&self) -> Option<AnyEntity> {
        Some(self.board.clone().into())
    }
}

impl ViewerSurface for WhiteboardSurface {
    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    fn as_test_probe(&self) -> Option<&dyn crate::editor::registry::SurfaceTestProbe> {
        Some(self)
    }
    fn set_reference_context(&self, context: Option<ReferenceContext>, cx: &mut App) {
        self.board.update(cx, |view, _| view.references = context);
    }
    fn element(&self) -> AnyElement {
        self.host.clone().into_any_element()
    }
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        let mode_board = self.mode.clone();
        let events_board = events.clone();
        let board_sub = cx.subscribe(&self.board, move |_, asked: &Asked, cx| match asked {
            Asked::Changed if mode_board.get() == Mode::Board => {
                events_board(SurfaceEvent::Changed, cx);
            }
            Asked::Open(paths) => events_board(SurfaceEvent::OpenPaths(paths.clone()), cx),
            Asked::FindResult { current, total } if mode_board.get() == Mode::Board => {
                events_board(
                    SurfaceEvent::FindResult {
                        current: *current,
                        total: *total,
                    },
                    cx,
                );
            }
            Asked::ViewSource => events_board(SurfaceEvent::Redraw, cx),
            _ => {}
        });
        let mode_source = self.mode.clone();
        let source_sub = self.source.subscribe(
            Rc::new(move |event, cx| {
                if mode_source.get() == Mode::Source {
                    events(event, cx);
                }
            }),
            cx,
        );
        Some(Subscription::join(
            board_sub,
            source_sub.unwrap_or_else(|| Subscription::new(|| {})),
        ))
    }
    fn text(&self, cx: &App) -> Option<String> {
        match self.mode.get() {
            Mode::Board => Some(self.board.read(cx).text.clone()),
            Mode::Source => self.source.text(cx),
        }
    }
    fn buffer(&self, cx: &App) -> Option<crate::editor::text::buffer::Buffer> {
        match self.mode.get() {
            Mode::Board => Some(crate::editor::text::buffer::Buffer::new(
                self.board.read(cx).text.clone(),
            )),
            Mode::Source => self.source.buffer(cx),
        }
    }
    fn composing(&self, cx: &App) -> bool {
        self.mode.get() == Mode::Source && self.source.composing(cx)
    }
    fn holds_page_history(&self, cx: &App) -> bool {
        self.board.read(cx).history
    }
    fn replace_text(&self, text: &str, window: &mut Window, cx: &mut App) {
        self.source.replace_text(text, window, cx);
        self.board
            .update(cx, |view, cx| view.replace_text(text, cx));
    }
    fn rebind_name(&self, name: &str, cx: &mut App) {
        self.source.rebind_name(name, cx);
        let name = name.to_owned();
        self.board.update(cx, |view, _| view.name = name);
    }
    fn undo(&self, redo: bool, window: &mut Window, cx: &mut App) {
        match self.mode.get() {
            Mode::Board => self.board.update(cx, |view, cx| view.history(redo, cx)),
            Mode::Source => self.source.undo(redo, window, cx),
        }
    }
    fn apply(&self, read_only: bool, dark: bool, scale: Scale, window: &mut Window, cx: &mut App) {
        self.source.apply(read_only, dark, scale, window, cx);
        self.board
            .update(cx, |view, cx| view.apply(read_only, dark, cx));
    }
    fn view_state(&self, cx: &App) -> Option<SurfaceViewState> {
        let mut state = self.source.view_state(cx).unwrap_or_default();
        state.mode = Some(match self.mode.get() {
            Mode::Board => "live".into(),
            Mode::Source => "source".into(),
        });
        Some(state)
    }
    fn restore_view_state(&self, state: &SurfaceViewState, window: &mut Window, cx: &mut App) {
        self.source.restore_view_state(state, window, cx);
        if let Some(mode) = state.mode.as_deref() {
            let segment = if mode == "source" {
                PaneSegmentId::Source
            } else {
                PaneSegmentId::Live
            };
            self.pane_segment(segment, window, cx);
        }
    }
    fn command(&self, cmd: HostCommand, window: &mut Window, cx: &mut App) {
        match cmd {
            HostCommand::Undo => self.undo(false, window, cx),
            HostCommand::Redo => self.undo(true, window, cx),
            HostCommand::Source => {
                let next = match self.mode.get() {
                    Mode::Board => PaneSegmentId::Source,
                    Mode::Source => PaneSegmentId::Live,
                };
                self.pane_segment(next, window, cx);
            }
            other if self.mode.get() == Mode::Source => self.source.command(other, window, cx),
            _ => {}
        }
    }
    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        (self.mode.get() == Mode::Source)
            .then(|| self.source.focus_handle(cx))
            .flatten()
    }
    fn find(&self, event: FindEvent, window: &mut Window, cx: &mut App) -> Option<(usize, usize)> {
        match self.mode.get() {
            Mode::Board => {
                let frame = self.board.read(cx).frame.clone()?;
                frame.read(cx).find(event, cx)
            }
            Mode::Source => self.source.find(event, window, cx),
        }
    }
    fn pane(&self, cx: &App) -> PaneEntries {
        let mut entries = match self.mode.get() {
            Mode::Board => PaneEntries {
                find: self.board.read(cx).frame.is_some(),
                ..Default::default()
            },
            Mode::Source => self.source.pane(cx),
        };
        entries.segmented = Some(Segmented {
            label: t("editor.mode.label").into(),
            options: vec![
                Segment {
                    id: "live",
                    icon: "editor-mode-edit",
                    label: t("editor.mode.live").into(),
                },
                Segment {
                    id: "source",
                    icon: "editor-mode-source",
                    label: t("editor.mode.source").into(),
                },
            ],
            value: match self.mode.get() {
                Mode::Board => "live",
                Mode::Source => "source",
            },
        });
        entries
    }
    fn pane_segment(&self, segment: PaneSegmentId, window: &mut Window, cx: &mut App) {
        let next = if matches!(segment, PaneSegmentId::Source) {
            Mode::Source
        } else {
            Mode::Board
        };
        if next == self.mode.get() || (self.mode.get() == Mode::Source && self.source.composing(cx))
        {
            return;
        }
        match next {
            Mode::Source => {
                let latest = self.board.read(cx).text.clone();
                self.source.replace_text(&latest, window, cx);
                self.board.update(cx, |view, cx| view.set_active(false, cx));
                self.mode.set(Mode::Source);
                if let Some(focus) = self.source.focus_handle(cx) {
                    focus.focus(window, cx);
                }
            }
            Mode::Board => {
                if let Some(latest) = self.source.text(cx) {
                    self.board
                        .update(cx, |view, cx| view.replace_text(&latest, cx));
                }
                self.board.update(cx, |view, cx| view.set_active(true, cx));
                self.mode.set(Mode::Board);
            }
        }
        self.host.update(cx, |_, cx| cx.notify());
    }
    fn pane_item(&self, item: PaneItemId, window: &mut Window, cx: &mut App) {
        if self.mode.get() == Mode::Source {
            self.source.pane_item(item, window, cx);
        }
    }
}

impl Render for WhiteboardView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(frame) = &self.frame {
            return div().size_full().child(frame.clone()).into_any_element();
        }
        let p = cx.palette();
        let ty = theme::ty();
        let file_label = Path::new(&self.name)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.name.clone());
        let install_label = if self.loading {
            t("editor.preview.loading")
        } else if self.installing {
            t("native.whiteboard.installingPack")
        } else {
            t("native.whiteboard.installPack")
        };
        div()
            .id("whiteboard-pack-prompt")
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .p(px(32.))
            .bg(p.canvas)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(14.))
                    .max_w(px(460.))
                    .px(px(28.))
                    .py(px(24.))
                    .rounded(px(10.))
                    .border_1()
                    .border_color(theme::alpha(p.divider, 0.72))
                    .bg(p.panel)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .text_size(px(ty.editor.data))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(p.text)
                            .child(Icon::new("editor-mode-edit").with_size(px(16.)))
                            .child(file_label)
                            .child(
                                div()
                                    .text_color(p.text_disabled)
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(" · EXCALIDRAW"),
                            ),
                    )
                    .child(
                        div()
                            .text_size(px(ty.ui.meta))
                            .line_height(relative(1.5))
                            .text_color(p.muted)
                            .text_center()
                            .child(t("native.whiteboard.packDetail").to_owned()),
                    )
                    .children(self.install_error.clone().map(|error| {
                        div()
                            .text_size(px(ty.ui.meta))
                            .text_color(p.danger)
                            .text_center()
                            .child(error)
                    }))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .justify_center()
                            .gap(px(10.))
                            .pt(px(4.))
                            .child(
                                Button::new("whiteboard-install-pack")
                                    .variant(ButtonVariant::Solid)
                                    .icon("download")
                                    .disabled(self.loading || self.installing)
                                    .label(install_label.to_owned())
                                    .on_click(cx.listener(|v, _, _, cx| v.start_install(cx))),
                            )
                            .child(
                                Button::new("whiteboard-view-json")
                                    .variant(ButtonVariant::Secondary)
                                    .icon("editor-mode-source")
                                    .label(t("native.whiteboard.viewJsonSource").to_owned())
                                    .on_click(
                                        cx.listener(|_, _, _, cx| cx.emit(Asked::ViewSource)),
                                    ),
                            ),
                    ),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests;
