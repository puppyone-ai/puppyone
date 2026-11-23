//! `EmbedBroker` (`TA-42`, `TA-50`, `TA-52`, `TODO-35`):
//! centralizes all `WebHost` lifecycle management for Markdown workspace media
//! clips (`<video>`, `<audio>`, `![[clip.mp4]]`) and external `https:` web
//! embeds (`<iframe>`), enforcing:
//! - bounded per-window LRU capacity pools (`MAX_MEDIA_PER_WINDOW`, `MAX_WEB_EMBEDS_PER_WINDOW`);
//! - single DNS resolution + pinned HTTPS preflight (`ClientBuilder::resolve`)
//!   that blocks DNS rebinding and private/loopback redirects (`TA-50`);
//! - visible failure reasons and explicit `retry` actions (`TA-52`).
mod media;
mod web_embed;

pub use media::{
    AUDIO_SIZE, MAX_MEDIA_PER_WINDOW, MediaKey, MediaPlayer, MediaRequest, get_media_player,
    media_page, retry_media,
};
pub use web_embed::{
    MAX_WEB_EMBEDS_PER_WINDOW, external_iframe_href, render_web_embed, web_embed_entry_page,
};

use std::collections::HashMap;

/// Pure per-window LRU pool tracker used to bound active `WebHost` slots (`TODO-35`).
pub struct WindowHostPool<K> {
    slots: HashMap<K, (u64, u64)>, // key -> (window_id, last_used_clock)
    clock: u64,
    per_window_cap: usize,
}

impl<K: Eq + std::hash::Hash + Clone> WindowHostPool<K> {
    pub fn new(per_window_cap: usize) -> Self {
        Self {
            slots: HashMap::new(),
            clock: 0,
            per_window_cap: per_window_cap.max(1),
        }
    }

    /// Touches or inserts `key` in `window_id`, returning keys evicted from
    /// `window_id` to stay within `per_window_cap` (preferring `can_evict`).
    pub fn acquire(&mut self, key: K, window_id: u64, can_evict: impl Fn(&K) -> bool) -> Vec<K> {
        self.clock += 1;
        let now = self.clock;
        if let Some(entry) = self.slots.get_mut(&key) {
            entry.0 = window_id;
            entry.1 = now;
            return Vec::new();
        }
        let mut evicted = Vec::new();
        while self.slots.values().filter(|(w, _)| *w == window_id).count() >= self.per_window_cap {
            let candidate = self
                .slots
                .iter()
                .filter(|(k, (w, _))| *w == window_id && can_evict(k))
                .min_by_key(|(_, (_, used))| *used)
                .or_else(|| {
                    self.slots
                        .iter()
                        .filter(|(_, (w, _))| *w == window_id)
                        .min_by_key(|(_, (_, used))| *used)
                })
                .map(|(k, _)| k.clone());
            let Some(victim) = candidate else { break };
            self.slots.remove(&victim);
            evicted.push(victim);
        }
        self.slots.insert(key, (window_id, now));
        evicted
    }

    pub fn remove(&mut self, key: &K) {
        self.slots.remove(key);
    }

    #[cfg(test)]
    pub fn count_in_window(&self, window_id: u64) -> usize {
        self.slots.values().filter(|(w, _)| *w == window_id).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn window_host_pool_bounds_per_window_and_evicts_lru_invisible() {
        let mut pool: WindowHostPool<&'static str> = WindowHostPool::new(2);
        assert!(pool.acquire("a", 1, |_| true).is_empty());
        assert!(pool.acquire("b", 1, |_| true).is_empty());
        assert!(pool.acquire("w2-a", 2, |_| true).is_empty());
        assert_eq!(pool.count_in_window(1), 2);
        assert_eq!(pool.count_in_window(2), 1);

        assert!(pool.acquire("a", 1, |_| true).is_empty());
        assert_eq!(pool.acquire("c", 1, |_| true), vec!["b"]);
        assert_eq!(pool.count_in_window(1), 2);
    }
}
