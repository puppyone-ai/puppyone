//! Type-erased per-feature pane state store (`TA-40`).
use crate::editor::text::{buffer::Buffer, change::ChangeSet};
use std::{
    any::Any,
    collections::BTreeMap,
    fmt,
    hash::{DefaultHasher, Hash, Hasher},
};

/// Plain view-state value of a rendered diagram (`mermaid/widget.rs` reads it).
/// Moves to `features/mermaid/state.rs` in Step M3.
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
/// Moves to `features/callout/state.rs` in Step M3.
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
