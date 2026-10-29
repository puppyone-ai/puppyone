//! `EditorTaskScheduler` (`packages/shared-ui/src/editor/runtime/EditorTaskScheduler.ts`):
//! versioned admission for bounded editor work (format parsing, page
//! rendering, conversion). Work runs on worker threads; this owner decides
//! when it may start, how many run at once and when an exit is confirmed.
//!
//! The policy bounds logical allocations; it is not an OS memory quota
//! (`host_budget` samples real processes). Interactive work starts first;
//! equal priorities rotate owners and waiting ages a job upward, so
//! background work cannot starve. Cancellation is cooperative: a running
//! lease observes `Lease::cancelled()` and its drop is the exit receipt.
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

/// `EDITOR_TASK_POLICY` version 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Policy {
    pub version: u32,
    pub max_active: usize,
    pub max_per_owner: usize,
    pub max_per_scope: usize,
    pub max_background: usize,
    pub max_queued: usize,
    pub max_background_queued: usize,
    pub max_queued_bytes: u64,
    pub queue_timeout: Duration,
    pub start_timeout: Duration,
    pub exit_timeout: Duration,
    pub aging: Duration,
}
pub const POLICY: Policy = Policy {
    version: 1,
    max_active: 4,
    max_per_owner: 1,
    max_per_scope: 2,
    max_background: 1,
    max_queued: 32,
    max_background_queued: 8,
    max_queued_bytes: 128 * 1024 * 1024,
    queue_timeout: Duration::from_millis(30_000),
    start_timeout: Duration::from_millis(5_000),
    exit_timeout: Duration::from_millis(2_000),
    aging: Duration::from_millis(5_000),
};

/// `EditorTaskOwner`: scope (e.g. a window or Cloud lease), instance (one
/// document/viewer) and generation (bumped when its input is replaced).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Owner {
    pub scope: String,
    pub instance: String,
    pub generation: u64,
}
impl Owner {
    pub fn new(scope: impl Into<String>, instance: impl Into<String>, generation: u64) -> Self {
        Self {
            scope: scope.into(),
            instance: instance.into(),
            generation,
        }
    }
    fn key(&self) -> (&str, &str) {
        (&self.scope, &self.instance)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Priority {
    Interactive,
    Background,
}
#[derive(Clone, Debug)]
pub struct Request {
    pub owner: Owner,
    pub kind: &'static str,
    pub input_bytes: u64,
    pub max_input_bytes: u64,
    pub priority: Priority,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Queued,
    Starting,
    Running,
    Cancelling,
    ExitUnconfirmed,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rejection {
    /// "Editor task input exceeds its budget."
    OverBudget,
    /// "The editor task queue is full."
    QueueFull,
    /// The queue or startup deadline passed.
    TimedOut,
    /// Cancelled or retired before it ran.
    Cancelled,
    /// A closing window holds admission (`holdEditorRuntimeAdmission`).
    Closing,
}
impl std::fmt::Display for Rejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::OverBudget => "Editor task input exceeds its budget.",
            Self::QueueFull => "The editor task queue is full.",
            Self::TimedOut => "Editor task queue timed out.",
            Self::Cancelled => "Editor task cancelled.",
            Self::Closing => "The editor window is closing.",
        })
    }
}
impl std::error::Error for Rejection {}

#[derive(Debug)]
struct Job {
    request: Request,
    state: State,
    queued_at: Instant,
    started_at: Option<Instant>,
    cancel: Arc<AtomicBool>,
    rejected: Option<Rejection>,
}
#[derive(Debug, Default)]
struct Inner {
    jobs: BTreeMap<u64, Job>,
    sequence: u64,
    last_owner: Option<(String, String)>,
    holds: usize,
}
struct Shared {
    policy: Policy,
    inner: Mutex<Inner>,
    changed: Condvar,
}

/// One scheduler per application; cheap to clone.
#[derive(Clone)]
pub struct Scheduler(Arc<Shared>);
impl Default for Scheduler {
    fn default() -> Self {
        Self::new(POLICY)
    }
}
/// A diagnostic row (`snapshot()`), also what a close barrier waits on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub id: u64,
    pub owner: Owner,
    pub kind: &'static str,
    pub state: State,
}

