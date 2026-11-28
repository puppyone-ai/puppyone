use super::*;
use std::sync::{atomic::AtomicUsize, mpsc};
fn key(name: &str) -> Key {
    Key::new(
        "repository".into(),
        name.into(),
        "before".into(),
        "after".into(),
    )
}
fn model() -> Presentation {
    super::super::build(
        None,
        Some(&super::super::test_docx(
            "<w:p><w:r><w:t>Body</w:t></w:r></w:p>",
        )),
    )
    .unwrap()
}
fn put(cache: &Cache, name: &str) {
    cache
        .load(key(name), &AtomicBool::new(false), || Ok(model()))
        .unwrap();
}
fn hit(cache: &Cache, name: &str) -> bool {
    cache
        .load(key(name), &AtomicBool::new(false), || {
            Err("cache miss".into())
        })
        .is_ok()
}

#[test]
fn entry_and_aggregate_weight_limits_evict_the_least_recently_read_model() {
    let w = weight(&key("a"), &model());
    let cache = Cache::new(3, w * 2 + w / 2, TTL, Arc::new(Instant::now));
    put(&cache, "a");
    put(&cache, "b");
    assert!(hit(&cache, "a"));
    put(&cache, "c");
    assert!(!hit(&cache, "b"));
    assert!(hit(&cache, "a") && hit(&cache, "c"));
    assert_eq!(cache.usage(), (2, 2 * w));
    let cache = Cache::new(2, 100 * w, TTL, Arc::new(Instant::now));
    put(&cache, "a");
    put(&cache, "b");
    put(&cache, "c");
    assert!(!hit(&cache, "a") && hit(&cache, "b") && hit(&cache, "c"));
    assert_eq!(cache.usage().0, 2);
    let cache = Cache::new(8, w - 1, TTL, Arc::new(Instant::now));
    put(&cache, "a");
    assert_eq!(cache.usage(), (0, 0));
    assert_eq!(
        (MAX_ENTRIES, MAX_WEIGHT, TTL),
        (8, 24 * 1024 * 1024, Duration::from_secs(300))
    );
}

#[test]
fn expiry_reclaims_idle_models_without_reads_and_hits_do_not_extend_the_deadline() {
    let start = Instant::now();
    let now = Arc::new(Mutex::new(start));
    let clock = now.clone();
    let cache = Cache::new(
        2,
        MAX_WEIGHT,
        Duration::from_millis(50),
        Arc::new(move || *clock.lock().unwrap()),
    );
    put(&cache, "a");
    *now.lock().unwrap() = start + Duration::from_millis(49);
    assert!(hit(&cache, "a"));
    *now.lock().unwrap() = start + Duration::from_millis(50);
    let mut state = cache.shared.state.lock().unwrap();
    cache.shared.changed.notify_all();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !state.entries.is_empty() || state.running {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "expiry worker did not release idle data"
        );
        state = cache
            .shared
            .changed
            .wait_timeout(state, remaining)
            .unwrap()
            .0;
    }
    assert_eq!(state.weight, 0);
}

#[test]
fn repository_path_each_revision_and_renderer_version_separate_cache_identity() {
    let cache = Cache::default();
    put(&cache, "a");
    let base = key("a");
    let mut variants = vec![base.clone(); 5];
    variants[0].repository = "other".into();
    variants[1].path = "other".into();
    variants[2].before = "before:2".into();
    variants[3].after = "after:2".into();
    variants[4].version += 1;
    for changed in variants {
        assert!(
            cache
                .load(changed, &AtomicBool::new(false), || Err("miss".into()))
                .is_err()
        );
    }
    assert!(hit(&cache, "a"));
}

#[test]
fn successful_models_reuse_work_and_release_captured_resources_on_every_outcome() {
    struct Resource(Arc<AtomicUsize>);
    impl Drop for Resource {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    let cache = Cache::default();
    let dropped = Arc::new(AtomicUsize::new(0));
    let builds = AtomicUsize::new(0);
    for _ in 0..2 {
        let resource = Resource(dropped.clone());
        cache
            .load(key("a"), &AtomicBool::new(false), || {
                let _resource = resource;
                builds.fetch_add(1, Ordering::SeqCst);
                Ok(model())
            })
            .unwrap();
    }
    assert_eq!(builds.load(Ordering::SeqCst), 1);
    assert_eq!(dropped.load(Ordering::SeqCst), 2);
    for _ in 0..2 {
        let resource = Resource(dropped.clone());
        assert!(
            cache
                .load(key("bad"), &AtomicBool::new(false), || {
                    let _resource = resource;
                    builds.fetch_add(1, Ordering::SeqCst);
                    Err("bad package".into())
                })
                .is_err()
        );
    }
    assert_eq!(builds.load(Ordering::SeqCst), 3);
    assert_eq!(dropped.load(Ordering::SeqCst), 4);
    assert_eq!(cache.usage().0, 1);
    let resource = Resource(dropped.clone());
    assert!(
        cache
            .load(key("a"), &AtomicBool::new(true), || {
                let _resource = resource;
                panic!("cancelled cache hit cannot build")
            })
            .is_err()
    );
    assert_eq!(dropped.load(Ordering::SeqCst), 5);
    let cancel = AtomicBool::new(false);
    assert!(
        cache
            .load(key("late-cancel"), &cancel, || {
                cancel.store(true, Ordering::Release);
                Ok(model())
            })
            .is_err()
    );
    assert_eq!(cache.usage().0, 1);
}

#[test]
fn retiring_a_workspace_fences_inflight_and_later_cache_writes() {
    let cache = Arc::new(Cache::default());
    put(&cache, "a");
    let (entered, started) = mpsc::sync_channel(1);
    let (release, wait) = mpsc::sync_channel(1);
    let worker_cache = cache.clone();
    let worker = std::thread::spawn(move || {
        worker_cache.load(key("pending"), &AtomicBool::new(false), || {
            entered.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
            Ok(model())
        })
    });
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    cache.invalidate();
    assert_eq!(cache.usage(), (0, 0));
    release.send(()).unwrap();
    worker.join().unwrap().unwrap();
    put(&cache, "late");
    assert_eq!(cache.usage(), (0, 0));
    let fresh = Cache::default();
    put(&fresh, "a");
    assert_eq!(fresh.usage().0, 1);
}
