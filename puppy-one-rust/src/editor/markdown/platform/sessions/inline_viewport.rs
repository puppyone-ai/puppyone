//! Per-view inline viewport sessions (TS `embeddedInlineViewportSession.ts`):
//! where a wide widget (a table) is scrolled horizontally, kept as a semantic
//! anchor (an item and the offset inside it) rather than raw pixels, so it
//! survives a continuous widget replacement and follows inserted, deleted
//! and moved items. An overlapping replacement without a [`Continuity`]
//! ends the session; detached sessions expire and are bounded.
//!
//! [`Continuity`]: super::continuity::Continuity
use super::continuity::{Mapping, SequenceChange};
use std::{cell::RefCell, ops::Range, rc::Rc, sync::OnceLock, time::Instant};

/// `DEFAULT_DETACHED_TTL_MS`.
pub const DETACHED_TTL_MS: u64 = 120_000;
/// `DEFAULT_MAX_DETACHED_SESSIONS`.
pub const MAX_DETACHED: usize = 64;

/// `EmbeddedInlineViewportPosition`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Position {
    #[default]
    Start,
    Anchored {
        item: usize,
        /// Offset inside the item, in pixels.
        within: f32,
        /// The logical offset when no item could be measured.
        fallback: f32,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lifecycle {
    Mounted,
    Detached,
}

/// `EmbeddedInlineViewportSession`.
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub id: u64,
    pub feature: &'static str,
    pub range: Range<usize>,
    /// The widget's content identity (a table's cells and alignments).
    pub identity: u64,
    pub position: Position,
    pub lifecycle: Lifecycle,
    /// The mount this session belongs to; a stale widget's token cannot
    /// detach or capture a newer mount.
    pub mount: u64,
}

struct Stored {
    session: Session,
    accepts_next_identity: bool,
    detached_at: Option<u64>,
    touched: u64,
}

/// A view's sessions (one per editor pane).
pub type Shared = Rc<RefCell<Store>>;

pub struct Store {
    /// In creation order (the product's `Map`).
    sessions: Vec<Stored>,
    ttl: u64,
    max_detached: usize,
    now: Rc<dyn Fn() -> u64>,
    next_session: u64,
    next_mount: u64,
}

impl Default for Store {
    fn default() -> Self {
        Self::with(DETACHED_TTL_MS, MAX_DETACHED, Rc::new(monotonic_ms))
    }
}

/// Milliseconds on a monotonic clock.
pub fn monotonic_ms() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

impl Store {
    pub fn with(ttl: u64, max_detached: usize, now: Rc<dyn Fn() -> u64>) -> Self {
        Self {
            sessions: Vec::new(),
            ttl,
            max_detached,
            now,
            next_session: 0,
            next_mount: 0,
        }
    }

    pub fn shared() -> Shared {
        Rc::new(RefCell::new(Self::default()))
    }

