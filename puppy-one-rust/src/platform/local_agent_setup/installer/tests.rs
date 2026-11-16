use super::*;
use core::prelude::v1::test;
/// A gzip tarball of `(path, contents, mode)`; `None` contents is a directory.
fn archive(path: &Path, entries: &[(&str, Option<&str>, u32)]) {
    let file = std::fs::File::create(path).unwrap();
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        file,
        flate2::Compression::fast(),
    ));
    for (name, contents, mode) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_mode(*mode);
        // Raw name bytes: `set_path` refuses the hostile names under test.
        let raw = &mut header.as_gnu_mut().unwrap().name;
        raw[..name.len()].copy_from_slice(name.as_bytes());
        let data = contents.unwrap_or("");
        header.set_entry_type(if contents.is_some() {
            tar::EntryType::Regular
        } else {
            tar::EntryType::Directory
        });
        header.set_size(data.len() as u64);
        header.set_cksum();
        builder.append(&header, data.as_bytes()).unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap();
}
fn recipe(archive: &Path) -> Recipe {
    Recipe {
        setup_id: "codex",
        version: "1.2.3",
        entry: "codex",
        binary: "vendor/bin/codex".into(),
        url: "https://registry.npmjs.org/codex.tgz".into(),
        algorithm: Algorithm::Sha512,
        digest: Box::leak(file_digest(archive, Algorithm::Sha512).into_boxed_str()),
    }
}
fn installer(home: &Path, source: PathBuf) -> Installer {
    Installer {
        home: home.into(),
        download: Arc::new(move |_, destination, _| {
            std::fs::copy(&source, destination)
                .map(|_| ())
                .map_err(|_| ErrorCode::Download)
        }),
    }
}
#[test]
fn a_verified_archive_becomes_the_current_installation() {
    let dir = tempfile::tempdir().unwrap();
    let home = std::fs::canonicalize(dir.path()).unwrap();
    let fixture = tempfile::tempdir().unwrap();
    let source = fixture.path().join("codex.tgz");
    archive(
        &source,
        &[
            ("package/", None, 0o755),
            ("package/vendor/", None, 0o755),
            ("package/vendor/bin/", None, 0o755),
            (
                "package/vendor/bin/codex",
                Some(
                    "#!/bin/sh\n[ \"$#\" -eq 1 ] && [ \"$1\" = --version ] || exit 7\necho codex 1.2.3\n",
                ),
                0o644,
            ),
            ("package/README.md", Some("readme"), 0o644),
        ],
    );
    let recipe = recipe(&source);
    let downloads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = downloads.clone();
    let mut installer = installer(&home, source.clone());
    let download = installer.download.clone();
    installer.download = Arc::new(move |recipe, destination, signal| {
        count.fetch_add(1, Ordering::SeqCst);
        download(recipe, destination, signal)
    });
    let cancel = AtomicBool::new(false);
    let verified = std::cell::RefCell::new(vec![]);
    let verify = |p: &Path, signal: &AtomicBool| {
        verified.borrow_mut().push(p.to_path_buf());
        verify_version(p, &home, signal)
    };
    let commits = std::cell::Cell::new(0);
    let entry = installer
        .install(&recipe, &cancel, &verify, &|| {
            commits.set(commits.get() + 1)
        })
        .unwrap();
    let root = home.join(".puppyone/agent-runtimes/codex");
    assert_eq!(entry, root.join("current/codex"));
    assert_eq!(managed_entry(&home, "codex"), Some(entry.clone()));
    assert_eq!(
        std::fs::read_link(root.join("current")).unwrap(),
        PathBuf::from("1.2.3")
    );
    assert_eq!(
        std::fs::read_link(root.join("1.2.3/codex")).unwrap(),
        PathBuf::from("vendor/bin/codex")
    );
    let receipt: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("1.2.3/installation.json")).unwrap())
            .unwrap();
    assert_eq!(receipt["digest"], recipe.digest);
    assert_eq!(commits.get(), 1);
    assert_eq!(verified.borrow().len(), 1);
    assert!(!root.join("install.lock").exists());
    // No staging is left behind; a second run reuses the version.
    let names: Vec<_> = std::fs::read_dir(&root)
        .unwrap()
        .flatten()
        .map(|e| e.file_name())
        .collect();
    assert_eq!(names.len(), 2, "{names:?}");
    installer
        .install(&recipe, &cancel, &verify, &|| {
            commits.set(commits.get() + 1)
        })
        .unwrap();
    assert_eq!(verified.borrow().len(), 2);
    assert_eq!(commits.get(), 2);
    assert_eq!(downloads.load(Ordering::SeqCst), 1);
    let home_names: Vec<_> = std::fs::read_dir(&home)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(home_names, [std::ffi::OsString::from(".puppyone")]);
    // A receipt for another artifact is not trusted.
    let other = Recipe {
        digest: "AAAA",
        ..recipe.clone()
    };
    assert_eq!(
        installer.install(&other, &cancel, &verify, &|| {}),
        Err(ErrorCode::Integrity)
    );
    // Another installation holds the lease.
    std::fs::create_dir(root.join("install.lock")).unwrap();
    assert_eq!(
        installer.install(&recipe, &cancel, &verify, &|| {}),
        Err(ErrorCode::InstallationBusy)
    );
}
#[test]
fn invalid_staged_executables_never_commit_or_leave_installation_residue() {
    for script in [
        "#!/bin/sh\necho token=fixture-secret >&2\nexit 1\n",
        "#!/bin/sh\nexit 0\n",
    ] {
        let home = tempfile::tempdir().unwrap();
        let fixture = tempfile::tempdir().unwrap();
        let source = fixture.path().join("fixture.tgz");
        archive(
            &source,
            &[("package/vendor/bin/codex", Some(script), 0o755)],
        );
        let recipe = recipe(&source);
        let installer = installer(home.path(), source);
        let commits = std::cell::Cell::new(0);
        let cancelled = AtomicBool::new(false);
        assert_eq!(
            installer.install(
                &recipe,
                &cancelled,
                &|file, signal| verify_version(file, home.path(), signal),
                &|| commits.set(commits.get() + 1)
            ),
            Err(ErrorCode::Installation)
        );
        assert_eq!(commits.get(), 0);
        let root = home.path().join(".puppyone/agent-runtimes/codex");
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
        assert!(std::fs::symlink_metadata(managed_entry(home.path(), "codex").unwrap()).is_err());
    }
}
#[test]
fn unsafe_archives_are_rejected_before_anything_is_written() {
    let dir = tempfile::tempdir().unwrap();
    let cases: [&[(&str, Option<&str>, u32)]; 4] = [
        &[
            ("package/", None, 0o755),
            ("package/../evil", Some("x"), 0o644),
        ],
        &[
            ("package/a", Some("x"), 0o644),
            ("other/b", Some("x"), 0o644),
        ],
        &[("file-at-root", Some("x"), 0o644)],
        &[
            ("package/a", Some("x"), 0o644),
            ("package/a", Some("y"), 0o644),
        ],
    ];
    for (i, entries) in cases.iter().enumerate() {
        let path = dir.path().join(format!("{i}.tgz"));
        archive(&path, entries);
        let out = dir.path().join(format!("out-{i}"));
        std::fs::create_dir(&out).unwrap();
        assert_eq!(
            extract(&path, &out, &AtomicBool::new(false)),
            Err(ErrorCode::Archive),
            "case {i}"
        );
        assert_eq!(std::fs::read_dir(&out).unwrap().count(), 0, "case {i}");
    }
    // A symlink member.
    let path = dir.path().join("link.tgz");
    let file = std::fs::File::create(&path).unwrap();
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        file,
        flate2::Compression::fast(),
    ));
    let mut valid = tar::Header::new_gnu();
    valid.set_size(7);
    valid.set_mode(0o644);
    valid.set_cksum();
    builder
        .append_data(&mut valid, "package/codex", b"fixture".as_slice())
        .unwrap();
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Symlink);
    header.set_size(0);
    builder
        .append_link(&mut header, "package/link", "/etc/passwd")
        .unwrap();
    builder.into_inner().unwrap().finish().unwrap();
    let output = dir.path().join("link-output");
    std::fs::create_dir(&output).unwrap();
    assert_eq!(
        extract(&path, &output, &AtomicBool::new(false)),
        Err(ErrorCode::Archive)
    );
    assert_eq!(std::fs::read_dir(output).unwrap().count(), 0);
    // Cancelled work stops.
    let ok = dir.path().join("ok.tgz");
    archive(&ok, &[("package/a", Some("x"), 0o644)]);
    assert_eq!(
        extract(&ok, dir.path(), &AtomicBool::new(true)),
        Err(ErrorCode::Interrupted)
    );
}
#[test]
fn only_reviewed_https_hosts_and_safe_processes_are_used() {
    assert!(allowed_url("https://registry.npmjs.org/@openai/codex/-/codex.tgz").is_some());
    assert!(allowed_url("http://registry.npmjs.org/x").is_none());
    assert!(allowed_url("https://registry.npmjs.org:8443/x").is_none());
    assert!(allowed_url("https://user@downloads.cursor.com/x").is_none());
    assert!(allowed_url("https://example.com/x").is_none());
    assert!(unsafe_variable("DYLD_INSERT_LIBRARIES") && unsafe_variable("node_options"));
    assert!(!unsafe_variable("PATH"));
    let dir = tempfile::tempdir().unwrap();
    let script = |name: &str, body: &str| {
        let path = dir.path().join(name);
        std::fs::write(&path, body).unwrap();
        private(&path, 0o755);
        path
    };
    let silent = script("silent", "#!/bin/sh\nexit 0\n");
    assert_eq!(
        verify_version(&silent, dir.path(), &AtomicBool::new(false)),
        Err(ErrorCode::Installation)
    );
    let fails = script("fails", "#!/bin/sh\necho no >&2\nexit 3\n");
    assert_eq!(
        verify_version(&fails, dir.path(), &AtomicBool::new(false)),
        Err(ErrorCode::Installation)
    );
    let ok = script("ok", "#!/bin/sh\necho \"v1 $NODE_OPTIONS\"\n");
    assert_eq!(
        verify_version(&ok, dir.path(), &AtomicBool::new(false)),
        Ok(())
    );
    assert!(managed_root(dir.path(), "claude").is_none());
}
#[test]
fn the_product_installer_refuses_unreviewed_sources_without_a_request() {
    let dir = tempfile::tempdir().unwrap();
    let home = std::fs::canonicalize(dir.path()).unwrap();
    let installer = Installer::new(home.clone());
    let recipe = Recipe {
        setup_id: "codex",
        version: "1.0.0",
        entry: "codex",
        binary: "codex".into(),
        url: "https://example.com/codex.tgz".into(),
        algorithm: Algorithm::Sha256,
        digest: "AAAA",
    };
    let cancel = AtomicBool::new(false);
    let never = |_: &Path, _: &AtomicBool| -> Result<(), ErrorCode> { panic!("nothing to verify") };
    assert_eq!(
        installer.install(&recipe, &cancel, &never, &|| {}),
        Err(ErrorCode::Integrity)
    );
    for url in [
        "http://registry.npmjs.org/x",
        "https://evil.example/x",
        "https://user@registry.npmjs.org/x",
        "https://registry.npmjs.org:8443/x",
    ] {
        let untrusted = Recipe {
            url: url.into(),
            ..recipe.clone()
        };
        assert_eq!(
            download(&untrusted, &home.join("a.tgz"), &cancel),
            Err(ErrorCode::Integrity)
        );
        assert!(!home.join("a.tgz").exists());
    }
    let guided = Recipe {
        setup_id: "claude",
        ..recipe
    };
    assert_eq!(
        installer.install(&guided, &cancel, &never, &|| {}),
        Err(ErrorCode::Unsupported)
    );
}

