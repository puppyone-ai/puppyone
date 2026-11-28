//! `cloudCache` (`features/cloud/cache/cloudCache.ts`): one account
//! namespace at a time (another account, session generation or API clears
//! everything), a bounded LRU, and stale reads allowed so a view paints the
//! last snapshot while a fresh read revalidates it. Memory only. History and
//! billing readings share it, each with its own instance.
use std::{
    collections::{HashMap, VecDeque},
    time::{Duration, Instant},
};

/// `CLOUD_CACHE_TTL_MS`: a reading is fresh for 30 s.
pub const TTL: Duration = Duration::from_secs(30);
/// The entry bound.
pub const ENTRIES: usize = 320;

pub struct Cache<V> {
    namespace: Option<String>,
    entries: HashMap<String, (Instant, V)>,
    order: VecDeque<String>,
    capacity: usize,
    ttl: Duration,
}
impl<V: Clone> Cache<V> {
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            namespace: None,
            entries: HashMap::new(),
            order: VecDeque::new(),
            capacity,
            ttl,
        }
    }
    /// `activateSession`: a different namespace clears the cache.
    pub fn activate(&mut self, namespace: &str) {
        if self.namespace.as_deref() != Some(namespace) {
            self.namespace = Some(namespace.to_owned());
            self.entries.clear();
            self.order.clear();
        }
    }
    fn touch(&mut self, key: &str) {
        if let Some(i) = self.order.iter().position(|k| k == key) {
            let key = self.order.remove(i).unwrap();
            self.order.push_back(key);
        }
    }
    /// The stored value and whether it is still fresh at `now`.
    pub fn read(&mut self, key: &str, now: Instant) -> Option<(V, bool)> {
        let (stored, value) = self.entries.get(key)?.clone();
        self.touch(key);
        Some((value, now.saturating_duration_since(stored) < self.ttl))
    }
    pub fn store(&mut self, key: String, value: V, now: Instant) {
        if self.entries.insert(key.clone(), (now, value)).is_some() {
            self.touch(&key);
        } else {
            self.order.push_back(key);
        }
        while self.order.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
    }
    /// `discard`: a failed read leaves nothing behind.
    pub fn discard(&mut self, key: &str) {
        if self.entries.remove(key).is_some() {
            self.order.retain(|k| k != key);
        }
    }
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_cache_is_bounded_namespaced_and_serves_stale_snapshots() {
        let mut cache = Cache::new(2, TTL);
        let now = Instant::now();
        cache.activate("u1:1:api");
        cache.store("a".into(), 1, now);
        cache.store("b".into(), 2, now);
        assert_eq!(cache.read("a", now), Some((1, true)));
        cache.store("c".into(), 3, now);
        // `b` was least recently used.
        assert_eq!(cache.read("b", now), None);
        assert_eq!(cache.read("a", now + TTL), Some((1, false)));
        cache.discard("a");
        assert_eq!(cache.read("a", now), None);
        cache.activate("u1:2:api");
        assert_eq!(cache.len(), 0);
    }
}
