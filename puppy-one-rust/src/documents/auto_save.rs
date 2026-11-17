//! The product's idle auto-save policy. Timing cannot bypass the Working
//! Copy's conflict checks, snapshot validation or close/drain barriers.
use std::time::{Duration, Instant};

pub(super) const IDLE: Duration = Duration::from_millis(800);
pub(super) const MAX_WAIT: Duration = Duration::from_millis(2000);
pub(super) const SLOW_SAVE: Duration = Duration::from_millis(1500);

pub(super) struct Scheduler {
    idle: Duration,
    max_wait: Duration,
    first: Option<Instant>,
    due: Option<Instant>,
}
impl Default for Scheduler {
    fn default() -> Self {
        Self::new(IDLE, MAX_WAIT)
    }
}
impl Scheduler {
    pub fn new(idle: Duration, max_wait: Duration) -> Self {
        Self {
            idle,
            max_wait,
            first: None,
            due: None,
        }
    }
    pub fn schedule(&mut self, now: Instant) {
        let first = *self.first.get_or_insert(now);
        self.due = Some((now + self.idle).min(first + self.max_wait));
    }
    pub fn delay(&self, now: Instant) -> Option<Duration> {
        self.due.map(|due| due.saturating_duration_since(now))
    }
    pub fn take_due(&mut self, now: Instant) -> bool {
        if self.due.is_some_and(|due| now >= due) {
            self.cancel();
            true
        } else {
            false
        }
    }
    pub fn flush(&mut self) -> bool {
        let pending = self.due.is_some();
        self.cancel();
        pending
    }
    pub fn cancel(&mut self) {
        self.first = None;
        self.due = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_delays_bound_continuous_edits_and_restart_after_cancel_or_flush() {
        let origin = Instant::now();
        let mut s = Scheduler::new(Duration::from_millis(10), Duration::from_millis(25));
        let mut saves = Vec::new();
        for elapsed in (0..30).step_by(6) {
            let now = origin + Duration::from_millis(elapsed);
            s.schedule(now);
            let due = now + s.delay(now).unwrap();
            if due <= now + Duration::from_millis(6) {
                assert!(s.take_due(due));
                saves.push(due.duration_since(origin).as_millis());
            }
        }
        assert_eq!(saves, [25]);
        assert_eq!(s.delay(origin + Duration::from_millis(30)), None);
        s.schedule(origin + Duration::from_millis(30));
        assert_eq!(
            s.delay(origin + Duration::from_millis(30)),
            Some(Duration::from_millis(10))
        );
        assert!(s.flush());
        assert!(!s.flush());
        s.schedule(origin + Duration::from_millis(31));
        s.cancel();
        assert!(!s.take_due(origin + Duration::from_secs(1)));
        s.schedule(origin + Duration::from_secs(1));
        assert!(!s.take_due(origin + Duration::from_millis(1009)));
        assert!(s.take_due(origin + Duration::from_millis(1010)));
    }

    #[test]
    fn actual_typescript_scheduler_transition_oracle() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../fixtures/test-parity-oracle.json")).unwrap();
        let origin = Instant::now();
        let mut now = origin;
        let mut scheduler = Scheduler::default();
        let mut saved = Vec::new();
        for (index, step) in fixture["autoSave"].as_array().unwrap().iter().enumerate() {
            match step["action"].as_str().unwrap() {
                "schedule" => scheduler.schedule(now),
                "cancel" => scheduler.cancel(),
                "flush" => {
                    if scheduler.flush() {
                        saved.push(now.duration_since(origin).as_millis() as u64);
                    }
                }
                "advance" => {
                    let until = now + Duration::from_millis(step["ms"].as_u64().unwrap());
                    if let Some(delay) = scheduler.delay(now)
                        && now + delay <= until
                    {
                        assert!(scheduler.take_due(now + delay));
                        saved.push((now + delay).duration_since(origin).as_millis() as u64);
                    }
                    now = until;
                }
                action => panic!("unknown TS action: {action}"),
            }
            assert_eq!(serde_json::json!(saved), step["saved"], "TS step {index}");
            assert_eq!(
                now.duration_since(origin).as_millis() as u64,
                step["at"].as_u64().unwrap()
            );
        }
    }
    #[test]
    fn saves_once_after_the_pause_and_restarts_the_pause_on_each_edit() {
        let t = Instant::now();
        let mut s = Scheduler::default();
        s.schedule(t);
        s.schedule(t + Duration::from_millis(700));
        assert!(!s.take_due(t + Duration::from_millis(1499)));
        assert!(s.take_due(t + Duration::from_millis(1500)));
        assert!(!s.take_due(t + Duration::from_secs(10)));
    }
    #[test]
    fn continuous_typing_saves_within_two_seconds_and_the_next_burst_restarts() {
        let t = Instant::now();
        let mut s = Scheduler::default();
        for elapsed in (0..2000).step_by(50) {
            s.schedule(t + Duration::from_millis(elapsed));
            assert!(!s.take_due(t + Duration::from_millis(elapsed)));
        }
        assert!(s.take_due(t + MAX_WAIT));
        s.schedule(t + MAX_WAIT);
        assert!(!s.take_due(t + MAX_WAIT + IDLE - Duration::from_millis(1)));
        assert!(s.take_due(t + MAX_WAIT + IDLE));
    }
    #[test]
    fn flushing_is_immediate_only_once_and_cancelling_never_saves_later() {
        let t = Instant::now();
        let mut s = Scheduler::default();
        assert!(!s.flush());
        s.schedule(t);
        assert!(s.flush());
        assert!(!s.flush());
        assert!(!s.take_due(t + MAX_WAIT));
        s.schedule(t);
        s.cancel();
        assert!(!s.take_due(t + MAX_WAIT));
    }
}