#[test]
fn cancellation_still_reaps_descendants_after_the_version_parent_has_exited() {
    use std::{sync::mpsc, time::Instant};
    let dir = tempfile::tempdir().unwrap();
    let home = std::fs::canonicalize(dir.path()).unwrap();
    let script = home.join("forking-version");
    std::fs::write(&script,"#!/bin/sh\n/bin/sleep 30 &\nprintf '%s %s' \"$$\" \"$!\" > worker.pid\necho fixture-version\nexit 0\n").unwrap();
    private(&script, 0o755);
    let cancel = Arc::new(AtomicBool::new(false));
    let worker_cancel = cancel.clone();
    let worker_home = home.clone();
    let (sent, received) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let _ = sent.send(verify_version(&script, &worker_home, &worker_cancel));
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    let parent = loop {
        if let Ok(text) = std::fs::read_to_string(home.join("worker.pid"))
            && let Some(pid) = text
                .split_whitespace()
                .next()
                .and_then(|s| s.parse::<i32>().ok())
        {
            break pid;
        }
        assert!(Instant::now() < deadline, "version fixture never started");
        std::thread::sleep(Duration::from_millis(5));
    };
    // Wait for the actual parent to be reaped. Its child still owns the pipes.
    while unsafe { libc::kill(parent, 0) } == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    cancel.store(true, Ordering::SeqCst);
    let acknowledged = received.recv_timeout(Duration::from_secs(2));
    // Always clean up the group created by verify_version, including on RED.
    unsafe {
        libc::kill(-parent, libc::SIGKILL);
    }
    worker.join().unwrap();
    assert_eq!(acknowledged.unwrap(), Err(ErrorCode::Interrupted));
}

