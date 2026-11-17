//! Bounded document I/O executor (`DP-41`).
//!
//! Routes all document reads, saves, rebinds, conflict-copy creations, background
//! observations, and draft-journal operations through a fixed-size worker pool
//! with:
//! - Per-resource serialization (`(scope, instance)` never runs two storage
//!   operations concurrently).
//! - Priority scheduling (`Priority::Interactive` for open/read, save, rebind
//!   and conflict copy ahead of `Priority::Background` observations).
//! - `crate::platform::tasks::Scheduler` admission and cooperative owner/generation
//!   cancellation (`Lease::cancelled()`).
//! - Automatic caller locale propagation (`crate::localization::current_code`)
//!   without spawning an OS thread per read/write/observe.

use crate::platform::tasks::{Lease, Owner, Priority, Rejection, Request, Scheduler};
use std::{
    collections::{HashSet, VecDeque},
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        Arc, Condvar, Mutex, OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};

/// A provider can unwind before or after committing bytes. Deliver an unknown
/// outcome to the coordinator so it retains the draft and settles its barrier;
/// the pool's last-resort panic catch alone cannot acknowledge that write.
pub(super) fn catch_save<T>(
    work: impl FnOnce() -> crate::workspace::Result<T>,
) -> crate::workspace::Result<T> {
    catch_unwind(AssertUnwindSafe(work)).unwrap_or_else(|payload| {
        let detail = payload
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| payload.downcast_ref::<&str>().copied())
            .unwrap_or("Unknown storage failure");
        let detail: String = detail.chars().take(300).collect();
        Err(crate::workspace::Error::new(
            crate::workspace::ErrorKind::OutcomeUnknown,
            format!("Document storage failed unexpectedly: {detail}"),
        ))
    })
}

/// Persistent worker pool size (`>= Scheduler::POLICY.max_active` so waiting
/// scopes never starve another scope's interactive slot).
pub const POOL_WORKERS: usize = 6;

/// Sub-priority within `DocumentIoPool` so saves and interactive opens always
/// dispatch ahead of background observations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum IoLane {
    InteractiveOpen = 0,
    Save = 1,
    Journal = 2,
    Observation = 3,
}

impl IoLane {
    pub const fn task_priority(self) -> Priority {
        match self {
            Self::InteractiveOpen | Self::Save | Self::Journal => Priority::Interactive,
            Self::Observation => Priority::Background,
        }
    }
}

pub type IoJobFn = Box<dyn FnOnce(Option<Result<Lease, Rejection>>) + Send + 'static>;

pub struct IoJob {
    pub request: Option<Request>,
    pub resource_lock: Option<(String, String)>,
    pub lane: IoLane,
    pub run: IoJobFn,
}

struct QueuedJob {
    seq: u64,
    locale: String,
    job: IoJob,
}

#[derive(Default)]
struct PoolInner {
    queue: VecDeque<QueuedJob>,
    active_resources: HashSet<(String, String)>,
    active_background: usize,
    active_admitted: usize,
    next_seq: u64,
    workers_started: bool,
}

pub struct DocumentIoPool {
    inner: Mutex<PoolInner>,
    cv: Condvar,
    spawned_threads: AtomicUsize,
}

