//! Per-view presentation sessions (`platform/sessions/`, TS
//! `platform/sessions/*`).
//!
//! Block-scoped state lives in the owning view's [`WidgetStateStore`]
//! (evicted automatically when blocks leave the document or the view
//! closes). Table viewport and column layout sessions live in the view's
//! [`Sessions`] and follow its transactions through [`continuity`]. None of
//! it is process-global.
//!
//! [`WidgetStateStore`]: crate::editor::view::widget::WidgetStateStore
pub mod column_layout;
pub mod continuity;
pub mod disclosure;
pub mod inline_viewport;
pub mod measure;

use crate::editor::{
    markdown::core::state::{FeatureStateStore, FeatureStateValue},
    text::{buffer::Buffer, change::ChangeSet, state::Applied},
};
use std::collections::HashMap;

/// One view's table sessions: where wide tables are scrolled and how their
/// columns are laid out.
#[derive(Clone)]
pub struct Sessions {
    pub viewports: inline_viewport::Shared,
    pub layouts: column_layout::Shared,
    /// The last revision mapped: a transaction reaches the view's extension
    /// more than once.
    mapped: std::rc::Rc<std::cell::Cell<u64>>,
}

impl Default for Sessions {
    fn default() -> Self {
        Self {
            viewports: inline_viewport::Store::shared(),
            layouts: column_layout::Store::shared(),
            mapped: std::rc::Rc::default(),
        }
    }
}

/// The feature-state slot the view's [`Sessions`] live in, so widgets reach
/// them through their factory context.
pub const SLOT: &str = "platform.sessions";

/// Give a view's feature state its own [`Sessions`].
pub fn install(state: &mut FeatureStateStore) {
    state.get_or_default_mut::<Sessions>(SLOT);
}

impl std::fmt::Debug for Sessions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Sessions")
    }
}

/// Sessions are presentation state outside the decoration keys: every
/// store compares equal and hashes to nothing, and transactions reach them
/// through [`Sessions::map`] with their effects.
impl PartialEq for Sessions {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}

impl std::hash::Hash for Sessions {
    fn hash<H: std::hash::Hasher>(&self, _: &mut H) {}
}

impl FeatureStateValue for Sessions {
    fn map_changes(&mut self, _: &ChangeSet, _: &Buffer, _: u64) {}
}

impl Sessions {
    /// Follow one applied transaction, once, into `revision`.
    pub fn map(&self, applied: &Applied, revision: u64) {
        if applied.changes.is_empty() || self.mapped.replace(revision) == revision {
            return;
        }
        continuity::with_mapping(applied, |mapping| {
            self.viewports.borrow_mut().map(mapping);
            self.layouts.borrow_mut().map(mapping);
        });
    }
}

/// Bounded LRU map used by per-block presentation sessions (`TODO-31`).
pub struct BoundedMap<K, V> {
    entries: HashMap<K, (V, u64)>,
    clock: u64,
    cap: usize,
}

impl<K: Eq + std::hash::Hash + Copy, V: Copy> BoundedMap<K, V> {
    pub fn new(cap: usize) -> Self {
        Self {
            entries: HashMap::new(),
            clock: 0,
            cap: cap.max(1),
        }
    }

    pub fn get(&mut self, key: &K) -> Option<V> {
        self.clock += 1;
        let now = self.clock;
        let entry = self.entries.get_mut(key)?;
        entry.1 = now;
        Some(entry.0)
    }

    pub fn contains(&mut self, key: &K) -> bool {
        self.get(key).is_some()
    }

    pub fn remove(&mut self, key: &K) -> Option<V> {
        self.entries.remove(key).map(|(v, _)| v)
    }

    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.clock += 1;
        let now = self.clock;
        let previous = self.entries.insert(key, (value, now)).map(|(v, _)| v);
        while self.entries.len() > self.cap {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (_, used))| *used)
                .map(|(k, _)| *k)
            else {
                break;
            };
            self.entries.remove(&oldest);
        }
        previous
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::BoundedMap;
    use core::prelude::v1::test;

    #[test]
    fn bounded_map_evicts_least_recently_used_entry() {
        let mut map = BoundedMap::new(3);
        map.insert(1u64, 10.0f32);
        map.insert(2, 20.0);
        map.insert(3, 30.0);
        assert_eq!(map.get(&1), Some(10.0));
        map.insert(4, 40.0);
        assert_eq!(map.len(), 3);
        assert_eq!(map.get(&2), None, "key 2 was least recently used");
        assert_eq!(map.get(&1), Some(10.0));
        assert_eq!(map.get(&4), Some(40.0));
    }
}
