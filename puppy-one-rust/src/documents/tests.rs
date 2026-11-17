use super::*;
use crate::workspace::MAX_TEXT_BYTES;
use std::path::Path;
use tempfile::TempDir;
#[path = "save_status_tests.rs"]
mod save_status;
#[path = "save_lifecycle_tests.rs"]
mod save_lifecycle;
fn setup() -> (TempDir, Documents, Wake) {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), b"original").unwrap();
    std::fs::write(temp.path().join("b.md"), b"second").unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let doc = ws.read(Path::new("a.md")).unwrap();
    let mut d = Documents::in_workspace(ws);
    d.document = Some(doc);
    (temp, d, Wake::default())
}

#[test]
fn cloud_convergence_compares_current_input_retires_old_snapshot_and_never_writes() {
    use crate::workspace::testing::Memory;
    use std::sync::atomic::Ordering;
    let provider = Arc::new(Memory::new("memory://convergence/project/"));
    let ws = Workspace::from_provider(provider.clone()).unwrap();
    let doc = ws.read(Path::new("note.md")).unwrap();
    let mut d = Documents::in_workspace(ws.clone());
    d.document = Some(doc);
    let wake = Wake::default();
    let id = d.document.as_ref().unwrap().id.clone();
    d.client(
        ClientMessage::Dirty {
            id,
            revision: 1,
            dirty: true,
        },
        &wake,
    );
    d.poll_at(&wake, Instant::now() + Duration::from_secs(1));
    let old_request = d.autosave_request.unwrap().0;
    *provider.text.lock().unwrap() = "converged".into();
    let remote = ws.observe(d.document.as_ref().unwrap()).unwrap();
    d.observing = Some((remote.id.clone(), d.read_generation));
    d.copy_tx
        .send(working_copy::CopyCompleted::Observed {
            id: remote.id.clone(),
            generation: d.read_generation,
            result: Ok(remote),
        })
        .unwrap();
    d.poll(&wake);
    let new_request = d
        .autosave_request
        .expect("compare current draft immediately")
        .0;
    assert_ne!(old_request, new_request);
    reply(&mut d, &wake, old_request, 1, "old snapshot");
    assert!(d.cloud_conflict());
    let before = provider.calls.load(Ordering::SeqCst);
    reply(&mut d, &wake, new_request, 1, "converged");
    assert!(!d.cloud_conflict() && !d.dirty && !d.saving());
    assert!(d.error.is_none());
    assert_eq!(d.document.as_ref().unwrap().text, "converged");
    assert!(d.deferred_document.is_none());
    d.poll_at(&wake, Instant::now() + Duration::from_secs(3));
    assert_eq!(
        provider.calls.load(Ordering::SeqCst),
        before,
        "no writeback or extra read after convergence"
    );
    assert!(
        d.outgoing
            .iter()
            .any(|m| matches!(m, HostMessage::Open { external: true, .. }))
    );
}

