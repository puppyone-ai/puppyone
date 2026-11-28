//! Multi-extension composition and facets between the generic view and document
//! formats (`TA-10`, `TA-11`, `TA-12`, `TA-20`, `TA-21`):
//! - Generic editing intents only (`EditIntent` carries zero format vocabulary).
//! - Extensions contribute state fields, two-layer pure `&self` decoration
//!   providers, keymaps & action bindings, transaction filters, and view
//!   plugins.
//! - Configuration updates flow as typed [`StateEffect`] transactions rather
//!   than host downcasting or manual generation counters.
use super::{
    command::Command,
    decoration::{Block, Decorations, RevealLayer},
    editor::EditorView,
    plugins::{ConflictBannerPlugin, FindPlugin, ViewPlugin},
    style::LineStyle,
};
use crate::{
    editor::text::{
        selection::Selection,
        state::{Annotation, Applied, EditorState, StateEffect, Transaction},
    },
    typography::Scale,
};
use gpui::{App, Context, Div, Global};
use std::{
    any::{Any, TypeId},
    collections::HashSet,
    hash::{Hash, Hasher},
    rc::Rc,
};

/// Typed configuration [`StateEffect`] setting editor read-only state (`TA-21`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SetReadOnly(pub bool);

/// Typed configuration [`StateEffect`] updating theme appearance and typography
/// scale (`TA-21`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SetAppearance {
    pub dark: bool,
    pub scale: Scale,
}

/// Typed configuration [`StateEffect`] updating top floating-chrome inset
/// (`TA-21`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SetChromeInset(pub f32);

/// Build a pure configuration transaction carrying `effect` (`TA-05`, `TA-21`).
pub fn config_transaction<T: Send + Sync + 'static>(effect: T) -> Transaction {
    Transaction {
        changes: Default::default(),
        selection: None,
        event: crate::editor::text::state::UserEvent::Select,
        scroll_into_view: false,
        annotations: vec![Annotation::tag(Annotation::CONFIG)],
        effects: vec![StateEffect::new(effect)],
    }
}

/// Inputs passed to the Reveal Layer (and legacy single-layer `decorate`).
pub struct DecorateInput<'a> {
    pub state: &'a EditorState,
    pub focused: bool,
    /// A pointer drag is in progress (keeps line boxes stable, like the product).
    pub pointer_selecting: bool,
    pub dark: bool,
}

/// Generic editing intents a format may intercept (`TA-10`: no format-specific
/// actions or vocabulary live in `editor::view`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditIntent {
    Enter,
    SoftEnter,
    Tab,
    BackTab,
    Backspace,
    Delete,
    Escape,
    /// ← with a collapsed caret (before the default motion).
    CharLeft,
    /// Home / ⌘← (before the default motion).
    LineStart,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LinkAction {
    Workspace(Vec<String>),
    External(String),
    Position(usize),
}

#[derive(Clone, Debug, PartialEq)]
pub struct LinkActivation {
    pub label: std::ops::Range<usize>,
    /// Syntax and authored target identify a gesture, not its current resolution.
    pub key: String,
    pub action: LinkAction,
}

/// Extension-contributed state field facet (`TA-20`), updated on transactions
/// and configuration effects.
pub trait StateFieldFacet: Any {
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
    fn update(&mut self, applied: Option<&Applied>, effects: &[StateEffect], state: &EditorState);
    fn state_key(&self) -> u64 {
        0
    }
}

/// Extension-contributed transaction filter (`TA-07`, `TA-20`).
pub type TransactionFilter = Box<dyn Fn(&mut Transaction, &EditorState, bool)>;

