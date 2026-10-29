//! `desktop-telemetry-service.mjs`: the level and notice gate, the bounded
//! once-per-UTC-day activity and first-run cohort events, the local queue
//! (seven calendar days, at most 32 events, batches of 16) and delivery with
//! exponential backoff. Every method blocks on small file I/O; callers run it
//! off the UI thread. Delivery happens on the service's own timer thread.
use super::{
    contract::{self, EventInput, Level, NOTICE_VERSION, SCHEMA_VERSION},
    store::{self, IdentityStore, JsonFile, Lifecycle, Preference, Queue},
    transport::{SendError, Transport},
};
use crate::platform::build_identity::{Channel, Identity};
use chrono::{DateTime, Utc};
use std::{
    io,
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

const MAX_BATCH: usize = 16;
const QUEUE_RETENTION_DAYS: i64 = 7;
const RETENTION_MEASUREMENT_DAYS: i64 = 100;
const RETRY_BASE: Duration = Duration::from_secs(60);
const RETRY_MAX: Duration = Duration::from_secs(6 * 60 * 60);

/// Why nothing is sent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisabledReason {
    UnpackagedBuild,
    NonStableBuild,
    LevelOff,
    NoticeRequired,
    TransportUnconfigured,
}

/// `getSnapshot()`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub schema_version: u32,
    pub default_level: Level,
    pub level: Level,
    pub effective_level: Level,
    pub enabled: bool,
    pub eligible: bool,
    pub disabled_reason: Option<DisabledReason>,
    pub notice_version: u32,
    pub notice_seen_version: u32,
    /// Eligible, not off, and the current notice has not been shown.
    pub notice_required: bool,
    pub transport_configured: bool,
    pub queued_event_count: usize,
}

/// `resolveTelemetryEligibility`: only a packaged Stable build may send; the
/// default level is Basic everywhere.
pub fn eligibility(identity: &Identity) -> Result<(), DisabledReason> {
    if !identity.packaged {
        Err(DisabledReason::UnpackagedBuild)
    } else if identity.channel != Channel::Stable {
        Err(DisabledReason::NonStableBuild)
    } else {
        Ok(())
    }
}
pub const DEFAULT_LEVEL: Level = Level::Basic;

/// Clock, identifiers and logging; tests replace them.
pub struct Deps {
    pub now: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    pub uuid: Box<dyn Fn() -> String + Send + Sync>,
    pub secret: Box<dyn Fn() -> [u8; 32] + Send + Sync>,
    pub random: Box<dyn Fn() -> f64 + Send + Sync>,
    /// Delivery failures, without payloads.
    pub warn: Box<dyn Fn(SendError) + Send + Sync>,
    /// Run delivery on a timer thread (tests flush by hand).
    pub timers: bool,
}
impl Default for Deps {
    fn default() -> Self {
        Self {
            now: Box::new(Utc::now),
            uuid: Box::new(|| uuid::Uuid::new_v4().to_string()),
            secret: Box::new(|| {
                let mut bytes = [0; 32];
                getrandom::fill(&mut bytes).expect("system randomness");
                bytes
            }),
            random: Box::new(|| {
                let mut bytes = [0; 8];
                let _ = getrandom::fill(&mut bytes);
                (u64::from_le_bytes(bytes) >> 11) as f64 / (1u64 << 53) as f64
            }),
            warn: Box::new(|e| {
                eprintln!(
                    "Desktop telemetry delivery failed (retryable: {}, status: {:?}).",
                    e.retryable, e.status
                )
            }),
            timers: true,
        }
    }
}

pub struct Config {
    /// `<data dir>/desktop-telemetry`.
    pub root: PathBuf,
    pub identity: Identity,
    /// Node's `process.platform` / `process.arch`.
    pub platform: String,
    pub architecture: String,
    /// Already normalized (`normalizeDesktopOsMajor`).
    pub os_major: String,
    pub transport: Option<Arc<dyn Transport>>,
}

struct State {
    preference: Preference,
    queue: Queue,
    lifecycle: Lifecycle,
}

