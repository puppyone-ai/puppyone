#![cfg(test)]
use super::*;

fn content(root: &Path, budget: u64) -> PreparedContent {
    Content {
        root: Some(root.into()),
        source: None,
        entry: Entry::Html("<p>fixture</p>".into()),
        max_bytes: budget,
        assets: vec![],
        ipc: None,
        policy: None,
        frames: None,
        disk_assets: None,
        locked: true,
    }
    .prepare()
}

#[test]
fn byte_ranges_match_executed_typescript_including_safe_integers_and_whitespace() {
    use super::range::ByteRange;
    let oracle: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/byte-range-oracle.json")).unwrap();
    let cases = oracle["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 480);
    for case in cases {
        let actual = ByteRange::parse(case["header"].as_str(), case["size"].as_u64().unwrap());
        let expected = &case["expected"];
        let expected = if expected.is_null() {
            ByteRange::Whole
        } else if expected["unsatisfiable"] == true {
            ByteRange::Unsatisfiable
        } else {
            ByteRange::Part {
                start: expected["start"].as_u64().unwrap(),
                end: expected["end"].as_u64().unwrap(),
            }
        };
        assert_eq!(actual, expected, "{case}");
    }
}

#[test]
fn native_protocol_ranges_head_and_unsatisfiable_requests_use_opened_file_metadata() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("clip.mp4"), b"abcdefghijklmnopqrstuvwxyz").unwrap();
    std::fs::write(root.path().join("empty.mp4"), b"").unwrap();
    let served = content(root.path(), 26);
    let url = local_url_for("clip.mp4");
    for (range, expected, content_range) in [
        ("bytes=2-5", &b"cdef"[..], "bytes 2-5/26"),
        ("bytes=23-", &b"xyz"[..], "bytes 23-25/26"),
        ("bytes=-3", &b"xyz"[..], "bytes 23-25/26"),
        ("bytes=24-100", &b"yz"[..], "bytes 24-25/26"),
        ("bytes=0-0", &b"a"[..], "bytes 0-0/26"),
    ] {
        let reply = respond_request(&served, true, "GET", &url, Some(ENTRY_ORIGIN), Some(range));
        assert_eq!(reply.status, 206, "{range}");
        assert_eq!(reply.body, expected);
        assert_eq!(reply.length, Some(expected.len() as u64));
        assert_eq!(reply.content_range.as_deref(), Some(content_range));
        assert_eq!(reply.mime, "video/mp4");
        assert!(reply.accept_ranges && reply.cors);
    }
    for range in [
        "bytes=26-",
        "bytes=9-2",
        "bytes=-0",
        "items=2-4",
        "bytes=0-1,3-4",
    ] {
        let reply = respond_request(&served, true, "GET", &url, None, Some(range));
        assert_eq!(reply.status, 416, "{range}");
        assert!(reply.body.is_empty());
        assert_eq!(reply.content_range.as_deref(), Some("bytes */26"));
    }
    let head = respond_request(&served, true, "HEAD", &url, None, Some("invalid"));
    assert_eq!(
        (head.status, head.length, head.body.len()),
        (200, Some(26), 0)
    );
    assert!(head.content_range.is_none());
    let empty = respond_request(
        &served,
        true,
        "GET",
        &local_url_for("empty.mp4"),
        None,
        Some("bytes=0-0"),
    );
    assert_eq!(empty.status, 416);
    assert_eq!(empty.content_range.as_deref(), Some("bytes */0"));
    let whole = respond_request(&served, true, "GET", &url, None, None);
    assert_eq!((whole.status, whole.length), (200, Some(26)));
    assert_eq!(whole.body, b"abcdefghijklmnopqrstuvwxyz");
    let limited = content(root.path(), 4);
    assert_eq!(
        respond_request(&limited, true, "GET", &url, None, None).status,
        413
    );
    assert_eq!(
        respond_request(&limited, true, "GET", &url, None, Some("bytes=2-5")).body,
        b"cdef"
    );
    assert_eq!(
        respond_request(&limited, true, "GET", &url, None, Some("bytes=2-6")).status,
        413
    );
    assert_eq!(
        respond_request(&limited, true, "HEAD", &url, None, None).length,
        Some(26)
    );
}

