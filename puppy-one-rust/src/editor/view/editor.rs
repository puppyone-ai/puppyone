//! The editor entity (CodeMirror `EditorView`): owns state, history, composed
//! extensions/plugins and grouped view sub-states (`TODO-31`). Every document,
//! selection, undo/redo, external adoption and configuration change flows
//! through [`EditorView::dispatch`] (`P1`, `TA-05`, `TA-06`, `TA-07`, `TA-21`).
use super::{
    decoration::{Decorations, LayeredDecorations, Surface},
    extension::{
        DecorateInput, EditorExtension, ExtensionSet, SetAppearance, SetChromeInset, SetReadOnly,
        StateFieldFacet, TransactionFilter, config_transaction,
    },
    heights::HeightMap,
    layout::DocLayout,
    plugins::ViewPlugin,
    render::{MeasureCache, ParagraphCache},
    widget::{BlockId, WidgetStateStore},
};
use crate::editor::text::{
    buffer::Buffer,
    change::ChangeSet,
    history::{History, minimal_diff},
    selection::Selection,
    state::{Annotation, EditorState, Transaction, UserEvent},
};
use gpui::{prelude::*, *};
use gpui_kit::base::text::{TextViewStyle, editor_host::RenderContext};
#[cfg(test)]
use std::borrow::Cow;
use std::{
    cell::RefCell,
    collections::HashSet,
    rc::Rc,
    time::{Duration, Instant},
};

/// Caret blink half-period (macOS insertion point).
pub const BLINK: Duration = Duration::from_millis(530);

/// Annotation tag identifying companion Source <-> Live Preview synchronization
/// transactions (`TA-70`).
pub const SYNC_COMPANION_ANNOTATION: &str = "sync.companion";

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

#[derive(Clone, Debug, PartialEq)]
pub enum EditorEvent {
    /// The document text changed (not emitted for External replacement, nor
    /// for provisional IME text: a composition reports once, when it ends).
    Changed(UserEvent),
    /// An IME composition ended without changing the document (cancelled).
    /// Hosts that deferred work while it was open can proceed.
    CompositionEnded,
    OpenPaths(Vec<String>),
}

/// Cache key of the Document Layer (`TA-11`): depends ONLY on revision, theme,
/// extension document-config key, and chrome inset — NEVER cursor or focus.
#[derive(Clone, Copy, PartialEq, Eq)]
struct DocDecoKey {
    revision: u64,
    dark: bool,
    extension: u64,
    chrome_inset: u32,
}

/// Cache key of the Reveal Layer (`TA-11`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct RevealDecoKey {
    revision: u64,
    selection: (usize, usize),
    focused: bool,
    selecting: bool,
    reveal: u64,
    legacy_dark: bool,
    legacy_ext: u64,
    legacy_inset: u32,
}

/// Grouped layout, shaping, decoration, and widget state caches (`TODO-31`).
#[derive(Default)]
pub(super) struct ViewCaches {
    pub decorations: LayeredDecorations,
    doc_layer: Rc<Decorations>,
    doc_deco_key: Option<DocDecoKey>,
    pub reveal_deco_key: Option<RevealDecoKey>,
    /// Geometry of the last painted frame.
    pub layout: Option<Rc<DocLayout>>,
    pub paragraph_cache: Rc<RefCell<ParagraphCache>>,
    pub measures: Rc<RefCell<MeasureCache>>,
    /// Block heights of the document, laid out or estimated (`heights.rs`).
    pub heights: Rc<RefCell<HeightMap>>,
    /// Transient per-`BlockId` UI state store (`TA-14`).
    pub widget_states: Rc<RefCell<WidgetStateStore>>,
    doc_snapshot: Option<(u64, Rc<Buffer>)>,
    kit: Option<(Surface, Rc<RenderContext>)>,
    pub doc_layer_rebuilds: u64,
}

/// Grouped caret blink state (`TODO-31`).
pub(super) struct BlinkState {
    pub epoch: Instant,
    pub task: Option<Task<()>>,
}

impl Default for BlinkState {
    fn default() -> Self {
        Self {
            epoch: Instant::now(),
            task: None,
        }
    }
}

