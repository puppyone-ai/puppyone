//! `csv-table`: the CSV table editor (`editor::csv`).
use crate::{
    editor::{
        csv::{CsvEditor, CsvEvent},
        registry::{
            PaneEntries, SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface,
        },
        workbench::{
            find::FindEvent,
            pane::{Item, ItemKind},
        },
    },
    typography::Scale,
};
use gpui::{prelude::*, *};

pub fn open(request: &SurfaceRequest, _: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let text = match request.input {
        SurfaceInput::Text(text) => text,
        _ => "",
    };
    let (dark, scale) = (request.dark, request.scale);
    let editor = cx.new(|cx| CsvEditor::new(request.id, request.name, text, dark, scale, cx));
    Box::new(CsvSurface { editor })
}

pub struct CsvSurface {
    pub editor: Entity<CsvEditor>,
}

impl ViewerSurface for CsvSurface {
    #[cfg(test)]
    fn csv_editor(&self) -> Option<Entity<CsvEditor>> {
        Some(self.editor.clone())
    }
    fn set_reference_context(
        &self,
        context: Option<crate::editor::navigation::ReferenceContext>,
        cx: &mut App,
    ) {
        self.editor.update(cx, |e, cx| {
            e.set_reference_resolver(
                context.map(|context| {
                    std::rc::Rc::new(move |target: &str| Some(context.resolve(target)))
                        as std::rc::Rc<
                            dyn Fn(&str) -> Option<crate::editor::navigation::Resolution>,
                        >
                }),
                cx,
            )
        });
    }
    fn element(&self) -> AnyElement {
        self.editor.clone().into_any_element()
    }
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        Some(
            cx.subscribe(&self.editor, move |_, event: &CsvEvent, cx| match event {
                CsvEvent::Changed => events(SurfaceEvent::Changed, cx),
                CsvEvent::OpenReference(paths) => {
                    events(SurfaceEvent::OpenPaths(paths.clone()), cx)
                }
            }),
        )
    }
    fn text(&self, cx: &App) -> Option<String> {
        Some(self.editor.read(cx).text(cx))
    }
    fn composing(&self, cx: &App) -> bool {
        self.editor.read(cx).composing(cx)
    }
    fn replace_text(&self, text: &str, cx: &mut App) {
        self.editor.update(cx, |e, cx| e.replace_text(text, cx));
    }
    fn undo(&self, redo: bool, window: &mut Window, cx: &mut App) {
        self.editor.update(cx, |e, cx| e.undo(redo, window, cx));
    }
    fn apply(&self, read_only: bool, dark: bool, scale: Scale, cx: &mut App) {
        self.editor.update(cx, |e, cx| {
            e.set_read_only(read_only, cx);
            e.set_appearance(dark, scale, cx);
        });
    }
    fn command(&self, name: &str, window: &mut Window, cx: &mut App) {
        match name {
            "source" => self.editor.update(cx, |e, cx| e.toggle_mode(window, cx)),
            "undo" | "redo" => self
                .editor
                .update(cx, |e, cx| e.undo(name == "redo", window, cx)),
            _ => {}
        }
    }
    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        Some(self.editor.read(cx).focus_target(cx))
    }
    /// CSV keeps its inline source toggle; it contributes its view items.
    fn pane(&self, cx: &App) -> PaneEntries {
        let items = self
            .editor
            .read(cx)
            .view_items()
            .into_iter()
            .map(|i| Item {
                id: i.id,
                label: i.label.into(),
                kind: i
                    .checked
                    .map_or(ItemKind::Command { disabled: false }, ItemKind::Toggle),
            })
            .collect();
        PaneEntries {
            segmented: None,
            items,
            find: true,
        }
    }
    fn pane_item(&self, id: &'static str, window: &mut Window, cx: &mut App) {
        self.editor
            .update(cx, |c, cx| c.view_command(id, window, cx));
    }
    fn find(&self, event: FindEvent, window: &mut Window, cx: &mut App) -> Option<(usize, usize)> {
        match event {
            FindEvent::Query(query) => {
                let r = self.editor.update(cx, |c, cx| c.find_query(&query, cx));
                Some((r.current, r.total))
            }
            FindEvent::Move { forward } => {
                let r = self.editor.update(cx, |c, cx| c.find_move(forward, cx));
                Some((r.current, r.total))
            }
            FindEvent::Close => {
                // `closeFind`: focus the current match's cell, then clear.
                self.editor.update(cx, |c, cx| {
                    c.find_focus_editor(window, cx);
                    c.find_clear(cx);
                });
                None
            }
        }
    }
}
