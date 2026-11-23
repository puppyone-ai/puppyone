//! Live-preview state of one pane (product `core/state/`):
//! - Core reveal state: inline source reveal (`reveal.rs`), explicit block
//!   revealed source (`revealed_source.rs`), pointer-drag freeze (`pointer.rs`),
//!   block-prefix composing line (`composing.rs`), hidden-marker selection
//!   normalization (`selection.rs`).
//! - Typed per-feature state slots (`store.rs`, `TA-40`), mapped via
//!   `ChangeSet` across transactions (including undo/redo via `TA-06`) and
//!   hashed into the Document Layer decoration key.
pub mod composing;
pub mod pointer;
pub mod reveal;
pub mod revealed_source;
pub mod selection;
pub mod store;

pub use composing::list_input_prefix;
pub use store::{FeatureStateSlot, FeatureStateStore, FeatureStateValue};

use super::syntax::Syntax;
use crate::editor::text::{
    buffer::Buffer,
    selection::Selection,
    state::{Applied, EditorState},
};
use std::{
    hash::{DefaultHasher, Hash, Hasher},
    ops::Range,
};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PreviewState {
    /// `inlineRevealRange`: the inline element whose markers show as source.
    pub reveal: Option<Range<usize>>,
    /// Start of the line kept as source while its prefix is typed.
    pub composing: Option<usize>,
    /// A pointer selection is in progress (line boxes stay as they are).
    pub selecting: bool,
    focused: bool,
    /// Opening line of a blockquote holding the focused editable caret: features
    /// decorating quote headers (e.g. callouts) reveal raw markers on this line.
    pub reveal_line: Option<usize>,
    /// `markdownRevealedSourceField` (block presentation): a rich block a
    /// widget asked to show as source, while the caret stays inside it.
    pub revealed_source: Option<Range<usize>>,
    /// Per-feature state slots (`TA-40`: callout folds, mermaid diagram views,
    /// MDX active tabs, etc.).
    pub features: FeatureStateStore,
}

impl PreviewState {
    /// Document-layer projection (`TA-11`): carries ONLY per-feature state
    /// (`callout` folds, `mermaid` views, `mdx` tabs) and zero cursor/focus/IME
    /// reveal state.
    pub fn document_only(features: FeatureStateStore) -> Self {
        Self {
            features,
            ..Self::default()
        }
    }

    pub fn state<T: 'static>(&self, feature_id: &'static str) -> Option<&T> {
        self.features.get::<T>(feature_id)
    }

    pub fn state_mut<T: FeatureStateValue>(&mut self, feature_id: &'static str) -> &mut T {
        self.features.get_or_default_mut::<T>(feature_id)
    }

    /// Hash key of reveal-only fields (`TA-11` Reveal Layer).
    pub fn reveal_key(&self) -> u64 {
        let mut h = DefaultHasher::new();
        (
            self.reveal.as_ref().map(|r| (r.start, r.end)),
            self.composing,
            self.selecting,
            self.focused,
            self.reveal_line,
            self.revealed_source.as_ref().map(|r| (r.start, r.end)),
        )
            .hash(&mut h);
        h.finish()
    }

    /// True when any reveal/composing/reveal-line/revealed-source override is active.
    pub fn has_reveal_overrides(&self) -> bool {
        self.reveal.is_some()
            || self.composing.is_some()
            || self.reveal_line.is_some()
            || self.revealed_source.is_some()
    }

    /// Whether `line` shows as source because its block was revealed.
    pub fn revealed_line(&self, line: &Range<usize>) -> bool {
        revealed_source::revealed_line(&self.revealed_source, line)
    }

    /// A transaction changed the document (`applied` from the view, including
    /// `undo` and `redo` via `TA-06`).
    pub fn applied(
        &mut self,
        applied: &Applied,
        state: &EditorState,
        syntax: &Syntax,
        focused: bool,
        read_only: bool,
    ) {
        self.features
            .map(&applied.changes, &state.doc, state.revision);
        self.revealed_source =
            revealed_source::after_applied(self.revealed_source.take(), applied, state);
        self.selecting = false;
        self.composing = composing::after_applied(self.composing, applied, state, focused);
        self.reveal = reveal::after_applied(
            self.reveal.as_ref(),
            applied,
            state,
            syntax,
            focused,
            read_only,
        );
        self.focused = focused;
        self.reveal_line = reveal::reveal_line_at(state, syntax, focused, read_only);
    }

    /// Selection or focus changed without a document change.
    pub fn selection_changed(
        &mut self,
        state: &EditorState,
        syntax: &Syntax,
        focused: bool,
        selecting: bool,
        read_only: bool,
    ) {
        let transition = pointer::transition(self.focused, self.selecting, focused, selecting);
        self.selecting = selecting;
        self.focused = focused;
        self.reveal_line = reveal::reveal_line_at(state, syntax, focused, read_only);
        self.revealed_source = revealed_source::settle(
            self.revealed_source.take(),
            state,
            selecting || !state.selection.is_empty(),
        );
        self.composing = composing::after_selection(self.composing, state, focused);
        if pointer::should_freeze_reveal(transition, state.selection.is_empty(), focused, selecting)
        {
            return;
        }
        self.reveal = reveal::reveal_at(state, syntax, read_only);
    }

    /// `markdownHiddenMarkerSelectionNormalizer`: keep a caret off hidden
    /// block markers (one caret position per visual position).
    pub fn normalize(
        &self,
        doc: &Buffer,
        syntax: &Syntax,
        selection: Selection,
    ) -> Option<Selection> {
        selection::normalize(
            doc,
            syntax,
            selection,
            self.composing,
            &self.revealed_source,
        )
    }
}