#[test]
fn protocol_rejects_foreign_origins_methods_and_lookalike_urls_before_provider_reads() {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    struct Counting(Arc<AtomicUsize>);
    impl ResourceSource for Counting {
        fn read(&self, _: &Path) -> Option<Vec<u8>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Some(b"snapshot".to_vec())
        }
        fn size(&self, _: &Path) -> Option<u64> {
            Some(8)
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let root = tempfile::tempdir().unwrap();
    let mut config = content(root.path(), 64).content;
    config.root = None;
    config.source = Some(Source(Arc::new(Counting(calls.clone()))));
    let served = config.prepare();
    let url = local_url_for("clip.mp4");
    for origin in [
        "https://attacker.test",
        "null",
        "puppyone-preview://local.attacker.test",
        "puppyone-preview://local/",
        "\0",
    ] {
        for method in ["GET", "HEAD", "OPTIONS"] {
            assert_eq!(
                respond_request(&served, true, method, &url, Some(origin), None).status,
                403
            );
        }
    }
    for method in ["POST", "PUT", "DELETE", "PATCH", "get"] {
        assert_eq!(
            respond_request(&served, true, method, &url, Some(ENTRY_ORIGIN), None).status,
            405
        );
    }
    for bad in [
        "puppyone-localish://local/clip.mp4",
        "puppyone-local://local.attacker/clip.mp4",
        "puppyone-local://local:90/clip.mp4",
        "puppyone-local://user@local/clip.mp4",
        "puppyone-local://local/clip.mp4?token=x",
        "puppyone-preview://local/clip.mp4",
    ] {
        assert_eq!(
            respond_request(&served, true, "GET", bad, None, None).status,
            403,
            "{bad}"
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    for path in [
        "%00",
        "%ff",
        "%zz",
        "..%2Fsecret",
        "%2Fsecret",
        "folder%5Csecret",
    ] {
        let uri = format!("{LOCAL_SCHEME}://local/{path}");
        assert_eq!(
            respond_request(&served, true, "GET", &uri, None, None).status,
            404,
            "{path}"
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let head = respond_request(&served, true, "HEAD", &url, Some(ENTRY_ORIGIN), None);
    assert_eq!(
        (head.status, head.length, head.body.len()),
        (200, Some(8), 0)
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let get = respond_request(
        &served,
        true,
        "GET",
        &format!("{url}#page=2"),
        Some(ENTRY_ORIGIN),
        Some("bytes=1-3"),
    );
    assert_eq!((get.status, get.body), (206, b"nap".to_vec()));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    served.revoke();
    assert_eq!(
        respond_request(&served, true, "HEAD", &url, None, None).status,
        403
    );
}

#[test]
fn bounded_file_streams_are_lazy_owned_and_stop_at_admitted_end_or_revocation() {
    use std::io::{Read, Write};
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("large.mp4");
    let mut writer = std::fs::File::create(&path).unwrap();
    writer.write_all(b"0123456789").unwrap();
    writer.set_len(512 * 1024 * 1024).unwrap();
    let root = files::LocalRoot::open(temp.path()).unwrap();
    let live = Arc::new(AtomicBool::new(true));
    let mut stream = root
        .file(Path::new("large.mp4"))
        .unwrap()
        .stream(2, 4, live.clone())
        .unwrap();
    let mut first = [0; 2];
    assert_eq!(stream.read(&mut first).unwrap(), 2);
    assert_eq!(&first, b"23");
    let mut rest = Vec::new();
    stream.read_to_end(&mut rest).unwrap();
    assert_eq!(rest, b"45");
    let mut large = root
        .file(Path::new("large.mp4"))
        .unwrap()
        .stream(0, 512 * 1024 * 1024, live.clone())
        .unwrap();
    let mut chunk = [0; 64 * 1024];
    assert_eq!(large.read(&mut chunk).unwrap(), chunk.len());
    live.store(false, Ordering::Release);
    assert_eq!(
        large.read(&mut chunk).unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );
    drop(large);
    std::fs::write(&path, b"initial").unwrap();
    live.store(true, Ordering::Release);
    let mut stream = root
        .file(Path::new("large.mp4"))
        .unwrap()
        .stream(0, 7, live)
        .unwrap();
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"appended")
        .unwrap();
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"initial");
}

#[test]
fn protocol_revocation_during_a_worker_read_discards_the_late_response() {
    use std::sync::{Arc, Mutex, mpsc};
    use std::time::Duration;
    struct Pending {
        started: mpsc::Sender<()>,
        finish: Mutex<mpsc::Receiver<()>>,
    }
    impl ResourceSource for Pending {
        fn read(&self, _: &Path) -> Option<Vec<u8>> {
            self.started.send(()).unwrap();
            self.finish
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
            Some(b"retired projection".to_vec())
        }
    }
    let temp = tempfile::tempdir().unwrap();
    let mut config = content(temp.path(), 64).content;
    config.root = None;
    let (started_tx, started_rx) = mpsc::channel();
    let (finish_tx, finish_rx) = mpsc::channel();
    config.source = Some(Source(Arc::new(Pending {
        started: started_tx,
        finish: Mutex::new(finish_rx),
    })));
    let host = config.prepare();
    let pending = host.clone();
    let worker = std::thread::spawn(move || {
        respond_request(
            &pending,
            true,
            "GET",
            &local_url_for("document.html"),
            Some(ENTRY_ORIGIN),
            None,
        )
    });
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    host.revoke();
    finish_tx.send(()).unwrap();
    let reply = worker.join().unwrap();
    assert_eq!(reply.status, 403);
    assert_eq!(reply.body, b"Forbidden");
}

#[cfg(unix)]
#[test]
fn local_protocol_refuses_internal_leaf_and_parent_links() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("real")).unwrap();
    std::fs::write(root.path().join("real/data.txt"), b"private").unwrap();
    std::os::unix::fs::symlink("real/data.txt", root.path().join("alias.txt")).unwrap();
    std::os::unix::fs::symlink("real", root.path().join("alias")).unwrap();
    let served = content(root.path(), 64);
    assert_eq!(respond_local(&served, "/alias.txt").0, 404);
    assert_eq!(respond_local(&served, "/alias/data.txt").0, 404);
    assert_eq!(respond_local(&served, "/real/data.txt").2, b"private");
}

#[test]
fn protocol_roots_remain_bound_when_the_original_path_is_replaced() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("project");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("data.txt"), b"original").unwrap();
    let served = content(&root, 64);
    std::fs::rename(&root, temp.path().join("moved")).unwrap();
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("data.txt"), b"replacement").unwrap();
    assert_eq!(respond_local(&served, "/data.txt").2, b"original");
    assert_eq!(probe_local(&served, "/data.txt"), Some((8, b"o".to_vec())));
    let missing = content(&temp.path().join("missing"), 64);
    std::fs::create_dir(temp.path().join("missing")).unwrap();
    std::fs::write(temp.path().join("missing/data.txt"), b"late authority").unwrap();
    assert_eq!(respond_local(&missing, "/data.txt").0, 404);
}

