use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

pub(super) const TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const CANCELLED: &str = "Word diff loading was cancelled.";
pub(super) const TIMED_OUT: &str = "Word diff exceeded the 20000 ms processing limit.";
static NEVER_CANCEL: AtomicBool = AtomicBool::new(false);

/// Cooperative checkpoints bound CPU work as well as package decompression.
/// The clock is injectable so tests can cross a deadline inside each stage
/// without sleeping or depending on the host's speed.
pub(super) struct Budget<'a> {
    cancel: &'a AtomicBool,
    clock: &'a dyn Fn() -> Instant,
    started: Instant,
    timeout: Option<Duration>,
}
impl<'a> Budget<'a> {
    pub(super) fn standard(cancel: &'a AtomicBool) -> Self {
        Self::with_clock(cancel, Some(TIMEOUT), &Instant::now)
    }
    pub(super) fn unlimited() -> Self {
        Self::with_clock(&NEVER_CANCEL, None, &Instant::now)
    }
    pub(super) fn with_clock(
        cancel: &'a AtomicBool,
        timeout: Option<Duration>,
        clock: &'a dyn Fn() -> Instant,
    ) -> Self {
        Self {
            cancel,
            clock,
            started: clock(),
            timeout,
        }
    }
    pub(super) fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Acquire) {
            return Err(CANCELLED.into());
        }
        if self.timeout.is_some_and(|timeout| {
            (self.clock)().saturating_duration_since(self.started) >= timeout
        }) {
            return Err(TIMED_OUT.into());
        }
        Ok(())
    }
}
