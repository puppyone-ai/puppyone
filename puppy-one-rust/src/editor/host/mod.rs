//! The document surface the shell embeds (`DocumentSurfaceHost`): it speaks
//! the document host protocol of `documents.rs` (`HostMessage`) and opens
//! the viewer the registry resolves for the file (`editor::registry`) —
//! Markdown, CSV, source text, images, or an honest placeholder. It never
//! names a concrete viewer and never writes files; `documents.rs` owns saving.
use crate::{
    documents::{ClientMessage, HostMessage, reconcile},
    editor::{
        registry::{
            self, EditorDocument, Presentation, PresetViewer, SurfaceEvent, SurfaceInput,
            SurfaceRequest, ViewerSurface,
            packs::{ExtensionHost, Route, route},
        },
        text::buffer::Buffer,
        viewers::{
            external,
            html_tools::{HtmlToolAction, HtmlToolEvent, HtmlToolMode, HtmlToolSnapshot},
        },
    },
    theme,
    typography::Scale,
    ui::{
        appearance::ActiveAppearance as _,
        components::{Button, ButtonVariant},
    },
};
use gpui::{prelude::*, *};
use std::rc::Rc;

mod chrome;
#[cfg(test)]
mod tests;

actions!(document_editor, [OpenFind]);

/// Key context of the native document pane.
const KEY_CONTEXT: &str = "DocumentEditor";

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-f", OpenFind, Some(KEY_CONTEXT)),
        KeyBinding::new("ctrl-f", OpenFind, Some(KEY_CONTEXT)),
    ]);
}

struct Session {
    id: String,
    /// The file name the pane shows (`editorLabel`).
    name: String,
    baseline: String,
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
    /// Pane chrome (handle and actions menu), the find widget and the pane's
    /// window bounds.
    chrome: crate::editor::workbench::pane::PaneChrome,
    find: Option<Entity<crate::editor::workbench::find::FindBar>>,
    find_subscription: Option<Subscription>,
    bounds: Option<Bounds<Pixels>>,
    /// External Viewer Packs (`ViewerExtensionHostAdapter`); none while the
    /// pack runtime is not part of the build.
    extensions: Option<ExtensionHost>,
    references: Option<crate::editor::navigation::ReferenceContext>,
    /// The workspace surfaces read beyond their document; `None` for a
    /// lone file.
    workspace: Option<std::sync::Arc<crate::workspace::Workspace>>,
    /// `normalizeContent`: the text the surface was given and the raw text
    /// it stands for, until the person edits.
    displayed: Option<(String, String)>,
    external_history: Option<ExternalHistoryStep>,
    suppress_surface_change: bool,
    html_events: Vec<HtmlToolEvent>,
}

impl EventEmitter<ClientMessage> for DocumentEditor {}

