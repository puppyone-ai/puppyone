//! Text surfaces on the editor view: Markdown live preview (`markdown`) and
//! source text with the Markdown body typography (`text`, `json`, and the
//! source of formats whose canvas the native build does not have yet).
use crate::{
    editor::{
        markdown::MarkdownExtension,
        registry::{PaneEntries, SurfaceEvent, SurfaceEvents, SurfaceRequest, ViewerSurface},
        view::{
            EditorView,
            decoration::Decorations,
            editor::EditorEvent,
            extension::{EditIntent, EditorExtension, PlainText},
            style::{Edges, LineHeight, LineStyle, TextStyle},
        },
        workbench::{
            find::FindEvent,
            pane::{Segment, Segmented},
        },
    },
    localization::t,
    typography::Scale,
};
use gpui::{prelude::*, *};

/// Source text: the Markdown body typography without syntax.
fn plain_text(dark: bool, scale: Scale) -> PlainText {
    let theme = crate::editor::markdown::style::MarkdownTheme::resolve(dark, scale);
    let body = &theme.body;
    let text = TextStyle {
        line_height: LineHeight::Factor(body.text.line_height_px() / body.text.size),
        ..body.text.clone()
    };
    let line = LineStyle {
        padding: Edges::new(0., 0., body.source_line_gap, 0.),
        ..LineStyle::new(text)
    };
    PlainText {
        line: std::rc::Rc::new(line),
        decorations: Decorations {
            surface: crate::editor::markdown::core::decorations::surface(&theme),
            ..Default::default()
        },
    }
}

fn open(
    request: &SurfaceRequest,
    extension: Box<dyn EditorExtension>,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    let text = match request.input {
        crate::editor::registry::SurfaceInput::Text(text) => text,
        _ => "",
    };
    let dark = request.dark;
    let editor = cx.new(|cx| {
        let mut view = EditorView::new(text, extension, cx);
        view.dark = dark;
        view
    });
    Box::new(TextSurface { editor })
}

/// `markdown`: live preview with a source toggle.
pub fn open_markdown(
    request: &SurfaceRequest,
    _: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    open(
        request,
        Box::new(MarkdownExtension::new(request.dark, request.scale)),
        cx,
    )
}
/// Source text.
pub fn open_source(
    request: &SurfaceRequest,
    _: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    open(
        request,
        Box::new(plain_text(request.dark, request.scale)),
        cx,
    )
}

pub struct TextSurface {
    pub editor: Entity<EditorView>,
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
}

impl ViewerSurface for TextSurface {
    fn element(&self) -> AnyElement {
        self.editor.clone().into_any_element()
    }
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        Some(cx.subscribe(
            &self.editor,
            move |_, event: &EditorEvent, cx| match event {
                // A cancelled composition changes nothing, but a save or switch
                // deferred while it was open waits for this report.
                EditorEvent::Changed(_) | EditorEvent::CompositionEnded => {
                    events(SurfaceEvent::Changed, cx)
                }
            },
        ))
    }
    fn text(&self, cx: &App) -> Option<String> {
        Some(self.editor.read(cx).text().to_owned())
    }
    fn composing(&self, cx: &App) -> bool {
        self.editor.read(cx).composing()
    }
    fn replace_text(&self, text: &str, cx: &mut App) {
        self.editor.update(cx, |e, cx| e.replace_text(text, cx));
    }
    fn undo(&self, redo: bool, _: &mut Window, cx: &mut App) {
        self.editor.update(cx, |e, cx| e.undo(redo, cx));
    }
    fn apply(&self, read_only: bool, dark: bool, scale: Scale, cx: &mut App) {
        self.editor.update(cx, |e, cx| {
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
    fn command(&self, name: &str, _: &mut Window, cx: &mut App) {
        match name {
            "source" => self.toggle_live(cx),
            "undo" => self.editor.update(cx, |e, cx| e.undo(false, cx)),
            "redo" => self.editor.update(cx, |e, cx| e.undo(true, cx)),
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
        Some(self.editor.read(cx).focus_handle(cx))
    }
    /// Markdown contributes its live / source segments to the pane menu.
    fn pane(&self, cx: &App) -> PaneEntries {
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
    #[cfg(test)]
    fn editor_view(&self) -> Option<Entity<EditorView>> {
        Some(self.editor.clone())
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
