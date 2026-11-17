use super::*;
use std::{sync::mpsc, time::Instant};

fn work(name: &str) -> Key {
    Key::Worktree(PathBuf::from(name))
}
fn repo(name: &str) -> Key {
    Key::Repository(PathBuf::from(name))
}
fn wait_for_queue(c: &Coordinator, count: usize) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while c.state.lock().unwrap().entries.len() != count {
        assert!(
            Instant::now() < deadline,
            "reservation did not enter the queue"
        );
        std::thread::yield_now();
    }
}

#[test]
fn overlapping_mutations_keep_fifo_order_and_release_every_owner() {
    let c = Coordinator::default();
    let cancel = AtomicBool::new(false);
    let key = work("/repo");
    let (tx, rx) = mpsc::channel();
    std::thread::scope(|scope| {
        let first = c.acquire(std::slice::from_ref(&key), &cancel).unwrap();
        scope.spawn(|| {
            let _owner = c.acquire(std::slice::from_ref(&key), &cancel).unwrap();
            tx.send(2).unwrap();
        });
        wait_for_queue(&c, 2);
        scope.spawn(|| {
            let _owner = c.acquire(std::slice::from_ref(&key), &cancel).unwrap();
            tx.send(3).unwrap();
        });
        wait_for_queue(&c, 3);
        assert!(rx.try_recv().is_err());
        drop(first);
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), 3);
    });
    assert!(c.is_idle(&[key]).unwrap());
    assert!(c.state.lock().unwrap().entries.is_empty());
}

#[test]
fn independent_worktrees_run_together_but_shared_repository_keys_serialize() {
    let c = Coordinator::default();
    let cancel = AtomicBool::new(false);
    let a = c.acquire(&[work("/a")], &cancel).unwrap();
    let b = c.try_acquire(&[work("/b")]).unwrap().unwrap();
    let shared = c.acquire(&[repo("/common")], &cancel).unwrap();
    assert!(c.try_acquire(&[repo("/common")]).unwrap().is_none());
    assert!(c.try_acquire(&[repo("/other")]).unwrap().is_some());
    drop((a, b, shared));
    assert!(c.state.lock().unwrap().entries.is_empty());
}

