//! `createEmbeddedTableColumnLayoutBrowserPersistence`: explicit tracks
//! stored as one JSON document, the newest layouts first.
use super::{MAX_STORED, Persistence, clamp_width};
use std::{cell::RefCell, collections::BTreeMap};

/// One JSON document holding every stored layout.
pub trait Storage {
    fn get(&self) -> Option<String>;
    fn set(&self, value: &str);
}

#[derive(Default)]
pub struct MemoryStorage(RefCell<Option<String>>);

impl Storage for MemoryStorage {
    fn get(&self) -> Option<String> {
        self.0.borrow().clone()
    }

    fn set(&self, value: &str) {
        *self.0.borrow_mut() = Some(value.to_owned());
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Entry {
    #[serde(rename = "updatedAt", default)]
    updated_at: u64,
    widths: Vec<f32>,
}

/// `createEmbeddedTableColumnLayoutBrowserPersistence`: the newest
/// [`MAX_STORED`] layouts, keyed by document, content and position.
pub struct Preferences<S: Storage> {
    storage: S,
}

impl<S: Storage> Preferences<S> {
    pub fn new(storage: S) -> Self {
        Self { storage }
    }

    fn entries(&self) -> BTreeMap<String, Entry> {
        let Some(raw) = self.storage.get() else {
            return BTreeMap::new();
        };
        let Ok(serde_json::Value::Object(map)) = serde_json::from_str(&raw) else {
            return BTreeMap::new();
        };
        map.into_iter()
            .filter_map(|(key, value)| {
                let entry: Entry = serde_json::from_value(value).ok()?;
                (!entry.widths.is_empty() && entry.widths.iter().all(|w| w.is_finite() && *w > 0.))
                    .then_some((key, entry))
            })
            .collect()
    }

    fn store(&self, entries: &BTreeMap<String, Entry>) {
        if let Ok(json) = serde_json::to_string(entries) {
            self.storage.set(&json);
        }
    }
}

fn wall_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

impl<S: Storage> Persistence for Preferences<S> {
    fn read(&self, key: &str, columns: usize) -> Option<Vec<f32>> {
        let widths = self.entries().remove(key)?.widths;
        (widths.len() == columns).then(|| widths.into_iter().map(clamp_width).collect())
    }

    fn write(&self, key: &str, widths: &[f32], previous: Option<&str>) {
        if widths.is_empty() || widths.iter().any(|w| !w.is_finite() || *w <= 0.) {
            return;
        }
        let widths: Vec<f32> = widths.iter().copied().map(clamp_width).collect();
        let mut entries = self.entries();
        let removed_previous = previous.is_some_and(|p| p != key && entries.remove(p).is_some());
        if !removed_previous && entries.get(key).is_some_and(|e| e.widths == widths) {
            return;
        }
        entries.insert(
            key.to_owned(),
            Entry {
                updated_at: wall_ms(),
                widths,
            },
        );
        if entries.len() > MAX_STORED {
            let mut by_age: Vec<(u64, String)> = entries
                .iter()
                .map(|(k, e)| (e.updated_at, k.clone()))
                .collect();
            by_age.sort_by_key(|(age, _)| std::cmp::Reverse(*age));
            for (_, old) in by_age.into_iter().skip(MAX_STORED) {
                entries.remove(&old);
            }
        }
        self.store(&entries);
    }

    fn remove(&self, key: &str) {
        let mut entries = self.entries();
        if entries.remove(key).is_some() {
            self.store(&entries);
        }
    }
}
