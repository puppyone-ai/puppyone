//! Per-view table column layout sessions (TS
//! `embeddedTableColumnLayoutSession.ts`): a table's column tracks are
//! presentation state, outside the source and its history, that still follow
//! the table through transactions and column operations. Automatic tracks
//! remember the reading width they were laid out for and reflow only when it
//! changes; explicit tracks (resized, auto-fitted) stay fixed and persist per
//! document, table content and position, so reopening the same table
//! restores them.
use super::continuity::{Mapping, SequenceChange};
#[cfg(not(test))]
use crate::editor::markdown::platform::brokers::preferences::FileStorage;
use std::{cell::RefCell, ops::Range, rc::Rc, sync::OnceLock, time::Instant};

/// `DEFAULT_MAX_DETACHED_SESSIONS`.
pub const MAX_DETACHED: usize = 128;
/// `MAX_STORED_LAYOUT_PREFERENCES`.
pub const MAX_STORED: usize = 300;
/// `EMBEDDED_TABLE_COLUMN_MIN_WIDTH` / `_MAX_WIDTH`: a column stays
/// clickable; only explicit resizing has a ceiling.
pub const MIN_WIDTH: f32 = 48.;
pub const MAX_WIDTH: f32 = 960.;
/// The preference file's name under the editor's data directory
/// (`puppyone.editor.markdown-table-view-preferences.v1`).
pub const PREFERENCES_FILE: &str = "markdown-table-view-preferences.v1.json";

