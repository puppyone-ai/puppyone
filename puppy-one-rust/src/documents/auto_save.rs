//! The product's idle auto-save policy. Timing cannot bypass the Working
//! Copy's conflict checks, snapshot validation or close/drain barriers.
use std::time::{Duration, Instant};

pub(super) const IDLE: Duration = Duration::from_millis(800);
pub(super) const MAX_WAIT: Duration = Duration::from_millis(2000);
pub(super) const SLOW_SAVE: Duration = Duration::from_millis(1500);

#[derive(Default)]
pub(super) struct Scheduler {
    first: Option<Instant>,
    due: Option<Instant>,
}
impl Scheduler {
    pub fn schedule(&mut self, now: Instant) {
        let first = *self.first.get_or_insert(now);
        self.due = Some((now + IDLE).min(first + MAX_WAIT));
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
