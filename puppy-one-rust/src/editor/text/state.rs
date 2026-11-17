//! Immutable-style editor state transitions (CodeMirror `EditorState` +
//! `Transaction`): every edit is a change set applied with a new selection,
//! open hierarchical annotations (`TA-05`) and typed state effects (`TA-05`).
use super::{buffer::Buffer, change::ChangeSet, selection::Selection};
use std::{any::Any, borrow::Cow, fmt, sync::Arc, time::Instant};

/// Hierarchical dot-separated prefix check (`"input.type"` matches `"input"`
/// and `"input.type"`, `"delete.backward"` matches `"delete"`, etc.).
pub fn matches_annotation_prefix(tag: &str, prefix: &str) -> bool {
    tag == prefix
        || (tag.len() > prefix.len()
            && tag.starts_with(prefix)
            && tag.as_bytes()[prefix.len()] == b'.')
}

/// Open metadata attached to a `Transaction` (`TA-05`).
#[derive(Clone)]
pub enum Annotation {
    /// Hierarchical event / origin tag (e.g. `"input.type"`, `"delete.backward"`).
    Tag(Cow<'static, str>),
    /// Explicit wall-clock / monotonic timestamp for history grouping.
    Time(Instant),
    /// Arbitrary typed annotation payload.
    Value(Arc<dyn Any + Send + Sync>),
}

impl Annotation {
    pub const INPUT: &'static str = "input";
    pub const INPUT_TYPE: &'static str = "input.type";
    pub const INPUT_PASTE: &'static str = "input.paste";
    pub const INPUT_COMPOSE: &'static str = "input.compose";
    pub const DELETE: &'static str = "delete";
    pub const DELETE_BACKWARD: &'static str = "delete.backward";
    pub const DELETE_FORWARD: &'static str = "delete.forward";
    pub const COMMAND: &'static str = "command";
    pub const UNDO: &'static str = "undo";
    pub const REDO: &'static str = "redo";
    pub const SELECT: &'static str = "select";
    pub const SELECT_POINTER: &'static str = "select.pointer";
    pub const EXTERNAL: &'static str = "external";
    pub const CONFIG: &'static str = "config";

    pub const fn tag(tag: &'static str) -> Self {
        Self::Tag(Cow::Borrowed(tag))
    }

    pub fn value<T: Send + Sync + 'static>(val: T) -> Self {
        Self::Value(Arc::new(val))
    }

    pub fn as_tag(&self) -> Option<&str> {
        match self {
            Self::Tag(t) => Some(t.as_ref()),
            _ => None,
        }
    }

    pub fn as_time(&self) -> Option<Instant> {
        match self {
            Self::Time(t) => Some(*t),
            _ => None,
        }
    }

    pub fn downcast_ref<T: 'static>(&self) -> Option<&T> {
        match self {
            Self::Value(v) => v.downcast_ref::<T>(),
            _ => None,
        }
    }
}

impl fmt::Debug for Annotation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Tag(t) => f.debug_tuple("Annotation::Tag").field(t).finish(),
            Self::Time(t) => f.debug_tuple("Annotation::Time").field(t).finish(),
            Self::Value(_) => f.debug_tuple("Annotation::Value").field(&"<any>").finish(),
        }
    }
}

impl From<&'static str> for Annotation {
    fn from(tag: &'static str) -> Self {
        Self::Tag(Cow::Borrowed(tag))
    }
}

impl From<String> for Annotation {
    fn from(tag: String) -> Self {
        Self::Tag(Cow::Owned(tag))
    }
}

impl From<Instant> for Annotation {
    fn from(at: Instant) -> Self {
        Self::Time(at)
    }
}

/// Typed side-channel effect carried on a `Transaction` (`TA-05`, CodeMirror
/// `StateEffect`): state fields, extensions and view plugins inspect effects
/// without adding closed enum variants to the kernel.
#[derive(Clone)]
pub struct StateEffect(Arc<dyn Any + Send + Sync>);

