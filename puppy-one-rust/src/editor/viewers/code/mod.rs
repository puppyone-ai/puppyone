//! Unified native source-code & plain-text surface (`CE-01`–`CE-04`, `CE-10`–`CE-12`,
//! `CE-20`, `CE-21`):
//! - Runs on the shared rope [`Buffer`] + [`EditorView`] kernel via
//!   [`CodeExtension`] (`CE-01`), with native IME composition events and zero
//!   transparent input-intercept canvas (`CE-04`).
//! - Change notifications carry no full-document `String` copies (`CE-02`), and
//!   host snapshots borrow an `O(1)` rope [`Buffer`] handle (`DP-44`).
//! - Derived conflict blocks, syntax highlights, fold regions, and passive
//!   decorations are cached by document revision (`CE-03`).
#[cfg(test)]
mod tests;

pub use crate::editor::{code::decorate, view::plugins::conflicts};

#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
use crate::editor::registry::SurfaceTestProbe;
use crate::{
    editor::{
        code::{
            extension::{
                CodeExtension, SetCodeLanguage, SetFoldedLines, SetVisualHighlight, UnfoldOffset,
            },
            language::Language,
        },
        registry::{
            CompanionHistory, HostCommand, PaneEntries, SurfaceEvent, SurfaceEvents,
            SurfaceHistory, SurfaceInput, SurfaceRequest, ViewerSurface,
        },
        text::{
            buffer::Buffer,
            change::{Change, ChangeSet},
            history::{MAX_BYTES, MAX_STEPS},
            selection::Selection,
            state::{Transaction, UserEvent},
        },
        view::{EditorView, editor::EditorEvent, extension::config_transaction},
        workbench::{find::FindEvent, view_state::SurfaceViewState},
    },
    typography::Scale,
    ui::input::{Redo as InputRedo, Undo as InputUndo},
};
use gpui::{prelude::*, *};
use std::ops::Range;

/// `DOCUMENT_HISTORY_POLICY.maxEntries` / `maxBytes` (UTF-16 bytes).
pub const HISTORY_ENTRIES: usize = MAX_STEPS;
pub const HISTORY_BYTES: usize = MAX_BYTES;

pub struct CodeView {
    pub editor: Entity<EditorView>,
    language: Language,
    language_override: Option<String>,
    read_only: bool,
    history_owner: Option<SurfaceHistory>,
    dark: bool,
    scale: Scale,
    restored_scroll_y: Option<f32>,
    _subscription: Subscription,
}

impl EventEmitter<SurfaceEvent> for CodeView {}

impl CodeView {
    #[cfg(test)]
    pub(crate) fn new(
        request: &SurfaceRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        Self::new_with(request, None, false, window, cx)
    }

    fn new_with(
        request: &SurfaceRequest,
        language_override: Option<&str>,
        soft_wrap: bool,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        let explicit = language_override.or(request.format.monaco_language.as_deref());
        let language = Language::resolve(explicit, request.name);
        let text = match request.input {
            SurfaceInput::Text(text) => text,
            _ => "",
        };
        let dark = request.dark;
        let scale = request.scale;
        let ext = CodeExtension::new(language, soft_wrap, dark, scale);
        let editor = cx.new(|cx| {
            let mut view = EditorView::new(text, Box::new(ext), cx);
            view.set_appearance(dark, scale, cx);
            view
        });
        let subscription = cx.subscribe(&editor, |_this, _, event: &EditorEvent, cx| match event {
            EditorEvent::Changed(_) | EditorEvent::CompositionEnded => {
                cx.emit(SurfaceEvent::Changed);
            }
            EditorEvent::FindResult { current, total } => {
                cx.emit(SurfaceEvent::FindResult {
                    current: *current,
                    total: *total,
                });
            }
            EditorEvent::OpenPaths(paths) => {
                cx.emit(SurfaceEvent::OpenPaths(paths.clone()));
            }
        });
        Self {
            editor,
            language,
            language_override: language_override.map(str::to_owned),
            read_only: false,
            history_owner: None,
            dark,
            scale,
            restored_scroll_y: None,
            _subscription: subscription,
        }
    }

