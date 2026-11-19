//! The document surface the shell embeds (`DocumentSurfaceHost`): it speaks
//! the document host protocol of `documents.rs` (`HostMessage`) and opens
//! the viewer the registry resolves for the file (`editor::registry`) —
//! Markdown, CSV, source text, images, or an honest placeholder. It never
//! writes files; `documents.rs` owns saving.
//!
//! Enforces per-instance document context delivery (`RG-10`, `RG-11`),
//! capability-based surface dispatch (`RG-20`), typed host commands & pane
//! items (`RG-21`), oversized in-pane explanation cards (`RG-02`), read-only
//! large text banners (`RG-03`), and viewer panic isolation (`RG-23`).
use crate::{
    documents::{ClientMessage, HostMessage, reconcile},
    editor::{
        registry::{
            self, DocumentAssets, DocumentContext, EditorDocument, HostCommand, Presentation,
            PresetViewer, SourceKind, SurfaceEvent, SurfaceFactory, SurfaceInput, SurfaceRequest,
            ViewerSurface,
            packs::{ExtensionHost, Route, route},
        },
        text::buffer::Buffer,
        viewers::{
            code, external,
            html_tools::{HtmlToolAction, HtmlToolEvent, HtmlToolMode, HtmlToolSnapshot},
            placeholder::{self, FaultedOptions, OversizedOptions},
        },
        workbench::view_state::SurfaceViewState,
    },
    theme,
    typography::Scale,
    ui::{
        appearance::ActiveAppearance as _,
        components::{Button, ButtonVariant},
    },
};
use gpui::{prelude::*, *};
use std::{
    any::Any,
    panic::{AssertUnwindSafe, catch_unwind},
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
};

mod chrome;
#[cfg(test)]
mod tests;

actions!(document_editor, [OpenFind]);

/// Key context of the native document pane.
const KEY_CONTEXT: &str = "DocumentEditor";
const FALLBACK_ASSET_MAX_BYTES: u64 = 32 * 1024 * 1024;

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-f", OpenFind, Some(KEY_CONTEXT)),
        KeyBinding::new("ctrl-f", OpenFind, Some(KEY_CONTEXT)),
    ]);
}

pub(super) fn panic_payload_summary(payload: Box<dyn Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_owned()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "viewer panic".to_owned()
    }
}

