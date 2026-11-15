use super::*;
use core::prelude::v1::test;
use std::{
    sync::{atomic::AtomicUsize, mpsc},
    time::Duration,
};
type Resolver = Arc<dyn Fn() -> Result<bool, ErrorCode> + Send + Sync>;
#[derive(Default)]
struct Fake {
    found: Mutex<Vec<String>>,
    installs: Mutex<Vec<String>>,
    guides: Mutex<Vec<String>>,
    fail_install: Option<ErrorCode>,
    /// Blocks installs until cancelled.
    hold: bool,
    resolver: Option<Resolver>,
    resolves: AtomicUsize,
    install_attempts: AtomicUsize,
    refreshes: AtomicUsize,
    fail_refresh: bool,
}
impl Ports for Fake {
    fn resolve(&self, id: &str) -> Result<bool, ErrorCode> {
        self.resolves.fetch_add(1, Ordering::SeqCst);
        if let Some(resolve) = &self.resolver {
            return resolve();
        }
        Ok(self.found.lock().unwrap().iter().any(|f| f == id))
    }
    fn install(
        &self,
        recipe: &Recipe,
        cancel: &AtomicBool,
        committed: &dyn Fn(),
    ) -> Result<(), ErrorCode> {
        self.install_attempts.fetch_add(1, Ordering::SeqCst);
        while self.hold && !cancel.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(5));
        }
        if cancel.load(Ordering::Relaxed) {
            return Err(ErrorCode::Interrupted);
        }
        if let Some(code) = self.fail_install {
            return Err(code);
        }
        self.installs.lock().unwrap().push(recipe.setup_id.into());
        self.found.lock().unwrap().push(recipe.setup_id.into());
        committed();
        Ok(())
    }
    fn open_guide(&self, url: &str) -> Result<(), String> {
        self.guides.lock().unwrap().push(url.into());
        Ok(())
    }
    fn refresh(&self) {
        self.refreshes.fetch_add(1, Ordering::SeqCst);
        assert!(!self.fail_refresh, "refresh unavailable");
    }
}
fn wait_for_refresh(ports: &Fake, expected: usize) {
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while ports.refreshes.load(Ordering::SeqCst) < expected {
        assert!(
            std::time::Instant::now() < deadline,
            "installation refresh did not arrive"
        );
        std::thread::yield_now();
    }
    assert_eq!(ports.refreshes.load(Ordering::SeqCst), expected);
}
fn new_service(dir: &std::path::Path, ports: Arc<Fake>) -> (Service, mpsc::Receiver<Snapshot>) {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    let service = Service::for_platform(
        dir.join("local-agent-activation.json"),
        ports,
        Arc::new(move |s| {
            let _ = tx.lock().unwrap().send(s);
        }),
        "darwin",
        "arm64",
    );
    (service, rx)
}
fn settle(service: &Service, id: &str) -> Operation {
    for _ in 0..400 {
        let snapshot = service.read().unwrap();
        let op = snapshot
            .operations
            .into_iter()
            .find(|o| o.setup_id == id)
            .unwrap();
        if !op.status.active() || op.status == Status::SetupRequired {
            service.journal.flush();
            return op;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    panic!("activation of {id} did not settle");
}
#[test]
fn a_recipe_installs_and_discovery_confirms_it() {
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake::default());
    let (service, published) = new_service(dir.path(), ports.clone());
    let plan = service.plan("w1", "codex", Surface::Chat).unwrap();
    assert!(plan.automatic);
    assert_eq!((plan.version, plan.publisher), (Some("0.155.1"), "OpenAI"));
    // Plans belong to their window.
    assert_eq!(
        service.start("w2", &plan.plan_id),
        Err(ErrorCode::Unsupported)
    );
    service.start("w1", &plan.plan_id).unwrap();
    let op = settle(&service, "codex");
    assert_eq!(op.status, Status::Ready);
    assert_eq!(op.steps, [StepState::Complete; 3]);
    assert!(op.installed);
    assert_eq!(*ports.installs.lock().unwrap(), ["codex"]);
    let revisions: Vec<u64> = published.try_iter().map(|s| s.revision).collect();
    assert!(revisions.windows(2).all(|w| w[0] < w[1]) && !revisions.is_empty());
    // The journal survives a restart; a finished operation can be dismissed.
    let (again, _) = service_with_journal(dir.path());
    let restored = again.read().unwrap();
    assert_eq!(restored.operations, vec![op.clone()]);
    let dismissed = again.act(&op.operation_id, Action::Dismiss).unwrap();
    assert!(dismissed.operations.is_empty());
}
fn service_with_journal(dir: &std::path::Path) -> (Service, mpsc::Receiver<Snapshot>) {
    new_service(dir, Arc::new(Fake::default()))
}
#[test]
fn guided_agents_wait_for_their_official_setup_and_existing_clis_are_reused() {
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake::default());
    let (service, _) = new_service(dir.path(), ports.clone());
    let plan = service.plan("w", "claude", Surface::Chat).unwrap();
    assert!(!plan.automatic && plan.version.is_none());
    service.start("w", &plan.plan_id).unwrap();
    let op = settle(&service, "claude");
    assert_eq!(op.status, Status::SetupRequired);
    assert_eq!(
        op.steps,
        [StepState::Complete, StepState::Pending, StepState::Pending]
    );
    service.act(&op.operation_id, Action::Guide).unwrap();
    assert_eq!(
        *ports.guides.lock().unwrap(),
        ["https://code.claude.com/docs/en/setup"]
    );
    // After the guide, Check finds the CLI.
    ports.found.lock().unwrap().push("claude".into());
    service.act(&op.operation_id, Action::Check).unwrap();
    let op = settle(&service, "claude");
    assert_eq!(op.status, Status::Ready);
    assert_eq!(op.steps[1], StepState::Skipped);
    // An installed CLI is never reinstalled.
    ports.found.lock().unwrap().push("codex".into());
    let plan = service.plan("w", "codex", Surface::Terminal).unwrap();
    service.start("w", &plan.plan_id).unwrap();
    assert_eq!(settle(&service, "codex").steps[1], StepState::Skipped);
    assert!(ports.installs.lock().unwrap().is_empty());
    // Terminal-less and other-platform routes are unsupported.
    assert_eq!(
        service.plan("w", "workbuddy-china", Surface::Terminal),
        Err(ErrorCode::Unsupported)
    );
    assert_eq!(
        service.plan("w", "nope", Surface::Chat),
        Err(ErrorCode::Unsupported)
    );
}
#[test]
fn cancel_failure_and_interruption_are_reported() {
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake {
        hold: true,
        ..Fake::default()
    });
    let (service, _) = new_service(dir.path(), ports.clone());
    let plan = service.plan("w", "cursor", Surface::Chat).unwrap();
    let started = service.start("w", &plan.plan_id).unwrap();
    let id = started.operations[0].operation_id.clone();
    // Starting the same plan or Agent again joins the running operation.
    assert_eq!(
        service.start("w", &plan.plan_id).unwrap().operations.len(),
        1
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while service.read().unwrap().operations[0].status != Status::Installing {
        assert!(
            std::time::Instant::now() < deadline,
            "installation never started"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    // An interrupted journal entry: a "restart" while it runs.
    service.journal.flush();
    let (restarted, _) = service_with_journal(dir.path());
    let op = restarted.read().unwrap().operations.remove(0);
    assert_eq!(
        (op.status, op.error),
        (Status::Interrupted, Some(ErrorCode::Interrupted))
    );
    assert_eq!(op.steps[1], StepState::Failed);
    service.act(&id, Action::Cancel).unwrap();
    let op = settle(&service, "cursor");
    assert_eq!((op.status, op.error), (Status::Cancelled, None));
    assert_eq!(
        op.steps,
        [StepState::Complete, StepState::Pending, StepState::Pending]
    );
    let failing = Arc::new(Fake {
        fail_install: Some(ErrorCode::Integrity),
        ..Fake::default()
    });
    let dir2 = tempfile::tempdir().unwrap();
    let (service, _) = new_service(dir2.path(), failing);
    let plan = service.plan("w", "codex", Surface::Chat).unwrap();
    service.start("w", &plan.plan_id).unwrap();
    let op = settle(&service, "codex");
    assert_eq!(
        (op.status, op.error),
        (Status::Failed, Some(ErrorCode::Integrity))
    );
    assert_eq!(op.steps[1], StepState::Failed);
    assert!(service.act(&op.operation_id, Action::Guide).is_err());
}
#[test]
fn a_corrupt_journal_is_kept_and_reported() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("local-agent-activation.json");
    std::fs::write(&path, r#"{"schemaVersion":3,"snapshot":{}}"#).unwrap();
    let (service, _) = service_with_journal(dir.path());
    assert_eq!(service.read(), Err(ErrorCode::Storage));
    assert_eq!(
        service.plan("w", "codex", Surface::Chat),
        Err(ErrorCode::Storage)
    );
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        r#"{"schemaVersion":3,"snapshot":{}}"#
    );
}

#[test]
fn cancellation_does_not_wait_behind_the_initial_journal_write() {
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake::default());
    let (service, _) = new_service(dir.path(), ports.clone());
    let plan = service.plan("window", "codex", Surface::Chat).unwrap();
    let blocked_write = service.journal.written.lock().unwrap();
    let starting = service.clone();
    let start = std::thread::spawn(move || starting.start("window", &plan.plan_id));
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let id = loop {
        if let Some(op) = service.read().unwrap().operations.first() {
            break op.operation_id.clone();
        }
        assert!(
            std::time::Instant::now() < deadline,
            "start must publish its preparation before writing"
        );
        std::thread::yield_now();
    };
    let cancelling = service.clone();
    let (done, ack) = mpsc::channel();
    let cancel = std::thread::spawn(move || {
        done.send(cancelling.act(&id, Action::Cancel)).unwrap();
    });
    let acknowledged = ack.recv_timeout(Duration::from_secs(1));
    drop(blocked_write);
    start.join().unwrap().unwrap();
    cancel.join().unwrap();
    assert!(
        acknowledged.is_ok(),
        "Stop waited behind unrelated journal I/O"
    );
    assert_eq!(
        acknowledged.unwrap().unwrap().operations[0].status,
        Status::Cancelled
    );
    assert_eq!(settle(&service, "codex").status, Status::Cancelled);
    assert!(ports.installs.lock().unwrap().is_empty());
}

