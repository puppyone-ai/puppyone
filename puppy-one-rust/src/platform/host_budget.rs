//! `createItemHostBudget` (`electron/main/item-hosts/resource-budget.mjs`):
//! admission and supervision for execution hosts (Agent CLIs, terminals,
//! engine helpers) keyed by window and project.
//!
//! A lease exists from reservation until the process is confirmed gone,
//! including starting, hidden, failed and closing hosts. The monitor samples
//! real processes every two seconds: a host over its own memory budget, or
//! at sustained CPU for 30 seconds of contiguous samples, is reported
//! exceeded. Aggregate pressure (application, window or project) closes only
//! the largest contributor, then waits for its release before picking
//! another; siblings are never restarted. This is supervision of observed
//! working sets, not an OS-enforced quota.
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Policy {
    pub application: usize,
    pub window: usize,
    pub project: usize,
    pub concurrent_starts: usize,
    pub renderer_rss: u64,
    pub utility_rss: u64,
    pub application_rss: u64,
    pub window_rss: u64,
    pub project_rss: u64,
    pub reservation: u64,
    pub sustained_cpu_percent: f32,
    pub sustained_cpu: Duration,
    pub startup_timeout: Duration,
    pub heartbeat_timeout: Duration,
    pub close_timeout: Duration,
    pub interval: Duration,
}
const MIB: u64 = 1024 * 1024;
/// `itemHostBudgetDefaults`.
pub const POLICY: Policy = Policy {
    application: 24,
    window: 16,
    project: 12,
    concurrent_starts: 4,
    renderer_rss: 768 * MIB,
    utility_rss: 768 * MIB,
    application_rss: 4 * 1024 * MIB,
    window_rss: 3 * 1024 * MIB,
    project_rss: 2 * 1024 * MIB,
    reservation: 128 * MIB,
    sustained_cpu_percent: 95.,
    sustained_cpu: Duration::from_millis(30_000),
    startup_timeout: Duration::from_millis(30_000),
    heartbeat_timeout: Duration::from_millis(15_000),
    close_timeout: Duration::from_millis(10_000),
    interval: Duration::from_millis(2_000),
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// A display-owning host (WebView content); bound by web-content hosts.
    #[cfg_attr(not(test), allow(dead_code))]
    Renderer,
    /// An execution host (CLI, PTY, engine helper).
    Utility,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Exceeded {
    /// `HOST_MEMORY_BUDGET`
    Memory,
    /// `HOST_CPU_BUDGET`
    Cpu,
    /// `HOST_AGGREGATE_MEMORY_BUDGET`
    AggregateMemory,
    /// The person terminated it from Manage Running Sessions.
    Terminated,
}
impl Exceeded {
    pub fn message(self) -> &'static str {
        match self {
            Self::AggregateMemory => {
                "This instance exceeded the available project process memory budget."
            }
            Self::Terminated => "This instance was terminated.",
            _ => "This instance exceeded its sustained process resource budget.",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// `HOST_DUPLICATE`
    Duplicate,
    /// `HOST_BUDGET_EXHAUSTED`
    Exhausted,
}
impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Duplicate => "An instance already owns this resource lease.",
            Self::Exhausted => {
                "Instance process capacity is exhausted. Close an unused tab and try again."
            }
        })
    }
}
impl std::error::Error for Refusal {}

/// One observation of a process (`app.getAppMetrics()` entry).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Metric {
    pub pid: u32,
    pub rss: u64,
    pub cpu_percent: f32,
}
type OnExceeded = Box<dyn Fn(Exceeded) + Send + Sync>;
struct Entry {
    owner: String,
    project: String,
    kind: &'static str,
    starting: bool,
    pid: Option<u32>,
    role: Role,
    rss: u64,
    cpu_since: Option<Instant>,
    sampled_at: Option<Instant>,
    failed: bool,
    terminating: Option<Instant>,
    on_exceeded: Option<OnExceeded>,
}
#[derive(Default)]
struct Inner {
    leases: BTreeMap<String, Entry>,
}
pub struct Budget {
    policy: Policy,
    inner: Mutex<Inner>,
}
/// A diagnostic row; `Manage Executions` lists these.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub key: String,
    pub owner: String,
    pub project: String,
    pub kind: &'static str,
    pub pid: Option<u32>,
    pub starting: bool,
    pub rss: u64,
    pub failed: bool,
    pub cleanup: Cleanup,
}
/// `native.execution.state.*`: what Manage Running Sessions reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cleanup {
    /// Not terminated.
    Pending,
    /// Termination accepted; waiting for exit confirmation.
    Running,
    /// Exit not confirmed within the close timeout; ownership retained.
    Unconfirmed,
}