    /// `O(1)` committed rope [`Buffer`] snapshot (`CE-02`, `DP-44`).
    pub fn committed_buffer(&self, cx: &App) -> Buffer {
        let doc = self.editor.read(cx).committed_doc();
        Buffer::from_rope(doc.rope().clone())
    }

    /// Materialise committed text only when explicitly queried (`CE-02`).
    pub fn text(&self, cx: &App) -> String {
        let doc = self.editor.read(cx).committed_doc();
        doc.slice_cow(0..doc.len()).into_owned()
    }

    pub fn composing(&self, cx: &App) -> bool {
        self.editor.read(cx).composing()
    }

    #[cfg(test)]
    pub(crate) fn language(&self) -> Language {
        self.language
    }

    pub fn set_chrome_inset(&mut self, top: f32, cx: &mut Context<Self>) {
        self.editor.update(cx, |e, cx| e.set_chrome_inset(top, cx));
    }

    pub fn scroll_top(&self, cx: &App) -> f32 {
        self.editor.read(cx).scroll_top()
    }

    pub(crate) fn replace(&mut self, text: &str, _window: &mut Window, cx: &mut Context<Self>) {
        self.editor.update(cx, |e, cx| e.replace_text(text, cx));
    }

    #[cfg(test)]
    pub(crate) fn resolve_conflicts(
        &mut self,
        resolved: String,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only {
            return;
        }
        self.editor.update(cx, |e, cx| {
            crate::editor::view::plugins::conflicts::apply_conflict_resolution(e, &resolved, cx)
        });
    }

    pub(crate) fn rebind(&mut self, name: &str, cx: &mut Context<Self>) {
        let format =
            crate::editor::registry::resolve(&crate::editor::registry::EditorDocument::local(name))
                .format;
        let explicit = self
            .language_override
            .as_deref()
            .or(format.monaco_language.as_deref());
        let language = Language::resolve(explicit, name);
        if self.language != language {
            self.language = language;
            self.editor.update(cx, |e, cx| {
                e.dispatch(config_transaction(SetCodeLanguage(language)), cx);
            });
        }
    }

    /// Another view's local edit (HTML visual editor / companion pane): applied
    /// as one undoable command step on `self.editor` (`CE-01`, `CE-02`).
    pub(crate) fn edit_utf16(
        &mut self,
        edits: &[(Range<usize>, String)],
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.read_only || self.composing(cx) {
            return false;
        }
        if edits.is_empty() {
            return true;
        }
        self.editor.update(cx, |e, cx| {
            let doc = &e.state().doc;
            let mut changes = Vec::with_capacity(edits.len());
            let mut last_end = 0usize;
            let mut delta: isize = 0;
            for (r16, insert) in edits {
                let a = doc.utf16_to_byte(r16.start);
                let b = doc.utf16_to_byte(r16.end);
                let range = a.min(b)..a.max(b);
                last_end = (range.start as isize + delta + insert.len() as isize).max(0) as usize;
                delta += insert.len() as isize - range.len() as isize;
                changes.push(Change {
                    range,
                    insert: insert.clone(),
                });
            }
            e.dispatch(
                Transaction::edit(
                    ChangeSet::new(changes),
                    Some(Selection::cursor(last_end)),
                    UserEvent::Command,
                )
                .with_scroll_into_view(false),
                cx,
            );
        });
        true
    }

    fn reveal_range(
        &mut self,
        range: Option<Range<usize>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let len = self.editor.read(cx).committed_doc().len();
        let valid = range.filter(|r| r.start <= r.end && r.end <= len);
        let focused = self.editor.read(cx).focus_handle(cx).is_focused(window);
        self.editor.update(cx, |e, cx| {
            e.dispatch(config_transaction(SetVisualHighlight(valid.clone())), cx);
            if let Some(ref r) = valid
                && !focused
            {
                e.dispatch(config_transaction(UnfoldOffset(r.start)), cx);
                e.set_selection(Selection::cursor(r.start), cx);
            }
        });
    }

    pub(crate) fn replay(&mut self, redo: bool, _window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only || self.composing(cx) {
            return;
        }
        self.editor.update(cx, |e, cx| e.replay_history(redo, cx));
    }

