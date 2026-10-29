use super::*;
use crate::platform::telemetry::contract::{DAILY_ACTIVE, Event, FIRST_RUN};
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::sync::atomic::AtomicUsize;

#[derive(Default)]
struct FakeTransport {
    batches: Mutex<Vec<Vec<Event>>>,
    /// Answers to give, in order; then success.
    answers: Mutex<Vec<SendError>>,
}
impl Transport for FakeTransport {
    fn send(&self, events: &[Event]) -> Result<Vec<String>, SendError> {
        self.batches.lock().unwrap().push(events.to_vec());
        let mut answers = self.answers.lock().unwrap();
        if answers.is_empty() {
            Ok(events.iter().map(|e| e.event_id.clone()).collect())
        } else {
            Err(answers.remove(0))
        }
    }
}

struct Fixture {
    dir: tempfile::TempDir,
    service: Service,
    transport: Arc<FakeTransport>,
    now: Arc<Mutex<DateTime<Utc>>>,
    warnings: Arc<Mutex<Vec<SendError>>>,
}
impl Fixture {
    fn set_now(&self, value: &str) {
        *self.now.lock().unwrap() = at(value);
    }
    fn read(&self, name: &str) -> Option<Value> {
        std::fs::read(self.dir.path().join(name))
            .ok()
            .map(|b| serde_json::from_slice(&b).unwrap())
    }
    fn snapshot(&self) -> Snapshot {
        self.service.snapshot().unwrap()
    }
    fn sent(&self) -> Vec<Vec<Event>> {
        self.transport.batches.lock().unwrap().clone()
    }
}

fn at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

fn stable() -> Identity {
    Identity {
        channel: Channel::Stable,
        version: "0.3.10".into(),
        packaged: true,
    }
}

/// A packaged Stable build at 2026-08-27T07:00Z; `prior` writes an identity
/// first, like an installation that already ran.
fn fixture(identity: Identity, prior: bool) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    if prior {
        JsonFile::new(dir.path().join(store::IDENTITY))
            .write(&json!({"version": 1, "secret": "A".repeat(43)}))
            .unwrap();
    }
    let transport = Arc::new(FakeTransport::default());
    let now = Arc::new(Mutex::new(at("2026-08-27T07:00:00Z")));
    let warnings = Arc::new(Mutex::new(Vec::new()));
    let sequence = AtomicUsize::new(1);
    let deps = Deps {
        now: Box::new({
            let now = now.clone();
            move || *now.lock().unwrap()
        }),
        uuid: Box::new(move || {
            format!(
                "123e4567-e89b-42d3-a456-{:012}",
                sequence.fetch_add(1, Ordering::Relaxed)
            )
        }),
        secret: Box::new(|| [5; 32]),
        random: Box::new(|| 0.5),
        warn: Box::new({
            let warnings = warnings.clone();
            move |e| warnings.lock().unwrap().push(e)
        }),
        timers: false,
    };
    let service = Service::new(
        Config {
            root: dir.path().to_path_buf(),
            identity,
            platform: "darwin".into(),
            architecture: "arm64".into(),
            os_major: "15".into(),
            transport: Some(transport.clone()),
        },
        deps,
    );
    Fixture {
        dir,
        service,
        transport,
        now,
        warnings,
    }
}

#[test]
fn default_on_stable_analytics_stay_dormant_until_the_notice_is_shown() {
    let f = fixture(stable(), true);
    let s = f.service.start().unwrap();
    assert_eq!(
        (s.default_level, s.level, s.effective_level, s.enabled),
        (Level::Basic, Level::Basic, Level::Off, false)
    );
    assert!(s.notice_required);
    assert_eq!(s.disabled_reason, Some(DisabledReason::NoticeRequired));
    assert!(!f.service.note_foreground_activity().unwrap().0);
    f.service.flush().unwrap();
    assert!(f.sent().is_empty());
}