#[test]
fn queued_journal_progress_is_bounded_and_keeps_the_newest_revision() {
    let dir = tempfile::tempdir().unwrap();
    let (service, _) = service_with_journal(dir.path());
    let journal = service.journal.clone();
    let blocked = journal.written.lock().unwrap();
    for revision in 1..=500 {
        journal.enqueue(Snapshot {
            epoch: "one".into(),
            revision,
            operations: vec![],
        });
    }
    // Even while disk I/O is stalled, progress retains at most one pending
    // snapshot and one active write, rather than an unbounded work queue.
    {
        let queued = journal.queued.lock().unwrap();
        assert!(queued.running);
        if let Some(pending) = &queued.latest {
            assert_eq!(pending.revision, 500);
        }
    }
    drop(blocked);
    journal.flush();
    let value: Value = serde_json::from_slice(&std::fs::read(&journal.path).unwrap()).unwrap();
    assert_eq!(value["snapshot"]["revision"], 500);
    journal.enqueue(Snapshot {
        epoch: "one".into(),
        revision: 2,
        operations: vec![],
    });
    journal.flush();
    let value: Value = serde_json::from_slice(&std::fs::read(&journal.path).unwrap()).unwrap();
    assert_eq!(
        value["snapshot"]["revision"], 500,
        "a late write cannot roll the journal back"
    );
}