    pub(crate) fn history(&mut self, redo: bool, _window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if let Some(history) = &self.history_owner {
            if !self.composing(cx) {
                history(redo, cx);
            }
            return;
        }
        self.editor.update(cx, |e, cx| {
            e.commit_composition(cx);
            e.undo(redo, cx);
        });
    }

    pub(crate) fn find(
        &mut self,
        event: FindEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<(usize, usize)> {
        match event {
            FindEvent::Close => {
                self.editor.update(cx, |e, cx| e.find_clear(cx));
                let handle = self.editor.read(cx).focus_handle(cx);
                handle.focus(window, cx);
                None
            }
            FindEvent::Query(query) => {
                let res = self.editor.update(cx, |e, cx| e.find_query(&query, cx));
                cx.emit(SurfaceEvent::FindResult {
                    current: res.0,
                    total: res.1,
                });
                Some(res)
            }
            FindEvent::Move { forward } => {
                let res = self.editor.update(cx, |e, cx| e.find_move(forward, cx));
                cx.emit(SurfaceEvent::FindResult {
                    current: res.0,
                    total: res.1,
                });
                Some(res)
            }
        }
    }
}

impl EntityInputHandler for CodeView {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<String> {
        self.editor
            .update(cx, |e, cx| e.text_for_range(range, actual, w, cx))
    }

    fn selected_text_range(
        &mut self,
        ignore: bool,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        self.editor
            .update(cx, |e, cx| e.selected_text_range(ignore, w, cx))
    }

    fn marked_text_range(&self, w: &mut Window, cx: &mut Context<Self>) -> Option<Range<usize>> {
        self.editor.update(cx, |e, cx| e.marked_text_range(w, cx))
    }

    fn unmark_text(&mut self, w: &mut Window, cx: &mut Context<Self>) {
        self.editor.update(cx, |e, cx| e.unmark_text(w, cx));
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.editor
            .update(cx, |e, cx| e.replace_text_in_range(range, text, w, cx));
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selected: Option<Range<usize>>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.editor.update(cx, |e, cx| {
            e.replace_and_mark_text_in_range(range, text, selected, w, cx)
        });
    }

    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        bounds: Bounds<Pixels>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        self.editor
            .update(cx, |e, cx| e.bounds_for_range(range, bounds, w, cx))
    }

    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<usize> {
        self.editor
            .update(cx, |e, cx| e.character_index_for_point(point, w, cx))
    }

    fn set_selected_text_range(
        &mut self,
        range: Range<usize>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.editor
            .update(cx, |e, cx| e.set_selected_text_range(range, w, cx));
    }

    fn accepts_text_input(&self, w: &mut Window, cx: &mut Context<Self>) -> bool {
        self.editor.update(cx, |e, cx| e.accepts_text_input(w, cx))
    }
}

impl Render for CodeView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .capture_action(cx.listener(|v, _: &InputUndo, w, cx| {
                if v.history_owner.is_some() {
                    v.history(false, w, cx);
                    cx.stop_propagation();
                }
            }))
            .capture_action(cx.listener(|v, _: &InputRedo, w, cx| {
                if v.history_owner.is_some() {
                    v.history(true, w, cx);
                    cx.stop_propagation();
                }
            }))
            .child(self.editor.clone())
    }
}

pub fn open(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    open_with(request, None, false, window, cx)
}

pub fn open_with(
    request: &SurfaceRequest,
    language: Option<&str>,
    soft_wrap: bool,
    window: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    let view = cx.new(|cx| CodeView::new_with(request, language, soft_wrap, window, cx));
    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    let editor = view.read(cx).editor.clone();
    Box::new(CodeSurface {
        view,
        #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
        editor,
    })
}

