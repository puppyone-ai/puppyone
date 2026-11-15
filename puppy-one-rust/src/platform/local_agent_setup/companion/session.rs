//! Application-scoped companion evidence. Explicit installation generations
//! advance discovery; mounting another view never expires completed evidence.
use super::Presence;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub type Values = Vec<(&'static str, Presence)>;
#[derive(Clone)]
pub struct Scan {
    pub revision: u64,
    pub installation_generation: u64,
    pub cancel: Arc<AtomicBool>,
}
struct Evidence {
    revision: u64,
    installation_generation: u64,
    values: Values,
}
#[derive(Default)]
pub struct Session {
    revision: u64,
    active: Option<Scan>,
    queued: Option<u64>,
    cache: Option<Evidence>,
    disposed: bool,
}
impl Session {
    /// Return a new scan only to its leader. Other views join the active scan,
    /// or coalesce a single follow-up to the newest explicit generation.
    pub fn discover(&mut self, generation: u64) -> Option<Scan> {
        if self.disposed || generation == 0 {
            return None;
        }
        if let Some(active) = &self.active {
            if active.cancel.load(Ordering::Relaxed) || generation > active.installation_generation
            {
                self.queued = Some(self.queued.unwrap_or(0).max(generation));
            }
            return None;
        }
        if self
            .cache
            .as_ref()
            .is_some_and(|c| generation <= c.installation_generation)
        {
            return None;
        }
        self.revision += 1;
        let scan = Scan {
            revision: self.revision,
            installation_generation: generation,
            cancel: Arc::new(AtomicBool::new(false)),
        };
        self.active = Some(scan.clone());
        Some(scan)
    }
    /// A canceled/retired result never replaces completed evidence. Completing
    /// the leader starts at most one queued scan, without overlapping workers.
    pub fn complete(&mut self, scan: &Scan, values: Values) -> Option<Scan> {
        if self
            .active
            .as_ref()
            .is_none_or(|a| a.revision != scan.revision || !Arc::ptr_eq(&a.cancel, &scan.cancel))
        {
            return None;
        }
        self.active = None;
        if !self.disposed && !scan.cancel.load(Ordering::Relaxed) {
            self.cache = Some(Evidence {
                revision: scan.revision,
                installation_generation: scan.installation_generation,
                values,
            });
        }
        self.queued.take().and_then(|g| self.discover(g))
    }
    pub fn current(&self) -> Option<(u64, &Values)> {
        if self.disposed || self.is_scanning() {
            return None;
        }
        self.cache.as_ref().map(|c| (c.revision, &c.values))
    }
    pub fn is_current(&self, revision: u64) -> bool {
        self.current()
            .is_some_and(|(current, _)| current == revision)
    }
    pub fn is_scanning(&self) -> bool {
        self.active.is_some() || self.queued.is_some()
    }
    /// Last enabled view released: cancel work, retaining completed evidence.
    pub fn cancel(&mut self) {
        if let Some(active) = &self.active {
            active.cancel.store(true, Ordering::Relaxed);
        }
        self.queued = None;
    }
    pub fn dispose(&mut self) {
        self.disposed = true;
        self.cancel();
        self.cache = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    fn found() -> Values {
        vec![("codex", Presence::Present)]
    }
    #[test]
    fn a_new_generation_immediately_retires_old_recommendations_and_coalesces_only_the_latest_scan()
    {
        let mut session = Session::default();
        let initial = session.discover(1).unwrap();
        assert!(session.discover(1).is_none());
        assert!(session.discover(2).is_none());
        assert!(session.discover(3).is_none());
        let next = session.complete(&initial, found()).unwrap();
        assert_eq!(next.installation_generation, 3);
        assert!(!session.is_current(initial.revision));
        assert!(session.current().is_none());
        assert!(session.complete(&next, found()).is_none());
        assert!(session.is_current(next.revision));
        for generation in [3, 1, 2] {
            assert!(session.discover(generation).is_none());
        }
        let refresh = session.discover(4).unwrap();
        assert!(!session.is_current(next.revision));
        session.complete(&refresh, vec![("codex", Presence::NotFound)]);
        assert!(!session.is_current(next.revision));
    }
    #[test]
    fn unknown_is_cached_without_time_or_view_expiration_until_explicit_discovery() {
        let mut session = Session::default();
        let scan = session.discover(1).unwrap();
        let unknown = vec![("codex", Presence::Unknown), ("cursor", Presence::Unknown)];
        session.complete(&scan, unknown.clone());
        for _ in 0..100 {
            session.cancel();
            assert!(session.discover(1).is_none());
            assert_eq!(session.current().unwrap().1, &unknown);
        }
        let scan = session.discover(2).unwrap();
        session.complete(&scan, found());
        assert_eq!(session.current().unwrap().1, &found());
    }
    #[test]
    fn release_preserves_completed_evidence_and_rejects_late_cancelled_results_and_queued_work() {
        let mut session = Session::default();
        let initial = session.discover(1).unwrap();
        session.complete(&initial, found());
        let refresh = session.discover(2).unwrap();
        assert!(session.discover(3).is_none());
        session.cancel();
        assert!(refresh.cancel.load(Ordering::Relaxed));
        assert!(
            session
                .complete(&refresh, vec![("codex", Presence::NotFound)])
                .is_none()
        );
        assert!(session.discover(1).is_none());
        assert!(session.is_current(initial.revision));
        assert_eq!(session.current().unwrap().1, &found());
        let next = session.discover(3).unwrap();
        assert!(session.complete(&refresh, vec![]).is_none());
        assert!(
            session.current().is_none(),
            "retired completion cannot finish new work"
        );
        session.complete(&next, found());
        assert!(session.is_current(next.revision));
    }
    #[test]
    fn disposal_cancels_active_and_queued_work_and_permanently_revokes_cached_revisions() {
        let mut session = Session::default();
        assert!(session.discover(0).is_none());
        let scan = session.discover(1).unwrap();
        session.discover(2);
        session.dispose();
        assert!(scan.cancel.load(Ordering::Relaxed));
        assert!(session.complete(&scan, found()).is_none());
        assert!(session.discover(3).is_none());
        assert!(session.current().is_none());
        assert!(!session.is_current(scan.revision));
    }
}