fn wait_for(mut done: impl FnMut() -> bool) {
    let until = std::time::Instant::now() + Duration::from_secs(2);
    while !done() {
        assert!(
            std::time::Instant::now() < until,
            "activation condition did not complete"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
}
#[test]
fn every_registered_agent_reuses_an_existing_cli_without_installation_or_guides() {
    for route in super::super::ROUTES {
        let dir = tempfile::tempdir().unwrap();
        let ports = Arc::new(Fake::default());
        ports.found.lock().unwrap().push(route.id.into());
        let (service, _) = new_service(dir.path(), ports.clone());
        let plan = service.plan("window", route.id, Surface::Chat).unwrap();
        assert_eq!(
            ports.resolves.load(Ordering::SeqCst),
            0,
            "planning is side-effect free"
        );
        service.start("window", &plan.plan_id).unwrap();
        let op = settle(&service, route.id);
        assert_eq!(op.status, Status::Ready, "{}", route.id);
        assert!(op.installed);
        assert_eq!(op.steps[INSTALL], StepState::Skipped);
        assert_eq!(ports.resolves.load(Ordering::SeqCst), 1);
        assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 0);
        assert!(ports.guides.lock().unwrap().is_empty());
        wait_for(|| ports.refreshes.load(Ordering::SeqCst) == 1);
    }
}
#[test]
fn every_missing_agent_follows_its_declared_automatic_or_guided_recipe() {
    for route in super::super::ROUTES {
        let dir = tempfile::tempdir().unwrap();
        let ports = Arc::new(Fake::default());
        let (service, _) = new_service(dir.path(), ports.clone());
        let plan = service.plan("window", route.id, Surface::Chat).unwrap();
        assert_eq!(plan.automatic, route.recipe("darwin", "arm64").is_some());
        service.start("window", &plan.plan_id).unwrap();
        let op = settle(&service, route.id);
        assert!(
            ports.guides.lock().unwrap().is_empty(),
            "setup cannot open a guide without an action"
        );
        if plan.automatic {
            assert_eq!(
                (op.status, op.installed),
                (Status::Ready, true),
                "{}",
                route.id
            );
            assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 1);
            assert_eq!(*ports.installs.lock().unwrap(), [route.id]);
            assert_eq!(op.steps, [StepState::Complete; 3]);
        } else {
            assert_eq!(op.status, Status::SetupRequired, "{}", route.id);
            assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 0);
            service.act(&op.operation_id, Action::Guide).unwrap();
            assert_eq!(*ports.guides.lock().unwrap(), [route.guide_url]);
            ports.found.lock().unwrap().push(route.id.into());
            service.act(&op.operation_id, Action::Check).unwrap();
            let op = settle(&service, route.id);
            assert_eq!((op.status, op.installed), (Status::Ready, true));
            assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 0);
        }
        wait_for(|| ports.refreshes.load(Ordering::SeqCst) == 1);
    }
}
#[test]
fn every_agent_refuses_installation_after_failed_discovery() {
    for route in super::super::ROUTES {
        let dir = tempfile::tempdir().unwrap();
        let ports = Arc::new(Fake {
            resolver: Some(Arc::new(|| Err(ErrorCode::InstallationCheck))),
            ..Fake::default()
        });
        let (service, _) = new_service(dir.path(), ports.clone());
        let plan = service.plan("window", route.id, Surface::Chat).unwrap();
        service.start("window", &plan.plan_id).unwrap();
        let op = settle(&service, route.id);
        assert_eq!(
            (op.status, op.error, op.installed),
            (Status::Failed, Some(ErrorCode::InstallationCheck), false),
            "{}",
            route.id
        );
        assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 0);
        assert!(ports.guides.lock().unwrap().is_empty());
        assert_eq!(ports.refreshes.load(Ordering::SeqCst), 0);
    }
}
#[test]
fn every_agent_cancels_independently_and_discards_a_late_discovered_cli() {
    for route in super::super::ROUTES {
        let dir = tempfile::tempdir().unwrap();
        let (entered, started) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let wait = Mutex::new(wait);
        let ports = Arc::new(Fake {
            resolver: Some(Arc::new(move || {
                entered.send(()).unwrap();
                wait.lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap();
                Ok(true)
            })),
            ..Fake::default()
        });
        let (service, published) = new_service(dir.path(), ports.clone());
        let plan = service
            .plan("first-window", route.id, Surface::Chat)
            .unwrap();
        let start = service.start("first-window", &plan.plan_id).unwrap();
        started.recv_timeout(Duration::from_secs(2)).unwrap();
        let cancelled = service
            .act(&start.operations[0].operation_id, Action::Cancel)
            .unwrap();
        assert_eq!(cancelled.operations[0].status, Status::Cancelling);
        release.send(()).unwrap();
        let op = settle(&service, route.id);
        assert_eq!(
            (op.status, op.installed),
            (Status::Cancelled, false),
            "{}",
            route.id
        );
        assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 0);
        assert!(
            published
                .try_iter()
                .all(|s| s.operations[0].status != Status::Ready)
        );
    }
}
#[test]
fn automatic_recipes_cancel_both_installation_and_post_commit_discovery() {
    for id in ["codex", "cursor"] {
        for verifying in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let (entered, started) = mpsc::channel();
            let (release, wait) = mpsc::channel();
            let wait = Mutex::new(wait);
            let calls = AtomicUsize::new(0);
            let ports = Arc::new(Fake {
                hold: !verifying,
                resolver: verifying.then(|| {
                    Arc::new(move || {
                        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                            return Ok(false);
                        }
                        entered.send(()).unwrap();
                        wait.lock()
                            .unwrap()
                            .recv_timeout(Duration::from_secs(3))
                            .unwrap();
                        Ok(true)
                    }) as Resolver
                }),
                ..Fake::default()
            });
            let (service, _) = new_service(dir.path(), ports.clone());
            let plan = service.plan("window", id, Surface::Chat).unwrap();
            let start = service.start("window", &plan.plan_id).unwrap();
            if verifying {
                started.recv_timeout(Duration::from_secs(2)).unwrap();
            } else {
                wait_for(|| ports.install_attempts.load(Ordering::SeqCst) == 1);
            }
            service
                .act(&start.operations[0].operation_id, Action::Cancel)
                .unwrap();
            if verifying {
                release.send(()).unwrap();
            }
            let op = settle(&service, id);
            assert_eq!(
                (op.status, op.installed),
                (Status::Cancelled, verifying),
                "{id}: verify={verifying}"
            );
            assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 1);
        }
    }
}