#[test]
fn real_version_processes_enforce_time_output_environment_and_pre_cancel_limits() {
    let dir = tempfile::tempdir().unwrap();
    let home = std::fs::canonicalize(dir.path()).unwrap();
    let script = |name: &str, body: &str| {
        let file = home.join(name);
        std::fs::write(&file, body).unwrap();
        private(&file, 0o755);
        file
    };
    let clean = script(
        "clean",
        "#!/bin/sh\n[ \"$#\" -eq 1 ] && [ \"$1\" = --version ] || exit 7\n[ \"$PATH\" = /bin ] || exit 8\n[ -z \"$NODE_OPTIONS$NODE_PATH$BUN_OPTIONS$ELECTRON_RUN_AS_NODE$DYLD_INSERT_LIBRARIES$LD_PRELOAD$LD_LIBRARY_PATH\" ] || exit 9\necho version\n",
    );
    let environment: Vec<_> = [
        "NODE_OPTIONS",
        "NODE_PATH",
        "BUN_OPTIONS",
        "ELECTRON_RUN_AS_NODE",
        "DYLD_INSERT_LIBRARIES",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
    ]
    .into_iter()
    .map(|key| (key.into(), "fixture-injection".into()))
    .chain(std::iter::once(("PATH".into(), "/bin".into())))
    .collect();
    assert_eq!(
        run_version(
            &clean,
            &home,
            &AtomicBool::new(false),
            Duration::from_secs(20),
            environment
        ),
        Ok(())
    );
    let hanging = script("hang", "#!/bin/sh\nexec /bin/sleep 30\n");
    assert_eq!(
        run_version(
            &hanging,
            &home,
            &AtomicBool::new(false),
            Duration::from_millis(50),
            []
        ),
        Err(ErrorCode::Timeout)
    );
    let noisy = script(
        "noisy",
        "#!/bin/sh\n/bin/dd if=/dev/zero bs=1024 count=513 2>/dev/null\n",
    );
    assert_eq!(
        verify_version(&noisy, &home, &AtomicBool::new(false)),
        Err(ErrorCode::Process)
    );
    let forbidden = script("forbidden", "#!/bin/sh\ntouch started\necho version\n");
    assert_eq!(
        verify_version(&forbidden, &home, &AtomicBool::new(true)),
        Err(ErrorCode::Interrupted)
    );
    assert!(!home.join("started").exists());
    assert_eq!(
        verify_version(Path::new("relative"), &home, &AtomicBool::new(false)),
        Err(ErrorCode::Process)
    );
}