impl Scheduler {
    pub fn new(policy: Policy) -> Self {
        Self(Arc::new(Shared {
            policy,
            inner: Mutex::new(Inner::default()),
            changed: Condvar::new(),
        }))
    }
    /// The process-wide scheduler.
    pub fn global() -> &'static Scheduler {
        static GLOBAL: std::sync::OnceLock<Scheduler> = std::sync::OnceLock::new();
        GLOBAL.get_or_init(Scheduler::default)
    }
    #[cfg(test)]
    pub fn snapshot(&self) -> Vec<Entry> {
        let inner = self.0.inner.lock().unwrap();
        inner
            .jobs
            .iter()
            .map(|(id, job)| Entry {
                id: *id,
                owner: job.request.owner.clone(),
                kind: job.request.kind,
                state: job.state,
            })
            .collect()
    }
    /// Admits `request` to the queue and blocks the calling worker until it
    /// may start. The returned lease's drop confirms the exit.
    pub fn acquire(&self, request: Request) -> Result<Lease, Rejection> {
        let policy = self.0.policy;
        if request.max_input_bytes == 0 || request.input_bytes > request.max_input_bytes {
            return Err(Rejection::OverBudget);
        }
        let mut inner = self.0.inner.lock().unwrap();
        if inner.holds > 0 {
            return Err(Rejection::Closing);
        }
        let queued: Vec<&Job> = inner
            .jobs
            .values()
            .filter(|j| j.state == State::Queued)
            .collect();
        let background = queued
            .iter()
            .filter(|j| j.request.priority == Priority::Background)
            .count();
        let bytes: u64 = queued.iter().map(|j| j.request.input_bytes).sum();
        if (request.priority == Priority::Background && background >= policy.max_background_queued)
            || queued.len() >= policy.max_queued
            || bytes + request.input_bytes > policy.max_queued_bytes
        {
            return Err(Rejection::QueueFull);
        }
        inner.sequence += 1;
        let id = inner.sequence;
        let cancel = Arc::new(AtomicBool::new(false));
        inner.jobs.insert(
            id,
            Job {
                request,
                state: State::Queued,
                queued_at: Instant::now(),
                started_at: None,
                cancel: cancel.clone(),
                rejected: None,
            },
        );
        self.pump(&mut inner);
        loop {
            let job = inner
                .jobs
                .get_mut(&id)
                .expect("job stays registered while waiting");
            if let Some(rejection) = job.rejected.clone() {
                inner.jobs.remove(&id);
                self.pump(&mut inner);
                self.0.changed.notify_all();
                return Err(rejection);
            }
            if job.state == State::Starting {
                job.state = State::Running;
                self.0.changed.notify_all();
                return Ok(Lease {
                    scheduler: self.clone(),
                    id,
                    cancel,
                });
            }
            let waited = job.queued_at.elapsed();
            if waited >= policy.queue_timeout {
                job.rejected = Some(Rejection::TimedOut);
                continue;
            }
            let (next, _) = self
                .0
                .changed
                .wait_timeout(inner, policy.queue_timeout - waited)
                .unwrap();
            inner = next;
        }
    }
    /// `retire(owner)`: cancel every job of `scope` (optionally one instance
    /// or generation) and wait up to `exit_timeout` for running leases to drop.
    /// `Err` lists the jobs whose exit is not confirmed; they keep their slots.
    pub fn retire(
        &self,
        scope: &str,
        instance: Option<&str>,
        generation: Option<u64>,
    ) -> Result<(), Vec<Entry>> {
        let matches = |job: &Job| {
            job.request.owner.scope == scope
                && instance.is_none_or(|i| job.request.owner.instance == i)
                && generation.is_none_or(|g| job.request.owner.generation == g)
        };
        let mut inner = self.0.inner.lock().unwrap();
        for job in inner.jobs.values_mut().filter(|j| matches(j)) {
            job.cancel.store(true, Ordering::Release);
            match job.state {
                State::Queued => job.rejected = Some(Rejection::Cancelled),
                State::Running => job.state = State::Cancelling,
                _ => {}
            }
        }
        self.0.changed.notify_all();
        let deadline = Instant::now() + self.0.policy.exit_timeout;
        loop {
            let remaining: Vec<u64> = inner
                .jobs
                .iter()
                .filter(|(_, j)| matches(j) && j.rejected.is_none())
                .map(|(id, _)| *id)
                .collect();
            if remaining.is_empty() {
                return Ok(());
            }
            let now = Instant::now();
            if now >= deadline {
                for id in &remaining {
                    if let Some(job) = inner.jobs.get_mut(id) {
                        job.state = State::ExitUnconfirmed;
                    }
                }
                return Err(remaining
                    .iter()
                    .filter_map(|id| {
                        inner.jobs.get(id).map(|job| Entry {
                            id: *id,
                            owner: job.request.owner.clone(),
                            kind: job.request.kind,
                            state: job.state,
                        })
                    })
                    .collect());
            }
            inner = self
                .0
                .changed
                .wait_timeout(inner, deadline - now)
                .unwrap()
                .0;
        }
    }
    /// `holdEditorRuntimeAdmission`: a closing window blocks new allocations
    /// until the returned hold drops.
    pub fn hold_admission(&self) -> AdmissionHold {
        self.0.inner.lock().unwrap().holds += 1;
        AdmissionHold(self.clone())
    }
    fn release(&self, id: u64) {
        let mut inner = self.0.inner.lock().unwrap();
        inner.jobs.remove(&id);
        self.pump(&mut inner);
        self.0.changed.notify_all();
    }
    /// Starts queued jobs while slots allow, highest score first.
    fn pump(&self, inner: &mut Inner) {
        let policy = self.0.policy;
        let now = Instant::now();
        // A startup that did not reach a worker in time gives its slot back.
        for job in inner.jobs.values_mut() {
            if job.state == State::Starting
                && job
                    .started_at
                    .is_some_and(|t| now - t >= policy.start_timeout)
            {
                job.rejected = Some(Rejection::TimedOut);
                job.state = State::Queued;
            }
        }
        let active = |inner: &Inner| -> Vec<(Owner, Priority)> {
            inner
                .jobs
                .values()
                .filter(|j| j.state != State::Queued && j.rejected.is_none())
                .map(|j| (j.request.owner.clone(), j.request.priority))
                .collect()
        };
        let mut running = active(inner);
        if running.len() >= policy.max_active {
            return;
        }
        let aging = policy.aging.as_millis().max(1);
        let score = |job: &Job| {
            u128::from(job.request.priority == Priority::Interactive)
                + now.duration_since(job.queued_at).as_millis() / aging
        };
        let last = inner.last_owner.clone();
        let mut candidates: Vec<u64> = inner
            .jobs
            .iter()
            .filter(|(_, j)| j.state == State::Queued && j.rejected.is_none())
            .map(|(id, _)| *id)
            .collect();
        candidates.sort_by(|a, b| {
            let (ja, jb) = (&inner.jobs[a], &inner.jobs[b]);
            let is_last = |j: &Job| {
                last.as_ref()
                    .is_some_and(|(s, i)| j.request.owner.key() == (s.as_str(), i.as_str()))
            };
            score(jb)
                .cmp(&score(ja))
                .then(is_last(ja).cmp(&is_last(jb)))
                .then(ja.queued_at.cmp(&jb.queued_at))
                .then(a.cmp(b))
        });
        for id in candidates {
            if running.len() >= policy.max_active {
                break;
            }
            let job = &inner.jobs[&id];
            let owner = job.request.owner.clone();
            if running
                .iter()
                .filter(|(o, _)| o.key() == owner.key())
                .count()
                >= policy.max_per_owner
            {
                continue;
            }
            if running
                .iter()
                .filter(|(o, _)| o.scope == owner.scope)
                .count()
                >= policy.max_per_scope
            {
                continue;
            }
            if job.request.priority == Priority::Background
                && running
                    .iter()
                    .filter(|(_, p)| *p == Priority::Background)
                    .count()
                    >= policy.max_background
            {
                continue;
            }
            running.push((owner.clone(), job.request.priority));
            let job = inner.jobs.get_mut(&id).unwrap();
            job.state = State::Starting;
            job.started_at = Some(now);
            inner.last_owner = Some((owner.scope, owner.instance));
        }
    }
}

