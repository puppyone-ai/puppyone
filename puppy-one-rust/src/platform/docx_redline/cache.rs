//! Successful semantic models only. The owner is one workspace view; byte
//! readers and file descriptors never live in this cache.
use super::Presentation;
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

const MAX_ENTRIES: usize = 8;
const MAX_WEIGHT: usize = 24 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(5 * 60);
const VERSION: u32 = 3;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Key {
    repository: PathBuf,
    path: String,
    before: String,
    after: String,
    version: u32,
}
impl Key {
    pub(crate) fn new(repository: PathBuf, path: String, before: String, after: String) -> Self {
        Self {
            repository,
            path,
            before,
            after,
            version: VERSION,
        }
    }
}
struct Entry {
    key: Key,
    model: Presentation,
    weight: usize,
    expires: Instant,
}
#[derive(Default)]
struct State {
    entries: VecDeque<Entry>,
    weight: usize,
    generation: u64,
    closed: bool,
    running: bool,
}
struct Shared {
    state: Mutex<State>,
    changed: Condvar,
    clock: Arc<dyn Fn() -> Instant + Send + Sync>,
    max_entries: usize,
    max_weight: usize,
    ttl: Duration,
}
pub(crate) struct Cache {
    shared: Arc<Shared>,
}
impl Default for Cache {
    fn default() -> Self {
        Self::new(MAX_ENTRIES, MAX_WEIGHT, TTL, Arc::new(Instant::now))
    }
}
impl Cache {
    fn new(
        max_entries: usize,
        max_weight: usize,
        ttl: Duration,
        clock: Arc<dyn Fn() -> Instant + Send + Sync>,
    ) -> Self {
        Self {
            shared: Arc::new(Shared {
                state: Mutex::new(State::default()),
                changed: Condvar::new(),
                clock,
                max_entries,
                max_weight,
                ttl,
            }),
        }
    }
    pub(crate) fn load(
        &self,
        key: Key,
        cancel: &AtomicBool,
        build: impl FnOnce() -> Result<Presentation, String>,
    ) -> Result<Presentation, String> {
        check_cancel(cancel)?;
        let generation = {
            let mut state = self.shared.state.lock().unwrap();
            state.purge((self.shared.clock)());
            if let Some(index) = state.entries.iter().position(|e| e.key == key) {
                let entry = state.entries.remove(index).unwrap();
                let model = entry.model.clone();
                state.entries.push_back(entry);
                check_cancel(cancel)?;
                return Ok(model);
            }
            state.generation
        };
        let model = build()?;
        check_cancel(cancel)?;
        self.insert(key, &model, generation);
        Ok(model)
    }
    fn insert(&self, key: Key, model: &Presentation, generation: u64) {
        let mut state = self.shared.state.lock().unwrap();
        if state.closed || state.generation != generation {
            return;
        }
        let now = (self.shared.clock)();
        state.purge(now);
        if let Some(index) = state.entries.iter().position(|e| e.key == key) {
            state.remove(index);
        }
        let weight = weight(&key, model);
        if weight > self.shared.max_weight {
            return;
        }
        state.weight += weight;
        state.entries.push_back(Entry {
            key,
            model: model.clone(),
            weight,
            expires: now + self.shared.ttl,
        });
        while state.entries.len() > self.shared.max_entries || state.weight > self.shared.max_weight
        {
            state.remove(0);
        }
        self.shared.changed.notify_all();
        if !state.running && !state.entries.is_empty() {
            state.running = true;
            let shared = self.shared.clone();
            if std::thread::Builder::new()
                .name("word-diff-cache-expiry".into())
                .spawn(move || expire(shared))
                .is_err()
            {
                // A cache is optional; never retain models without an expiry owner.
                state.entries.clear();
                state.weight = 0;
                state.running = false;
            }
        }
    }
    /// Retire a workspace permanently, including readers still holding it.
    pub(crate) fn invalidate(&self) {
        let mut state = self.shared.state.lock().unwrap();
        state.generation += 1;
        state.closed = true;
        state.entries.clear();
        state.weight = 0;
        self.shared.changed.notify_all();
    }
    #[cfg(any(test, feature = "test-support"))]
    pub(crate) fn usage(&self) -> (usize, usize) {
        let state = self.shared.state.lock().unwrap();
        (state.entries.len(), state.weight)
    }
}
impl Drop for Cache {
    fn drop(&mut self) {
        self.invalidate();
    }
}
impl State {
    fn remove(&mut self, index: usize) {
        self.weight -= self.entries.remove(index).unwrap().weight;
    }
    fn purge(&mut self, now: Instant) {
        for index in (0..self.entries.len()).rev() {
            if self.entries[index].expires <= now {
                self.remove(index);
            }
        }
    }
}
fn expire(shared: Arc<Shared>) {
    let mut state = shared.state.lock().unwrap();
    loop {
        let now = (shared.clock)();
        state.purge(now);
        shared.changed.notify_all();
        let Some(next) = state.entries.iter().map(|e| e.expires).min() else {
            state.running = false;
            return;
        };
        state = shared
            .changed
            .wait_timeout(state, next.saturating_duration_since(now))
            .unwrap()
            .0;
    }
}
fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) {
        Err(super::control::CANCELLED.into())
    } else {
        Ok(())
    }
}
fn weight(key: &Key, model: &Presentation) -> usize {
    // Conservative native allocation accounting, including keys. UTF-16 text
    // estimates preserve the product's weight budget for non-ASCII models.
    let mut bytes = 512
        + key.repository.as_os_str().len()
        + key.path.capacity()
        + key.before.capacity()
        + key.after.capacity();
    bytes += model.changes.capacity() * std::mem::size_of::<super::Change>();
    for change in &model.changes {
        bytes += 192 + change.segments.capacity() * std::mem::size_of::<super::Segment>();
        for segment in &change.segments {
            bytes += 48
                + segment
                    .text
                    .capacity()
                    .max(segment.text.encode_utf16().count() * 2);
        }
    }
    bytes
}
#[cfg(test)]
mod tests;