#[test]
fn protocol_display_aliases_are_unique_and_exact_names_remain_authoritative() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("assets")).unwrap();
    std::fs::write(
        root.path().join("assets/Screenshot 10.25.51\u{202f}PM.png"),
        b"narrow",
    )
    .unwrap();
    std::fs::write(root.path().join("assets/exact name.txt"), b"exact").unwrap();
    std::fs::write(root.path().join("assets/exact\u{202f}name.txt"), b"other").unwrap();
    let served = content(root.path(), 64);
    assert_eq!(
        respond_local(&served, "/assets/Screenshot%2010.25.51%20PM.png").2,
        b"narrow"
    );
    assert_eq!(
        respond_local(&served, "/assets/exact%20name.txt").2,
        b"exact"
    );
    assert_eq!(
        respond_local(&served, "/assets/exact%E2%80%AFname.txt").2,
        b"other"
    );
    assert_eq!(
        respond_local(&served, "/assets/exact%E2%80%89name.txt").0,
        404
    );
    std::fs::create_dir(root.path().join("folder\u{00a0}name")).unwrap();
    std::fs::write(root.path().join("folder\u{00a0}name/café.txt"), b"unicode").unwrap();
    assert_eq!(
        respond_local(&served, "/folder%20name/cafe%CC%81.txt").2,
        b"unicode"
    );
}

#[test]
fn protocol_paths_are_decoded_once_and_reads_obey_actual_byte_budgets() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("literal%2e%2e.txt"), b"literal").unwrap();
    std::fs::write(root.path().join("data.txt"), b"data").unwrap();
    std::fs::write(root.path().join("empty.txt"), b"").unwrap();
    let served = content(root.path(), 4);
    for path in [
        "/%",
        "/%zz",
        "/%ff",
        "/%00",
        "/../data.txt",
        "/%2e%2e/data.txt",
        "/folder/%2e%2e/data.txt",
        "/__entry__",
        "/__assets__/x",
    ] {
        assert_eq!(respond_local(&served, path).0, 404, "{path}");
    }
    assert_eq!(respond_local(&served, "/data.txt").2, b"data");
    std::fs::write(root.path().join("data.txt"), b"larger").unwrap();
    assert_eq!(respond_local(&served, "/data.txt").0, 413);
    assert_eq!(probe_local(&served, "/data.txt"), Some((6, b"l".to_vec())));
    let unlimited = content(root.path(), u64::MAX);
    assert_eq!(
        respond_local(&unlimited, "/literal%252e%252e.txt").2,
        b"literal"
    );
    assert_eq!(respond_local(&content(root.path(), 0), "/empty.txt").0, 200);
    assert_eq!(probe_local(&served, "/empty.txt"), None);
}