#[test]
fn an_acknowledged_cancel_wins_over_a_prepared_terminal_result() {
    for result in [
        Ok(Status::Ready),
        Ok(Status::SetupRequired),
        Err(ErrorCode::Storage),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let (service, _) = service_with_journal(dir.path());
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut state = service.loaded().unwrap();
            state.operations.push(Operation {
                operation_id: "operation".into(),
                setup_id: "codex".into(),
                display_name: "Codex".into(),
                status: Status::Verifying,
                steps: [StepState::Complete, StepState::Complete, StepState::Running],
                installed: true,
                error: None,
                updated_at: 1,
            });
            state.tasks.push(Task {
                operation_id: "operation".into(),
                setup_id: "codex".into(),
                cancel: cancel.clone(),
                running: true,
                committed: true,
            });
        }
        let acknowledged = service.act("operation", Action::Cancel).unwrap();
        assert_eq!(acknowledged.operations[0].status, Status::Cancelling);
        // A worker can compute its result just before cancellation, then
        // acquire the completion lock just after the Cancel acknowledgement.
        service.complete("operation", &cancel, result);
        let op = settle(&service, "codex");
        assert_eq!(
            (op.status, op.installed, op.error),
            (Status::Cancelled, true, None),
            "prepared {result:?}"
        );
        assert_eq!(op.steps[VERIFY], StepState::Pending);
    }
}

