//! Text surfaces on the editor view: Markdown live preview (`markdown`).
#[cfg(test)]
#[path = "text_tests.rs"]
mod tests;
use super::source_split::SourceSplit;
use crate::{
    editor::{
        markdown::MarkdownExtension,
        registry::{PaneEntries, SurfaceEvent, SurfaceEvents, SurfaceRequest, ViewerSurface},
        view::{EditorView, editor::EditorEvent, extension::EditIntent},
        workbench::{
            find::FindEvent,
            pane::{Segment, Segmented, Switch},
        },
    },
    localization::t,
    typography::Scale,
};
use gpui::{prelude::*, *};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

pub const DOCUMENT_EDITING_TOGGLE_ID: &str = "document-editing";
pub const DOCUMENT_SOURCE_PANEL_TOGGLE_ID: &str = "document-source-panel";

/// `markdown`: live preview with a source toggle (or `edit-and-source-panel`
/// in standalone File Mode).
pub fn open_markdown(
    request: &SurfaceRequest,
    window: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    let mut markdown = MarkdownExtension::new(request.dark, request.scale);
    if request.name.to_ascii_lowercase().ends_with(".mdx") {
        markdown = markdown.mdx();
    }
    markdown.assets = crate::editor::registry::document_assets(request.id);
    if request.file_mode {
        markdown.read_only = true;
    }
    let text = match request.input {
        crate::editor::registry::SurfaceInput::Text(text) => text,
        _ => "",
    };
    let dark = request.dark;
    let file_mode = request.file_mode;
    let editor = cx.new(|cx| {
        let mut view = EditorView::new(text, Box::new(markdown), cx);
        view.dark = dark;
        if file_mode {
            view.set_read_only(true, cx);
        }
        view
    });

    let editing = Rc::new(Cell::new(!file_mode));
    let host_read_only = Rc::new(Cell::new(false));
    let source_panel = Rc::new(Cell::new(false));
    let syncing = Rc::new(Cell::new(false));
    let events_slot: Rc<RefCell<Option<SurfaceEvents>>> = Rc::default();
    let mut subscriptions = Vec::new();

    let (source, split) = if file_mode {
        let source: Rc<dyn ViewerSurface> = Rc::from(super::code::open_with(
            request,
            Some("markdown"),
            true,
            window,
            cx,
        ));
        let history_editor = editor.clone();
        let history_gate = host_read_only.clone();
        source.set_history_owner(
            Rc::new(move |redo, cx| {
                if !history_gate.get() {
                    history_editor.update(cx, |e, cx| e.replay_history(redo, cx));
                }
            }),
            cx,
        );
        let source_for_editor = source.clone();
        let syncing_for_editor = syncing.clone();
        subscriptions.push(window.subscribe(
            &editor,
            cx,
            move |editor, event: &EditorEvent, window, cx| {
                if !matches!(event, EditorEvent::Changed(_)) || syncing_for_editor.get() {
                    return;
                }
                syncing_for_editor.set(true);
                let text = editor.read(cx).text().to_owned();
                if let Some(prev) = source_for_editor.text(cx)
                    && prev != text
                {
                    source_for_editor.replace_text(&text, window, cx);
                }
                syncing_for_editor.set(false);
            },
        ));

        let editor_for_source = editor.clone();
        let source_for_source = source.clone();
        let syncing_for_source = syncing.clone();
        let events_for_source = events_slot.clone();
        if let Some(sub) = source.subscribe(
            Rc::new(move |event, cx| {
                if !matches!(event, SurfaceEvent::Changed) || syncing_for_source.get() {
                    return;
                }
                let Some(text) = source_for_source.text(cx) else {
                    return;
                };
                let same = editor_for_source.read(cx).text() == text;
                if same {
                    if let Some(cb) = events_for_source.borrow().as_ref() {
                        cb(SurfaceEvent::Changed, cx);
                    }
                    return;
                }
                syncing_for_source.set(true);
                editor_for_source.update(cx, |e, cx| e.sync_text(&text, cx));
                syncing_for_source.set(false);
            }),
            cx,
        ) {
            subscriptions.push(sub);
        }

        let page_editor = editor.clone();
        let panel_source = source.clone();
        let panel_open = source_panel.clone();
        let split = cx.new(|cx| {
            SourceSplit::new(
                move || page_editor.clone().into_any_element(),
                move || panel_open.get().then(|| panel_source.element()),
                cx,
            )
        });
        (Some(source), Some(split))
    } else {
        (None, None)
    };

    Box::new(TextSurface {
        editor,
        file_mode,
        editing,
        host_read_only,
        source_panel,
        syncing,
        events: events_slot,
        source,
        split,
        _subscriptions: subscriptions,
    })
}

