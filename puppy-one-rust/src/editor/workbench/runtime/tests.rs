use super::*;
use crate::{
    editor::text::buffer::Buffer,
    platform::{draft_journal::DraftJournal, editor_state_storage::Storage},
};
use std::time::{Duration, Instant};
#[path = "lifecycle_tests.rs"]
mod lifecycle;
fn wait(r: &mut Runtime, done: impl Fn(&Runtime) -> bool) {
    let wake = Wake::default();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        r.poll(&wake);
        if done(r) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "metadata/runtime timeout: {:?}",
            r.error
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn open_root(r: &mut Runtime, path: &std::path::Path) {
    r.begin(Intent::OpenFolder(path.into()), &Wake::default());
    wait(r, |r| {
        r.active.is_some() && r.hosts.values().all(|h| h.metadata_loaded)
    });
}
fn open(r: &mut Runtime, name: &str) {
    r.begin(Intent::OpenFile(name.into()), &Wake::default());
    wait(r, |r| {
        r.opened()
            .is_some_and(|(_, p)| p == std::path::Path::new(name))
    });
}
fn snapshots(r: &mut Runtime, content: impl Fn(&str) -> String) {
    for (slot, message) in r.take_outgoing() {
        if let HostMessage::Snapshot {
            request,
            freeze: true,
        } = message
        {
            let document = r.slot(slot).unwrap().document.as_ref().unwrap();
            r.client_for(
                slot,
                ClientMessage::Snapshot {
                    request,
                    id: document.id.clone(),
                    revision: 1,
                    text: Buffer::new(content(document.relative.to_str().unwrap())),
                },
                &Wake::default(),
            );
        }
    }
}
#[test]
fn unknown_resource_result_blocks_its_paths_but_allows_unrelated_navigation() {
    use super::super::resource_operations::Operation;
    let root = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md", "unrelated.md"] {
        std::fs::write(root.path().join(name), name).unwrap();
    }
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    let slot = r.active_slot();
    r.resource_operation(
        Operation::Rename {
            path: "a.md".into(),
            name: "b.md".into(),
        },
        &Wake::default(),
    )
    .unwrap();
    snapshots(&mut r, |path| path.into());
    wait(&mut r, |r| r.can_retry_operation());
    assert!(r.slot(slot).unwrap().operation_ready());
    assert!(!r.busy());
    open(&mut r, "unrelated.md");
    let active = r.active_slot();
    r.begin(Intent::OpenFile("a.md".into()), &Wake::default());
    assert_eq!(r.active_slot(), active);
    assert!(
        r.error
            .as_ref()
            .is_some_and(|error| error.contains("pending file operation"))
    );
    std::fs::remove_file(root.path().join("b.md")).unwrap();
    r.retry_operation(&Wake::default());
    wait(&mut r, |r| r.operations_idle());
    assert!(!r.slot(slot).unwrap().busy());
    assert!(root.path().join("a.md").exists());
    assert!(
        !root.path().join("b.md").exists(),
        "reconciliation must never repeat the rename"
    );
}
#[test]
fn resource_barrier_waits_for_composition_and_cannot_be_stolen_by_close() {
    use super::super::resource_operations::Operation;
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("a.md"), "old").unwrap();
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    let slot = r.active_slot();
    let id = r.document.as_ref().unwrap().id.clone();
    r.resource_operation(
        Operation::Rename {
            path: "a.md".into(),
            name: "b.md".into(),
        },
        &Wake::default(),
    )
    .unwrap();
    for (_, message) in r.take_outgoing() {
        if let HostMessage::Snapshot {
            request,
            freeze: true,
        } = message
        {
            r.client_for(
                slot,
                ClientMessage::Deferred {
                    request,
                    id: id.clone(),
                },
                &Wake::default(),
            );
        }
    }
    r.close_slot(slot, &Wake::default());
    r.poll(&Wake::default());
    assert!(root.path().join("a.md").exists() && !root.path().join("b.md").exists());
    assert!(!r.hosts[r.active.as_ref().unwrap()].slots[&slot].closing);
    r.client_for(
        slot,
        ClientMessage::Dirty {
            id: id.clone(),
            revision: 1,
            dirty: true,
        },
        &Wake::default(),
    );
    snapshots(&mut r, |_| "中文组字".into());
    wait(&mut r, |r| r.operations_idle());
    assert_eq!(
        std::fs::read_to_string(root.path().join("b.md")).unwrap(),
        "中文组字"
    );
    assert_eq!(r.slot(slot).unwrap().document.as_ref().unwrap().id, id);
}
#[test]
fn explorer_drop_reuses_visible_views_and_places_new_documents_at_the_requested_edge() {
    use super::super::layout::{Direction, Placement};
    let root = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md", "c.md"] {
        std::fs::write(root.path().join(name), name).unwrap();
    }
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    let first = r.active_slot();
    let pane = r.state().unwrap().layout.active.clone();
    r.open_at_edge(
        "b.md".into(),
        &pane,
        Direction::Vertical,
        Placement::First,
        &Wake::default(),
    );
    wait(&mut r, |r| {
        r.opened()
            .is_some_and(|(_, path)| path == std::path::Path::new("b.md"))
    });
    assert_eq!(r.visible_slots(), vec![r.active_slot(), first]);
    let layout = r.state().unwrap().layout.clone();
    r.open_at_edge(
        "b.md".into(),
        &pane,
        Direction::Horizontal,
        Placement::Second,
        &Wake::default(),
    );
    assert_eq!(r.state().unwrap().layout, layout);
    r.state_mut().unwrap().split(Direction::Horizontal);
    let empty = r.state().unwrap().layout.active.clone();
    let count = r.state().unwrap().layout.root.panes().len();
    r.open_at_edge(
        "c.md".into(),
        &empty,
        Direction::Horizontal,
        Placement::First,
        &Wake::default(),
    );
    wait(&mut r, |r| {
        r.opened()
            .is_some_and(|(_, path)| path == std::path::Path::new("c.md"))
    });
    assert_eq!(r.state().unwrap().layout.root.panes().len(), count);
    assert_eq!(r.state().unwrap().layout.active, empty);
}
#[test]
fn delayed_drop_cannot_attach_to_a_removed_and_recreated_pane_id() {
    use super::super::layout::{Direction, Placement};
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("a.md"), "a").unwrap();
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    r.state_mut().unwrap().split(Direction::Horizontal);
    let target = r.state().unwrap().layout.active.clone();
    r.open_at_edge(
        "a.md".into(),
        &target,
        Direction::Horizontal,
        Placement::Second,
        &Wake::default(),
    );
    r.state_mut().unwrap().close_pane(&target);
    r.state_mut().unwrap().split(Direction::Horizontal);
    assert_eq!(
        r.state().unwrap().layout.active,
        target,
        "the layout reuses the textual pane ID"
    );
    wait(&mut r, |r| r.hosts.values().all(|h| h.slots.is_empty()));
    assert!(r.state().unwrap().catalog.editors.is_empty());
    assert!(
        r.state()
            .unwrap()
            .layout
            .root
            .panes()
            .iter()
            .all(|(_, editor)| editor.is_none())
    );
}
#[test]
fn drop_read_failure_does_not_create_a_pane_and_a_resize_does_not_cancel_admission() {
    use super::super::layout::{Direction, Placement};
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("a.md"), "a").unwrap();
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    r.state_mut().unwrap().split(Direction::Horizontal);
    let target = r.state().unwrap().layout.active.clone();
    let layout = r.state().unwrap().layout.clone();
    r.open_at_edge(
        "missing.md".into(),
        &target,
        Direction::Horizontal,
        Placement::Second,
        &Wake::default(),
    );
    wait(&mut r, |r| r.error.is_some());
    assert_eq!(r.state().unwrap().layout, layout);
    r.open_at_edge(
        "a.md".into(),
        &target,
        Direction::Horizontal,
        Placement::Second,
        &Wake::default(),
    );
    r.state_mut().unwrap().layout.resize("editor-split-1", 0.7);
    wait(&mut r, |r| r.opened().is_some());
    assert_eq!(r.state().unwrap().layout.active, target);
    assert_eq!(r.state().unwrap().layout.root.panes().len(), 2);
}
#[test]
fn copying_a_directory_flushes_hidden_working_copies_without_replacing_them() {
    use super::super::resource_operations::Operation;
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("folder")).unwrap();
    for name in ["folder/a.md", "folder/b.md"] {
        std::fs::write(root.path().join(name), "old").unwrap();
    }
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    open(&mut r, "folder/a.md");
    let first = r.active_slot();
    let id = r.document.as_ref().unwrap().id.clone();
    open(&mut r, "folder/b.md");
    let active = r.active_slot();
    let state = r.state().unwrap().clone();
    r.resource_operation(
        Operation::Duplicate(vec!["folder".into(), "folder/a.md".into()]),
        &Wake::default(),
    )
    .unwrap();
    snapshots(&mut r, |path| format!("edited {path}"));
    wait(&mut r, |r| r.operations_idle());
    let outcome = r.operation_results.pop().unwrap().1;
    assert!(outcome.error.is_none(), "{:?}", outcome.error);
    let copy = outcome.select.unwrap();
    for name in ["a.md", "b.md"] {
        assert_eq!(
            std::fs::read_to_string(root.path().join(&copy).join(name)).unwrap(),
            format!("edited folder/{name}")
        );
    }
    assert_eq!(r.active_slot(), active);
    assert_eq!(r.state(), Some(&state));
    assert_eq!(r.slot(first).unwrap().document.as_ref().unwrap().id, id);
    assert!(
        r.hosts
            .values()
            .flat_map(|h| h.slots.values())
            .all(|s| !s.files.busy())
    );
}
#[test]
fn failed_snapshot_cancels_the_mutation_and_thaws_every_affected_document() {
    use super::super::resource_operations::Operation;
    let root = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md"] {
        std::fs::write(root.path().join(name), "original").unwrap();
    }
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    open(&mut r, "b.md");
    let state = r.state().unwrap().clone();
    r.resource_operation(
        Operation::Delete(vec!["a.md".into(), "b.md".into()]),
        &Wake::default(),
    )
    .unwrap();
    snapshots(&mut r, |path| {
        if path == "a.md" {
            "\0invalid".into()
        } else {
            "original".into()
        }
    });
    wait(&mut r, |r| r.operations_idle());
    assert!(r.operation_results.last().unwrap().1.error.is_some());
    assert_eq!(r.state(), Some(&state));
    assert!(
        r.hosts
            .values()
            .flat_map(|h| h.slots.values())
            .all(|s| !s.files.busy())
    );
    for name in ["a.md", "b.md"] {
        assert_eq!(
            std::fs::read_to_string(root.path().join(name)).unwrap(),
            "original"
        );
    }
}
#[test]
fn move_rebinds_its_original_project_even_if_another_project_is_active() {
    use super::super::resource_operations::Operation;
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    std::fs::write(first.path().join("old.md"), "old").unwrap();
    let mut r = Runtime::default();
    open_root(&mut r, first.path());
    open(&mut r, "old.md");
    let owner = r.active.clone().unwrap();
    let slot = r.active_slot();
    r.resource_operation(
        Operation::Rename {
            path: "old.md".into(),
            name: "new.md".into(),
        },
        &Wake::default(),
    )
    .unwrap();
    r.begin(Intent::OpenFolder(second.path().into()), &Wake::default());
    wait(&mut r, |r| r.active.as_ref() != Some(&owner));
    let current = r.active.clone();
    snapshots(&mut r, |_| "saved before moving".into());
    wait(&mut r, |r| r.operations_idle());
    assert_eq!(r.active, current);
    assert_eq!(
        r.slot(slot).unwrap().opened().unwrap().1,
        std::path::Path::new("new.md")
    );
    assert_eq!(r.hosts[&owner].state.catalog.editors[0].label, "new.md");
    assert_eq!(
        std::fs::read_to_string(first.path().join("new.md")).unwrap(),
        "saved before moving"
    );
    assert!(!first.path().join("old.md").exists());
}
#[test]
fn a_destination_with_an_open_working_copy_rejects_the_move_before_freezing() {
    use super::super::resource_operations::Operation;
    let root = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md"] {
        std::fs::write(root.path().join(name), name).unwrap();
    }
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    open(&mut r, "b.md");
    assert!(
        r.resource_operation(
            Operation::Rename {
                path: "a.md".into(),
                name: "b.md".into()
            },
            &Wake::default()
        )
        .is_err()
    );
    assert!(r.operations_idle());
    assert!(!r.busy());
    for name in ["a.md", "b.md"] {
        assert_eq!(
            std::fs::read_to_string(root.path().join(name)).unwrap(),
            name
        );
    }
}
#[test]
fn native_metadata_roundtrip_restores_order_mru_panes_and_ratio_after_provider_admission() {
    let profile = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md"] {
        std::fs::write(root.path().join(name), name).unwrap();
    }
    let mut r = Runtime {
        storage: Some(Storage::at(profile.path().into())),
        ..Default::default()
    };
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    r.state_mut()
        .unwrap()
        .split(super::super::layout::Direction::Horizontal);
    open(&mut r, "b.md");
    r.state_mut().unwrap().layout.resize("editor-split-1", 0.72);
    let expected = r.state().unwrap().clone();
    wait(&mut r, |r| {
        r.metadata_inflight == 0 && r.hosts.values().all(|h| h.metadata_due.is_none())
    });
    drop(r);
    let mut restored = Runtime {
        storage: Some(Storage::at(profile.path().into())),
        ..Default::default()
    };
    open_root(&mut restored, root.path());
    wait(&mut restored, |r| {
        r.state().unwrap().catalog.editors.len() == 2
    });
    assert_eq!(restored.state(), Some(&expected));
    assert_eq!(restored.visible_slots().len(), 2);
    assert!(
        restored
            .hosts
            .values()
            .flat_map(|h| h.slots.values())
            .all(|s| s.files.document.is_some())
    );
}
#[test]
fn restored_folders_missing_paths_and_foreign_ids_never_become_editor_references() {
    let profile = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("a.md"), "a").unwrap();
    std::fs::create_dir(root.path().join("folder.md")).unwrap();
    let ws = workspace::Workspace::open(root.path()).unwrap();
    let key = resource_key(&ws.resource_id(std::path::Path::new("")).unwrap());
    let editors: Vec<_> = ["a.md", "folder.md", "missing.md", "../outside.md"].into_iter().map(|path| serde_json::json!({"resource":path,"id":ws.resource_id(std::path::Path::new(path)).map(|r| resource_key(&r)).unwrap_or_default()})).chain(std::iter::once(serde_json::json!({"resource":"a.md","id":"file:///foreign/a.md"}))).collect();
    std::fs::write(
        profile
            .path()
            .join(format!("{}.json", blake3::hash(key.as_bytes()).to_hex())),
        serde_json::to_vec(
            &serde_json::json!({"version":1,"group":{"editors":editors},"layout":{}}),
        )
        .unwrap(),
    )
    .unwrap();
    let mut r = Runtime {
        storage: Some(Storage::at(profile.path().into())),
        ..Default::default()
    };
    open_root(&mut r, root.path());
    wait(&mut r, |r| r.hosts.values().all(|h| h.restore.is_none()));
    assert_eq!(r.state().unwrap().catalog.editors.len(), 1);
    assert_eq!(r.state().unwrap().catalog.editors[0].label, "a.md");
    assert!(r.error.is_none());
}
#[test]
fn resize_cancel_targets_its_original_workspace_not_a_reused_split_id() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut r = Runtime::default();
    open_root(&mut r, a.path());
    let owner = r.workspace_key().unwrap().to_owned();
    r.state_mut()
        .unwrap()
        .split(super::super::layout::Direction::Horizontal);
    r.state_mut().unwrap().layout.resize("editor-split-1", 0.8);
    r.begin(Intent::OpenFolder(b.path().into()), &Wake::default());
    wait(&mut r, |r| r.workspace_key() != Some(owner.as_str()));
    r.state_mut()
        .unwrap()
        .split(super::super::layout::Direction::Vertical);
    r.state_mut().unwrap().layout.resize("editor-split-1", 0.2);
    r.cancel_resize(&owner, "editor-split-1", 0.5);
    assert_eq!(
        serde_json::to_value(&r.state().unwrap().layout).unwrap()["root"]["ratio"],
        0.2
    );
    assert_eq!(
        serde_json::to_value(&r.hosts[&owner].state.layout).unwrap()["root"]["ratio"],
        0.5
    );
}
#[test]
fn drag_preview_is_not_persisted_even_when_a_background_save_wakes_the_runtime() {
    let profile = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let mut r = Runtime {
        storage: Some(Storage::at(profile.path().into())),
        ..Default::default()
    };
    open_root(&mut r, root.path());
    r.state_mut()
        .unwrap()
        .split(super::super::layout::Direction::Horizontal);
    wait(&mut r, |r| {
        r.metadata_inflight == 0 && r.hosts.values().all(|h| h.metadata_due.is_none())
    });
    let owner = r.workspace_key().unwrap().to_owned();
    let path = profile
        .path()
        .join(format!("{}.json", blake3::hash(owner.as_bytes()).to_hex()));
    let original = std::fs::read(&path).unwrap();
    r.metadata_suspended = true;
    r.state_mut().unwrap().layout.resize("editor-split-1", 0.8);
    r.poll(&Wake::default());
    r.persist_metadata(&Wake::default(), true);
    assert_eq!(r.metadata_inflight, 0);
    assert_eq!(std::fs::read(&path).unwrap(), original);
    r.cancel_resize(&owner, "editor-split-1", 0.5);
    r.metadata_suspended = false;
    r.persist_metadata(&Wake::default(), true);
    assert_eq!(r.metadata_inflight, 0);
}
#[test]
fn cancelling_a_window_close_thaws_all_retained_pending_snapshot_barriers() {
    let root = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md"] {
        std::fs::write(root.path().join(name), name).unwrap();
    }
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    open(&mut r, "b.md");
    r.take_outgoing();
    r.begin(Intent::Quit, &Wake::default());
    assert!(
        r.hosts
            .values()
            .flat_map(|h| h.slots.values())
            .all(|s| s.files.busy())
    );
    r.cancel_quit(&Wake::default());
    assert!(
        r.hosts
            .values()
            .flat_map(|h| h.slots.values())
            .all(|s| !s.files.busy() && !s.files.allow_quit)
    );
    let resumed = r.take_outgoing();
    assert_eq!(
        resumed
            .iter()
            .filter(|(_, m)| matches!(m, HostMessage::Thaw))
            .count(),
        3
    );
    // Thawed in place: nothing is shown again, so no editor remounts.
    assert!(
        resumed.iter().all(|(_, m)| matches!(m, HostMessage::Thaw)),
        "{resumed:?}"
    );
    assert!(!r.allow_quit);
    // The documents' observers run again: a change on disk reaches the
    // retained copy as an external update.
    assert!(
        r.hosts
            .values()
            .flat_map(|h| h.slots.values())
            .all(|s| s.files.watching())
    );
    std::fs::write(
        root.path().join("a.md"),
        "changed after the cancelled close",
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        r.poll(&Wake::default());
        if r.take_outgoing().iter().any(|(_, m)| {
            matches!(m, HostMessage::Open { text, external: true, .. } if text == "changed after the cancelled close")
        }) {
            break;
        }
        assert!(Instant::now() < deadline, "the observer did not resume");
        std::thread::sleep(Duration::from_millis(5));
    }
}
#[test]
fn file_operations_queue_by_resource_scope() {
    use super::super::resource_operations::Operation;
    let root = tempfile::tempdir().unwrap();
    for name in ["a.md", "other.md", "spare.md"] {
        std::fs::write(root.path().join(name), name).unwrap();
    }
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    let rename = |path: &str, name: &str| Operation::Rename {
        path: path.into(),
        name: name.into(),
    };
    // The first rename waits for its open document's snapshot; a rename of
    // its destination waits behind it, a disjoint delete runs at once.
    r.resource_operation(rename("a.md", "b.md"), &Wake::default())
        .unwrap();
    r.resource_operation(rename("b.md", "c.md"), &Wake::default())
        .unwrap();
    r.resource_operation(Operation::Delete(vec!["other.md".into()]), &Wake::default())
        .unwrap();
    assert_eq!((r.mutations.len(), r.queued.len()), (2, 1));
    assert!(r.mutation_blocks(std::path::Path::new("b.md")));
    assert!(!r.mutation_blocks(std::path::Path::new("spare.md")));
    // Each prepared operation drains the open document again.
    let deadline = Instant::now() + Duration::from_secs(5);
    while !r.operations_idle() {
        snapshots(&mut r, |path| format!("saved {path}"));
        r.poll(&Wake::default());
        assert!(Instant::now() < deadline, "{:?}", r.error);
        std::thread::sleep(Duration::from_millis(2));
    }
    let errors: Vec<_> = r
        .operation_results
        .iter()
        .filter_map(|(_, o)| o.error.clone())
        .collect();
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(r.operation_results.len(), 3);
    assert_eq!(
        std::fs::read_to_string(root.path().join("c.md")).unwrap(),
        "saved b.md"
    );
    assert!(!root.path().join("b.md").exists() && !root.path().join("other.md").exists());
    assert_eq!(
        r.opened().map(|(_, p)| p.to_path_buf()),
        Some("c.md".into())
    );
}
#[test]
fn an_unreconciled_operation_refuses_overlapping_ones_only() {
    use super::super::resource_operations::Operation;
    let root = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md", "unrelated.md"] {
        std::fs::write(root.path().join(name), name).unwrap();
    }
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    // The destination exists: the provider's answer is not a clean refusal
    // the runtime can trust, so the outcome stays unknown (see above).
    r.resource_operation(
        Operation::Rename {
            path: "a.md".into(),
            name: "b.md".into(),
        },
        &Wake::default(),
    )
    .unwrap();
    snapshots(&mut r, |path| path.into());
    wait(&mut r, |r| r.can_retry_operation());
    let error = r
        .resource_operation(Operation::Delete(vec!["a.md".into()]), &Wake::default())
        .unwrap_err();
    assert!(error.contains("reconciled first"), "{error}");
    r.resource_operation(
        Operation::Delete(vec!["unrelated.md".into()]),
        &Wake::default(),
    )
    .unwrap();
    wait(&mut r, |r| r.mutations.len() == 1 && r.queued.is_empty());
    assert!(!root.path().join("unrelated.md").exists());
    assert!(r.can_retry_operation());
}
/// `finishInterceptedClose`: a close a document cannot save for is refused
/// (the shell asks), and "Close Anyway" lets the window go.
#[cfg(unix)]
#[test]
fn a_close_a_document_cannot_save_for_is_refused_until_abandoned() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("a.md");
    std::fs::write(&file, "a").unwrap();
    let lock = |mode| {
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(mode | 0o100))
            .unwrap();
    };
    // Read-only from the start: a change of mode is itself an observation.
    lock(0o444);
    let mut r = Runtime::default();
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    r.take_outgoing();
    // An edit the close has to save.
    let slot = r.active_slot();
    let doc = r.slot(slot).unwrap().document.as_ref().unwrap().clone();
    let id = doc.id.clone();
    r.client_for(
        slot,
        ClientMessage::Dirty {
            id,
            revision: 2,
            dirty: true,
        },
        &Wake::default(),
    );
    let answer = |r: &mut Runtime| {
        for (slot, message) in r.take_outgoing() {
            if let HostMessage::Snapshot { request, .. } = message {
                let id = r.slot(slot).unwrap().document.as_ref().unwrap().id.clone();
                let text = Buffer::new("changed");
                let reply = ClientMessage::Snapshot {
                    request,
                    id,
                    revision: 2,
                    text,
                };
                r.client_for(slot, reply, &Wake::default());
            }
        }
    };
    r.begin(Intent::Quit, &Wake::default());
    let wake = Wake::default();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !r.close_refused {
        answer(&mut r);
        r.poll(&wake);
        assert!(Instant::now() < deadline, "the close was not refused");
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(!r.allow_quit);
    r.abandon_unsaved();
    r.poll(&wake);
    assert!(r.allow_quit && !r.close_refused);
    lock(0o644);
}

