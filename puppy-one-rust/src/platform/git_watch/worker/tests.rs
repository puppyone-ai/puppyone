use super::*;
use crate::platform::git::git;
use std::sync::{Mutex, atomic::AtomicUsize};

fn repository() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    git(
        directory.path(),
        &["init", "-q", "-b", "main"],
        None,
        &std::sync::atomic::AtomicBool::new(false),
    )
    .unwrap();
    directory
}
fn noise(path: &str) -> bool {
    path.ends_with(".lock") || path.starts_with("objects/")
}
struct Harness {
    _directory: tempfile::TempDir,
    worker: Worker,
    events: mpsc::Receiver<Signal>,
    wakes: Arc<Mutex<Vec<Wake>>>,
    failures: Arc<AtomicUsize>,
    published: AtomicUsize,
    now: Instant,
}
impl Harness {
    fn new(failures: usize) -> Self {
        Self::with_repository(repository(), failures)
    }
    fn with_repository(directory: tempfile::TempDir, failures: usize) -> Self {
        let (sender, events) = mpsc::channel();
        let wakes = Arc::new(Mutex::new(Vec::new()));
        let failed = Arc::new(AtomicUsize::new(failures));
        let recorded = wakes.clone();
        let remaining = failed.clone();
        let factory: Factory = Arc::new(move |_, _, _, wake| {
            recorded.lock().unwrap().push(wake);
            if remaining
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                .is_ok()
            {
                Err("injected recoverable native watcher failure".into())
            } else {
                Ok(Box::new(()))
            }
        });
        let now = Instant::now();
        let mut worker = Worker::new(
            directory.path().canonicalize().unwrap(),
            noise,
            sender,
            factory,
            Arc::new(identity),
            now,
        );
        worker.install(now);
        worker.last = worker.read();
        Self {
            _directory: directory,
            worker,
            events,
            wakes,
            failures: failed,
            published: AtomicUsize::new(0),
            now,
        }
    }
    fn tick(&mut self, elapsed: Duration) {
        let at = self.now + elapsed;
        for signal in self.events.try_iter() {
            assert!(self.worker.signal(signal, at));
        }
        let count = &self.published;
        self.worker.tick(at, &|| {
            count.fetch_add(1, Ordering::SeqCst);
        });
    }
    fn wake(&self) -> Wake {
        self.wakes.lock().unwrap().last().unwrap().clone()
    }
    fn attempts(&self) -> usize {
        self.wakes.lock().unwrap().len()
    }
}

#[test]
fn failed_native_arms_back_off_to_thirty_seconds_and_success_resets_the_budget() {
    let mut h = Harness::new(usize::MAX);
    let mut elapsed = Duration::ZERO;
    for gap in [250, 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000] {
        let gap = Duration::from_millis(gap);
        assert_eq!(h.worker.rearm, Some(h.now + elapsed + gap));
        let attempts = h.attempts();
        h.tick(elapsed + gap - Duration::from_millis(1));
        assert_eq!(h.attempts(), attempts, "no early retry");
        elapsed += gap;
        h.tick(elapsed);
        assert_eq!(h.attempts(), attempts + 1);
    }
    h.failures.store(0, Ordering::SeqCst);
    elapsed += Duration::from_secs(30);
    h.tick(elapsed);
    assert!(h.worker.handle.is_some());
    assert!(h.worker.rearm.is_none());
    h.wake().notify(REARM | CHANGED);
    h.tick(elapsed);
    assert_eq!(
        h.worker.rearm,
        Some(h.now + elapsed + Duration::from_millis(250))
    );
    h.failures.store(1, Ordering::SeqCst);
    elapsed += Duration::from_millis(250);
    h.tick(elapsed);
    assert_eq!(
        h.worker.rearm,
        Some(h.now + elapsed + Duration::from_millis(500))
    );
    assert!(h.worker.handle.is_none());
    elapsed += Duration::from_millis(500);
    h.tick(elapsed);
    assert!(h.worker.handle.is_some());
    assert!(h.published.load(Ordering::SeqCst) > 0);
}