impl Budget {
    pub fn new(policy: Policy) -> Arc<Self> {
        Arc::new(Self {
            policy,
            inner: Mutex::new(Inner::default()),
        })
    }
    /// The process-wide budget; its monitor samples the OS.
    pub fn global() -> &'static Arc<Budget> {
        static GLOBAL: std::sync::OnceLock<Arc<Budget>> = std::sync::OnceLock::new();
        GLOBAL.get_or_init(|| {
            let budget = Budget::new(POLICY);
            spawn_monitor(Arc::downgrade(&budget));
            budget
        })
    }
    fn memory<'a>(&self, entries: impl Iterator<Item = &'a Entry>) -> u64 {
        entries.map(|e| e.rss.max(self.policy.reservation)).sum()
    }
    /// `reserve({key, ownerId, projectId, kind})`.
    pub fn reserve(
        self: &Arc<Self>,
        key: impl Into<String>,
        owner: impl Into<String>,
        project: impl Into<String>,
        kind: &'static str,
    ) -> Result<HostLease, Refusal> {
        let (key, owner, project) = (key.into(), owner.into(), project.into());
        let p = self.policy;
        let mut inner = self.inner.lock().unwrap();
        if inner.leases.contains_key(&key) {
            return Err(Refusal::Duplicate);
        }
        let all: Vec<&Entry> = inner.leases.values().collect();
        let in_window = || all.iter().filter(|e| e.owner == owner);
        let in_project = || in_window().filter(|e| e.project == project);
        let at_limit = all.len() >= p.application
            || in_window().count() >= p.window
            || in_project().count() >= p.project
            || all.iter().filter(|e| e.starting).count() >= p.concurrent_starts
            || self.memory(all.iter().copied()) + p.reservation > p.application_rss
            || self.memory(in_window().copied()) + p.reservation > p.window_rss
            || self.memory(in_project().copied()) + p.reservation > p.project_rss;
        if at_limit {
            return Err(Refusal::Exhausted);
        }
        inner.leases.insert(
            key.clone(),
            Entry {
                owner,
                project,
                kind,
                starting: true,
                pid: None,
                role: Role::Utility,
                rss: 0,
                cpu_since: None,
                sampled_at: None,
                failed: false,
                terminating: None,
                on_exceeded: None,
            },
        );
        Ok(HostLease {
            budget: Arc::downgrade(self),
            key,
            released: false,
        })
    }
    pub fn snapshot(&self) -> Vec<Row> {
        let inner = self.inner.lock().unwrap();
        inner
            .leases
            .iter()
            .map(|(key, e)| Row {
                key: key.clone(),
                owner: e.owner.clone(),
                project: e.project.clone(),
                kind: e.kind,
                pid: e.pid,
                starting: e.starting,
                rss: e.rss,
                failed: e.failed,
                cleanup: match e.terminating {
                    None => Cleanup::Pending,
                    Some(t) if t.elapsed() < self.policy.close_timeout => Cleanup::Running,
                    Some(_) => Cleanup::Unconfirmed,
                },
            })
            .collect()
    }
    /// Manage Running Sessions: ask the host to stop. The lease stays until
    /// the process exit is confirmed; asking again retries the cleanup.
    pub fn terminate(&self, key: &str) -> bool {
        let inner = &mut *self.inner.lock().unwrap();
        let Some(e) = inner.leases.get_mut(key) else {
            return false;
        };
        e.terminating = Some(Instant::now());
        if let Some(stop) = e.on_exceeded.as_ref() {
            stop(Exceeded::Terminated);
        }
        true
    }
    /// The process ids under supervision.
    pub fn pids(&self) -> Vec<u32> {
        let inner = self.inner.lock().unwrap();
        inner.leases.values().filter_map(|e| e.pid).collect()
    }
    /// One monitor tick. Callbacks run after the lock is released.
    pub fn sample(&self, metrics: &[Metric], now: Instant) {
        let p = self.policy;
        let mut fire: Vec<(String, Exceeded)> = Vec::new();
        {
            let mut inner = self.inner.lock().unwrap();
            for (key, e) in inner.leases.iter_mut() {
                if e.failed {
                    continue;
                }
                let metric = e.pid.and_then(|pid| metrics.iter().find(|m| m.pid == pid));
                // Sustained CPU needs contiguous observations: a stalled
                // monitor cannot count missing samples as pressure.
                if metric.is_none()
                    || e.sampled_at
                        .is_none_or(|t| now < t || now - t > Duration::from_secs(4))
                {
                    e.cpu_since = None;
                }
                e.sampled_at = Some(now);
                let Some(m) = metric else { continue };
                e.rss = m.rss;
                e.cpu_since = if m.cpu_percent >= p.sustained_cpu_percent {
                    Some(e.cpu_since.unwrap_or(now))
                } else {
                    None
                };
                let limit = match e.role {
                    Role::Renderer => p.renderer_rss,
                    Role::Utility => p.utility_rss,
                };
                let code = if e.rss > limit {
                    Some(Exceeded::Memory)
                } else if e.cpu_since.is_some_and(|t| now - t >= p.sustained_cpu) {
                    Some(Exceeded::Cpu)
                } else {
                    None
                };
                if let Some(code) = code {
                    e.failed = true;
                    fire.push((key.clone(), code));
                }
            }
            // Aggregate pressure closes only the largest contributor, and only
            // when no earlier closure is still awaiting release.
            let entries: Vec<(&String, &Entry)> = inner.leases.iter().collect();
            let total = self.memory(entries.iter().map(|(_, e)| *e));
            let pressured: Vec<&(&String, &Entry)> = entries
                .iter()
                .filter(|(_, e)| {
                    let window = entries.iter().filter(|(_, o)| o.owner == e.owner);
                    let project = entries
                        .iter()
                        .filter(|(_, o)| o.owner == e.owner && o.project == e.project);
                    total > p.application_rss
                        || self.memory(window.map(|(_, o)| *o)) > p.window_rss
                        || self.memory(project.map(|(_, o)| *o)) > p.project_rss
                })
                .collect();
            let largest = (!pressured.iter().any(|(_, e)| e.failed))
                .then(|| {
                    pressured
                        .iter()
                        .filter(|(_, e)| e.pid.is_some())
                        .max_by_key(|(_, e)| e.rss)
                        .map(|(k, _)| (*k).clone())
                })
                .flatten();
            if let Some(key) = largest {
                inner.leases.get_mut(&key).unwrap().failed = true;
                fire.push((key, Exceeded::AggregateMemory));
            }
        }
        let inner = self.inner.lock().unwrap();
        let calls: Vec<(&OnExceeded, Exceeded)> = fire
            .iter()
            .filter_map(|(key, code)| {
                inner
                    .leases
                    .get(key)
                    .and_then(|e| e.on_exceeded.as_ref())
                    .map(|f| (f, *code))
            })
            .collect();
        // Callbacks must not call back into the budget synchronously.
        for (f, code) in calls {
            f(code);
        }
    }
}