impl StateEffect {
    pub fn new<T: Send + Sync + 'static>(effect: T) -> Self {
        Self(Arc::new(effect))
    }

    pub fn downcast_ref<T: 'static>(&self) -> Option<&T> {
        self.0.downcast_ref::<T>()
    }

    pub fn is<T: 'static>(&self) -> bool {
        self.0.is::<T>()
    }
}

impl fmt::Debug for StateEffect {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("StateEffect").field(&"<any>").finish()
    }
}

/// Compatibility user-event summary (`CodeMirror userEvent`). Backed by and
/// synchronised with hierarchical `Annotation::Tag`s on `Transaction`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum UserEvent {
    /// Typed text, including IME commits (`"input.type"`).
    #[default]
    Input,
    /// Provisional IME composition text (`"input.compose"`).
    Compose,
    /// Backward/forward deletion (`"delete"`, `"delete.backward"`, `"delete.forward"`).
    Delete,
    /// Clipboard paste (`"input.paste"`).
    Paste,
    /// Formatting or structural commands (`"command"`).
    Command,
    /// Undo step (`"undo"`).
    Undo,
    /// Redo step (`"redo"`).
    Redo,
    /// Selection-only change (`"select"`, `"select.pointer"`).
    Select,
    /// Content replaced from storage (`"external"`).
    External,
}

impl UserEvent {
    pub const fn as_annotation_tag(self) -> &'static str {
        match self {
            Self::Input => Annotation::INPUT_TYPE,
            Self::Compose => Annotation::INPUT_COMPOSE,
            Self::Delete => Annotation::DELETE,
            Self::Paste => Annotation::INPUT_PASTE,
            Self::Command => Annotation::COMMAND,
            Self::Undo => Annotation::UNDO,
            Self::Redo => Annotation::REDO,
            Self::Select => Annotation::SELECT,
            Self::External => Annotation::EXTERNAL,
        }
    }

    pub fn from_annotation_tag(tag: &str) -> Option<Self> {
        if matches_annotation_prefix(tag, Annotation::INPUT_COMPOSE) {
            Some(Self::Compose)
        } else if matches_annotation_prefix(tag, Annotation::INPUT_PASTE) {
            Some(Self::Paste)
        } else if matches_annotation_prefix(tag, Annotation::INPUT) {
            Some(Self::Input)
        } else if matches_annotation_prefix(tag, Annotation::DELETE) {
            Some(Self::Delete)
        } else if matches_annotation_prefix(tag, Annotation::COMMAND) {
            Some(Self::Command)
        } else if matches_annotation_prefix(tag, Annotation::UNDO) {
            Some(Self::Undo)
        } else if matches_annotation_prefix(tag, Annotation::REDO) {
            Some(Self::Redo)
        } else if matches_annotation_prefix(tag, Annotation::SELECT) {
            Some(Self::Select)
        } else if matches_annotation_prefix(tag, Annotation::EXTERNAL) {
            Some(Self::External)
        } else {
            None
        }
    }
}

#[derive(Clone, Debug)]
pub struct Transaction {
    pub changes: ChangeSet,
    pub selection: Option<Selection>,
    pub event: UserEvent,
    pub scroll_into_view: bool,
    pub annotations: Vec<Annotation>,
    pub effects: Vec<StateEffect>,
}

impl Default for Transaction {
    fn default() -> Self {
        Self {
            changes: ChangeSet::default(),
            selection: None,
            event: UserEvent::Select,
            scroll_into_view: true,
            annotations: vec![Annotation::tag(Annotation::SELECT)],
            effects: Vec::new(),
        }
    }
}

impl Transaction {
    pub fn select(selection: Selection) -> Self {
        Self {
            changes: ChangeSet::default(),
            selection: Some(selection),
            event: UserEvent::Select,
            scroll_into_view: true,
            annotations: vec![Annotation::tag(Annotation::SELECT)],
            effects: Vec::new(),
        }
    }

    pub fn edit(changes: ChangeSet, selection: Option<Selection>, event: UserEvent) -> Self {
        Self {
            changes,
            selection,
            event,
            scroll_into_view: true,
            annotations: vec![Annotation::tag(event.as_annotation_tag())],
            effects: Vec::new(),
        }
    }

