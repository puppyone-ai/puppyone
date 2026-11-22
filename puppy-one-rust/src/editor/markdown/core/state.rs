//! Live-preview state of one pane (product `core/state`):
//! - Core reveal state: the inline source fragment revealed at the caret
//!   (`livePreviewReveal.ts`), the line whose block prefix is being typed
//!   (`composingBlockLine.ts`), the pointer-drag freeze (`pointerSelection.ts`),
//!   callout title reveal, and `revealed_source`.
//! - Typed per-feature state slots (`TA-40`): callout folds, diagram zoom &
//!   deferred activation, and MDX active tabs live in [`FeatureStateStore`],
//!   owned by their respective features, mapped via [`ChangeSet`]/`Anchor`
//!   across every transaction (including undo/redo via `TA-06`), and hashed
//!   into the Document Layer decoration key.
use super::syntax::Syntax;
use crate::editor::text::{
    buffer::Buffer,
    change::{Assoc, ChangeSet},
    selection::Selection,
    state::{Applied, EditorState, UserEvent},
};
use std::{
    any::Any,
    collections::BTreeMap,
    fmt,
    hash::{DefaultHasher, Hash, Hasher},
    ops::Range,
};

/// Plain view-state value of a rendered diagram (`mermaid/widget.rs` reads it).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct DiagramView {
    /// The zoom chosen here, in percent; `None` keeps the fitted default.
    pub zoom: Option<u16>,
    /// A deferred diagram the person asked to render.
    pub activated: bool,
}

/// Trait implemented by per-feature pane state values (`TA-40`).
pub trait FeatureStateValue: Clone + fmt::Debug + PartialEq + Hash + Default + 'static {
    fn map_changes(&mut self, changes: &ChangeSet, doc: &Buffer, new_revision: u64);
}

pub trait FeatureStateSlot: Any {
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
    fn clone_box(&self) -> Box<dyn FeatureStateSlot>;
    fn eq_slot(&self, other: &dyn FeatureStateSlot) -> bool;
    fn hash_slot(&self, state: &mut DefaultHasher);
    fn fmt_debug(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result;
    fn map_changes(&mut self, changes: &ChangeSet, doc: &Buffer, new_revision: u64);
}

impl<T: FeatureStateValue> FeatureStateSlot for T {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    fn clone_box(&self) -> Box<dyn FeatureStateSlot> {
        Box::new(self.clone())
    }

    fn eq_slot(&self, other: &dyn FeatureStateSlot) -> bool {
        other.as_any().downcast_ref::<T>() == Some(self)
    }

    fn hash_slot(&self, state: &mut DefaultHasher) {
        self.hash(state);
    }

    fn fmt_debug(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(self, f)
    }

    fn map_changes(&mut self, changes: &ChangeSet, doc: &Buffer, new_revision: u64) {
        FeatureStateValue::map_changes(self, changes, doc, new_revision);
    }
}

/// Type-erased store of per-feature state slots (`TA-40`), indexed by feature
/// ID so features own their own fold/tab/zoom state without polluting `core/`.
#[derive(Default)]
pub struct FeatureStateStore {
    slots: BTreeMap<&'static str, Box<dyn FeatureStateSlot>>,
    mapped_revision: Option<u64>,
}

/// Type alias kept for untouched feature unit tests (`video/mod.rs`, `html/mod.rs`)
/// that pass `&CalloutFolds::default()` into `plans::compile`.
pub type CalloutFolds = FeatureStateStore;

impl Clone for FeatureStateStore {
    fn clone(&self) -> Self {
        Self {
            slots: self
                .slots
                .iter()
                .map(|(&k, v)| (k, v.clone_box()))
                .collect(),
            mapped_revision: self.mapped_revision,
        }
    }
}

impl fmt::Debug for FeatureStateStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut map = f.debug_map();
        for (&k, v) in &self.slots {
            struct SlotDebug<'a>(&'a dyn FeatureStateSlot);
            impl fmt::Debug for SlotDebug<'_> {
                fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                    self.0.fmt_debug(f)
                }
            }
            map.entry(&k, &SlotDebug(v.as_ref()));
        }
        map.finish()
    }
}

impl PartialEq for FeatureStateStore {
    fn eq(&self, other: &Self) -> bool {
        self.slots.len() == other.slots.len()
            && self
                .slots
                .iter()
                .all(|(k, v)| other.slots.get(k).is_some_and(|ov| v.eq_slot(ov.as_ref())))
    }
}

impl Eq for FeatureStateStore {}

impl Hash for FeatureStateStore {
    fn hash<H: Hasher>(&self, state: &mut H) {
        let mut inner = DefaultHasher::new();
        self.slots.len().hash(&mut inner);
        for (&k, v) in &self.slots {
            k.hash(&mut inner);
            v.hash_slot(&mut inner);
        }
        inner.finish().hash(state);
    }
}

