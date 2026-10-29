//! `repositoryContextRecovery.ts`: recovery for the read-only
//! repository-context query only — never for writes, Push, allocation or
//! file mutations.
//!
//! One initial request plus at most two jittered retries (0.75–1.5 s, then
//! 1.5–3 s) for transport failures, timeouts and 408/500/502/503/504.
//! Afterwards a returning window or a regained network allows one coalesced
//! probe, at least five seconds after the previous attempt started. There is
//! no background polling and no stale authorization fallback; denials,
//! missing projects, changed sessions and cancellations are not retried.
// Consumed by the Cloud navigation surface (Homepage catalog, Header switch,
// Share), which stays behind the Cloud experiment until its UI lands.
#![cfg_attr(not(test), allow(dead_code))]
use crate::cloud_auth::Error as AuthError;
use std::time::{Duration, Instant};

/// `canRecoverRepositoryContext`.
pub fn recoverable(error: &AuthError) -> bool {
    match error {
        AuthError::SessionChanged | AuthError::Cancelled => false,
        AuthError::Unavailable => true,
        AuthError::Response(status, _) | AuthError::Http(status) => {
            matches!(status, 408 | 500 | 502 | 503 | 504)
        }
        _ => false,
    }
}

/// What the owner should do next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Next {
    /// Nothing: success, an unrecoverable failure, or the budget is spent.
    Idle,
    /// Run the query again after this delay.
    RetryAfter(Duration),
}

/// The recovery state of one repository/session/project context. A context
/// change discards the controller (and with it any pending retry).
#[derive(Debug)]
pub struct Controller {
    retries: u32,
    recoverable: bool,
    in_flight: bool,
    retry_pending: bool,
    last_start: Option<Instant>,
}
impl Default for Controller {
    fn default() -> Self {
        Self::new()
    }
}
impl Controller {
    pub const MAX_RETRIES: u32 = 2;
    pub const PROBE_SPACING: Duration = Duration::from_secs(5);
    pub fn new() -> Self {
        Self {
            retries: 0,
            recoverable: false,
            in_flight: false,
            retry_pending: false,
            last_start: None,
        }
    }
    /// The query starts (initial, retry or probe). `false`: one is in flight.
    pub fn start(&mut self, now: Instant) -> bool {
        if self.in_flight {
            return false;
        }
        self.in_flight = true;
        self.retry_pending = false;
        self.recoverable = false;
        self.last_start = Some(now);
        true
    }
    /// The query finished. `jitter` in [0, 1) picks the delay inside its band.
    pub fn finish(&mut self, result: Result<(), &AuthError>, jitter: f64) -> Next {
        self.in_flight = false;
        let Err(error) = result else {
            self.retries = 0;
            return Next::Idle;
        };
        self.recoverable = recoverable(error);
        if self.recoverable && self.retries < Self::MAX_RETRIES {
            let ceiling = 1_500.0 * 2f64.powi(self.retries as i32);
            self.retries += 1;
            self.retry_pending = true;
            let delay = ceiling / 2.0 + jitter.clamp(0.0, 0.999) * ceiling / 2.0;
            return Next::RetryAfter(Duration::from_millis(delay as u64));
        }
        Next::Idle
    }
    /// Focus, visibility or online: one throttled probe after the budget is
    /// spent, only while the last failure was recoverable.
    pub fn probe(&mut self, now: Instant) -> Next {
        if !self.recoverable || self.in_flight || self.retry_pending {
            return Next::Idle;
        }
        let earliest = self.last_start.map_or(now, |t| t + Self::PROBE_SPACING);
        self.retry_pending = true;
        Next::RetryAfter(
            earliest
                .saturating_duration_since(now)
                .min(Self::PROBE_SPACING),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_transport_and_transient_server_failures_recover() {
        assert!(recoverable(&AuthError::Unavailable));
        for status in [408, 500, 502, 503, 504] {
            assert!(recoverable(&AuthError::Response(status, None)), "{status}");
        }
        for error in [
            AuthError::Http(401),
            AuthError::Http(403),
            AuthError::Http(404),
            AuthError::Response(429, None),
            AuthError::SessionChanged,
            AuthError::Cancelled,
        ] {
            assert!(!recoverable(&error), "{error:?}");
        }
    }

    #[test]
    fn two_jittered_retries_then_throttled_probes() {
        let start = Instant::now();
        let mut c = Controller::new();
        assert!(c.start(start));
        assert!(!c.start(start), "one query at a time");
        let first = c.finish(Err(&AuthError::Unavailable), 0.0);
        assert_eq!(first, Next::RetryAfter(Duration::from_millis(750)));
        c.start(start + Duration::from_millis(750));
        let second = c.finish(Err(&AuthError::Response(503, None)), 0.999);
        assert!(
            matches!(second, Next::RetryAfter(d) if d >= Duration::from_millis(2_990) && d < Duration::from_secs(3))
        );
        let at = start + Duration::from_secs(4);
        c.start(at);
        assert_eq!(c.finish(Err(&AuthError::Unavailable), 0.5), Next::Idle);
        // Focus right away: waits for the five-second spacing; probes coalesce.
        assert_eq!(
            c.probe(at + Duration::from_secs(1)),
            Next::RetryAfter(Duration::from_secs(4))
        );
        assert_eq!(c.probe(at + Duration::from_secs(1)), Next::Idle);
    }

    #[test]
    fn denials_never_schedule_retries_or_probes() {
        let mut c = Controller::new();
        c.start(Instant::now());
        assert_eq!(c.finish(Err(&AuthError::Http(403)), 0.1), Next::Idle);
        assert_eq!(c.probe(Instant::now()), Next::Idle);
        c.start(Instant::now());
        assert_eq!(c.finish(Ok(()), 0.1), Next::Idle);
    }
}
