//! Bounded LRU cache, cooperative cancellation, and revision tracking core
//! for `AssetBroker` (`platform/brokers/assets/cache.rs`, `TODO-33`, `TODO-91`).
use crate::editor::markdown::platform::policy::asset::{AssetFailure, ContentStamp};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

/// Maximum decoded bitmap entries kept in `AssetBroker` (`TODO-91`).
pub const MAX_CACHE_ENTRIES: usize = 256;
/// Maximum total decoded bitmap bytes (`64 MiB`, `TODO-91`).
pub const MAX_CACHE_BYTES: usize = 64 * 1024 * 1024;

/// Cooperative cancellation token attached to each in-flight asset decode/fetch.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// Composite cache key: `(workspace_id, canonical_path_or_url, content_stamp)`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct AssetKey {
    pub workspace_id: String,
    pub target: String,
    pub stamp: ContentStamp,
}

impl AssetKey {
    pub fn logical_id(&self) -> (&str, &str) {
        (&self.workspace_id, &self.target)
    }
}

/// Decoded asset state returned to Markdown widgets.
#[derive(Clone)]
pub enum AssetState<I = Arc<gpui::RenderImage>> {
    Loading,
    Ready { image: I, width: f32, height: f32 },
    Failed(AssetFailure),
}

struct Entry<I> {
    state: AssetState<I>,
    bytes: usize,
    used: u64,
    generation: u64,
    cancel: Option<CancelToken>,
}

/// Pure, deterministic LRU + cancellation + retry core of `AssetBroker`,
/// generic over bitmap handle `I` for fast unit testing (`TODO-33`, `TODO-91`).
pub struct BrokerCore<I> {
    entries: HashMap<AssetKey, Entry<I>>,
    revisions: HashMap<(String, String), u64>,
    clock: u64,
    next_generation: u64,
    max_entries: usize,
    max_bytes: usize,
    total_bytes: usize,
}

impl<I: Clone> Default for BrokerCore<I> {
    fn default() -> Self {
        Self::new(MAX_CACHE_ENTRIES, MAX_CACHE_BYTES)
    }
}

