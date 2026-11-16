//! `csv-table`: the CSV table editor (`editor::csv`).
#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
use crate::editor::registry::SurfaceTestProbe;
use crate::{
    editor::{
        csv::{CsvEditor, CsvEvent},
        registry::{
            HostCommand, PaneEntries, PaneItemId, SurfaceEvent, SurfaceEvents, SurfaceInput,
            SurfaceRequest, ViewerSurface,
        },
        text::selection::Selection,
        workbench::{
            find::FindEvent,
            pane::{Item, ItemKind},
            view_state::SurfaceViewState,
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

#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
impl SurfaceTestProbe for CsvSurface {
    #[cfg(feature = "test-support")]
    fn csv_editor(&self) -> Option<Entity<CsvEditor>> {
        Some(self.editor.clone())
    }
}

impl ViewerSurface for CsvSurface {
    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    fn as_test_probe(&self) -> Option<&dyn SurfaceTestProbe> {
        Some(self)
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
                CsvEvent::FindResult { current, total } => events(
                    SurfaceEvent::FindResult {
                        current: *current,
                        total: *total,
                    },
                    cx,
                ),
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
    fn replace_text(&self, text: &str, _: &mut Window, cx: &mut App) {
        self.editor.update(cx, |e, cx| e.replace_text(text, cx));
    }
    fn undo(&self, redo: bool, window: &mut Window, cx: &mut App) {
        self.editor.update(cx, |e, cx| e.undo(redo, window, cx));
    }
    fn set_chrome_inset(&self, top: f32, cx: &mut App) {
        self.editor.update(cx, |e, cx| e.set_chrome_inset(top, cx));
    }
    fn scroll_state(&self, cx: &App) -> (f32, bool) {
        self.editor.read(cx).scroll_state(cx)
    }
    fn view_state(&self, cx: &App) -> Option<SurfaceViewState> {
        let ed = self.editor.read(cx);
        if ed.is_live() {
            let (scroll_x, scroll_y) = ed.view_scroll();
            Some(SurfaceViewState {
                selection: None,
                scroll_y,
                scroll_x,
                mode: Some("live".into()),
                zoom: None,
                folds: Vec::new(),
            })
        } else {
            let (selection, scroll_y) = ed
                .source_editor_entity()
                .map(|src| {
                    let s = src.read(cx);
                    let sel = s.state().selection;
                    (Some((sel.anchor, sel.head)), s.scroll_top())
                })
                .unwrap_or((None, 0.0));
            Some(SurfaceViewState {
                selection,
                scroll_y,
                scroll_x: 0.0,
                mode: Some("source".into()),
                zoom: None,
                folds: Vec::new(),
            })
        }
    }
    fn restore_view_state(&self, state: &SurfaceViewState, window: &mut Window, cx: &mut App) {
        let want_live = state.mode.as_deref() != Some("source");
        self.editor.update(cx, |e, cx| {
            e.set_live(want_live, window, cx);
            if want_live {
                e.set_view_scroll(state.scroll_x, state.scroll_y, cx);
            } else if let Some(source) = e.source_editor_entity() {
                source.update(cx, |src, cx| {
                    if let Some((anchor, head)) = state.clamped_selection(src.text()) {
                        src.set_selection(Selection::range(anchor, head), cx);
                    }
                });
            }
        });
    }
    fn apply(&self, read_only: bool, dark: bool, scale: Scale, _: &mut Window, cx: &mut App) {
        self.editor.update(cx, |e, cx| {
            e.set_read_only(read_only, cx);
            e.set_appearance(dark, scale, cx);
        });
    }
    fn command(&self, cmd: HostCommand, window: &mut Window, cx: &mut App) {
        match cmd {
            HostCommand::Source => self.editor.update(cx, |e, cx| e.toggle_mode(window, cx)),
            HostCommand::Undo => self.editor.update(cx, |e, cx| e.undo(false, window, cx)),
            HostCommand::Redo => self.editor.update(cx, |e, cx| e.undo(true, window, cx)),
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
            toggles: vec![],
            items,
            find: true,
        }
    }
    fn pane_item(&self, item: PaneItemId, window: &mut Window, cx: &mut App) {
        self.editor
            .update(cx, |c, cx| c.view_command(item.as_wire(), window, cx));
    }
    fn find(&self, event: FindEvent, window: &mut Window, cx: &mut App) -> Option<(usize, usize)> {
        // `CS-12`: when in Source mode (`!is_live()`), delegate Find directly to `self.source`!
        if !self.editor.read(cx).is_live()
            && let Some(source) = self.editor.read(cx).source_editor_entity()
        {
            return match event {
                FindEvent::Query(query) => {
                    Some(source.update(cx, |e, cx| e.find_query(&query, cx)))
                }
                FindEvent::Move { forward } => {
                    Some(source.update(cx, |e, cx| e.find_move(forward, cx)))
                }
                FindEvent::Close => {
                    source.update(cx, |e, cx| e.find_clear(cx));
                    let handle = source.read(cx).focus_handle(cx);
                    handle.focus(window, cx);
                    None
                }
            };
        }
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
                self.editor.update(cx, |c, cx| c.find_clear(cx));
                let focus = self.editor.read(cx).focus_target(cx);
                focus.focus(window, cx);
                None
            }
        }
    }
}
