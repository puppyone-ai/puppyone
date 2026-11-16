//! Per-resource view state (`WB-10`, `WB-11`, `WB-31`): selection, scroll
//! position, active mode, zoom and fold state captured from live surfaces,
//! persisted with workbench metadata in a bounded LRU map, and clamped safely
//! against current document bounds on restore.

use serde::{Deserialize, Serialize};

/// Maximum number of resource view states retained per workspace (`WB-10`).
pub const MAX_VIEW_STATE_ENTRIES: usize = 128;

/// Maximum serialized byte budget across all retained view states (`WB-10`).
pub const MAX_VIEW_STATE_BYTES: usize = 256 * 1024;

const MAX_MODE_BYTES: usize = 64;
const MAX_FOLDS_PER_ENTRY: usize = 512;

/// Serializable view state of a single viewer surface (`WB-10`).
///
/// Never stores document text or unsaved input.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SurfaceViewState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<(usize, usize)>,
    #[serde(default)]
    pub scroll_y: f32,
    #[serde(default)]
    pub scroll_x: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folds: Vec<(usize, bool)>,
}

impl SurfaceViewState {
    /// Normalizes untrusted or floating-point values before storage or restore.
    pub fn sanitized(&self) -> Self {
        let scroll_y = if self.scroll_y.is_finite() && self.scroll_y >= 0.0 {
            self.scroll_y
        } else {
            0.0
        };
        let scroll_x = if self.scroll_x.is_finite() && self.scroll_x >= 0.0 {
            self.scroll_x
        } else {
            0.0
        };
        let zoom = self.zoom.filter(|z| z.is_finite() && *z > 0.0);
        let mode = self
            .mode
            .as_ref()
            .filter(|m| !m.is_empty() && m.len() <= MAX_MODE_BYTES)
            .cloned();
        let folds = self
            .folds
            .iter()
            .copied()
            .take(MAX_FOLDS_PER_ENTRY)
            .collect();
        Self {
            selection: self.selection,
            scroll_y,
            scroll_x,
            mode,
            zoom,
            folds,
        }
    }

    /// Clamps `(anchor, head)` byte offsets to valid UTF-8 character boundaries
    /// within `text` (`WB-11`).
    pub fn clamped_selection(&self, text: &str) -> Option<(usize, usize)> {
        let (anchor, head) = self.selection?;
        Some((
            clamp_utf8_boundary(text, anchor),
            clamp_utf8_boundary(text, head),
        ))
    }

    /// Filters fold entries to lines that still exist in a `line_count`-line document (`WB-11`).
    pub fn clamped_folds(&self, line_count: usize) -> Vec<(usize, bool)> {
        self.folds
            .iter()
            .copied()
            .filter(|(line, _)| *line < line_count)
            .collect()
    }

    /// Clamps scroll coordinates to `[0.0, max]`, defaulting non-finite values to `0.0`.
    pub fn clamped_scroll(&self, max_x: Option<f32>, max_y: Option<f32>) -> (f32, f32) {
        let mut x = if self.scroll_x.is_finite() && self.scroll_x >= 0.0 {
            self.scroll_x
        } else {
            0.0
        };
        let mut y = if self.scroll_y.is_finite() && self.scroll_y >= 0.0 {
            self.scroll_y
        } else {
            0.0
        };
        if let Some(mx) = max_x.filter(|m| m.is_finite() && *m >= 0.0) {
            x = x.min(mx);
        }
        if let Some(my) = max_y.filter(|m| m.is_finite() && *m >= 0.0) {
            y = y.min(my);
        }
        (x, y)
    }
}

pub fn clamp_utf8_boundary(text: &str, offset: usize) -> usize {
    let mut idx = offset.min(text.len());
    while idx > 0 && !text.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PersistedViewStateEntry {
    pub resource: String,
    pub state: SurfaceViewState,
}

/// Bounded LRU store of per-resource [`SurfaceViewState`] entries (`WB-10`).
///
/// Oldest entries are evicted whenever entry count exceeds [`MAX_VIEW_STATE_ENTRIES`]
/// or serialized byte footprint exceeds [`MAX_VIEW_STATE_BYTES`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ViewStateStore {
    /// Ordered oldest-first, MRU-last.
    entries: Vec<(String, SurfaceViewState)>,
    max_entries: usize,
    max_bytes: usize,
}

impl ViewStateStore {
    pub fn new() -> Self {
        Self::with_limits(MAX_VIEW_STATE_ENTRIES, MAX_VIEW_STATE_BYTES)
    }

