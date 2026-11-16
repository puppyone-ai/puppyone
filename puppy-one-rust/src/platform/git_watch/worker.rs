use super::{
    Identity, WorkerHandle, identity,
    snapshot::{MAX_ENTRIES, snapshot_with},
};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU8, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

#[cfg(test)]
mod tests;

const RECONCILE: Duration = Duration::from_secs(2);
const DEBOUNCE: Duration = Duration::from_millis(120);
const REARM_MIN: Duration = Duration::from_millis(250);
const REARM_MAX: Duration = Duration::from_secs(30);
const CHANGED: u8 = 1;
const REARM: u8 = 2;

pub(super) enum Signal {
    Wake(u64, Arc<AtomicU8>),
    Stop,
}

/// One queued notification per native handle, even during an event storm.
/// A retired handle cannot affect the replacement's generation.
#[derive(Clone)]
struct Wake {
    generation: u64,
    pending: Arc<AtomicU8>,
    sender: mpsc::Sender<Signal>,
}
impl Wake {
    fn notify(&self, flags: u8) {
        if self.pending.fetch_or(flags, Ordering::AcqRel) == 0 {
            let _ = self
                .sender
                .send(Signal::Wake(self.generation, self.pending.clone()));
        }
    }
}

trait WatchHandle: Send {
    fn retire(&self) {}
}
#[cfg(test)]
impl WatchHandle for () {}
type Handle = Box<dyn WatchHandle>;
type Factory = Arc<
    dyn Fn(&Path, Option<&Identity>, fn(&str) -> bool, Wake) -> Result<Handle, String>
        + Send
        + Sync,
>;
type Resolver = Arc<dyn Fn(&Path) -> Result<Identity, String> + Send + Sync>;

mod native;
use native::arm;

struct Worker {
    root: PathBuf,
    identity: Option<Identity>,
    last: Option<String>,
    handle: Option<Handle>,
    generation: u64,
    sender: mpsc::Sender<Signal>,
    noise: fn(&str) -> bool,
    factory: Factory,
    resolver: Resolver,
    debounce: Option<Instant>,
    rearm: Option<Instant>,
    delay: Duration,
    reconcile: Instant,
    cancelled: Arc<AtomicBool>,
}
impl Worker {
    fn new(
        root: PathBuf,
        noise: fn(&str) -> bool,
        sender: mpsc::Sender<Signal>,
        factory: Factory,
        resolver: Resolver,
        now: Instant,
    ) -> Self {
        Self {
            identity: resolver(&root).ok(),
            root,
            last: None,
            handle: None,
            generation: 0,
            sender,
            noise,
            factory,
            resolver,
            debounce: None,
            rearm: None,
            delay: REARM_MIN,
            reconcile: now + RECONCILE,
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
    fn read(&self) -> Option<String> {
        self.identity.as_ref().and_then(|i| {
            snapshot_with(
                &i.top_level,
                &i.git_dir,
                &i.common_dir,
                &self.cancelled,
                MAX_ENTRIES,
            )
        })
    }
    fn install(&mut self, now: Instant) {
        if let Some(handle) = &self.handle {
            handle.retire();
        }
        self.handle = None;
        self.generation = self.generation.wrapping_add(1);
        let wake = Wake {
            generation: self.generation,
            pending: Arc::new(AtomicU8::new(0)),
            sender: self.sender.clone(),
        };
        match (self.factory)(&self.root, self.identity.as_ref(), self.noise, wake) {
            Ok(handle) => {
                self.handle = Some(handle);
                self.rearm = None;
                self.delay = REARM_MIN;
            }
            Err(_) => {
                self.rearm = Some(now + self.delay);
                self.delay = (self.delay * 2).min(REARM_MAX);
            }
        }
    }
    fn resolve(&mut self) -> bool {
        let next = (self.resolver)(&self.root).ok();
        let changed = next != self.identity;
        if changed {
            self.identity = next;
            self.last = self.read();
        }
        changed
    }
    fn signal(&mut self, signal: Signal, now: Instant) -> bool {
        match signal {
            Signal::Stop => return false,
            Signal::Wake(generation, pending) => {
                let flags = pending.swap(0, Ordering::AcqRel);
                if generation != self.generation {
                    return true;
                }
                if flags & CHANGED != 0 {
                    self.debounce.get_or_insert(now + DEBOUNCE);
                }
                if flags & REARM != 0 && self.rearm.is_none() {
                    self.rearm = Some(now + self.delay);
                    self.delay = (self.delay * 2).min(REARM_MAX);
                }
            }
        }
        true
    }
    fn tick(&mut self, now: Instant, changed: &dyn Fn()) {
        if self.cancelled.load(Ordering::Relaxed) {
            return;
        }
        let mut publish = false;
        if self.rearm.is_some_and(|deadline| now >= deadline) {
            self.resolve();
            self.install(now);
            self.last = self.read();
            publish = true;
        }
        if now >= self.reconcile {
            self.reconcile = now + RECONCILE;
            if self.identity.is_none() {
                if self.resolve() {
                    self.install(now);
                    publish = true;
                }
            } else {
                let next = self.read();
                if next.is_none() || next != self.last {
                    self.resolve();
                    self.last = self.read();
                    // Reconciliation repairs a silently dead OS stream too.
                    // A pending retry keeps its exponential deadline.
                    if self.rearm.is_none() {
                        self.install(now);
                    }
                    publish = true;
                }
            }
        }
        if self.debounce.is_some_and(|deadline| now >= deadline) {
            self.last = self.read();
            publish = true;
        }
        if publish && !self.cancelled.load(Ordering::Relaxed) {
            self.debounce = None;
            changed();
        }
    }
    fn deadline(&self) -> Instant {
        self.debounce
            .into_iter()
            .chain(self.rearm)
            .fold(self.reconcile, Instant::min)
    }
}

pub(super) fn start(
    root: &Path,
    noise: fn(&str) -> bool,
    changed: impl Fn() + Send + 'static,
) -> Result<WorkerHandle, String> {
    start_with(root, noise, changed, Arc::new(arm), Arc::new(identity))
}

#[cfg(test)]
pub(super) fn start_silent(
    root: &Path,
    noise: fn(&str) -> bool,
    changed: impl Fn() + Send + 'static,
) -> Result<WorkerHandle, String> {
    start_with(
        root,
        noise,
        changed,
        Arc::new(|_, _, _, _| Ok(Box::new(()))),
        Arc::new(identity),
    )
}

fn start_with(
    root: &Path,
    noise: fn(&str) -> bool,
    changed: impl Fn() + Send + 'static,
    factory: Factory,
    resolver: Resolver,
) -> Result<WorkerHandle, String> {
    let (sender, receiver) = mpsc::channel();
    let now = Instant::now();
    let mut worker = Worker::new(
        root.to_path_buf(),
        noise,
        sender.clone(),
        factory,
        resolver,
        now,
    );
    worker.install(now);
    // Arm pending roots before resolving again: git init in that gap need not
    // produce a future event. A successful initial baseline precedes return.
    if worker.identity.is_none() && worker.resolve() {
        worker.install(Instant::now());
        changed();
    }
    worker.last = worker.read();
    let cancelled = worker.cancelled.clone();
    crate::localization::spawn(move || {
        loop {
            let wait = worker.deadline().saturating_duration_since(Instant::now());
            match receiver.recv_timeout(wait) {
                Ok(signal) => {
                    if !worker.signal(signal, Instant::now()) {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                _ => {}
            }
            worker.tick(Instant::now(), &changed);
        }
    });
    Ok(WorkerHandle {
        stop: sender,
        cancelled,
    })
}