#[test]
fn cloud_converged_save_receipt_never_replaces_newer_input_and_drains_it_to_storage() {
    use crate::workspace::testing::Memory;
    let provider = Arc::new(Memory::new("memory://converged-save/project/"));
    let workspace = Workspace::from_provider(provider.clone()).unwrap();
    let document = workspace.read(Path::new("note.md")).unwrap();
    let id = document.id.clone();
    let mut d = Documents::in_workspace(workspace);
    d.document = Some(document);
    let wake = Wake::default();
    d.ensure_session(&wake);
    let (started, entered) = mpsc::channel();
    let (release, finish) = mpsc::channel();
    *provider.text.lock().unwrap() = "first draft".into();
    *provider.hook.lock().unwrap() = Some(Box::new(move || {
        started.send(()).unwrap();
        finish.recv_timeout(Duration::from_secs(10)).unwrap();
    }));
    d.client(
        ClientMessage::Dirty {
            id: id.clone(),
            revision: 1,
            dirty: true,
        },
        &wake,
    );
    d.poll_at(&wake, Instant::now() + auto_save::IDLE);
    let request = d.autosave_request.unwrap().0;
    reply(&mut d, &wake, request, 1, "first draft");
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    d.client(
        ClientMessage::Dirty {
            id: id.clone(),
            revision: 2,
            dirty: true,
        },
        &wake,
    );
    d.poll_at(&wake, Instant::now() + auto_save::IDLE);
    let request = d.autosave_request.unwrap().0;
    reply(&mut d, &wake, request, 2, "latest draft");
    release.send(()).unwrap();
    wait(&mut d, &wake);
    assert_eq!(*provider.text.lock().unwrap(), "latest draft");
    assert_eq!(d.document.as_ref().unwrap().text, "latest draft");
    assert!(!d.dirty && !d.saving() && !d.cloud_conflict());
    assert!(d.error.is_none());
    assert!(
        !d.outgoing
            .iter()
            .any(|m| matches!(m, HostMessage::Open { external: true, .. })),
        "a converged receipt must not replace the live editor"
    );
    assert!(d.outgoing.contains(&HostMessage::Saved {
        id,
        revision: 2,
        text: "latest draft".into()
    }));
}
fn reply(d: &mut Documents, ctx: &Wake, request: u64, revision: u64, text: &str) {
    d.client(
        ClientMessage::Snapshot {
            request,
            id: d.document.as_ref().unwrap().id.clone(),
            revision,
            text: Buffer::new(text),
        },
        ctx,
    );
}
fn snapshot(d: &mut Documents, ctx: &Wake, text: &str) {
    let Phase::Snapshot { request, .. } = d.phase else {
        panic!("Expected snapshot barrier")
    };
    reply(d, ctx, request, 1, text);
}
fn wait(d: &mut Documents, ctx: &Wake) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        d.poll(ctx);
        // An independent watcher error is not completion of an in-flight
        // save/close. Wait for its actual completion and thaw acknowledgement.
        if !d.busy()
            && (d.session.as_ref().is_none_or(|s| !s.has_active_write()))
            && (!d.saving() || d.error.is_some())
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "Worker did not settle: {}",
            d.status
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}
#[test]
fn local_edit_waits_for_the_pause_then_snapshots_without_freezing_and_writes_real_file() {
    {
        let (temp, mut d, ctx) = setup();
        d.client(
            ClientMessage::Dirty {
                id: d.document.as_ref().unwrap().id.clone(),
                revision: 1,
                dirty: true,
            },
            &ctx,
        );
        d.poll(&ctx);
        assert!(
            d.autosave_request.is_none(),
            "typing does not immediately save"
        );
        d.poll_at(&ctx, Instant::now() + auto_save::IDLE);
        assert!(!d.busy());
        let request = d.autosave_request.unwrap().0;
        assert!(
            d.outgoing
                .iter()
                .any(|v| matches!(v, HostMessage::Snapshot { freeze: false, .. }))
        );
        reply(&mut d, &ctx, request, 1, "自动落盘 🐶");
        wait(&mut d, &ctx);
        assert_eq!(
            std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
            "自动落盘 🐶"
        );
        assert!(!d.dirty);
        assert!(d.error.is_none());
    }
}
#[test]
fn close_snapshots_late_edit_and_waits_for_disk_without_prompt() {
    let (temp, mut d, ctx) = setup();
    d.begin(Intent::Quit, &ctx);
    snapshot(&mut d, &ctx, "late edit");
    assert!(matches!(d.phase, Phase::Draining { .. }));
    assert!(!d.allow_quit);
    wait(&mut d, &ctx);
    assert!(d.allow_quit);
    assert!(d.error.is_none());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "late edit"
    );
}
#[test]
fn composition_defers_close_without_discarding_input_or_showing_a_save_prompt() {
    let (temp, mut d, ctx) = setup();
    d.begin(Intent::Quit, &ctx);
    d.client(
        ClientMessage::Deferred {
            request: d.serial,
            id: d.document.as_ref().unwrap().id.clone(),
        },
        &ctx,
    );
    assert!(matches!(d.phase, Phase::AwaitComposition { .. }));
    assert!(!d.busy());
    assert!(!d.allow_quit);
    d.client(
        ClientMessage::Dirty {
            id: d.document.as_ref().unwrap().id.clone(),
            revision: 1,
            dirty: true,
        },
        &ctx,
    );
    snapshot(&mut d, &ctx, "中文提交");
    wait(&mut d, &ctx);
    assert!(d.allow_quit);
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "中文提交"
    );
}
#[test]
fn conditional_write_adopts_external_content_and_close_does_not_request_a_choice() {
    let (temp, mut d, ctx) = setup();
    std::fs::write(temp.path().join("a.md"), b"external").unwrap();
    d.begin(Intent::Quit, &ctx);
    snapshot(&mut d, &ctx, "old local input");
    wait(&mut d, &ctx);
    assert!(d.allow_quit);
    assert!(!d.dirty);
    assert!(d.error.is_none());
    assert_eq!(d.document.as_ref().unwrap().text, "external");
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "external"
    );
}
#[test]
fn another_close_participant_failure_thaws_the_same_session_and_resumes_its_watch() {
    let (temp, mut d, ctx) = setup();
    d.begin(Intent::Quit, &ctx);
    snapshot(&mut d, &ctx, "saved before closing");
    wait(&mut d, &ctx);
    assert!(d.allow_quit && d.watch.is_none());
    let id = d.session.as_ref().unwrap().id.clone();
    d.outgoing.clear();
    d.cancel_quit(&ctx);
    assert!(!d.allow_quit && d.watch.is_some());
    assert!(d.outgoing.contains(&HostMessage::Thaw));
    assert_eq!(d.session.as_ref().unwrap().id, id);
    std::fs::write(temp.path().join("a.md"), "external after cancelled close").unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while d.document.as_ref().unwrap().text != "external after cancelled close" {
        d.poll(&ctx);
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn genuine_write_failure_blocks_close_and_retains_current_document() {
    let (temp, mut d, ctx) = setup();
    std::fs::remove_file(temp.path().join("a.md")).unwrap();
    d.begin(Intent::Quit, &ctx);
    snapshot(&mut d, &ctx, "retain me");
    wait(&mut d, &ctx);
    assert!(!d.allow_quit);
    assert!(d.document.is_some());
    assert!(d.dirty);
    assert!(d.error.is_some());
    assert!(!temp.path().join("a.md").exists());
    assert!(d.outgoing.contains(&HostMessage::Thaw));
}

#[test]
fn a_clean_removed_document_closes_without_recreating_the_file() {
    let (temp, mut d, wake) = setup();
    d.ensure_session(&wake);
    std::fs::remove_file(temp.path().join("a.md")).unwrap();
    d.begin(Intent::Quit, &wake);
    snapshot(&mut d, &wake, "original");
    wait(&mut d, &wake);
    assert!(d.allow_quit);
    assert!(!d.dirty && !d.saving());
    assert!(!temp.path().join("a.md").exists());
}

#[test]
fn external_text_adoption_preserves_stored_bytes_without_an_autosave_or_writeback() {
    for text in [
        String::new(),
        "你好，外部 Agent 👋\n第二行".into(),
        "first\r\nsecond\r\n".into(),
        "value  \n\n".into(),
        format!("{}\n", "0123456789abcdef".repeat(16_384)),
    ] {
        let (temp, mut d, wake) = setup();
        d.ensure_session(&wake);
        d.watch = None;
        d.client(
            ClientMessage::Dirty {
                id: d.document.as_ref().unwrap().id.clone(),
                revision: 1,
                dirty: true,
            },
            &wake,
        );
        std::fs::write(temp.path().join("a.md"), &text).unwrap();
        let modified = std::fs::metadata(temp.path().join("a.md"))
            .unwrap()
            .modified()
            .unwrap();
        let document = d
            .workspace
            .as_ref()
            .unwrap()
            .observe(d.document.as_ref().unwrap())
            .unwrap();
        let normalized = document.text.clone();
        d.observing = Some((document.id.clone(), d.read_generation));
        d.copy_tx
            .send(working_copy::CopyCompleted::Observed {
                id: document.id.clone(),
                generation: d.read_generation,
                result: Ok(document),
            })
            .unwrap();
        d.poll(&wake);
        assert!(d.outgoing.iter().any(
            |m| matches!(m, HostMessage::Open { text, external: true, .. } if text == &normalized)
        ));
        assert!(!d.dirty && !d.saving());
        d.poll_at(&wake, Instant::now() + auto_save::MAX_WAIT);
        assert!(d.autosave_request.is_none());
        d.begin(Intent::Quit, &wake);
        let Phase::Snapshot { request, .. } = d.phase else {
            panic!("close snapshot required")
        };
        let revision = d.revision;
        reply(&mut d, &wake, request, revision, &normalized);
        wait(&mut d, &wake);
        assert!(d.allow_quit);
        assert_eq!(
            std::fs::read(temp.path().join("a.md")).unwrap(),
            text.as_bytes()
        );
        assert_eq!(
            std::fs::metadata(temp.path().join("a.md"))
                .unwrap()
                .modified()
                .unwrap(),
            modified,
            "close must not write the adopted bytes back"
        );
    }
}
#[test]
fn observed_disk_change_replaces_model_without_a_write_or_conflict_error() {
    let (temp, mut d, ctx) = setup();
    d.ensure_session(&ctx);
    d.client(
        ClientMessage::Dirty {
            id: d.document.as_ref().unwrap().id.clone(),
            revision: 1,
            dirty: true,
        },
        &ctx,
    );
    std::fs::write(temp.path().join("a.md"), b"agent changed it").unwrap();
    observe_current(&mut d, &ctx);
    assert_eq!(d.document.as_ref().unwrap().text, "agent changed it");
    assert!(!d.saving());
    assert!(d.error.is_none());
    assert!(
        d.outgoing
            .iter()
            .any(|v| matches!(v, HostMessage::Open { external: true, .. }))
    );
}
#[test]
fn read_started_before_save_receipt_cannot_restore_old_content() {
    let (_temp, mut d, ctx) = setup();
    d.ensure_session(&ctx);
    let old = d.document.as_ref().unwrap().clone();
    let generation = d.read_generation;
    d.observing = Some((old.id.clone(), generation));
    d.begin(Intent::Save, &ctx);
    snapshot(&mut d, &ctx, "latest");
    wait(&mut d, &ctx);
    d.copy_tx
        .send(working_copy::CopyCompleted::Observed {
            id: old.id.clone(),
            generation,
            result: Ok(old),
        })
        .unwrap();
    d.poll(&ctx);
    assert_eq!(d.document.as_ref().unwrap().text, "latest");
}
/// TS documentInputRevalidation: identical bytes are silent; changed bytes
/// replace the shown content without putting a loading barrier over it.
#[test]
fn revalidation_keeps_shown_content_and_only_changed_bytes_notify_the_editor() {
    let (temp, mut d, ctx) = setup();
    d.ensure_session(&ctx);
    d.watch = None;
    d.outgoing.clear();
    let shown = d.presentation_key();
    for text in ["original", "agent edit"] {
        d.observing = Some((d.document.as_ref().unwrap().id.clone(), d.read_generation));
        assert!(!d.busy());
        assert_eq!(d.presentation_key(), shown);
        std::fs::write(temp.path().join("a.md"), text).unwrap();
        let doc = d
            .workspace
            .as_ref()
            .unwrap()
            .observe(d.document.as_ref().unwrap())
            .unwrap();
        d.copy_tx
            .send(working_copy::CopyCompleted::Observed {
                id: doc.id.clone(),
                generation: d.read_generation,
                result: Ok(doc),
            })
            .unwrap();
        d.poll(&ctx);
        assert!(!d.busy());
        assert_eq!(d.document.as_ref().unwrap().text, text);
        if text == "original" {
            assert_eq!(d.presentation_key(), shown);
            assert!(
                d.outgoing.is_empty(),
                "same bytes must not reset selection/history"
            );
        } else {
            assert_ne!(d.presentation_key(), shown);
            assert_eq!(
                d.outgoing
                    .iter()
                    .filter(|m| matches!(m, HostMessage::Open { external: true, .. }))
                    .count(),
                1
            );
        }
    }
}
#[test]
fn switch_file_automatically_drains_then_ignores_previous_document_events() {
    let (temp, mut d, ctx) = setup();
    let old = d.document.as_ref().unwrap().id.clone();
    d.begin(Intent::OpenFile("b.md".into()), &ctx);
    snapshot(&mut d, &ctx, "saved first");
    wait(&mut d, &ctx);
    assert_eq!(d.document.as_ref().unwrap().relative, Path::new("b.md"));
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "saved first"
    );
    d.client(
        ClientMessage::Dirty {
            id: old,
            revision: 999,
            dirty: true,
        },
        &ctx,
    );
    assert!(!d.dirty);
}
#[test]
fn failed_target_load_keeps_previous_document_after_persisting_it() {
    let (temp, mut d, ctx) = setup();
    let id = d.document.as_ref().unwrap().id.clone();
    d.begin(Intent::OpenFile("missing.md".into()), &ctx);
    snapshot(&mut d, &ctx, "mine");
    wait(&mut d, &ctx);
    assert_eq!(d.document.as_ref().unwrap().id, id);
    assert!(d.error.is_some());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "mine"
    );
}
#[test]
fn stale_oversized_and_timed_out_snapshots_never_authorize_navigation() {
    let (_temp, mut d, ctx) = setup();
    d.begin(Intent::Quit, &ctx);
    let id = d.document.as_ref().unwrap().id.clone();
    d.client(
        ClientMessage::Snapshot {
            request: d.serial + 1,
            id: id.clone(),
            revision: 1,
            text: Buffer::new("wrong"),
        },
        &ctx,
    );
    assert!(!d.allow_quit);
    assert!(matches!(d.phase, Phase::Snapshot { .. }));
    d.client(
        ClientMessage::Snapshot {
            request: d.serial,
            id,
            revision: 1,
            text: Buffer::new("x".repeat(MAX_TEXT_BYTES + 1)),
        },
        &ctx,
    );
    assert!(!d.allow_quit);
    assert!(d.error.is_some());
    d.begin(Intent::Quit, &ctx);
    if let Phase::Snapshot { since, .. } = &mut d.phase {
        *since = Instant::now() - Duration::from_secs(6);
    }
    d.poll(&ctx);
    assert!(!d.allow_quit);
    assert!(d.document.is_some());
}
#[test]
fn files_their_viewer_reads_itself_open_as_resources_without_reading_text() {
    let (temp, mut d, ctx) = setup();
    // Not UTF-8: an editor could not open it, an image viewer reads it.
    std::fs::write(
        temp.path().join("logo.png"),
        [0x89, b'P', b'N', b'G', 0xff, 0x00],
    )
    .unwrap();
    // Leaving the open document drains it first, as for any switch.
    d.begin(Intent::OpenFile("logo.png".into()), &ctx);
    snapshot(&mut d, &ctx, "original");
    wait(&mut d, &ctx);
    assert!(d.error.is_none(), "{:?}", d.error);
    assert!(d.document.is_none());
    let resource = d.resource.clone().unwrap();
    assert_eq!(resource.relative, Path::new("logo.png"));
    assert_eq!(
        d.opened().map(|(_, p)| p.to_path_buf()),
        Some(resource.relative.clone())
    );
    assert!(d.outgoing.iter().any(|m| matches!(
        m,
        HostMessage::OpenResource { name, path, .. }
            if name == "logo.png" && path == &resource.preview
    )));
    // Opening a text file afterwards replaces it with a document.
    d.begin(Intent::OpenFile("b.md".into()), &ctx);
    wait(&mut d, &ctx);
    assert!(d.resource.is_none());
    assert_eq!(d.document.as_ref().unwrap().text, "second");
}
#[test]
fn resources_outside_the_workspace_or_through_symlinks_are_refused() {
    let (temp, mut d, ctx) = setup();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.png"), b"x").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(
        outside.path().join("secret.png"),
        temp.path().join("link.png"),
    )
    .unwrap();
    d.begin(Intent::OpenFile("link.png".into()), &ctx);
    wait(&mut d, &ctx);
    assert!(d.resource.is_none());
    assert!(d.error.is_some());
}
#[test]
fn a_non_filesystem_provider_runs_the_real_document_save_and_preview_pipeline() {
    use crate::workspace::testing::Memory;
    let memory = Arc::new(Memory::new("memory://actor/project/"));
    let ws = Workspace::from_provider(memory.clone()).unwrap();
    assert!(ws.local_root().is_none());
    let ctx = Wake::default();
    let mut d = Documents::in_workspace(ws);
    d.begin(Intent::OpenFile("note.md".into()), &ctx);
    wait(&mut d, &ctx);
    assert!(d.error.is_none(), "{:?}", d.error);
    d.begin(Intent::Save, &ctx);
    snapshot(&mut d, &ctx, "provider bytes");
    wait(&mut d, &ctx);
    assert_eq!(*memory.text.lock().unwrap(), "provider bytes");
    assert!(!d.dirty);
    d.begin(Intent::OpenFile("image.png".into()), &ctx);
    snapshot(&mut d, &ctx, "provider bytes");
    wait(&mut d, &ctx);
    assert!(d.error.is_none(), "{:?}", d.error);
    assert!(matches!(
        d.resource.as_ref().unwrap().preview.data(),
        Ok(workspace::PreviewData::Bytes { .. })
    ));
    assert!(d.document.is_none());
}