    pub fn with_scroll_into_view(mut self, scroll_into_view: bool) -> Self {
        self.scroll_into_view = scroll_into_view;
        self
    }

    pub fn with_event(mut self, event: UserEvent) -> Self {
        self.annotations.retain(|a| {
            a.as_tag()
                .and_then(UserEvent::from_annotation_tag)
                .is_none()
        });
        self.event = event;
        self.annotations
            .push(Annotation::tag(event.as_annotation_tag()));
        self
    }

    pub fn annotate(&mut self, annotation: impl Into<Annotation>) {
        let annotation = annotation.into();
        if let Some(tag) = annotation.as_tag()
            && let Some(ev) = UserEvent::from_annotation_tag(tag)
        {
            // Replace prior user-event tag so more specific tags (e.g.
            // `"delete.backward"`, `"select.pointer"`) supersede defaults.
            self.annotations.retain(|a| {
                a.as_tag()
                    .and_then(UserEvent::from_annotation_tag)
                    .is_none()
            });
            self.event = ev;
        }
        self.annotations.push(annotation);
    }

    pub fn with_annotation(mut self, annotation: impl Into<Annotation>) -> Self {
        self.annotate(annotation);
        self
    }

    pub fn is_annotation(&self, prefix: &str) -> bool {
        let mut has_user_event_tag = false;
        for ann in &self.annotations {
            if let Some(tag) = ann.as_tag() {
                if UserEvent::from_annotation_tag(tag) == Some(self.event) {
                    has_user_event_tag = true;
                }
                if matches_annotation_prefix(tag, prefix) {
                    return true;
                }
            }
        }
        !has_user_event_tag && matches_annotation_prefix(self.event.as_annotation_tag(), prefix)
    }

    pub fn timestamp(&self) -> Option<Instant> {
        self.annotations.iter().find_map(Annotation::as_time)
    }

    pub fn annotation<T: 'static>(&self) -> Option<&T> {
        self.annotations.iter().find_map(Annotation::downcast_ref)
    }

    pub fn add_effect<T: Send + Sync + 'static>(&mut self, effect: T) {
        self.effects.push(StateEffect::new(effect));
    }

    pub fn with_effect<T: Send + Sync + 'static>(mut self, effect: T) -> Self {
        self.add_effect(effect);
        self
    }

    pub fn effects<T: 'static>(&self) -> impl Iterator<Item = &T> {
        self.effects.iter().filter_map(StateEffect::downcast_ref)
    }

    fn normalized_annotations(mut self) -> Vec<Annotation> {
        let matches_event = self.annotations.iter().any(|a| {
            a.as_tag()
                .and_then(UserEvent::from_annotation_tag)
                .is_some_and(|ev| ev == self.event)
        });
        if !matches_event {
            self.annotations.retain(|a| {
                a.as_tag()
                    .and_then(UserEvent::from_annotation_tag)
                    .is_none()
            });
            self.annotations
                .push(Annotation::tag(self.event.as_annotation_tag()));
        }
        self.annotations
    }
}

#[derive(Clone, Debug, Default)]
pub struct EditorState {
    pub doc: Buffer,
    pub selection: Selection,
    /// Monotonic document revision; changes only when text changes.
    pub revision: u64,
}

/// Result of applying a document-modifying transaction, retained for history
/// and views. `before_doc` is an `O(1)` rope snapshot (`Arc::clone`), and
/// `inverse` is computed via `Buffer::slice_cow` without materialising `flat`.
pub struct Applied {
    pub before_doc: Buffer,
    pub before_selection: Selection,
    pub changes: ChangeSet,
    pub inverse: ChangeSet,
    pub event: UserEvent,
    pub annotations: Vec<Annotation>,
    pub effects: Vec<StateEffect>,
}

impl Applied {
    pub fn is_annotation(&self, prefix: &str) -> bool {
        self.annotations
            .iter()
            .filter_map(Annotation::as_tag)
            .any(|tag| matches_annotation_prefix(tag, prefix))
    }