#[test]
fn losing_the_installation_lease_stops_a_real_staged_version_process() {
    use std::{sync::mpsc, time::Instant};
    let dir = tempfile::tempdir().unwrap();
    let home = std::fs::canonicalize(dir.path()).unwrap();
    let fixtures = tempfile::tempdir().unwrap();
    let source = fixtures.path().join("fixture.tgz");
    archive(
        &source,
        &[(
            "package/vendor/bin/codex",
            Some("#!/bin/sh\necho ready > verifying\nexec /bin/sleep 30\n"),
            0o755,
        )],
    );
    let recipe = recipe(&source);
    let installer = installer(&home, source);
    let cancel = Arc::new(AtomicBool::new(false));
    let worker_cancel = cancel.clone();
    let worker_home = home.clone();
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let result = installer.install(
            &recipe,
            &worker_cancel,
            &|file, signal| verify_version(file, &worker_home, signal),
            &|| panic!("lost lease must never commit"),
        );
        let _ = tx.send(result);
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    while !home.join("verifying").exists() {
        assert!(Instant::now() < deadline, "staged process did not start");
        std::thread::sleep(Duration::from_millis(5));
    }
    let root = home.join(".puppyone/agent-runtimes/codex");
    std::fs::remove_dir(root.join("install.lock")).unwrap();
    let result = rx.recv_timeout(Duration::from_secs(7));
    // Ensure failure also reaps the fixture instead of abandoning a child.
    cancel.store(true, Ordering::SeqCst);
    worker.join().unwrap();
    assert_eq!(result.unwrap(), Err(ErrorCode::InstallationBusy));
    assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
}