struct Inner {
    config: Config,
    eligibility: Result<(), DisabledReason>,
    deps: Deps,
    identity: Mutex<IdentityStore>,
    state: Mutex<Option<State>>,
    /// Serializes mutations like the product's promise chain; delivery
    /// takes it only to pick a batch and to apply the answer.
    ops: Mutex<()>,
    flushing: AtomicBool,
    timer: Mutex<Timer>,
    wake: Condvar,
}
#[derive(Default)]
struct Timer {
    deadline: Option<Instant>,
    attempt: u32,
    disposed: bool,
    worker: bool,
}

#[derive(Clone)]
pub struct Service(Arc<Inner>);

impl Service {
    pub fn new(config: Config, mut deps: Deps) -> Self {
        let eligibility = eligibility(&config.identity);
        let secret = std::mem::replace(&mut deps.secret, Box::new(|| [0; 32]));
        let identity = IdentityStore::new(config.root.join(store::IDENTITY), secret);
        Self(Arc::new(Inner {
            eligibility,
            identity: Mutex::new(identity),
            state: Mutex::new(None),
            ops: Mutex::new(()),
            flushing: AtomicBool::new(false),
            timer: Mutex::new(Timer::default()),
            wake: Condvar::new(),
            deps,
            config,
        }))
    }

    fn file(&self, name: &str) -> JsonFile {
        JsonFile::new(self.0.config.root.join(name))
    }

    /// Reads the four files once; a missing lifecycle is created as a fresh
    /// cohort only when no earlier telemetry state exists.
    pub fn initialize(&self) -> io::Result<Snapshot> {
        let _ops = self.0.ops.lock().unwrap();
        self.initialize_locked()
    }
    fn initialize_locked(&self) -> io::Result<Snapshot> {
        if let Some(snapshot) = self.snapshot() {
            return Ok(snapshot);
        }
        let has_identity = self.0.identity.lock().unwrap().has_stored_identity()?;
        let lifecycle = Lifecycle::normalize(self.file(store::LIFECYCLE).read()?.as_ref());
        let preference = Preference::normalize(
            self.file(store::PREFERENCES).read()?.as_ref(),
            DEFAULT_LEVEL,
        );
        let queue = Queue::normalize(self.file(store::QUEUE).read()?.as_ref());
        let lifecycle = match lifecycle {
            Some(lifecycle) => lifecycle,
            None => {
                let prior = has_identity
                    || preference.notice_seen_version > 0
                    || preference.updated_at.is_some()
                    || queue.last_enqueued_utc_day.is_some()
                    || !queue.events.is_empty();
                let initial = Lifecycle::initial(!prior);
                self.file(store::LIFECYCLE).write(&initial)?;
                initial
            }
        };
        *self.0.state.lock().unwrap() = Some(State {
            preference,
            queue,
            lifecycle,
        });
        Ok(self.snapshot().expect("initialized"))
    }

    /// `start()`: initialize, start the delivery timer and send anything
    /// already queued.
    pub fn start(&self) -> io::Result<Snapshot> {
        let snapshot = self.initialize()?;
        let spawn = {
            let mut timer = self.0.timer.lock().unwrap();
            let spawn = self.0.deps.timers && !timer.worker;
            timer.worker |= spawn;
            spawn
        };
        if spawn {
            let weak = Arc::downgrade(&self.0);
            let _ = std::thread::Builder::new()
                .name("telemetry-delivery".into())
                .spawn(move || deliver_on_schedule(weak));
        }
        if snapshot.enabled && snapshot.queued_event_count > 0 {
            self.schedule_flush(Duration::ZERO);
        }
        Ok(snapshot)
    }

    pub fn snapshot(&self) -> Option<Snapshot> {
        let state = self.0.state.lock().unwrap();
        let state = state.as_ref()?;
        let reason = self.disabled_reason(state);
        let preference = &state.preference;
        Some(Snapshot {
            schema_version: SCHEMA_VERSION,
            default_level: DEFAULT_LEVEL,
            level: preference.level,
            effective_level: if reason.is_some() {
                Level::Off
            } else {
                preference.level
            },
            enabled: reason.is_none(),
            eligible: self.0.eligibility.is_ok(),
            disabled_reason: reason,
            notice_version: NOTICE_VERSION,
            notice_seen_version: preference.notice_seen_version,
            notice_required: self.0.eligibility.is_ok()
                && preference.level != Level::Off
                && preference.notice_seen_version < NOTICE_VERSION,
            transport_configured: self.0.config.transport.is_some(),
            queued_event_count: state.queue.events.len(),
        })
    }

