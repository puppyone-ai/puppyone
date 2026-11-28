use super::*;
use std::sync::{Barrier, atomic::AtomicUsize};
fn noise(path: &str) -> bool {
    path.ends_with(".lock")
}
fn init(root: &Path) {
    crate::platform::git::git(
        root,
        &["init", "-q", "-b", "main"],
        None,
        &AtomicBool::new(false),
    )
    .unwrap();
}
fn subscribe(root: &Path, count: Arc<AtomicUsize>) -> GitWatch {
    watch_using(
        root,
        noise,
        move || {
            count.fetch_add(1, Ordering::SeqCst);
        },
        |root, noise, changed| worker::start_silent(root, noise, changed),
    )
    .unwrap()
}
#[test]
fn subscriptions_share_one_repository_worker_and_retire_only_their_own_tokens() {
    let directory = tempfile::tempdir().unwrap();
    init(directory.path());
    let old_count = Arc::new(AtomicUsize::new(0));
    let new_count = Arc::new(AtomicUsize::new(0));
    let old = subscribe(directory.path(), old_count.clone());
    let nested = directory.path().join("nested");
    std::fs::create_dir(&nested).unwrap();
    let current = subscribe(&nested, new_count.clone());
    assert_ne!(old.client.id, current.client.id);
    let owner = Arc::downgrade(&old.client.owner.lock().unwrap());
    let current_owner = Arc::downgrade(&current.client.owner.lock().unwrap());
    assert!(Weak::ptr_eq(&owner, &current_owner));
    assert_eq!(invalidate_working_tree(&nested), 2);
    assert_eq!(old_count.load(Ordering::SeqCst), 1);
    assert_eq!(new_count.load(Ordering::SeqCst), 1);
    drop(old);
    assert!(owner.upgrade().is_some());
    assert_eq!(invalidate_working_tree(directory.path()), 1);
    assert_eq!(
        old_count.load(Ordering::SeqCst),
        1,
        "retired token received a later invalidation"
    );
    assert_eq!(new_count.load(Ordering::SeqCst), 2);
    drop(current);
    assert!(
        owner.upgrade().is_none(),
        "the final token must release the worker owner"
    );
    assert_eq!(invalidate_working_tree(directory.path()), 0);
}

#[test]
fn simultaneous_subscriptions_initialize_only_one_worker_and_all_get_immediate_writes() {
    let directory = tempfile::tempdir().unwrap();
    init(directory.path());
    let starts = Arc::new(AtomicUsize::new(0));
    let count = Arc::new(AtomicUsize::new(0));
    let barrier = Arc::new(Barrier::new(9));
    let mut threads = Vec::new();
    for _ in 0..8 {
        let root = directory.path().to_path_buf();
        let starts = starts.clone();
        let count = count.clone();
        let barrier = barrier.clone();
        threads.push(std::thread::spawn(move || {
            barrier.wait();
            watch_using(
                &root,
                noise,
                move || {
                    count.fetch_add(1, Ordering::SeqCst);
                },
                move |root, noise, changed| {
                    starts.fetch_add(1, Ordering::SeqCst);
                    worker::start_silent(root, noise, changed)
                },
            )
            .unwrap()
        }));
    }
    barrier.wait();
    let subscriptions: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert_eq!(starts.load(Ordering::SeqCst), 1);
    let ids: std::collections::HashSet<_> = subscriptions.iter().map(|s| s.client.id).collect();
    assert_eq!(ids.len(), 8);
    assert_eq!(invalidate_working_tree(directory.path()), 8);
    assert_eq!(count.load(Ordering::SeqCst), 8);
    drop(subscriptions);
    assert_eq!(invalidate_working_tree(directory.path()), 0);
}

#[test]
fn a_new_subscription_after_git_init_reuses_the_pending_repository_owner() {
    let directory = tempfile::tempdir().unwrap();
    let first = subscribe(directory.path(), Arc::new(AtomicUsize::new(0)));
    let owner = Arc::downgrade(&first.client.owner.lock().unwrap());
    init(directory.path());
    let second = subscribe(directory.path(), Arc::new(AtomicUsize::new(0)));
    let second_owner = Arc::downgrade(&second.client.owner.lock().unwrap());
    assert!(Weak::ptr_eq(&owner, &second_owner));
    assert_eq!(invalidate_working_tree(directory.path()), 2);
    drop(first);
    assert_eq!(invalidate_working_tree(directory.path()), 1);
    drop(second);
    assert!(owner.upgrade().is_none());
}

#[test]
fn explicit_writes_do_not_invalidate_unrelated_repositories() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    init(first.path());
    init(second.path());
    let a = Arc::new(AtomicUsize::new(0));
    let b = Arc::new(AtomicUsize::new(0));
    let _a = subscribe(first.path(), a.clone());
    let _b = subscribe(second.path(), b.clone());
    assert_eq!(invalidate_working_tree(first.path()), 1);
    assert_eq!(a.load(Ordering::SeqCst), 1);
    assert_eq!(b.load(Ordering::SeqCst), 0);
}

