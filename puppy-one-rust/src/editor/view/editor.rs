//! The editor entity (CodeMirror `EditorView`): owns state, history, the
//! format extension and view state. Every mutation goes through `dispatch`.
use super::{
    decoration::{Decorations, Surface},
    extension::{DecorateInput, EditorExtension},
    layout::DocLayout,
    render::{MeasureCache, ParagraphCache},
};
use crate::editor::text::{
    buffer::Buffer,
    change::ChangeSet,
    history::History,
    selection::Selection,
    state::{EditorState, Transaction, UserEvent},
};
use gpui::{prelude::*, *};
use gpui_kit::base::text::{TextViewStyle, editor_host::RenderContext};
use std::{cell::RefCell, rc::Rc, time::{Duration, Instant}};

/// Caret blink half-period (macOS insertion point).
pub const BLINK: Duration = Duration::from_millis(530);

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Granularity {
    Char,
    Word(usize, usize),
    Line(usize, usize),
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Drag {
    pub anchor: usize,
    pub granularity: Granularity,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EditorEvent {
    /// The document text changed (not emitted for External replacement, nor
    /// for provisional IME text: a composition reports once, when it ends).
    Changed(UserEvent),
    /// An IME composition ended without changing the document (cancelled).
    /// Hosts that deferred work while it was open can proceed.
    CompositionEnded,
}

#[derive(Clone, PartialEq)]
struct DecoKey {
    revision: u64,
    selection: (usize, usize),
    focused: bool,
    selecting: bool,
    dark: bool,
    extension: u64,
    appearance: u64,
}

pub struct EditorView {
    pub(super) state: EditorState,
    pub(super) history: History,
    pub(super) extension: Box<dyn EditorExtension>,
    pub(super) focus: FocusHandle,
    pub(super) decorations: Rc<Decorations>,
    deco_key: Option<DecoKey>,
    /// Geometry of the last painted frame.
    pub(super) layout: Option<Rc<DocLayout>>,
    pub(super) paragraph_cache: Rc<RefCell<ParagraphCache>>,
    pub(super) measures: Rc<RefCell<MeasureCache>>,
    doc_snapshot: Option<(u64, Rc<Buffer>)>,
    kit: Option<(Surface, Rc<RenderContext>)>,
    pub(super) scroll_y: f32,
    pub(super) bounds: Option<Bounds<Pixels>>,
    /// The open IME composition (`composition.rs`).
    pub(super) composition: Option<super::composition::Composition>,
    /// The input method is applying an edit (the composition continues).
    pub(super) ime_update: bool,
    /// Times the view asked the input method to discard its composition.
    pub(super) discard_requests: usize,
    blur: Option<Subscription>,
    pub(super) drag: Option<Drag>,
    pub(super) last_click: Option<(Instant, Point<Pixels>, usize)>,
    pub(super) blink_epoch: Instant,
    pub(super) reveal_caret: bool,
    /// Scroll the caret row to the middle (`scrollIntoView(..., { y: "center" })`).
    pub(super) reveal_centered: bool,
    pub(super) find: super::find::FindMarks,
    focused_before: bool,
    blink_task: Option<Task<()>>,
    /// See `set_read_only`.
    pub(super) read_only: bool,
    pub dark: bool,
    /// Bumped when theme/scale change so decorations rebuild.
    pub appearance: u64,
}

impl EventEmitter<EditorEvent> for EditorView {}

impl Focusable for EditorView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl EditorView {
    pub fn new(text: &str, extension: Box<dyn EditorExtension>, cx: &mut Context<Self>) -> Self {
        let mut state = EditorState::new(text);
        // Dev captures (smoke builds, or screenshot mode): an initial
        // selection and scroll.
        let capture = cfg!(feature = "webview-smoke") || std::env::var_os("PUPPYONE_SCREENSHOT").is_some();
        if capture
            && let Ok(value) = std::env::var("PUPPYONE_EDITOR_SELECTION")
            && let Some((a, b)) = value.split_once(',')
            && let (Ok(a), Ok(b)) = (a.trim().parse::<usize>(), b.trim().parse::<usize>())
        {
            state.selection = Selection::range(state.doc.clamp(a), state.doc.clamp(b));
        }
        Self {
            state,
            history: History::default(),
            extension,
            focus: cx.focus_handle(),
            decorations: Rc::new(Decorations::default()),
            deco_key: None,
            layout: None,
            paragraph_cache: Rc::default(),
            measures: Rc::default(),
            doc_snapshot: None,
            kit: None,
            scroll_y: if capture { std::env::var("PUPPYONE_EDITOR_SCROLL").ok().and_then(|v| v.parse().ok()).unwrap_or(0.) } else { 0. },
            bounds: None,
            composition: None,
            ime_update: false,
            discard_requests: 0,
            blur: None,
            drag: None,
            last_click: None,
            blink_epoch: Instant::now(),
            reveal_caret: false,
            reveal_centered: false,
            find: Default::default(),
            focused_before: false,
            blink_task: None,
            read_only: false,
            dark: true,
            appearance: 0,
        }
    }
    pub fn text(&self) -> &str {
        self.state.doc.as_str()
    }
    pub fn revision(&self) -> u64 {
        self.state.revision
    }
    pub fn state(&self) -> &EditorState {
        &self.state
    }
    pub fn set_line_style_key(&mut self) {
        self.appearance += 1;
    }
    pub fn extension<T: 'static>(&self) -> Option<&T> {
        (self.extension.as_ref() as &dyn std::any::Any).downcast_ref::<T>()
    }
    pub fn extension_mut<T: 'static>(&mut self) -> Option<&mut T> {
        (self.extension.as_mut() as &mut dyn std::any::Any).downcast_mut::<T>()
    }
    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.focus.focus(window, cx);
    }
    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }
    pub fn read_only(&self) -> bool {
        self.read_only
    }
    /// Block or allow editing. Becoming read-only commits an open IME
    /// composition first.
    pub fn set_read_only(&mut self, read_only: bool, cx: &mut Context<Self>) {
        if read_only == self.read_only {
            return;
        }
        if read_only {
            self.commit_composition(cx);
        }
        self.read_only = read_only;
        cx.notify();
    }

    /// Commit an open composition when keyboard focus leaves the editor.
    pub(super) fn watch_focus(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.blur.is_none() {
            self.blur = Some(cx.on_blur(&self.focus, window, |this, _, cx| this.commit_composition(cx)));
        }
    }

    /// Replace the whole document from storage (not undoable).
    pub fn replace_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.abandon_composition(cx);
        if text == self.text() {
            return;
        }
        let end = self.state.doc.len();
        let head = self.state.selection.head.min(text.len());
        let tr = Transaction { changes: ChangeSet::replace(0..end, text), selection: Some(Selection::cursor(head)), event: UserEvent::External, scroll_into_view: false };
        self.dispatch(tr, cx);
    }

    pub fn dispatch(&mut self, tr: Transaction, cx: &mut Context<Self>) {
        // Anything but the input method itself ends an open composition
        // first (the marked text stays as typed).
        if !self.ime_update {
            self.commit_composition(cx);
        }
        let editing = !tr.changes.is_empty();
        if editing && self.read_only && tr.event != UserEvent::External {
            return;
        }
        let scroll = tr.scroll_into_view;
        let event = tr.event;
        let applied = self.state.apply(tr);
        // The caret stays where the input method put it while it composes.
        if !self.history.composing()
            && let Some(selection) = self.extension.normalize_selection(&self.state)
        {
            self.state.selection = selection;
        }
        match applied {
            Some(applied) => {
                self.history.record(&applied, &self.state, Instant::now());
                self.find_changed();
                let focused = self.focused_before;
                self.extension.applied(&applied, &self.state, focused);
                if !matches!(event, UserEvent::External | UserEvent::Compose) {
                    cx.emit(EditorEvent::Changed(event));
                }
            }
            None => {
                let (focused, selecting) = (self.focused_before, self.drag.is_some());
                self.extension.selection_changed(&self.state, focused, selecting);
            }
        }
        self.reveal_caret |= scroll;
        self.blink_epoch = Instant::now();
        cx.notify();
    }

    pub fn undo(&mut self, redo: bool, cx: &mut Context<Self>) {
        // Undo during a composition belongs to nobody: the input method owns
        // the marked text until it commits.
        if self.read_only || self.composing() {
            return;
        }
        if self.extension.owns_history() {
            self.extension.history(redo);
            cx.notify();
            return;
        }
        let before = self.state.revision;
        if self.history.step(&mut self.state, redo) {
            if self.state.revision != before {
                cx.emit(EditorEvent::Changed(if redo { UserEvent::Redo } else { UserEvent::Undo }));
            }
            self.reveal_caret = true;
            self.blink_epoch = Instant::now();
            cx.notify();
        }
    }

    /// Rebuild decorations when any input they depend on changed.
    pub(super) fn sync_decorations(&mut self, focused: bool) {
        if focused != self.focused_before {
            self.focused_before = focused;
            self.extension.selection_changed(&self.state, focused, self.drag.is_some());
        }
        let s = self.state.selection;
        let key = DecoKey {
            revision: self.state.revision,
            selection: (s.anchor, s.head),
            focused,
            selecting: self.drag.is_some(),
            dark: self.dark,
            extension: self.extension.decoration_key(),
            appearance: self.appearance,
        };
        if self.deco_key.as_ref() != Some(&key) {
            let input = DecorateInput { state: &self.state, focused, pointer_selecting: self.drag.is_some(), dark: self.dark };
            self.decorations = Rc::new(self.extension.decorate(&input));
            self.deco_key = Some(key);
        }
    }

    /// The document as of this revision, shared with the frame being built.
    pub(super) fn doc_snapshot(&mut self) -> Rc<Buffer> {
        match &self.doc_snapshot {
            Some((revision, doc)) if *revision == self.state.revision && doc.len() == self.state.doc.len() => doc.clone(),
            _ => {
                let doc = Rc::new(self.state.doc.clone());
                self.doc_snapshot = Some((self.state.revision, doc.clone()));
                doc
            }
        }
    }

    /// Kit's rendering context: link and inline-code colours of the surface.
    /// Kept while the surface is unchanged so Kit's paragraph caches hold.
    pub(super) fn kit_context(&mut self) -> Rc<RenderContext> {
        let surface = &self.decorations.surface;
        if let Some((s, kit)) = &self.kit
            && s == surface
        {
            return kit.clone();
        }
        let transparent: Hsla = transparent_black();
        let style = TextViewStyle::default()
            .with_dark(self.dark)
            .with_link(surface.link.into())
            .with_code_background(transparent)
            .with_inline_code(HighlightStyle { color: Some(surface.inline_code.into()), background_color: Some(transparent), ..Default::default() })
            .with_selection(surface.selection.into())
            .with_paragraph_gap(rems(0.));
        let kit = Rc::new(RenderContext::new(style));
        self.kit = Some((surface.clone(), kit.clone()));
        kit
    }

    /// A widget control or hotspot ran a format command.
    pub fn run_command(&mut self, command: &super::command::Command, window: &mut Window, cx: &mut Context<Self>) {
        self.focus.focus(window, cx);
        if self.read_only {
            return;
        }
        if let Some(tr) = self.extension.command(command, &self.state) {
            self.dispatch(tr, cx);
        }
    }

    pub(super) fn ensure_blink(&mut self, focused: bool, cx: &mut Context<Self>) {
        if !focused {
            self.blink_task = None;
            return;
        }
        if self.blink_task.is_none() {
            self.blink_task = Some(cx.spawn(async move |this, cx| loop {
                cx.background_executor().timer(BLINK).await;
                if this.update(cx, |_, cx| cx.notify()).is_err() {
                    break;
                }
            }));
        }
    }

    pub(super) fn caret_visible(&self) -> bool {
        (self.blink_epoch.elapsed().as_millis() / BLINK.as_millis()) % 2 == 0
    }

    pub fn set_selection(&mut self, selection: Selection, cx: &mut Context<Self>) {
        self.dispatch(Transaction::select(selection), cx);
    }

    /// Insert text at the selection (paste, programmatic input). An open
    /// composition is committed first.
    pub fn insert(&mut self, text: &str, event: UserEvent, cx: &mut Context<Self>) {
        self.commit_composition(cx);
        let range = self.state.selection.as_range();
        let caret = range.start + text.len();
        self.dispatch(Transaction::edit(ChangeSet::replace(range, text), Some(Selection::cursor(caret)), event), cx);
    }

    pub fn layout(&self) -> Option<&Rc<DocLayout>> {
        self.layout.as_ref()
    }
    pub fn decorations(&self) -> &Decorations {
        &self.decorations
    }
}