    fn prune(&mut self) {
        let now = (self.now)();
        let ttl = self.ttl;
        self.sessions.retain(|s| {
            !(s.session.lifecycle == Lifecycle::Detached
                && s.detached_at
                    .is_some_and(|at| now.saturating_sub(at) >= ttl))
        });
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

    fn stored(&mut self, id: u64) -> Option<&mut Stored> {
        self.sessions.iter_mut().find(|s| s.session.id == id)
    }

    /// The session of the widget at `range` with `identity`: the existing one
    /// (also after a continuity changed its identity), mounted again, or a
    /// new one at the start.
    pub fn acquire(
        &mut self,
        feature: &'static str,
        range: Range<usize>,
        identity: u64,
    ) -> Session {
        self.prune();
        let now = (self.now)();
        self.next_mount += 1;
        let mount = self.next_mount;
        if let Some(existing) = self.sessions.iter_mut().find(|s| {
            s.session.feature == feature
                && s.session.range == range
                && (s.session.identity == identity || s.accepts_next_identity)
        }) {
            existing.session.range = range;
            existing.session.identity = identity;
            existing.session.lifecycle = Lifecycle::Mounted;
            existing.session.mount = mount;
            existing.accepts_next_identity = false;
            existing.detached_at = None;
            existing.touched = now;
            return existing.session.clone();
        }
        self.next_session += 1;
        let session = Session {
            id: self.next_session,
            feature,
            range,
            identity,
            position: Position::Start,
            lifecycle: Lifecycle::Mounted,
            mount,
        };
        self.sessions.push(Stored {
            session: session.clone(),
            accepts_next_identity: false,
            detached_at: None,
            touched: now,
        });
        session
    }

    pub fn get(&mut self, id: u64) -> Option<Session> {
        self.prune();
        self.sessions
            .iter()
            .find(|s| s.session.id == id)
            .map(|s| s.session.clone())
    }

    /// Record where the mounted widget is scrolled.
    pub fn capture(&mut self, id: u64, mount: u64, position: Position) -> Option<Session> {
        let now = (self.now)();
        let stored = self.stored(id)?;
        if stored.session.mount != mount || stored.session.lifecycle != Lifecycle::Mounted {
            return None;
        }
        stored.session.position = position;
        stored.touched = now;
        Some(stored.session.clone())
    }

    /// The widget went away; its replacement may already have mounted.
    pub fn detach(&mut self, id: u64, mount: u64) {
        let now = (self.now)();
        let Some(stored) = self.stored(id) else {
            return;
        };
        if stored.session.mount != mount {
            return;
        }
        stored.session.lifecycle = Lifecycle::Detached;
        stored.detached_at = Some(now);
        stored.touched = now;
        self.prune();
    }

    /// Follow one transaction (`mapTransaction`).
    pub fn map(&mut self, mapping: &Mapping) {
        self.prune();
        let now = (self.now)();
        self.sessions.retain_mut(|s| {
            if let Some((range, change)) = mapping.continuity(s.session.feature, &s.session.range) {
                s.session.range = range;
                s.session.position = map_position(s.session.position, change);
                s.accepts_next_identity = true;
                s.touched = now;
                return true;
            }
            if (mapping.touches)(&s.session.range) {
                return false;
            }
            s.session.range = mapping.map_range(&s.session.range);
            true
        });
    }

    pub fn values(&mut self) -> Vec<Session> {
        self.prune();
        self.sessions.iter().map(|s| s.session.clone()).collect()
    }
}

/// `mapEmbeddedInlineViewportPosition`: the anchored item follows inserted,
/// deleted and moved items.
pub fn map_position(position: Position, change: SequenceChange) -> Position {
    let Position::Anchored {
        item,
        within,
        fallback,
    } = position
    else {
        return position;
    };
    let item = match change {
        SequenceChange::Preserve => item,
        SequenceChange::Insert { index, count } if item >= index => item + count,
        SequenceChange::Insert { .. } => item,
        SequenceChange::Delete { index, count } => {
            if item >= index + count {
                item - count
            } else if item >= index {
                index
            } else {
                item
            }
        }
        SequenceChange::Move { from, to } => {
            if item == from {
                to
            } else if from < to && item > from && item <= to {
                item - 1
            } else if to < from && item >= to && item < from {
                item + 1
            } else {
                item
            }
        }
    };
    Position::Anchored {
        item,
        within,
        fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::text::change::Assoc;
    use core::prelude::v1::test;
    use std::cell::Cell;

    const TABLE: &str = "markdown-table";

    fn mapping<'a>(
        continuities: Vec<super::super::continuity::Continuity>,
        map_pos: &'a dyn Fn(usize, Assoc) -> usize,
        touches: &'a dyn Fn(&Range<usize>) -> bool,
    ) -> Mapping<'a> {
        Mapping {
            continuities,
            map_pos,
            touches,
            inside: &|_| false,
        }
    }

