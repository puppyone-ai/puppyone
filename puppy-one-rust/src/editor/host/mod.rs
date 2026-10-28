//! The document surface the shell embeds (`DocumentSurfaceHost`): it speaks
//! the document host protocol of `documents.rs` (`HostMessage`) and opens
//! the viewer the registry resolves for the file (`editor::registry`) —
//! Markdown, CSV, source text, images, or an honest placeholder. It never
//! names a concrete viewer and never writes files; `documents.rs` owns saving.
use crate::{
    documents::{ClientMessage, HostMessage},
    editor::{
        registry::{
            self, EditorDocument, Presentation, PresetViewer, SurfaceEvent, SurfaceInput,
            SurfaceRequest, ViewerSurface,
            packs::{ExtensionHost, Route, route},
        },
        viewers::{external, placeholder},
    },
    typography::Scale,
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
}

pub struct DocumentEditor {
    pub workbench: bool,
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
}

impl EventEmitter<ClientMessage> for DocumentEditor {}

impl DocumentEditor {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            workbench: false,
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
        }
    }

    /// Install the host port for external Viewer Packs.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn set_extension_host(&mut self, host: Option<ExtensionHost>) {
        self.extensions = host;
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
        };
        let surface = match self.extension_surface(&document, &request, window, cx) {
            Some(surface) => surface,
            None => match viewer.presentation {
                Presentation::Native(open) => open(&request, window, cx),
                Presentation::Unavailable => placeholder::open_unavailable(&request, window, cx),
            },
        };
        let host = cx.weak_entity();
        self.subscription = surface.subscribe(
            Rc::new(move |event, cx| {
                let _ = host.update(cx, |s, cx| match event {
                    SurfaceEvent::Changed => s.changed(cx),
                    SurfaceEvent::OpenPaths(paths) => cx.emit(ClientMessage::OpenPaths { paths }),
                });
            }),
            cx,
        );
        // A new surface: its find adapter and menu start fresh.
        self.chrome.open = false;
        if let Some(bar) = &self.find {
            bar.update(cx, |b, cx| b.hide(cx));
        }
        self.surface = Some(surface);
        (viewer, editable)
    }

    fn changed(&mut self, cx: &mut Context<Self>) {
        let Some(text) = self.text(cx) else { return };
        let Some(session) = &mut self.session else {
            return;
        };
        session.revision += 1;
        let dirty = text != session.baseline;
        cx.emit(ClientMessage::Dirty {
            id: session.id.clone(),
            revision: session.revision,
            dirty,
        });
    }

    fn text(&self, cx: &App) -> Option<String> {
        self.surface.as_ref().and_then(|s| s.text(cx))
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
                let same = self
                    .session
                    .as_ref()
                    .is_some_and(|s| &s.id == id && s.viewer.id == viewer)
                    && self.surface.is_some();
                let (viewer, editable) = if same {
                    if self.text(cx).as_ref() != Some(text) || *external {
                        // External change of the open document: replace its text.
                        if let Some(surface) = &self.surface {
                            surface.replace_text(text, cx);
                        }
                    }
                    // Otherwise the same document re-sent (after a save): keep history.
                    let session = self.session.as_ref().unwrap();
                    (session.viewer, session.editable)
                } else {
                    self.open_surface(id, name, SurfaceInput::Text(text), window, cx)
                };
                self.session = Some(Session {
                    id: id.clone(),
                    name: label(name),
                    baseline: text.clone(),
                    revision: *revision,
                    frozen: false,
                    viewer,
                    editable,
                });
                replies.push(ClientMessage::Loaded { id: id.clone() });
            }
            HostMessage::OpenResource { id, name, path } => {
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
                });
                replies.push(ClientMessage::Loaded { id: id.clone() });
            }
            HostMessage::Clear => {
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
                            text,
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
                if let Some(session) = &mut self.session
                    && &session.id == id
                {
                    session.name = label(name);
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
                if self.session.as_ref().is_some_and(|s| &s.id == id)
                    && let Some(surface) = &self.surface
                {
                    surface.undo(*redo, window, cx);
                }
            }
        }
        self.apply_gate(cx);
        cx.notify();
        replies
    }

    /// Block input while modal UI, a busy document operation or another
    /// provider owns the document; follow the app appearance.
    pub fn gate(&mut self, blocked: bool, dark: bool, cx: &mut Context<Self>) {
        self.blocked = blocked;
        self.dark = dark;
        self.scale = crate::theme::scale();
        self.apply_gate(cx);
    }

    fn apply_gate(&mut self, cx: &mut Context<Self>) {
        let read_only = self.blocked
            || self
                .session
                .as_ref()
                .is_none_or(|s| s.frozen || !s.editable);
        if let Some(surface) = &self.surface {
            surface.apply(read_only, self.dark, self.scale, cx);
        }
    }

    /// Menu and shell commands (`source`, `undo`, `redo`, formatting).
    pub fn command(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.blocked {
            return;
        }
        let Some(surface) = &self.surface else { return };
        surface.command(name, window, cx);
        self.focus_document(window, cx);
    }

    pub fn focus_document(&self, window: &mut Window, cx: &mut App) {
        match self.surface.as_ref().and_then(|s| s.focus_handle(cx)) {
            Some(handle) => handle.focus(window, cx),
            None => self.focus.focus(window, cx),
        }
    }
}

/// The pane's label: the file name of a workspace-relative path.
fn label(name: &str) -> String {
    name.rsplit(['/', '\\']).next().unwrap_or(name).to_owned()
}

impl Render for DocumentEditor {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
        let (handle, menu) = chrome.map_or((None, None), |(h, m)| (Some(h), m));
        div()
            .id("desktop-editor-pane")
            .key_context(KEY_CONTEXT)
            .relative()
            .size_full()
            .track_focus(&self.focus)
            .on_action(
                cx.listener(|s, a: &crate::editor::actions::EditorAction, w, cx| {
                    s.command(&a.name, w, cx)
                }),
            )
            .on_action(cx.listener(|s, _: &OpenFind, w, cx| s.open_find(w, cx)))
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
            .children(self.surface.as_ref().map(|s| s.element()))
            .children(self.find_bar(cx))
            .children(handle)
            .children(menu)
    }
}