#[test]
fn window_plans_are_read_only_owner_bound_bounded_and_revocable() {
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake::default());
    let (service, _) = new_service(dir.path(), ports.clone());
    let first = service.plan("closed", "codex", Surface::Chat).unwrap();
    assert_eq!(
        service.plan("closed", "../codex", Surface::Chat),
        Err(ErrorCode::Unsupported)
    );
    assert_eq!(
        service.start("other", &first.plan_id),
        Err(ErrorCode::Unsupported)
    );
    assert_eq!(
        service.open_guide("other", &first.plan_id),
        Err(ErrorCode::Unsupported)
    );
    service.open_guide("closed", &first.plan_id).unwrap();
    assert_eq!(
        *ports.guides.lock().unwrap(),
        [super::super::route("codex").unwrap().guide_url]
    );
    let other = service.plan("other", "claude", Surface::Chat).unwrap();
    service.release("closed");
    assert_eq!(
        service.start("closed", &first.plan_id),
        Err(ErrorCode::Unsupported)
    );
    assert_eq!(
        service.open_guide("closed", &first.plan_id),
        Err(ErrorCode::Unsupported)
    );
    // Filling the bounded consent cache evicts its oldest, across owners.
    let mut newest = None;
    for _ in 0..128 {
        newest = Some(service.plan("live", "codex", Surface::Chat).unwrap());
    }
    assert_eq!(
        service.start("other", &other.plan_id),
        Err(ErrorCode::Unsupported)
    );
    assert_eq!(ports.resolves.load(Ordering::SeqCst), 0);
    assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 0);
    assert!(service.read().unwrap().operations.is_empty());
    service.start("live", &newest.unwrap().plan_id).unwrap();
    assert_eq!(settle(&service, "codex").status, Status::Ready);
}

#[test]
fn simultaneous_and_repeated_consent_installs_once_even_after_completion() {
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake::default());
    let (service, published) = new_service(dir.path(), ports.clone());
    let plan = service.plan("w", "codex", Surface::Chat).unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(3));
    let threads: Vec<_> = (0..2)
        .map(|_| {
            let (service, barrier, plan) = (service.clone(), barrier.clone(), plan.clone());
            std::thread::spawn(move || {
                barrier.wait();
                service.start("w", &plan.plan_id).unwrap()
            })
        })
        .collect();
    barrier.wait();
    for thread in threads {
        assert_eq!(thread.join().unwrap().operations.len(), 1);
    }
    let ready = settle(&service, "codex");
    assert_eq!(ready.status, Status::Ready);
    assert_eq!(
        service.start("w", &plan.plan_id).unwrap().operations,
        [ready]
    );
    assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 1);
    wait_for_refresh(&ports, 1);
    let revisions: Vec<_> = published.try_iter().map(|s| s.revision).collect();
    assert!(!revisions.is_empty() && revisions.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn releasing_a_window_keeps_post_commit_work_and_another_window_can_cancel_it() {
    let dir = tempfile::tempdir().unwrap();
    let (entered, waiting) = mpsc::channel();
    let (finish, released) = mpsc::channel();
    let released = Mutex::new(released);
    let count = AtomicUsize::new(0);
    let ports = Arc::new(Fake {
        resolver: Some(Arc::new(move || {
            if count.fetch_add(1, Ordering::SeqCst) == 0 {
                return Ok(false);
            }
            entered.send(()).unwrap();
            released
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(3))
                .unwrap();
            Ok(true)
        })),
        ..Fake::default()
    });
    let (service, published) = new_service(dir.path(), ports.clone());
    let plan = service.plan("closed", "codex", Surface::Chat).unwrap();
    let id = service.start("closed", &plan.plan_id).unwrap().operations[0]
        .operation_id
        .clone();
    waiting.recv_timeout(Duration::from_secs(2)).unwrap();
    service.release("closed");
    assert_eq!(
        service.read().unwrap().operations[0].status,
        Status::Verifying
    );
    assert_eq!(
        service.start("closed", &plan.plan_id),
        Err(ErrorCode::Unsupported)
    );
    // Actions belong to the application, not the retired consent owner.
    assert_eq!(
        service.act(&id, Action::Cancel).unwrap().operations[0].status,
        Status::Cancelling
    );
    finish.send(()).unwrap();
    let cancelled = settle(&service, "codex");
    assert_eq!(
        (cancelled.status, cancelled.installed),
        (Status::Cancelled, true)
    );
    assert!(
        published
            .try_iter()
            .all(|s| s.operations[0].status != Status::Ready)
    );
    wait_for_refresh(&ports, 1);
}

#[test]
fn disposal_revokes_all_consent_and_cancels_work_without_waiting_for_discovery() {
    let dir = tempfile::tempdir().unwrap();
    let (entered, waiting) = mpsc::channel();
    let (finish, released) = mpsc::channel();
    let released = Mutex::new(released);
    let ports = Arc::new(Fake {
        resolver: Some(Arc::new(move || {
            entered.send(()).unwrap();
            released
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(3))
                .unwrap();
            Ok(true)
        })),
        ..Fake::default()
    });
    let (service, _) = new_service(dir.path(), ports.clone());
    let plan = service.plan("w", "codex", Surface::Chat).unwrap();
    service.start("w", &plan.plan_id).unwrap();
    waiting.recv_timeout(Duration::from_secs(2)).unwrap();
    service.dispose();
    service.dispose();
    assert_eq!(
        service.plan("w", "claude", Surface::Chat),
        Err(ErrorCode::Interrupted)
    );
    assert_eq!(
        service.start("w", &plan.plan_id),
        Err(ErrorCode::Unsupported)
    );
    assert_eq!(
        service.open_guide("w", &plan.plan_id),
        Err(ErrorCode::Unsupported)
    );
    finish.send(()).unwrap();
    let cancelled = settle(&service, "codex");
    assert_eq!(
        (cancelled.status, cancelled.installed),
        (Status::Cancelled, false)
    );
    assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 0);
}