/// Grouped pointer selection, link activation, and scroll-reveal state (`TODO-31`).
#[derive(Default)]
pub(super) struct PointerState {
    pub drag: Option<Drag>,
    pub link_press: Option<super::pointer::LinkPress>,
    pub reveal_caret: bool,
    /// Scroll the caret row to the middle (`scrollIntoView(..., { y: "center" })`).
    pub reveal_centered: bool,
}

/// Grouped IME marked-text composition state (`TODO-31`).
#[derive(Default)]
pub(super) struct ImeState {
    /// The open IME composition (`composition.rs`).
    pub composition: Option<super::composition::Composition>,
    /// The input method is applying an edit (the composition continues).
    pub updating: bool,
    /// Times the view asked the input method to discard its composition.
    pub discard_requests: usize,
}

pub struct EditorView {
    pub(super) state: EditorState,
    pub(super) history: History,
    pub(super) extensions: ExtensionSet,
    pub(super) focus: FocusHandle,
    pub(super) caches: ViewCaches,
    pub(super) blink: BlinkState,
    pub(super) pointer: PointerState,
    pub(super) ime: ImeState,
    pub(super) scroll_y: f32,
    pub(super) bounds: Option<Bounds<Pixels>>,
    blur: Option<Subscription>,
    pub(super) focused_before: bool,
    /// Single source of truth for read-only (`TA-07`, `TA-21`).
    pub(super) read_only: bool,
    pub dark: bool,
    /// `--po-editor-chrome-inset-block-start`: room for chrome floating over
    /// the top (a file window's title bar), added to the resting start
    /// padding so content only passes under it when scrolled.
    chrome_inset: f32,
}

impl EventEmitter<EditorEvent> for EditorView {}

impl Focusable for EditorView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl EditorView {
    pub fn new(text: &str, extension: Box<dyn EditorExtension>, cx: &mut Context<Self>) -> Self {
        Self::with_extensions(text, ExtensionSet::single(extension), cx)
    }

    pub fn with_extensions(text: &str, extensions: ExtensionSet, cx: &mut Context<Self>) -> Self {
        let mut state = EditorState::new(text);
        let mut scroll_y = 0.;
        // Dev captures (smoke builds, tests, or screenshot mode): gated behind
        // `test` or `dev-capture` (`TODO-90`).
        if cfg!(any(test, feature = "dev-capture")) {
            let capture =
                cfg!(feature = "dev-capture") || std::env::var_os("PUPPYONE_SCREENSHOT").is_some();
            if capture {
                if let Ok(value) = std::env::var("PUPPYONE_EDITOR_SELECTION")
                    && let Some((a, b)) = value.split_once(',')
                    && let (Ok(a), Ok(b)) = (a.trim().parse::<usize>(), b.trim().parse::<usize>())
                {
                    state.selection = Selection::range(state.doc.clamp(a), state.doc.clamp(b));
                }
                scroll_y = std::env::var("PUPPYONE_EDITOR_SCROLL")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(0.);
            }
        }
        extensions.ensure_keymaps_registered(cx);
        Self {
            state,
            history: History::default(),
            extensions,
            focus: cx.focus_handle(),
            caches: ViewCaches::default(),
            blink: BlinkState::default(),
            pointer: PointerState::default(),
            ime: ImeState::default(),
            scroll_y,
            bounds: None,
            blur: None,
            focused_before: false,
            read_only: false,
            dark: true,
            chrome_inset: 0.,
        }
    }

    pub fn text(&self) -> &str {
        self.state.doc.as_str()
    }

    pub fn state(&self) -> &EditorState {
        &self.state
    }

    /// Document top and bottom of the block holding `offset`, as the last
    /// frame's height plan has them (laid out or estimated).
    pub(super) fn estimated_block_of(&self, offset: usize) -> Option<(f32, f32)> {
        let layered = &self.caches.decorations;
        let line = self.state.doc.line_index(offset);
        let i = layered.block_index_for_line(line);
        let heights = self.caches.heights.borrow();
        if i >= layered.block_len() || !heights.planned() || heights.len() != layered.block_len() {
            return None;
        }
        let top = heights.top(i);
        Some((top, top + heights.height(i)))
    }