/// The reservation; release it only after the process exit is confirmed.
pub struct HostLease {
    budget: Weak<Budget>,
    key: String,
    released: bool,
}
impl HostLease {
    /// `bindProcess(pid, role, onExceeded)`.
    pub fn bind_process(
        &self,
        pid: u32,
        role: Role,
        on_exceeded: impl Fn(Exceeded) + Send + Sync + 'static,
    ) {
        if let Some(budget) = self.budget.upgrade()
            && let Some(e) = budget.inner.lock().unwrap().leases.get_mut(&self.key)
        {
            e.pid = Some(pid);
            e.role = role;
            e.on_exceeded = Some(Box::new(on_exceeded));
        }
    }
    /// `ready()`: startup finished; frees a concurrent-start slot.
    pub fn ready(&self) {
        if let Some(budget) = self.budget.upgrade()
            && let Some(e) = budget.inner.lock().unwrap().leases.get_mut(&self.key)
        {
            e.starting = false;
        }
    }
    fn release_now(&mut self) {
        if std::mem::replace(&mut self.released, true) {
            return;
        }
        if let Some(budget) = self.budget.upgrade() {
            budget.inner.lock().unwrap().leases.remove(&self.key);
        }
    }
}
impl Drop for HostLease {
    fn drop(&mut self) {
        self.release_now();
    }
}