pub struct TextSurface {
    pub editor: Entity<EditorView>,
    file_mode: bool,
    editing: Rc<Cell<bool>>,
    host_read_only: Rc<Cell<bool>>,
    source_panel: Rc<Cell<bool>>,
    syncing: Rc<Cell<bool>>,
    events: Rc<RefCell<Option<SurfaceEvents>>>,
    source: Option<Rc<dyn ViewerSurface>>,
    split: Option<Entity<SourceSplit>>,
    _subscriptions: Vec<Subscription>,
}

impl TextSurface {
    fn markdown_live(&self, cx: &App) -> Option<bool> {
        self.editor
            .read(cx)
            .extension::<MarkdownExtension>()
            .map(|m| m.live)
    }
    fn toggle_live(&self, cx: &mut App) {
        self.editor.update(cx, |e, cx| {
            if let Some(md) = e.extension_mut::<MarkdownExtension>() {
                md.live = !md.live;
                e.appearance += 1;
                cx.notify();
            }
        });
    }
    fn sync_editor_read_only(&self, cx: &mut App) {
        let effective = self.host_read_only.get() || (self.file_mode && !self.editing.get());
        self.editor.update(cx, |e, cx| {
            let changed = e.read_only() != effective;
            e.set_read_only(effective, cx);
            if let Some(md) = e.extension_mut::<MarkdownExtension>() {
                md.read_only = effective;
            }
            if changed {
                e.appearance += 1;
                cx.notify();
            }
        });
    }
    fn toggle_editing(&self, window: &mut Window, cx: &mut App) {
        if !self.file_mode || self.host_read_only.get() {
            return;
        }
        let next = !self.editing.get();
        self.editing.set(next);
        self.sync_editor_read_only(cx);
        if next {
            let handle = self.editor.read(cx).focus_handle(cx);
            handle.focus(window, cx);
        }
    }
    fn toggle_source_panel(&self, window: &mut Window, cx: &mut App) {
        if !self.file_mode {
            return;
        }
        let next = !self.source_panel.get();
        self.source_panel.set(next);
        if let Some(split) = &self.split {
            split.update(cx, |_, cx| cx.notify());
        }
        if next && let Some(handle) = self.source.as_ref().and_then(|s| s.focus_handle(cx)) {
            handle.focus(window, cx);
        }
    }
}