pub trait EditorExtension: Any {
    /// Optional GPUI key context contributed by this extension (e.g.
    /// `"MarkdownEditor"`).
    fn key_context(&self) -> Option<&'static str> {
        None
    }

    /// Register this extension's keybindings into `cx` (invoked idempotently per
    /// `App`).
    fn register_keymap(&self, _cx: &mut App) {}

    /// Attach extension action listeners to the editor's root element.
    fn bind_actions(&self, root: Div, _cx: &mut Context<EditorView>) -> Div {
        root
    }

    /// Install view plugins or add-ons owned by this extension (`TA-20`, `TA-60`).
    fn install_plugins(&mut self, _plugins: &mut Vec<Box<dyn ViewPlugin>>) {}

    /// Transaction filter hook (`TA-07`, `TA-20`).
    fn filter_transaction(&self, _tr: &mut Transaction, _state: &EditorState, _read_only: bool) {}

    /// Apply configuration [`StateEffect`]s (`TA-21`). Returns `true` when any
    /// state affecting decorations or presentation changed.
    fn apply_effects(
        &mut self,
        _effects: &[StateEffect],
        _state: &EditorState,
        _read_only: bool,
    ) -> bool {
        false
    }

    /// The format owns recognition, edit/reveal policy and target resolution.
    /// Release may hit the label that the pointer selection just revealed.
    fn link_at(
        &mut self,
        _state: &EditorState,
        _offset: usize,
        _release: bool,
    ) -> Option<LinkActivation> {
        None
    }

    /// Where a link a widget carries leads (a linked image's href).
    fn link_target(&mut self, _state: &EditorState, _href: &str) -> Option<LinkAction> {
        None
    }

    /// Whether this extension implements pure `&self` two-layer decorations
    /// (`decorate_document` + `decorate_reveal`, `TA-11`, `TA-12`).
    fn supports_layered_decorations(&self) -> bool {
        false
    }

    /// Cache key for the Document Layer (`TA-11`): depends ONLY on extension
    /// configuration and document-level feature state, NEVER on cursor/focus.
    fn document_decoration_key(&self) -> u64 {
        self.decoration_key()
    }

    /// Cache key for the Reveal Layer (`TA-11`): captures reveal/IME/transient
    /// overrides near the selection.
    fn reveal_decoration_key(&self) -> u64 {
        0
    }

    /// Pure `&self` Document Layer decoration provider (`TA-11`, `TA-12`).
    fn decorate_document(&self, _state: &EditorState, _dark: bool) -> Rc<Decorations> {
        Rc::default()
    }

    /// Pure `&self` Reveal Layer decoration provider (`TA-11`, `TA-12`).
    fn decorate_reveal(&self, _input: &DecorateInput, _doc_layer: &Decorations) -> Rc<RevealLayer> {
        Rc::default()
    }

    /// Legacy single-layer decoration provider kept with a default
    /// implementation so untouched callers (such as CSV `CellText`) continue to
    /// compile cleanly.
    fn decorate(&mut self, input: &DecorateInput) -> Decorations {
        let doc = self.decorate_document(input.state, input.dark);
        (*doc).clone()
    }

    /// Cheap key; legacy single-layer decorations rebuild when it changes.
    fn decoration_key(&self) -> u64 {
        0
    }

    fn intercept(&mut self, _intent: EditIntent, _state: &EditorState) -> Option<Transaction> {
        None
    }

    /// A widget control, format shortcut, or hotspot ran a command.
    fn command(&mut self, _command: &Command, _state: &EditorState) -> Option<Transaction> {
        None
    }

    /// Runs immediately after `state.apply(tr)` (before `normalize_selection`)
    /// so incremental syntax/plan extensions can splice over `applied.changes`
    /// once per transaction (`TA-31`, `TA-32`).
    fn prepare_applied(&mut self, _applied: &Applied, _state: &EditorState) {}

    /// Called after every applied document-modifying transaction.
    fn applied(&mut self, _applied: &Applied, _state: &EditorState, _focused: bool) {}

    /// Selection-only changes and focus changes.
    fn selection_changed(
        &mut self,
        _state: &EditorState,
        _focused: bool,
        _pointer_selecting: bool,
    ) {
    }

    /// The document's history lives outside this view (a CSV cell edits the
    /// table model): undo / redo are handed to `history` instead.
    fn owns_history(&self) -> bool {
        false
    }

    fn history(&mut self, _redo: bool) {}

    /// Adjust a selection after a transaction (CodeMirror transaction
    /// filter), e.g. keep the caret off hidden block markers.
    fn normalize_selection(&mut self, _state: &EditorState) -> Option<Selection> {
        None
    }
}