    pub fn extension<T: 'static>(&self) -> Option<&T> {
        self.extensions.extension::<T>()
    }

    pub fn add_extension(&mut self, extension: Box<dyn EditorExtension>, cx: &mut Context<Self>) {
        self.extensions.add_extension(extension, cx);
        self.caches.doc_deco_key = None;
        self.caches.reveal_deco_key = None;
        cx.notify();
    }

    pub fn add_plugin(&mut self, plugin: Box<dyn ViewPlugin>, cx: &mut Context<Self>) {
        self.extensions.add_plugin(plugin, cx);
        cx.notify();
    }

    pub fn add_state_field(&mut self, field: Box<dyn StateFieldFacet>, cx: &mut Context<Self>) {
        self.extensions.add_state_field(field);
        self.caches.doc_deco_key = None;
        cx.notify();
    }

    pub fn add_transaction_filter(&mut self, filter: TransactionFilter) {
        self.extensions.add_transaction_filter(filter);
    }

    pub fn plugin<P: 'static>(&self) -> Option<&P> {
        self.extensions.plugin::<P>()
    }

    pub fn plugin_mut<P: 'static>(&mut self) -> Option<&mut P> {
        self.extensions.plugin_mut::<P>()
    }

    pub fn state_field<F: 'static>(&self) -> Option<&F> {
        self.extensions.state_field::<F>()
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.focus.focus(window, cx);
    }

    #[cfg(test)]
    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    #[cfg(test)]
    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }

    pub fn read_only(&self) -> bool {
        self.read_only
    }

    /// Block or allow editing via a typed configuration transaction (`TA-21`).
    /// Becoming read-only commits an open IME composition first.
    pub fn set_read_only(&mut self, read_only: bool, cx: &mut Context<Self>) {
        if read_only == self.read_only {
            return;
        }
        self.dispatch(config_transaction(SetReadOnly(read_only)), cx);
    }

    /// Update theme appearance (`dark`, `scale`) via a typed configuration
    /// transaction (`TA-21`).
    pub fn set_appearance(
        &mut self,
        dark: bool,
        scale: crate::typography::Scale,
        cx: &mut Context<Self>,
    ) {
        self.dispatch(config_transaction(SetAppearance { dark, scale }), cx);
    }

    /// Commit an open composition and notify plugins when keyboard focus leaves
    /// the editor.
    pub(super) fn watch_focus(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.blur.is_none() {
            self.blur = Some(cx.on_blur(&self.focus, window, |this, _, cx| {
                this.pointer.link_press = None;
                this.commit_composition(cx);
                let mut notify = false;
                for plugin in &mut this.extensions.plugins {
                    notify |= plugin.on_blur(&this.state);
                }
                if notify {
                    cx.notify();
                }
            }));
        }
    }

    /// Adopt external document text via a minimal-diff `Annotation::EXTERNAL`
    /// transaction (`TA-71`, `DP-03`): abandons any open IME composition, maps
    /// the current selection across the minimal diff, and records a sealed
    /// undoable step so `⌘Z` recovers overwritten input.
    pub fn apply_external(&mut self, text: &str, cx: &mut Context<Self>) {
        self.abandon_composition(cx);
        let Some(changes) = minimal_diff(&self.state.doc, text) else {
            cx.notify();
            return;
        };
        let tr = Transaction::edit(changes, None, UserEvent::External).with_scroll_into_view(false);
        self.dispatch(tr, cx);
    }

    /// Adopt external document text (`TA-71`, `DP-03`).
    pub fn replace_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.apply_external(text, cx);
    }

    /// Reset the document with clean undo/redo history (for fresh document load
    /// when history must start empty).
    pub fn reset_document(&mut self, text: &str, cx: &mut Context<Self>) {
        self.abandon_composition(cx);
        self.state = EditorState::new(text);
        self.history.clear();
        self.caches.doc_deco_key = None;
        self.caches.reveal_deco_key = None;
        cx.notify();
    }

    /// Apply a companion source-panel edit via minimal-diff `ChangeSet`
    /// annotated with `"sync.companion"` (`TA-70`): never mutates
    /// `self.read_only`, maps selection properly, and records history weight
    /// proportional only to the edit delta.
    pub fn sync_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.abandon_composition(cx);
        let Some(changes) = minimal_diff(&self.state.doc, text) else {
            return;
        };
        let tr = Transaction::edit(changes, None, UserEvent::Input)
            .with_annotation(SYNC_COMPANION_ANNOTATION)
            .with_scroll_into_view(false);
        self.dispatch(tr, cx);
    }

    pub fn dispatch(&mut self, tr: Transaction, cx: &mut Context<Self>) {
        self.dispatch_inner(tr, cx);
    }

    fn dispatch_inner(&mut self, mut tr: Transaction, cx: &mut Context<Self>) -> bool {
        // Any edit or selection transaction outside the input method ends an
        // open composition first (`TA-16`); pure configuration `StateEffect`s
        // (such as `SetAppearance`) leave an in-flight preedit untouched.
        if !self.ime.updating && (!tr.changes.is_empty() || tr.selection.is_some()) {
            self.commit_composition(cx);
        }

        // Apply view-level configuration effects (`TA-21`) before read-only
        // filtering so `SetReadOnly(false)` takes effect immediately.
        for eff in tr.effects::<SetReadOnly>() {
            let next = eff.0;
            if next != self.read_only {
                if next {
                    self.pointer.link_press = None;
                    self.commit_composition(cx);
                }
                self.read_only = next;
                self.caches.doc_deco_key = None;
                self.caches.reveal_deco_key = None;
            }
        }
        for eff in tr.effects::<SetAppearance>() {
            if self.dark != eff.dark {
                self.dark = eff.dark;
            }
        }
        for eff in tr.effects::<SetChromeInset>() {
            if self.chrome_inset != eff.0 {
                self.chrome_inset = eff.0;
            }
        }

        // TA-07: read-only is a transaction filter that strips document edits
        // while preserving selection updates and view/configuration effects!
        if self.read_only
            && !tr.is_annotation(Annotation::EXTERNAL)
            && !tr.is_annotation(SYNC_COMPANION_ANNOTATION)
        {
            tr.changes = ChangeSet::default();
        }
        self.extensions
            .filter_transaction(&mut tr, &self.state, self.read_only);

        let scroll = tr.scroll_into_view && (!tr.changes.is_empty() || tr.selection.is_some());
        let event = tr.event;
        let is_external = tr.is_annotation(Annotation::EXTERNAL);
        let is_compose = tr.is_annotation(Annotation::INPUT_COMPOSE);
        let effects = tr.effects.clone();
        let applied = self.state.apply(tr);
        if let Some(ref applied) = applied {
            self.extensions.prepare_applied(applied, &self.state);
        }

        // The caret stays where the input method put it while it composes.
        if !self.history.composing()
            && let Some(selection) = self.extensions.normalize_selection(&self.state)
        {
            self.state.selection = selection;
        }

        let ext_changed = self.extensions.apply_effects_and_fields(
            applied.as_ref(),
            &effects,
            &self.state,
            self.read_only,
        );
        if ext_changed {
            self.caches.doc_deco_key = None;
            self.caches.reveal_deco_key = None;
        }

        let doc_modified = applied.is_some();
        match applied {
            Some(applied) => {
                self.history.record(&applied, &self.state, Instant::now());
                let focused = self.focused_before;
                self.extensions.applied(&applied, &self.state, focused);
                if !is_external && !is_compose {
                    cx.emit(EditorEvent::Changed(event));
                }
            }
            None => {
                let (focused, selecting) = (self.focused_before, self.pointer.drag.is_some());
                self.extensions
                    .selection_changed(&self.state, focused, selecting);
            }
        }
        self.pointer.reveal_caret |= scroll;
        self.blink.epoch = Instant::now();
        cx.notify();
        doc_modified
    }

    pub fn undo(&mut self, redo: bool, cx: &mut Context<Self>) {
        // Undo during a composition belongs to nobody: the input method owns
        // the marked text until it commits (`TA-16`).
        if self.read_only || self.composing() {
            return;
        }
        if self.extensions.owns_history() {
            self.extensions.history(redo);
            cx.notify();
            return;
        }
        if let Some((ticket, tr)) = self.history.begin_step(redo) {
            let applied = self.dispatch_inner(tr, cx);
            self.history.finish_step(ticket, applied);
        }
    }

    /// A companion view shares this document history while the page can be in
    /// reading mode (`TA-70`): dispatches with `"sync.companion"` without ever
    /// mutating `self.read_only`.
    pub(crate) fn replay_history(&mut self, redo: bool, cx: &mut Context<Self>) {
        if self.composing() {
            return;
        }
        if let Some((ticket, tr)) = self.history.begin_step(redo) {
            let tr = tr.with_annotation(SYNC_COMPANION_ANNOTATION);
            let applied = self.dispatch_inner(tr, cx);
            self.history.finish_step(ticket, applied);
        }
    }

    /// See `chrome_inset` (`TA-21`).
    pub fn set_chrome_inset(&mut self, top: f32, cx: &mut Context<Self>) {
        if self.chrome_inset != top {
            self.dispatch(config_transaction(SetChromeInset(top)), cx);
        }
    }

    /// How far the document is scrolled from its top.
    pub fn scroll_top(&self) -> f32 {
        self.scroll_y
    }

    /// Synchronise Document Layer and Reveal Layer decorations (`TA-11`).
    pub(super) fn sync_decorations(&mut self, focused: bool) {
        if focused != self.focused_before {
            self.focused_before = focused;
            self.extensions
                .selection_changed(&self.state, focused, self.pointer.drag.is_some());
        }
        let s = self.state.selection;
        let inset_bits = self.chrome_inset.to_bits();

        if self.extensions.supports_layered_decorations() {
            let doc_key = DocDecoKey {
                revision: self.state.revision,
                dark: self.dark,
                extension: self.extensions.document_decoration_key(),
                chrome_inset: inset_bits,
            };
            if self.caches.doc_deco_key != Some(doc_key) {
                let raw = self.extensions.decorate_document(&self.state, self.dark);
                let doc_layer = if self.chrome_inset != 0. {
                    let mut adjusted = (*raw).clone();
                    adjusted.surface.content.top += self.chrome_inset;
                    Rc::new(adjusted)
                } else {
                    raw
                };
                // Evict transient widget state for unmounted blocks (`TA-14`).
                {
                    let mut store = self.caches.widget_states.borrow_mut();
                    if !store.is_empty() {
                        let live: HashSet<BlockId> = doc_layer
                            .blocks
                            .iter()
                            .filter_map(|b| match b {
                                super::decoration::Block::Widget { id, .. } => Some(*id),
                                _ => None,
                            })
                            .collect();
                        store.retain_live(&live);
                    }
                }
                self.caches.doc_layer = doc_layer;
                self.caches.doc_deco_key = Some(doc_key);
                self.caches.reveal_deco_key = None;
                self.caches.doc_layer_rebuilds += 1;
            }

            let reveal_key = RevealDecoKey {
                revision: self.state.revision,
                selection: (s.anchor, s.head),
                focused,
                selecting: self.pointer.drag.is_some(),
                reveal: self.extensions.reveal_decoration_key(),
                legacy_dark: self.dark,
                legacy_ext: doc_key.extension,
                legacy_inset: inset_bits,
            };
            if self.caches.reveal_deco_key != Some(reveal_key) {
                let input = DecorateInput {
                    state: &self.state,
                    focused,
                    pointer_selecting: self.pointer.drag.is_some(),
                    dark: self.dark,
                };
                let reveal = self
                    .extensions
                    .decorate_reveal(&input, &self.caches.doc_layer);
                self.caches.decorations =
                    LayeredDecorations::new(self.caches.doc_layer.clone(), reveal);
                self.caches.reveal_deco_key = Some(reveal_key);
            }
        } else {
            let legacy_ext = self.extensions.document_decoration_key();
            let reveal_key = RevealDecoKey {
                revision: self.state.revision,
                selection: (s.anchor, s.head),
                focused,
                selecting: self.pointer.drag.is_some(),
                reveal: 0,
                legacy_dark: self.dark,
                legacy_ext,
                legacy_inset: inset_bits,
            };
            if self.caches.reveal_deco_key != Some(reveal_key) {
                let input = DecorateInput {
                    state: &self.state,
                    focused,
                    pointer_selecting: self.pointer.drag.is_some(),
                    dark: self.dark,
                };
                let mut decorations = self.extensions.decorate_legacy(&input);
                decorations.surface.content.top += self.chrome_inset;
                let rc = Rc::new(decorations);
                self.caches.doc_layer = rc.clone();
                self.caches.decorations = LayeredDecorations::new(rc, Rc::default());
                self.caches.reveal_deco_key = Some(reveal_key);
                self.caches.doc_layer_rebuilds += 1;
            }
        }
    }

    /// The document as of this revision, shared with the frame being built.
    pub(super) fn doc_snapshot(&mut self) -> Rc<Buffer> {
        match &self.caches.doc_snapshot {
            Some((revision, doc))
                if *revision == self.state.revision && doc.len() == self.state.doc.len() =>
            {
                doc.clone()
            }
            _ => {
                let doc = Rc::new(self.state.doc.clone());
                self.caches.doc_snapshot = Some((self.state.revision, doc.clone()));
                doc
            }
        }
    }

    /// Kit's rendering context: link and inline-code colours of the surface.
    /// Kept while the surface is unchanged so Kit's paragraph caches hold.
    pub(super) fn kit_context(&mut self) -> Rc<RenderContext> {
        let surface = self.caches.decorations.surface();
        if let Some((s, kit)) = &self.caches.kit
            && s == surface
        {
            return kit.clone();
        }
        let transparent: Hsla = transparent_black();
        let mut style = TextViewStyle::default()
            .with_dark(self.dark)
            .with_link(surface.link.into())
            .with_link_underline(!surface.link_plain)
            .with_code_background(transparent)
            .with_inline_code(HighlightStyle {
                color: surface.inline_code.map(Into::into),
                background_color: Some(
                    surface
                        .inline_code_background
                        .map_or(transparent, Into::into),
                ),
                ..Default::default()
            })
            .with_selection(surface.selection.into())
            .with_paragraph_gap(rems(0.));
        if let Some(padding) = surface.inline_code_padding {
            style = style.with_inline_code_padding(padding);
        }
        let kit = Rc::new(RenderContext::new(style));
        self.caches.kit = Some((surface.clone(), kit.clone()));
        kit
    }

    /// A widget control, format action, or hotspot ran a command. Commits any
    /// open IME composition BEFORE invoking the extension command (`TA-16`,
    /// `TODO-92`).
    pub fn run_command(
        &mut self,
        command: &super::command::Command,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.focus.focus(window, cx);
        self.commit_composition(cx);
        if let Some(tr) = self.extensions.command(command, &self.state) {
            self.dispatch(tr, cx);
        }
    }

    pub(super) fn ensure_blink(&mut self, focused: bool, cx: &mut Context<Self>) {
        if !focused {
            self.blink.task = None;
            return;
        }
        if self.blink.task.is_none() {
            self.blink.task = Some(cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor().timer(BLINK).await;
                    if this.update(cx, |_, cx| cx.notify()).is_err() {
                        break;
                    }
                }
            }));
        }
    }

    pub(super) fn caret_visible(&self) -> bool {
        (self.blink.epoch.elapsed().as_millis() / BLINK.as_millis()).is_multiple_of(2)
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
        self.dispatch(
            Transaction::edit(
                ChangeSet::replace(range, text),
                Some(Selection::cursor(caret)),
                event,
            ),
            cx,
        );
    }

    pub fn dark(&self) -> bool {
        self.dark
    }

    pub fn surface(&self) -> &super::decoration::Surface {
        self.caches.decorations.surface()
    }

    pub fn layout(&self) -> Option<&Rc<DocLayout>> {
        self.caches.layout.as_ref()
    }

    #[cfg(test)]
    pub fn replace_extension_for_tests(
        &mut self,
        extension: Box<dyn EditorExtension>,
        cx: &mut Context<Self>,
    ) {
        self.extensions = ExtensionSet::single(extension);
        self.extensions
            .add_plugin(Box::new(super::plugins::FindPlugin::default()), cx);
        self.extensions.ensure_keymaps_registered(cx);
        self.caches.doc_deco_key = None;
        self.caches.reveal_deco_key = None;
        cx.notify();
    }

    #[cfg(test)]
    pub fn decorations(&self) -> Cow<'_, Decorations> {
        self.caches.decorations.as_decorations()
    }

    #[cfg(test)]
    pub fn doc_layer_rebuilds(&self) -> u64 {
        self.caches.doc_layer_rebuilds
    }

    #[cfg(test)]
    pub fn height_map_stats(&self) -> (u64, u64) {
        self.caches.heights.borrow().stats()
    }

    #[cfg(test)]
    pub fn paragraph_cache_stats(&self) -> (u64, u64) {
        let c = self.caches.paragraph_cache.borrow();
        (c.hits, c.misses)
    }

    #[cfg(test)]
    pub fn last_undo_weight(&self) -> Option<usize> {
        self.history.last_undo_weight()
    }
}