impl<I: Clone> BrokerCore<I> {
    pub fn new(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            revisions: HashMap::new(),
            clock: 0,
            next_generation: 0,
            max_entries: max_entries.max(1),
            max_bytes: max_bytes.max(1),
            total_bytes: 0,
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn total_bytes(&self) -> usize {
        self.total_bytes
    }

    /// Current synthetic revision for hosted/non-disk workspace targets.
    pub fn revision(&self, workspace_id: &str, target: &str) -> u64 {
        self.revisions
            .get(&(workspace_id.to_owned(), target.to_owned()))
            .copied()
            .unwrap_or(0)
    }

    /// Bumps the revision of `(workspace_id, target)` and evicts stale versions.
    pub fn bump_revision(&mut self, workspace_id: &str, target: &str) -> u64 {
        let pair = (workspace_id.to_owned(), target.to_owned());
        let next = self.revisions.get(&pair).copied().unwrap_or(0) + 1;
        self.revisions.insert(pair, next);
        self.purge_target(workspace_id, target, None);
        next
    }

    /// Looks up `key` (updating LRU recency) or starts a new cancellable load,
    /// returning `Err((generation, cancel_token))` only when the caller must
    /// spawn the background load (deduplicating concurrent `Loading` hits).
    pub fn get_or_begin(&mut self, key: AssetKey) -> Result<AssetState<I>, (u64, CancelToken)> {
        // Purge any older content-stamp entries for the same `(workspace_id, target)`.
        self.purge_target(&key.workspace_id, &key.target, Some(&key.stamp));
        self.clock += 1;
        let now = self.clock;
        if let Some(entry) = self.entries.get_mut(&key) {
            if !matches!(entry.state, AssetState::Loading) {
                entry.used = now;
            }
            return Ok(entry.state.clone());
        }
        self.next_generation += 1;
        let generation = self.next_generation;
        let token = CancelToken::new();
        self.entries.insert(
            key,
            Entry {
                state: AssetState::Loading,
                bytes: 0,
                used: u64::MAX,
                generation,
                cancel: Some(token.clone()),
            },
        );
        Err((generation, token))
    }

    /// Completes an in-flight load if `generation` is still current and uncancelled.
    pub fn settle(
        &mut self,
        key: AssetKey,
        generation: u64,
        result: Result<(I, f32, f32, usize), AssetFailure>,
    ) -> bool {
        let current = self.entries.get(&key);
        if current.is_none_or(|e| {
            e.generation != generation || e.cancel.as_ref().is_some_and(CancelToken::is_cancelled)
        }) {
            return false;
        }
        if let Some(old) = self.entries.remove(&key) {
            self.total_bytes = self.total_bytes.saturating_sub(old.bytes);
        }
        self.clock += 1;
        let used = self.clock;
        match result {
            Ok((image, width, height, bytes)) => {
                if bytes > self.max_bytes {
                    self.entries.insert(
                        key,
                        Entry {
                            state: AssetState::Failed(AssetFailure::ExceedsLimit {
                                limit_bytes: self.max_bytes as u64,
                            }),
                            bytes: 0,
                            used,
                            generation,
                            cancel: None,
                        },
                    );
                } else {
                    self.total_bytes += bytes;
                    self.entries.insert(
                        key,
                        Entry {
                            state: AssetState::Ready {
                                image,
                                width,
                                height,
                            },
                            bytes,
                            used,
                            generation,
                            cancel: None,
                        },
                    );
                }
            }
            Err(failure) => {
                self.entries.insert(
                    key,
                    Entry {
                        state: AssetState::Failed(failure),
                        bytes: 0,
                        used,
                        generation,
                        cancel: None,
                    },
                );
            }
        }
        self.evict_lru();
        true
    }

    /// Cancels an active or failed entry for `(workspace_id, target)` so the
    /// next render retries loading cleanly (`TODO-33`).
    pub fn retry(&mut self, workspace_id: &str, target: &str) {
        self.purge_target(workspace_id, target, None);
    }

    /// Cancels a specific `AssetKey` if currently loading or cached.
    pub fn cancel(&mut self, key: &AssetKey) {
        if let Some(removed) = self.entries.remove(key) {
            if let Some(cancel) = removed.cancel {
                cancel.cancel();
            }
            self.total_bytes = self.total_bytes.saturating_sub(removed.bytes);
        }
    }

    fn purge_target(
        &mut self,
        workspace_id: &str,
        target: &str,
        keep_stamp: Option<&ContentStamp>,
    ) {
        let stale: Vec<AssetKey> = self
            .entries
            .keys()
            .filter(|k| {
                k.workspace_id == workspace_id
                    && k.target == target
                    && keep_stamp.is_none_or(|s| &k.stamp != s)
            })
            .cloned()
            .collect();
        for k in stale {
            self.cancel(&k);
        }
    }

    fn evict_lru(&mut self) {
        while self.entries.len() > self.max_entries || self.total_bytes > self.max_bytes {
            let Some(oldest) = self
                .entries
                .iter()
                .filter(|(_, e)| !matches!(e.state, AssetState::Loading))
                .min_by_key(|(_, e)| e.used)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.total_bytes = self.total_bytes.saturating_sub(removed.bytes);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn file_key(name: &str, len: u64, modified_ns: u128) -> AssetKey {
        AssetKey {
            workspace_id: "ws-1".into(),
            target: name.into(),
            stamp: ContentStamp::File { len, modified_ns },
        }
    }

    #[test]
    fn lru_evicts_oldest_by_entry_cap_and_decoded_byte_budget() {
        // Entry cap eviction (`max_entries = 3`).
        let mut by_count: BrokerCore<&'static str> = BrokerCore::new(3, 1024);
        for (i, label) in [(1, "a"), (2, "b"), (3, "c")] {
            let k = file_key(label, i, 1);
            let (g, _) = by_count.get_or_begin(k.clone()).err().unwrap();
            assert!(by_count.settle(k, g, Ok((label, 10., 10., 100))));
        }
        // Touch "a" so "b" becomes least recently used.
        assert!(matches!(
            by_count.get_or_begin(file_key("a", 1, 1)),
            Ok(AssetState::Ready { image: "a", .. })
        ));
        let k_d = file_key("d", 4, 1);
        let (gen_d, _) = by_count.get_or_begin(k_d.clone()).err().unwrap();
        by_count.settle(k_d, gen_d, Ok(("d", 10., 10., 100)));
        assert_eq!(by_count.len(), 3);
        assert!(
            by_count.get_or_begin(file_key("b", 2, 1)).is_err(),
            "b evicted"
        );
        assert!(matches!(
            by_count.get_or_begin(file_key("a", 1, 1)),
            Ok(AssetState::Ready { image: "a", .. })
        ));

        // Byte budget eviction (`max_bytes = 250`).
        let mut by_bytes: BrokerCore<&'static str> = BrokerCore::new(16, 250);
        for (name, bytes) in [("img1", 120usize), ("img2", 120), ("img3", 120)] {
            let k = file_key(name, bytes as u64, 1);
            let (g, _) = by_bytes.get_or_begin(k.clone()).err().unwrap();
            by_bytes.settle(k, g, Ok((name, 10., 10., bytes)));
        }
        assert!(by_bytes.total_bytes() <= 250);
        assert_eq!(by_bytes.len(), 2);
        assert!(by_bytes.get_or_begin(file_key("img1", 120, 1)).is_err());
    }

    #[test]
    fn transient_failure_is_retryable_and_in_flight_cancels_cleanly() {
        let mut broker: BrokerCore<&'static str> = BrokerCore::new(16, 4096);
        let key = AssetKey {
            workspace_id: String::new(),
            target: "https://cdn.example.com/pic.png".into(),
            stamp: ContentStamp::Immutable,
        };
        let (gen1, token1) = broker.get_or_begin(key.clone()).err().unwrap();
        // Concurrent request for the same key deduplicates onto `Loading`.
        assert!(matches!(
            broker.get_or_begin(key.clone()),
            Ok(AssetState::Loading)
        ));
        assert!(!token1.is_cancelled());

        // Settle transient failure.
        broker.settle(
            key.clone(),
            gen1,
            Err(AssetFailure::Network("timeout".into())),
        );
        assert!(matches!(
            broker.get_or_begin(key.clone()),
            Ok(AssetState::Failed(AssetFailure::Network(_)))
        ));

        // Explicit retry clears the failed entry so the next request succeeds!
        broker.retry("", "https://cdn.example.com/pic.png");
        let (gen2, token2) = broker
            .get_or_begin(key.clone())
            .err()
            .expect("retry must allow re-fetching");

        // If cancelled mid-flight, stale settle is ignored.
        broker.cancel(&key);
        assert!(token2.is_cancelled());
        assert!(!broker.settle(key.clone(), gen2, Ok(("late", 10., 10., 40))));

        // Subsequent attempt settles Ready cleanly.
        let (gen3, _) = broker.get_or_begin(key.clone()).err().unwrap();
        assert!(broker.settle(key.clone(), gen3, Ok(("recovered", 20., 20., 80))));
        assert!(matches!(
            broker.get_or_begin(key),
            Ok(AssetState::Ready {
                image: "recovered",
                ..
            })
        ));
    }
}