#[test]
fn standalone_file_runtime_neither_restores_nor_overwrites_its_parent_project_layout() {
    let profile = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md"] {
        std::fs::write(root.path().join(name), name).unwrap();
    }
    let mut project = Runtime {
        storage: Some(Storage::at(profile.path().into())),
        ..Default::default()
    };
    open_root(&mut project, root.path());
    open(&mut project, "a.md");
    project
        .state_mut()
        .unwrap()
        .split(super::super::layout::Direction::Horizontal);
    open(&mut project, "b.md");
    project
        .state_mut()
        .unwrap()
        .layout
        .resize("editor-split-1", 0.72);
    let expected = project.state().unwrap().clone();
    project.persist_metadata(&Wake::default(), true);
    wait(&mut project, |r| {
        r.metadata_inflight == 0 && r.hosts.values().all(|h| h.metadata_due.is_none())
    });
    let key = project.active.clone().unwrap();
    let metadata = profile
        .path()
        .join(format!("{}.json", blake3::hash(key.as_bytes()).to_hex()));
    let original = std::fs::read_to_string(&metadata).unwrap();
    drop(project);

    let mut file = Runtime {
        storage: Some(Storage::at(profile.path().into())),
        ..Default::default()
    };
    file.begin(
        Intent::OpenSingleFile(root.path().join("a.md")),
        &Wake::default(),
    );
    wait(&mut file, |r| {
        r.active.is_some() && r.hosts.values().all(|h| h.metadata_loaded)
    });
    let restored_project_slots = file
        .hosts
        .values()
        .any(|h| !h.slots.is_empty() || h.restore.is_some());
    open(&mut file, "a.md");
    for intent in [
        Intent::OpenSingleFile(root.path().join("b.md")),
        Intent::OpenFolder(profile.path().into()),
    ] {
        file.begin(intent, &Wake::default());
        assert!(file.error.take().is_some());
        assert_eq!(file.opened().unwrap().1, std::path::Path::new("a.md"));
        assert_eq!(file.hosts.len(), 1);
    }
    file.persist_metadata(&Wake::default(), true);
    wait(&mut file, |r| {
        r.metadata_inflight == 0 && r.hosts.values().all(|h| h.metadata_due.is_none())
    });
    assert_eq!(
        std::fs::read_to_string(&metadata).unwrap(),
        original,
        "a file window overwrote its parent's project layout"
    );
    assert!(
        !restored_project_slots,
        "a file window loaded parent project editors"
    );
    drop(file);

    let mut restored = Runtime {
        storage: Some(Storage::at(profile.path().into())),
        ..Default::default()
    };
    open_root(&mut restored, root.path());
    wait(&mut restored, |r| {
        r.state().unwrap().catalog.editors.len() == 2
    });
    assert_eq!(restored.state(), Some(&expected));
}