#[test]
fn multi_domain_reservation_is_atomic_and_low_priority_never_jumps_the_queue() {
    let c = Coordinator::default();
    let cancel = AtomicBool::new(false);
    let both = [work("/root"), repo("/common")];
    let (started, observed) = mpsc::channel();
    let (release, ready) = mpsc::channel();
    let (c, cancel, both) = (&c, &cancel, &both);
    std::thread::scope(|scope| {
        let first = c.acquire(&[both[0].clone()], cancel).unwrap();
        // Reverse input and duplicate keys cannot cause nested-lock deadlocks.
        let pending = scope.spawn(move || {
            let _owner = c
                .acquire(&[both[1].clone(), both[0].clone(), both[1].clone()], cancel)
                .unwrap();
            started.send(()).unwrap();
            ready.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        wait_for_queue(c, 2);
        assert!(c.try_acquire(&[both[1].clone()]).unwrap().is_none());
        assert!(c.try_acquire(both).unwrap().is_none());
        assert!(c.try_acquire(&[work("/independent")]).unwrap().is_some());
        assert!(observed.try_recv().is_err());
        drop(first);
        observed.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(!c.is_idle(both).unwrap());
        release.send(()).unwrap();
        pending.join().unwrap();
    });
    assert!(c.try_acquire(both).unwrap().is_some());
    assert!(c.is_idle(both).unwrap());
}

#[test]
fn cancelling_a_pending_owner_releases_all_its_reserved_domains() {
    let c = Coordinator::default();
    let cancel = AtomicBool::new(false);
    let both = [work("/root"), repo("/common")];
    let (finished, result) = mpsc::channel();
    std::thread::scope(|scope| {
        let first = c
            .acquire(&[both[0].clone()], &AtomicBool::new(false))
            .unwrap();
        let pending = scope.spawn(|| {
            finished
                .send(c.acquire(&both, &cancel).err().unwrap())
                .unwrap()
        });
        wait_for_queue(&c, 2);
        cancel.store(true, Ordering::Release);
        assert_eq!(
            result.recv_timeout(Duration::from_secs(5)).unwrap(),
            CANCELLED
        );
        pending.join().unwrap();
        assert!(c.try_acquire(&[both[1].clone()]).unwrap().is_some());
        assert!(!c.is_idle(&both).unwrap());
        drop(first);
    });
    assert!(c.is_idle(&both).unwrap());
}

#[test]
fn read_waits_are_cancellable_without_cancelling_the_active_mutation() {
    let c = Coordinator::default();
    let cancel = AtomicBool::new(false);
    let keys = [work("/root"), repo("/common")];
    let (started, seen) = mpsc::channel();
    let (finished, result) = mpsc::channel();
    std::thread::scope(|scope| {
        let owner = c
            .acquire(&[keys[1].clone()], &AtomicBool::new(false))
            .unwrap();
        let waiting = scope.spawn(|| {
            started.send(()).unwrap();
            finished.send(c.wait_idle(&keys, &cancel)).unwrap();
        });
        seen.recv_timeout(Duration::from_secs(5)).unwrap();
        cancel.store(true, Ordering::Release);
        assert_eq!(
            result
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap_err(),
            CANCELLED
        );
        waiting.join().unwrap();
        assert!(!c.is_idle(&keys).unwrap());
        drop(owner);
    });
    assert!(c.is_idle(&keys).unwrap());
}

#[test]
fn idle_waits_observe_every_requested_domain() {
    let c = Coordinator::default();
    let keys = [work("/root"), repo("/common")];
    let cancel = AtomicBool::new(false);
    let (done, observed) = mpsc::channel();
    std::thread::scope(|scope| {
        let a = c.acquire(&[keys[0].clone()], &cancel).unwrap();
        let b = c.acquire(&[keys[1].clone()], &cancel).unwrap();
        let waiting = scope.spawn(|| {
            c.wait_idle(&keys, &cancel).unwrap();
            done.send(()).unwrap();
        });
        assert!(observed.recv_timeout(Duration::from_millis(30)).is_err());
        drop(a);
        assert!(observed.recv_timeout(Duration::from_millis(30)).is_err());
        drop(b);
        observed.recv_timeout(Duration::from_secs(5)).unwrap();
        waiting.join().unwrap();
    });
}

#[test]
fn errors_and_panics_drop_ownership_without_poisoning_the_coordinator() {
    let c = Coordinator::default();
    let key = repo("/repo");
    let fail = || -> Result<(), &str> {
        let _owner = c
            .acquire(std::slice::from_ref(&key), &AtomicBool::new(false))
            .unwrap();
        Err("operation failed")
    };
    assert!(fail().is_err());
    assert!(c.is_idle(std::slice::from_ref(&key)).unwrap());
    assert!(
        std::panic::catch_unwind(|| {
            let _owner = c
                .acquire(std::slice::from_ref(&key), &AtomicBool::new(false))
                .unwrap();
            panic!("fixture panic");
        })
        .is_err()
    );
    assert!(c.try_acquire(&[key]).unwrap().is_some());
    assert!(c.acquire(&[], &AtomicBool::new(false)).is_err());
    assert!(c.try_acquire(&[work("")]).is_err());
}

fn git(root: &Path, args: &[&str]) -> String {
    String::from_utf8(super::super::git(root, args, None, &AtomicBool::new(false)).unwrap())
        .unwrap()
        .trim()
        .into()
}
fn fixture() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    git(root, &["init", "-q", "-b", "main"]);
    git(root, &["config", "user.name", "Coordination fixture"]);
    git(
        root,
        &["config", "user.email", "coordination@example.invalid"],
    );
    git(root, &["config", "commit.gpgsign", "false"]);
    std::fs::write(root.join("file.md"), "base\n").unwrap();
    git(root, &["add", "file.md"]);
    git(root, &["commit", "-qm", "initial"]);
    temp
}

#[test]
fn git_identity_collapses_aliases_and_subfolders_but_distinguishes_linked_indexes() {
    let root = fixture();
    let other = tempfile::tempdir().unwrap();
    let linked = other.path().join("linked");
    git(
        root.path(),
        &["worktree", "add", "-qb", "linked", linked.to_str().unwrap()],
    );
    std::fs::create_dir(root.path().join("docs")).unwrap();
    let cancel = AtomicBool::new(false);
    let a = Domains::resolve(root.path(), &cancel).unwrap();
    let b = Domains::resolve(&linked, &cancel).unwrap();
    assert_eq!(a.repository, b.repository);
    assert_ne!(a.worktree, b.worktree);
    assert_eq!(
        Domains::resolve(&root.path().join("docs"), &cancel).unwrap(),
        a
    );
    #[cfg(unix)]
    {
        let alias = other.path().join("alias");
        std::os::unix::fs::symlink(root.path(), &alias).unwrap();
        assert_eq!(Domains::resolve(&alias, &cancel).unwrap(), a);
    }
}

#[test]
fn real_mutations_and_status_reads_share_ownership_across_opened_subfolders() {
    use super::super::{Change, Operation, operate, status};
    let root = fixture();
    std::fs::create_dir(root.path().join("docs")).unwrap();
    std::fs::write(root.path().join("docs/new.md"), "new\n").unwrap();
    let cancel = AtomicBool::new(false);
    let domains = Domains::resolve(root.path(), &cancel).unwrap();
    let (done, observed) = mpsc::channel();
    std::thread::scope(|scope| {
        let owner = GLOBAL.acquire(&domains.both(), &cancel).unwrap();
        let stage = scope.spawn(|| {
            operate(
                &root.path().join("docs"),
                &Operation::Stage(Change {
                    path: "docs/new.md".into(),
                    original: None,
                    index: '?',
                    worktree: '?',
                }),
                &cancel,
            )
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        while GLOBAL
            .state
            .lock()
            .unwrap()
            .entries
            .iter()
            .filter(|e| e.keys.contains(&domains.worktree))
            .count()
            != 2
        {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        let reader = scope.spawn(|| {
            let result = status(root.path(), &cancel);
            done.send(result).unwrap();
        });
        assert_eq!(git(root.path(), &["diff", "--cached", "--name-only"]), "");
        assert!(observed.recv_timeout(Duration::from_millis(30)).is_err());
        drop(owner);
        assert!(
            stage
                .join()
                .unwrap()
                .unwrap()
                .changes
                .iter()
                .any(|c| c.path == "docs/new.md" && c.staged())
        );
        let snapshot = observed
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        assert!(
            snapshot
                .changes
                .iter()
                .any(|c| c.path == "docs/new.md" && c.staged())
        );
        reader.join().unwrap();
    });
    assert!(GLOBAL.is_idle(&domains.both()).unwrap());
}

#[test]
fn linked_worktree_staging_remains_parallel_while_shared_fetch_waits() {
    use super::super::{Change, Operation, fetch, operate};
    let root = fixture();
    let other = tempfile::tempdir().unwrap();
    let linked = other.path().join("linked");
    git(
        root.path(),
        &["worktree", "add", "-qb", "linked", linked.to_str().unwrap()],
    );
    std::fs::write(linked.join("new.md"), "linked work\n").unwrap();
    let domains = Domains::resolve(root.path(), &AtomicBool::new(false)).unwrap();
    let cancel = AtomicBool::new(false);
    let (staged, stage_result) = mpsc::channel();
    let (fetched, fetch_result) = mpsc::channel();
    std::thread::scope(|scope| {
        let owner = GLOBAL.acquire(&domains.both(), &cancel).unwrap();
        let stage = scope.spawn(|| {
            staged
                .send(operate(
                    &linked,
                    &Operation::Stage(Change {
                        path: "new.md".into(),
                        original: None,
                        index: '?',
                        worktree: '?',
                    }),
                    &cancel,
                ))
                .unwrap();
        });
        let result = stage_result
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        stage.join().unwrap();
        assert!(
            result
                .changes
                .iter()
                .any(|c| c.path == "new.md" && c.staged())
        );
        let pending = scope.spawn(|| {
            fetched
                .send(fetch(&linked, "must-not-contact-a-remote", &cancel))
                .unwrap()
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        while GLOBAL
            .state
            .lock()
            .unwrap()
            .entries
            .iter()
            .filter(|e| e.keys.contains(&domains.repository))
            .count()
            != 2
        {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        cancel.store(true, Ordering::Release);
        assert_eq!(
            fetch_result
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap_err(),
            CANCELLED
        );
        pending.join().unwrap();
        drop(owner);
    });
    assert!(GLOBAL.is_idle(&domains.both()).unwrap());
}

#[test]
fn all_production_git_readers_cancel_while_a_mutation_owns_the_repository() {
    use crate::platform::{git as api, git_diff, git_history};
    let root = fixture();
    let domains = Domains::resolve(root.path(), &AtomicBool::new(false)).unwrap();
    let head = git(root.path(), &["rev-parse", "HEAD"]);
    for reader in 0..5 {
        let cancel = AtomicBool::new(false);
        let (started, seen) = mpsc::channel();
        let (finished, result) = mpsc::channel();
        std::thread::scope(|scope| {
            let owner = GLOBAL
                .acquire(&domains.both(), &AtomicBool::new(false))
                .unwrap();
            let pending = scope.spawn(|| {
                started.send(()).unwrap();
                finished
                    .send(match reader {
                        0 => api::status(root.path(), &cancel).map(|_| ()),
                        1 => api::repository_info(root.path(), &cancel).map(|_| ()),
                        2 => git_history::history(root.path(), &cancel).map(|_| ()),
                        3 => git_diff::file_diff(
                            root.path(),
                            "",
                            "file.md",
                            None,
                            git_diff::Scope::Unstaged,
                            &cancel,
                        )
                        .map(|_| ()),
                        _ => git_diff::commit_detail(root.path(), &head, &cancel).map(|_| ()),
                    })
                    .unwrap();
            });
            seen.recv_timeout(Duration::from_secs(5)).unwrap();
            cancel.store(true, Ordering::Release);
            assert!(
                result
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap()
                    .unwrap_err()
                    .contains("cancelled")
            );
            pending.join().unwrap();
            assert!(!GLOBAL.is_idle(&domains.both()).unwrap());
            drop(owner);
        });
    }
    assert_eq!(git(root.path(), &["rev-parse", "HEAD"]), head);
}