impl DocumentEditor {
    #[cfg(feature = "test-support")]
    pub fn csv_editor(&self) -> Option<Entity<crate::editor::csv::CsvEditor>> {
        self.surface.as_ref()?.csv_editor()
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
            displayed: None,
            external_history: None,
            suppress_surface_change: false,
            html_events: Vec::new(),
        }
    }

    /// Install the host port for external Viewer Packs.
    #[cfg(test)]
    pub fn set_extension_host(&mut self, host: Option<ExtensionHost>) {
        self.extensions = host;
    }

    /// The workspace of the next documents this host opens.
    pub fn set_workspace(
        &mut self,
        workspace: Option<std::sync::Arc<crate::workspace::Workspace>>,
    ) {
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
        if let Some(surface) = &self.surface {
            surface.set_reference_context(context.clone(), cx);
        }
        self.references = context;
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

    /// A placeholder-grade local document an installed pack renders, when
    /// the host can render packs (`EditorDocumentHost`'s plugin routes).
    fn extension_surface(
        &self,
        document: &EditorDocument,
        request: &SurfaceRequest,
        window: &mut Window,
        cx: &mut App,
    ) -> Option<Box<dyn ViewerSurface>> {
        let host = self.extensions.as_ref()?;
        let render = host.surface?;
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

    /// Open the resolved viewer's surface for a document and follow its
    /// changes.
    fn open_surface(
        &mut self,
        id: &str,
        name: &str,
        input: SurfaceInput,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> (&'static PresetViewer, bool) {
        let document = EditorDocument::local(name);
        let resolved = registry::resolve(&document);
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
        };
        let surface = match self.extension_surface(&document, &request, window, cx) {
            Some(surface) => surface,
            None => match viewer.presentation {
                Presentation::Native(open) => open(&request, window, cx),
            },
        };
        surface.set_reference_context(self.references.clone(), cx);
        let host = cx.weak_entity();
        self.subscription = surface.subscribe(
            Rc::new(move |event, cx| {
                let host = host.clone();
                cx.defer(move |cx| {
                    let _ = host.update(cx, |s, cx| match event {
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
        );
        surface.set_chrome_inset(self.chrome_inset, cx);
        // A new surface: its find adapter and menu start fresh.
        self.chrome.open = false;
        if let Some(bar) = &self.find {
            bar.update(cx, |b, cx| b.hide(cx));
        }
        self.surface = Some(surface);
        (viewer, editable)
    }

    fn changed(&mut self, cx: &mut Context<Self>) {
        if std::mem::take(&mut self.suppress_surface_change) {
            return;
        }
        let Some(text) = self.text(cx) else { return };
        let Some(session) = &mut self.session else {
            return;
        };
        self.external_history = None;
        session.revision += 1;
        let dirty = text != session.baseline;
        let id = session.id.clone();
        let revision = session.revision;
        cx.emit(ClientMessage::LiveBuffer {
            id: id.clone(),
            revision,
            text: Buffer::new(text),
        });
        cx.emit(ClientMessage::Dirty {
            id,
            revision,
            dirty,
        });
    }

    /// The document text: the raw text while the surface still shows its
    /// untouched normalization, else what the surface holds.
    /// Logical text snapshot (`displayed` normalization respected).
    pub fn text(&self, cx: &App) -> Option<String> {
        let shown = self.surface.as_ref().and_then(|s| s.text(cx))?;
        Some(match &self.displayed {
            Some((normalized, raw)) if *normalized == shown => raw.clone(),
            _ => shown,
        })
    }

    fn perform_history(&mut self, redo: bool, window: &mut Window, cx: &mut Context<Self>) {
        let before = self.text(cx);
        if let Some(surface) = &self.surface {
            surface.undo(redo, window, cx);
        }
        let after = self.text(cx);
        if after != before {
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
            HostMessage::Open {
                id,
                name,
                text,
                revision,
                external,
            } => {
                let viewer = registry::resolve(&EditorDocument::local(name)).viewer.id;
                let normalized = registry::normalize::normalize(viewer, text);
                let shown = normalized.as_deref().unwrap_or(text);
                let same = self
                    .session
                    .as_ref()
                    .is_some_and(|s| &s.id == id && s.viewer.id == viewer)
                    && self.surface.is_some();
                let prev_policy = self
                    .session
                    .as_ref()
                    .filter(|s| &s.id == id && *external)
                    .map(|s| (s.lossy_readonly, s.requires_line_ending_normalization))
                    .unwrap_or((false, false));

                let (viewer, editable) = if same {
                    let previous_raw = self.text(cx);
                    let previous_shown = self.surface.as_ref().and_then(|s| s.text(cx));
                    if previous_raw.as_ref() != Some(text) || *external {
                        if *external
                            && previous_shown.as_deref() != Some(shown)
                            && let (Some(surface), Some(prev_shown)) =
                                (&self.surface, &previous_shown)
                        {
                            let edits = reconcile::minimal_utf16_edits(prev_shown, shown);
                            let applied_minimal = !edits.is_empty()
                                && !surface.composing(cx)
                                && surface.edit_utf16(&edits, window, cx);
                            if applied_minimal {
                                self.suppress_surface_change = true;
                                self.external_history = None;
                            } else {
                                surface.replace_text(shown, window, cx);
                                if let Some(prev_raw) = previous_raw.filter(|p| p != text) {
                                    self.external_history = Some(ExternalHistoryStep {
                                        before: prev_raw,
                                        after: text.clone(),
                                        undone: false,
                                    });
                                }
                            }
                        } else if previous_shown.as_deref() != Some(shown)
                            && let Some(surface) = &self.surface
                        {
                            surface.replace_text(shown, window, cx);
                        }
                        self.displayed = normalized.clone().map(|n| (n, text.clone()));
                    }
                    let session = self.session.as_ref().unwrap();
                    (session.viewer, session.editable)
                } else {
                    self.external_history = None;
                    self.displayed = normalized.clone().map(|n| (n, text.clone()));
                    self.open_surface(id, name, SurfaceInput::Text(shown), window, cx)
                };
                self.session = Some(Session {
                    id: id.clone(),
                    name: label(name),
                    baseline: text.clone(),
                    revision: *revision,
                    frozen: false,
                    viewer,
                    editable,
                    lossy_readonly: prev_policy.0,
                    requires_line_ending_normalization: prev_policy.1,
                });
                replies.push(ClientMessage::Loaded { id: id.clone() });
            }
            HostMessage::OpenResource { id, name, path } => {
                self.displayed = None;
                self.external_history = None;
                let (viewer, editable) =
                    self.open_surface(id, name, SurfaceInput::Resource(path), window, cx);
                self.session = Some(Session {
                    id: id.clone(),
                    name: label(name),
                    baseline: String::new(),
                    revision: 0,
                    frozen: false,
                    viewer,
                    editable,
                    lossy_readonly: false,
                    requires_line_ending_normalization: false,
                });
                replies.push(ClientMessage::Loaded { id: id.clone() });
            }
            HostMessage::Clear => {
                self.displayed = None;
                self.external_history = None;
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
                let composing = self.surface.as_ref().is_some_and(|s| s.composing(cx));
                let text = self.text(cx);
                if let (Some(session), Some(text)) = (&mut self.session, text) {
                    if composing {
                        replies.push(ClientMessage::Deferred {
                            request: *request,
                            id: session.id.clone(),
                        });
                    } else {
                        session.frozen = *freeze;
                        replies.push(ClientMessage::Snapshot {
                            request: *request,
                            id: session.id.clone(),
                            revision: session.revision,
                            text: Buffer::new(text),
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
                let next = registry::resolve(&EditorDocument::local(name)).viewer;
                let switch = self
                    .session
                    .as_ref()
                    .is_some_and(|session| &session.id == id && session.viewer.id != next.id);
                if switch {
                    // `TODO-56`: apply `registry::normalize` (`displayed`) when
                    // switching to a normalizing viewer such as `json` so raw
                    // unedited text is preserved until the person edits.
                    let input = match resource {
                        Some(resource) => Some((SurfaceInput::Resource(resource), None)),
                        None => self
                            .text(cx)
                            .map(|text| (SurfaceInput::Text(""), Some(text))),
                    };
                    if let Some((input, text)) = input {
                        let (viewer, editable) = match &text {
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
                            session.name = label(name);
                            session.viewer = viewer;
                            session.editable = editable;
                        }
                    }
                } else if let Some(session) = &mut self.session
                    && &session.id == id
                {
                    session.name = label(name);
                    if let Some(surface) = &self.surface {
                        surface.rebind_name(name, cx);
                    }
                    if let (Some(surface), Some(resource)) = (&self.surface, resource) {
                        surface.rebind_resource(resource, cx);
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
            if let Some(surface) = &self.surface {
                surface.set_chrome_inset(top, cx);
            }
            cx.notify();
        }
    }

    /// How far the shown document is scrolled, and whether its top edge is
    /// a pinned header row.
    pub fn scroll_state(&self, cx: &App) -> (f32, bool) {
        self.surface
            .as_ref()
            .map_or((0., false), |s| s.scroll_state(cx))
    }

    pub fn gate(&mut self, blocked: bool, dark: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.blocked = blocked;
        self.dark = dark;
        self.scale = crate::theme::scale();
        self.apply_gate(window, cx);
    }

    fn apply_gate(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let read_only = self.blocked
            || self.read_only
            || self.session.as_ref().is_none_or(|s| {
                s.frozen || !s.editable || s.lossy_readonly || s.requires_line_ending_normalization
            });
        if let Some(surface) = &self.surface {
            surface.apply(read_only, self.dark, self.scale, window, cx);
        }
    }

    /// Menu and shell commands (`source`, `undo`, `redo`, formatting).
    pub fn command(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.blocked {
            return;
        }
        if matches!(name, "undo" | "redo") {
            self.perform_history(name == "redo", window, cx);
            self.focus_document(window, cx);
            return;
        }
        let Some(surface) = &self.surface else { return };
        surface.command(name, window, cx);
        self.focus_document(window, cx);
    }

    /// Captures and window tests type `text` at the end of the first line,
    /// as the input method would deliver it.
    #[cfg(any(feature = "dev-capture", feature = "test-support"))]
    pub fn lab_type(&self, text: &str, window: &mut Window, cx: &mut App) {
        use gpui::EntityInputHandler as _;
        let Some(view) = self.surface.as_ref().and_then(|s| s.editor_view()) else {
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
        self.surface.as_ref()?.html_tool_state()
    }

    pub fn set_html_tool(
        &mut self,
        mode: HtmlToolMode,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(surface) = &self.surface {
            surface.set_html_tool(mode, window, cx);
            cx.notify();
        }
    }

    pub fn trigger_html_action(
        &mut self,
        action: HtmlToolAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(surface) = &self.surface {
            surface.trigger_html_action(action, window, cx);
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
        if let Some(surface) = &self.surface {
            surface.replace_text(text, window, cx);
            self.displayed = None;
            self.changed(cx);
            cx.notify();
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn lab_deliver_html_ipc(&self, body: &str, cx: &mut App) {
        if let Some(surface) = &self.surface {
            let _ = surface.html_page_deliver(body, cx);
        }
    }

    pub fn focus_document(&self, window: &mut Window, cx: &mut App) {
        match self.surface.as_ref().and_then(|s| s.focus_handle(cx)) {
            Some(handle) => handle.focus(window, cx),
            None => self.focus.focus(window, cx),
        }
    }

    /// Renders the `DP-31` / `DP-32` top read-only explanation banner (with the
    /// explicit "Normalize line endings and edit" action for mixed/`CR` files).
    fn readonly_banner(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let session = self.session.as_ref()?;
        let show_encoding = session.lossy_readonly && !self.file_mode;
        let show_line_endings = session.requires_line_ending_normalization;
        if !show_encoding && !show_line_endings {
            return None;
        }
        let palette = cx.palette();
        let message = if session.lossy_readonly {
            crate::localization::t("editor.fileMode.readOnlyEncoding")
        } else {
            crate::localization::t("native.editor.lineEndingsReadOnly")
        };
        let doc_id = session.id.clone();
        let action = (show_line_endings && !session.lossy_readonly).then(|| {
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
                bounds,
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
        let body = div()
            .relative()
            .flex_1()
            .min_h_0()
            .w_full()
            .children(self.surface.as_ref().map(|s| s.element()))
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
                    s.command(&a.name, w, cx)
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