impl FeatureStateStore {
    pub fn get<T: 'static>(&self, feature_id: &'static str) -> Option<&T> {
        self.slots
            .get(feature_id)
            .and_then(|v| v.as_any().downcast_ref::<T>())
    }

    pub fn get_or_default_mut<T: FeatureStateValue>(&mut self, feature_id: &'static str) -> &mut T {
        self.slots
            .entry(feature_id)
            .or_insert_with(|| Box::new(T::default()))
            .as_any_mut()
            .downcast_mut::<T>()
            .expect("feature state slot type matches feature ID")
    }

    pub fn map(&mut self, changes: &ChangeSet, doc: &Buffer, new_revision: u64) {
        if new_revision > 0 && self.mapped_revision == Some(new_revision) {
            return;
        }
        if new_revision > 0 {
            self.mapped_revision = Some(new_revision);
        }
        for slot in self.slots.values_mut() {
            slot.map_changes(changes, doc, new_revision);
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PreviewState {
    /// `inlineRevealRange`: the inline element whose markers show as source.
    pub reveal: Option<Range<usize>>,
    /// Start of the line kept as source while its prefix is typed.
    pub composing: Option<usize>,
    /// A pointer selection is in progress (line boxes stay as they are).
    pub selecting: bool,
    focused: bool,
    /// The callout title line holding the caret: its marker shows as source.
    pub callout_title: Option<usize>,
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
}

/// `getMarkdownListInputPrefix`:
/// `/^[\t ]*(?:[-*+]|\d{1,9}[.)])(?:[\t ]+(?:\[(?:[ xX](?:\][\t ]*)?)?)?|$)/`.
pub fn list_input_prefix(text: &str) -> Option<usize> {
    let b = text.as_bytes();
    let mut i = b.iter().take_while(|c| matches!(c, b' ' | b'\t')).count();
    match b.get(i) {
        Some(b'-' | b'*' | b'+') => i += 1,
        Some(c) if c.is_ascii_digit() => {
            let digits = b[i..].iter().take_while(|c| c.is_ascii_digit()).count();
            if digits > 9 || !matches!(b.get(i + digits), Some(b'.' | b')')) {
                return None;
            }
            i += digits + 1;
        }
        _ => return None,
    }
    if i == b.len() {
        return Some(i);
    }
    let spaces = b[i..]
        .iter()
        .take_while(|c| matches!(c, b' ' | b'\t'))
        .count();
    if spaces == 0 {
        return None;
    }
    i += spaces;
    if b.get(i) == Some(&b'[') {
        i += 1;
        if matches!(b.get(i), Some(b' ' | b'x' | b'X')) {
            i += 1;
            if b.get(i) == Some(&b']') {
                i += 1;
                i += b[i..]
                    .iter()
                    .take_while(|c| matches!(c, b' ' | b'\t'))
                    .count();
            }
        }
    }
    Some(i)
}

/// The block prefix being typed on a line (`getComposingBlockPrefixRange`).
fn composing_prefix(text: &str) -> Option<usize> {
    if let Some(n) = list_input_prefix(text) {
        return Some(n);
    }
    let b = text.as_bytes();
    let hashes = b.iter().take_while(|&&c| c == b'#').count();
    if (1..=6).contains(&hashes) {
        return Some(hashes + usize::from(b.get(hashes).is_some_and(|c| c.is_ascii_whitespace())));
    }
    let lead = b.iter().take_while(|c| c.is_ascii_whitespace()).count();
    let quotes = b[lead..].iter().take_while(|&&c| c == b'>').count();
    if quotes > 0 {
        let end = lead + quotes;
        return Some(end + usize::from(b.get(end).is_some_and(|c| c.is_ascii_whitespace())));
    }
    if lead <= 3 {
        let rest = &text[lead..];
        for fence in *b"`~" {
            let n = rest.bytes().take_while(|&c| c == fence).count();
            if n >= 3 {
                let info = rest[n..].find('`').unwrap_or(rest.len() - n);
                return Some(lead + n + info);
            }
        }
        for rule in *b"-*_" {
            let n = rest.bytes().take_while(|&c| c == rule).count();
            if n >= 3 {
                let tail = rest[n..]
                    .bytes()
                    .take_while(|c| c.is_ascii_whitespace())
                    .count();
                return Some(lead + n + tail);
            }
        }
    }
    if text.starts_with('|') && text.len() > 1 && text.ends_with('|') {
        return Some(text.len());
    }
    None
}

fn touches(changes: &ChangeSet, range: Range<usize>) -> bool {
    let mut delta: isize = 0;
    for c in changes.changes() {
        let from = (c.range.start as isize + delta) as usize;
        let to = from + c.insert.len();
        if from <= range.end && to.max(from) >= range.start {
            return true;
        }
        delta += c.insert.len() as isize - c.range.len() as isize;
    }
    false
}

impl PreviewState {
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
            self.callout_title,
            self.revealed_source.as_ref().map(|r| (r.start, r.end)),
        )
            .hash(&mut h);
        h.finish()
    }

    /// True when no reveal/composing/callout-title/revealed-source override is active.
    pub fn has_reveal_overrides(&self) -> bool {
        self.reveal.is_some()
            || self.composing.is_some()
            || self.callout_title.is_some()
            || self.revealed_source.is_some()
    }

    fn settle_revealed(&mut self, state: &EditorState, keep: bool) {
        let s = state.selection;
        self.revealed_source = self
            .revealed_source
            .take()
            .filter(|r| keep || (r.start <= s.from() && s.to() <= r.end));
    }

    /// Whether `line` shows as source because its block was revealed.
    pub fn revealed_line(&self, line: &Range<usize>) -> bool {
        self.revealed_source
            .as_ref()
            .is_some_and(|r| line.start <= r.end && line.end >= r.start)
    }

    fn callout_title_at(
        state: &EditorState,
        syntax: &Syntax,
        focused: bool,
        read_only: bool,
    ) -> Option<usize> {
        if !focused || read_only {
            return None;
        }
        let line = state.doc.line_index(state.selection.head);
        syntax
            .callout_at(line)
            .is_some_and(|c| c.first_line == line)
            .then_some(line)
    }

    fn reveal_at(state: &EditorState, syntax: &Syntax, read_only: bool) -> Option<Range<usize>> {
        let s = state.selection;
        if read_only || !s.is_empty() {
            return None;
        }
        syntax.reveal_element(s.head).map(|e| e.range.clone())
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
        if applied.event == UserEvent::External {
            self.revealed_source = None;
        } else {
            self.revealed_source = self.revealed_source.as_ref().map(|r| {
                applied.changes.map(r.start, Assoc::Before)
                    ..applied.changes.map(r.end, Assoc::After)
            });
            self.settle_revealed(state, false);
        }
        let map = |r: &Range<usize>| {
            applied.changes.map(r.start, Assoc::Before)..applied.changes.map(r.end, Assoc::After)
        };
        let reveal = self.reveal.as_ref().map(map);
        self.selecting = false;
        let doc = &state.doc;
        let line = doc.line_index(state.selection.head);
        let line_start = doc.line_range(line).start;
        let mut composing = self
            .composing
            .map(|c| applied.changes.map(c, Assoc::Before))
            .filter(|c| *c == line_start);
        match applied.event {
            UserEvent::Paste => composing = None,
            UserEvent::Input | UserEvent::Delete => {
                let line_text = doc.line_cow(line);
                if let Some(n) = composing_prefix(&line_text)
                    && touches(&applied.changes, line_start..line_start + n)
                {
                    composing = Some(line_start);
                }
            }
            _ => {}
        }
        self.composing = if focused { composing } else { None };
        self.reveal = if !focused {
            reveal.filter(|r| {
                syntax
                    .reveal_element(r.start + 1)
                    .is_some_and(|e| e.range == *r)
            })
        } else {
            Self::reveal_at(state, syntax, read_only)
        };
        self.focused = focused;
        self.callout_title = Self::callout_title_at(state, syntax, focused, read_only);
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
        let entered = focused && !self.focused;
        let released = self.selecting && !selecting;
        self.selecting = selecting;
        self.focused = focused;
        self.callout_title = Self::callout_title_at(state, syntax, focused, read_only);
        self.settle_revealed(state, selecting || !state.selection.is_empty());
        if !focused {
            self.composing = None;
        } else if let Some(c) = self.composing
            && state
                .doc
                .line_range(state.doc.line_index(state.selection.head))
                .start
                != c
        {
            self.composing = None;
        }
        if selecting || !focused {
            return;
        }
        if !state.selection.is_empty() && !entered && !released {
            return;
        }
        self.reveal = Self::reveal_at(state, syntax, read_only);
    }

    /// `markdownHiddenMarkerSelectionNormalizer`: keep a caret off hidden
    /// block markers (one caret position per visual position).
    pub fn normalize(
        &self,
        doc: &Buffer,
        syntax: &Syntax,
        selection: Selection,
    ) -> Option<Selection> {
        if !selection.is_empty() {
            return None;
        }
        let line = doc.line_range(doc.line_index(selection.head));
        if self.composing == Some(line.start) || self.revealed_line(&line) {
            return None;
        }
        let marker = syntax.block_marker_on(line)?;
        let visible = marker.visible_start();
        (selection.head < visible).then(|| Selection::cursor(visible))
    }
}