#[test]
fn continuous_events_are_bounded_and_publish_from_the_first_event_deadline() {
    let mut h = Harness::new(0);
    let wake = h.wake();
    for _ in 0..20_000 {
        wake.notify(CHANGED);
    }
    let signals: Vec<_> = h.events.try_iter().collect();
    assert_eq!(
        signals.len(),
        1,
        "native events must coalesce before entering the worker queue"
    );
    for signal in signals {
        assert!(h.worker.signal(signal, h.now));
    }
    for ms in [20, 40, 60, 80, 100, 119] {
        wake.notify(CHANGED);
        h.tick(Duration::from_millis(ms));
        assert_eq!(h.published.load(Ordering::SeqCst), 0);
    }
    wake.notify(CHANGED);
    h.tick(Duration::from_millis(120));
    assert_eq!(h.published.load(Ordering::SeqCst), 1);
    h.tick(Duration::from_millis(500));
    assert_eq!(
        h.published.load(Ordering::SeqCst),
        1,
        "no duplicate timer after publication"
    );
    wake.notify(REARM);
    h.tick(Duration::from_millis(500));
    h.tick(Duration::from_millis(750));
    let attempts = h.attempts();
    wake.notify(CHANGED | REARM);
    h.tick(Duration::from_millis(800));
    assert_eq!(h.attempts(), attempts);
    assert!(
        h.worker.debounce.is_none() && h.worker.rearm.is_none(),
        "retired watcher generation is inert"
    );
    assert!(!h.worker.signal(Signal::Stop, h.now));
}

#[test]
fn silent_streams_reconcile_real_metadata_and_rearm_without_worktree_noise() {
    let mut h = Harness::new(0);
    let root = h.worker.root.clone();
    let mut elapsed = Duration::ZERO;
    for path in [
        "HEAD",
        "index",
        "packed-refs",
        "FETCH_HEAD",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "refs/heads/topic",
        "refs/remotes/origin/topic",
        "rebase-merge/head-name",
        "sequencer/todo",
    ] {
        let location = root.join(".git").join(path);
        std::fs::create_dir_all(location.parent().unwrap()).unwrap();
        let content = if path == "HEAD" {
            "ref: refs/heads/topic\n"
        } else {
            "0123456789012345678901234567890123456789\n"
        };
        std::fs::write(location, content).unwrap();
        let before = h.published.load(Ordering::SeqCst);
        let attempts = h.attempts();
        elapsed += Duration::from_secs(2);
        h.tick(elapsed);
        assert_eq!(h.published.load(Ordering::SeqCst), before + 1, "{path}");
        assert_eq!(
            h.attempts(),
            attempts + 1,
            "cold native stream must be rearmed: {path}"
        );
    }
    let before = h.published.load(Ordering::SeqCst);
    std::fs::write(root.join(".git/index.lock"), "noise").unwrap();
    std::fs::write(root.join("note.md"), "working tree noise").unwrap();
    h.tick(elapsed + Duration::from_secs(2));
    assert_eq!(h.published.load(Ordering::SeqCst), before);
}

#[test]
fn pending_identity_is_rechecked_after_arming_and_drop_releases_native_handles() {
    struct HandleDrop(mpsc::Sender<()>);
    impl WatchHandle for HandleDrop {}
    impl Drop for HandleDrop {
        fn drop(&mut self) {
            let _ = self.0.send(());
        }
    }
    let directory = repository();
    let resolves = Arc::new(AtomicUsize::new(0));
    let observed = resolves.clone();
    let resolver: Resolver = Arc::new(move |path| {
        if observed.fetch_add(1, Ordering::SeqCst) == 0 {
            Err("not initialized at first lookup".into())
        } else {
            identity(path)
        }
    });
    let (released, release) = mpsc::channel();
    let arms = Arc::new(Mutex::new(Vec::new()));
    let observed = arms.clone();
    let factory: Factory = Arc::new(move |_, identity, _, _| {
        observed.lock().unwrap().push(identity.is_some());
        Ok(Box::new(HandleDrop(released.clone())))
    });
    let published = Arc::new(AtomicUsize::new(0));
    let observed = published.clone();
    let watch = start_with(
        directory.path(),
        noise,
        move || {
            observed.fetch_add(1, Ordering::SeqCst);
        },
        factory,
        resolver,
    )
    .unwrap();
    assert_eq!(*arms.lock().unwrap(), [false, true]);
    assert_eq!(published.load(Ordering::SeqCst), 1);
    release.recv_timeout(Duration::from_secs(5)).unwrap();
    drop(watch);
    release
        .recv_timeout(Duration::from_secs(5))
        .expect("drop did not release the active native handle");
}