#[cfg(unix)]
#[test]
fn abandon_unsaved_persists_unflushable_draft_to_journal_and_reopen_recovers_it() {
    use std::os::unix::fs::PermissionsExt;
    let journal_dir = tempfile::tempdir().unwrap();
    let journal = DraftJournal::new(journal_dir.path());
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("a.md");
    std::fs::write(&file, "baseline").unwrap();
    let lock = |mode| {
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(mode | 0o100))
            .unwrap();
    };
    lock(0o444);
    let mut r = Runtime::default();
    r.set_draft_journal(Some(journal.clone()));
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    r.take_outgoing();
    let slot = r.active_slot();
    let doc = r.slot(slot).unwrap().document.as_ref().unwrap().clone();
    let id = doc.id.clone();
    r.client_for(
        slot,
        ClientMessage::Dirty {
            id: id.clone(),
            revision: 2,
            dirty: true,
        },
        &Wake::default(),
    );
    r.begin(Intent::Quit, &Wake::default());
    let wake = Wake::default();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !r.close_refused {
        for (slot, message) in r.take_outgoing() {
            if let HostMessage::Snapshot { request, .. } = message {
                r.client_for(
                    slot,
                    ClientMessage::Snapshot {
                        request,
                        id: id.clone(),
                        revision: 2,
                        text: Buffer::new("unflushable draft"),
                    },
                    &wake,
                );
            }
        }
        r.poll(&wake);
        assert!(Instant::now() < deadline, "the close was not refused");
        std::thread::sleep(Duration::from_millis(2));
    }
    r.abandon_unsaved();
    let (ws_key, res_key) = crate::documents::drafts::journal_keys(&doc);
    let saved_entry = journal.read_entry(&ws_key, &res_key).unwrap();
    assert!(saved_entry.is_some(), "abandon_unsaved must flush journal");
    assert_eq!(saved_entry.unwrap().draft_text, "unflushable draft");
    drop(r);
    lock(0o644);
    let mut reopened = Runtime::default();
    reopened.set_draft_journal(Some(journal));
    open_root(&mut reopened, root.path());
    open(&mut reopened, "a.md");
    assert!(reopened.recovered_draft_notice.is_some());
    assert!(reopened.dirty);
    let opened_text = reopened
        .take_outgoing()
        .into_iter()
        .find_map(|(_, msg)| match msg {
            HostMessage::Open { text, .. } => Some(text),
            _ => None,
        })
        .unwrap();
    assert_eq!(opened_text, "unflushable draft");
}

