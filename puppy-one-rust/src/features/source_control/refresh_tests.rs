#![cfg(test)]
//! Controlled physical readers plus GPUI's virtual clock exercise the same
//! owner, timers, result channel and publication path as real Git status.
use super::*;
use core::prelude::v1::test;
use std::sync::atomic::AtomicUsize;

#[derive(Debug)]
struct Pending {
    root: PathBuf,
    cancel: Arc<AtomicBool>,
    reply: Option<mpsc::Sender<Result<Snapshot, String>>>,
}
impl Pending {
    fn finish(mut self, result: Result<Snapshot, String>) {
        self.reply.take().unwrap().send(result).unwrap();
    }
}
impl Drop for Pending {
    fn drop(&mut self) {
        if let Some(reply) = self.reply.take() {
            let _ = reply.send(Err("fixture released".into()));
        }
    }
}

#[derive(Default)]
struct Reads {
    started: AtomicUsize,
    active: AtomicUsize,
    maximum: AtomicUsize,
    timed_out: AtomicBool,
}
struct Fixture<'a> {
    view: Entity<SourceControl>,
    cx: &'a mut VisualTestContext,
    pending: mpsc::Receiver<Pending>,
    reads: Arc<Reads>,
    roots: tempfile::TempDir,
}
fn snapshot(branch: &str) -> Snapshot {
    Snapshot {
        branch: branch.into(),
        ..Default::default()
    }
}
impl<'a> Fixture<'a> {
    fn new(cx: &'a mut TestAppContext) -> Self {
        cx.executor().allow_parking();
        let roots = tempfile::tempdir().unwrap();
        for name in ["a", "b"] {
            std::fs::create_dir(roots.path().join(name)).unwrap();
        }
        let (tx, pending) = mpsc::channel();
        let reads = Arc::new(Reads::default());
        let worker = reads.clone();
        let (view, cx) = cx.add_window_view(move |window, cx| {
            let mut view = SourceControl::new(window, cx);
            view.status_reader = Arc::new(move |root, cancel| {
                worker.started.fetch_add(1, Ordering::SeqCst);
                let active = worker.active.fetch_add(1, Ordering::SeqCst) + 1;
                worker.maximum.fetch_max(active, Ordering::SeqCst);
                let (reply, result) = mpsc::channel();
                let sent = tx
                    .send(Pending {
                        root,
                        cancel,
                        reply: Some(reply),
                    })
                    .is_ok();
                let result = if sent {
                    result.recv_timeout(Duration::from_secs(20))
                } else {
                    Err(mpsc::RecvTimeoutError::Disconnected)
                };
                worker.active.fetch_sub(1, Ordering::SeqCst);
                match result {
                    Ok(result) => result,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        worker.timed_out.store(true, Ordering::SeqCst);
                        Err("fixture timed out".into())
                    }
                    Err(_) => Err("fixture closed".into()),
                }
            });
            view
        });
        Self {
            view,
            cx,
            pending,
            reads,
            roots,
        }
    }
    fn attach(&mut self, name: &str) {
        let root = self.roots.path().join(name);
        self.view.update(self.cx, |s, cx| s.set_workspace(root, cx));
    }
    fn request(&mut self) -> Pending {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            self.cx.run_until_parked();
            match self.pending.recv_timeout(Duration::from_millis(2)) {
                Ok(request) => return request,
                Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {}
                other => panic!("expected a physical Git status request: {other:?}"),
            }
        }
    }
    #[track_caller]
    fn settle(&mut self, condition: impl Fn(&SourceControl) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            self.cx.run_until_parked();
            if self.view.read_with(self.cx, |s, _| condition(s)) {
                break;
            }
            if Instant::now() >= deadline {
                let state = self.view.read_with(self.cx, |s, _| {
                    format!("busy={}, running={:?}, read={:?}, absent={}, snapshot={}, dirty={}, error={:?}, failure={}",
                        s.busy, s.running, s.read_ticket, s.repository_absent, s.snapshot.is_some(), s.dirty, s.error, s.failure.is_some())
                });
                panic!(
                    "the status owner did not settle: {state}; reads started={}, active={}",
                    self.reads.started.load(Ordering::SeqCst),
                    self.reads.active.load(Ordering::SeqCst)
                );
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(!self.reads.timed_out.load(Ordering::SeqCst));
    }
    fn settle_branch(&mut self, name: &str) {
        self.settle(|s| !s.busy && s.snapshot.as_ref().is_some_and(|v| v.branch == name));
    }
    fn initial(&mut self) {
        self.attach("a");
        self.request().finish(Ok(snapshot("initial")));
        self.settle_branch("initial");
    }
    fn advance(&mut self, duration: Duration) {
        self.cx.run_until_parked();
        self.cx.cx.executor().advance_clock(duration);
        self.cx.run_until_parked();
    }
    fn no_read(&mut self) {
        self.cx.run_until_parked();
        self.view.read_with(self.cx, |s, _| {
            assert!(s.read_ticket.is_none(), "unexpected physical read slot")
        });
        assert!(matches!(
            self.pending.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        assert!(!self.reads.timed_out.load(Ordering::SeqCst));
    }
    fn invalidate(&mut self) {
        self.view.update(self.cx, |s, cx| s.invalidate(cx));
    }
    fn focus(&mut self, focused: bool) {
        self.view
            .update(self.cx, |s, cx| s.set_focused(focused, cx));
    }
    fn refresh(&mut self) {
        self.view.update(self.cx, |s, cx| s.refresh(cx));
    }
    fn close(self) -> &'a mut VisualTestContext {
        let Self { view, cx, .. } = self;
        cx.update(|window, _| window.remove_window());
        drop(view);
        cx.cx.update(|_| {});
        cx.run_until_parked();
        cx
    }
}

#[gpui::test]
fn background_reads_restart_the_quiet_period_and_wait_for_focus(cx: &mut TestAppContext) {
    let mut f = Fixture::new(cx);
    f.initial();
    f.invalidate();
    f.advance(Duration::from_millis(200));
    f.invalidate();
    f.advance(Duration::from_millis(249));
    f.no_read();
    f.advance(Duration::from_millis(1));
    f.request().finish(Ok(snapshot("debounced")));
    f.settle_branch("debounced");
    f.invalidate();
    f.focus(false);
    f.advance(refresh::DEBOUNCE);
    f.no_read();
    f.view.read_with(f.cx, |s, _| assert!(s.dirty));
    f.focus(true);
    f.request().finish(Ok(snapshot("focused")));
    f.settle_branch("focused");
    f.focus(false);
    f.invalidate();
    f.advance(Duration::from_secs(20));
    f.no_read();
    f.focus(true);
    f.request().finish(Ok(snapshot("resumed")));
    f.settle_branch("resumed");
    assert_eq!(f.reads.started.load(Ordering::SeqCst), 4);
}

#[gpui::test]
fn one_physical_read_owns_one_tail_and_obsolete_roots_cannot_block_or_publish(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    f.attach("a");
    let first = f.request();
    for _ in 0..20 {
        f.invalidate();
    }
    f.advance(Duration::from_secs(1));
    assert_eq!(f.reads.started.load(Ordering::SeqCst), 1);
    first.finish(Ok(snapshot("first")));
    let tail = f.request();
    f.view.read_with(f.cx, |s, _| {
        assert_eq!(s.snapshot.as_ref().unwrap().branch, "first")
    });
    tail.finish(Ok(snapshot("tail")));
    f.settle_branch("tail");
    assert_eq!(f.reads.maximum.load(Ordering::SeqCst), 1);
    f.refresh();
    let old_a = f.request();
    let old_epoch = f.view.read_with(f.cx, |s, _| s.epoch);
    f.attach("b");
    let old_b = f.request();
    assert!(old_a.cancel.load(Ordering::SeqCst));
    f.attach("a");
    let current = f.request();
    assert!(old_b.cancel.load(Ordering::SeqCst));
    assert!(!current.cancel.load(Ordering::SeqCst));
    assert_eq!(old_a.root, current.root);
    assert_ne!(old_b.root, current.root);
    old_a.finish(Ok(snapshot("stale-a")));
    old_b.finish(Ok(snapshot("late-b")));
    current.finish(Ok(snapshot("current-a")));
    f.settle_branch("current-a");
    f.view.update_in(f.cx, |s, window, cx| {
        s.tx.send((
            old_epoch,
            ResultValue::Status(Ok(snapshot("obsolete-mutation"))),
        ))
        .unwrap();
        s.poll(window, cx);
        assert_eq!(s.snapshot.as_ref().unwrap().branch, "current-a");
    });
    assert_eq!(f.reads.started.load(Ordering::SeqCst), 5);
}

#[gpui::test]
fn mutation_publication_fences_read_results_but_keeps_the_physical_slot_until_settlement(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    f.initial();
    for old_result in [Ok(snapshot("stale")), Err("stale error".into())] {
        f.refresh();
        let pending = f.request();
        f.view.update_in(f.cx, |s, window, cx| {
            s.running = Some(Operation::Commit(String::new()).label());
            s.tx.send((s.epoch, ResultValue::Status(Ok(snapshot("mutation")))))
                .unwrap();
            s.poll(window, cx);
            assert!(!s.busy);
            assert!(s.read_ticket.is_some());
            assert_eq!(s.snapshot.as_ref().unwrap().branch, "mutation");
        });
        assert!(pending.cancel.load(Ordering::SeqCst));
        let started = f.reads.started.load(Ordering::SeqCst);
        f.refresh();
        f.advance(Duration::from_secs(1));
        assert_eq!(f.reads.started.load(Ordering::SeqCst), started);
        pending.finish(old_result);
        let fresh = f.request();
        f.view.read_with(f.cx, |s, _| {
            assert_eq!(s.snapshot.as_ref().unwrap().branch, "mutation");
            assert!(s.error.is_none());
        });
        fresh.finish(Ok(snapshot("fresh")));
        f.settle_branch("fresh");
    }
    assert_eq!(f.reads.maximum.load(Ordering::SeqCst), 1);
}

#[gpui::test]
fn failed_reads_keep_good_metadata_and_retry_with_capped_backoff_that_resets_on_success(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    f.initial();
    f.refresh();
    let mut read = f.request();
    for delay in [250, 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000] {
        read.finish(Err("transient".into()));
        f.settle(|s| {
            !s.busy && s.error.as_deref() == Some("transient") && s.refresh_retry.is_some()
        });
        f.view.read_with(f.cx, |s, _| {
            assert_eq!(s.snapshot.as_ref().unwrap().branch, "initial")
        });
        f.advance(Duration::from_millis(delay - 1));
        f.no_read();
        f.advance(Duration::from_millis(1));
        read = f.request();
    }
    read.finish(Ok(snapshot("recovered")));
    f.settle_branch("recovered");
    f.view.read_with(f.cx, |s, _| {
        assert!(s.error.is_none());
        assert!(s.refresh_retry.is_none());
        assert_eq!(s.retry_delay, refresh::RETRY_INITIAL);
    });
    f.refresh();
    f.request().finish(Err("again".into()));
    f.settle(|s| !s.busy && s.refresh_retry.is_some());
    f.advance(refresh::RETRY_INITIAL);
    f.request().finish(Ok(snapshot("reset")));
    f.settle_branch("reset");
}

#[gpui::test]
fn focus_freshness_starts_at_success_and_retry_timers_never_read_in_the_background(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    f.attach("a");
    let slow = f.request();
    f.advance(Duration::from_secs(10));
    slow.finish(Ok(snapshot("slow-success")));
    f.settle_branch("slow-success");
    f.focus(false);
    f.focus(true);
    f.no_read();
    f.advance(refresh::FOCUS_STALE - Duration::from_millis(1));
    f.focus(false);
    f.focus(true);
    f.no_read();
    f.advance(Duration::from_millis(1));
    f.focus(false);
    f.focus(true);
    f.request().finish(Err("failed".into()));
    f.settle(|s| !s.busy && s.refresh_retry.is_some());
    f.focus(false);
    f.advance(refresh::RETRY_INITIAL);
    f.no_read();
    f.focus(true);
    f.request().finish(Ok(snapshot("focused")));
    f.settle_branch("focused");
    // Explicit/manual reads remain available while the window is unfocused.
    f.focus(false);
    f.refresh();
    f.request().finish(Err("hidden-error".into()));
    f.settle(|s| !s.busy && s.error.is_some());
    f.advance(Duration::from_secs(60));
    f.no_read();
    f.focus(true);
    f.request().finish(Ok(snapshot("restored")));
    f.settle_branch("restored");
}

#[gpui::test]
fn absent_repositories_are_quiet_states_and_retire_old_history_instead_of_retrying_forever(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    f.initial();
    let (ticket, cancel) = f
        .view
        .read_with(f.cx, |s, _| (s.history_ticket, s.history_cancel.clone()));
    f.refresh();
    let read = f.request();
    let absent = git::status(&read.root, &AtomicBool::new(false)).unwrap_err();
    assert!(refresh::repository_absent(&absent));
    read.finish(Err(absent));
    f.settle(|s| !s.busy && s.snapshot.is_none());
    assert!(cancel.load(Ordering::Relaxed));
    f.view.update_in(f.cx, |s, window, cx| {
        assert!(s.refresh_retry.is_none());
        assert!(s.repository_absent);
        assert!(s.error.is_none());
        assert!(s.sections.is_empty());
        assert!(s.history_loaded);
        s.tx.send((
            s.epoch,
            ResultValue::History(
                Ok(History {
                    commits: vec![],
                    head: Some("obsolete-head".into()),
                }),
                ticket,
            ),
        ))
        .unwrap();
        s.poll(window, cx);
        assert!(s.history.head.is_none());
    });
    f.focus(false);
    f.focus(true);
    f.no_read();
    f.advance(Duration::from_secs(60));
    f.no_read();
    // The cached non-repository setup remains visible during revalidation,
    // and its real button cannot dispatch or queue Init while a read owns it.
    f.refresh();
    let pending = f.request();
    f.cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    let at = f.cx.debug_bounds("git-init").unwrap().center();
    f.cx.simulate_click(at, Modifiers::default());
    f.view.read_with(f.cx, |s, _| {
        assert!(s.running.is_none());
        assert!(s.queued_operation.is_none());
    });
    pending.finish(Err("fatal: not a git repository".into()));
    f.settle(|s| !s.busy && s.repository_absent);
    f.cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    let at = f.cx.debug_bounds("git-init").unwrap().center();
    f.cx.simulate_click(at, Modifiers::default());
    f.settle(|s| !s.busy && !s.repository_absent && s.snapshot.is_some());
    assert!(f.roots.path().join("a/.git").is_dir());
    f.invalidate();
    f.advance(refresh::DEBOUNCE);
    f.request().finish(Ok(snapshot("initialized")));
    f.settle_branch("initialized");
    f.view.read_with(f.cx, |s, _| assert!(s.error.is_none()));
}

#[gpui::test]
fn fetch_completion_reconciles_through_the_same_debounced_read_queue(cx: &mut TestAppContext) {
    let mut f = Fixture::new(cx);
    f.initial();
    f.view.update_in(f.cx, |s, window, cx| {
        s.tx.send((s.epoch, ResultValue::Status(Ok(snapshot("mutation")))))
            .unwrap();
        s.fetching = true;
        s.tx.send((s.epoch, ResultValue::Fetched(Ok(())))).unwrap();
        s.poll(window, cx);
        assert!(!s.fetching);
        assert_eq!(s.snapshot.as_ref().unwrap().branch, "mutation");
    });
    f.advance(refresh::DEBOUNCE - Duration::from_millis(1));
    f.no_read();
    f.advance(Duration::from_millis(1));
    let read = f.request();
    // Another fetch completion during the read requests one tail, never a
    // competing physical status. Fetch errors leave existing metadata intact.
    f.view.update_in(f.cx, |s, window, cx| {
        s.tx.send((s.epoch, ResultValue::Fetched(Ok(())))).unwrap();
        s.tx.send((s.epoch, ResultValue::Fetched(Err("offline".into()))))
            .unwrap();
        s.poll(window, cx);
        assert!(s.dirty);
        assert_eq!(s.snapshot.as_ref().unwrap().branch, "mutation");
        assert!(s.error.is_none());
    });
    read.finish(Ok(snapshot("refreshed")));
    f.request().finish(Ok(snapshot("tail")));
    f.settle_branch("tail");
    assert_eq!(f.reads.maximum.load(Ordering::SeqCst), 1);
    f.focus(false);
    f.view.update_in(f.cx, |s, window, cx| {
        s.tx.send((s.epoch, ResultValue::Fetched(Ok(())))).unwrap();
        s.poll(window, cx);
        assert!(s.dirty);
    });
    f.advance(Duration::from_secs(10));
    f.no_read();
    f.focus(true);
    f.request().finish(Ok(snapshot("foreground")));
    f.settle_branch("foreground");
}

#[gpui::test]
fn closing_releases_pending_read_owners_and_cancels_debounce_and_retry_timers(
    cx: &mut TestAppContext,
) {
    for phase in ["read", "debounce", "retry"] {
        let mut f = Fixture::new(cx);
        f.initial();
        let pending = match phase {
            "read" => {
                f.refresh();
                Some(f.request())
            }
            "debounce" => {
                f.invalidate();
                None
            }
            _ => {
                f.refresh();
                f.request().finish(Err("retry".into()));
                f.settle(|s| !s.busy && s.refresh_retry.is_some());
                None
            }
        };
        let reads = f.reads.clone();
        let started = reads.started.load(Ordering::SeqCst);
        let cx = f.close();
        if let Some(pending) = pending {
            assert!(pending.cancel.load(Ordering::SeqCst));
            pending.finish(Ok(snapshot("closed")));
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        while reads.active.load(Ordering::SeqCst) > 0 {
            cx.run_until_parked();
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(1));
        }
        cx.cx.executor().advance_clock(Duration::from_secs(60));
        cx.run_until_parked();
        assert_eq!(reads.started.load(Ordering::SeqCst), started);
        assert!(!reads.timed_out.load(Ordering::SeqCst));
    }
}

#[derive(Debug)]
struct PendingFetch {
    root: PathBuf,
    remote: String,
    reply: Option<mpsc::Sender<()>>,
}
impl Drop for PendingFetch {
    fn drop(&mut self) {
        if let Some(reply) = self.reply.take() {
            let _ = reply.send(());
        }
    }
}
struct Fetches {
    pending: mpsc::Receiver<PendingFetch>,
    online: Arc<AtomicBool>,
    started: Arc<AtomicUsize>,
    timed_out: Arc<AtomicBool>,
}
impl Fetches {
    fn install(f: &mut Fixture<'_>) -> Self {
        let (tx, pending) = mpsc::channel();
        let online = Arc::new(AtomicBool::new(true));
        let probe = online.clone();
        let started = Arc::new(AtomicUsize::new(0));
        let count = started.clone();
        let timed_out = Arc::new(AtomicBool::new(false));
        let timeout = timed_out.clone();
        f.view.update(f.cx, |s, _| {
            s.online_probe = Arc::new(move || Some(probe.load(Ordering::SeqCst)));
            // Keep the actual owner, OS worker, completion channel and clock;
            // only replace the network transport.
            s.remote_fetcher = Arc::new(move |root, remote, cancel| {
                count.fetch_add(1, Ordering::SeqCst);
                let (reply, result) = mpsc::channel();
                let _ = tx.send(PendingFetch {
                    root,
                    remote,
                    reply: Some(reply),
                });
                if result.recv_timeout(Duration::from_secs(20)).is_err() {
                    timeout.store(true, Ordering::SeqCst);
                }
                // All failures remain silent, including transport cancellation.
                Err(if cancel.load(Ordering::Relaxed) {
                    "cancelled"
                } else {
                    "offline transport"
                }
                .into())
            });
        });
        Self {
            pending,
            online,
            started,
            timed_out,
        }
    }
    fn request(&self, f: &mut Fixture<'_>) -> PendingFetch {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            f.cx.run_until_parked();
            match self.pending.recv_timeout(Duration::from_millis(2)) {
                Ok(request) => return request,
                Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {}
                other => panic!(
                    "expected remote fetch: {} started; {other:?}",
                    self.started.load(Ordering::SeqCst)
                ),
            }
        }
    }
    fn finish(&self, f: &mut Fixture<'_>, request: PendingFetch) {
        drop(request);
        f.settle(|s| !s.fetching);
        assert!(f.view.read_with(f.cx, |s, _| s.error.is_none()));
        assert!(!self.timed_out.load(Ordering::SeqCst));
    }
    fn no_fetch(&self, f: &mut Fixture<'_>, expected: usize) {
        f.cx.run_until_parked();
        assert!(!f.view.read_with(f.cx, |s, _| s.fetching));
        assert_eq!(self.started.load(Ordering::SeqCst), expected);
        assert!(matches!(
            self.pending.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
    }
}
fn remote_snapshot(remote: &str, branch: &str) -> Snapshot {
    Snapshot {
        branch: branch.into(),
        target: Some(git::SyncTarget {
            remote: "mutation-origin".into(),
            branch: branch.into(),
            exists: true,
        }),
        sync_metadata: git::sync_state::Metadata {
            fetch_target: Some(git::sync_state::FetchTarget {
                remote: remote.into(),
                branch: Some(branch.into()),
            }),
            ..Default::default()
        },
        ..Default::default()
    }
}

#[gpui::test]
fn remote_refresh_targets_hosting_and_reconciles_a_target_changed_during_fetch(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    let fetches = Fetches::install(&mut f);
    f.attach("a");
    f.request()
        .finish(Ok(remote_snapshot("cloud-hosting", "topic")));
    let first = fetches.request(&mut f);
    assert_eq!(first.remote, "cloud-hosting");
    assert_eq!(first.root, f.roots.path().join("a"));
    f.advance(Duration::from_secs(90));
    f.view.update(f.cx, |s, cx| {
        s.request_fetch(Duration::ZERO, cx);
        s.apply_mutation_status(remote_snapshot("github-hosting", "other"), cx);
        s.reconcile_fetch_target(cx);
    });
    assert_eq!(
        fetches.started.load(Ordering::SeqCst),
        1,
        "one physical fetch at a time"
    );
    drop(first);
    let second = fetches.request(&mut f);
    assert_eq!(second.remote, "github-hosting");
    fetches.finish(&mut f, second);
    assert_eq!(
        f.view.read_with(f.cx, |s, _| s
            .snapshot
            .as_ref()
            .unwrap()
            .target
            .as_ref()
            .unwrap()
            .remote
            .clone()),
        "mutation-origin"
    );
    f.no_read();
    // The new target owns a new periodic schedule. The old project's tick
    // cannot delay its next attempt by an extra interval.
    f.advance(refresh::REMOTE_INTERVAL - Duration::from_secs(1));
    fetches.no_fetch(&mut f, 2);
    f.advance(Duration::from_secs(1));
    let third = fetches.request(&mut f);
    assert_eq!(third.remote, "github-hosting");
    fetches.finish(&mut f, third);
}

#[gpui::test]
fn remote_attempts_are_throttled_per_project_and_remote_across_switches_and_failures(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    let fetches = Fetches::install(&mut f);
    for (project, count) in [("a", 1), ("b", 2)] {
        f.attach(project);
        f.request().finish(Ok(remote_snapshot("origin", "topic")));
        let request = fetches.request(&mut f);
        assert_eq!(request.root, f.roots.path().join(project));
        fetches.finish(&mut f, request);
        fetches.no_fetch(&mut f, count);
    }
    f.attach("a");
    f.request().finish(Ok(remote_snapshot("origin", "topic")));
    f.settle_branch("topic");
    fetches.no_fetch(&mut f, 2);
    f.advance(Duration::from_secs(14));
    f.view.update(f.cx, |s, cx| {
        s.apply_mutation_status(remote_snapshot("origin", "new-branch"), cx);
        s.reconcile_fetch_target(cx);
    });
    fetches.no_fetch(&mut f, 2);
    f.advance(Duration::from_secs(1));
    f.view.update(f.cx, |s, cx| {
        s.apply_mutation_status(remote_snapshot("origin", "another-branch"), cx);
        s.reconcile_fetch_target(cx);
    });
    let request = fetches.request(&mut f);
    fetches.finish(&mut f, request);
    assert_eq!(f.view.read_with(f.cx, |s, _| s.fetch_attempts.len()), 2);
    f.view.update(f.cx, |s, cx| {
        s.apply_mutation_status(remote_snapshot("new-remote", "another-branch"), cx);
        s.reconcile_fetch_target(cx);
    });
    let request = fetches.request(&mut f);
    assert_eq!(request.remote, "new-remote");
    fetches.finish(&mut f, request);
    fetches.no_fetch(&mut f, 4);
}

#[gpui::test]
fn online_recovery_focus_and_interval_obey_distinct_gaps_and_close_stops_sampling(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    let fetches = Fetches::install(&mut f);
    fetches.online.store(false, Ordering::SeqCst);
    f.attach("a");
    f.request().finish(Ok(remote_snapshot("origin", "topic")));
    f.settle_branch("topic");
    fetches.no_fetch(&mut f, 0);
    f.focus(false);
    fetches.online.store(true, Ordering::SeqCst);
    f.advance(refresh::ONLINE_POLL);
    fetches.no_fetch(&mut f, 0);
    f.focus(true);
    let request = fetches.request(&mut f);
    fetches.finish(&mut f, request);
    // An online event before 15s cannot retry a failed transport.
    fetches.online.store(false, Ordering::SeqCst);
    f.advance(Duration::from_secs(1));
    fetches.online.store(true, Ordering::SeqCst);
    f.advance(Duration::from_secs(13));
    fetches.no_fetch(&mut f, 1);
    fetches.online.store(false, Ordering::SeqCst);
    f.view.update(f.cx, |s, cx| s.check_online(cx));
    fetches.online.store(true, Ordering::SeqCst);
    f.advance(Duration::from_secs(1));
    let request = fetches.request(&mut f);
    fetches.finish(&mut f, request);
    // A focus event uses 60s, while periodic refresh uses 180s.
    f.advance(Duration::from_secs(59));
    f.focus(false);
    f.view.update(f.cx, |s, cx| {
        s.last_successful_refresh = Some(cx.background_executor().now())
    });
    f.focus(true);
    fetches.no_fetch(&mut f, 2);
    f.advance(Duration::from_secs(1));
    f.focus(false);
    f.focus(true);
    let request = fetches.request(&mut f);
    fetches.finish(&mut f, request);
    f.advance(refresh::REMOTE_INTERVAL - Duration::from_secs(1));
    fetches.no_fetch(&mut f, 3);
    // The interval's fixed cadence can fall before the attempt's quiet period;
    // the next scheduled interval is the next eligible periodic trigger.
    f.advance(refresh::REMOTE_INTERVAL);
    let request = fetches.request(&mut f);
    fetches.finish(&mut f, request);
    let calls = Arc::new(AtomicUsize::new(0));
    let probe = calls.clone();
    f.view.update(f.cx, |s, _| {
        s.online_probe = Arc::new(move || {
            probe.fetch_add(1, Ordering::SeqCst);
            Some(true)
        })
    });
    let cx = f.close();
    cx.cx.executor().advance_clock(refresh::REMOTE_INTERVAL * 2);
    cx.run_until_parked();
    assert_eq!(
        calls.load(Ordering::SeqCst),
        0,
        "closed view has no online sampler"
    );
}

#[gpui::test]
fn project_switches_publish_pending_state_and_reuse_only_that_projects_cached_metadata(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    f.view.read_with(f.cx, |s, _| {
        assert!(s.root.is_none() && s.snapshot.is_none() && !s.busy);
    });
    f.attach("a");
    let first = f.request();
    f.view.read_with(f.cx, |s, _| {
        assert!(s.snapshot.is_none() && s.busy && !s.repository_absent);
    });
    let mut cached = snapshot("project-a");
    cached.changes.push(Change {
        path: "a.md".into(),
        original: None,
        index: 'M',
        worktree: ' ',
    });
    first.finish(Ok(cached.clone()));
    f.settle_branch("project-a");
    f.attach("b");
    let stale_b = f.request();
    let obsolete_epoch = f.view.read_with(f.cx, |s, _| {
        assert!(s.snapshot.is_none() && s.sections.is_empty() && s.busy && !s.repository_absent);
        s.epoch
    });
    f.attach("a");
    // This is synchronous: the worker has not returned, and no remote fetch
    // has to finish before the matching project's metadata becomes visible.
    f.view.read_with(f.cx, |s, _| {
        assert_eq!(s.snapshot.as_ref(), Some(&cached));
        assert!(!s.sections.is_empty());
        assert!(s.busy);
    });
    let current = f.request();
    stale_b.finish(Ok(snapshot("late-b")));
    f.view.update_in(f.cx, |s, window, cx| {
        s.tx.send((
            obsolete_epoch,
            ResultValue::Status(Ok(snapshot("late-b-mutation"))),
        ))
        .unwrap();
        s.poll(window, cx);
        assert_eq!(s.snapshot.as_ref(), Some(&cached));
        assert!(
            s.status_cache
                .iter()
                .all(|(root, _)| root != &f.roots.path().join("b"))
        );
    });
    current.finish(Err("transient verification failure".into()));
    f.settle(|s| !s.busy && s.error.is_some());
    f.view
        .read_with(f.cx, |s, _| assert_eq!(s.snapshot.as_ref(), Some(&cached)));
    f.advance(refresh::RETRY_INITIAL);
    f.request().finish(Ok(snapshot("fresh-a")));
    f.settle_branch("fresh-a");
    f.view.read_with(f.cx, |s, _| {
        assert!(s.sections.is_empty());
        assert_eq!(
            s.status_cache.back().unwrap().1.as_ref().unwrap().branch,
            "fresh-a"
        );
    });
}

#[gpui::test]
fn cached_repository_absence_survives_revalidation_without_reusing_another_roots_state(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    f.attach("a");
    f.request()
        .finish(Err("fatal: not a git repository".into()));
    f.settle(|s| s.repository_absent && !s.busy);
    f.attach("b");
    f.request().finish(Ok(snapshot("project-b")));
    f.settle_branch("project-b");
    f.attach("a");
    f.view.read_with(f.cx, |s, _| {
        assert!(s.repository_absent && s.snapshot.is_none() && s.busy);
        assert!(s.error.is_none() && s.sections.is_empty());
    });
    f.request().finish(Ok(snapshot("newly-initialized-a")));
    f.settle_branch("newly-initialized-a");
    f.view.read_with(f.cx, |s, _| assert!(!s.repository_absent));
}

#[gpui::test]
fn project_metadata_cache_is_bounded_and_orders_eviction_by_successful_publication(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    for i in 0..13 {
        let name = format!("project-{i}");
        std::fs::create_dir(f.roots.path().join(&name)).unwrap();
        f.attach(&name);
        f.request().finish(Ok(snapshot(&name)));
        f.settle_branch(&name);
        if i == 5 {
            f.attach("project-0");
            f.request().finish(Ok(snapshot("updated-zero")));
            f.settle_branch("updated-zero");
        }
    }
    f.view.read_with(f.cx, |s, _| {
        assert_eq!(s.status_cache.len(), 12);
        assert!(
            !s.status_cache
                .iter()
                .any(|(path, _)| path.ends_with("project-1"))
        );
    });
    f.attach("project-0");
    f.view.read_with(f.cx, |s, _| {
        assert_eq!(s.snapshot.as_ref().unwrap().branch, "updated-zero");
        assert!(s.busy);
    });
    f.request().finish(Ok(snapshot("zero-current")));
    f.settle_branch("zero-current");
    f.attach("project-1");
    f.view
        .read_with(f.cx, |s, _| assert!(s.snapshot.is_none() && s.busy));
    f.request().finish(Ok(snapshot("one-current")));
    f.settle_branch("one-current");
}

#[gpui::test]
fn returning_to_cached_metadata_still_loads_the_matching_projects_history(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let roots = tempfile::tempdir().unwrap();
    for name in ["a", "b"] {
        let root = roots.path().join(name);
        std::fs::create_dir(&root).unwrap();
        for args in [
            vec!["init", "-b", name],
            vec!["commit", "--allow-empty", "-m", name],
        ] {
            let output = std::process::Command::new("git")
                .args([
                    "-c",
                    "user.name=Parity",
                    "-c",
                    "user.email=parity@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                ])
                .args(args)
                .current_dir(&root)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
    let (view, cx) = cx.add_window_view(SourceControl::new);
    view.update(cx, |s, _| s.history_open = true);
    for (index, name) in ["a", "b", "a"].into_iter().enumerate() {
        view.update(cx, |s, cx| {
            s.set_workspace(roots.path().join(name), cx);
            assert!(
                s.history.commits.is_empty(),
                "the previous project must disappear synchronously"
            );
            if index == 2 {
                assert_eq!(s.snapshot.as_ref().unwrap().branch, name);
                assert!(s.busy);
            }
        });
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            cx.run_until_parked();
            if view.read_with(cx, |s, _| {
                !s.busy
                    && s.history_loaded
                    && s.history.commits.first().is_some_and(|c| c.message == name)
            }) {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "history for {name} at switch {index} did not load"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
        view.read_with(cx, |s, _| assert!(s.error.is_none(), "{:?}", s.error));
    }
}

#[gpui::test]
fn working_tree_writes_broadcast_before_the_local_refresh_debounce(cx: &mut TestAppContext) {
    let mut fixture = Fixture::new(cx);
    fixture.initial();
    let root = fixture.roots.path().join("a");
    let broadcasts = Arc::new(AtomicUsize::new(0));
    let received = broadcasts.clone();
    let _subscription =
        crate::platform::git_watch::watch(&root, refresh::metadata_noise, move || {
            received.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
    std::fs::write(root.join("note.md"), "written by the workspace").unwrap();
    let before = broadcasts.load(Ordering::SeqCst);
    fixture
        .view
        .update(fixture.cx, |s, cx| s.working_tree_changed(cx));
    assert_eq!(broadcasts.load(Ordering::SeqCst), before + 1);
    fixture.advance(Duration::from_millis(249));
    fixture.no_read();
    fixture.advance(Duration::from_millis(1));
    fixture.request().finish(Ok(snapshot("after-write")));
    fixture.settle_branch("after-write");
}