    fn disabled_reason(&self, state: &State) -> Option<DisabledReason> {
        if let Err(reason) = self.0.eligibility {
            Some(reason)
        } else if state.preference.level == Level::Off {
            Some(DisabledReason::LevelOff)
        } else if state.preference.notice_seen_version < NOTICE_VERSION {
            Some(DisabledReason::NoticeRequired)
        } else if self.0.config.transport.is_none() {
            Some(DisabledReason::TransportUnconfigured)
        } else {
            None
        }
    }

    fn with_state<T>(&self, f: impl FnOnce(&mut State) -> T) -> T {
        let mut state = self.0.state.lock().unwrap();
        f(state.as_mut().expect("initialized"))
    }
    fn now_iso(&self) -> String {
        store::iso((self.0.deps.now)())
    }

    /// `markNoticeSeen()`.
    pub fn mark_notice_seen(&self) -> io::Result<Snapshot> {
        let _ops = self.0.ops.lock().unwrap();
        self.initialize_locked()?;
        let mut next = self.with_state(|s| s.preference.clone());
        if next.notice_seen_version < NOTICE_VERSION {
            next.notice_seen_version = NOTICE_VERSION;
            next.updated_at = Some(self.now_iso());
            self.file(store::PREFERENCES).write(&next)?;
            self.with_state(|s| s.preference = next);
        }
        Ok(self.snapshot().expect("initialized"))
    }

    /// `setLevel()`: choosing Basic acknowledges the current notice;
    /// choosing Off clears the queue, the local identity and the cohort.
    pub fn set_level(&self, level: Level) -> io::Result<Snapshot> {
        let _ops = self.0.ops.lock().unwrap();
        self.initialize_locked()?;
        let current = self.with_state(|s| s.preference.clone());
        let acknowledge = level == Level::Basic && current.notice_seen_version < NOTICE_VERSION;
        if current.level != level || acknowledge {
            let next = Preference {
                level,
                notice_seen_version: if acknowledge {
                    NOTICE_VERSION
                } else {
                    current.notice_seen_version
                },
                updated_at: Some(self.now_iso()),
                ..current
            };
            self.file(store::PREFERENCES).write(&next)?;
            self.with_state(|s| s.preference = next);
        }
        if level == Level::Off {
            self.forget()?;
        }
        Ok(self.snapshot().expect("initialized"))
    }

    /// `resetIdentity()`. The product exposes it over IPC (`telemetry:reset-identity`)
    /// without a renderer consumer; Off performs the same forgetting.
    #[cfg(test)]
    pub fn reset_identity(&self) -> io::Result<Snapshot> {
        let _ops = self.0.ops.lock().unwrap();
        self.initialize_locked()?;
        self.forget()?;
        Ok(self.snapshot().expect("initialized"))
    }

    fn forget(&self) -> io::Result<()> {
        self.cancel_retry();
        self.file(store::QUEUE).remove()?;
        self.0.identity.lock().unwrap().clear()?;
        let neutral = Lifecycle::neutral();
        self.file(store::LIFECYCLE).write(&neutral)?;
        self.with_state(|s| {
            s.queue = Queue::empty();
            s.lifecycle = neutral;
        });
        Ok(())
    }