/// `clampEmbeddedTableColumnWidth`: an explicit track, whole pixels.
pub fn clamp_width(width: f32) -> f32 {
    if width.is_finite() {
        width.round().clamp(MIN_WIDTH, MAX_WIDTH)
    } else {
        MIN_WIDTH
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lifecycle {
    Mounted,
    Detached,
}

/// `EmbeddedTableColumnLayoutSession`.
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub id: u64,
    pub feature: &'static str,
    pub range: Range<usize>,
    pub identity: u64,
    pub widths: Vec<f32>,
    pub lifecycle: Lifecycle,
    pub mount: u64,
    /// The person set these tracks; they persist and never reflow.
    pub explicit: bool,
    /// The reading width automatic tracks were laid out for; `None` when
    /// explicit, or when a column was added or removed since.
    pub auto_layout_width: Option<f32>,
}

/// Where explicit tracks are kept between openings.
pub trait Persistence {
    fn read(&self, key: &str, columns: usize) -> Option<Vec<f32>>;
    /// Store `widths` under `key`, moving them from `previous`.
    fn write(&self, key: &str, widths: &[f32], previous: Option<&str>);
    fn remove(&self, key: &str);
}

struct Stored {
    session: Session,
    accepts_next_identity: bool,
    touched: u64,
    namespace: Option<String>,
    key: Option<String>,
}

pub type Shared = Rc<RefCell<Store>>;

pub struct Store {
    sessions: Vec<Stored>,
    max_detached: usize,
    now: Rc<dyn Fn() -> u64>,
    persistence: Option<Rc<dyn Persistence>>,
    next_session: u64,
    next_mount: u64,
}

fn monotonic_ms() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

impl Default for Store {
    fn default() -> Self {
        Self::with(MAX_DETACHED, Rc::new(monotonic_ms), None)
    }
}

/// `createPersistenceKey`: the document, the table's content and position.
pub fn persistence_key(namespace: Option<&str>, identity: u64, from: usize) -> Option<String> {
    let namespace = namespace?.trim();
    (!namespace.is_empty())
        .then(|| serde_json::json!([namespace, format!("{identity:016x}"), from]).to_string())
}

/// `resolveWidths`: `widths`, completed from `fallback`.
fn resolve(widths: &[f32], fallback: &[f32]) -> Vec<f32> {
    (0..widths.len().max(fallback.len()))
        .map(|i| {
            widths
                .get(i)
                .or_else(|| fallback.get(i))
                .or_else(|| fallback.last())
                .copied()
                .unwrap_or(0.)
        })
        .collect()
}

/// `mapColumnWidths`: tracks move with their columns; an inserted track
/// starts at the floor until automatic layout runs.
fn map_widths(widths: &[f32], change: SequenceChange) -> Vec<f32> {
    let mut next = widths.to_vec();
    match change {
        SequenceChange::Preserve => {}
        SequenceChange::Insert { index, count } => {
            let at = index.min(next.len());
            next.splice(at..at, std::iter::repeat_n(MIN_WIDTH, count));
        }
        SequenceChange::Delete { index, count } => {
            let at = index.min(next.len());
            next.drain(at..(at + count).min(next.len()));
        }
        SequenceChange::Move { from, to } if !next.is_empty() => {
            let last = next.len() - 1;
            let moved = next.remove(from.min(last));
            next.insert(to.min(last), moved);
        }
        SequenceChange::Move { .. } => {}
    }
    next
}

impl Store {
    pub fn with(
        max_detached: usize,
        now: Rc<dyn Fn() -> u64>,
        persistence: Option<Rc<dyn Persistence>>,
    ) -> Self {
        Self {
            sessions: Vec::new(),
            max_detached,
            now,
            persistence,
            next_session: 0,
            next_mount: 0,
        }
    }

    /// The product's store: explicit tracks persist in the editor's data
    /// directory.
    pub fn shared() -> Shared {
        // Tests never touch the person's preference file.
        #[cfg(not(test))]
        let persistence: Rc<dyn Persistence> =
            Rc::new(Preferences::new(FileStorage::named(PREFERENCES_FILE)));
        #[cfg(test)]
        let persistence: Rc<dyn Persistence> = Rc::new(Preferences::new(MemoryStorage::default()));
        Rc::new(RefCell::new(Self::with(
            MAX_DETACHED,
            Rc::new(monotonic_ms),
            Some(persistence),
        )))
    }

    pub fn persistence(&self) -> Option<Rc<dyn Persistence>> {
        self.persistence.clone()
    }

    pub fn set_persistence(&mut self, persistence: Option<Rc<dyn Persistence>>) {
        self.persistence = persistence;
    }

    fn prune(&mut self) {
        let mut detached: Vec<(u64, u64)> = self
            .sessions
            .iter()
            .filter(|s| s.session.lifecycle == Lifecycle::Detached)
            .map(|s| (s.touched, s.session.id))
            .collect();
        detached.sort_by_key(|(touched, _)| *touched);
        let overflow = detached.len().saturating_sub(self.max_detached);
        let evicted: Vec<u64> = detached[..overflow].iter().map(|(_, id)| *id).collect();
        self.sessions.retain(|s| !evicted.contains(&s.session.id));
    }

    fn mounted(&mut self, id: u64, mount: u64) -> Option<&mut Stored> {
        self.sessions.iter_mut().find(|s| {
            s.session.id == id
                && s.session.mount == mount
                && s.session.lifecycle == Lifecycle::Mounted
        })
    }

    fn write(&self, key: &str, widths: &[f32], previous: Option<&str>) {
        if let Some(p) = &self.persistence {
            p.write(key, widths, previous);
        }
    }

    /// The session of the table at `range` with `identity`: the existing one
    /// (also after a continuity changed its identity), or a new one with the
    /// persisted tracks of the same document, content and position, else
    /// `initial` laid out for `layout_width`.
    pub fn acquire(
        &mut self,
        feature: &'static str,
        initial: &[f32],
        layout_width: Option<f32>,
        range: Range<usize>,
        namespace: Option<&str>,
        identity: u64,
    ) -> Session {
        self.prune();
        let now = (self.now)();
        self.next_mount += 1;
        let mount = self.next_mount;
        let namespace = namespace
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_owned);
        let key = persistence_key(namespace.as_deref(), identity, range.start);
        if let Some(index) = self.sessions.iter().position(|s| {
            s.session.feature == feature
                && s.session.range == range
                && (s.session.identity == identity || s.accepts_next_identity)
        }) {
            let existing = &mut self.sessions[index];
            let widths = resolve(&existing.session.widths, initial);
            let previous = std::mem::replace(&mut existing.key, key.clone());
            existing.namespace = namespace;
            existing.session.range = range;
            existing.session.identity = identity;
            existing.session.widths = widths.clone();
            existing.session.lifecycle = Lifecycle::Mounted;
            existing.session.mount = mount;
            existing.accepts_next_identity = false;
            existing.touched = now;
            let session = existing.session.clone();
            if session.explicit
                && let Some(key) = &key
            {
                self.write(key, &widths, previous.as_deref());
            }
            return session;
        }
        let persisted = key
            .as_deref()
            .and_then(|k| self.persistence.as_ref()?.read(k, initial.len()));
        self.next_session += 1;
        let session = Session {
            id: self.next_session,
            feature,
            range,
            identity,
            explicit: persisted.is_some(),
            auto_layout_width: if persisted.is_some() {
                None
            } else {
                layout_width
            },
            widths: persisted.unwrap_or_else(|| initial.to_vec()),
            lifecycle: Lifecycle::Mounted,
            mount,
        };
        self.sessions.push(Stored {
            session: session.clone(),
            accepts_next_identity: false,
            touched: now,
            namespace,
            key,
        });
        session
    }

    pub fn get(&mut self, id: u64) -> Option<Session> {
        self.sessions
            .iter()
            .find(|s| s.session.id == id)
            .map(|s| s.session.clone())
    }

    /// The person's tracks: explicit from now on, and persisted.
    pub fn set_widths(&mut self, id: u64, mount: u64, widths: &[f32]) -> Option<Session> {
        let now = (self.now)();
        let stored = self.mounted(id, mount)?;
        stored.session.explicit = true;
        stored.session.auto_layout_width = None;
        stored.session.widths = widths.iter().copied().map(clamp_width).collect();
        stored.touched = now;
        let (session, key) = (stored.session.clone(), stored.key.clone());
        if let Some(key) = key {
            self.write(&key, &session.widths, None);
        }
        Some(session)
    }

    /// Automatic tracks reflowed for a new reading width: neither explicit
    /// nor persisted. Refused for explicit tracks.
    pub fn set_auto_widths(
        &mut self,
        id: u64,
        mount: u64,
        widths: &[f32],
        layout_width: f32,
    ) -> Option<Session> {
        let now = (self.now)();
        let stored = self.mounted(id, mount)?;
        if stored.session.explicit {
            return None;
        }
        stored.session.auto_layout_width = Some(layout_width);
        stored.session.widths = widths.iter().copied().map(clamp_width).collect();
        stored.touched = now;
        Some(stored.session.clone())
    }

    /// Forget the explicit tracks so the table follows the reading column.
    pub fn reset_to_auto(&mut self, id: u64, mount: u64) -> Option<Session> {
        let now = (self.now)();
        let stored = self.mounted(id, mount)?;
        stored.session.explicit = false;
        stored.session.auto_layout_width = None;
        stored.touched = now;
        let (session, key) = (stored.session.clone(), stored.key.clone());
        if let (Some(key), Some(p)) = (key, &self.persistence) {
            p.remove(&key);
        }
        Some(session)
    }

    pub fn detach(&mut self, id: u64, mount: u64) {
        let now = (self.now)();
        let Some(stored) = self
            .sessions
            .iter_mut()
            .find(|s| s.session.id == id && s.session.mount == mount)
        else {
            return;
        };
        stored.session.lifecycle = Lifecycle::Detached;
        stored.touched = now;
        self.prune();
    }

    /// Follow one transaction (`mapTransaction`).
    pub fn map(&mut self, mapping: &Mapping) {
        self.prune();
        let now = (self.now)();
        let mut moves = Vec::new();
        self.sessions.retain_mut(|s| {
            let range = if let Some((range, change)) =
                mapping.continuity(s.session.feature, &s.session.range)
            {
                s.session.widths = map_widths(&s.session.widths, change);
                // A column added or removed changes how automatic tracks share
                // the reading column; moving one keeps every track.
                if matches!(
                    change,
                    SequenceChange::Insert { .. } | SequenceChange::Delete { .. }
                ) {
                    s.session.auto_layout_width = None;
                }
                s.accepts_next_identity = true;
                s.touched = now;
                range
            } else if (mapping.touches)(&s.session.range) {
                return false;
            } else {
                mapping.map_range(&s.session.range)
            };
            // `mapPersistence`: explicit tracks move to the new position's key.
            let key = persistence_key(s.namespace.as_deref(), s.session.identity, range.start);
            if s.session.explicit
                && let Some(key) = &key
                && Some(key) != s.key.as_ref()
            {
                moves.push((key.clone(), s.session.widths.clone(), s.key.clone()));
            }
            s.key = key;
            s.session.range = range;
            true
        });
        for (key, widths, previous) in moves {
            self.write(&key, &widths, previous.as_deref());
        }
    }

    pub fn values(&mut self) -> Vec<Session> {
        self.prune();
        self.sessions.iter().map(|s| s.session.clone()).collect()
    }
}

mod preferences;
pub use preferences::{MemoryStorage, Preferences, Storage};

#[cfg(test)]
mod tests;