#[test]
fn at_most_one_allowlisted_activity_event_is_sent_per_utc_day() {
    let f = fixture(stable(), true);
    f.service.start().unwrap();
    f.service.mark_notice_seen().unwrap();
    assert!(f.service.note_foreground_activity().unwrap().0);
    assert!(!f.service.note_foreground_activity().unwrap().0);
    // Queuing schedules delivery right away.
    assert!(f.service.pending_flush().is_some());
    f.service.flush().unwrap();
    let sent = f.sent();
    assert_eq!(sent.len(), 1);
    let first = &sent[0][0];
    assert_eq!(first.event, DAILY_ACTIVE);
    assert_eq!(first.activity_day, "2026-08-27");
    assert!(first.anonymous_id.starts_with("m1_"));
    // A baseline installation sends no retention ID.
    assert_eq!(first.retention_id, None);
    assert_eq!(
        (
            first.properties.app_version.as_str(),
            first.properties.platform.as_str(),
            first.properties.architecture.as_str(),
            first.properties.os_major.as_str()
        ),
        ("0.3.10", "darwin", "arm64", "15")
    );
    assert_eq!(f.snapshot().queued_event_count, 0);

    f.set_now("2026-08-28T08:00:00Z");
    assert!(f.service.note_foreground_activity().unwrap().0);
    f.service.flush().unwrap();
    assert_eq!(f.sent().len(), 2);
    // Same month, same activity ID.
    assert_eq!(f.sent()[1][0].anonymous_id, first.anonymous_id);
}