/// The running allocation. Dropping it is the exit receipt.
pub struct Lease {
    scheduler: Scheduler,
    id: u64,
    cancel: Arc<AtomicBool>,
}
impl Lease {
    /// Cooperative cancellation: retirement, window close or a replaced input.
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Acquire)
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.scheduler.release(self.id);
    }
}
pub struct AdmissionHold(Scheduler);
impl Drop for AdmissionHold {
    fn drop(&mut self) {
        let mut inner = self.0.0.inner.lock().unwrap();
        inner.holds = inner.holds.saturating_sub(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn request(scope: &str, instance: &str, priority: Priority) -> Request {
        Request {
            owner: Owner::new(scope, instance, 1),
            kind: "test",
            input_bytes: 1,
            max_input_bytes: 10,
            priority,
        }
    }
    fn fast() -> Policy {
        Policy {
            queue_timeout: Duration::from_millis(400),
            exit_timeout: Duration::from_millis(100),
            ..POLICY
        }
    }

    #[test]
    fn policy_matches_the_product_version_one() {
        assert_eq!(POLICY.version, 1);
        assert_eq!(
            (
                POLICY.max_active,
                POLICY.max_per_owner,
                POLICY.max_per_scope
            ),
            (4, 1, 2)
        );
        assert_eq!(
            (
                POLICY.max_background,
                POLICY.max_queued,
                POLICY.max_background_queued
            ),
            (1, 32, 8)
        );
        assert_eq!(POLICY.max_queued_bytes, 134_217_728);
        assert_eq!(POLICY.queue_timeout, Duration::from_secs(30));
        assert_eq!(POLICY.start_timeout, Duration::from_secs(5));
        assert_eq!(POLICY.exit_timeout, Duration::from_secs(2));
        assert_eq!(POLICY.aging, Duration::from_secs(5));
    }

    #[test]
    fn input_over_its_own_budget_is_refused_before_queueing() {
        let s = Scheduler::new(fast());
        let mut r = request("w", "a", Priority::Interactive);
        r.input_bytes = 11;
        assert_eq!(s.acquire(r).err(), Some(Rejection::OverBudget));
        assert!(s.snapshot().is_empty());
    }

    #[test]
    fn one_owner_runs_one_task_and_one_scope_two() {
        let s = Scheduler::new(fast());
        let a = s.acquire(request("w", "a", Priority::Interactive)).unwrap();
        let b = s.acquire(request("w", "b", Priority::Interactive)).unwrap();
        // A third instance of the same scope waits for a slot.
        let (tx, rx) = mpsc::channel();
        let s2 = s.clone();
        let waiter = std::thread::spawn(move || {
            let lease = s2.acquire(request("w", "c", Priority::Interactive));
            tx.send(()).unwrap();
            lease.map(|_| ())
        });
        assert!(rx.recv_timeout(Duration::from_millis(80)).is_err());
        assert_eq!(
            s.snapshot()
                .iter()
                .filter(|e| e.state == State::Queued)
                .count(),
            1
        );
        // Another scope still starts at once (max_active 4).
        let other = s.acquire(request("x", "a", Priority::Interactive)).unwrap();
        drop(a);
        rx.recv_timeout(Duration::from_millis(300)).unwrap();
        assert!(waiter.join().unwrap().is_ok());
        drop((b, other));
        assert!(s.snapshot().is_empty());
    }

    #[test]
    fn background_has_one_slot_and_a_bounded_queue() {
        let s = Scheduler::new(Policy {
            max_background_queued: 1,
            ..fast()
        });
        let first = s.acquire(request("w", "a", Priority::Background)).unwrap();
        let s2 = s.clone();
        let queued = std::thread::spawn(move || {
            s2.acquire(request("x", "b", Priority::Background))
                .map(|_| ())
        });
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(
            s.acquire(request("y", "c", Priority::Background)).err(),
            Some(Rejection::QueueFull)
        );
        // Interactive work is not blocked by the background slot.
        drop(s.acquire(request("z", "d", Priority::Interactive)).unwrap());
        drop(first);
        assert!(queued.join().unwrap().is_ok());
    }

    #[test]
    fn queued_jobs_time_out_and_byte_budget_is_enforced() {
        let s = Scheduler::new(Policy {
            max_active: 1,
            max_queued_bytes: 5,
            ..fast()
        });
        let hold = s.acquire(request("w", "a", Priority::Interactive)).unwrap();
        let started = Instant::now();
        assert_eq!(
            s.acquire(request("x", "b", Priority::Interactive)).err(),
            Some(Rejection::TimedOut)
        );
        assert!(started.elapsed() >= Duration::from_millis(350));
        let mut big = request("x", "c", Priority::Interactive);
        big.input_bytes = 6;
        big.max_input_bytes = 10;
        assert_eq!(s.acquire(big).err(), Some(Rejection::QueueFull));
        drop(hold);
    }

    #[test]
    fn retire_cancels_queued_and_waits_for_running_exit() {
        let s = Scheduler::new(Policy {
            max_active: 1,
            ..fast()
        });
        let running = s.acquire(request("w", "a", Priority::Interactive)).unwrap();
        let s2 = s.clone();
        let queued = std::thread::spawn(move || {
            s2.acquire(request("w", "b", Priority::Interactive))
                .map(|_| ())
        });
        std::thread::sleep(Duration::from_millis(40));
        // The running lease never drops in time: exit is not confirmed.
        let unconfirmed = s.retire("w", None, None).unwrap_err();
        assert_eq!(unconfirmed.len(), 1);
        assert_eq!(unconfirmed[0].state, State::ExitUnconfirmed);
        assert!(running.cancelled());
        assert_eq!(queued.join().unwrap().err(), Some(Rejection::Cancelled));
        // Its drop is the receipt that frees the slot.
        drop(running);
        assert!(s.snapshot().is_empty());
        assert!(s.retire("w", None, None).is_ok());
    }

    #[test]
    fn generation_retirement_spares_the_current_input() {
        let s = Scheduler::new(fast());
        let mut old = request("w", "a", Priority::Interactive);
        old.owner.generation = 1;
        let lease = s.acquire(old).unwrap();
        let mut other = request("w", "b", Priority::Interactive);
        other.owner.generation = 2;
        let current = s.acquire(other).unwrap();
        let s2 = s.clone();
        let retire = std::thread::spawn(move || s2.retire("w", None, Some(1)));
        std::thread::sleep(Duration::from_millis(20));
        assert!(lease.cancelled() && !current.cancelled());
        drop(lease);
        assert!(retire.join().unwrap().is_ok());
    }

    #[test]
    fn a_closing_window_holds_new_admission() {
        let s = Scheduler::new(fast());
        let hold = s.hold_admission();
        assert_eq!(
            s.acquire(request("w", "a", Priority::Interactive)).err(),
            Some(Rejection::Closing)
        );
        drop(hold);
        assert!(s.acquire(request("w", "a", Priority::Interactive)).is_ok());
    }

    #[test]
    fn interactive_starts_before_background_and_owners_rotate() {
        let s = Scheduler::new(Policy {
            max_active: 1,
            max_per_scope: 4,
            ..fast()
        });
        let gate = s
            .acquire(request("w", "gate", Priority::Interactive))
            .unwrap();
        let order = Arc::new(Mutex::new(Vec::new()));
        let mut threads = Vec::new();
        for (name, priority) in [("bg", Priority::Background), ("ui", Priority::Interactive)] {
            let (s, order) = (s.clone(), order.clone());
            threads.push(std::thread::spawn(move || {
                let lease = s.acquire(request("w", name, priority)).unwrap();
                order.lock().unwrap().push(name);
                std::thread::sleep(Duration::from_millis(10));
                drop(lease);
            }));
            std::thread::sleep(Duration::from_millis(30));
        }
        drop(gate);
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(*order.lock().unwrap(), vec!["ui", "bg"]);
    }
}