impl ViewerSurface for TextSurface {
    fn set_reference_context(
        &self,
        context: Option<crate::editor::navigation::ReferenceContext>,
        cx: &mut App,
    ) {
        self.editor.update(cx, |e, cx| {
            if let Some(md) = e.extension_mut::<MarkdownExtension>() {
                md.references = context;
                e.appearance += 1;
                cx.notify();
            }
        });
    }
    fn element(&self) -> AnyElement {
        if let Some(split) = &self.split {
            return split.clone().into_any_element();
        }
        self.editor.clone().into_any_element()
    }
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        *self.events.borrow_mut() = Some(events.clone());
        Some(cx.subscribe(
            &self.editor,
            move |_, event: &EditorEvent, cx| match event {
                // A cancelled composition changes nothing, but a save or switch
                // deferred while it was open waits for this report.
                EditorEvent::Changed(_) | EditorEvent::CompositionEnded => {
                    events(SurfaceEvent::Changed, cx)
                }
                EditorEvent::OpenPaths(paths) => events(SurfaceEvent::OpenPaths(paths.clone()), cx),
            },
        ))
    }
    fn text(&self, cx: &App) -> Option<String> {
        Some(self.editor.read(cx).text().to_owned())
    }
    fn composing(&self, cx: &App) -> bool {
        self.editor.read(cx).composing() || self.source.as_ref().is_some_and(|s| s.composing(cx))
    }
    fn replace_text(&self, text: &str, window: &mut Window, cx: &mut App) {
        self.syncing.set(true);
        self.editor.update(cx, |e, cx| e.replace_text(text, cx));
        if let Some(source) = &self.source {
            source.replace_text(text, window, cx);
        }
        self.syncing.set(false);
    }
    fn undo(&self, redo: bool, _window: &mut Window, cx: &mut App) {
        if self.host_read_only.get() || self.composing(cx) {
            return;
        }
        self.editor.update(cx, |e, cx| {
            if self.file_mode {
                e.replay_history(redo, cx);
            } else {
                e.undo(redo, cx);
            }
        });
    }
    fn set_chrome_inset(&self, top: f32, cx: &mut App) {
        self.editor.update(cx, |e, cx| e.set_chrome_inset(top, cx));
    }
    fn scroll_state(&self, cx: &App) -> (f32, bool) {
        (self.editor.read(cx).scroll_top(), false)
    }
    fn apply(&self, read_only: bool, dark: bool, scale: Scale, window: &mut Window, cx: &mut App) {
        self.host_read_only.set(read_only);
        if read_only && self.file_mode {
            self.editing.set(false);
        }
        let effective = read_only || (self.file_mode && !self.editing.get());
        self.editor.update(cx, |e, cx| {
            let mut changed = e.read_only() != effective || e.dark != dark;
            e.set_read_only(effective, cx);
            e.dark = dark;
            if let Some(md) = e.extension_mut::<MarkdownExtension>() {
                md.read_only = effective;
                if md.set_appearance(dark, scale) {
                    changed = true;
                }
            }
            if changed {
                e.appearance += 1;
                cx.notify();
            }
        });
        if let Some(source) = &self.source {
            source.apply(read_only, dark, scale, window, cx);
        }
    }
    fn command(&self, name: &str, window: &mut Window, cx: &mut App) {
        match name {
            "source" => {
                if self.file_mode {
                    self.toggle_source_panel(window, cx);
                } else {
                    self.toggle_live(cx);
                }
            }
            "undo" => self.undo(false, window, cx),
            "redo" => self.undo(true, window, cx),
            "bold" => self
                .editor
                .update(cx, |e, cx| e.edit_intent(EditIntent::Bold, cx)),
            "italic" => self
                .editor
                .update(cx, |e, cx| e.edit_intent(EditIntent::Italic, cx)),
            _ => {}
        }
    }
    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        if self.file_mode && !self.editing.get() && self.source_panel.get() {
            return self.source.as_ref().and_then(|s| s.focus_handle(cx));
        }
        Some(self.editor.read(cx).focus_handle(cx))
    }
    /// Markdown contributes its live / source segments to the workbench pane
    /// menu, or its Edit + Source switches in standalone File Mode.
    fn pane(&self, cx: &App) -> PaneEntries {
        if self.file_mode {
            let mut toggles = Vec::new();
            if !self.host_read_only.get() {
                toggles.push(Switch {
                    id: DOCUMENT_EDITING_TOGGLE_ID,
                    icon: "pencil",
                    label: t("editor.controls.edit").into(),
                    checked: self.editing.get(),
                });
            }
            toggles.push(Switch {
                id: DOCUMENT_SOURCE_PANEL_TOGGLE_ID,
                icon: "editor-mode-source",
                label: t("editor.controls.source").into(),
                checked: self.source_panel.get(),
            });
            return PaneEntries {
                segmented: None,
                toggles,
                items: vec![],
                find: true,
            };
        }
        let segmented = self.markdown_live(cx).map(|live| Segmented {
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
            value: if live { "live" } else { "source" },
        });
        PaneEntries {
            segmented,
            toggles: vec![],
            items: vec![],
            find: true,
        }
    }
    fn pane_segment(&self, id: &'static str, _: &mut Window, cx: &mut App) {
        if self
            .markdown_live(cx)
            .is_some_and(|live| live != (id == "live"))
        {
            self.toggle_live(cx);
        }
    }
    fn pane_item(&self, id: &'static str, window: &mut Window, cx: &mut App) {
        match id {
            DOCUMENT_EDITING_TOGGLE_ID => self.toggle_editing(window, cx),
            DOCUMENT_SOURCE_PANEL_TOGGLE_ID => self.toggle_source_panel(window, cx),
            _ => {}
        }
    }
    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    fn editor_view(&self) -> Option<Entity<EditorView>> {
        Some(self.editor.clone())
    }
    #[cfg(test)]
    fn code_editor(&self) -> Option<Entity<super::code::CodeView>> {
        self.source.as_ref().and_then(|s| s.code_editor())
    }
    /// The CodeMirror adapter: the view searches and marks.
    fn find(&self, event: FindEvent, window: &mut Window, cx: &mut App) -> Option<(usize, usize)> {
        match event {
            FindEvent::Query(query) => {
                Some(self.editor.update(cx, |e, cx| e.find_query(&query, cx)))
            }
            FindEvent::Move { forward } => {
                Some(self.editor.update(cx, |e, cx| e.find_move(forward, cx)))
            }
            FindEvent::Close => {
                self.editor.update(cx, |e, cx| e.find_clear(cx));
                let handle = self.editor.read(cx).focus_handle(cx);
                handle.focus(window, cx);
                None
            }
        }
    }
}