#[test]
fn superseded_observation_revalidates_without_needing_another_notification() {
    let (temp, mut d, ctx) = setup();
    d.ensure_session(&ctx);
    d.watch = None; // No timer or second event can rescue a lost invalidation.
    let old = d.document.as_ref().unwrap().clone();
    let generation = d.read_generation;
    d.observing = Some((old.id.clone(), generation));
    d.read_generation += 1; // A save receipt superseded the in-flight read.
    std::fs::write(temp.path().join("a.md"), "new baseline").unwrap();
    d.copy_tx
        .send(working_copy::CopyCompleted::Observed {
            id: old.id.clone(),
            generation,
            result: Ok(old),
        })
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while d.document.as_ref().unwrap().text != "new baseline" {
        d.poll(&ctx);
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(!d.dirty);
}

#[test]
fn a_background_reread_that_fails_in_transit_keeps_the_text_and_reads_again_quietly() {
    let (temp, mut d, ctx) = setup();
    d.ensure_session(&ctx);
    d.watch = None;
    let shown = d.document.as_ref().unwrap().clone();
    let fail_read = |d: &mut Documents, kind| {
        d.observing = Some((shown.id.clone(), d.read_generation));
        d.copy_tx
            .send(working_copy::CopyCompleted::Observed {
                id: shown.id.clone(),
                generation: d.read_generation,
                result: Err(workspace::Error::new(
                    kind,
                    "Cloud files changed during the read; revalidate",
                )),
            })
            .unwrap();
    };
    // A re-read lost to a burst of changes says nothing and keeps the text...
    let now = Instant::now();
    fail_read(&mut d, workspace::ErrorKind::Io);
    d.poll_at(&ctx, now);
    assert!(d.error.is_none(), "{:?}", d.error);
    assert_eq!(d.document.as_ref().unwrap().text, "original");
    // ...then reads again on its own and takes what the file holds now.
    std::fs::write(temp.path().join("a.md"), "written by an Agent").unwrap();
    let later = now + OBSERVATION_RETRIES[0];
    let deadline = Instant::now() + Duration::from_secs(4);
    while d.document.as_ref().unwrap().text != "written by an Agent" {
        d.poll_at(&ctx, later);
        assert!(Instant::now() < deadline, "the re-read did not run");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(d.error.is_none() && !d.dirty);

    // Failing in transit every time, it is reported once the retries are spent.
    for _ in OBSERVATION_RETRIES {
        fail_read(&mut d, workspace::ErrorKind::Io);
        d.poll_at(&ctx, later);
        assert!(d.error.is_none());
    }
    fail_read(&mut d, workspace::ErrorKind::Io);
    d.poll_at(&ctx, later);
    assert!(d.error.is_some());

    // What needs the person (the file is gone) is said at once.
    d.error = None;
    fail_read(&mut d, workspace::ErrorKind::NotFound);
    d.poll_at(&ctx, later);
    assert!(d.error.is_some());
}

#[test]
fn local_provider_notifications_reconcile_without_controller_filesystem_polling() {
    let (temp, mut d, ctx) = setup();
    d.ensure_session(&ctx);
    std::fs::write(temp.path().join("a.md"), "watch changed").unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while d.document.as_ref().unwrap().text != "watch changed" {
        d.poll(&ctx);
        assert!(Instant::now() < deadline, "{:?}", d.error);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!d.dirty);
    d.begin(Intent::CloseFile, &ctx);
    snapshot(&mut d, &ctx, "watch changed");
    wait(&mut d, &ctx);
    d.poll(&ctx);
    assert!(d.watch.is_none());
}

#[test]
fn a_referenced_workspace_path_opens_that_file() {
    let (_temp, mut d, ctx) = setup();
    d.document = None;
    d.client(
        ClientMessage::OpenPaths {
            paths: vec!["/b.md".into()],
        },
        &ctx,
    );
    wait(&mut d, &ctx);
    assert!(d.error.is_none(), "{:?}", d.error);
    assert_eq!(d.document.as_ref().unwrap().relative, Path::new("b.md"));
}

#[test]
fn a_new_lease_of_the_same_storage_rebinds_the_working_copy_and_keeps_saving() {
    use crate::workspace::testing::Memory;
    let memory = Arc::new(Memory::new("memory://actor/project/"));
    let first = Workspace::from_provider(memory.clone()).unwrap();
    let ctx = Wake::default();
    let mut d = Documents::in_workspace(first.clone());
    d.begin(Intent::OpenFile("note.md".into()), &ctx);
    wait(&mut d, &ctx);
    let id = d.document.as_ref().unwrap().id.clone();
    // The first lease ends (signing out); the same storage opens again.
    first.revoke();
    let second = Workspace::from_provider(memory.clone()).unwrap();
    d.rebind_workspace(second.clone(), &ctx);
    let deadline = Instant::now() + Duration::from_secs(4);
    while second.observe(d.document.as_ref().unwrap()).is_err() {
        d.poll(&ctx);
        assert!(Instant::now() < deadline, "{:?}", d.error);
        std::thread::sleep(Duration::from_millis(2));
    }
    // The same Working Copy, now saving through the new lease.
    assert_eq!(d.document.as_ref().unwrap().id, id);
    d.begin(Intent::Save, &ctx);
    snapshot(&mut d, &ctx, "after rebind");
    wait(&mut d, &ctx);
    assert!(d.error.is_none(), "{:?}", d.error);
    assert_eq!(*memory.text.lock().unwrap(), "after rebind");
}

#[test]
fn a_rebind_holds_newer_remote_text_back_under_unsaved_input() {
    use crate::workspace::testing::Memory;
    let memory = Arc::new(Memory::new("memory://actor/project/"));
    let first = Workspace::from_provider(memory.clone()).unwrap();
    let ctx = Wake::default();
    let mut d = Documents::in_workspace(first.clone());
    d.begin(Intent::OpenFile("note.md".into()), &ctx);
    wait(&mut d, &ctx);
    d.client(
        ClientMessage::Dirty {
            id: d.document.as_ref().unwrap().id.clone(),
            revision: 1,
            dirty: true,
        },
        &ctx,
    );
    // Someone else changed the file while this lease was gone.
    *memory.text.lock().unwrap() = "remote edit".into();
    first.revoke();
    d.rebind_workspace(Workspace::from_provider(memory.clone()).unwrap(), &ctx);
    let deadline = Instant::now() + Duration::from_secs(4);
    while !d.cloud_conflict() {
        d.poll(&ctx);
        assert!(Instant::now() < deadline, "{:?}", d.error);
        std::thread::sleep(Duration::from_millis(2));
    }
    // The draft is kept; nothing was written over the remote text.
    assert_eq!(*memory.text.lock().unwrap(), "remote edit");
    assert_eq!(d.document.as_ref().unwrap().text, "original");
}

#[test]
fn hosted_documents_read_relative_assets_through_their_provider() {
    use crate::{
        editor::registry::SourceKind, platform::webview::ResourceSource, workspace::testing::Memory,
    };
    let memory = Arc::new(Memory::new("memory://actor/project/"));
    let ws = Workspace::from_provider(memory.clone()).unwrap();
    let ctx = Wake::default();
    let mut d = Documents::in_workspace(ws);
    d.begin(Intent::OpenFile("note.md".into()), &ctx);
    wait(&mut d, &ctx);
    assert!(d.error.is_none(), "{:?}", d.error);
    let id = d.document.as_ref().expect("a text document").id.clone();
    let context = d
        .outgoing
        .iter()
        .find_map(|m| match m {
            HostMessage::Context {
                id: msg_id,
                context,
            } if msg_id == &id => Some(context.clone()),
            _ => None,
        })
        .expect("per-instance DocumentContext emitted");
    assert_eq!(context.source_kind, SourceKind::Cloud);
    let source = context.web_source.expect("a provider source");
    assert!(source.read(Path::new("logo.png")).is_some());
    assert!(context.folder.is_none());
    // A local document keeps its folder and has no provider source.
    let (_temp, preset, ctx) = setup();
    let mut local = Documents::in_workspace(preset.workspace.clone().unwrap());
    local.begin(Intent::OpenFile("a.md".into()), &ctx);
    wait(&mut local, &ctx);
    let id = local.document.as_ref().unwrap().id.clone();
    let local_ctx = local
        .outgoing
        .iter()
        .find_map(|m| match m {
            HostMessage::Context {
                id: msg_id,
                context,
            } if msg_id == &id => Some(context.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(local_ctx.source_kind, SourceKind::Local);
    assert!(local_ctx.folder.is_some());
    assert!(local_ctx.web_source.is_none());
}

#[test]
fn a_hidden_document_releases_its_subscription_and_revalidates_when_shown() {
    let (temp, mut d, ctx) = setup();
    d.ensure_session(&ctx);
    assert!(d.watching());
    d.pause_watch();
    assert!(!d.watching());
    // A change while hidden is not observed...
    std::fs::write(temp.path().join("a.md"), "changed while hidden").unwrap();
    // ...and showing the document again subscribes and rereads once.
    d.resume_watch(&ctx);
    assert!(d.watching());
    let deadline = Instant::now() + Duration::from_secs(4);
    while d.document.as_ref().unwrap().text != "changed while hidden" {
        d.poll(&ctx);
        assert!(Instant::now() < deadline, "{:?}", d.error);
        std::thread::sleep(Duration::from_millis(5));
    }
}
#[test]
fn a_failed_autosave_is_a_pane_status_with_retry_not_a_dialog() {
    use crate::workspace::testing::Memory;
    let memory = Arc::new(Memory::new("memory://actor/project/"));
    let ctx = Wake::default();
    let mut d = Documents::in_workspace(Workspace::from_provider(memory.clone()).unwrap());
    d.begin(Intent::OpenFile("note.md".into()), &ctx);
    wait(&mut d, &ctx);
    let id = d.document.as_ref().unwrap().id.clone();
    let settle = |d: &mut Documents, done: &dyn Fn(&Documents) -> bool| {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !done(d) {
            d.poll(&ctx);
            assert!(Instant::now() < deadline, "{}", d.status);
            std::thread::sleep(Duration::from_millis(2));
        }
    };
    let autosave = |d: &mut Documents, text: &str| {
        d.poll_at(&ctx, Instant::now() + auto_save::IDLE);
        let request = d.autosave_request.expect("autosave snapshot").0;
        reply(d, &ctx, request, 1, text);
    };
    memory
        .failing_writes
        .store(1, std::sync::atomic::Ordering::SeqCst);
    d.client(
        ClientMessage::Dirty {
            id,
            revision: 1,
            dirty: true,
        },
        &ctx,
    );
    autosave(&mut d, "kept input");
    settle(&mut d, &|d| d.save_error.is_some());
    assert_eq!(d.save_status(), SaveStatus::Failed);
    assert!(d.error.is_none(), "no blocking dialog");
    assert!(d.dirty);
    assert_eq!(*memory.text.lock().unwrap(), "original");
    // Retry snapshots and writes the same input again.
    d.retry_save(&ctx);
    assert!(d.save_error.is_none());
    autosave(&mut d, "kept input");
    settle(&mut d, &|d| !d.saving());
    assert_eq!(*memory.text.lock().unwrap(), "kept input");
    assert_eq!(
        d.save_status(),
        SaveStatus::Clean,
        "quick background saves stay quiet"
    );
    assert!(!d.dirty);
}

#[test]
fn viewers_admit_the_smaller_of_their_own_budget_and_the_workspace_text_bound() {
    let temp = tempfile::tempdir().unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    // Locally Markdown keeps the provider's text bound; HTML its own 4 MiB.
    assert_eq!(
        super::read_budget("big.md", &ws),
        crate::editor::registry::source_budget("big.md").min(ws.text_limit() as u64)
    );
    assert_eq!(super::read_budget("page.html", &ws), 4 * 1024 * 1024);
}

#[test]
fn source_admission_counts_utf8_bytes_and_never_opens_a_truncated_editable_fallback() {
    use crate::workspace::testing::Memory;
    for (content, accepted) in [
        ("你好", true),
        ("😀ab", true),
        ("你好a", false),
        ("😀abc", false),
    ] {
        let mut provider = Memory::new("memory://source-budget/project/");
        provider.descriptor.limits.text_bytes = 6;
        // A provider without preview authority cannot bypass its text bound
        // through the separate read-only large-resource admission path.
        provider.descriptor.capabilities.preview = false;
        *provider.text.lock().unwrap() = content.into();
        let mut d = Documents::in_workspace(Workspace::from_provider(Arc::new(provider)).unwrap());
        let wake = Wake::default();
        d.begin(Intent::OpenFile("note.md".into()), &wake);
        wait(&mut d, &wake);
        assert_eq!(d.document.is_some(), accepted, "{content}");
        assert!(d.error.is_none(), "{content}: {:?}", d.error);
        if accepted {
            assert_eq!(d.document.as_ref().unwrap().text, content);
        } else {
            assert!(d.resource.is_none());
            assert!(d.read_only_large.is_none());
            let rejected = d
                .oversized
                .as_ref()
                .expect("show the size-limit explanation");
            assert_eq!(rejected.size_bytes, content.len() as u64);
            assert_eq!(rejected.limit_bytes, 6);
            assert!(!d.outgoing.iter().any(|m| matches!(
                m,
                HostMessage::Open { .. } | HostMessage::OpenResource { .. }
            )));
        }
    }
}

#[test]
fn leaving_the_window_flushes_pending_typing_once_without_freezing() {
    let (temp, mut d, wake) = setup();
    d.client(
        ClientMessage::Dirty {
            id: d.document.as_ref().unwrap().id.clone(),
            revision: 1,
            dirty: true,
        },
        &wake,
    );
    d.poll(&wake);
    assert!(d.autosave_request.is_none());
    d.flush_pending_auto_save(&wake);
    let request = d.autosave_request.unwrap().0;
    d.flush_pending_auto_save(&wake);
    assert_eq!(
        d.outgoing
            .iter()
            .filter(|m| matches!(m, HostMessage::Snapshot { .. }))
            .count(),
        1
    );
    assert!(
        d.outgoing
            .iter()
            .any(|m| matches!(m, HostMessage::Snapshot { freeze: false, .. }))
    );
    reply(&mut d, &wake, request, 1, "saved on blur");
    wait(&mut d, &wake);
    d.poll_at(&wake, Instant::now() + auto_save::MAX_WAIT);
    assert!(d.autosave_request.is_none());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "saved on blur"
    );
}

#[test]
fn closing_before_the_pause_drains_the_last_input_without_a_later_autosave() {
    let (temp, mut d, wake) = setup();
    d.client(
        ClientMessage::Dirty {
            id: d.document.as_ref().unwrap().id.clone(),
            revision: 1,
            dirty: true,
        },
        &wake,
    );
    d.begin(Intent::Quit, &wake);
    snapshot(&mut d, &wake, "last typing");
    wait(&mut d, &wake);
    assert!(d.allow_quit);
    d.poll_at(&wake, Instant::now() + auto_save::MAX_WAIT);
    assert!(d.autosave_request.is_none());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "last typing"
    );
}

#[test]
fn quick_background_saves_stay_quiet_slow_and_explicit_saves_are_announced() {
    for (slow, explicit) in [(false, false), (true, false), (false, true)] {
        let (_temp, mut d, wake) = setup();
        d.client(
            ClientMessage::Dirty {
                id: d.document.as_ref().unwrap().id.clone(),
                revision: 1,
                dirty: true,
            },
            &wake,
        );
        if explicit {
            d.begin(Intent::Save, &wake);
            snapshot(&mut d, &wake, "draft");
        } else {
            d.flush_pending_auto_save(&wake);
            let request = d.autosave_request.unwrap().0;
            reply(&mut d, &wake, request, 1, "draft");
        }
        assert_eq!(
            d.save_status(),
            if explicit {
                SaveStatus::Saving
            } else {
                SaveStatus::Clean
            }
        );
        if slow {
            d.poll_at(&wake, Instant::now() + auto_save::SLOW_SAVE);
        }
        wait(&mut d, &wake);
        assert_eq!(
            d.save_status(),
            if explicit || slow {
                SaveStatus::Saved
            } else {
                SaveStatus::Clean
            }
        );
    }
}

#[test]
fn retired_text_reads_cannot_clear_the_current_observation_or_schedule_an_extra_read() {
    let (_temp, mut d, wake) = setup();
    d.ensure_session(&wake);
    d.watch = None;
    d.observation_pending = false;
    d.outgoing.clear();
    let old = d.document.as_ref().unwrap().clone();
    let old_generation = d.read_generation;
    d.read_generation += 1;
    let owner = (old.id.clone(), d.read_generation);
    d.observing = Some(owner.clone());
    d.copy_tx
        .send(working_copy::CopyCompleted::Observed {
            id: old.id.clone(),
            generation: old_generation,
            result: Ok(old.clone()),
        })
        .unwrap();
    d.poll(&wake);
    assert_eq!(d.observing, Some(owner.clone()));
    assert!(!d.observation_pending);
    assert!(d.outgoing.is_empty());
    let mut current = old;
    current.text = "current connection".into();
    d.copy_tx
        .send(working_copy::CopyCompleted::Observed {
            id: owner.0,
            generation: owner.1,
            result: Ok(current),
        })
        .unwrap();
    d.poll(&wake);
    assert_eq!(d.document.as_ref().unwrap().text, "current connection");
    assert!(d.observing.is_none());
    assert!(!d.observation_pending);
}

#[test]
fn background_read_retry_timers_and_budgets_retire_with_their_owner() {
    for transition in ["pause", "replace", "rebind", "close", "prepare", "quit"] {
        let (temp, mut d, ctx) = setup();
        d.ensure_session(&ctx);
        d.watch = None;
        let now = Instant::now();
        let id = d.document.as_ref().unwrap().id.clone();
        d.observing = Some((id.clone(), d.read_generation));
        d.copy_tx
            .send(working_copy::CopyCompleted::Observed {
                id,
                generation: d.read_generation,
                result: Err(workspace::Error::new(workspace::ErrorKind::Io, "transient")),
            })
            .unwrap();
        d.poll_at(&ctx, now);
        assert_eq!(d.observation_retry, Some(now + Duration::from_secs(1)));
        assert_eq!(d.observation_failures, 1);
        d.poll_at(&ctx, now + Duration::from_millis(999));
        assert!(d.observing.is_none(), "{transition}: retry before deadline");
        match transition {
            "pause" => d.pause_watch(),
            "replace" => {
                d.document = Some(
                    d.workspace
                        .as_ref()
                        .unwrap()
                        .read(Path::new("b.md"))
                        .unwrap(),
                );
                d.ensure_session(&ctx);
            }
            "rebind" => d.rebind_workspace(Workspace::open(temp.path()).unwrap(), &ctx),
            "close" => d.execute_copy(Intent::CloseFile, &ctx),
            "prepare" => d.execute_copy(Intent::PrepareOperation, &ctx),
            "quit" => d.execute_copy(Intent::Quit, &ctx),
            _ => unreachable!(),
        }
        assert!(
            d.observation_retry.is_none(),
            "{transition}: timer outlived its owner"
        );
        assert_eq!(
            d.observation_failures, 0,
            "{transition}: new owner inherited old failures"
        );
        if transition == "pause" {
            d.poll_at(&ctx, now + Duration::from_secs(20));
            assert!(
                d.observing.is_none() && !d.observation_pending,
                "paused document reread after retirement"
            );
        }
    }
}

struct HostedFake {
    descriptor: workspace::contracts::Descriptor,
    files: std::sync::Mutex<std::collections::BTreeMap<String, String>>,
    fail_next_write: std::sync::Mutex<Option<workspace::ErrorKind>>,
}

impl HostedFake {
    fn new(namespace: &str, initial: &[(&str, &str)]) -> Arc<Self> {
        let mut files = std::collections::BTreeMap::new();
        for (k, v) in initial {
            files.insert((*k).to_string(), (*v).to_string());
        }
        Arc::new(Self {
            descriptor: workspace::contracts::Descriptor {
                limits: workspace::contracts::Limits::LOCAL,
                storage: workspace::contracts::StorageId::new(namespace).unwrap(),
                name: "HostedFake".into(),
                local_root: None,
                capabilities: workspace::contracts::Capabilities {
                    read: true,
                    write: true,
                    create: true,
                    rename: true,
                    remove: true,
                    preview: true,
                    ..Default::default()
                },
            },
            files: std::sync::Mutex::new(files),
            fail_next_write: std::sync::Mutex::new(None),
        })
    }

    fn snapshot(text: &str) -> workspace::contracts::TextSnapshot {
        workspace::contracts::TextSnapshot {
            encoding: Default::default(),
            line_ending: Default::default(),
            revision: workspace::contracts::Revision(blake3::hash(text.as_bytes()).to_string()),
            text: text.to_string(),
        }
    }

    fn set(&self, path: &str, text: &str) {
        self.files
            .lock()
            .unwrap()
            .insert(path.to_string(), text.to_string());
    }

    fn get(&self, path: &str) -> Option<String> {
        self.files.lock().unwrap().get(path).cloned()
    }
}

impl workspace::ports::DataPort for HostedFake {
    fn descriptor(&self) -> workspace::contracts::Descriptor {
        self.descriptor.clone()
    }

    fn list(
        &self,
        parent: &workspace::contracts::RelativePath,
    ) -> workspace::Result<Vec<workspace::contracts::Entry>> {
        let prefix = parent.as_path().to_string_lossy();
        let files = self.files.lock().unwrap();
        let mut out = Vec::new();
        for key in files.keys() {
            let rel_path = Path::new(key);
            let item_parent = rel_path.parent().unwrap_or(Path::new(""));
            if item_parent == parent.as_path() {
                out.push(workspace::contracts::Entry {
                    path: workspace::contracts::RelativePath::new(rel_path)?,
                    name: rel_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(key)
                        .to_string(),
                    folder: false,
                });
            } else if prefix.is_empty()
                && let Some(first) = rel_path.components().next()
            {
                let dir_name = first.as_os_str().to_string_lossy().into_owned();
                if !out.iter().any(|e| e.folder && e.name == dir_name) {
                    out.push(workspace::contracts::Entry {
                        path: workspace::contracts::RelativePath::new(Path::new(&dir_name))?,
                        name: dir_name,
                        folder: true,
                    });
                }
            }
        }
        Ok(out)
    }

    fn create(
        &self,
        parent: &workspace::contracts::RelativePath,
        name: &str,
        folder: bool,
        text: &str,
    ) -> workspace::Result<workspace::contracts::RelativePath> {
        if folder {
            return Err(workspace::Error::unsupported());
        }
        let joined = if parent.as_path().as_os_str().is_empty() {
            PathBuf::from(name)
        } else {
            parent.as_path().join(name)
        };
        let rel = workspace::contracts::RelativePath::new(&joined)?;
        let key = rel.as_path().to_string_lossy().into_owned();
        let mut files = self.files.lock().unwrap();
        if files.contains_key(&key) {
            return Err(workspace::Error::new(
                workspace::ErrorKind::AlreadyExists,
                "Already exists",
            ));
        }
        files.insert(key, text.to_string());
        Ok(rel)
    }
}

impl workspace::ports::DocumentStoragePort for HostedFake {
    fn read(
        &self,
        path: &workspace::contracts::RelativePath,
    ) -> workspace::Result<workspace::contracts::TextSnapshot> {
        let key = path.as_path().to_string_lossy();
        let files = self.files.lock().unwrap();
        let Some(text) = files.get(key.as_ref()) else {
            return Err(workspace::Error::new(
                workspace::ErrorKind::NotFound,
                "Not found",
            ));
        };
        Ok(Self::snapshot(text))
    }

    fn write(
        &self,
        path: &workspace::contracts::RelativePath,
        base: &workspace::contracts::Revision,
        text: &str,
    ) -> workspace::Result<workspace::contracts::WriteResult> {
        if let Some(kind) = self.fail_next_write.lock().unwrap().take() {
            return Err(workspace::Error::new(kind, format!("Simulated {kind:?}")));
        }
        let key = path.as_path().to_string_lossy().into_owned();
        let mut files = self.files.lock().unwrap();
        let Some(current) = files.get(&key) else {
            return Err(workspace::Error::new(
                workspace::ErrorKind::NotFound,
                "Target missing",
            ));
        };
        let latest = Self::snapshot(current);
        if &latest.revision != base {
            return Ok(workspace::contracts::WriteResult::Conflict(latest));
        }
        files.insert(key, text.to_string());
        Ok(workspace::contracts::WriteResult::Saved(Self::snapshot(
            text,
        )))
    }
}

impl workspace::ports::ResourcePort for HostedFake {
    fn preview(
        &self,
        _: &workspace::contracts::RelativePath,
    ) -> workspace::Result<workspace::PreviewData> {
        Ok(workspace::PreviewData::Bytes {
            mime: "text/plain".into(),
            bytes: Arc::from([]),
        })
    }

    fn stat_entry(
        &self,
        path: &workspace::contracts::RelativePath,
    ) -> workspace::Result<workspace::EntryStat> {
        let key = path.as_path().to_string_lossy();
        let files = self.files.lock().unwrap();
        let Some(text) = files.get(key.as_ref()) else {
            return Err(workspace::Error::new(
                workspace::ErrorKind::NotFound,
                "Not found",
            ));
        };
        Ok(workspace::EntryStat {
            size: text.len() as u64,
            is_file: true,
            readonly: false,
        })
    }

    fn read_head(
        &self,
        path: &workspace::contracts::RelativePath,
        max_bytes: usize,
    ) -> workspace::Result<Vec<u8>> {
        let key = path.as_path().to_string_lossy();
        let files = self.files.lock().unwrap();
        let Some(text) = files.get(key.as_ref()) else {
            return Err(workspace::Error::new(
                workspace::ErrorKind::NotFound,
                "Not found",
            ));
        };
        Ok(text.as_bytes()[..text.len().min(max_bytes)].to_vec())
    }
}

impl workspace::ports::ResourceWatchPort for HostedFake {
    fn watch(
        &self,
        _: &workspace::contracts::RelativePath,
        _: &workspace::contracts::Revision,
        _: workspace::ports::Notify,
    ) -> workspace::Result<workspace::ports::WatchSubscription> {
        Err(workspace::Error::unsupported())
    }
}

/// `DP-01` & `DP-05`: disjoint edits on both Local and Hosted workspaces merge
/// cleanly and flush the merged result back onto the remote revision.
fn observe_current(d: &mut Documents, ctx: &Wake) {
    d.revalidate();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        d.poll(ctx);
        if !d.observation_pending && d.observing.is_none() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "observation did not settle: {:?}",
            d.error
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn dp01_non_overlapping_local_and_hosted_changes_merge_cleanly_and_autosave() {
    // 1. Local workspace disjoint 3-way merge via live buffer + disk observation.
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("doc.md"), "alpha\nbeta\ngamma\n").unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let ctx = Wake::default();
    let mut local = Documents::in_workspace(ws);
    local.begin(Intent::OpenFile("doc.md".into()), &ctx);
    wait(&mut local, &ctx);
    let id = local.document.as_ref().unwrap().id.clone();
    local.outgoing.clear();
    local.client(
        ClientMessage::LiveBuffer {
            id: id.clone(),
            revision: 1,
            text: Buffer::new("ALPHA\nbeta\ngamma\n"),
        },
        &ctx,
    );
    local.client(
        ClientMessage::Dirty {
            id,
            revision: 1,
            dirty: true,
        },
        &ctx,
    );
    std::fs::write(temp.path().join("doc.md"), "alpha\nbeta\nGAMMA\n").unwrap();
    observe_current(&mut local, &ctx);
    assert_eq!(
        local.document.as_ref().unwrap().text,
        "ALPHA\nbeta\nGAMMA\n"
    );
    assert!(local.local_overwrite_notice.is_none());
    assert!(
        local
            .outgoing
            .iter()
            .any(|m| matches!(m, HostMessage::Open { text, external: true, .. } if text == "ALPHA\nbeta\nGAMMA\n"))
    );
    // Merged local hunk remains dirty and flushes cleanly to disk.
    local.flush_pending_auto_save(&ctx);
    if let Some((req, _, _)) = local.autosave_request {
        let rev = local.revision;
        reply(&mut local, &ctx, req, rev, "ALPHA\nbeta\nGAMMA\n");
    }
    wait(&mut local, &ctx);
    assert_eq!(
        std::fs::read_to_string(temp.path().join("doc.md")).unwrap(),
        "ALPHA\nbeta\nGAMMA\n"
    );

    // 2. Hosted workspace disjoint 3-way merge on conditional-write conflict.
    let hosted = HostedFake::new("cloud://acct/proj/", &[("note.md", "alpha\nbeta\ngamma\n")]);
    let hosted_ws = Workspace::from_provider(hosted.clone()).unwrap();
    let mut cloud = Documents::in_workspace(hosted_ws);
    cloud.begin(Intent::OpenFile("note.md".into()), &ctx);
    wait(&mut cloud, &ctx);
    hosted.set("note.md", "alpha\nbeta\nGAMMA\n");
    cloud.begin(Intent::Save, &ctx);
    snapshot(&mut cloud, &ctx, "ALPHA\nbeta\ngamma\n");
    wait(&mut cloud, &ctx);
    assert!(!cloud.cloud_conflict());
    assert_eq!(
        hosted.get("note.md").as_deref(),
        Some("ALPHA\nbeta\nGAMMA\n")
    );
    assert!(!cloud.dirty);
}

/// `DP-04`: overlapping local edit adopts disk on overlapping hunks, preserves
/// disjoint local hunks, emits an external `HostMessage`, and raises a
/// non-blocking neutral notice instead of an error dialog.
#[test]
fn dp04_local_overlapping_edit_adopts_disk_preserves_disjoint_hunks_and_sets_undo_notice() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), "l1\nl2\nl3\nl4\n").unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let ctx = Wake::default();
    let mut d = Documents::in_workspace(ws);
    d.begin(Intent::OpenFile("a.md".into()), &ctx);
    wait(&mut d, &ctx);
    let id = d.document.as_ref().unwrap().id.clone();
    d.outgoing.clear();
    d.client(
        ClientMessage::LiveBuffer {
            id: id.clone(),
            revision: 1,
            text: Buffer::new("OURS_OVERLAP\nl2\nl3\nOURS_DISJOINT\n"),
        },
        &ctx,
    );
    d.client(
        ClientMessage::Dirty {
            id,
            revision: 1,
            dirty: true,
        },
        &ctx,
    );
    std::fs::write(temp.path().join("a.md"), "DISK_OVERLAP\nl2\nl3\nl4\n").unwrap();
    observe_current(&mut d, &ctx);
    assert!(d.error.is_none());
    assert!(d.local_overwrite_notice.is_some());
    assert_eq!(
        d.document.as_ref().unwrap().text,
        "DISK_OVERLAP\nl2\nl3\nOURS_DISJOINT\n"
    );
    assert!(d.dirty, "disjoint local hunk must still save back");
}

