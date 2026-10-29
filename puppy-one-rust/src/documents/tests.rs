use super::*;
use std::path::Path;
use tempfile::TempDir;
fn setup() -> (TempDir, Documents, Wake) {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), b"original").unwrap();
    std::fs::write(temp.path().join("b.md"), b"second").unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let doc = ws.read(Path::new("a.md")).unwrap();
    let d = Documents {
        workspace: Some(ws),
        document: Some(doc),
        ..Default::default()
    };
    (temp, d, Wake::default())
}
fn reply(d: &mut Documents, ctx: &Wake, request: u64, revision: u64, text: &str) {
    d.client(
        ClientMessage::Snapshot {
            request,
            id: d.document.as_ref().unwrap().id.clone(),
            revision,
            text: text.into(),
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
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        d.poll(ctx);
        if (!d.busy() && !d.saving()) || d.error.is_some() {
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
fn local_edit_automatically_snapshots_without_freezing_and_writes_real_file() {
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
    let doc = d
        .workspace
        .as_ref()
        .unwrap()
        .observe(d.document.as_ref().unwrap())
        .unwrap();
    d.tx.send(Completed::Observed {
        id: doc.id.clone(),
        generation: d.read_generation,
        result: Ok(doc),
    })
    .unwrap();
    d.poll(&ctx);
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
    d.begin(Intent::Save, &ctx);
    snapshot(&mut d, &ctx, "latest");
    wait(&mut d, &ctx);
    d.tx.send(Completed::Observed {
        id: old.id.clone(),
        generation,
        result: Ok(old),
    })
    .unwrap();
    d.poll(&ctx);
    assert_eq!(d.document.as_ref().unwrap().text, "latest");
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
            text: "wrong".into(),
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
            text: "x".repeat(MAX_TEXT_BYTES + 1),
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
    let mut d = Documents {
        workspace: Some(ws),
        ..Default::default()
    };
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
    d.read_generation += 1; // A save receipt superseded the in-flight read.
    std::fs::write(temp.path().join("a.md"), "new baseline").unwrap();
    d.tx.send(Completed::Observed {
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
    let mut d = Documents {
        workspace: Some(first.clone()),
        ..Default::default()
    };
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
    let mut d = Documents {
        workspace: Some(first.clone()),
        ..Default::default()
    };
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
    use crate::{platform::webview::ResourceSource, workspace::testing::Memory};
    let memory = Arc::new(Memory::new("memory://actor/project/"));
    let ws = Workspace::from_provider(memory.clone()).unwrap();
    let ctx = Wake::default();
    let mut d = Documents {
        workspace: Some(ws),
        ..Default::default()
    };
    d.begin(Intent::OpenFile("note.md".into()), &ctx);
    wait(&mut d, &ctx);
    assert!(d.error.is_none(), "{:?}", d.error);
    let id = d.document.as_ref().expect("a text document").id.clone();
    let source = crate::editor::registry::document_source(&id).expect("a provider source");
    assert!(source.read(Path::new("logo.png")).is_some());
    assert!(crate::editor::registry::document_folder(&id).is_none());
    // A local document keeps its folder and has no provider source.
    let (_temp, mut local, ctx) = setup();
    local.begin(Intent::OpenFile("a.md".into()), &ctx);
    wait(&mut local, &ctx);
    let id = local.document.as_ref().unwrap().id.clone();
    assert!(crate::editor::registry::document_source(&id).is_none());
}