#[test]
fn three_active_operations_include_guided_waiting_and_reuse_does_not_take_a_slot() {
    let dir = tempfile::tempdir().unwrap();
    let (service, _) = service_with_journal(dir.path());
    for id in ["claude", "opencode", "pi"] {
        let plan = service.plan("w", id, Surface::Chat).unwrap();
        service.start("w", &plan.plan_id).unwrap();
        assert_eq!(settle(&service, id).status, Status::SetupRequired);
    }
    let other_window = service
        .plan("another", "claude", Surface::Terminal)
        .unwrap();
    assert_eq!(
        service
            .start("another", &other_window.plan_id)
            .unwrap()
            .operations
            .len(),
        3
    );
    let fourth = service.plan("w", "hermes", Surface::Chat).unwrap();
    assert_eq!(
        service.start("w", &fourth.plan_id),
        Err(ErrorCode::InstallationBusy)
    );
    let first = service.read().unwrap().operations[0].operation_id.clone();
    assert_eq!(
        service.act(&first, Action::Dismiss),
        Err(ErrorCode::Unsupported)
    );
    service.act(&first, Action::Cancel).unwrap();
    service.start("w", &fourth.plan_id).unwrap();
    assert_eq!(settle(&service, "hermes").status, Status::SetupRequired);
    assert_eq!(
        service
            .read()
            .unwrap()
            .operations
            .iter()
            .filter(|o| o.status.active())
            .count(),
        3
    );
}

#[test]
fn interrupted_receipts_need_fresh_consent_and_retry_replaces_only_that_agent() {
    let dir = tempfile::tempdir().unwrap();
    let (before, _) = service_with_journal(dir.path());
    for id in ["claude", "hermes"] {
        let plan = before.plan("old", id, Surface::Chat).unwrap();
        before.start("old", &plan.plan_id).unwrap();
        settle(&before, id);
    }
    let ports = Arc::new(Fake::default());
    ports.found.lock().unwrap().push("claude".into());
    let (after, _) = new_service(dir.path(), ports.clone());
    let recovered = after.read().unwrap();
    assert!(
        recovered
            .operations
            .iter()
            .all(|o| o.status == Status::Interrupted && !o.steps.contains(&StepState::Running))
    );
    assert_eq!(ports.resolves.load(Ordering::SeqCst), 0);
    let plan = after.plan("new", "claude", Surface::Chat).unwrap();
    after.start("new", &plan.plan_id).unwrap();
    let ready = settle(&after, "claude");
    assert_eq!(ready.status, Status::Ready);
    assert_ne!(ready.operation_id, recovered.operations[0].operation_id);
    assert_eq!(after.read().unwrap().operations[1], recovered.operations[1]);
    assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 0);
}

#[test]
fn installation_failure_is_a_typed_receipt_and_never_marks_the_cli_installed() {
    for code in [ErrorCode::Installation, ErrorCode::InstallationBusy] {
        let dir = tempfile::tempdir().unwrap();
        let ports = Arc::new(Fake {
            fail_install: Some(code),
            ..Fake::default()
        });
        let (service, _) = new_service(dir.path(), ports.clone());
        let plan = service.plan("w", "codex", Surface::Chat).unwrap();
        service.start("w", &plan.plan_id).unwrap();
        let failed = settle(&service, "codex");
        assert_eq!(
            (failed.status, failed.error, failed.installed),
            (Status::Failed, Some(code), false)
        );
        assert_eq!(
            failed.steps,
            [StepState::Complete, StepState::Failed, StepState::Pending]
        );
        assert_eq!(ports.refreshes.load(Ordering::SeqCst), 0);
        let serialized = snapshot_json(&service.read().unwrap());
        assert_eq!(serialized["operations"][0]["errorCode"], code.key());
        assert_eq!(serialized["operations"][0].as_object().unwrap().len(), 8);
    }
}