/// `DP-05`: overlapping hosted edits surface all conflict exits (`ConflictState`
/// for Compare, `keep_local_cloud_draft`, `reload_cloud_baseline`, and
/// `save_conflict_copy` writing `<stem> (conflict copy).<ext>`).
#[test]
fn dp05_hosted_conflict_exits_keep_mine_accept_remote_and_save_conflict_copy() {
    let ctx = Wake::default();

    // Exit 2: Keep Mine rebases local draft onto remote revision and saves it.
    let hosted = HostedFake::new("cloud://acct/proj/", &[("docs/plan.md", "base\n")]);
    let mut d = Documents::in_workspace(Workspace::from_provider(hosted.clone()).unwrap());
    d.begin(Intent::OpenFile("docs/plan.md".into()), &ctx);
    wait(&mut d, &ctx);
    hosted.set("docs/plan.md", "remote v2\n");
    d.begin(Intent::Save, &ctx);
    snapshot(&mut d, &ctx, "mine v2\n");
    wait(&mut d, &ctx);
    assert!(d.cloud_conflict());
    let conflict = d.conflict_state().expect("Compare state present");
    assert_eq!(conflict.ours.as_str(), "mine v2\n");
    assert_eq!(conflict.theirs.as_str(), "remote v2\n");
    d.keep_local_cloud_draft(&ctx);
    wait(&mut d, &ctx);
    assert!(!d.cloud_conflict());
    assert!(!d.dirty);
    assert_eq!(hosted.get("docs/plan.md").as_deref(), Some("mine v2\n"));

    // Exit 3: Accept Remote adopts remote text and clears conflict.
    hosted.set("docs/plan.md", "remote v3\n");
    d.begin(Intent::Save, &ctx);
    let Phase::Snapshot { request, .. } = d.phase else {
        panic!("expected snapshot");
    };
    reply(&mut d, &ctx, request, 2, "mine v3\n");
    wait(&mut d, &ctx);
    assert!(d.cloud_conflict());
    d.outgoing.clear();
    d.reload_cloud_baseline();
    assert!(!d.cloud_conflict());
    assert!(!d.dirty);
    assert_eq!(d.document.as_ref().unwrap().text, "remote v3\n");
    assert!(d.outgoing.iter().any(
        |m| matches!(m, HostMessage::Open { text, external: true, .. } if text == "remote v3\n")
    ));

    // Exit 4: Save As Copy writes `<stem> (conflict copy).<ext>` and reloads original to `theirs`.
    hosted.set("docs/plan.md", "remote v4\n");
    d.begin(Intent::Save, &ctx);
    let Phase::Snapshot { request, .. } = d.phase else {
        panic!("expected snapshot");
    };
    reply(&mut d, &ctx, request, 3, "precious mine v4\n");
    wait(&mut d, &ctx);
    assert!(d.cloud_conflict());
    d.save_conflict_copy(&ctx);
    let deadline = Instant::now() + Duration::from_secs(5);
    while d.conflict_copy_created.is_none() {
        d.poll(&ctx);
        assert!(Instant::now() < deadline, "save_conflict_copy timed out");
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(!d.cloud_conflict());
    assert!(!d.dirty);
    assert_eq!(
        d.take_conflict_copy_created(),
        Some(PathBuf::from("docs/plan (conflict copy).md"))
    );
    assert_eq!(
        hosted.get("docs/plan (conflict copy).md").as_deref(),
        Some("precious mine v4\n")
    );
    assert_eq!(hosted.get("docs/plan.md").as_deref(), Some("remote v4\n"));
    assert_eq!(d.document.as_ref().unwrap().text, "remote v4\n");
}

/// `DP-31`: mixed/`CR` line endings open read-only with `HostMessage::Policy`,
/// and `normalize_open_line_endings` thaws the editor and writes normalized bytes.
#[test]
fn dp31_mixed_line_endings_open_readonly_until_explicitly_normalized() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(
        temp.path().join("mixed.copy_txt"),
        b"first\r\nsecond\nthird\r",
    )
    .unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let ctx = Wake::default();
    let mut d = Documents::in_workspace(ws);
    d.begin(Intent::OpenFile("mixed.copy_txt".into()), &ctx);
    wait(&mut d, &ctx);
    assert!(
        d.document
            .as_ref()
            .unwrap()
            .requires_line_ending_normalization()
    );
    assert!(d.outgoing.iter().any(|m| matches!(
        m,
        HostMessage::Policy {
            requires_line_ending_normalization: true,
            ..
        }
    )));
    d.outgoing.clear();
    d.normalize_open_line_endings(&ctx);
    assert!(
        !d.document
            .as_ref()
            .unwrap()
            .requires_line_ending_normalization()
    );
    assert!(d.outgoing.iter().any(|m| matches!(
        m,
        HostMessage::Policy {
            requires_line_ending_normalization: false,
            lossy_readonly: false,
            ..
        }
    )));
    d.flush_pending_auto_save(&ctx);
    let req = d.autosave_request.expect("normalization autosave").0;
    reply(&mut d, &ctx, req, 0, "first\nsecond\nthird\n");
    wait(&mut d, &ctx);
    assert_eq!(
        std::fs::read(temp.path().join("mixed.copy_txt")).unwrap(),
        b"first\nsecond\nthird\n"
    );
}