    pub fn timestamp(&self) -> Option<Instant> {
        self.annotations.iter().find_map(Annotation::as_time)
    }

    pub fn annotation<T: 'static>(&self) -> Option<&T> {
        self.annotations.iter().find_map(Annotation::downcast_ref)
    }

    pub fn effects<T: 'static>(&self) -> impl Iterator<Item = &T> {
        self.effects.iter().filter_map(StateEffect::downcast_ref)
    }
}

impl EditorState {
    pub fn new(text: &str) -> Self {
        Self {
            doc: Buffer::new(text),
            selection: Selection::default(),
            revision: 0,
        }
    }

    pub fn apply(&mut self, tr: Transaction) -> Option<Applied> {
        let before_selection = self.selection;
        if tr.changes.is_empty() {
            if let Some(selection) = tr.selection {
                self.selection = self.clamp_selection(selection);
            }
            return None;
        }
        let inverse = tr.changes.invert(&self.doc);
        let before_doc = self.doc.clone();
        tr.changes.apply(&mut self.doc);
        self.selection = self.clamp_selection(
            tr.selection
                .unwrap_or_else(|| before_selection.map(&tr.changes)),
        );
        self.revision += 1;
        let event = tr.event;
        let effects = tr.effects.clone();
        let changes = tr.changes.clone();
        let annotations = tr.normalized_annotations();
        Some(Applied {
            before_doc,
            before_selection,
            changes,
            inverse,
            event,
            annotations,
            effects,
        })
    }

    fn clamp_selection(&self, s: Selection) -> Selection {
        Selection {
            anchor: self.doc.clamp(s.anchor),
            head: self.doc.clamp(s.head),
            ..s
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq, Eq)]
    struct FoldEffect {
        line: usize,
        folded: bool,
    }

    #[derive(Debug, PartialEq, Eq)]
    struct OriginMeta(&'static str);

    #[test]
    fn hierarchical_annotations_and_typed_effects_round_trip_without_materialising_flat() {
        let initial = "line one 中文 😀\n".repeat(120); // > 2 KB multi-leaf rope
        let mut state = EditorState::new(&initial);
        assert!(!state.doc.has_materialized_flat());

        let t0 = Instant::now();
        let tr = Transaction::edit(
            ChangeSet::replace(0..4, "LINE"),
            Some(Selection::cursor(4)),
            UserEvent::Delete,
        )
        .with_annotation(Annotation::DELETE_BACKWARD)
        .with_annotation(t0)
        .with_annotation(Annotation::value(OriginMeta("keymap")))
        .with_effect(FoldEffect {
            line: 3,
            folded: true,
        })
        .with_effect(42u64);

        assert!(tr.is_annotation("delete"));
        assert!(tr.is_annotation("delete.backward"));
        assert!(!tr.is_annotation("delete.forward"));
        assert!(!tr.is_annotation("del"));
        assert_eq!(tr.timestamp(), Some(t0));
        assert_eq!(tr.annotation::<OriginMeta>(), Some(&OriginMeta("keymap")));

        let applied = state.apply(tr).expect("document modified");
        assert!(!state.doc.has_materialized_flat());
        assert!(!applied.before_doc.has_materialized_flat());
        assert!(applied.is_annotation("delete"));
        assert!(applied.is_annotation("delete.backward"));
        assert_eq!(applied.timestamp(), Some(t0));
        assert_eq!(
            applied.annotation::<OriginMeta>(),
            Some(&OriginMeta("keymap"))
        );

        let folds: Vec<&FoldEffect> = applied.effects::<FoldEffect>().collect();
        assert_eq!(
            folds,
            vec![&FoldEffect {
                line: 3,
                folded: true
            }]
        );
        let nums: Vec<u64> = applied.effects::<u64>().copied().collect();
        assert_eq!(nums, vec![42]);

        // Applying `applied.inverse` restores exact original document.
        let mut restored = state.doc.clone();
        applied.inverse.apply(&mut restored);
        assert_eq!(restored, applied.before_doc);
        assert!(!restored.has_materialized_flat());
    }
}
