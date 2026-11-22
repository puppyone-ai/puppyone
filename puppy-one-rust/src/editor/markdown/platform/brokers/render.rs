//! `RenderBroker` (`TA-42`, `TA-50`, `TODO-34`):
//! platform port over `crate::render_service` providing:
//! - in-flight request deduplication by cache key;
//! - slot-based cancellation/skipping of superseded stale requests;
//! - retryable `Unavailable` & `Failed` states (`Unavailable` never permanently cached);
//! - bounded LRU `LAST_GOOD` cache replacing unbounded per-feature `thread_local!` maps.
pub use crate::render_service::{
    Kind, MAX_SOURCE_BYTES, MermaidTheme, RenderSlot, Rendered, Request, State, cache_key, hex,
    mermaid_config,
};

use gpui::{App, EntityId, Window};
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
};

/// Maximum entries in the bounded `LAST_GOOD` diagram cache (`TODO-34`).
pub const MAX_LAST_GOOD_ENTRIES: usize = 64;
/// Maximum decoded bitmap bytes in `LAST_GOOD` (`32 MiB`, `TODO-34`).
pub const MAX_LAST_GOOD_BYTES: usize = 32 * 1024 * 1024;

/// Bounded LRU cache for last-good diagram bitmaps (`(EntityId, block_offset)`),
/// keeping previous good frames visible while edits re-render without unbounded growth.
pub struct LastGoodCache<R = Rendered> {
    entries: HashMap<(u64, usize), (R, usize, u64)>,
    clock: u64,
    max_entries: usize,
    max_bytes: usize,
    total_bytes: usize,
}

impl<R: Clone> Default for LastGoodCache<R> {
    fn default() -> Self {
        Self::new(MAX_LAST_GOOD_ENTRIES, MAX_LAST_GOOD_BYTES)
    }
}

impl<R: Clone> LastGoodCache<R> {
    pub fn new(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            clock: 0,
            max_entries: max_entries.max(1),
            max_bytes: max_bytes.max(1),
            total_bytes: 0,
        }
    }

    pub fn get(&mut self, slot: (u64, usize)) -> Option<R> {
        self.clock += 1;
        let now = self.clock;
        let entry = self.entries.get_mut(&slot)?;
        entry.2 = now;
        Some(entry.0.clone())
    }

    pub fn insert(&mut self, slot: (u64, usize), rendered: R, bytes: usize) {
        if bytes > self.max_bytes {
            return;
        }
        if let Some((_, old_bytes, _)) = self.entries.remove(&slot) {
            self.total_bytes = self.total_bytes.saturating_sub(old_bytes);
        }
        self.clock += 1;
        let now = self.clock;
        self.total_bytes += bytes;
        self.entries.insert(slot, (rendered, bytes, now));
        while self.entries.len() > self.max_entries || self.total_bytes > self.max_bytes {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (_, _, used))| *used)
                .map(|(k, _)| *k)
            else {
                break;
            };
            if let Some((_, b, _)) = self.entries.remove(&oldest) {
                self.total_bytes = self.total_bytes.saturating_sub(b);
            }
        }
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

/// Deterministic queue/deduplication/cancellation coordinator (`TODO-34`).
/// Mirrors `render_service`'s invariants in a pure state machine so queue
/// deduplication, slot cancellation, and `Unavailable` retryability are
/// unit-tested without requiring a live native window.
pub struct RenderQueueCore<V> {
    settled: HashMap<u64, (Result<V, String>, u64)>,
    pending_keys: HashMap<u64, usize>,
    slots: HashMap<RenderSlot, u64>,
    queue: VecDeque<(u64, bool)>,
    busy: Option<u64>,
    clock: u64,
    max_entries: usize,
}

impl<V: Clone> RenderQueueCore<V> {
    pub fn new(max_entries: usize) -> Self {
        Self {
            settled: HashMap::new(),
            pending_keys: HashMap::new(),
            slots: HashMap::new(),
            queue: VecDeque::new(),
            busy: None,
            clock: 0,
            max_entries: max_entries.max(1),
        }
    }

    pub fn queued_len(&self) -> usize {
        self.queue
            .iter()
            .filter(|(_, cancelled)| !*cancelled)
            .count()
    }

    /// Submits `key` for `slot`:
    /// - returns cached `Ok(Ready)` / `Err(Failed)` on cache hit;
    /// - deduplicates concurrent requests sharing `key`;
    /// - cancels `slot`'s superseded queued request when `slot` moves to a new `key`.
    pub fn request(&mut self, slot: RenderSlot, key: u64) -> Option<Result<V, String>> {
        if let Some(prev) = self.slots.insert(slot, key)
            && prev != key
        {
            self.release_key_ref(prev);
        }
        self.clock += 1;
        let now = self.clock;
        if let Some(entry) = self.settled.get_mut(&key) {
            entry.1 = now;
            return Some(entry.0.clone());
        }
        let refs = self.pending_keys.entry(key).or_insert(0);
        *refs += 1;
        let already_enqueued =
            self.busy == Some(key) || self.queue.iter().any(|(k, c)| !*c && *k == key);
        if !already_enqueued {
            self.queue.push_back((key, false));
        }
        None
    }

    pub fn cancel_slot(&mut self, slot: RenderSlot) {
        if let Some(prev) = self.slots.remove(&slot) {
            self.release_key_ref(prev);
        }
    }

    fn release_key_ref(&mut self, key: u64) {
        if self.slots.values().any(|&k| k == key) {
            return;
        }
        self.pending_keys.remove(&key);
        if self.busy != Some(key) {
            for (queued_key, cancelled) in &mut self.queue {
                if *queued_key == key {
                    *cancelled = true;
                }
            }
        }
    }