#[test]
fn a_replaced_installation_lease_is_never_removed_by_its_previous_owner() {
    let dir = tempfile::tempdir().unwrap();
    let lease = Lease::acquire(dir.path()).unwrap();
    let path = dir.path().join("install.lock");
    std::fs::rename(&path, dir.path().join("previous.lock")).unwrap();
    std::fs::create_dir(&path).unwrap();
    drop(lease);
    assert!(
        path.is_dir(),
        "dropping the old lease removed a different installer's lock"
    );
}

#[test]
fn every_typescript_unsafe_archive_path_is_rejected_before_extracting_a_valid_member() {
    let dir = tempfile::tempdir().unwrap();
    for (i, member) in [
        "package/../../escape",
        "/absolute",
        "package\\escape",
        "package/../escape",
        "package/file:stream",
    ]
    .iter()
    .enumerate()
    {
        let source = dir.path().join(format!("unsafe-{i}.tgz"));
        archive(
            &source,
            &[
                ("package/safe", Some("not written"), 0o644),
                (member, Some("bad"), 0o644),
            ],
        );
        let output = dir.path().join(format!("output-{i}"));
        std::fs::create_dir(&output).unwrap();
        assert_eq!(
            extract(&source, &output, &AtomicBool::new(false)),
            Err(ErrorCode::Archive),
            "{member}"
        );
        assert_eq!(std::fs::read_dir(output).unwrap().count(), 0);
    }
}

#[test]
fn regular_archives_strip_one_root_and_corrupt_archives_write_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("regular.tgz");
    archive(&source, &[("package/codex", Some("fixture binary"), 0o644)]);
    let output = dir.path().join("regular");
    std::fs::create_dir(&output).unwrap();
    extract(&source, &output, &AtomicBool::new(false)).unwrap();
    assert_eq!(
        std::fs::read_to_string(output.join("codex")).unwrap(),
        "fixture binary"
    );
    assert_eq!(std::fs::read_dir(output).unwrap().count(), 1);
    let mut truncated = std::fs::read(&source).unwrap();
    truncated.truncate(truncated.len() - 8);
    for (i, bytes) in [b"not a tar file".to_vec(), vec![0x1f, 0x8b], truncated]
        .iter()
        .enumerate()
    {
        let source = dir.path().join(format!("bad-{i}.tgz"));
        std::fs::write(&source, bytes).unwrap();
        let output = dir.path().join(format!("bad-{i}"));
        std::fs::create_dir(&output).unwrap();
        assert_eq!(
            extract(&source, &output, &AtomicBool::new(false)),
            Err(ErrorCode::Archive),
            "case {i}"
        );
        assert_eq!(std::fs::read_dir(output).unwrap().count(), 0);
    }
}