    /// `noteForegroundActivity()`: while enabled, queue the first-run event
    /// once for a fresh cohort and one daily-active event per UTC day; the
    /// retention ID rides along only in the first 100 lifecycle days.
    /// Returns whether anything was queued.
    pub fn note_foreground_activity(&self) -> io::Result<(bool, Snapshot)> {
        let _ops = self.0.ops.lock().unwrap();
        self.initialize_locked()?;
        let (reason, lifecycle, queue) = self.with_state(|s| {
            (
                self.disabled_reason(s),
                s.lifecycle.clone(),
                s.queue.clone(),
            )
        });
        let snapshot = || self.snapshot().expect("initialized");
        if reason.is_some() {
            return Ok((false, snapshot()));
        }
        let now = (self.0.deps.now)();
        let day = now.format("%Y-%m-%d").to_string();
        let first_run =
            lifecycle.cohort_status == store::Cohort::Fresh && !lifecycle.first_run_enqueued;
        let daily = queue.last_enqueued_utc_day.as_deref() != Some(day.as_str());
        if !first_run && !daily {
            if !queue.events.is_empty() {
                self.schedule_flush(Duration::ZERO);
            }
            return Ok((false, snapshot()));
        }
        let include_retention = first_run
            || lifecycle
                .first_run_utc_day
                .as_deref()
                .is_some_and(|first| within_measurement(first, &day));
        let (anonymous, retention) = {
            let mut identity = self.0.identity.lock().unwrap();
            let anonymous = identity.monthly_anonymous_id(now)?;
            let retention = if include_retention {
                Some(identity.retention_anonymous_id()?)
            } else {
                None
            };
            (anonymous, retention)
        };
        let architecture = &self.0.config.architecture;
        let mut events = Vec::new();
        for (wanted, factory) in [
            (first_run, contract::first_run as fn(&EventInput) -> _),
            (daily, contract::daily_active),
        ] {
            if !wanted {
                continue;
            }
            let event_id = (self.0.deps.uuid)();
            let event = factory(&EventInput {
                activity_day: &day,
                anonymous_id: &anonymous,
                app_version: &self.0.config.identity.version,
                architecture,
                event_id: &event_id,
                os_major: &self.0.config.os_major,
                platform: &self.0.config.platform,
                retention_id: retention.as_deref(),
            })
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("{e:?}")))?;
            events.push(event);
        }
        let mut next = queue;
        if daily {
            next.last_enqueued_utc_day = Some(day.clone());
        }
        next.events.extend(events);
        store::keep_newest(&mut next.events);
        self.file(store::QUEUE).write(&next)?;
        self.with_state(|s| s.queue = next);
        if first_run {
            let next = Lifecycle {
                first_run_utc_day: Some(day),
                first_run_enqueued: true,
                ..lifecycle
            };
            self.file(store::LIFECYCLE).write(&next)?;
            self.with_state(|s| s.lifecycle = next);
        }
        self.schedule_flush(Duration::ZERO);
        Ok((true, snapshot()))
    }

    /// `flush()`: drop events older than seven calendar days, send one batch
    /// of 16, and keep what was not accepted. A retryable failure backs off
    /// (one minute doubling to six hours, ±20% jitter); any other answer
    /// drops the batch.
    pub fn flush(&self) -> io::Result<Snapshot> {
        self.initialize()?;
        if self.0.flushing.swap(true, Ordering::AcqRel) {
            return Ok(self.snapshot().expect("initialized"));
        }
        struct Done<'a>(&'a AtomicBool);
        impl Drop for Done<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _done = Done(&self.0.flushing);
        let batch = {
            let _ops = self.0.ops.lock().unwrap();
            let (reason, mut queue) =
                self.with_state(|s| (self.disabled_reason(s), s.queue.clone()));
            if reason.is_some() || queue.events.is_empty() {
                return Ok(self.snapshot().expect("initialized"));
            }
            let first_retained = ((self.0.deps.now)().date_naive()
                - chrono::Days::new(QUEUE_RETENTION_DAYS as u64 - 1))
            .format("%Y-%m-%d")
            .to_string();
            let before = queue.events.len();
            queue.events.retain(|e| e.activity_day >= first_retained);
            if queue.events.len() != before {
                self.file(store::QUEUE).write(&queue)?;
                self.with_state(|s| s.queue = queue.clone());
            }
            if queue.events.is_empty() {
                return Ok(self.snapshot().expect("initialized"));
            }
            queue.events.truncate(MAX_BATCH);
            queue.events
        };
        let Some(transport) = self.0.config.transport.clone() else {
            return Ok(self.snapshot().expect("initialized"));
        };
        let result = transport.send(&batch);
        let _ops = self.0.ops.lock().unwrap();
        // Switched off while sending: the queue is already gone.
        if self.with_state(|s| self.disabled_reason(s)).is_some() {
            return Ok(self.snapshot().expect("initialized"));
        }
        let remove = match result {
            Ok(accepted) => {
                self.0.timer.lock().unwrap().attempt = 0;
                self.cancel_retry();
                Some(accepted)
            }
            Err(error) => {
                (self.0.deps.warn)(error);
                if error.retryable {
                    self.schedule_retry();
                    None
                } else {
                    self.0.timer.lock().unwrap().attempt = 0;
                    Some(batch.iter().map(|e| e.event_id.clone()).collect())
                }
            }
        };
        if let Some(remove) = remove {
            let mut queue = self.with_state(|s| s.queue.clone());
            queue.events.retain(|e| !remove.contains(&e.event_id));
            self.file(store::QUEUE).write(&queue)?;
            let more = !queue.events.is_empty();
            self.with_state(|s| s.queue = queue);
            if more {
                self.schedule_flush(Duration::ZERO);
            }
        }
        Ok(self.snapshot().expect("initialized"))
    }

    fn schedule_flush(&self, delay: Duration) {
        let mut timer = self.0.timer.lock().unwrap();
        if timer.disposed || timer.deadline.is_some() || self.0.config.transport.is_none() {
            return;
        }
        timer.deadline = Some(Instant::now() + delay);
        self.0.wake.notify_all();
    }
    fn schedule_retry(&self) {
        let delay = {
            let mut timer = self.0.timer.lock().unwrap();
            if timer.disposed || timer.deadline.is_some() {
                return;
            }
            let exponential = RETRY_BASE
                .saturating_mul(2u32.saturating_pow(timer.attempt))
                .min(RETRY_MAX);
            timer.attempt += 1;
            let jitter = 0.8 + (self.0.deps.random)().clamp(0., 1.) * 0.4;
            Duration::from_millis((exponential.as_millis() as f64 * jitter).round() as u64)
        };
        self.schedule_flush(delay);
    }
    fn cancel_retry(&self) {
        self.0.timer.lock().unwrap().deadline = None;
    }
    /// When delivery is next due, if it is scheduled.
    #[cfg(test)]
    pub fn pending_flush(&self) -> Option<Duration> {
        let timer = self.0.timer.lock().unwrap();
        timer
            .deadline
            .map(|d| d.saturating_duration_since(Instant::now()))
    }

    /// Stops the timer thread; nothing is scheduled afterwards.
    pub fn dispose(&self) {
        let mut timer = self.0.timer.lock().unwrap();
        timer.disposed = true;
        timer.deadline = None;
        self.0.wake.notify_all();
    }
}