#[test]
fn a_fresh_install_queues_one_first_run_signal_with_its_first_daily_activity() {
    let f = fixture(stable(), false);
    f.service.start().unwrap();
    assert_eq!(
        f.read(store::LIFECYCLE).unwrap(),
        json!({"version": 1, "cohort_status": "fresh", "first_run_utc_day": null, "first_run_enqueued": false})
    );
    f.service.mark_notice_seen().unwrap();
    assert!(f.service.note_foreground_activity().unwrap().0);
    assert!(!f.service.note_foreground_activity().unwrap().0);
    let queued: Vec<String> = f.read(store::QUEUE).unwrap()["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["event"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(queued, [FIRST_RUN, DAILY_ACTIVE]);
    assert_eq!(
        f.read(store::LIFECYCLE).unwrap(),
        json!({"version": 1, "cohort_status": "fresh", "first_run_utc_day": "2026-08-27", "first_run_enqueued": true})
    );
    f.service.flush().unwrap();
    let sent = f.sent();
    assert_eq!(sent.len(), 1);
    let retention = sent[0][0].retention_id.clone().unwrap();
    assert!(retention.starts_with("r1_"));
    assert_eq!(sent[0][1].retention_id.as_deref(), Some(retention.as_str()));
    assert_eq!(sent[0][0].properties.onboarding_version, Some(1));
    // Persisted events validate against the public contract.
    assert!(
        f.read(store::QUEUE).unwrap()["events"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn switching_off_clears_the_queue_and_the_local_identity_immediately() {
    let f = fixture(stable(), true);
    f.service.start().unwrap();
    f.service.mark_notice_seen().unwrap();
    f.service.note_foreground_activity().unwrap();
    assert_eq!(f.snapshot().queued_event_count, 1);
    assert!(f.read(store::IDENTITY).is_some());

    let s = f.service.set_level(Level::Off).unwrap();
    assert_eq!(
        (s.level, s.enabled, s.queued_event_count, s.disabled_reason),
        (Level::Off, false, 0, Some(DisabledReason::LevelOff))
    );
    assert!(!s.notice_required);
    assert!(f.read(store::IDENTITY).is_none());
    assert!(f.read(store::QUEUE).is_none());
    assert_eq!(
        f.read(store::LIFECYCLE).unwrap(),
        serde_json::to_value(Lifecycle::neutral()).unwrap()
    );
    assert_eq!(f.read(store::PREFERENCES).unwrap()["level"], "off");
    assert_eq!(f.service.pending_flush(), None);
    // Nothing is recorded while off.
    assert!(!f.service.note_foreground_activity().unwrap().0);
    // Reset does the same without changing the level.
    f.service.set_level(Level::Basic).unwrap();
    f.service.note_foreground_activity().unwrap();
    let s = f.service.reset_identity().unwrap();
    assert_eq!((s.level, s.queued_event_count), (Level::Basic, 0));
    assert!(f.read(store::IDENTITY).is_none());
}

#[test]
fn choosing_basic_acknowledges_the_current_notice() {
    let f = fixture(stable(), true);
    assert!(f.service.start().unwrap().notice_required);
    let s = f.service.set_level(Level::Basic).unwrap();
    assert!(s.enabled && !s.notice_required);
    assert_eq!(s.notice_seen_version, 2);
    let stored = f.read(store::PREFERENCES).unwrap();
    assert_eq!(
        (
            stored["level"].clone(),
            stored["notice_seen_version"].clone()
        ),
        (json!("basic"), json!(2))
    );
    assert_eq!(stored["updated_at"], "2026-08-27T07:00:00.000Z");
}

#[test]
fn the_retention_id_stops_after_the_bounded_100_day_window() {
    let f = fixture(stable(), false);
    f.service.start().unwrap();
    f.service.mark_notice_seen().unwrap();
    f.service.note_foreground_activity().unwrap();
    f.service.flush().unwrap();
    // Day 99 still carries it, day 100 does not.
    f.set_now("2026-12-04T07:00:00Z");
    f.service.note_foreground_activity().unwrap();
    assert!(
        f.read(store::QUEUE).unwrap()["events"][0]
            .get("retention_id")
            .is_some()
    );
    f.service.flush().unwrap();
    f.set_now("2026-12-05T07:00:00Z");
    f.service.note_foreground_activity().unwrap();
    let event = &f.read(store::QUEUE).unwrap()["events"][0];
    assert_eq!(
        (event["event"].clone(), event["activity_day"].clone()),
        (json!(DAILY_ACTIVE), json!("2026-12-05"))
    );
    assert!(event.get("retention_id").is_none());
}

#[test]
fn unpackaged_and_non_stable_builds_keep_the_default_without_sending() {
    for (identity, reason) in [
        (
            Identity {
                channel: Channel::Dev,
                packaged: false,
                ..stable()
            },
            DisabledReason::UnpackagedBuild,
        ),
        (
            Identity {
                channel: Channel::Internal,
                ..stable()
            },
            DisabledReason::NonStableBuild,
        ),
    ] {
        let f = fixture(identity, false);
        f.service.start().unwrap();
        let s = f.service.mark_notice_seen().unwrap();
        assert_eq!(
            (
                s.eligible,
                s.default_level,
                s.level,
                s.effective_level,
                s.disabled_reason
            ),
            (false, Level::Basic, Level::Basic, Level::Off, Some(reason))
        );
        // Ineligible builds never ask for the notice.
        assert!(!s.notice_required);
        assert!(!f.service.note_foreground_activity().unwrap().0);
        assert!(f.read(store::IDENTITY).is_none());
        assert!(f.read(store::QUEUE).is_none());
        // The switch still records the choice.
        assert_eq!(f.service.set_level(Level::Off).unwrap().level, Level::Off);
    }
}

#[test]
fn a_retryable_failure_keeps_the_batch_and_backs_off_without_logging_payloads() {
    let f = fixture(stable(), true);
    f.transport.answers.lock().unwrap().extend([
        SendError {
            status: None,
            retryable: true,
        },
        SendError {
            status: Some(503),
            retryable: true,
        },
    ]);
    f.service.start().unwrap();
    f.service.mark_notice_seen().unwrap();
    f.service.note_foreground_activity().unwrap();
    f.service.cancel_retry();
    f.service.flush().unwrap();
    assert_eq!(f.snapshot().queued_event_count, 1);
    assert_eq!(
        *f.warnings.lock().unwrap(),
        [SendError {
            status: None,
            retryable: true
        }]
    );
    // One minute with the midpoint jitter, then doubling.
    let first = f.service.pending_flush().unwrap();
    assert!(
        first > Duration::from_secs(59) && first <= Duration::from_secs(60),
        "{first:?}"
    );
    f.service.cancel_retry();
    f.service.flush().unwrap();
    let second = f.service.pending_flush().unwrap();
    assert!(
        second > Duration::from_secs(119) && second <= Duration::from_secs(120),
        "{second:?}"
    );
    // Success resets the backoff and empties the queue.
    f.service.cancel_retry();
    f.service.flush().unwrap();
    assert_eq!(f.snapshot().queued_event_count, 0);
    assert_eq!(f.service.0.timer.lock().unwrap().attempt, 0);
}

#[test]
fn a_rejected_batch_is_dropped() {
    let f = fixture(stable(), true);
    f.transport.answers.lock().unwrap().push(SendError {
        status: Some(400),
        retryable: false,
    });
    f.service.start().unwrap();
    f.service.mark_notice_seen().unwrap();
    f.service.note_foreground_activity().unwrap();
    f.service.cancel_retry();
    f.service.flush().unwrap();
    assert_eq!(f.snapshot().queued_event_count, 0);
    assert_eq!(f.service.pending_flush(), None);
}

#[test]
fn only_seven_calendar_days_are_retained_and_no_time_of_day_is_stored() {
    let f = fixture(stable(), true);
    f.service.start().unwrap();
    f.service.mark_notice_seen().unwrap();
    for day in 20..=27 {
        f.set_now(&format!("2026-08-{day}T23:59:59.999Z"));
        f.service.note_foreground_activity().unwrap();
    }
    *f.transport.answers.lock().unwrap() = vec![
        SendError {
            status: None,
            retryable: true
        };
        4
    ];
    f.service.cancel_retry();
    f.service.flush().unwrap();
    assert_eq!(f.snapshot().queued_event_count, 7);
    let stored = f.read(store::QUEUE).unwrap();
    assert_eq!(stored["events"][0]["activity_day"], "2026-08-21");
    let text = stored.to_string();
    assert!(!text.contains("23:59:59") && !text.contains("occurred_at"));
}

#[test]
fn delivery_runs_on_the_timer_thread() {
    let mut f = fixture(stable(), true);
    // The same fixture with the timer enabled.
    let transport = f.transport.clone();
    f.service = Service::new(
        Config {
            root: f.dir.path().to_path_buf(),
            identity: stable(),
            platform: "darwin".into(),
            architecture: "arm64".into(),
            os_major: "15".into(),
            transport: Some(transport.clone()),
        },
        Deps::default(),
    );
    f.service.start().unwrap();
    f.service.mark_notice_seen().unwrap();
    assert!(f.service.note_foreground_activity().unwrap().0);
    let deadline = Instant::now() + Duration::from_secs(5);
    while transport.batches.lock().unwrap().is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(transport.batches.lock().unwrap().len(), 1);
    while f.snapshot().queued_event_count > 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(f.snapshot().queued_event_count, 0);
    f.service.dispose();
}

#[test]
fn the_electron_choice_carries_over_once_and_makes_the_installation_baseline() {
    let electron = tempfile::tempdir().unwrap();
    let ours = tempfile::tempdir().unwrap();
    let root = ours.path().join("desktop-telemetry");
    assert!(!import_electron_preference(electron.path(), &root).unwrap());
    std::fs::write(
        electron.path().join(store::PREFERENCES),
        r#"{"version":1,"level":"off","notice_seen_version":2,"updated_at":"2026-08-01T10:00:00.000Z"}"#,
    )
    .unwrap();
    assert!(import_electron_preference(electron.path(), &root).unwrap());
    let service = Service::new(
        Config {
            root: root.clone(),
            identity: stable(),
            platform: "darwin".into(),
            architecture: "arm64".into(),
            os_major: "15".into(),
            transport: None,
        },
        Deps {
            timers: false,
            ..Deps::default()
        },
    );
    let s = service.start().unwrap();
    assert_eq!(
        (s.level, s.notice_seen_version, s.notice_required),
        (Level::Off, 2, false)
    );
    let lifecycle: Value =
        serde_json::from_slice(&std::fs::read(root.join(store::LIFECYCLE)).unwrap()).unwrap();
    assert_eq!(lifecycle["cohort_status"], "baseline");
    // Only once: our own later choice is never overwritten.
    service.set_level(Level::Basic).unwrap();
    assert!(!import_electron_preference(electron.path(), &root).unwrap());
    assert_eq!(service.snapshot().unwrap().level, Level::Basic);
    // Their identity never comes along.
    assert!(!root.join(store::IDENTITY).exists());
}