    /// Advances the queue to the next non-cancelled request.
    pub fn pop_next(&mut self) -> Option<u64> {
        if self.busy.is_some() {
            return None;
        }
        while let Some((key, cancelled)) = self.queue.pop_front() {
            if cancelled || !self.pending_keys.contains_key(&key) || self.settled.contains_key(&key)
            {
                continue;
            }
            self.busy = Some(key);
            return Some(key);
        }
        None
    }

    /// Completes `key`. `None` represents `State::Unavailable` and is NEVER
    /// stored in `settled`, allowing subsequent retries to succeed (`TODO-34`).
    pub fn complete(&mut self, key: u64, outcome: Option<Result<V, String>>) {
        if self.busy == Some(key) {
            self.busy = None;
        }
        self.pending_keys.remove(&key);
        let Some(result) = outcome else {
            return;
        };
        self.clock += 1;
        let now = self.clock;
        self.settled.insert(key, (result, now));
        while self.settled.len() > self.max_entries {
            let Some(oldest) = self
                .settled
                .iter()
                .min_by_key(|(_, (_, used))| *used)
                .map(|(k, _)| *k)
            else {
                break;
            };
            self.settled.remove(&oldest);
        }
    }

    pub fn retry(&mut self, key: u64) {
        self.settled.remove(&key);
    }
}

thread_local! {
    static LAST_GOOD: RefCell<LastGoodCache<Rendered>> = RefCell::new(LastGoodCache::default());
}

pub fn slot_for(entity: EntityId, offset: usize) -> RenderSlot {
    (entity.as_u64(), offset)
}

/// Requests a Mermaid/KaTeX drawing for `slot`, deduplicating identical keys
/// and cancelling stale queued requests previously issued by `slot`.
pub fn get_for_slot(
    slot: RenderSlot,
    request: &Request,
    window: &mut Window,
    cx: &mut App,
) -> State {
    crate::render_service::get_for_slot(slot, request, window, cx)
}

pub fn get(request: &Request, window: &mut Window, cx: &mut App) -> State {
    crate::render_service::get(request, window, cx)
}

pub fn cancel_slot(slot: RenderSlot) {
    crate::render_service::cancel_slot(slot);
}

/// Invalidates `request` (clearing `Failed` or transient cooldowns) and refreshes windows.
pub fn retry(request: &Request, cx: &mut App) {
    crate::render_service::invalidate(request);
    cx.refresh_windows();
}

/// Records a successful diagram frame in the bounded `LAST_GOOD` LRU cache.
pub fn record_last_good(entity: EntityId, offset: usize, rendered: &Rendered) {
    let size = rendered.image.size(0);
    let bytes = (size.width.0.max(1) as usize) * (size.height.0.max(1) as usize) * 4;
    LAST_GOOD.with(|c| {
        c.borrow_mut()
            .insert(slot_for(entity, offset), rendered.clone(), bytes)
    });
}

/// Reads the most recent good diagram frame for `(entity, offset)`, if still in LRU.
pub fn last_good(entity: EntityId, offset: usize) -> Option<Rendered> {
    LAST_GOOD.with(|c| c.borrow_mut().get(slot_for(entity, offset)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn render_broker_deduplicates_cancels_superseded_and_retries_unavailable() {
        let mut q: RenderQueueCore<&'static str> = RenderQueueCore::new(16);

        // Two slots requesting identical formula/diagram key 10 share a single queued job.
        assert_eq!(q.request((1, 0), 10), None);
        assert_eq!(q.request((2, 0), 10), None);
        assert_eq!(
            q.queued_len(),
            1,
            "identical keys must deduplicate in-flight"
        );

        // Slot (3, 100) types v1 (key 20), then v2 (key 21) before key 20 is popped:
        // key 20 is cancelled and skipped when queue advances!
        assert_eq!(q.request((3, 100), 20), None);
        assert_eq!(q.request((3, 100), 21), None);
        assert_eq!(q.queued_len(), 2, "superseded key 20 cancelled immediately");

        // Pop first job: key 10. Simulate transient `Unavailable` (`None`).
        assert_eq!(q.pop_next(), Some(10));
        q.complete(10, None);

        // Next job skips cancelled key 20 and advances straight to key 21!
        assert_eq!(q.pop_next(), Some(21));
        q.complete(21, Some(Ok("diagram-v2")));
        assert_eq!(q.request((3, 100), 21), Some(Ok("diagram-v2")));

        // Because `Unavailable` was NEVER cached, retrying key 10 enqueues afresh and succeeds!
        assert_eq!(q.request((1, 0), 10), None);
        assert_eq!(q.pop_next(), Some(10));
        q.complete(10, Some(Ok("formula-ready")));
        assert_eq!(q.request((1, 0), 10), Some(Ok("formula-ready")));
    }

    #[test]
    fn last_good_cache_enforces_entry_and_byte_lru_bounds() {
        let mut cache: LastGoodCache<&'static str> = LastGoodCache::new(2, 200);
        cache.insert((1, 0), "svg-1", 90);
        cache.insert((1, 10), "svg-2", 90);
        assert_eq!(cache.get((1, 0)), Some("svg-1"));
        // Adding a 3rd entry evicts least-recently-used `(1, 10)`.
        cache.insert((1, 20), "svg-3", 90);
        assert_eq!(cache.len(), 2);
        assert_eq!(cache.get((1, 10)), None);
        assert_eq!(cache.get((1, 0)), Some("svg-1"));
        assert_eq!(cache.get((1, 20)), Some("svg-3"));
    }
}