#[test]
fn a_late_initial_journal_failure_cannot_overwrite_confirmed_cancellation() {
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake::default());
    let (service, _) = new_service(dir.path(), ports.clone());
    let plan = service.plan("w", "codex", Surface::Chat).unwrap();
    // A directory at the destination makes atomic replacement fail, without
    // invalidating the already completed journal read.
    std::fs::create_dir(&service.journal.path).unwrap();
    let blocked_write = service.journal.written.lock().unwrap();
    let starting = service.clone();
    let thread = std::thread::spawn(move || starting.start("w", &plan.plan_id));
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let id = loop {
        if let Some(op) = service.read().unwrap().operations.first() {
            break op.operation_id.clone();
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::yield_now();
    };
    assert_eq!(
        service.act(&id, Action::Cancel).unwrap().operations[0].status,
        Status::Cancelled
    );
    drop(blocked_write);
    let result = thread.join().unwrap().unwrap();
    assert_eq!(
        (result.operations[0].status, result.operations[0].error),
        (Status::Cancelled, None)
    );
    service.settle_for_test();
    assert_eq!(ports.resolves.load(Ordering::SeqCst), 0);
    assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 0);
    assert!(service.journal.path.is_dir());
}

#[test]
fn actual_typescript_journal_and_live_schema_oracle() {
    let oracle: Value = serde_json::from_str(include_str!(
        "../../../../fixtures/activation-journal-oracle.json"
    ))
    .unwrap();
    let mut mismatches = Vec::new();
    for case in oracle["cases"].as_array().unwrap() {
        let input = &case["input"];
        let parsed = parse_journal(input);
        if parsed.is_some() != case["accepted"].as_bool().unwrap() {
            mismatches.push(format!("{}: journal admission", case["name"]));
        } else if let Some(operations) = parsed {
            let actual = snapshot_json(&Snapshot {
                epoch: "fixture".into(),
                revision: 1,
                operations,
            });
            if actual["operations"] != case["operations"] {
                mismatches.push(format!("{}: migrated operation", case["name"]));
            }
        }
        let live = parse_journal(&json!({"schemaVersion":2,"snapshot":input}));
        if live.is_some() != case["liveAccepted"].as_bool().unwrap() {
            mismatches.push(format!("{}: live admission", case["name"]));
        }
    }
    assert!(
        mismatches.is_empty(),
        "TS journal/schema differences: {mismatches:#?}"
    );
}