#[derive(Default)]
struct RegisteredKeymaps {
    types: HashSet<TypeId>,
    core_bound: bool,
}
impl Global for RegisteredKeymaps {}

pub(super) fn mark_core_keys_bound(cx: &mut App) -> bool {
    let g = cx.default_global::<RegisteredKeymaps>();
    let was = g.core_bound;
    g.core_bound = true;
    !was
}

/// Composed set of editor extensions, state fields, transaction filters, and
/// view plugins (`TA-20`).
#[derive(Default)]
pub struct ExtensionSet {
    extensions: Vec<Box<dyn EditorExtension>>,
    state_fields: Vec<Box<dyn StateFieldFacet>>,
    filters: Vec<TransactionFilter>,
    pub(super) plugins: Vec<Box<dyn ViewPlugin>>,
}

impl ExtensionSet {
    pub fn with_core_plugins() -> Self {
        let mut set = Self::default();
        set.plugins.push(Box::new(FindPlugin::default()));
        set.plugins.push(Box::new(ConflictBannerPlugin::default()));
        set
    }

    pub fn single(mut extension: Box<dyn EditorExtension>) -> Self {
        let mut set = Self::with_core_plugins();
        extension.install_plugins(&mut set.plugins);
        set.extensions.push(extension);
        set
    }

    pub fn add_extension(&mut self, mut extension: Box<dyn EditorExtension>, cx: &mut App) {
        extension.install_plugins(&mut self.plugins);
        self.extensions.push(extension);
        self.ensure_keymaps_registered(cx);
    }

    pub fn add_plugin(&mut self, plugin: Box<dyn ViewPlugin>, cx: &mut App) {
        self.plugins.push(plugin);
        self.ensure_keymaps_registered(cx);
    }

    pub fn add_state_field(&mut self, field: Box<dyn StateFieldFacet>) {
        self.state_fields.push(field);
    }

    pub fn add_transaction_filter(&mut self, filter: TransactionFilter) {
        self.filters.push(filter);
    }

    pub fn ensure_keymaps_registered(&self, cx: &mut App) {
        super::bind_keys(cx);
        for ext in &self.extensions {
            let ty = (*ext).as_ref().type_id();
            let is_new = cx.default_global::<RegisteredKeymaps>().types.insert(ty);
            if is_new {
                ext.register_keymap(cx);
            }
        }
        for plugin in &self.plugins {
            let ty = plugin.as_any().type_id();
            let is_new = cx.default_global::<RegisteredKeymaps>().types.insert(ty);
            if is_new {
                plugin.register_keymap(cx);
            }
        }
    }