type PanicCallback = Rc<dyn Fn(&'static str, String, &mut App)>;

struct IsolatedSurfaceElement {
    inner: Option<AnyElement>,
    on_panic: PanicCallback,
}

impl IntoElement for IsolatedSurfaceElement {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for IsolatedSurfaceElement {
    type RequestLayoutState = Option<AnyElement>;
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        if let Some(mut element) = self.inner.take() {
            match catch_unwind(AssertUnwindSafe(|| element.request_layout(window, cx))) {
                Ok(layout_id) => return (layout_id, Some(element)),
                Err(payload) => {
                    (self.on_panic)("layout", panic_payload_summary(payload), cx);
                }
            }
        }
        let mut fallback = div().size_full().into_any_element();
        let layout_id = fallback.request_layout(window, cx);
        (layout_id, None)
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        if let Some(element) = request_layout.as_mut()
            && let Err(payload) = catch_unwind(AssertUnwindSafe(|| element.prepaint(window, cx)))
        {
            *request_layout = None;
            (self.on_panic)("prepaint", panic_payload_summary(payload), cx);
        }
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        _prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        if let Some(element) = request_layout.as_mut()
            && let Err(payload) = catch_unwind(AssertUnwindSafe(|| element.paint(window, cx)))
        {
            *request_layout = None;
            (self.on_panic)("paint", panic_payload_summary(payload), cx);
        }
    }
}

struct Session {
    id: String,
    /// Full workspace-relative or standalone path (`notes/draft.md`).
    raw_path: String,
    /// The file name the pane shows (`editorLabel`).
    name: String,
    baseline: String,
    /// Last logical rope snapshot observed by the host so Working Copy snapshots
    /// survive a viewer panic in `O(1)` without copying full text (`RG-23`, `CE-02`).
    last_known_buffer: Option<Buffer>,
    revision: u64,
    frozen: bool,
    /// The resolved viewer: another viewer for the same id means a new surface.
    viewer: &'static PresetViewer,
    /// The Host's edit gate (`PresetViewer::editable`).
    editable: bool,
    /// `DP-32`: lossy encoding read-only gate.
    lossy_readonly: bool,
    /// `DP-31`: mixed or lone-`CR` line endings require explicit normalization.
    requires_line_ending_normalization: bool,
    /// `RG-03`: `(size_bytes, edit_limit_bytes)` when opened bounded read-only above edit budget.
    read_only_large: Option<(u64, u64)>,
    /// `RG-23`: `true` once the viewer panicked and degraded to `FaultedSurface`.
    faulted: bool,
}

/// Undo/redo fallback step when an external adoption (`DP-03` / `DP-04` / `DP-11`)
/// occurred on a surface whose `replace_text` does not retain undo history.
struct ExternalHistoryStep {
    before: String,
    after: String,
    undone: bool,
}

pub struct DocumentEditor {
    pub workbench: bool,
    /// A file window: the view switch and settings live in its title bar,
    /// so the pane has no handle or menu of its own.
    pub file_mode: bool,
    /// The document only reads (a file window's lossy text): the surface
    /// takes no edits, while view switches still work.
    pub read_only: bool,
    /// Chrome floating over the document's top (a file window's title bar);
    /// every surface it shows keeps that room at rest.
    chrome_inset: f32,
    pub pane_drag: Option<crate::editor::workbench::pane::PaneDrag>,
    session: Option<Session>,
    surface: Option<Box<dyn ViewerSurface>>,
    subscription: Option<Subscription>,
    focus: FocusHandle,
    dark: bool,
    scale: Scale,
    blocked: bool,
    chrome: crate::editor::workbench::pane::PaneChrome,
    find: Option<Entity<crate::editor::workbench::find::FindBar>>,
    find_subscription: Option<Subscription>,
    bounds: Option<Bounds<Pixels>>,
    extensions: Option<ExtensionHost>,
    references: Option<crate::editor::navigation::ReferenceContext>,
    workspace: Option<Arc<crate::workspace::Workspace>>,
    /// Per-instance document context delivered by `HostMessage::Context` (`RG-10`, `RG-11`).
    active_context: Option<(String, DocumentContext)>,
    /// `normalizeContent`: the text the surface was given and the raw text
    /// it stands for, until the person edits.
    displayed: Option<(String, String)>,
    external_history: Option<ExternalHistoryStep>,
    suppress_surface_change: bool,
    html_events: Vec<HtmlToolEvent>,
    #[cfg(test)]
    custom_factory: Option<SurfaceFactory>,
}

impl EventEmitter<ClientMessage> for DocumentEditor {}

impl DocumentEditor {
    #[cfg(feature = "test-support")]
    pub fn csv_editor(&self) -> Option<Entity<crate::editor::csv::CsvEditor>> {
        self.surface.as_ref()?.as_test_probe()?.csv_editor()
    }

    /// Window tests deliver a web page's message to the open surface.
    #[cfg(feature = "test-support")]
    pub fn page_deliver(&self, body: &str, cx: &mut App) -> bool {
        self.surface
            .as_ref()
            .and_then(|s| s.as_test_probe())
            .is_some_and(|probe| probe.page_deliver(body, cx))
    }

    /// The generation the open page's next messages must carry.
    #[cfg(feature = "test-support")]
    pub fn page_generation(&self, cx: &App) -> Option<u64> {
        self.surface.as_ref()?.as_test_probe()?.page_generation(cx)
    }

    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            workbench: false,
            file_mode: false,
            chrome_inset: 0.,
            read_only: false,
            pane_drag: None,
            session: None,
            surface: None,
            subscription: None,
            focus: cx.focus_handle(),
            dark: true,
            scale: crate::theme::scale(),
            blocked: false,
            chrome: crate::editor::workbench::pane::PaneChrome::new(cx.focus_handle()),
            find: None,
            find_subscription: None,
            bounds: None,
            extensions: None,
            references: None,
            workspace: None,
            active_context: None,
            displayed: None,
            external_history: None,
            suppress_surface_change: false,
            html_events: Vec::new(),
            #[cfg(test)]
            custom_factory: None,
        }
    }

    /// Install the host port for external Viewer Packs.
    #[cfg(test)]
    pub fn set_extension_host(&mut self, host: Option<ExtensionHost>) {
        self.extensions = host;
    }

    /// Injects a test surface factory (for `RG-23` viewer panic isolation tests).
    #[cfg(test)]
    pub fn set_test_surface_factory(&mut self, factory: Option<SurfaceFactory>) {
        self.custom_factory = factory;
    }

    /// The workspace of the next documents this host opens.
    pub fn set_workspace(&mut self, workspace: Option<Arc<crate::workspace::Workspace>>) {
        self.workspace = workspace;
    }

    pub fn set_reference_context(
        &mut self,
        context: Option<crate::editor::navigation::ReferenceContext>,
        cx: &mut Context<Self>,
    ) {
        if self.references == context {
            return;
        }
        self.references = context.clone();
        let mut panicked = None;
        if let Some(surface) = &self.surface
            && let Err(payload) = catch_unwind(AssertUnwindSafe(|| {
                surface.set_reference_context(context, cx)
            }))
        {
            panicked = Some(panic_payload_summary(payload));
        }
        if let Some(msg) = panicked {
            self.degrade_to_faulted("set_reference_context", msg, cx);
        }
    }

    /// Whether the active document currently requires explicit line-ending
    /// normalization (`DP-31`).
    pub fn requires_line_ending_normalization(&self) -> bool {
        self.session
            .as_ref()
            .is_some_and(|s| s.requires_line_ending_normalization)
    }

    /// Whether the active document opened read-only due to lossy text decoding (`DP-32`).
    pub fn is_lossy_readonly(&self) -> bool {
        self.session.as_ref().is_some_and(|s| s.lossy_readonly)
    }

    /// Whether the active document opened bounded read-only above its edit budget (`RG-03`).
    pub fn is_read_only_large(&self) -> bool {
        self.session
            .as_ref()
            .is_some_and(|s| s.read_only_large.is_some())
    }

    /// Whether the active surface degraded to `FaultedSurface` after a panic (`RG-23`).
    pub fn is_faulted(&self) -> bool {
        self.session.as_ref().is_some_and(|s| s.faulted)
    }

    /// Whether an input-method composition is open (`WB-01` retention guard).
    pub fn composing(&self, cx: &App) -> bool {
        if self.is_faulted() {
            return false;
        }
        self.surface
            .as_ref()
            .and_then(|s| catch_unwind(AssertUnwindSafe(|| s.composing(cx))).ok())
            .unwrap_or(false)
    }

    /// Whether the open surface's undo history lives only in its page
    /// (`WB-01` retention guard).
    pub fn holds_page_history(&self, cx: &App) -> bool {
        if self.is_faulted() {
            return false;
        }
        self.surface
            .as_ref()
            .and_then(|s| catch_unwind(AssertUnwindSafe(|| s.holds_page_history(cx))).ok())
            .unwrap_or(false)
    }

    /// Captures serializable cursor/scroll/mode/zoom/fold state (`WB-10`).
    pub fn view_state(&self, cx: &App) -> Option<SurfaceViewState> {
        if self.is_faulted() {
            return None;
        }
        let surface = self.surface.as_ref()?;
        catch_unwind(AssertUnwindSafe(|| surface.view_state(cx)))
            .ok()
            .flatten()
    }

    /// Restores cursor/scroll/mode/zoom/fold state, clamping to current bounds (`WB-10`, `WB-11`).
    pub fn restore_view_state(
        &mut self,
        state: &SurfaceViewState,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.is_faulted() {
            return;
        }
        let mut panicked = None;
        if let Some(surface) = &self.surface
            && let Err(payload) = catch_unwind(AssertUnwindSafe(|| {
                surface.restore_view_state(state, window, cx)
            }))
        {
            panicked = Some(panic_payload_summary(payload));
        }
        if let Some(msg) = panicked {
            self.degrade_to_faulted("restore_view_state", msg, cx);
            cx.notify();
        }
    }

    fn context_for(&self, id: &str, name: &str) -> DocumentContext {
        if let Some((ctx_id, ctx)) = &self.active_context
            && ctx_id == id
        {
            return ctx.clone();
        }
        // Fallback when `DocumentEditor` is driven directly in standalone tests or `lab.rs`.
        let rel = Path::new(name);
        let folder = self
            .workspace
            .as_ref()
            .filter(|ws| ws.local_root().is_some())
            .and_then(|ws| ws.absolute(rel).ok())
            .and_then(|p| p.parent().map(PathBuf::from));
        let assets = self
            .workspace
            .as_ref()
            .filter(|ws| ws.capabilities().preview)
            .and_then(|ws| {
                let root = ws.resource_id(Path::new("")).ok()?;
                let ws_clone = ws.clone();
                Some(DocumentAssets {
                    workspace: crate::editor::workbench::catalog::resource_key(&root),
                    document: rel.to_path_buf(),
                    read: Arc::new(move |path: &Path| {
                        ws_clone
                            .resource(path)
                            .ok()?
                            .bytes(FALLBACK_ASSET_MAX_BYTES)
                    }),
                })
            });
        let source_kind = self
            .workspace
            .as_ref()
            .map_or(SourceKind::Local, |ws| SourceKind::from_workspace(ws));
        DocumentContext {
            folder,
            web_source: None,
            assets,
            source_kind,
            sniffed_format: None,
            models: Default::default(),
        }
    }

    fn resolve_for_host(
        &self,
        id: &str,
        name: &str,
    ) -> (EditorDocument, registry::Resolved, DocumentContext) {
        let context = self.context_for(id, name);
        let document = EditorDocument::with_source(name, context.source_kind);
        let resolved = match context.sniffed_format {
            Some(fmt) => registry::resolve_with_format(&document, fmt),
            None => registry::resolve(&document),
        };
        (document, resolved, context)
    }

    fn local_file_path(&self, id: &str, name: &str) -> Option<PathBuf> {
        if let Some(ws) = &self.workspace
            && ws.local_root().is_some()
            && let Ok(abs) = ws.absolute(Path::new(name))
        {
            return Some(abs);
        }
        let ctx = self.context_for(id, name);
        if ctx.source_kind.is_local()
            && let Some(folder) = ctx.folder
            && let Some(file_name) = Path::new(name).file_name()
        {
            return Some(folder.join(file_name));
        }
        None
    }

    /// Swaps ONLY this Pane's surface to `FaultedSurface`, logs a single
    /// diagnostic, and preserves `Session.last_known_text` so `Documents` keeps
    /// the Working Copy and unsaved edits (`RG-23`).
    pub(super) fn degrade_to_faulted(
        &mut self,
        phase: &'static str,
        panic_msg: String,
        cx: &mut App,
    ) {
        let already_faulted = self.session.as_ref().is_some_and(|s| s.faulted);
        let doc_name = self
            .session
            .as_ref()
            .map(|s| s.raw_path.clone())
            .unwrap_or_else(|| "document".into());
        let doc_id = self
            .session
            .as_ref()
            .map(|s| s.id.clone())
            .unwrap_or_default();
        if !already_faulted {
            crate::platform::diagnostics::warn(
                "editor.viewer.panic",
                format!("viewer panicked in {phase} for `{doc_name}`: {panic_msg}").into(),
            );
        }
        if let Some(session) = &mut self.session {
            session.faulted = true;
        }
        let can_switch_plain_text = self
            .session
            .as_ref()
            .is_some_and(|s| s.last_known_buffer.is_some());
        let local_path = self.local_file_path(&doc_id, &doc_name);
        self.subscription = None;
        self.chrome.open = false;
        if let Some(bar) = &self.find {
            bar.update(cx, |b, cx| b.hide(cx));
        }
        // Build callbacks through weak handles when mounted inside an entity context;
        // `degrade_to_faulted` is invoked from `&mut Context<Self>` via `install_faulted_surface`.
        let _ = (can_switch_plain_text, local_path);
    }

    pub(super) fn install_faulted_surface(
        &mut self,
        phase: &'static str,
        panic_msg: String,
        cx: &mut Context<Self>,
    ) {
        self.degrade_to_faulted(phase, panic_msg.clone(), cx);
        let doc_name = self
            .session
            .as_ref()
            .map(|s| s.raw_path.clone())
            .unwrap_or_else(|| "document".into());
        let doc_id = self
            .session
            .as_ref()
            .map(|s| s.id.clone())
            .unwrap_or_default();
        let can_switch_plain_text = self
            .session
            .as_ref()
            .is_some_and(|s| s.last_known_buffer.is_some());
        let local_path = self.local_file_path(&doc_id, &doc_name);
        let weak_close = cx.weak_entity();
        let weak_plain = cx.weak_entity();
        let surface = placeholder::open_faulted(
            FaultedOptions {
                name: doc_name,
                diagnostic: format!("Viewer crashed ({phase}): {panic_msg}"),
                local_path,
                can_switch_plain_text,
                on_close: Rc::new(move |_, cx| {
                    let _ = weak_close.update(cx, |_, cx| {
                        cx.emit(ClientMessage::Action {
                            action: "close-file".into(),
                        });
                    });
                }),
                on_switch_plain_text: can_switch_plain_text.then(|| {
                    Rc::new(move |window: &mut Window, cx: &mut App| {
                        let _ = weak_plain.update(cx, |this, cx| {
                            this.switch_faulted_to_plain_text(window, cx);
                        });
                    }) as Rc<dyn Fn(&mut Window, &mut App)>
                }),
            },
            cx,
        );
        self.surface = Some(surface);
    }

    fn switch_faulted_to_plain_text(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((id, raw_path, text)) = self.session.as_ref().and_then(|s| {
            let buf = s.last_known_buffer.as_ref()?;
            Some((
                s.id.clone(),
                s.raw_path.clone(),
                buf.slice_cow(0..buf.len()).into_owned(),
            ))
        }) else {
            return;
        };
        let (_, resolved, context) = self.resolve_for_host(&id, &raw_path);
        let request = SurfaceRequest {
            id: &id,
            name: &raw_path,
            input: SurfaceInput::Text(&text),
            format: crate::formats::resolve(Some("fallback.txt"), None),
            resolved_extension: resolved.resolved_extension.as_deref(),
            dark: self.dark,
            scale: self.scale,
            workspace: self.workspace.clone(),
            file_mode: self.file_mode,
            folder: context.folder,
            web_source: context.web_source,
            assets: context.assets,
            references: self.references.clone(),
            source_kind: context.source_kind,
            models: context.models,
        };
        let surface = code::open_with(&request, Some("plaintext"), false, window, cx);
        self.displayed = None;
        if let Some(session) = &mut self.session {
            session.faulted = false;
            session.viewer = registry::resolve(&EditorDocument::local("fallback.txt")).viewer;
            session.editable = session.read_only_large.is_none();
        }
        self.bind_surface(surface, &id, cx);
        self.apply_gate(window, cx);
        cx.notify();
    }

    /// A placeholder-grade local document an installed pack renders, when
    /// the host can render packs (`EditorDocumentHost`'s plugin routes).
    /// Pack surfaces see the document, never its working copy's models.
    fn extension_surface(
        &self,
        document: &EditorDocument,
        request: &SurfaceRequest,
        window: &mut Window,
        cx: &mut App,
    ) -> Option<Box<dyn ViewerSurface>> {
        let host = self.extensions.as_ref()?;
        let render = host.surface?;
        let request = &SurfaceRequest {
            models: Default::default(),
            ..request.clone()
        };
        match route::route_for_document(document, &host.snapshot) {
            Route::Plugin(pack) => Some(render(request, pack, window, cx)),
            Route::Chooser(candidates) => Some(external::chooser(
                request,
                candidates.into_iter().cloned().collect(),
                render,
                cx,
            )),
            Route::Core { .. } | Route::Unsupported(_) => None,
        }
    }

    fn bind_surface(&mut self, surface: Box<dyn ViewerSurface>, id: &str, cx: &mut Context<Self>) {
        let refs = self.references.clone();
        let inset = self.chrome_inset;
        let _ = catch_unwind(AssertUnwindSafe(|| {
            surface.set_reference_context(refs, cx);
            surface.set_chrome_inset(inset, cx);
        }));
        let host = cx.weak_entity();
        let input_id = id.to_owned();
        self.subscription = catch_unwind(AssertUnwindSafe(|| {
            surface.subscribe(
                Rc::new(move |event, cx| {
                    let host = host.clone();
                    let input_id = input_id.clone();
                    cx.defer(move |cx| {
                        let _ = host.update(cx, |s, cx| match event {
                            SurfaceEvent::RetryInput => {
                                cx.emit(ClientMessage::RetryInput { id: input_id })
                            }
                            SurfaceEvent::Changed => s.changed(cx),
                            SurfaceEvent::Redraw => cx.notify(),
                            SurfaceEvent::FindResult { current, total } => {
                                if let Some(bar) = &s.find {
                                    bar.update(cx, |b, cx| b.set_result(current, total, cx));
                                }
                            }
                            SurfaceEvent::OpenPaths(paths) => {
                                cx.emit(ClientMessage::OpenPaths { paths })
                            }
                            SurfaceEvent::HtmlTool(ev) => {
                                s.html_events.push(ev);
                                cx.notify();
                            }
                        });
                    });
                }),
                cx,
            )
        }))
        .ok()
        .flatten();
        self.chrome.open = false;
        if let Some(bar) = &self.find {
            bar.update(cx, |b, cx| b.hide(cx));
        }
        self.surface = Some(surface);
    }

    /// Open the resolved viewer's surface for a document and follow its
    /// changes (`RG-10`, `RG-11`, `RG-23`).
    fn open_surface(
        &mut self,
        id: &str,
        name: &str,
        input: SurfaceInput,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> (&'static PresetViewer, bool, Option<String>) {
        let (document, resolved, context) = self.resolve_for_host(id, name);
        let viewer = resolved.viewer;
        let editable = match input {
            SurfaceInput::Text(text) => viewer.editable(&resolved.view_match(&document), text),
            _ => false,
        };
        let request = SurfaceRequest {
            id,
            name,
            input,
            format: resolved.format,
            resolved_extension: resolved.resolved_extension.as_deref(),
            dark: self.dark,
            scale: self.scale,
            workspace: self.workspace.clone(),
            file_mode: self.file_mode,
            folder: context.folder,
            web_source: context.web_source,
            assets: context.assets,
            references: self.references.clone(),
            source_kind: context.source_kind,
            models: context.models,
        };
        #[cfg(test)]
        let custom = self.custom_factory;
        #[cfg(not(test))]
        let custom: Option<SurfaceFactory> = None;

        let opened = catch_unwind(AssertUnwindSafe(|| {
            if let Some(factory) = custom {
                return factory(&request, window, cx);
            }
            match self.extension_surface(&document, &request, window, cx) {
                Some(surface) => surface,
                None => match viewer.presentation {
                    Presentation::Native(open) => open(&request, window, cx),
                },
            }
        }));
        match opened {
            Ok(surface) => {
                self.bind_surface(surface, id, cx);
                (viewer, editable, None)
            }
            Err(payload) => (viewer, editable, Some(panic_payload_summary(payload))),
        }
    }

    fn changed(&mut self, cx: &mut Context<Self>) {
        if std::mem::take(&mut self.suppress_surface_change) {
            return;
        }
        let Some(buf) = self.buffer(cx) else { return };
        let Some(session) = &mut self.session else {
            return;
        };
        self.external_history = None;
        session.revision += 1;
        session.last_known_buffer = Some(buf.clone());
        let dirty = !buf.eq_str(&session.baseline);
        let id = session.id.clone();
        let revision = session.revision;
        cx.emit(ClientMessage::LiveBuffer {
            id: id.clone(),
            revision,
            text: buf,
        });
        cx.emit(ClientMessage::Dirty {
            id,
            revision,
            dirty,
        });
    }

    /// `O(1)` logical [`Buffer`] snapshot (`CE-02`, `DP-44`, `RG-23`).
    pub fn buffer(&self, cx: &App) -> Option<Buffer> {
        if self.is_faulted() {
            return self.session.as_ref()?.last_known_buffer.clone();
        }
        let Some(surface) = &self.surface else {
            return None;
        };
        match catch_unwind(AssertUnwindSafe(|| surface.buffer(cx))) {
            Ok(Some(shown)) => Some(match &self.displayed {
                Some((normalized, raw)) if shown.eq_str(normalized) => Buffer::new(raw.clone()),
                _ => shown,
            }),
            Ok(None) => None,
            Err(_) => self
                .session
                .as_ref()
                .and_then(|s| s.last_known_buffer.clone()),
        }
    }

    /// Logical text snapshot (`displayed` normalization respected, falling back
    /// to `last_known_buffer` if the viewer surface faulted: `RG-23`).
    pub fn text(&self, cx: &App) -> Option<String> {
        self.buffer(cx)
            .map(|b| b.slice_cow(0..b.len()).into_owned())
    }

    fn perform_history(&mut self, redo: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.is_faulted() {
            return;
        }
        let before = self.text(cx);
        let mut panicked = None;
        if let Some(surface) = &self.surface
            && let Err(payload) = catch_unwind(AssertUnwindSafe(|| surface.undo(redo, window, cx)))
        {
            panicked = Some(panic_payload_summary(payload));
        }
        if let Some(msg) = panicked {
            self.install_faulted_surface("undo", msg, cx);
            return;
        }
        let after = self.buffer(cx);
        if after.as_ref().map(|b| b.slice_cow(0..b.len()).into_owned()) != before {
            if let (Some(session), Some(latest)) = (&mut self.session, after) {
                session.last_known_buffer = Some(latest);
            }
            self.external_history = None;
            return;
        }
        let target = match (&mut self.external_history, redo) {
            (Some(step), false) if !step.undone => {
                step.undone = true;
                Some(step.before.clone())
            }
            (Some(step), true) if step.undone => {
                step.undone = false;
                Some(step.after.clone())
            }
            _ => None,
        };
        if let Some(target_text) = target {
            let keep = self.external_history.take();
            self.replace_document_text(&target_text, window, cx);
            self.external_history = keep;
        }
    }

    pub fn receive(
        &mut self,
        message: &HostMessage,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<ClientMessage> {
        let mut replies = Vec::new();
        match message {
            HostMessage::Context { id, context } => {
                self.active_context = Some((id.clone(), context.clone()));
            }
            HostMessage::Open {
                id,
                name,
                text,
                revision,
                external,
            } => {
                if self
                    .active_context
                    .as_ref()
                    .is_some_and(|(ctx_id, _)| ctx_id != id)
                {
                    self.active_context = None;
                }
                let (_, resolved, _) = self.resolve_for_host(id, name);
                let viewer_id = resolved.viewer.id;
                let normalized = registry::normalize::normalize(viewer_id, text);
                let shown = normalized.as_deref().unwrap_or(text);
                let same = self
                    .session
                    .as_ref()
                    .is_some_and(|s| &s.id == id && s.viewer.id == viewer_id && !s.faulted)
                    && self.surface.is_some();
                let prev_policy = self
                    .session
                    .as_ref()
                    .filter(|s| &s.id == id && *external)
                    .map(|s| {
                        (
                            s.lossy_readonly,
                            s.requires_line_ending_normalization,
                            s.read_only_large,
                        )
                    })
                    .unwrap_or((false, false, None));

                let factory_panic;
                let (viewer, editable) = if same {
                    let previous_raw = self.text(cx);
                    let previous_shown = self
                        .surface
                        .as_ref()
                        .and_then(|s| catch_unwind(AssertUnwindSafe(|| s.text(cx))).ok().flatten());
                    let mut update_panic = None;
                    if previous_raw.as_ref() != Some(text) || *external {
                        if *external
                            && previous_shown.as_deref() != Some(shown)
                            && let (Some(surface), Some(prev_shown)) =
                                (&self.surface, &previous_shown)
                        {
                            let edits = reconcile::minimal_utf16_edits(prev_shown, shown);
                            let edit_res = catch_unwind(AssertUnwindSafe(|| {
                                !edits.is_empty()
                                    && !surface.composing(cx)
                                    && surface.edit_utf16(&edits, window, cx)
                            }));
                            match edit_res {
                                Ok(true) => {
                                    self.suppress_surface_change = true;
                                    self.external_history = None;
                                }
                                Ok(false) => {
                                    if let Err(payload) = catch_unwind(AssertUnwindSafe(|| {
                                        surface.replace_text(shown, window, cx)
                                    })) {
                                        update_panic = Some(panic_payload_summary(payload));
                                    } else if let Some(prev_raw) =
                                        previous_raw.filter(|p| p != text)
                                    {
                                        self.external_history = Some(ExternalHistoryStep {
                                            before: prev_raw,
                                            after: text.clone(),
                                            undone: false,
                                        });
                                    }
                                }
                                Err(payload) => {
                                    update_panic = Some(panic_payload_summary(payload));
                                }
                            }
                        } else if previous_shown.as_deref() != Some(shown)
                            && let Some(surface) = &self.surface
                            && let Err(payload) = catch_unwind(AssertUnwindSafe(|| {
                                surface.replace_text(shown, window, cx)
                            }))
                        {
                            update_panic = Some(panic_payload_summary(payload));
                        }
                        self.displayed = normalized.clone().map(|n| (n, text.clone()));
                    }
                    factory_panic = update_panic;
                    let session = self.session.as_ref().unwrap();
                    (session.viewer, session.editable)
                } else {
                    self.external_history = None;
                    self.displayed = normalized.clone().map(|n| (n, text.clone()));
                    let (v, ed, p) =
                        self.open_surface(id, name, SurfaceInput::Text(shown), window, cx);
                    factory_panic = p;
                    (v, ed)
                };
                self.session = Some(Session {
                    id: id.clone(),
                    raw_path: name.clone(),
                    name: label(name),
                    baseline: text.clone(),
                    last_known_buffer: Some(Buffer::new(text.clone())),
                    revision: *revision,
                    frozen: false,
                    viewer,
                    editable,
                    lossy_readonly: prev_policy.0,
                    requires_line_ending_normalization: prev_policy.1,
                    read_only_large: prev_policy.2,
                    faulted: false,
                });
                if let Some(msg) = factory_panic {
                    self.install_faulted_surface("open_surface", msg, cx);
                }
                replies.push(ClientMessage::Loaded { id: id.clone() });
            }
            HostMessage::OpenResource { id, name, path } => {
                if self
                    .active_context
                    .as_ref()
                    .is_some_and(|(ctx_id, _)| ctx_id != id)
                {
                    self.active_context = None;
                }
                self.displayed = None;
                self.external_history = None;
                let (viewer, editable, panicked) =
                    self.open_surface(id, name, SurfaceInput::Resource(path), window, cx);
                self.session = Some(Session {
                    id: id.clone(),
                    raw_path: name.clone(),
                    name: label(name),
                    baseline: String::new(),
                    last_known_buffer: None,
                    revision: 0,
                    frozen: false,
                    viewer,
                    editable,
                    lossy_readonly: false,
                    requires_line_ending_normalization: false,
                    read_only_large: None,
                    faulted: false,
                });
                if let Some(msg) = panicked {
                    self.install_faulted_surface("open_surface", msg, cx);
                }
                replies.push(ClientMessage::Loaded { id: id.clone() });
            }
            HostMessage::ReadOnlyLarge {
                id,
                size_bytes,
                edit_limit_bytes,
            } => {
                if let Some(session) = &mut self.session
                    && &session.id == id
                {
                    session.read_only_large = Some((*size_bytes, *edit_limit_bytes));
                    session.editable = false;
                }
            }
            HostMessage::Oversized {
                id,
                name,
                size_bytes,
                limit_bytes,
                can_reveal_in_finder,
            } => {
                if self
                    .active_context
                    .as_ref()
                    .is_some_and(|(ctx_id, _)| ctx_id != id)
                {
                    self.active_context = None;
                }
                self.displayed = None;
                self.external_history = None;
                let (_, resolved, _) = self.resolve_for_host(id, name);
                let local_path = self.local_file_path(id, name);
                let surface = placeholder::open_oversized(
                    OversizedOptions {
                        name: name.clone(),
                        size_bytes: *size_bytes,
                        limit_bytes: *limit_bytes,
                        local_path,
                        can_reveal_in_finder: *can_reveal_in_finder,
                    },
                    cx,
                );
                self.bind_surface(surface, id, cx);
                self.session = Some(Session {
                    id: id.clone(),
                    raw_path: name.clone(),
                    name: label(name),
                    baseline: String::new(),
                    last_known_buffer: None,
                    revision: 0,
                    frozen: false,
                    viewer: resolved.viewer,
                    editable: false,
                    lossy_readonly: false,
                    requires_line_ending_normalization: false,
                    read_only_large: None,
                    faulted: false,
                });
                replies.push(ClientMessage::Loaded { id: id.clone() });
            }
            HostMessage::Clear => {
                self.displayed = None;
                self.external_history = None;
                self.active_context = None;
                self.html_events.clear();
                self.session = None;
                self.surface = None;
                self.subscription = None;
                self.chrome.open = false;
                if let Some(bar) = &self.find {
                    bar.update(cx, |b, cx| b.hide(cx));
                }
            }
            HostMessage::Snapshot { request, freeze } => {
                let composing = self.composing(cx);
                let buf = self.buffer(cx);
                if let (Some(session), Some(buf)) = (&mut self.session, buf) {
                    if composing {
                        replies.push(ClientMessage::Deferred {
                            request: *request,
                            id: session.id.clone(),
                        });
                    } else {
                        session.frozen = *freeze;
                        session.last_known_buffer = Some(buf.clone());
                        replies.push(ClientMessage::Snapshot {
                            request: *request,
                            id: session.id.clone(),
                            revision: session.revision,
                            text: buf,
                        });
                    }
                }
            }
            HostMessage::Thaw => {
                if let Some(session) = &mut self.session {
                    session.frozen = false;
                }
            }
            HostMessage::Rebind { id, name, resource } => {
                let (_, resolved, _) = self.resolve_for_host(id, name);
                let next = resolved.viewer;
                let switch = self.session.as_ref().is_some_and(|session| {
                    &session.id == id && !session.faulted && session.viewer.id != next.id
                });
                if switch {
                    let input = match resource {
                        Some(resource) => Some((SurfaceInput::Resource(resource), None)),
                        None => self.text(cx).map(|text| (SurfaceInput::None, Some(text))),
                    };
                    if let Some((input, text)) = input {
                        let (viewer, editable, panicked) = match &text {
                            Some(text) => {
                                let normalized = registry::normalize::normalize(next.id, text);
                                let shown = normalized.as_deref().unwrap_or(text);
                                self.displayed = normalized.clone().map(|n| (n, text.clone()));
                                self.open_surface(id, name, SurfaceInput::Text(shown), window, cx)
                            }
                            None => {
                                self.displayed = None;
                                self.open_surface(id, name, input, window, cx)
                            }
                        };
                        if let Some(session) = &mut self.session {
                            session.raw_path = name.clone();
                            session.name = label(name);
                            session.viewer = viewer;
                            session.editable = editable && session.read_only_large.is_none();
                        }
                        if let Some(msg) = panicked {
                            self.install_faulted_surface("rebind_open", msg, cx);
                        }
                    }
                } else if let Some(session) = &mut self.session
                    && &session.id == id
                {
                    session.raw_path = name.clone();
                    session.name = label(name);
                    let mut panicked = None;
                    if let Some(surface) = &self.surface
                        && let Err(payload) =
                            catch_unwind(AssertUnwindSafe(|| surface.rebind_name(name, cx)))
                    {
                        panicked = Some(panic_payload_summary(payload));
                    }
                    if panicked.is_none()
                        && let (Some(surface), Some(resource)) = (&self.surface, resource)
                        && let Err(payload) =
                            catch_unwind(AssertUnwindSafe(|| surface.rebind_resource(resource, cx)))
                    {
                        panicked = Some(panic_payload_summary(payload));
                    }
                    if let Some(msg) = panicked {
                        self.install_faulted_surface("rebind", msg, cx);
                    }
                }
            }
            HostMessage::Saved { id, revision, text } => {
                if let Some(session) = &mut self.session
                    && id == &session.id
                    && *revision <= session.revision
                {
                    session.baseline = text.clone();
                }
            }
            HostMessage::History { id, redo } => {
                if self.session.as_ref().is_some_and(|s| &s.id == id) {
                    self.perform_history(*redo, window, cx);
                }
            }
            HostMessage::Policy {
                id,
                lossy_readonly,
                requires_line_ending_normalization,
            } => {
                if let Some(session) = &mut self.session
                    && &session.id == id
                {
                    session.lossy_readonly = *lossy_readonly;
                    session.requires_line_ending_normalization =
                        *requires_line_ending_normalization;
                }
            }
            HostMessage::ExternalUndoSeed { id, previous_text } => {
                if self.session.as_ref().is_some_and(|s| &s.id == id) {
                    let current = self.text(cx).unwrap_or_default();
                    if current != *previous_text {
                        self.external_history = Some(ExternalHistoryStep {
                            before: previous_text.clone(),
                            after: current,
                            undone: false,
                        });
                    }
                }
            }
        }
        self.apply_gate(window, cx);
        cx.notify();
        replies
    }

    /// See `chrome_inset`.
    pub fn set_chrome_inset(&mut self, top: f32, cx: &mut Context<Self>) {
        if self.chrome_inset != top {
            self.chrome_inset = top;
            let mut panicked = None;
            if let Some(surface) = &self.surface
                && let Err(payload) =
                    catch_unwind(AssertUnwindSafe(|| surface.set_chrome_inset(top, cx)))
            {
                panicked = Some(panic_payload_summary(payload));
            }
            if let Some(msg) = panicked {
                self.install_faulted_surface("set_chrome_inset", msg, cx);
            }
            cx.notify();
        }
    }

    /// How far the shown document is scrolled, and whether its top edge is
    /// a pinned header row.
    pub fn scroll_state(&self, cx: &App) -> (f32, bool) {
        if self.is_faulted() {
            return (0., false);
        }
        self.surface
            .as_ref()
            .and_then(|s| catch_unwind(AssertUnwindSafe(|| s.scroll_state(cx))).ok())
            .unwrap_or((0., false))
    }

    pub fn gate(&mut self, blocked: bool, dark: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.blocked = blocked;
        self.dark = dark;
        self.scale = crate::theme::scale();
        self.apply_gate(window, cx);
    }

    fn apply_gate(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.is_faulted() {
            return;
        }
        let read_only = self.blocked
            || self.read_only
            || self
                .workspace
                .as_ref()
                .is_some_and(|workspace| !workspace.capabilities().write)
            || self.session.as_ref().is_none_or(|s| {
                s.frozen
                    || !s.editable
                    || s.lossy_readonly
                    || s.requires_line_ending_normalization
                    || s.read_only_large.is_some()
            });
        let (dark, scale) = (self.dark, self.scale);
        let mut panicked = None;
        if let Some(surface) = &self.surface
            && let Err(payload) = catch_unwind(AssertUnwindSafe(|| {
                surface.apply(read_only, dark, scale, window, cx)
            }))
        {
            panicked = Some(panic_payload_summary(payload));
        }
        if let Some(msg) = panicked {
            self.install_faulted_surface("apply", msg, cx);
        }
    }

    /// Menu and shell commands (`HostCommand`, `RG-21`, panic-isolated `RG-23`).
    pub fn command(
        &mut self,
        cmd: impl Into<HostCommand>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.blocked || self.is_faulted() {
            return;
        }
        let cmd = cmd.into();
        if matches!(cmd, HostCommand::Undo | HostCommand::Redo) {
            self.perform_history(cmd == HostCommand::Redo, window, cx);
            self.focus_document(window, cx);
            return;
        }
        let mut panicked = None;
        if let Some(surface) = &self.surface {
            if let Err(payload) =
                catch_unwind(AssertUnwindSafe(|| surface.command(cmd, window, cx)))
            {
                panicked = Some(panic_payload_summary(payload));
            }
        } else {
            return;
        }
        if let Some(msg) = panicked {
            self.install_faulted_surface("command", msg, cx);
            cx.notify();
            return;
        }
        self.focus_document(window, cx);
    }

    /// Captures and window tests type `text` at the end of the first line,
    /// as the input method would deliver it.
    #[cfg(any(feature = "dev-capture", feature = "test-support"))]
    pub fn lab_type(&self, text: &str, window: &mut Window, cx: &mut App) {
        use gpui::EntityInputHandler as _;
        let Some(view) = self
            .surface
            .as_ref()
            .and_then(|s| s.as_test_probe())
            .and_then(|p| p.editor_view())
        else {
            return;
        };
        view.update(cx, |v, cx| {
            let end = v.state().doc.line_range(0).end;
            v.set_selection(crate::editor::text::selection::Selection::cursor(end), cx);
            v.replace_text_in_range(None, text, window, cx);
        });
    }

    /// The open document's viewer (`markdown`, `csv`, …).
    pub fn viewer_id(&self) -> Option<&'static str> {
        self.session.as_ref().map(|s| s.viewer.id)
    }

    pub fn html_tool_state(&self) -> Option<HtmlToolSnapshot> {
        self.surface.as_ref()?.as_html_tools()?.html_tool_state()
    }

    pub fn set_html_tool(
        &mut self,
        mode: HtmlToolMode,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let mut panicked = None;
        if let Some(tools) = self.surface.as_ref().and_then(|s| s.as_html_tools()) {
            if let Err(payload) =
                catch_unwind(AssertUnwindSafe(|| tools.set_html_tool(mode, window, cx)))
            {
                panicked = Some(panic_payload_summary(payload));
            }
            cx.notify();
        }
        if let Some(msg) = panicked {
            self.install_faulted_surface("set_html_tool", msg, cx);
            cx.notify();
        }
    }

    pub fn trigger_html_action(
        &mut self,
        action: HtmlToolAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let mut panicked = None;
        if let Some(tools) = self.surface.as_ref().and_then(|s| s.as_html_tools()) {
            if let Err(payload) = catch_unwind(AssertUnwindSafe(|| {
                tools.trigger_html_action(action, window, cx)
            })) {
                panicked = Some(panic_payload_summary(payload));
            }
            cx.notify();
        }
        if let Some(msg) = panicked {
            self.install_faulted_surface("trigger_html_action", msg, cx);
            cx.notify();
        }
    }

    pub fn take_html_events(&mut self) -> Vec<HtmlToolEvent> {
        std::mem::take(&mut self.html_events)
    }

    /// Replaces the entire open document text in-place and marks it dirty so
    /// File Mode autosave persists the restored snapshot immediately.
    pub fn replace_document_text(
        &mut self,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.is_faulted() {
            return;
        }
        let mut panicked = None;
        if let Some(surface) = &self.surface {
            if let Err(payload) =
                catch_unwind(AssertUnwindSafe(|| surface.replace_text(text, window, cx)))
            {
                panicked = Some(panic_payload_summary(payload));
            } else {
                self.displayed = None;
                self.changed(cx);
                cx.notify();
            }
        }
        if let Some(msg) = panicked {
            self.install_faulted_surface("replace_document_text", msg, cx);
            cx.notify();
        }
    }

    /// Tests: whether the pane menu is open, and whether keyboard focus is
    /// in the document.
    #[cfg(any(feature = "dev-capture", feature = "test-support"))]
    pub fn lab_focus(&self, window: &Window, cx: &App) -> (bool, bool) {
        let document = self
            .surface
            .as_ref()
            .and_then(|s| s.focus_handle(cx))
            .is_some_and(|handle| handle.contains_focused(window, cx));
        (self.chrome.open, document)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn lab_deliver_html_ipc(&self, body: &str, cx: &mut App) {
        if let Some(probe) = self.surface.as_ref().and_then(|s| s.as_test_probe()) {
            let _ = probe.html_page_deliver(body, cx);
        }
    }

    pub fn focus_document(&self, window: &mut Window, cx: &mut App) {
        let handle = (!self.is_faulted())
            .then_some(self.surface.as_ref())
            .flatten()
            .and_then(|s| {
                catch_unwind(AssertUnwindSafe(|| s.focus_handle(cx)))
                    .ok()
                    .flatten()
            });
        match handle {
            Some(handle) => handle.focus(window, cx),
            None => self.focus.focus(window, cx),
        }
    }

    fn isolated_surface_element(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let surface = self.surface.as_ref()?;
        let weak = cx.entity().downgrade();
        let on_panic: PanicCallback = Rc::new(move |phase, msg, cx| {
            let weak = weak.clone();
            cx.defer(move |cx| {
                let _ = weak.update(cx, |this, cx| {
                    this.install_faulted_surface(phase, msg, cx);
                    cx.notify();
                });
            });
        });
        match catch_unwind(AssertUnwindSafe(|| surface.element())) {
            Ok(element) => Some(
                IsolatedSurfaceElement {
                    inner: Some(element),
                    on_panic,
                }
                .into_any_element(),
            ),
            Err(payload) => {
                on_panic("element", panic_payload_summary(payload), cx);
                Some(div().size_full().into_any_element())
            }
        }
    }

    /// Renders the `DP-31` / `DP-32` / `RG-03` top read-only explanation banner.
    fn readonly_banner(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let session = self.session.as_ref()?;
        let show_encoding = session.lossy_readonly && !self.file_mode;
        let show_line_endings = session.requires_line_ending_normalization;
        let show_large = session.read_only_large;
        if !show_encoding && !show_line_endings && show_large.is_none() {
            return None;
        }
        let palette = cx.palette();
        let message: String = if let Some((size_bytes, limit_bytes)) = show_large {
            format!(
                "Opened read-only — file size ({}) exceeds the {} editing limit.",
                placeholder::format_file_size(size_bytes),
                registry::format_byte_limit(limit_bytes)
            )
        } else if session.lossy_readonly {
            crate::localization::t("editor.fileMode.readOnlyEncoding").into()
        } else {
            crate::localization::t("native.editor.lineEndingsReadOnly").into()
        };
        let doc_id = session.id.clone();
        let action =
            (show_line_endings && !session.lossy_readonly && show_large.is_none()).then(|| {
                div()
                    .flex_none()
                    .debug_selector(|| "normalize-line-endings-button".into())
                    .child(
                        Button::new("normalize-line-endings-button")
                            .variant(ButtonVariant::Secondary)
                            .label(crate::localization::t(
                                "native.editor.normalizeLineEndingsAndEdit",
                            ))
                            .on_click(cx.listener(move |_, _, _, cx| {
                                cx.emit(ClientMessage::NormalizeLineEndings { id: doc_id.clone() });
                            })),
                    )
            });
        Some(
            div()
                .id("document-readonly-banner")
                .debug_selector(|| "document-readonly-banner".into())
                .flex_none()
                .w_full()
                .px(px(12.))
                .py(px(6.))
                .border_b_1()
                .border_color(palette.divider)
                .bg(palette.panel)
                .flex()
                .items_center()
                .justify_between()
                .gap(px(12.))
                .child(
                    div()
                        .min_w_0()
                        .flex_1()
                        .text_size(px(theme::ty().ui.meta))
                        .line_height(px(18.))
                        .text_color(palette.muted)
                        .child(message),
                )
                .children(action)
                .into_any_element(),
        )
    }
}

/// The pane's label: the file name of a workspace-relative path.
fn label(name: &str) -> String {
    name.rsplit(['/', '\\']).next().unwrap_or(name).to_owned()
}

impl Render for DocumentEditor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::platform::watchdog::activity("editor.render");
        crate::web_host::frame_drawn(window);
        use crate::editor::workbench::pane;
        let weak = cx.entity().downgrade();
        let measure = canvas(
            move |bounds, _, cx| {
                let _ = weak.update(cx, |this, cx| {
                    if this.bounds != Some(bounds) {
                        this.bounds = Some(bounds);
                        cx.notify();
                    }
                });
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        let label = self.session.as_ref().map(|s| s.name.clone());
        let chrome = label.as_ref().zip(self.bounds).map(|(name, bounds)| {
            let handle_label = crate::localization::tf(
                "editor.panes.actionsFor",
                &[("name", crate::localization::Arg::Text(name.clone()))],
            );
            let toggle = cx.entity().downgrade();
            let handle = pane::handle(
                self.dark,
                self.chrome.revealed(),
                handle_label.into(),
                self.pane_drag.clone(),
                move |window, cx| {
                    let _ = toggle.update(cx, |this, cx| this.toggle_pane_menu(window, cx));
                },
            );
            let (run, dismiss, keys) = (
                cx.entity().downgrade(),
                cx.entity().downgrade(),
                cx.entity().downgrade(),
            );
            let menu = pane::menu(
                &self.chrome,
                &self.contribution(cx),
                self.dark,
                pane::MenuPlace {
                    pane: bounds,
                    viewport_height: window.viewport_size().height,
                },
                Rc::new(move |action, window, cx| {
                    let _ = run.update(cx, |this, cx| this.run_pane_action(action, window, cx));
                }),
                Rc::new(move |restore, window, cx| {
                    let _ =
                        dismiss.update(cx, |this, cx| this.close_pane_menu(restore, window, cx));
                }),
                Rc::new(move |event: &KeyDownEvent, window, cx| {
                    let _ = keys.update(cx, |this, cx| this.pane_menu_key(event, window, cx));
                }),
            );
            (handle, menu)
        });
        let (handle, menu) = chrome
            .filter(|_| !self.file_mode)
            .map_or((None, None), |(h, m)| (Some(h), m));
        let banner = self.readonly_banner(cx);
        let surface_el = self.isolated_surface_element(cx);
        let body = div()
            .relative()
            .flex_1()
            .min_h_0()
            .w_full()
            .children(surface_el)
            .children(self.find_bar(cx))
            .children(handle)
            .children(menu);
        div()
            .id("desktop-editor-pane")
            .key_context(KEY_CONTEXT)
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .track_focus(&self.focus)
            .on_action(
                cx.listener(|s, a: &crate::editor::actions::EditorAction, w, cx| {
                    s.command(HostCommand::parse(&a.name), w, cx)
                }),
            )
            .on_action(cx.listener(|s, _: &OpenFind, w, cx| s.open_find(w, cx)))
            .on_action(
                cx.listener(|s, _: &gpui_kit::base::input::Search, w, cx| s.open_find(w, cx)),
            )
            // Ghostty-style reveal: the handle shows in the leading third.
            .on_mouse_move(cx.listener(|s, e: &MouseMoveEvent, _, cx| {
                let hot = s
                    .bounds
                    .is_some_and(|b| pane::PaneChrome::reveal_zone(b, e.position));
                if hot != s.chrome.hot {
                    s.chrome.hot = hot;
                    cx.notify();
                }
            }))
            .on_hover(cx.listener(|s, hovered: &bool, _, cx| {
                if !*hovered && s.chrome.hot {
                    s.chrome.hot = false;
                    cx.notify();
                }
            }))
            .child(measure)
            .children(banner)
            .child(body)
    }
}