/// Reads working set and CPU for the supervised pids every interval.
fn spawn_monitor(budget: Weak<Budget>) {
    let _ = std::thread::Builder::new()
        .name("host-budget".into())
        .spawn(move || {
            use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
            let mut system = System::new();
            loop {
                let Some(b) = budget.upgrade() else { return };
                let interval = b.policy.interval;
                let pids: Vec<Pid> = b.pids().into_iter().map(Pid::from_u32).collect();
                if !pids.is_empty() {
                    system.refresh_processes_specifics(
                        ProcessesToUpdate::Some(&pids),
                        ProcessRefreshKind::new().with_memory().with_cpu(),
                    );
                    let metrics: Vec<Metric> = pids
                        .iter()
                        .filter_map(|pid| {
                            system.process(*pid).map(|p| Metric {
                                pid: pid.as_u32(),
                                rss: p.memory(),
                                cpu_percent: p.cpu_usage(),
                            })
                        })
                        .collect();
                    b.sample(&metrics, Instant::now());
                }
                drop(b);
                std::thread::sleep(interval);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn small() -> Policy {
        Policy {
            application: 3,
            window: 2,
            project: 2,
            concurrent_starts: 2,
            ..POLICY
        }
    }

    #[test]
    fn defaults_match_the_product_budget() {
        assert_eq!(
            (
                POLICY.application,
                POLICY.window,
                POLICY.project,
                POLICY.concurrent_starts
            ),
            (24, 16, 12, 4)
        );
        assert_eq!(POLICY.renderer_rss, 805_306_368);
        assert_eq!(POLICY.application_rss, 4_294_967_296);
        assert_eq!(POLICY.window_rss, 3_221_225_472);
        assert_eq!(POLICY.project_rss, 2_147_483_648);
        assert_eq!(POLICY.reservation, 134_217_728);
        assert_eq!(POLICY.sustained_cpu, Duration::from_secs(30));
        assert_eq!(
            (
                POLICY.startup_timeout,
                POLICY.heartbeat_timeout,
                POLICY.close_timeout
            ),
            (
                Duration::from_secs(30),
                Duration::from_secs(15),
                Duration::from_secs(10)
            )
        );
    }

    #[test]
    fn counts_are_admitted_per_application_window_project_and_start() {
        let b = Budget::new(small());
        let a = b.reserve("a", "w1", "p1", "terminal").unwrap();
        assert_eq!(
            b.reserve("a", "w1", "p1", "terminal").err(),
            Some(Refusal::Duplicate)
        );
        let c = b.reserve("c", "w1", "p1", "terminal").unwrap();
        // Two starting hosts fill concurrent starts.
        assert_eq!(
            b.reserve("d", "w2", "p2", "agent").err(),
            Some(Refusal::Exhausted)
        );
        a.ready();
        c.ready();
        // Window w1 already holds two.
        assert_eq!(
            b.reserve("e", "w1", "p9", "agent").err(),
            Some(Refusal::Exhausted)
        );
        let d = b.reserve("d", "w2", "p2", "agent").unwrap();
        d.ready();
        // Application limit of three.
        assert_eq!(
            b.reserve("f", "w3", "p3", "agent").err(),
            Some(Refusal::Exhausted)
        );
        drop(a);
        assert!(b.reserve("f", "w3", "p3", "agent").is_ok());
    }

    #[test]
    fn a_host_over_memory_or_sustained_cpu_is_reported_once() {
        let b = Budget::new(POLICY);
        let hits = Arc::new(AtomicUsize::new(0));
        let lease = b.reserve("t", "w", "p", "terminal").unwrap();
        let h = hits.clone();
        lease.bind_process(10, Role::Utility, move |code| {
            assert_eq!(code, Exceeded::Cpu);
            h.fetch_add(1, Ordering::SeqCst);
        });
        let start = Instant::now();
        for i in 0..=16u64 {
            let now = start + Duration::from_secs(2 * i);
            b.sample(
                &[Metric {
                    pid: 10,
                    rss: 10 * MIB,
                    cpu_percent: 99.,
                }],
                now,
            );
        }
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        let mem = b.reserve("m", "w", "p", "agent").unwrap();
        let h = hits.clone();
        mem.bind_process(11, Role::Utility, move |code| {
            assert_eq!(code, Exceeded::Memory);
            h.fetch_add(1, Ordering::SeqCst);
        });
        b.sample(
            &[Metric {
                pid: 11,
                rss: 900 * MIB,
                cpu_percent: 1.,
            }],
            start,
        );
        assert_eq!(hits.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn renderer_hosts_use_the_renderer_memory_budget() {
        let b = Budget::new(Policy {
            renderer_rss: 100 * MIB,
            ..POLICY
        });
        let lease = b.reserve("web", "w", "p", "html").unwrap();
        let hit = Arc::new(AtomicUsize::new(0));
        let h = hit.clone();
        lease.bind_process(5, Role::Renderer, move |code| {
            assert_eq!(code, Exceeded::Memory);
            h.fetch_add(1, Ordering::SeqCst);
        });
        b.sample(
            &[Metric {
                pid: 5,
                rss: 150 * MIB,
                cpu_percent: 0.,
            }],
            Instant::now(),
        );
        assert_eq!(hit.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn gaps_in_sampling_reset_sustained_cpu() {
        let b = Budget::new(POLICY);
        let lease = b.reserve("t", "w", "p", "terminal").unwrap();
        let fired = Arc::new(AtomicUsize::new(0));
        let f = fired.clone();
        lease.bind_process(10, Role::Utility, move |_| {
            f.fetch_add(1, Ordering::SeqCst);
        });
        let start = Instant::now();
        // 32 seconds of high CPU but with a 6-second hole in the middle.
        for t in [0u64, 2, 4, 6, 8, 10, 12, 14, 20, 22, 24, 26, 28, 30, 32] {
            b.sample(
                &[Metric {
                    pid: 10,
                    rss: MIB,
                    cpu_percent: 99.,
                }],
                start + Duration::from_secs(t),
            );
        }
        assert_eq!(fired.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn terminate_asks_the_host_to_stop_and_keeps_the_lease_until_exit() {
        let b = Budget::new(Policy {
            close_timeout: Duration::from_millis(30),
            ..POLICY
        });
        let lease = b.reserve("t", "w", "p", "terminal").unwrap();
        let stops = Arc::new(AtomicUsize::new(0));
        let s = stops.clone();
        lease.bind_process(1, Role::Utility, move |code| {
            assert_eq!(code, Exceeded::Terminated);
            s.fetch_add(1, Ordering::SeqCst);
        });
        assert_eq!(b.snapshot()[0].cleanup, Cleanup::Pending);
        assert!(b.terminate("t"));
        assert_eq!(stops.load(Ordering::SeqCst), 1);
        assert_eq!(b.snapshot()[0].cleanup, Cleanup::Running);
        std::thread::sleep(Duration::from_millis(40));
        assert_eq!(b.snapshot()[0].cleanup, Cleanup::Unconfirmed);
        // Retry asks again; the confirmed exit releases the lease.
        assert!(b.terminate("t"));
        drop(lease);
        assert!(b.snapshot().is_empty());
        assert!(!b.terminate("t"));
    }

    #[test]
    fn aggregate_pressure_closes_only_the_largest_and_waits_for_release() {
        let b = Budget::new(Policy {
            project_rss: 1024 * MIB,
            utility_rss: 4096 * MIB,
            ..POLICY
        });
        let closed = Arc::new(Mutex::new(Vec::new()));
        let mut leases = Vec::new();
        for (key, pid) in [("a", 1u32), ("b", 2)] {
            let lease = b.reserve(key, "w", "p", "agent").unwrap();
            let c = closed.clone();
            lease.bind_process(pid, Role::Utility, move |code| {
                c.lock().unwrap().push((pid, code));
            });
            leases.push(lease);
        }
        let now = Instant::now();
        let metrics = [
            Metric {
                pid: 1,
                rss: 300 * MIB,
                cpu_percent: 0.,
            },
            Metric {
                pid: 2,
                rss: 800 * MIB,
                cpu_percent: 0.,
            },
        ];
        b.sample(&metrics, now);
        b.sample(&metrics, now + Duration::from_secs(2));
        assert_eq!(
            *closed.lock().unwrap(),
            vec![(2, Exceeded::AggregateMemory)]
        );
        // After the largest releases, the remaining host is under budget.
        leases.pop();
        b.sample(&metrics[..1], now + Duration::from_secs(4));
        assert_eq!(closed.lock().unwrap().len(), 1);
    }
}