    pub fn extension<T: 'static>(&self) -> Option<&T> {
        self.extensions
            .iter()
            .find_map(|e| (e.as_ref() as &dyn Any).downcast_ref::<T>())
    }

    pub fn extension_mut<T: 'static>(&mut self) -> Option<&mut T> {
        self.extensions
            .iter_mut()
            .find_map(|e| (e.as_mut() as &mut dyn Any).downcast_mut::<T>())
    }

    pub fn plugin<P: 'static>(&self) -> Option<&P> {
        self.plugins
            .iter()
            .find_map(|p| p.as_any().downcast_ref::<P>())
    }

    pub fn plugin_mut<P: 'static>(&mut self) -> Option<&mut P> {
        self.plugins
            .iter_mut()
            .find_map(|p| p.as_any_mut().downcast_mut::<P>())
    }

    pub fn state_field<F: 'static>(&self) -> Option<&F> {
        self.state_fields
            .iter()
            .find_map(|f| f.as_any().downcast_ref::<F>())
    }

    pub fn state_field_mut<F: 'static>(&mut self) -> Option<&mut F> {
        self.state_fields
            .iter_mut()
            .find_map(|f| f.as_any_mut().downcast_mut::<F>())
    }

    pub fn key_contexts(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        for ext in &self.extensions {
            if let Some(ctx) = ext.key_context()
                && !out.contains(&ctx)
            {
                out.push(ctx);
            }
        }
        for plugin in &self.plugins {
            if let Some(ctx) = plugin.key_context()
                && !out.contains(&ctx)
            {
                out.push(ctx);
            }
        }
        out
    }

    pub fn bind_actions(&self, mut root: Div, cx: &mut Context<EditorView>) -> Div {
        for ext in &self.extensions {
            root = ext.bind_actions(root, cx);
        }
        for plugin in &self.plugins {
            root = plugin.bind_actions(root, cx);
        }
        root
    }

    pub fn filter_transaction(&self, tr: &mut Transaction, state: &EditorState, read_only: bool) {
        for filter in &self.filters {
            filter(tr, state, read_only);
        }
        for ext in &self.extensions {
            ext.filter_transaction(tr, state, read_only);
        }
    }

    pub fn apply_effects_and_fields(
        &mut self,
        applied: Option<&Applied>,
        effects: &[StateEffect],
        state: &EditorState,
        read_only: bool,
    ) -> bool {
        let mut changed = false;
        for field in &mut self.state_fields {
            field.update(applied, effects, state);
        }
        if !effects.is_empty() {
            for ext in &mut self.extensions {
                changed |= ext.apply_effects(effects, state, read_only);
            }
        }
        changed
    }

    pub fn supports_layered_decorations(&self) -> bool {
        !self.extensions.is_empty()
            && self
                .extensions
                .iter()
                .all(|e| e.supports_layered_decorations())
    }

    pub fn document_decoration_key(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        for ext in &self.extensions {
            ext.document_decoration_key().hash(&mut h);
        }
        for field in &self.state_fields {
            field.state_key().hash(&mut h);
        }
        h.finish()
    }

    pub fn reveal_decoration_key(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        for ext in &self.extensions {
            ext.reveal_decoration_key().hash(&mut h);
        }
        h.finish()
    }

    pub fn decorate_document(&self, state: &EditorState, dark: bool) -> Rc<Decorations> {
        match self.extensions.as_slice() {
            [] => Rc::default(),
            [single] => single.decorate_document(state, dark),
            many => {
                let mut merged = (*many[0].decorate_document(state, dark)).clone();
                merged.materialize();
                merged.splice = None;
                for extra in &many[1..] {
                    let other_rc = extra.decorate_document(state, dark);
                    let other_cow = if other_rc.has_deferred_shift() {
                        let mut owned = (*other_rc).clone();
                        owned.materialize();
                        std::borrow::Cow::Owned(owned)
                    } else {
                        std::borrow::Cow::Borrowed(&*other_rc)
                    };
                    let other = other_cow.as_ref();
                    merged.marks.extend(other.marks.iter().cloned());
                    merged.hidden.extend(other.hidden.iter().cloned());
                    merged.atomic.extend(other.atomic.iter().cloned());
                    merged
                        .inline_widgets
                        .extend(other.inline_widgets.iter().cloned());
                    merged.underlines.extend(other.underlines.iter().cloned());
                }
                merged.marks.sort_by_key(|m| (m.range.start, m.range.end));
                merged.hidden.sort_by_key(|r| (r.start, r.end));
                merged.atomic.sort_by_key(|r| (r.start, r.end));
                merged
                    .inline_widgets
                    .sort_by_key(|w| (w.range.start, w.range.end));
                merged
                    .underlines
                    .sort_by_key(|u| (u.range.start, u.range.end));
                Rc::new(merged)
            }
        }
    }

    pub fn decorate_reveal(
        &self,
        input: &DecorateInput,
        doc_layer: &Decorations,
    ) -> Rc<RevealLayer> {
        match self.extensions.as_slice() {
            [] => Rc::default(),
            [single] => single.decorate_reveal(input, doc_layer),
            many => {
                let mut patches = Vec::new();
                for ext in many {
                    let layer = ext.decorate_reveal(input, doc_layer);
                    patches.extend(layer.patches.iter().cloned());
                }
                patches.sort_by_key(|p| (p.lines.start, p.lines.end));
                Rc::new(RevealLayer { patches })
            }
        }
    }

    pub fn decorate_legacy(&mut self, input: &DecorateInput) -> Decorations {
        let Some(first) = self.extensions.first_mut() else {
            return Decorations::default();
        };
        first.decorate(input)
    }

    pub fn intercept(&mut self, intent: EditIntent, state: &EditorState) -> Option<Transaction> {
        for ext in &mut self.extensions {
            if let Some(tr) = ext.intercept(intent, state) {
                return Some(tr);
            }
        }
        None
    }

    pub fn command(&mut self, command: &Command, state: &EditorState) -> Option<Transaction> {
        for ext in &mut self.extensions {
            if let Some(tr) = ext.command(command, state) {
                return Some(tr);
            }
        }
        None
    }

    pub fn prepare_applied(&mut self, applied: &Applied, state: &EditorState) {
        for ext in &mut self.extensions {
            ext.prepare_applied(applied, state);
        }
    }

    pub fn applied(&mut self, applied: &Applied, state: &EditorState, focused: bool) {
        for ext in &mut self.extensions {
            ext.applied(applied, state, focused);
        }
        for plugin in &mut self.plugins {
            plugin.on_applied(applied, state);
        }
    }

    pub fn selection_changed(
        &mut self,
        state: &EditorState,
        focused: bool,
        pointer_selecting: bool,
    ) {
        for ext in &mut self.extensions {
            ext.selection_changed(state, focused, pointer_selecting);
        }
        for plugin in &mut self.plugins {
            plugin.on_selection_changed(state, focused, pointer_selecting);
        }
    }

    pub fn owns_history(&self) -> bool {
        self.extensions.iter().any(|e| e.owns_history())
    }

    pub fn history(&mut self, redo: bool) {
        for ext in &mut self.extensions {
            if ext.owns_history() {
                ext.history(redo);
                return;
            }
        }
    }

    pub fn normalize_selection(&mut self, state: &EditorState) -> Option<Selection> {
        for ext in &mut self.extensions {
            if let Some(sel) = ext.normalize_selection(state) {
                return Some(sel);
            }
        }
        None
    }

    pub fn link_at(
        &mut self,
        state: &EditorState,
        offset: usize,
        release: bool,
    ) -> Option<LinkActivation> {
        for ext in &mut self.extensions {
            if let Some(link) = ext.link_at(state, offset, release) {
                return Some(link);
            }
        }
        None
    }

    pub fn link_target(&mut self, state: &EditorState, href: &str) -> Option<LinkAction> {
        for ext in &mut self.extensions {
            if let Some(action) = ext.link_target(state, href) {
                return Some(action);
            }
        }
        None
    }
}

/// Plain text: one style for every line, no syntax. Supports pure `&self`
/// two-layer decorations (`TA-11`).
pub struct PlainText {
    pub line: Rc<LineStyle>,
    pub decorations: Decorations,
}

impl EditorExtension for PlainText {
    fn supports_layered_decorations(&self) -> bool {
        true
    }

    fn decorate_document(&self, state: &EditorState, _dark: bool) -> Rc<Decorations> {
        let mut d = self.decorations.clone();
        d.blocks = (0..state.doc.line_count())
            .map(|line| Block::Line {
                line,
                style: self.line.clone(),
            })
            .collect();
        Rc::new(d)
    }

    fn decorate_reveal(&self, _input: &DecorateInput, _doc_layer: &Decorations) -> Rc<RevealLayer> {
        Rc::default()
    }

    fn decorate(&mut self, input: &DecorateInput) -> Decorations {
        (*self.decorate_document(input.state, input.dark)).clone()
    }
}
