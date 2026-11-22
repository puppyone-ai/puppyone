//! Per-view, `BlockId`-scoped presentation sessions (`platform/sessions/`,
//! TS `platform/sessions/*`).
//!
//! All state here lives in the owning view's [`WidgetStateStore`] (evicted
//! automatically when blocks leave the document or the view closes), never in
//! process-global `thread_local!` maps.
pub mod column_layout;
pub mod disclosure;
pub mod inline_viewport;
pub mod measure;

use std::collections::HashMap;

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