#[test]
fn wb30_live_slot_lru_cap_hibernates_clean_slots_preserves_dirty_and_restores_view_state() {
    use super::super::view_state::SurfaceViewState;
    let root = tempfile::tempdir().unwrap();
    for name in ["d1.md", "d2.md", "d3.md", "d4.md", "d5.md"] {
        std::fs::write(root.path().join(name), format!("content of {name}\n")).unwrap();
    }
    let mut r = Runtime::default();
    r.set_max_live_slots(3);
    open_root(&mut r, root.path());

    // Open d1.md and mark it dirty so it MUST stay pinned across all evictions.
    open(&mut r, "d1.md");
    let d1_slot = r.active_slot();
    let d1_key = r
        .state()
        .unwrap()
        .layout
        .active_editor()
        .unwrap()
        .to_owned();
    let d1_doc_id = r
        .slot(d1_slot)
        .unwrap()
        .document
        .as_ref()
        .unwrap()
        .id
        .clone();
    r.client_for(
        d1_slot,
        ClientMessage::Dirty {
            id: d1_doc_id,
            revision: 1,
            dirty: true,
        },
        &Wake::default(),
    );

    // Open d2.md (clean) and record its SurfaceViewState before navigating further.
    open(&mut r, "d2.md");
    let d2_slot = r.active_slot();
    let d2_key = r
        .state()
        .unwrap()
        .layout
        .active_editor()
        .unwrap()
        .to_owned();
    let saved_d2_state = SurfaceViewState {
        selection: Some((3, 10)),
        scroll_y: 88.5,
        scroll_x: 4.0,
        mode: Some("live".into()),
        zoom: None,
        folds: vec![(0, true)],
    };
    r.record_view_state(d2_slot, saved_d2_state.clone());

    // Open d3.md, d4.md, d5.md sequentially.
    open(&mut r, "d3.md");
    let d3_key = r
        .state()
        .unwrap()
        .layout
        .active_editor()
        .unwrap()
        .to_owned();
    open(&mut r, "d4.md");
    open(&mut r, "d5.md");

    // All 5 references stay in the Catalog, while live slots stay <= 3.
    assert_eq!(r.state().unwrap().catalog.editors.len(), 5);
    assert_eq!(r.live_slot_count(), 3);
    assert_eq!(
        r.slot_for_key(&d1_key),
        Some(d1_slot),
        "dirty slot must never hibernate"
    );
    assert!(
        r.is_hibernated(&d2_key),
        "oldest clean slot d2.md must hibernate"
    );
    assert!(
        r.is_hibernated(&d3_key),
        "older clean slot d3.md must hibernate"
    );

    // Re-activating hibernated d2.md transparently re-hydrates it and queues its ViewState.
    r.activate(&d2_key);
    wait(&mut r, |r| r.slot_for_key(&d2_key).is_some());
    assert_eq!(r.live_slot_count(), 3);
    assert_eq!(
        r.slot_for_key(&d1_key),
        Some(d1_slot),
        "dirty slot still preserved after re-hydration"
    );
    let rehydrated_slot = r.slot_for_key(&d2_key).unwrap();
    assert_eq!(
        r.take_pending_view_restore(rehydrated_slot),
        Some(saved_d2_state)
    );
}