pub(crate) struct CodeSurface {
    pub(crate) view: Entity<CodeView>,
    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    pub(crate) editor: Entity<EditorView>,
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
        Some(self.view.read(cx).text(cx))
    }

    fn buffer(&self, cx: &App) -> Option<Buffer> {
        Some(self.view.read(cx).committed_buffer(cx))
    }

    fn composing(&self, cx: &App) -> bool {
        self.view.read(cx).composing(cx)
    }

    fn replace_text(&self, text: &str, window: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| v.replace(text, window, cx));
    }

    fn edit_utf16(
        &self,
        edits: &[(Range<usize>, String)],
        window: &mut Window,
        cx: &mut App,
    ) -> bool {
        self.view
            .update(cx, |v, cx| v.edit_utf16(edits, window, cx))
    }

    fn reveal_range(&self, range: Option<Range<usize>>, window: &mut Window, cx: &mut App) {
        self.view
            .update(cx, |v, cx| v.reveal_range(range, window, cx));
    }

    fn rebind_name(&self, name: &str, cx: &mut App) {
        self.view.update(cx, |v, cx| v.rebind(name, cx));
    }

    fn undo(&self, redo: bool, window: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| v.history(redo, window, cx));
    }

    fn set_chrome_inset(&self, top: f32, cx: &mut App) {
        self.view.update(cx, |v, cx| v.set_chrome_inset(top, cx));
    }

    fn scroll_state(&self, cx: &App) -> (f32, bool) {
        (self.view.read(cx).scroll_top(cx), false)
    }

    fn view_state(&self, cx: &App) -> Option<SurfaceViewState> {
        let v = self.view.read(cx);
        let ed = v.editor.read(cx);
        let sel = ed.state().selection;
        let scroll_y = if ed.scroll_top() > 0.0 || ed.layout().is_some() {
            ed.scroll_top()
        } else {
            v.restored_scroll_y.unwrap_or(0.0)
        };
        let folds = ed
            .extension::<CodeExtension>()
            .map(|ext| {
                ext.folded_lines(ed.committed_doc())
                    .into_iter()
                    .map(|l| (l, true))
                    .collect()
            })
            .unwrap_or_default();
        Some(SurfaceViewState {
            selection: Some((sel.anchor, sel.head)),
            scroll_y,
            scroll_x: 0.0,
            mode: None,
            zoom: None,
            folds,
        })
    }

    fn restore_view_state(&self, state: &SurfaceViewState, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| {
            let (_, sy) = state.clamped_scroll(None, None);
            v.restored_scroll_y = Some(sy);
            v.editor.update(cx, |e, cx| {
                let doc = e.committed_doc();
                let clamped_sel = state.clamped_selection_in_buffer(doc);
                let folded_lines: Vec<usize> = state
                    .clamped_folds(doc.line_count())
                    .into_iter()
                    .filter_map(|(line, folded)| folded.then_some(line))
                    .collect();
                e.dispatch(config_transaction(SetFoldedLines(folded_lines)), cx);
                if let Some((anchor, head)) = clamped_sel {
                    e.set_selection(Selection::range(anchor, head), cx);
                }
                e.set_scroll_top(sy, cx);
            });
        });
    }

    fn command(&self, cmd: HostCommand, window: &mut Window, cx: &mut App) {
        match cmd {
            HostCommand::Undo => self.undo(false, window, cx),
            HostCommand::Redo => self.undo(true, window, cx),
            HostCommand::ReplayUndo => self.view.update(cx, |v, cx| v.replay(false, window, cx)),
            HostCommand::ReplayRedo => self.view.update(cx, |v, cx| v.replay(true, window, cx)),
            _ => {}
        }
    }

    fn apply(&self, read_only: bool, dark: bool, scale: Scale, _window: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| {
            v.read_only = read_only;
            v.dark = dark;
            v.scale = scale;
            v.editor.update(cx, |e, cx| {
                e.set_read_only(read_only, cx);
                e.set_appearance(dark, scale, cx);
            });
        });
    }

    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        Some(self.view.read(cx).editor.read(cx).focus_handle(cx))
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

    fn as_companion_history(&self) -> Option<&dyn CompanionHistory> {
        Some(self)
    }

    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    fn as_test_probe(&self) -> Option<&dyn SurfaceTestProbe> {
        Some(self)
    }
}

impl CompanionHistory for CodeSurface {
    fn set_history_owner(&self, history: SurfaceHistory, cx: &mut App) {
        self.view.update(cx, |v, _| v.history_owner = Some(history));
    }
}

#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
impl SurfaceTestProbe for CodeSurface {
    fn editor_view(&self) -> Option<Entity<EditorView>> {
        Some(self.editor.clone())
    }

    #[cfg(test)]
    fn code_editor(&self) -> Option<Entity<CodeView>> {
        Some(self.view.clone())
    }
}