#[test]
fn journal_migration_is_read_only_and_rewrites_only_explicit_version_two_snapshots() {
    let oracle: Value = serde_json::from_str(include_str!(
        "../../../../fixtures/activation-journal-oracle.json"
    ))
    .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let (service, _) = service_with_journal(dir.path());
    for (i, case) in oracle["cases"].as_array().unwrap().iter().enumerate() {
        let before = serde_json::to_vec(&case["input"]).unwrap();
        std::fs::write(&service.journal.path, &before).unwrap();
        let read = service.journal.read();
        assert_eq!(
            read.is_ok(),
            case["accepted"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
        assert_eq!(
            std::fs::read(&service.journal.path).unwrap(),
            before,
            "reading must not rewrite history"
        );
        if let Ok(operations) = read {
            service
                .journal
                .write(&Snapshot {
                    epoch: "new".into(),
                    revision: i as u64 + 1,
                    operations: operations.clone(),
                })
                .unwrap();
            let saved: Value =
                serde_json::from_slice(&std::fs::read(&service.journal.path).unwrap()).unwrap();
            assert_eq!(saved["schemaVersion"], 2);
            assert_eq!(service.journal.read().unwrap(), operations);
        }
        assert_eq!(
            std::fs::read_dir(dir.path()).unwrap().count(),
            1,
            "no temporary residue"
        );
    }
}

#[test]
fn journal_rejects_oversize_and_linked_files_without_touching_their_targets() {
    let dir = tempfile::tempdir().unwrap();
    let (service, _) = service_with_journal(dir.path());
    assert_eq!(service.journal.read().unwrap(), vec![]);
    let mut oversized =
        br#"{"schemaVersion":2,"snapshot":{"epoch":"valid","revision":1,"operations":[]}}"#
            .to_vec();
    oversized.resize(64 * 1024 + 1, b' ');
    assert!(serde_json::from_slice::<Value>(&oversized).is_ok());
    std::fs::write(&service.journal.path, &oversized).unwrap();
    assert!(service.journal.read().is_err());
    assert_eq!(std::fs::read(&service.journal.path).unwrap(), oversized);
    std::fs::remove_file(&service.journal.path).unwrap();
    #[cfg(unix)]
    {
        let target = dir.path().join("target.json");
        let bytes =
            br#"{"schemaVersion":2,"snapshot":{"epoch":"valid","revision":1,"operations":[]}}"#;
        std::fs::write(&target, bytes).unwrap();
        std::os::unix::fs::symlink(&target, &service.journal.path).unwrap();
        assert!(service.journal.read().is_err());
        assert_eq!(std::fs::read(target).unwrap(), bytes);
    }
}

#[test]
fn journal_writes_validate_before_replacing_private_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let (service, _) = service_with_journal(&dir.path().join("private/nested"));
    let good = Snapshot {
        epoch: "valid".into(),
        revision: 1,
        operations: vec![],
    };
    service.journal.write(&good).unwrap();
    let before = std::fs::read(&service.journal.path).unwrap();
    let invalid = Snapshot {
        revision: u64::MAX,
        ..good
    };
    assert_eq!(
        service.journal.write(&invalid).unwrap_err().kind(),
        std::io::ErrorKind::InvalidInput
    );
    assert_eq!(std::fs::read(&service.journal.path).unwrap(), before);
    let parent = service.journal.path.parent().unwrap();
    assert_eq!(std::fs::read_dir(parent).unwrap().count(), 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        assert_eq!(
            std::fs::metadata(parent).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&service.journal.path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    // JS JSON.parse preserves integer-valued exponent notation as a safe number.
    let decimal: Value = serde_json::from_str(
        r#"{"schemaVersion":2.0,"snapshot":{"epoch":"valid","revision":1e0,"operations":[]}}"#,
    )
    .unwrap();
    assert_eq!(parse_journal(&decimal), Some(vec![]));
}

#[test]
fn declared_recipes_and_surface_capabilities_drive_an_injected_catalog() {
    fn claude_recipe(platform: &str, arch: &str) -> Option<Recipe> {
        let mut recipe = super::super::ROUTES[1].recipe(platform, arch)?;
        recipe.setup_id = "claude";
        Some(recipe)
    }
    static ROUTES: [Route; 2] = [
        Route {
            recipe: claude_recipe,
            ..super::super::ROUTES[0]
        },
        Route {
            chat: false,
            ..super::super::ROUTES[1]
        },
    ];
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake::default());
    let service = Service::for_routes(
        dir.path().join("activation.json"),
        ports.clone(),
        Arc::new(|_| {}),
        "darwin",
        "arm64",
        &ROUTES,
    );
    let plan = service.plan("window", "claude", Surface::Chat).unwrap();
    assert!(plan.automatic);
    service.start("window", &plan.plan_id).unwrap();
    assert_eq!(settle(&service, "claude").status, Status::Ready);
    assert_eq!(*ports.installs.lock().unwrap(), ["claude"]);
    assert!(matches!(
        service.plan("window", "codex", Surface::Chat),
        Err(ErrorCode::Unsupported)
    ));
    ports.found.lock().unwrap().push("codex".into());
    let terminal = service.plan("window", "codex", Surface::Terminal).unwrap();
    service.start("window", &terminal.plan_id).unwrap();
    assert_eq!(settle(&service, "codex").status, Status::Ready);
    assert_eq!(
        *ports.installs.lock().unwrap(),
        ["claude"],
        "existing terminal-only installation is reused"
    );
    assert!(
        matches!(
            service.plan("window", "cursor", Surface::Chat),
            Err(ErrorCode::Unsupported)
        ),
        "global routes may not escape the injected catalog"
    );
    let (normal, _) = new_service(&dir.path().join("default"), Arc::new(Fake::default()));
    assert!(matches!(
        normal.plan("window", "workbuddy-china", Surface::Terminal),
        Err(ErrorCode::Unsupported)
    ));
    service.settle_for_test();
}

#[test]
fn a_synchronously_failing_refresh_cannot_panic_or_reject_a_completed_worker() {
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake {
        found: Mutex::new(vec!["cursor".into()]),
        fail_refresh: true,
        ..Fake::default()
    });
    let (mut service, _) = new_service(dir.path(), ports.clone());
    let (finished, completed) = mpsc::channel();
    service.spawn = Arc::new(move |work| {
        let finished = finished.clone();
        std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work));
            finished.send(result.is_ok()).unwrap();
        });
        Ok(())
    });
    let plan = service.plan("window", "cursor", Surface::Chat).unwrap();
    service.start("window", &plan.plan_id).unwrap();
    let survived = completed.recv_timeout(Duration::from_secs(3)).unwrap();
    service.settle_for_test();
    assert!(
        survived,
        "an advisory refresh must not escape the completed worker"
    );
    let operation = settle(&service, "cursor");
    assert_eq!(
        (operation.status, operation.installed, operation.error),
        (Status::Ready, true, None)
    );
    assert_eq!(ports.refreshes.load(Ordering::SeqCst), 1);
    assert!(ports.installs.lock().unwrap().is_empty());
}

#[test]
fn worker_spawn_failure_publishes_a_terminal_receipt_and_releases_activation_capacity() {
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake::default());
    let (mut service, _) = new_service(dir.path(), ports.clone());
    service.spawn = Arc::new(|_| Err(std::io::Error::other("native thread unavailable")));
    for id in ["claude", "codex", "cursor", "hermes"] {
        let plan = service.plan("window", id, Surface::Chat).unwrap();
        let result = service.start("window", &plan.plan_id).unwrap();
        let op = result
            .operations
            .iter()
            .find(|op| op.setup_id == id)
            .unwrap();
        assert_eq!(
            (op.status, op.error, op.installed),
            (Status::Failed, Some(ErrorCode::Process), false)
        );
        assert_eq!(op.steps[PREPARE], StepState::Failed);
    }
    assert_eq!(ports.resolves.load(Ordering::SeqCst), 0);
    assert_eq!(ports.install_attempts.load(Ordering::SeqCst), 0);
    service.settle_for_test();
    assert!(
        service
            .journal
            .read()
            .unwrap()
            .iter()
            .all(|op| op.status == Status::Failed)
    );
}