#[test]
fn cancelling_a_download_cleans_staging_and_excludes_a_second_installer() {
    use std::sync::{atomic::AtomicUsize, mpsc};
    let dir = tempfile::tempdir().unwrap();
    let home = std::fs::canonicalize(dir.path()).unwrap();
    let fixture = tempfile::tempdir().unwrap();
    let source = fixture.path().join("fixture.tgz");
    archive(
        &source,
        &[("package/vendor/bin/codex", Some("fixture"), 0o755)],
    );
    let recipe = recipe(&source);
    let count = Arc::new(AtomicUsize::new(0));
    let counter = count.clone();
    let (entered, waiting) = mpsc::channel();
    let installer = Installer {
        home: home.clone(),
        download: Arc::new(move |_, _, signal| {
            counter.fetch_add(1, Ordering::SeqCst);
            entered.send(()).unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            while !signal.load(Ordering::Relaxed) {
                assert!(
                    std::time::Instant::now() < deadline,
                    "download did not receive cancellation"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(ErrorCode::Interrupted)
        }),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let worker_cancel = cancel.clone();
    let worker_recipe = recipe.clone();
    let second = Installer {
        home: home.clone(),
        download: installer.download.clone(),
    };
    let worker = std::thread::spawn(move || {
        installer.install(
            &worker_recipe,
            &worker_cancel,
            &|_, _| panic!("cancelled download must not verify"),
            &|| panic!("cancelled download must not commit"),
        )
    });
    waiting.recv_timeout(Duration::from_secs(2)).unwrap();
    let busy = second.install(
        &recipe,
        &AtomicBool::new(false),
        &|_, _| panic!("second installer must not verify"),
        &|| panic!("second installer must not commit"),
    );
    cancel.store(true, Ordering::SeqCst);
    assert_eq!(worker.join().unwrap(), Err(ErrorCode::Interrupted));
    assert_eq!(busy, Err(ErrorCode::InstallationBusy));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert_eq!(
        std::fs::read_dir(home.join(".puppyone/agent-runtimes/codex"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn an_already_cancelled_download_never_polls_a_ready_network_operation() {
    let polled = AtomicBool::new(false);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let result = runtime.block_on(cancellable(
        async {
            polled.store(true, Ordering::SeqCst);
            7
        },
        &AtomicBool::new(true),
    ));
    assert_eq!(result, Err(ErrorCode::Interrupted));
    assert!(!polled.load(Ordering::SeqCst));
}

#[test]
fn the_production_body_pipeline_verifies_pinned_bytes_and_rejects_invalid_or_cancelled_streams() {
    use futures_util::stream;
    let root = tempfile::tempdir().unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let body = b"official-test-fixture";
        const SHA512: &str = concat!(
            "ML3URAs4re1FChlf6whfXIJ1WMGLdtZ+XPMn3OV5gAf1W5zSXlX5ZI/",
            "F0fZ2nd0aN3GhK/vbGL/XsYuZwGwSJQ=="
        );
        // Independent SHA results from the frozen TS test's node:crypto input.
        for (i, (algorithm, digest)) in [
            (
                Algorithm::Sha256,
                "FPa2FhWYD9+TqlOd944u7RlXWxdGbBDpINdMYxOEsZw=",
            ),
            (Algorithm::Sha512, SHA512),
        ]
        .into_iter()
        .enumerate()
        {
            let recipe = Recipe {
                setup_id: "codex",
                version: "test-1",
                entry: "codex",
                binary: "codex".into(),
                url: "https://registry.npmjs.org/fixture.tgz".into(),
                algorithm,
                digest,
            };
            let path = root.path().join(format!("good-{i}"));
            let chunks = body.chunks(3).map(|b| Ok::<_, ()>(b.to_vec()));
            save_artifact_body(
                &recipe,
                &path,
                &AtomicBool::new(false),
                ArtifactResponse {
                    success: true,
                    length: Some(body.len() as u64),
                },
                stream::iter(chunks),
                MAX_DOWNLOAD,
            )
            .await
            .unwrap();
            assert_eq!(std::fs::read(&path).unwrap(), body);
            let bad = Recipe {
                digest: "wrong",
                ..recipe.clone()
            };
            assert_eq!(
                save_artifact_body(
                    &bad,
                    &root.path().join(format!("bad-{i}")),
                    &AtomicBool::new(false),
                    ArtifactResponse {
                        success: true,
                        length: None
                    },
                    stream::iter([Ok::<_, ()>(body)]),
                    MAX_DOWNLOAD
                )
                .await,
                Err(ErrorCode::Integrity)
            );
            for (kind, metadata) in [
                (
                    "status",
                    ArtifactResponse {
                        success: false,
                        length: None,
                    },
                ),
                (
                    "length",
                    ArtifactResponse {
                        success: true,
                        length: Some(MAX_DOWNLOAD + 1),
                    },
                ),
            ] {
                let output = root.path().join(format!("{kind}-{i}"));
                let unpolled = stream::poll_fn(|_| -> std::task::Poll<Option<Result<&[u8], ()>>> {
                    panic!("rejected response must not read its body")
                });
                assert_eq!(
                    save_artifact_body(
                        &recipe,
                        &output,
                        &AtomicBool::new(false),
                        metadata,
                        unpolled,
                        MAX_DOWNLOAD
                    )
                    .await,
                    Err(ErrorCode::Download)
                );
                assert!(!output.exists());
            }
            let limit = root.path().join(format!("limit-{i}"));
            assert_eq!(
                save_artifact_body(
                    &recipe,
                    &limit,
                    &AtomicBool::new(false),
                    ArtifactResponse {
                        success: true,
                        length: None
                    },
                    stream::iter(body.chunks(3).map(Ok::<_, ()>)),
                    10
                )
                .await,
                Err(ErrorCode::Download)
            );
            assert!(std::fs::metadata(limit).unwrap().len() <= 10);
            let failed = root.path().join(format!("stream-{i}"));
            assert_eq!(
                save_artifact_body(
                    &recipe,
                    &failed,
                    &AtomicBool::new(false),
                    ArtifactResponse {
                        success: true,
                        length: None
                    },
                    stream::iter([Ok(body.as_slice()), Err(())]),
                    MAX_DOWNLOAD
                )
                .await,
                Err(ErrorCode::Download)
            );
            let cancelled = AtomicBool::new(false);
            let late = stream::poll_fn(|_| {
                cancelled.store(true, Ordering::SeqCst);
                std::task::Poll::Ready(Some(Ok::<_, ()>(body.as_slice())))
            });
            let cancelled_output = root.path().join(format!("cancel-{i}"));
            assert_eq!(
                save_artifact_body(
                    &recipe,
                    &cancelled_output,
                    &cancelled,
                    ArtifactResponse {
                        success: true,
                        length: None
                    },
                    late,
                    MAX_DOWNLOAD
                )
                .await,
                Err(ErrorCode::Interrupted)
            );
            assert_eq!(std::fs::metadata(cancelled_output).unwrap().len(), 0);
        }
    });
}

#[test]
fn the_artifact_http_policy_rejects_redirects_and_does_not_retain_response_cookies() {
    use std::process::{Command, Stdio};
    let dir = tempfile::tempdir().unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/activation-download-tls/server.py");
    let mut command = Command::new("python3");
    command
        .arg(fixture)
        .arg(dir.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(
            std::fs::File::create(dir.path().join("server.log")).unwrap(),
        ));
    crate::platform::process::isolate(&mut command);
    struct Server(std::process::Child);
    impl Drop for Server {
        fn drop(&mut self) {
            crate::platform::process::terminate(&mut self.0);
        }
    }
    let mut server = Server(
        command
            .spawn()
            .expect("TLS integration fixture requires python3 and openssl"),
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let port = loop {
        if let Ok(text) = std::fs::read_to_string(dir.path().join("port"))
            && let Ok(port) = text.parse::<u16>()
        {
            break port;
        }
        assert!(
            server.0.try_wait().unwrap().is_none() && std::time::Instant::now() < deadline,
            "TLS fixture failed: {}",
            std::fs::read_to_string(dir.path().join("server.log")).unwrap()
        );
        std::thread::sleep(Duration::from_millis(10));
    };
    let certificate =
        reqwest::Certificate::from_pem(&std::fs::read(dir.path().join("ca.pem")).unwrap()).unwrap();
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        // The real production policy; only trust and DNS point to our fixture.
        let client = artifact_client(
            reqwest::Client::builder()
                .no_proxy()
                .add_root_certificate(certificate)
                .resolve("registry.npmjs.org", address),
        )
        .build()
        .unwrap();
        let base = format!("https://registry.npmjs.org:{port}");
        let first = client.get(format!("{base}/redirect")).send().await.unwrap();
        assert_eq!(
            first.status(),
            reqwest::StatusCode::FOUND,
            "redirect must be returned, not followed"
        );
        drop(first);
        let second = client.get(format!("{base}/landing")).send().await.unwrap();
        assert_eq!(second.status(), reqwest::StatusCode::OK);
        let error = client
            .get(format!("http://127.0.0.1:{port}/insecure"))
            .send()
            .await
            .unwrap_err();
        assert!(
            error.is_builder(),
            "HTTP must fail before opening a connection"
        );
    });
    let requests: Vec<serde_json::Value> =
        std::fs::read_to_string(dir.path().join("requests.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0]["path"], "/redirect");
    assert_eq!(requests[1]["path"], "/landing");
    assert!(
        requests
            .iter()
            .all(|r| r["cookie"].is_null() && r["authorization"].is_null())
    );
}

#[test]
fn actual_typescript_archive_bytes_preserve_format_validation_and_zero_write_failures() {
    use base64::Engine as _;
    use std::collections::BTreeMap;
    fn files(root: &Path, relative: &Path, output: &mut BTreeMap<String, String>) {
        for entry in std::fs::read_dir(root.join(relative)).unwrap() {
            let entry = entry.unwrap();
            let name = relative.join(entry.file_name());
            let kind = entry.file_type().unwrap();
            if kind.is_dir() {
                files(root, &name, output);
            } else {
                assert!(
                    kind.is_file(),
                    "an archive may not create a link or special file"
                );
                output.insert(
                    name.to_str().unwrap().into(),
                    base64::engine::general_purpose::STANDARD
                        .encode(std::fs::read(entry.path()).unwrap()),
                );
            }
        }
    }
    let oracle: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../fixtures/activation-archive-oracle.json"
    ))
    .unwrap();
    assert_eq!(
        oracle["sourceCommit"],
        "dc8468ccca89a3f75a0ebadbbe0de5688e4dc2e2"
    );
    let cases = oracle["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 49);
    let directory = tempfile::tempdir().unwrap();
    let mut differences = vec![];
    for (index, case) in cases.iter().enumerate() {
        let name = case["name"].as_str().unwrap();
        let archive = directory.path().join(format!("{index}.bin"));
        let output = directory.path().join(format!("output-{index}"));
        std::fs::write(
            &archive,
            base64::engine::general_purpose::STANDARD
                .decode(case["archive"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        std::fs::create_dir(&output).unwrap();
        let result = extract(&archive, &output, &AtomicBool::new(false));
        if result.is_ok() != case["accepted"].as_bool().unwrap() {
            differences.push(format!("{name}: acceptance differs ({result:?})"));
        }
        let mut extracted = BTreeMap::new();
        files(&output, Path::new(""), &mut extracted);
        if serde_json::to_value(extracted).unwrap() != case["files"] {
            differences.push(format!("{name}: extracted bytes differ"));
        }
        if !case["accepted"].as_bool().unwrap()
            && std::fs::read_dir(output).unwrap().next().is_some()
        {
            differences.push(format!("{name}: invalid archive wrote output"));
        }
    }
    assert!(differences.is_empty(), "{}", differences.join("\n"));
}