#[test]
fn wb31_view_state_persists_across_restart_and_clamps_to_shrunk_document() {
    use super::super::view_state::SurfaceViewState;
    let profile = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("a.md"),
        "hello world\nsecond line\nthird line\n",
    )
    .unwrap();
    std::fs::write(root.path().join("b.md"), "other\n").unwrap();

    let mut r = Runtime {
        storage: Some(Storage::at(profile.path().into())),
        ..Default::default()
    };
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    let a_slot = r.active_slot();
    let a_key = r
        .state()
        .unwrap()
        .layout
        .active_editor()
        .unwrap()
        .to_owned();
    let original_vs = SurfaceViewState {
        selection: Some((20, 32)),
        scroll_y: 144.0,
        scroll_x: 12.0,
        mode: Some("source".into()),
        zoom: Some(1.25),
        folds: vec![(0, true), (2, true)],
    };
    r.record_view_state(a_slot, original_vs.clone());
    open(&mut r, "b.md");
    r.activate(&a_key);
    r.persist_metadata(&Wake::default(), true);
    wait(&mut r, |r| {
        r.metadata_inflight == 0 && r.hosts.values().all(|h| h.metadata_due.is_none())
    });
    drop(r);

    // Shrink a.md on disk before reopening so WB-11 clamping is exercised.
    std::fs::write(root.path().join("a.md"), "short\n").unwrap();

    let mut restored = Runtime {
        storage: Some(Storage::at(profile.path().into())),
        ..Default::default()
    };
    open_root(&mut restored, root.path());
    wait(&mut restored, |r| {
        r.state().is_some_and(|s| s.catalog.editors.len() == 2)
    });
    let restored_a_slot = restored.slot_for_key(&a_key).expect("a.md restored");
    let restored_vs = restored
        .take_pending_view_restore(restored_a_slot)
        .expect("persisted SurfaceViewState queued on restore");
    assert_eq!(restored_vs, original_vs);
    assert_eq!(restored_vs.clamped_selection("short\n"), Some((6, 6)));
    assert_eq!(restored_vs.clamped_folds(1), vec![(0, true)]);
}