/// `DP-10` & `DP-11`: normal autosaves never touch `DraftJournal`; unflushable
/// states (`SaveFailed`, `OutcomeUnknown`, `StaleLease`, `ConflictPending`)
/// journal within `1s`, delete on save/discard, recover on reopen, and clear
/// hosted entries on Cloud sign-out.
#[test]
fn dp10_dp11_draft_journal_lifecycle_simulated_crash_recovery_and_signout_purge() {
    use crate::platform::draft_journal::{DraftEntry, DraftReason};
    let journal_dir = tempfile::tempdir().unwrap();
    let journal = DraftJournal::new(journal_dir.path());
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("local.md"), "v1\n").unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let ctx = Wake::default();
    let mut local = Documents::in_workspace_with_journal(ws.clone(), Some(journal.clone()));
    local.begin(Intent::OpenFile("local.md".into()), &ctx);
    wait(&mut local, &ctx);
    let local_doc = local.document.as_ref().unwrap().clone();
    let local_id = local_doc.id.clone();
    let (local_ws_key, local_res_key) = drafts::journal_keys(&local_doc);

    // 1. Normal dirty typing + normal autosave writes zero journal entries.
    local.client(
        ClientMessage::LiveBuffer {
            id: local_id.clone(),
            revision: 1,
            text: Buffer::new("normal edit\n"),
        },
        &ctx,
    );
    local.client(
        ClientMessage::Dirty {
            id: local_id,
            revision: 1,
            dirty: true,
        },
        &ctx,
    );
    local.poll_at(&ctx, Instant::now() + Duration::from_secs(2));
    assert!(
        journal
            .list_workspace_entries(&local_ws_key)
            .unwrap()
            .is_empty(),
        "normal autosave must not hit the crash journal"
    );
    let req = local.autosave_request.unwrap().0;
    reply(&mut local, &ctx, req, 1, "normal edit\n");
    wait(&mut local, &ctx);
    assert!(
        journal
            .list_workspace_entries(&local_ws_key)
            .unwrap()
            .is_empty()
    );

    // 2. Hosted unflushable states (`OutcomeUnknown`, `ConflictPending`) write within 1s,
    //    crash recovery with matching baseline restores draft + notice, and sign-out clears hosted entries.
    let hosted = HostedFake::new("cloud://acct/proj/", &[("doc.md", "base\n")]);
    let hosted_ws = Workspace::from_provider(hosted.clone()).unwrap();
    let mut cloud = Documents::in_workspace_with_journal(hosted_ws.clone(), Some(journal.clone()));
    cloud.begin(Intent::OpenFile("doc.md".into()), &ctx);
    wait(&mut cloud, &ctx);
    let hosted_doc = cloud.document.as_ref().unwrap().clone();
    let (hosted_ws_key, hosted_res_key) = drafts::journal_keys(&hosted_doc);
    *hosted.fail_next_write.lock().unwrap() = Some(workspace::ErrorKind::OutcomeUnknown);
    cloud.begin(Intent::Save, &ctx);
    snapshot(&mut cloud, &ctx, "crash safe cloud draft\n");
    let settle_err = Instant::now() + Duration::from_secs(5);
    while cloud.save_error.is_none() {
        cloud.poll(&ctx);
        assert!(Instant::now() < settle_err);
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(
        cloud.save_error_kind,
        Some(workspace::ErrorKind::OutcomeUnknown)
    );
    // Advance past 1s journal debounce and wait for async journal write.
    let after_1s = Instant::now() + drafts::JOURNAL_WRITE_DELAY + Duration::from_millis(20);
    let journal_deadline = Instant::now() + Duration::from_secs(5);
    while journal
        .read_entry(&hosted_ws_key, &hosted_res_key)
        .unwrap()
        .is_none()
    {
        cloud.poll_at(&ctx, after_1s);
        assert!(
            Instant::now() < journal_deadline,
            "journal write did not complete"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(
        journal
            .read_entry(&hosted_ws_key, &hosted_res_key)
            .unwrap()
            .unwrap()
            .reason,
        DraftReason::OutcomeUnknown
    );

    // Simulate process crash (`drop(cloud)`) and reopen with matching baseline:
    drop(cloud);
    let mut recovered =
        Documents::in_workspace_with_journal(hosted_ws.clone(), Some(journal.clone()));
    recovered.begin(Intent::OpenFile("doc.md".into()), &ctx);
    let open_deadline = Instant::now() + Duration::from_secs(5);
    while recovered.busy() {
        recovered.poll(&ctx);
        assert!(Instant::now() < open_deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(recovered.recovered_draft_notice.is_some());
    assert!(recovered.dirty);
    assert!(!recovered.cloud_conflict());
    assert!(recovered.outgoing.iter().any(|m| matches!(
        m,
        HostMessage::Open { text, .. } if text == "crash safe cloud draft\n"
    )));
    // Once saved cleanly, the journal entry is deleted immediately!
    recovered.begin(Intent::Save, &ctx);
    let Phase::Snapshot { request, .. } = recovered.phase else {
        panic!("expected save snapshot");
    };
    reply(&mut recovered, &ctx, request, 1, "crash safe cloud draft\n");
    wait(&mut recovered, &ctx);
    assert!(
        journal
            .read_entry(&hosted_ws_key, &hosted_res_key)
            .unwrap()
            .is_none()
    );

    // Simulate crash with diverged remote storage on reopen (`DP-11` -> `DP-05` conflict):
    journal
        .write_entry(&DraftEntry {
            workspace_key: hosted_ws_key.clone(),
            resource_key: hosted_res_key.clone(),
            path: PathBuf::from("doc.md"),
            baseline_hash: blake3::hash(b"crash safe cloud draft\n")
                .to_hex()
                .to_string(),
            draft_text: "offline edits\n".into(),
            reason: DraftReason::Offline,
            updated_at_ms: 1000,
        })
        .unwrap();
    hosted.set("doc.md", "diverged remote\n");
    let mut diverged = Documents::in_workspace_with_journal(hosted_ws, Some(journal.clone()));
    diverged.begin(Intent::OpenFile("doc.md".into()), &ctx);
    wait(&mut diverged, &ctx);
    assert!(diverged.cloud_conflict());
    assert_eq!(
        diverged.conflict_state().unwrap().ours.as_str(),
        "offline edits\n"
    );
    assert_eq!(
        diverged.conflict_state().unwrap().theirs.as_str(),
        "diverged remote\n"
    );

    // Also plant a local file:// entry and verify sign-out clears ONLY hosted entries.
    journal
        .write_entry(&DraftEntry {
            workspace_key: local_ws_key.clone(),
            resource_key: local_res_key.clone(),
            path: PathBuf::from("local.md"),
            baseline_hash: "abc".into(),
            draft_text: "local unflushable\n".into(),
            reason: DraftReason::SaveFailed,
            updated_at_ms: 1001,
        })
        .unwrap();
    diverged.clear_hosted_drafts();
    let clear_deadline = Instant::now() + Duration::from_secs(5);
    while journal
        .read_entry(&hosted_ws_key, &hosted_res_key)
        .unwrap()
        .is_some()
    {
        assert!(Instant::now() < clear_deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(
        journal
            .read_entry(&local_ws_key, &local_res_key)
            .unwrap()
            .is_some(),
        "local file:// recovery entry must survive Cloud sign-out"
    );
}

/// `DP-41` & `DP-42`: bounded worker pool never spawns more than `POOL_WORKERS`
/// threads under bursty saves/observations, and snapshot barriers schedule one
/// exact `SNAPSHOT_TIMEOUT` deadline rather than `100ms` ticks.
#[test]
fn dp41_dp42_bounded_executor_thread_ceiling_and_exact_deadline_scheduling() {
    let hosted = HostedFake::new("cloud://acct/pool-test/", &[("a.md", "v0\n")]);
    let ws = Workspace::from_provider(hosted.clone()).unwrap();
    let ctx = Wake::default();
    let mut copies: Vec<Documents> = (0..16)
        .map(|_| {
            let mut c = Documents::in_workspace(ws.clone());
            c.begin(Intent::OpenFile("a.md".into()), &ctx);
            c
        })
        .collect();
    for c in &mut copies {
        wait(c, &ctx);
        assert!(c.error.is_none());
    }
    hosted.set("a.md", "v1\n");
    for c in &mut copies {
        c.revalidate();
        c.poll(&ctx);
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while copies
        .iter()
        .any(|c| c.document.as_ref().unwrap().text != "v1\n")
    {
        for c in &mut copies {
            c.poll_at(&ctx, Instant::now() + OBSERVATION_RETRIES[0]);
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(io::DocumentIoPool::global().spawned_threads() <= io::POOL_WORKERS);

    let (_temp, mut d, _) = setup();
    let probe_wake = Wake::default();
    d.begin(Intent::Quit, &probe_wake);
    assert!(matches!(d.phase, Phase::Snapshot { .. }));
    // Polling repeatedly before the 5s deadline does not arm 100ms ticks or fail early.
    d.poll_at(&probe_wake, Instant::now() + Duration::from_millis(250));
    assert!(matches!(d.phase, Phase::Snapshot { .. }));
    assert!(d.error.is_none());
}

#[test]
fn rg01_rg02_rg03_sniffing_oversized_in_pane_card_and_readonly_large_text() {
    let temp = tempfile::tempdir().unwrap();
    // 1. Extensionless PNG & UTF-8 text files route via content sniffing (`RG-01`).
    std::fs::write(
        temp.path().join("README_PNG"),
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01",
    )
    .unwrap();
    std::fs::write(temp.path().join("NOTES_PLAIN"), "sniffed utf8 line\n").unwrap();
    // 2. Oversized HTML (> 4 MiB) opens `HostMessage::Oversized` without failing `d.error` (`RG-02`).
    let over_html = std::fs::File::create(temp.path().join("huge.html")).unwrap();
    over_html.set_len(5 * 1024 * 1024).unwrap();
    // 3. Large plain text (17 MiB > 16 MiB edit budget, <= 64 MiB ceiling) opens ReadOnlyLarge (`RG-03`).
    let mut big_txt = vec![b'a'; 17 * 1024 * 1024];
    big_txt[0..5].copy_from_slice(b"HEAD:");
    std::fs::write(temp.path().join("server.log"), &big_txt).unwrap();

    let ws = Workspace::open(temp.path()).unwrap();
    let ctx = Wake::default();
    let mut d = Documents::in_workspace(ws);

    d.begin(Intent::OpenFile("README_PNG".into()), &ctx);
    wait(&mut d, &ctx);
    assert!(d.error.is_none());
    assert!(d.resource.is_some());
    assert_eq!(d.sniffed_format.map(|f| f.id.as_str()), Some("png"));

    d.outgoing.clear();
    d.begin(Intent::OpenFile("NOTES_PLAIN".into()), &ctx);
    wait(&mut d, &ctx);
    assert!(d.error.is_none());
    assert_eq!(d.document.as_ref().unwrap().text, "sniffed utf8 line\n");
    assert_eq!(
        d.sniffed_format.map(|f| f.id.as_str()),
        Some("text-unknown")
    );

    d.outgoing.clear();
    d.begin(Intent::OpenFile("huge.html".into()), &ctx);
    // Drain open first if previous doc was open.
    if let Some(req) = d.outgoing.iter().find_map(|m| match m {
        HostMessage::Snapshot { request, .. } => Some(*request),
        _ => None,
    }) {
        reply(&mut d, &ctx, req, 0, "sniffed utf8 line\n");
    }
    wait(&mut d, &ctx);
    assert!(
        d.error.is_none(),
        "RG-02 must NOT fail with workspace error"
    );
    assert_eq!(d.opened().map(|(_, p)| p), Some(Path::new("huge.html")));
    assert!(d.outgoing.iter().any(|m| matches!(
        m,
        HostMessage::Oversized {
            size_bytes: 5_242_880,
            limit_bytes: 4_194_304,
            can_reveal_in_finder: true,
            ..
        }
    )));

    d.outgoing.clear();
    d.begin(Intent::OpenFile("server.log".into()), &ctx);
    wait(&mut d, &ctx);
    assert!(d.error.is_none());
    assert!(d.read_only_large.is_some());
    assert!(
        d.outgoing
            .iter()
            .any(|m| matches!(m, HostMessage::ReadOnlyLarge { .. }))
    );
}