fn command(root: &Path, args: &[&str]) -> Vec<u8> {
    git(root, args, None, &std::sync::atomic::AtomicBool::new(false)).unwrap()
}
fn committed_repository() -> tempfile::TempDir {
    let directory = repository();
    let root = directory.path();
    command(root, &["config", "user.name", "Metadata test"]);
    command(root, &["config", "user.email", "metadata@example.invalid"]);
    command(root, &["config", "commit.gpgsign", "false"]);
    std::fs::write(root.join("tracked.txt"), "initial\n").unwrap();
    command(root, &["add", "tracked.txt"]);
    command(root, &["commit", "-qm", "initial"]);
    directory
}
fn state(root: &Path) -> crate::platform::git::Snapshot {
    crate::platform::git::status(root, &std::sync::atomic::AtomicBool::new(false)).unwrap()
}
fn reconciled(h: &mut Harness, elapsed: &mut Duration) {
    let before = h.published.load(Ordering::SeqCst);
    *elapsed += Duration::from_secs(2);
    h.tick(*elapsed);
    assert_eq!(
        h.published.load(Ordering::SeqCst),
        before + 1,
        "external Git metadata was not reconciled"
    );
}

#[test]
fn cold_external_commits_index_changes_and_refs_converge_without_native_events() {
    let directory = committed_repository();
    let root = directory.path().canonicalize().unwrap();
    let original = state(&root).head;
    let mut h = Harness::with_repository(directory, 0);
    let mut elapsed = Duration::ZERO;
    command(&root, &["checkout", "-qb", "silent-stream"]);
    std::fs::write(root.join("tracked.txt"), "external\n").unwrap();
    command(&root, &["add", "tracked.txt"]);
    command(&root, &["commit", "-qm", "external"]);
    reconciled(&mut h, &mut elapsed);
    let snapshot = state(&root);
    assert_eq!(snapshot.branch, "silent-stream");
    assert_ne!(snapshot.head, original);
    assert!(snapshot.changes.is_empty());

    std::fs::write(root.join("tracked.txt"), "next\n").unwrap();
    command(&root, &["add", "tracked.txt"]);
    reconciled(&mut h, &mut elapsed);
    assert!(
        state(&root)
            .changes
            .iter()
            .any(|c| c.path == "tracked.txt" && c.staged())
    );
    command(&root, &["reset", "-q", "--", "tracked.txt"]);
    reconciled(&mut h, &mut elapsed);
    assert!(
        state(&root)
            .changes
            .iter()
            .all(|c| !c.staged() && c.unstaged())
    );
    command(&root, &["reset", "--hard", "HEAD"]);
    command(&root, &["reset", "--soft", "HEAD~1"]);
    reconciled(&mut h, &mut elapsed);
    assert_eq!(state(&root).head, original);
    assert!(state(&root).changes.iter().any(|c| c.staged()));
    command(&root, &["reset", "--hard", "HEAD"]);
    reconciled(&mut h, &mut elapsed);
    assert!(state(&root).changes.is_empty());

    command(&root, &["checkout", "-qb", "identical-tree"]);
    reconciled(&mut h, &mut elapsed);
    assert_eq!(state(&root).branch, "identical-tree");
    assert_eq!(state(&root).head, original);
    command(&root, &["branch", "nested/topic"]);
    command(&root, &["pack-refs", "--all", "--prune"]);
    reconciled(&mut h, &mut elapsed);
    assert!(root.join(".git/packed-refs").is_file());
    assert_eq!(
        String::from_utf8(command(&root, &["rev-parse", "nested/topic"]))
            .unwrap()
            .trim(),
        original
    );
    command(&root, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
    reconciled(&mut h, &mut elapsed);
    assert_eq!(
        crate::platform::git::repository_info(&root, &AtomicBool::new(false))
            .unwrap()
            .remote_branches,
        1
    );
    assert_eq!(
        String::from_utf8(command(&root, &["rev-parse", "origin/main"]))
            .unwrap()
            .trim(),
        original
    );
    command(
        &root,
        &[
            "config",
            "remote.origin.url",
            "https://example.invalid/repository.git",
        ],
    );
    reconciled(&mut h, &mut elapsed);
    assert_eq!(
        String::from_utf8(command(&root, &["remote", "get-url", "origin"]))
            .unwrap()
            .trim(),
        "https://example.invalid/repository.git"
    );
    let info = crate::platform::git::repository_info(&root, &AtomicBool::new(false)).unwrap();
    assert_eq!(
        info.remotes[0].fetch_url.as_deref(),
        Some("https://example.invalid/repository.git")
    );
    assert_eq!(info.remotes[0].branches, 1);
}

#[test]
fn real_merge_cherry_pick_and_rebase_state_remains_observable_through_recovery() {
    use crate::platform::git::RepositoryOperation;
    let directory = committed_repository();
    let root = directory.path().canonicalize().unwrap();
    command(&root, &["checkout", "-qb", "topic"]);
    std::fs::write(root.join("tracked.txt"), "topic\n").unwrap();
    command(&root, &["add", "tracked.txt"]);
    command(&root, &["commit", "-qm", "topic"]);
    command(&root, &["checkout", "-q", "main"]);
    std::fs::write(root.join("tracked.txt"), "mainline\n").unwrap();
    command(&root, &["add", "tracked.txt"]);
    command(&root, &["commit", "-qm", "mainline"]);
    let mut h = Harness::with_repository(directory, 0);
    let mut elapsed = Duration::ZERO;
    for (args, operation) in [
        (
            vec!["merge", "--no-ff", "--no-commit", "topic"],
            RepositoryOperation::Merge,
        ),
        (
            vec!["cherry-pick", "topic"],
            RepositoryOperation::CherryPick,
        ),
        (vec!["rebase", "topic"], RepositoryOperation::Rebase),
    ] {
        assert!(
            git(
                &root,
                &args,
                None,
                &std::sync::atomic::AtomicBool::new(false)
            )
            .is_err(),
            "fixture must produce a real conflict"
        );
        reconciled(&mut h, &mut elapsed);
        let snapshot = state(&root);
        assert_eq!(snapshot.operation, Some(operation));
        assert!(snapshot.changes.iter().any(|c| c.conflict()));
        command(&root, &[operation.command(), "--abort"]);
        reconciled(&mut h, &mut elapsed);
        assert!(state(&root).operation.is_none());
        assert!(state(&root).changes.is_empty());
    }
}

#[test]
fn cold_non_repository_promotes_on_reconciliation_without_native_events() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    assert!(identity(&root).is_err());
    let mut h = Harness::with_repository(directory, 0);
    assert!(h.worker.identity.is_none());
    command(&root, &["init", "-q", "-b", "main"]);
    h.tick(Duration::from_millis(1999));
    assert!(h.worker.identity.is_none());
    h.tick(Duration::from_secs(2));
    assert_eq!(h.worker.identity.as_ref().unwrap().top_level, root);
    assert_eq!(h.published.load(Ordering::SeqCst), 1);
    assert_eq!(h.attempts(), 2);
}

#[test]
fn repository_identity_uses_absolute_top_level_git_and_linked_common_directories() {
    let directory = committed_repository();
    let root = directory.path().canonicalize().unwrap();
    let nested = root.join("nested");
    std::fs::create_dir(&nested).unwrap();
    let main = identity(&nested).unwrap();
    assert_eq!(main.top_level, root);
    assert_eq!(main.git_dir, root.join(".git"));
    assert_eq!(main.common_dir, main.git_dir);
    let linked_parent = tempfile::tempdir().unwrap();
    let linked = linked_parent.path().canonicalize().unwrap().join("linked");
    let linked_arg = linked.to_string_lossy();
    let linked_arg = linked_arg.strip_prefix(r"\\?\").unwrap_or(&linked_arg);
    command(
        &root,
        &["worktree", "add", "-q", "-b", "linked", linked_arg],
    );
    let branch = identity(&linked).unwrap();
    assert_eq!(branch.top_level, linked);
    assert!(branch.git_dir.is_absolute());
    assert_ne!(branch.git_dir, main.git_dir);
    assert_eq!(branch.common_dir, main.common_dir);
    assert!(identity(linked_parent.path()).is_err());
}