impl DocumentIoPool {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(PoolInner::default()),
            cv: Condvar::new(),
            spawned_threads: AtomicUsize::new(0),
        })
    }

    pub fn global() -> &'static Arc<Self> {
        static POOL: OnceLock<Arc<DocumentIoPool>> = OnceLock::new();
        POOL.get_or_init(Self::new)
    }

    /// Total OS worker threads ever spawned by this bounded pool (`<= POOL_WORKERS`).
    pub fn spawned_threads(&self) -> usize {
        self.spawned_threads.load(Ordering::Acquire)
    }

    fn ensure_workers(self: &Arc<Self>, guard: &mut PoolInner) {
        if guard.workers_started {
            return;
        }
        guard.workers_started = true;
        for _ in 0..POOL_WORKERS {
            let pool = Arc::clone(self);
            self.spawned_threads.fetch_add(1, Ordering::AcqRel);
            crate::localization::spawn(move || pool.worker_loop());
        }
    }

    pub fn submit(self: &Arc<Self>, job: IoJob) {
        let locale = crate::localization::current_code();
        let mut guard = self.inner.lock().unwrap();
        self.ensure_workers(&mut guard);
        guard.next_seq += 1;
        let seq = guard.next_seq;
        guard.queue.push_back(QueuedJob { seq, locale, job });
        self.cv.notify_one();
    }

    fn pop_ready(&self, guard: &mut PoolInner) -> Option<QueuedJob> {
        let mut best_idx: Option<usize> = None;
        for (idx, item) in guard.queue.iter().enumerate() {
            if let Some(key) = &item.job.resource_lock
                && guard.active_resources.contains(key)
            {
                continue;
            }
            if item.job.request.is_some() {
                if guard.active_admitted >= crate::platform::tasks::POLICY.max_active {
                    continue;
                }
                if item.job.lane == IoLane::Observation
                    && guard.active_background >= crate::platform::tasks::POLICY.max_background
                {
                    continue;
                }
            }
            let replace = match best_idx {
                None => true,
                Some(cur) => {
                    let prev = &guard.queue[cur];
                    (item.job.lane, item.seq) < (prev.job.lane, prev.seq)
                }
            };
            if replace {
                best_idx = Some(idx);
            }
        }

        let idx = best_idx?;
        let chosen = guard.queue.remove(idx)?;
        if let Some(key) = &chosen.job.resource_lock {
            guard.active_resources.insert(key.clone());
        }
        if chosen.job.request.is_some() {
            guard.active_admitted += 1;
            if chosen.job.lane == IoLane::Observation {
                guard.active_background += 1;
            }
        }
        Some(chosen)
    }

    fn worker_loop(self: Arc<Self>) {
        loop {
            let queued = {
                let mut guard = self.inner.lock().unwrap();
                loop {
                    if let Some(job) = self.pop_ready(&mut guard) {
                        break job;
                    }
                    guard = self.cv.wait(guard).unwrap();
                }
            };

            let release_guard = ActiveJobGuard {
                pool: &self,
                resource_lock: queued.job.resource_lock,
                admitted: queued.job.request.is_some(),
                background: queued.job.lane == IoLane::Observation,
            };

            crate::localization::set_current(&queued.locale);
            let run = queued.job.run;
            let request = queued.job.request;

            let _ = catch_unwind(AssertUnwindSafe(|| match request {
                Some(req) => run(Some(Scheduler::global().acquire(req))),
                None => run(None),
            }));

            drop(release_guard);
        }
    }
}

struct ActiveJobGuard<'a> {
    pool: &'a DocumentIoPool,
    resource_lock: Option<(String, String)>,
    admitted: bool,
    background: bool,
}

impl Drop for ActiveJobGuard<'_> {
    fn drop(&mut self) {
        let mut guard = self.pool.inner.lock().unwrap();
        if let Some(key) = self.resource_lock.take() {
            guard.active_resources.remove(&key);
        }
        if self.admitted {
            guard.active_admitted = guard.active_admitted.saturating_sub(1);
            if self.background {
                guard.active_background = guard.active_background.saturating_sub(1);
            }
        }
        self.pool.cv.notify_all();
    }
}

/// Submits an admitted storage I/O job on [`DocumentIoPool::global`].
pub fn submit_admitted<F>(
    owner: Owner,
    kind: &'static str,
    input_bytes: u64,
    max_input_bytes: u64,
    lane: IoLane,
    work: F,
) where
    F: FnOnce(Result<Lease, Rejection>) + Send + 'static,
{
    let lock = (owner.scope.clone(), owner.instance.clone());
    let request = Request {
        owner,
        kind,
        input_bytes,
        max_input_bytes: max_input_bytes.max(1),
        priority: lane.task_priority(),
    };
    DocumentIoPool::global().submit(IoJob {
        request: Some(request),
        resource_lock: Some(lock),
        lane,
        run: Box::new(move |outcome| work(outcome.unwrap_or(Err(Rejection::Cancelled)))),
    });
}

/// Submits a serialized non-admitted helper task (such as local draft-journal
/// persistence or folder listing) on [`DocumentIoPool::global`] without spawning
/// a dedicated OS thread.
pub fn submit_serialized<F>(resource_lock: Option<(String, String)>, lane: IoLane, work: F)
where
    F: FnOnce() + Send + 'static,
{
    DocumentIoPool::global().submit(IoJob {
        request: None,
        resource_lock,
        lane,
        run: Box::new(move |_| work()),
    });
}
