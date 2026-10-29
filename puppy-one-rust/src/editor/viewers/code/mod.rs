//! Native source-code surface. Kit owns the rope, history, selections,
//! indentation, parser, folds and scrolling; this adapter owns the product
//! language/appearance and the retained document snapshot/IME contract.
mod find;
mod input;
mod style;
#[cfg(test)]
mod tests;

use crate::{
    editor::{
        code::language::Language,
        registry::{
            PaneEntries, SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface,
        },
        workbench::find::FindEvent,
    },
    typography::Scale,
};
use gpui::{prelude::*, *};
use gpui_kit::component::input::{Editor, EditorState, InputEvent, TabSize};

pub struct CodeView {
    pub(super) field: Entity<EditorState>,
    language: Language,
    committed: String,
    composing: bool,
    read_only: bool,
    find: find::CodeFind,
    dark: bool,
    scale: Scale,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<SurfaceEvent> for CodeView {}

impl CodeView {
    fn new(request: &SurfaceRequest, window: &mut Window, cx: &mut Context<Self>) -> Self {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        let language = Language::resolve(request.format.monaco_language.as_deref(), request.name);
        let text = match request.input {
            SurfaceInput::Text(text) => text,
            _ => "",
        };
        let field = cx.new(|cx| {
            EditorState::new(window, cx)
                .language(language.grammar().unwrap_or("puppyone-plaintext"))
                .tab_size(TabSize {
                    tab_size: language.tab_size(),
                    hard_tabs: false,
                })
                .searchable(false)
                .soft_wrap(false)
                .default_value(text)
        });
        let changed = cx.subscribe_in(&field, window, |this, _, event: &InputEvent, w, cx| {
            if matches!(event, InputEvent::Blur) {
                this.finish_composition(w, cx);
            }
            this.sync(w, cx);
        });
        // Kit marks provisional IME edits with notify, not Change. Track them
        // before the host can ask for a snapshot, without publishing drafts.
        let observed = cx.observe_in(&field, window, |this, _, w, cx| this.sync(w, cx));
        let find = find::CodeFind::new(&field, cx);
        style::project(request.dark, request.scale, cx);
        Self {
            field,
            language,
            committed: text.into(),
            composing: false,
            read_only: false,
            find,
            dark: request.dark,
            scale: request.scale,
            _subscriptions: vec![changed, observed],
        }
    }
    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (composing, value) = self.field.update(cx, |s, cx| {
            let composing = s.marked_text_range(window, cx).is_some();
            (composing, (!composing).then(|| s.value().to_string()))
        });
        let ended = self.composing && !composing;
        self.composing = composing;
        if let Some(value) = value {
            let changed = self.committed != value;
            self.committed = value;
            if changed && self.find.active() {
                self.refresh_find(false, cx);
            }
            if changed || ended {
                cx.emit(SurfaceEvent::Changed);
            }
        }
    }
    fn finish_composition(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.composing {
            self.field.update(cx, |s, cx| s.unmark_text(window, cx));
            self.sync(window, cx);
            crate::ui::ime::discard_marked_text();
        }
    }
    fn replace(&mut self, text: &str, window: &mut Window, cx: &mut Context<Self>) {
        // External source replacement resets history and abandons provisional
        // input, without reporting it back as a local edit.
        let was_composing = self.composing;
        self.composing = false;
        self.committed = text.into();
        self.field.update(cx, |s, cx| {
            s.unmark_text(window, cx);
            s.set_value(text, window, cx);
        });
        if was_composing {
            crate::ui::ime::discard_marked_text();
        }
        if self.find.active() {
            self.refresh_find(false, cx);
        }
        cx.notify();
    }
    fn rebind(&mut self, name: &str, cx: &mut Context<Self>) {
        let format =
            crate::editor::registry::resolve(&crate::editor::registry::EditorDocument::local(name))
                .format;
        let language = Language::resolve(format.monaco_language.as_deref(), name);
        if self.language != language {
            self.language = language;
            self.field.update(cx, |s, cx| {
                s.set_highlighter(language.grammar().unwrap_or("puppyone-plaintext"), cx);
                s.set_tab_size(
                    TabSize {
                        tab_size: language.tab_size(),
                        hard_tabs: false,
                    },
                    cx,
                );
            });
        }
    }
    fn history(&mut self, redo: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        self.finish_composition(window, cx);
        self.field.focus_handle(cx).focus(window, cx);
        let action: Box<dyn Action> = if redo {
            Box::new(gpui_kit::base::input::Redo)
        } else {
            Box::new(gpui_kit::base::input::Undo)
        };
        window.dispatch_action(action, cx);
    }
}

impl Render for CodeView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let view = cx.entity();
        let focus = self.field.focus_handle(cx);
        // The final handler preserves Kit's input geometry and adds the missing
        // composition-end notification (unmark itself emits no Kit event).
        let input = canvas(
            |_, _, _| (),
            move |bounds, _, w, cx| {
                w.handle_input(&focus, ElementInputHandler::new(bounds, view.clone()), cx);
            },
        )
        .absolute()
        .size_full();
        div()
            .relative()
            .size_full()
            .child(
                Editor::new(&self.field)
                    .appearance(false)
                    .bordered(false)
                    .readonly(self.read_only)
                    .h_full()
                    .font_family("PuppyOne Geist Mono 400")
                    .text_size(px(self.scale.metrics().editor.code))
                    .line_height(px(20.)),
            )
            .child(input)
    }
}

pub fn open(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    Box::new(CodeSurface {
        view: cx.new(|cx| CodeView::new(request, window, cx)),
    })
}
struct CodeSurface {
    view: Entity<CodeView>,
}
impl ViewerSurface for CodeSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        Some(cx.subscribe(&self.view, move |_, e: &SurfaceEvent, cx| {
            events(e.clone(), cx)
        }))
    }
    fn text(&self, cx: &App) -> Option<String> {
        Some(self.view.read(cx).committed.clone())
    }
    fn composing(&self, cx: &App) -> bool {
        self.view.read(cx).composing
    }
    fn replace_text(&self, text: &str, window: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| v.replace(text, window, cx));
    }
    fn rebind_name(&self, name: &str, cx: &mut App) {
        self.view.update(cx, |v, cx| v.rebind(name, cx));
    }
    fn undo(&self, redo: bool, window: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| v.history(redo, window, cx));
    }
    fn command(&self, name: &str, window: &mut Window, cx: &mut App) {
        if matches!(name, "undo" | "redo") {
            self.undo(name == "redo", window, cx);
        }
    }
    fn apply(&self, read_only: bool, dark: bool, scale: Scale, window: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| {
            if read_only {
                v.finish_composition(window, cx);
            }
            let changed = (v.read_only, v.dark, v.scale) != (read_only, dark, scale);
            v.read_only = read_only;
            v.field.update(cx, |s, cx| s.set_readonly(read_only, cx));
            if (v.dark, v.scale) != (dark, scale) {
                style::project(dark, scale, cx);
            }
            v.dark = dark;
            v.scale = scale;
            if changed {
                cx.notify();
            }
        });
    }
    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        Some(self.view.read(cx).field.focus_handle(cx))
    }
    fn pane(&self, _: &App) -> PaneEntries {
        PaneEntries {
            find: true,
            ..Default::default()
        }
    }
    fn find(&self, event: FindEvent, window: &mut Window, cx: &mut App) -> Option<(usize, usize)> {
        self.view.update(cx, |v, cx| v.find(event, window, cx))
    }
    #[cfg(test)]
    fn code_editor(&self) -> Option<Entity<CodeView>> {
        Some(self.view.clone())
    }
}
