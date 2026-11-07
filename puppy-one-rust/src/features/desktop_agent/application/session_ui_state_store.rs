//! `application/SessionUiStateStore.ts`: Renderer-only ephemeral state
//! keyed by application session id.
use crate::agent::contract::dto::PromptMention;
use crate::features::desktop_agent::domain::agent_ui_state::AgentViewportGeometry;

/// `SessionUiState`.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionUiState {
    pub draft: String,
    pub draft_mentions: Vec<PromptMention>,
    pub scroll_top: f64,
    /// `Record<string, number>` in insertion order.
    pub measurements: Vec<(String, f64)>,
    pub pinned: bool,
    pub geometry: Option<AgentViewportGeometry>,
}

impl Default for SessionUiState {
    fn default() -> Self {
        Self {
            draft: String::new(),
            draft_mentions: Vec::new(),
            scroll_top: 0.,
            measurements: Vec::new(),
            pinned: true,
            geometry: None,
        }
    }
}

/// `Partial<SessionUiState>`.
#[derive(Clone, Debug, Default)]
pub struct SessionUiPatch {
    pub draft: Option<String>,
    pub draft_mentions: Option<Vec<PromptMention>>,
    pub scroll_top: Option<f64>,
    pub measurements: Option<Vec<(String, f64)>>,
    pub pinned: Option<bool>,
    pub geometry: Option<AgentViewportGeometry>,
}

pub const DEFAULT_MAX_ENTRIES: usize = 100;
pub const DEFAULT_MAX_MEASUREMENTS_PER_SESSION: usize = 1_000;

type Draft = (String, Vec<PromptMention>);

/// `new SessionUiStateStore(maxEntries, maxMeasurementsPerSession)`.
pub struct SessionUiStateStore {
    max_entries: usize,
    max_measurements_per_session: usize,
    /// Insertion order doubles as an inexpensive LRU list.
    entries: Vec<(String, SessionUiState)>,
    /// Unsent input is user state, never an evictable measurement cache.
    drafts: Vec<(String, Draft)>,
}

impl Default for SessionUiStateStore {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_ENTRIES, DEFAULT_MAX_MEASUREMENTS_PER_SESSION).expect("valid limits")
    }
}

/// `{ ...a, [key]: value }` over an insertion-ordered record.
fn set_entry<T>(entries: &mut Vec<(String, T)>, key: &str, value: T) {
    match entries.iter_mut().find(|(k, _)| k == key) {
        Some(slot) => slot.1 = value,
        None => entries.push((key.to_string(), value)),
    }
}

impl SessionUiStateStore {
    pub fn new(max_entries: usize, max_measurements_per_session: usize) -> Result<Self, String> {
        if max_entries < 1 {
            return Err("Session UI cache size must be a positive integer.".into());
        }
        if max_measurements_per_session < 1 {
            return Err("Session UI measurement limit must be a positive integer.".into());
        }
        Ok(Self {
            max_entries,
            max_measurements_per_session,
            entries: Vec::new(),
            drafts: Vec::new(),
        })
    }

    pub fn read(&mut self, key: &str) -> SessionUiState {
        let stored = self
            .entries
            .iter()
            .position(|(k, _)| k == key)
            .map(|index| self.entries.remove(index).1);
        if let Some(stored) = &stored {
            self.entries.push((key.to_string(), stored.clone()));
        }
        let mut value = stored.unwrap_or_default();
        if let Some((_, (draft, mentions))) = self.drafts.iter().find(|(k, _)| k == key) {
            value.draft = draft.clone();
            value.draft_mentions = mentions.clone();
        }
        value
    }

    pub fn patch(&mut self, key: &str, value: SessionUiPatch) {
        let current = self.read(key);
        let measurements = match value.measurements {
            Some(measurements) => {
                // `Object.fromEntries(entries.slice(-max))`.
                let mut record: Vec<(String, f64)> = Vec::new();
                let start = measurements
                    .len()
                    .saturating_sub(self.max_measurements_per_session);
                for (k, v) in measurements.into_iter().skip(start) {
                    set_entry(&mut record, &k, v);
                }
                record
            }
            None => current.measurements.clone(),
        };
        let updated = SessionUiState {
            draft: value.draft.unwrap_or(current.draft),
            draft_mentions: value.draft_mentions.unwrap_or(current.draft_mentions),
            scroll_top: value.scroll_top.unwrap_or(current.scroll_top),
            measurements,
            pinned: value.pinned.unwrap_or(current.pinned),
            geometry: value.geometry.or(current.geometry),
        };
        self.entries.retain(|(k, _)| k != key);
        self.entries.push((key.to_string(), updated.clone()));
        if !updated.draft.is_empty() || !updated.draft_mentions.is_empty() {
            set_entry(
                &mut self.drafts,
                key,
                (updated.draft, updated.draft_mentions),
            );
        } else {
            self.drafts.retain(|(k, _)| k != key);
        }
        while self.entries.len() > self.max_entries {
            self.entries.remove(0);
        }
    }

    pub fn delete(&mut self, key: &str) {
        self.entries.retain(|(k, _)| k != key);
        self.drafts.retain(|(k, _)| k != key);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.drafts.clear();
    }
}