/// The timer thread: waits for the next deadline and flushes.
fn deliver_on_schedule(weak: Weak<Inner>) {
    loop {
        let Some(inner) = weak.upgrade() else {
            return;
        };
        let due = {
            let mut timer = inner.timer.lock().unwrap();
            loop {
                if timer.disposed {
                    return;
                }
                match timer.deadline {
                    Some(deadline) if deadline <= Instant::now() => {
                        timer.deadline = None;
                        break true;
                    }
                    Some(deadline) => {
                        let wait = deadline.saturating_duration_since(Instant::now());
                        timer = inner.wake.wait_timeout(timer, wait).unwrap().0;
                    }
                    // Wake periodically so a dropped service ends the thread.
                    None => {
                        let (next, result) = inner
                            .wake
                            .wait_timeout(timer, Duration::from_secs(60))
                            .unwrap();
                        timer = next;
                        if result.timed_out() && Arc::strong_count(&inner) == 1 {
                            return;
                        }
                    }
                }
            }
        };
        if due {
            let _ = Service(inner).flush();
        }
    }
}

fn within_measurement(first: &str, day: &str) -> bool {
    let parse = |d: &str| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok();
    let (Some(first), Some(day)) = (parse(first), parse(day)) else {
        return false;
    };
    let elapsed = (day - first).num_days();
    (0..RETENTION_MEASUREMENT_DAYS).contains(&elapsed)
}

/// First launch next to an Electron installation: carry over the user's
/// analytics choice and whether they saw the notice, so turning analytics
/// off there is honoured here and the notice is not shown twice. The
/// identity, queue and cohort stay with that app. Returns whether a
/// preference was imported.
pub fn import_electron_preference(electron_root: &Path, root: &Path) -> io::Result<bool> {
    let ours = JsonFile::new(root.join(store::PREFERENCES));
    if ours.exists() {
        return Ok(false);
    }
    let Some(theirs) = JsonFile::new(electron_root.join(store::PREFERENCES)).read()? else {
        return Ok(false);
    };
    if theirs.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
        return Ok(false);
    }
    ours.write(&Preference::normalize(Some(&theirs), DEFAULT_LEVEL))?;
    Ok(true)
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