#[test]
fn pending_subfolders_converge_on_one_parent_repository_without_merging_nested_repositories() {
    let directory = tempfile::tempdir().unwrap();
    let a = directory.path().join("a");
    let b = directory.path().join("b");
    let nested = directory.path().join("nested");
    for path in [&a, &b, &nested] {
        std::fs::create_dir(path).unwrap();
    }
    init(&nested);
    let a_count = Arc::new(AtomicUsize::new(0));
    let b_count = Arc::new(AtomicUsize::new(0));
    let nested_count = Arc::new(AtomicUsize::new(0));
    let first = subscribe(&a, a_count.clone());
    let second = subscribe(&b, b_count.clone());
    let independent = subscribe(&nested, nested_count.clone());
    let old_a = Arc::downgrade(&first.client.owner.lock().unwrap());
    let old_b = Arc::downgrade(&second.client.owner.lock().unwrap());
    assert!(!Weak::ptr_eq(&old_a, &old_b));
    init(directory.path());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        if Arc::ptr_eq(
            &first.client.owner.lock().unwrap(),
            &second.client.owner.lock().unwrap(),
        ) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "pending workers did not converge"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(!Arc::ptr_eq(
        &first.client.owner.lock().unwrap(),
        &independent.client.owner.lock().unwrap(),
    ));
    let before_a = a_count.load(Ordering::SeqCst);
    let before_b = b_count.load(Ordering::SeqCst);
    assert_eq!(invalidate_working_tree(directory.path()), 2);
    assert!(a_count.load(Ordering::SeqCst) > before_a);
    assert!(b_count.load(Ordering::SeqCst) > before_b);
    assert_eq!(nested_count.load(Ordering::SeqCst), 0);
    drop(first);
    assert_eq!(invalidate_working_tree(directory.path()), 1);
    drop(second);
    drop(independent);
    // A worker may still be returning from its last admitted callback.
    while old_a.upgrade().is_some() || old_b.upgrade().is_some() {
        assert!(
            std::time::Instant::now() < deadline,
            "promoted worker owners leaked"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[test]
fn linked_worktrees_receive_shared_ref_changes_and_one_closing_does_not_stop_the_other() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    init(&root);
    let command = |args: &[&str]| {
        crate::platform::git::git(&root, args, None, &AtomicBool::new(false)).unwrap()
    };
    command(&["config", "user.name", "Linked watch"]);
    command(&["config", "user.email", "linked@example.invalid"]);
    command(&["config", "commit.gpgsign", "false"]);
    std::fs::write(root.join("a.txt"), "a").unwrap();
    command(&["add", "a.txt"]);
    command(&["commit", "-qm", "initial"]);
    let destination = tempfile::tempdir().unwrap();
    let linked = destination.path().canonicalize().unwrap().join("linked");
    let linked_arg = linked.to_string_lossy();
    let linked_arg = linked_arg.strip_prefix(r"\\?\").unwrap_or(&linked_arg);
    command(&["worktree", "add", "-q", "-b", "linked", linked_arg]);
    let a = identity(&root).unwrap();
    let b = identity(&linked).unwrap();
    assert_eq!(a.common_dir, b.common_dir);
    assert_ne!(a.git_dir, b.git_dir);
    let (send_a, events_a) = std::sync::mpsc::channel();
    let (send_b, events_b) = std::sync::mpsc::channel();
    let main = watch(&root, noise, move || {
        let _ = send_a.send(());
    })
    .unwrap();
    let worktree = watch(&linked, noise, move || {
        let _ = send_b.send(());
    })
    .unwrap();
    assert!(!Arc::ptr_eq(
        &main.client.owner.lock().unwrap(),
        &worktree.client.owner.lock().unwrap()
    ));
    command(&["update-ref", "refs/remotes/origin/shared-base", "HEAD"]);
    events_a
        .recv_timeout(std::time::Duration::from_secs(8))
        .expect("main worktree did not observe the shared ref");
    events_b
        .recv_timeout(std::time::Duration::from_secs(8))
        .expect("linked worktree did not observe the shared ref");
    drop(main);
    while events_b.try_recv().is_ok() {}
    command(&["update-ref", "refs/remotes/origin/after-close", "HEAD"]);
    events_b
        .recv_timeout(std::time::Duration::from_secs(8))
        .expect("closing main stopped linked metadata delivery");
    let refs = crate::platform::git::git_read(
        &linked,
        &["rev-parse", "refs/remotes/origin/after-close"],
        None,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(refs, command(&["rev-parse", "HEAD"]));
    drop(worktree);
}

#[test]
fn stopping_waits_for_an_admitted_callback_and_rejects_later_delivery() {
    let directory = tempfile::tempdir().unwrap();
    init(directory.path());
    let (entered, started) = std::sync::mpsc::channel();
    let (release, blocked) = std::sync::mpsc::channel();
    let subscription = watch_using(
        directory.path(),
        noise,
        move || {
            entered.send(()).unwrap();
            blocked
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("test did not release the callback");
        },
        |root, noise, changed| worker::start_silent(root, noise, changed),
    )
    .unwrap();
    let root = directory.path().to_path_buf();
    let broadcast = std::thread::spawn(move || invalidate_working_tree(&root));
    started
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    let (done, stopped) = std::sync::mpsc::channel();
    let stop = std::thread::spawn(move || {
        drop(subscription);
        done.send(()).unwrap();
    });
    assert!(
        matches!(
            stopped.recv_timeout(std::time::Duration::from_millis(100)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ),
        "stop returned while the retired callback was still executing"
    );
    release.send(()).unwrap();
    stopped
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    stop.join().unwrap();
    assert_eq!(broadcast.join().unwrap(), 1);
    assert_eq!(invalidate_working_tree(directory.path()), 0);
}
