//! The product sizes and checks display entries once per object
//! (`display-window.mjs` keeps `WeakMap` caches of their JSON bytes and
//! node counts). Entries here are immutable shared values, so the same
//! per-entry facts are cached by allocation, weakly, and a revision only
//! measures the entries it rebuilt.
use super::display_types::Entry;
use super::js;
use crate::text;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, Weak};

/// What one entry costs and whether its JSON is display-safe.
#[derive(Clone, Debug)]
pub struct EntryMetrics {
    /// `TextEncoder().encode(JSON.stringify(entry)).byteLength`.
    pub bytes: usize,
    /// `nodeCount(entry)`: one per value, objects and arrays included.
    pub nodes: usize,
    /// The deepest nesting below the entry (the entry itself is 0).
    pub depth: usize,
    /// The longest string, in UTF-16 units.
    pub longest_text: usize,
    /// An object key the display may not carry (`__proto__`, …).
    pub unsafe_key: bool,
    /// A non-finite number.
    pub non_finite: bool,
    /// The collection the entry was last validated for.
    pub validated_for: Option<&'static str>,
}

struct Cached {
    entry: Weak<Value>,
    metrics: EntryMetrics,
}

static CACHE: LazyLock<Mutex<(HashMap<usize, Cached>, usize)>> =
    LazyLock::new(|| Mutex::new((HashMap::new(), 4_096)));

fn measure(value: &Value) -> EntryMetrics {
    fn walk(value: &Value, depth: usize, m: &mut EntryMetrics) {
        m.nodes += 1;
        m.depth = m.depth.max(depth);
        match value {
            Value::String(text) => m.longest_text = m.longest_text.max(text::len16(text)),
            Value::Number(n) => m.non_finite |= !n.as_f64().is_some_and(f64::is_finite),
            Value::Array(items) => items.iter().for_each(|item| walk(item, depth + 1, m)),
            Value::Object(map) => map.iter().for_each(|(key, item)| {
                m.unsafe_key |= matches!(key.as_str(), "__proto__" | "constructor" | "prototype");
                walk(item, depth + 1, m)
            }),
            _ => {}
        }
    }
    let mut metrics = EntryMetrics {
        bytes: js::json_byte_length(value),
        nodes: 0,
        depth: 0,
        longest_text: 0,
        unsafe_key: false,
        non_finite: false,
        validated_for: None,
    };
    walk(value, 0, &mut metrics);
    metrics
}

/// The metrics of `entry`, measured once per allocation.
pub fn entry_metrics(entry: &Entry) -> EntryMetrics {
    let key = Arc::as_ptr(entry) as usize;
    {
        let cache = CACHE.lock().expect("display metrics");
        if let Some(cached) = cache.0.get(&key)
            && cached.entry.strong_count() > 0
        {
            return cached.metrics.clone();
        }
    }
    let metrics = measure(entry);
    let mut cache = CACHE.lock().expect("display metrics");
    let (map, limit) = &mut *cache;
    map.insert(
        key,
        Cached {
            entry: Arc::downgrade(entry),
            metrics: metrics.clone(),
        },
    );
    if map.len() > *limit {
        map.retain(|_, cached| cached.entry.strong_count() > 0);
        *limit = (map.len() * 2).max(4_096);
    }
    metrics
}

/// Records that `entry` passed validation as a member of `collection`.
pub fn mark_validated(entry: &Entry, collection: &'static str) {
    let key = Arc::as_ptr(entry) as usize;
    let mut cache = CACHE.lock().expect("display metrics");
    if let Some(cached) = cache.0.get_mut(&key)
        && cached.entry.strong_count() > 0
    {
        cached.metrics.validated_for = Some(collection);
    }
}