    pub fn with_limits(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            entries: Vec::new(),
            max_entries: max_entries.max(1),
            max_bytes: max_bytes.max(256),
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn total_bytes(&self) -> usize {
        self.entries
            .iter()
            .map(|(k, v)| entry_byte_cost(k, v))
            .sum()
    }

    pub fn get(&self, resource_key: &str) -> Option<&SurfaceViewState> {
        self.entries
            .iter()
            .rev()
            .find(|(k, _)| k == resource_key)
            .map(|(_, v)| v)
    }

    pub fn insert(&mut self, resource_key: impl Into<String>, state: SurfaceViewState) {
        let key = resource_key.into();
        if key.is_empty() {
            return;
        }
        if self.max_entries == 0 {
            self.max_entries = MAX_VIEW_STATE_ENTRIES;
        }
        if self.max_bytes == 0 {
            self.max_bytes = MAX_VIEW_STATE_BYTES;
        }
        let mut sanitized = state.sanitized();
        if entry_byte_cost(&key, &sanitized) > self.max_bytes {
            sanitized.folds.clear();
            if entry_byte_cost(&key, &sanitized) > self.max_bytes {
                return;
            }
        }
        self.entries.retain(|(k, _)| k != &key);
        self.entries.push((key, sanitized));
        self.evict_overflow();
    }

    pub fn touch(&mut self, resource_key: &str) {
        if let Some(pos) = self.entries.iter().position(|(k, _)| k == resource_key) {
            let entry = self.entries.remove(pos);
            self.entries.push(entry);
        }
    }

    pub fn rename(&mut self, from_key: &str, to_key: String) {
        if from_key == to_key || to_key.is_empty() {
            return;
        }
        if let Some(pos) = self.entries.iter().position(|(k, _)| k == from_key) {
            let (_, state) = self.entries.remove(pos);
            self.insert(to_key, state);
        }
    }

    pub fn remove(&mut self, resource_key: &str) {
        self.entries.retain(|(k, _)| k != resource_key);
    }

    pub fn to_persisted(&self) -> Vec<PersistedViewStateEntry> {
        self.entries
            .iter()
            .map(|(resource, state)| PersistedViewStateEntry {
                resource: resource.clone(),
                state: state.clone(),
            })
            .collect()
    }

    pub fn from_persisted(entries: Vec<PersistedViewStateEntry>) -> Self {
        let mut store = Self::new();
        for entry in entries {
            store.insert(entry.resource, entry.state);
        }
        store
    }

    fn evict_overflow(&mut self) {
        while self.entries.len() > self.max_entries
            || (self.entries.len() > 1 && self.total_bytes() > self.max_bytes)
        {
            self.entries.remove(0);
        }
        if self.total_bytes() > self.max_bytes {
            self.entries.clear();
        }
    }
}

fn entry_byte_cost(key: &str, state: &SurfaceViewState) -> usize {
    let entry = PersistedViewStateEntry {
        resource: key.to_owned(),
        state: state.clone(),
    };
    serde_json::to_vec(&entry)
        .map(|bytes| bytes.len())
        .unwrap_or_else(|_| key.len() + 64 + state.folds.len() * 16)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_selection_and_folds_when_document_shrinks_or_has_multibyte_utf8() {
        let state = SurfaceViewState {
            selection: Some((2, 999)),
            scroll_y: f32::NAN,
            scroll_x: -15.0,
            mode: Some("source".into()),
            zoom: Some(1.5),
            folds: vec![(0, true), (2, true), (10, false)],
        };
        let text = "你a\n好b";
        // Byte 2 is inside 3-byte '你' (0..3), so it clamps down to boundary 0; 999 clamps to text.len().
        assert_eq!(state.clamped_selection(text), Some((0, text.len())));
        assert_eq!(state.clamped_folds(2), vec![(0, true)]);
        assert_eq!(state.clamped_scroll(Some(100.0), Some(200.0)), (0.0, 0.0));
    }

    #[test]
    fn view_state_store_evicts_lru_at_entry_and_byte_bounds() {
        let mut store = ViewStateStore::new();
        for idx in 0..140 {
            store.insert(
                format!("local:///doc-{idx}.md"),
                SurfaceViewState {
                    selection: Some((idx, idx + 1)),
                    scroll_y: idx as f32,
                    ..Default::default()
                },
            );
        }
        assert_eq!(store.len(), MAX_VIEW_STATE_ENTRIES);
        assert!(store.total_bytes() <= MAX_VIEW_STATE_BYTES);
        assert!(store.get("local:///doc-0.md").is_none());
        assert!(store.get("local:///doc-139.md").is_some());

        // Byte cap enforcement with smaller custom limit.
        let mut small = ViewStateStore::with_limits(128, 512);
        for idx in 0..20 {
            small.insert(
                format!("local:///file-{idx}.rs"),
                SurfaceViewState {
                    selection: Some((10, 20)),
                    scroll_y: 42.0,
                    folds: vec![(1, true), (4, true), (8, false)],
                    ..Default::default()
                },
            );
        }
        assert!(small.total_bytes() <= 512);
        assert!(small.get("local:///file-19.rs").is_some());
        assert!(small.get("local:///file-0.rs").is_none());
    }
}