#[test]
fn protocol_revocation_fences_cached_clones_and_in_flight_provider_replies() {
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    };
    struct SourceWithRevocation {
        during_read: Mutex<Option<PreparedContent>>,
        calls: AtomicUsize,
    }
    impl ResourceSource for SourceWithRevocation {
        fn read(&self, _: &Path) -> Option<Vec<u8>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.during_read.lock().unwrap().take().unwrap().revoke();
            Some(b"late bytes".to_vec())
        }
    }
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("data.txt"), b"data").unwrap();
    let served = content(root.path(), 64);
    let clone = served.clone();
    served.revoke();
    assert_eq!(respond_local(&clone, "/data.txt").0, 403);
    assert_eq!(respond(&clone, "/__entry__").0, 403);
    assert_eq!(probe_local(&clone, "/data.txt"), None);
    let source = Arc::new(SourceWithRevocation {
        during_read: Mutex::new(None),
        calls: AtomicUsize::new(0),
    });
    let mut spec = (*content(root.path(), 64)).clone();
    spec.root = None;
    spec.source = Some(Source(source.clone()));
    let hosted = spec.prepare();
    *source.during_read.lock().unwrap() = Some(hosted.clone());
    let result = respond_local(&hosted, "/data.txt");
    assert_eq!(result.0, 403);
    assert!(
        !result
            .2
            .windows(b"late bytes".len())
            .any(|w| w == b"late bytes")
    );
    assert_eq!(respond_local(&hosted, "/data.txt").0, 403);
    assert_eq!(source.calls.load(Ordering::SeqCst), 1);
}

#[cfg(unix)]
#[test]
fn opened_resources_never_reopen_paths_and_budget_growth_remains_bounded() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("data.txt"), b"data").unwrap();
    std::fs::write(root.path().join("other.txt"), b"outside the request").unwrap();
    let files = files::LocalRoot::open(root.path()).unwrap();
    let opened = files.file(Path::new("data.txt")).unwrap();
    std::fs::rename(
        root.path().join("data.txt"),
        root.path().join("original.txt"),
    )
    .unwrap();
    std::os::unix::fs::symlink("other.txt", root.path().join("data.txt")).unwrap();
    assert_eq!(opened.read_bounded(4).unwrap(), b"data");
    let growing = files.file(Path::new("original.txt")).unwrap();
    std::fs::write(root.path().join("original.txt"), b"now larger").unwrap();
    assert_eq!(
        growing.read_bounded(4).unwrap_err().kind(),
        std::io::ErrorKind::FileTooLarge
    );
    let sparse = std::fs::File::create(root.path().join("sparse.bin")).unwrap();
    sparse.set_len(4 * 1024 * 1024 * 1024).unwrap();
    let served = content(root.path(), 64);
    assert_eq!(respond_local(&served, "/sparse.bin").0, 413);
    assert_eq!(
        probe_local(&served, "/sparse.bin"),
        Some((4 * 1024 * 1024 * 1024, vec![0]))
    );
}

#[test]
fn provider_authority_is_rechecked_after_read_and_through_budgeted_sources() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    };
    struct RetiringSource {
        live: AtomicBool,
        reads: AtomicUsize,
    }
    impl ResourceSource for RetiringSource {
        fn is_live(&self) -> bool {
            self.live.load(Ordering::Acquire)
        }
        fn read(&self, _: &Path) -> Option<Vec<u8>> {
            self.reads.fetch_add(1, Ordering::Relaxed);
            self.live.store(false, Ordering::Release);
            Some(b"retired body".to_vec())
        }
    }
    let root = tempfile::tempdir().unwrap();
    let source = Arc::new(RetiringSource {
        live: AtomicBool::new(true),
        reads: AtomicUsize::new(0),
    });
    let mut spec = (*content(root.path(), 64)).clone();
    spec.root = None;
    spec.source = Some(Source(Arc::new(Budgeted::new(
        Source(source.clone()),
        1,
        64,
    ))));
    let prepared = spec.prepare();
    let reply = respond_request(
        &prepared,
        true,
        "GET",
        &local_url_for("file.txt"),
        None,
        None,
    );
    assert_eq!(reply.status, 403);
    assert!(!reply.body.windows(12).any(|b| b == b"retired body"));
    assert_eq!(
        respond_request(
            &prepared,
            true,
            "GET",
            &local_url_for("file.txt"),
            None,
            None
        )
        .status,
        403
    );
    assert_eq!(
        respond_request(&prepared, false, "GET", &entry_url(), None, None).status,
        403
    );
    assert_eq!(source.reads.load(Ordering::Relaxed), 1);
}
