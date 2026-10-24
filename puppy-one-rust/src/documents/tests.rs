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
        ready: true,
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
    for provider in [EditorProvider::Native, EditorProvider::Web] {
        let (temp, mut d, ctx) = setup();
        d.provider = provider;
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
                .any(|v| v["kind"] == "snapshot" && v["freeze"] == false)
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
    assert!(d.outgoing.iter().any(|v| v["kind"] == "thaw"));
}
#[test]
fn observed_disk_change_replaces_model_without_a_write_or_conflict_error() {
    let (temp, mut d, ctx) = setup();
    d.ensure_session();
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
    assert!(d.outgoing.iter().any(|v| v["external"] == true));
}
#[test]
fn read_started_before_save_receipt_cannot_restore_old_content() {
    let (_temp, mut d, ctx) = setup();
    d.ensure_session();
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
fn provider_handoff_preserves_buffer_and_uses_the_same_autosave_session() {
    let (temp, mut d, ctx) = setup();
    d.begin(Intent::SwitchEditor(EditorProvider::Native), &ctx);
    snapshot(&mut d, &ctx, "shared input");
    assert_eq!(d.provider, EditorProvider::Native);
    let id = d.document.as_ref().unwrap().id.clone();
    assert!(d.outgoing.iter().any(|m| m["kind"] == "open"
        && m["text"] == "shared input"
        && m["baseline"] == "original"));
    d.client_from(
        EditorProvider::Web,
        ClientMessage::Dirty {
            id: id.clone(),
            revision: 999,
            dirty: false,
        },
        &ctx,
    );
    assert_eq!(d.revision, 1);
    d.client(
        ClientMessage::Loaded {
            id: id.clone(),
            transfer: None,
        },
        &ctx,
    );
    assert!(d.busy());
    d.client(
        ClientMessage::Loaded {
            id,
            transfer: Some(d.serial),
        },
        &ctx,
    );
    wait(&mut d, &ctx);
    assert!(!d.dirty);
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "shared input"
    );
}
#[test]
fn failed_handoff_returns_to_previous_surface() {
    let (_temp, mut d, ctx) = setup();
    d.provider = EditorProvider::Native;
    d.begin(Intent::SwitchEditor(EditorProvider::Web), &ctx);
    snapshot(&mut d, &ctx, "mine");
    d.client(
        ClientMessage::Fault {
            message: "target unavailable".into(),
        },
        &ctx,
    );
    assert_eq!(d.provider, EditorProvider::Native);
    assert!(!d.busy());
    assert!(d.error.is_some());
    assert_eq!(d.outgoing.last().unwrap()["kind"], "thaw");
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
