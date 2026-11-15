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
    }
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
    while service.read().unwrap().operations[0].status != Status::Installing {
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