#[test]
fn wb02_background_project_cap_and_explicit_close_unload_clean_hosts_and_protect_dirty_hosts() {
    let p1 = tempfile::tempdir().unwrap();
    let p2 = tempfile::tempdir().unwrap();
    let p3 = tempfile::tempdir().unwrap();
    let p4 = tempfile::tempdir().unwrap();
    std::fs::write(p1.path().join("draft.md"), "p1\n").unwrap();
    std::fs::write(p2.path().join("clean.md"), "p2\n").unwrap();
    std::fs::write(p3.path().join("clean.md"), "p3\n").unwrap();
    std::fs::write(p4.path().join("clean.md"), "p4\n").unwrap();

    let mut r = Runtime::default();
    r.set_max_background_hosts(2);

    let switch_root = |r: &mut Runtime, path: &std::path::Path| {
        r.begin(Intent::OpenFolder(path.into()), &Wake::default());
        wait(r, |r| {
            !r.opening_root() && r.active.is_some() && r.hosts.values().all(|h| h.metadata_loaded)
        });
    };

    // p1: open and mark dirty (must never be evicted!).
    switch_root(&mut r, p1.path());
    let p1_key = r.workspace_key().unwrap().to_owned();
    open(&mut r, "draft.md");
    let slot = r.active_slot();
    let doc_id = r.slot(slot).unwrap().document.as_ref().unwrap().id.clone();
    r.client_for(
        slot,
        ClientMessage::Dirty {
            id: doc_id,
            revision: 1,
            dirty: true,
        },
        &Wake::default(),
    );

    // p2, p3, p4: clean projects.
    switch_root(&mut r, p2.path());
    let p2_key = r.workspace_key().unwrap().to_owned();
    open(&mut r, "clean.md");

    switch_root(&mut r, p3.path());
    let p3_key = r.workspace_key().unwrap().to_owned();
    open(&mut r, "clean.md");

    switch_root(&mut r, p4.path());
    let p4_key = r.workspace_key().unwrap().to_owned();
    assert_eq!(r.workspace_key(), Some(p4_key.as_str()));

    // With max_background_hosts == 2, p1 (dirty) is protected so p2 (oldest clean) was unloaded!
    let bg = r.background_host_keys();
    assert_eq!(bg.len(), 2);
    assert!(
        bg.contains(&p1_key),
        "dirty background host p1 must stay retained"
    );
    assert!(
        bg.contains(&p3_key),
        "recent clean background host p3 stays retained"
    );
    assert!(
        !bg.contains(&p2_key),
        "oldest clean background host p2 must unload"
    );

    // Explicit unload refuses active or dirty hosts, and unloads clean background host p3.
    let wake = Wake::default();
    assert!(!r.close_background_project(&p4_key, &wake));
    assert!(!r.close_background_project(&p1_key, &wake));
    assert!(r.close_background_project(&p3_key, &wake));
    assert_eq!(r.background_host_keys(), vec![p1_key]);
}
/// `EditorWorkbenchPersistenceScheduler`: a burst of layout changes is
/// written once, with its last state, after a quiet 200ms; a lifecycle
/// boundary writes at once.
#[test]
fn layout_metadata_writes_once_after_a_burst_and_at_once_at_a_boundary() {
    let profile = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("a.md"), "a").unwrap();
    let mut r = Runtime {
        storage: Some(Storage::at(profile.path().into())),
        ..Default::default()
    };
    open_root(&mut r, root.path());
    open(&mut r, "a.md");
    r.state_mut()
        .unwrap()
        .split(super::super::layout::Direction::Horizontal);
    let settled = |r: &Runtime| {
        r.metadata_inflight == 0 && r.hosts.values().all(|h| h.metadata_due.is_none())
    };
    wait(&mut r, settled);
    let ws = workspace::Workspace::open(root.path()).unwrap();
    let key = resource_key(&ws.resource_id(std::path::Path::new("")).unwrap());
    let file = profile
        .path()
        .join(format!("{}.json", blake3::hash(key.as_bytes()).to_hex()));
    let stored_ratio = || {
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        value["layout"]["root"]["ratio"].as_f64()
    };
    let wake = Wake::default();
    for ratio in [0.3, 0.4, 0.6] {
        r.state_mut()
            .unwrap()
            .layout
            .resize("editor-split-1", ratio);
        r.persist_metadata(&wake, false);
        assert_eq!(
            r.metadata_inflight, 0,
            "nothing is written during the burst"
        );
    }
    assert!(r.hosts.values().any(|h| h.metadata_due.is_some()));
    wait(&mut r, settled);
    assert_eq!(stored_ratio(), Some(0.6));
    // A boundary writes at once.
    r.state_mut().unwrap().layout.resize("editor-split-1", 0.7);
    r.persist_metadata(&wake, true);
    assert!(r.hosts.values().all(|h| h.metadata_due.is_none()));
    wait(&mut r, settled);
    assert_eq!(stored_ratio(), Some(0.7));
    // Switching to another project still writes this one's last change.
    r.state_mut().unwrap().layout.resize("editor-split-1", 0.25);
    r.persist_metadata(&wake, false);
    let other = tempfile::tempdir().unwrap();
    open_root(&mut r, other.path());
    wait(&mut r, settled);
    assert_eq!(stored_ratio(), Some(0.25));
}