    /// `markdownInlineViewportSession.test.ts` #0.
    #[test]
    fn keeps_one_semantic_anchor_across_an_explicitly_continuous_replacement() {
        let mut store = Store::default();
        let first = store.acquire(TABLE, 10..30, 1);
        let anchored = Position::Anchored {
            item: 2,
            within: 7.,
            fallback: 247.,
        };
        store.capture(first.id, first.mount, anchored);
        store.map(&mapping(
            vec![super::super::continuity::Continuity {
                feature: TABLE,
                old: 10..30,
                new: 10..36,
                change: SequenceChange::Insert { index: 1, count: 1 },
            }],
            &|p, _| p,
            &|_| true,
        ));
        store.detach(first.id, first.mount);
        let replacement = store.acquire(TABLE, 10..36, 2);
        assert_eq!(replacement.id, first.id);
        assert_eq!(
            replacement.position,
            Position::Anchored {
                item: 3,
                within: 7.,
                fallback: 247.,
            }
        );
        assert_eq!(replacement.lifecycle, Lifecycle::Mounted);
        // The replaced widget's late disposal cannot detach the newer mount.
        store.detach(first.id, first.mount);
        assert_eq!(
            store.get(replacement.id).unwrap().lifecycle,
            Lifecycle::Mounted
        );
    }

    /// #1.
    #[test]
    fn maps_unrelated_edits_but_ends_on_a_touching_replacement_without_continuity() {
        let mut store = Store::default();
        let session = store.acquire(TABLE, 20..40, 1);
        store.map(&mapping(vec![], &|p, _| p + 5, &|_| false));
        assert_eq!(store.get(session.id).unwrap().range, 25..45);
        store.map(&mapping(vec![], &|p, _| p, &|_| true));
        assert_eq!(store.get(session.id), None);
        let recreated = store.acquire(TABLE, 25..45, 9);
        assert_ne!(recreated.id, session.id);
        assert_eq!(recreated.position, Position::Start);
    }

    /// #2.
    #[test]
    fn detached_sessions_expire_and_keep_a_bounded_least_recently_used_set() {
        let clock = Rc::new(Cell::new(0u64));
        let now = clock.clone();
        let mut store = Store::with(100, 2, Rc::new(move || now.get()));
        let mut detached = |index: usize| {
            clock.set(clock.get() + 1);
            let session = store.acquire(TABLE, index * 10..index * 10 + 5, index as u64);
            store.detach(session.id, session.mount);
            session
        };
        let first = detached(1);
        let second = detached(2);
        let third = detached(3);
        assert_eq!(store.get(first.id), None);
        assert_eq!(
            store.values().iter().map(|s| s.id).collect::<Vec<_>>(),
            [second.id, third.id]
        );
        clock.set(clock.get() + 101);
        assert!(store.values().is_empty());
    }

    /// #3.
    #[test]
    fn anchors_follow_inserted_deleted_and_moved_items_not_pixels() {
        let anchor = Position::Anchored {
            item: 3,
            within: 4.,
            fallback: 304.,
        };
        let item = |p: Position| match p {
            Position::Anchored { item, .. } => item,
            Position::Start => usize::MAX,
        };
        assert_eq!(
            item(map_position(
                anchor,
                SequenceChange::Insert { index: 1, count: 2 }
            )),
            5
        );
        assert_eq!(
            item(map_position(
                anchor,
                SequenceChange::Delete { index: 2, count: 2 }
            )),
            2
        );
        assert_eq!(
            item(map_position(
                anchor,
                SequenceChange::Move { from: 1, to: 4 }
            )),
            2
        );
        assert_eq!(
            SequenceChange::Move { from: 1, to: 4 }.invert(),
            SequenceChange::Move { from: 4, to: 1 }
        );
        // The offset inside the item is kept; the fallback is never identity.
        assert_eq!(map_position(anchor, SequenceChange::Preserve), anchor);
    }
}
