//! The native document surface the shell embeds (the provider counterpart of
//! the Web editor island): it speaks the document host protocol of
//! `documents.rs` (`open`, `clear`, `snapshot`, `thaw`, `saved`, `history`)
//! and hosts the native editor for the file — Markdown live preview for
//! `.md`/`.mdx`/`.markdown`, the CSV table for `.csv`/`.tsv`, plain text
//! otherwise.
//! It never writes files; `documents.rs` owns saving.
use crate::{
    documents::ClientMessage,
    editor::{
        csv::{CsvEditor, CsvEvent},
        markdown::MarkdownExtension,
        view::{
            EditorView,
            decoration::Decorations,
            editor::EditorEvent,
            extension::{EditIntent, EditorExtension, PlainText},
            style::{Edges, LineHeight, LineStyle, TextStyle},
        },
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
    cx.bind_keys([KeyBinding::new("cmd-f", OpenFind, Some(KEY_CONTEXT)), KeyBinding::new("ctrl-f", OpenFind, Some(KEY_CONTEXT))]);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Markdown,
    Csv,
    Text,
}

impl Kind {
    fn of(name: &str) -> Self {
        let ext = name.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
        match ext.as_str() {
            "md" | "mdx" | "markdown" => Kind::Markdown,
            "csv" | "tsv" => Kind::Csv,
            _ => Kind::Text,
        }
    }
}

struct Session {
    id: String,
    /// The file name the pane shows (`editorLabel`).
    name: String,
    baseline: String,
    revision: u64,
    frozen: bool,
    kind: Kind,
}

/// The format editor of the open document.
#[derive(Clone)]
enum Surface {
    Text(Entity<EditorView>),
    Csv(Entity<CsvEditor>),
}

pub struct DocumentEditor {
    session: Option<Session>,
    editor: Option<Surface>,
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
}

impl EventEmitter<ClientMessage> for DocumentEditor {}

/// Plain text files: the Markdown body typography without syntax.
fn plain_text(dark: bool, scale: Scale) -> PlainText {
    let theme = crate::editor::markdown::style::MarkdownTheme::resolve(dark, scale);
    let body = &theme.body;
    let text = TextStyle { line_height: LineHeight::Factor(body.text.line_height_px() / body.text.size), ..body.text.clone() };
    let line = LineStyle { padding: Edges::new(0., 0., body.source_line_gap, 0.), ..LineStyle::new(text) };
    PlainText { line: std::rc::Rc::new(line), decorations: Decorations { surface: crate::editor::markdown::core::decorations::surface(&theme), ..Default::default() } }
}

impl DocumentEditor {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            session: None,
            editor: None,
            subscription: None,
            focus: cx.focus_handle(),
            dark: true,
            scale: crate::theme::scale(),
            blocked: false,
            chrome: crate::editor::workbench::pane::PaneChrome::new(cx.focus_handle()),
            find: None,
            find_subscription: None,
            bounds: None,
        }
    }

    fn extension(&self, markdown: bool) -> Box<dyn EditorExtension> {
        if markdown { Box::new(MarkdownExtension::new(self.dark, self.scale)) } else { Box::new(plain_text(self.dark, self.scale)) }
    }

    fn open_editor(&mut self, id: &str, name: &str, text: &str, kind: Kind, window: &mut Window, cx: &mut Context<Self>) {
        if kind == Kind::Csv {
            let (dark, scale) = (self.dark, self.scale);
            let editor = cx.new(|cx| CsvEditor::new(id, name, text, dark, scale, cx));
            self.subscription = Some(cx.subscribe(&editor, |s, _, event: &CsvEvent, cx| match event {
                CsvEvent::Changed => s.changed(cx),
                CsvEvent::OpenReference(paths) => cx.emit(ClientMessage::OpenPaths { paths: paths.clone() }),
            }));
            self.editor = Some(Surface::Csv(editor));
            return;
        }
        let extension = self.extension(kind == Kind::Markdown);
        let dark = self.dark;
        let editor = cx.new(|cx| {
            let mut view = EditorView::new(text, extension, cx);
            view.dark = dark;
            view
        });
        let _ = window;
        self.subscription = Some(cx.subscribe(&editor, |s, _, event: &EditorEvent, cx| match event {
            // A cancelled composition changes nothing, but a save or switch
            // deferred while it was open waits for this report.
            EditorEvent::Changed(_) | EditorEvent::CompositionEnded => s.changed(cx),
        }));
        self.editor = Some(Surface::Text(editor));
    }

    fn changed(&mut self, cx: &mut Context<Self>) {
        let text = self.text(cx);
        let Some(session) = &mut self.session else { return };
        session.revision += 1;
        let dirty = text != session.baseline;
        cx.emit(ClientMessage::Dirty { id: session.id.clone(), revision: session.revision, dirty });
    }

    fn text(&self, cx: &App) -> String {
        match &self.editor {
            Some(Surface::Text(e)) => e.read(cx).text().to_owned(),
            Some(Surface::Csv(e)) => e.read(cx).text(cx),
            None => String::new(),
        }
    }

    fn composing(&self, cx: &App) -> bool {
        match &self.editor {
            Some(Surface::Text(e)) => e.read(cx).composing(),
            Some(Surface::Csv(e)) => e.read(cx).composing(cx),
            None => false,
        }
    }

    fn undo(&self, redo: bool, window: &mut Window, cx: &mut App) {
        match &self.editor {
            Some(Surface::Text(e)) => e.update(cx, |e, cx| e.undo(redo, cx)),
            Some(Surface::Csv(e)) => e.update(cx, |e, cx| e.undo(redo, window, cx)),
            None => {}
        }
    }

    pub fn receive(&mut self, message: &serde_json::Value, window: &mut Window, cx: &mut Context<Self>) -> Vec<ClientMessage> {
        let mut replies = Vec::new();
        match message["kind"].as_str().unwrap_or("") {
            "open" => {
                let id = message["id"].as_str().unwrap_or_default().to_owned();
                let text = message["text"].as_str().unwrap_or_default();
                let baseline = message["baseline"].as_str().unwrap_or(text).to_owned();
                let revision = message["revision"].as_u64().unwrap_or(0);
                let name = message["name"].as_str().unwrap_or_default();
                let kind = Kind::of(name);
                let same = self.session.as_ref().is_some_and(|s| s.id == id && s.kind == kind) && self.editor.is_some();
                if same && self.text(cx) == text && message["external"] != true {
                    // The same document re-sent (e.g. after a save): keep history.
                } else if same {
                    // External change of the open document: replace its text.
                    match &self.editor {
                        Some(Surface::Text(e)) => e.update(cx, |e, cx| e.replace_text(text, cx)),
                        Some(Surface::Csv(e)) => e.update(cx, |e, cx| e.replace_text(text, cx)),
                        None => {}
                    }
                } else {
                    // A new editor: its find adapter and menu start fresh.
                    self.chrome.open = false;
                    if let Some(bar) = &self.find {
                        bar.update(cx, |b, cx| b.hide(cx));
                    }
                    self.open_editor(&id, name, text, kind, window, cx);
                }
                let label = name.rsplit(['/', '\\']).next().unwrap_or(name).to_owned();
                self.session = Some(Session { id: id.clone(), name: label, baseline, revision, frozen: false, kind });
                replies.push(ClientMessage::Loaded { id, transfer: message["transfer"].as_u64() });
            }
            "clear" => {
                self.session = None;
                self.editor = None;
                self.subscription = None;
                self.chrome.open = false;
                if let Some(bar) = &self.find {
                    bar.update(cx, |b, cx| b.hide(cx));
                }
            }
            "snapshot" => {
                let composing = self.composing(cx);
                let text = self.text(cx);
                if let Some(session) = &mut self.session {
                    let request = message["request"].as_u64().unwrap_or(0);
                    if composing {
                        replies.push(ClientMessage::Deferred { request, id: session.id.clone() });
                    } else {
                        session.frozen = message["freeze"].as_bool().unwrap_or(true);
                        replies.push(ClientMessage::Snapshot { request, id: session.id.clone(), revision: session.revision, text });
                    }
                }
            }
            "thaw" => {
                if let Some(session) = &mut self.session {
                    session.frozen = false;
                }
            }
            "saved" => {
                let current = self.text(cx);
                if let Some(session) = &mut self.session
                    && message["id"] == session.id
                {
                    if let Some(text) = message["text"].as_str()
                        && message["revision"].as_u64().is_some_and(|r| r <= session.revision)
                    {
                        session.baseline = text.into();
                    } else if message["revision"].as_u64() == Some(session.revision) {
                        session.baseline = current;
                    }
                }
            }
            "history" => {
                let redo = message["direction"] == "redo";
                self.undo(redo, window, cx);
            }
            _ => {}
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
        let read_only = self.blocked || self.session.as_ref().is_some_and(|s| s.frozen);
        let (dark, scale) = (self.dark, self.scale);
        if let Some(Surface::Csv(editor)) = &self.editor {
            editor.update(cx, |e, cx| {
                e.set_read_only(read_only, cx);
                e.set_appearance(dark, scale, cx);
            });
        }
        if let Some(Surface::Text(editor)) = &self.editor {
            editor.update(cx, |e, cx| {
                let mut changed = e.read_only() != read_only || e.dark != dark;
                e.set_read_only(read_only, cx);
                e.dark = dark;
                if let Some(md) = e.extension_mut::<MarkdownExtension>() {
                    md.read_only = read_only;
                    if md.set_appearance(dark, scale) {
                        changed = true;
                    }
                }
                if changed {
                    e.appearance += 1;
                    cx.notify();
                }
            });
        }
    }

    /// Menu and shell commands (`source`, `undo`, `redo`, formatting).
    pub fn command(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        let editor = match self.editor.clone() {
            Some(Surface::Text(editor)) => editor,
            Some(Surface::Csv(editor)) => {
                match name {
                    "source" => editor.update(cx, |e, cx| e.toggle_mode(window, cx)),
                    "undo" | "redo" => editor.update(cx, |e, cx| e.undo(name == "redo", window, cx)),
                    _ => {}
                }
                self.focus_document(window, cx);
                return;
            }
            None => return,
        };
        editor.update(cx, |e, cx| match name {
            "source" => {
                if let Some(md) = e.extension_mut::<MarkdownExtension>() {
                    md.live = !md.live;
                    e.appearance += 1;
                    cx.notify();
                }
            }
            "undo" => e.undo(false, cx),
            "redo" => e.undo(true, cx),
            "bold" => e.edit_intent(EditIntent::Bold, cx),
            "italic" => e.edit_intent(EditIntent::Italic, cx),
            _ => {}
        });
        self.focus_document(window, cx);
    }

    pub fn focus_document(&self, window: &mut Window, cx: &mut App) {
        match &self.editor {
            Some(Surface::Text(editor)) => {
                let handle = editor.read(cx).focus_handle(cx);
                handle.focus(window, cx);
            }
            Some(Surface::Csv(editor)) => {
                let handle = editor.read(cx).focus_target(cx);
                handle.focus(window, cx);
            }
            None => self.focus.focus(window, cx),
        }
    }
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
            let handle_label = crate::localization::tf("editor.panes.actionsFor", &[("name", crate::localization::Arg::Text(name.clone()))]);
            let toggle = cx.entity().downgrade();
            let handle = pane::handle(self.dark, self.chrome.revealed(), handle_label.into(), move |window, cx| {
                let _ = toggle.update(cx, |this, cx| this.toggle_pane_menu(window, cx));
            });
            let (run, dismiss, keys) = (cx.entity().downgrade(), cx.entity().downgrade(), cx.entity().downgrade());
            let menu = pane::menu(
                &self.chrome,
                &self.contribution(cx),
                self.dark,
                bounds,
                Rc::new(move |action, window, cx| {
                    let _ = run.update(cx, |this, cx| this.run_pane_action(action, window, cx));
                }),
                Rc::new(move |restore, window, cx| {
                    let _ = dismiss.update(cx, |this, cx| this.close_pane_menu(restore, window, cx));
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
            .on_action(cx.listener(|s, a: &crate::native_editor::EditorAction, w, cx| s.command(&a.name, w, cx)))
            .on_action(cx.listener(|s, _: &OpenFind, w, cx| s.open_find(w, cx)))
            // Ghostty-style reveal: the handle shows in the leading third.
            .on_mouse_move(cx.listener(|s, e: &MouseMoveEvent, _, cx| {
                let hot = s.bounds.is_some_and(|b| pane::PaneChrome::reveal_zone(b, e.position));
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
            .children(self.editor.clone().map(|e| match e {
                Surface::Text(e) => e.into_any_element(),
                Surface::Csv(e) => e.into_any_element(),
            }))
            .children(self.find_bar(cx))
            .children(handle)
            .children(menu)
    }
}
