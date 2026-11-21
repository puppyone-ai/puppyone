//! Retained ownership and terminal close behavior through real storage.
use super::*;
use crate::workspace::{Workspace, testing::Memory};
use std::sync::{Arc, atomic::Ordering};

fn switch_root(r: &mut Runtime, path: &std::path::Path) {
    let root = path.canonicalize().unwrap();
    r.begin(Intent::OpenFolder(root.clone()), &Wake::default());
    wait(r, |r| {
        r.workspace
            .as_ref()
            .is_some_and(|ws| ws.local_root() == Some(root.as_path()))
            && r.hosts.values().all(|host| host.metadata_loaded)
    });
}

fn edit(r: &mut Runtime, slot: SlotId, revision: u64, text: &str) {
    let id = r.slot(slot).unwrap().document.as_ref().unwrap().id.clone();
    r.client_for(
        slot,
        ClientMessage::LiveBuffer {
            id: id.clone(),
            revision,
            text: Buffer::new(text),
        },
        &Wake::default(),
    );
    r.client_for(
        slot,
        ClientMessage::Dirty {
            id,
            revision,
            dirty: true,
        },
        &Wake::default(),
    );
}

fn answer(r: &mut Runtime, slot: SlotId, request: u64, revision: u64, text: &str) {
    let id = r.slot(slot).unwrap().document.as_ref().unwrap().id.clone();
    r.client_for(
        slot,
        ClientMessage::Snapshot {
            request,
            id,
            revision,
            text: Buffer::new(text),
        },
        &Wake::default(),
    );
}

fn request(r: &mut Runtime, expected_slot: SlotId, freeze: bool) -> u64 {
    r.take_outgoing()
        .into_iter()
        .find_map(|(slot, message)| match message {
            HostMessage::Snapshot {
                request,
                freeze: actual,
            } if slot == expected_slot && actual == freeze => Some(request),
            _ => None,
        })
        .expect("the intended document must own the snapshot request")
}

#[test]
fn abandoning_edits_retires_pending_snapshots_and_rejects_late_input_or_flushes() {
    for snapshot_requested in [false, true] {
        let provider = Arc::new(Memory::new("memory://abandon/project/"));
        let workspace = Workspace::from_provider(provider.clone()).unwrap();
        let mut r = Runtime {
            scratch: Documents::in_workspace(workspace),
            ..Default::default()
        };
        open(&mut r, "note.md");
        r.take_outgoing();
        let calls = provider.calls.load(Ordering::SeqCst);
        edit(&mut r, 0, 1, "discarded input");
        let pending = if snapshot_requested {
            r.flush_pending_auto_save(&Wake::default());
            Some(request(&mut r, 0, false))
        } else {
            None
        };
        r.abandon_unsaved();
        if let Some(serial) = pending {
            answer(&mut r, 0, serial, 1, "discarded input");
        }
        edit(&mut r, 0, 2, "typed while closing");
        r.flush_pending_auto_save(&Wake::default());
        r.begin(Intent::Save, &Wake::default());
        r.retry_slot_save(0, &Wake::default());
        r.poll(&Wake::default());
        r.cancel_quit(&Wake::default());
        assert!(r.allow_quit && !r.close_refused);
        assert!(
            !r.slot(0).unwrap().saving(),
            "abandoned input must not remain eligible to write"
        );
        assert!(
            !r.take_outgoing()
                .iter()
                .any(|(_, message)| matches!(message, HostMessage::Snapshot { .. }))
        );
        assert_eq!(provider.calls.load(Ordering::SeqCst), calls);
        assert_eq!(*provider.text.lock().unwrap(), "original");
    }
}

#[test]
fn equal_paths_in_distinct_storages_keep_independent_writes_and_close_lifetimes() {
    let root = tempfile::tempdir().unwrap();
    let a = root.path().join("Alpha Project");
    let b = root.path().join("Beta 项目");
    let relative = "docs with space/群群.md";
    for (path, text) in [(&a, "alpha"), (&b, "beta")] {
        std::fs::create_dir_all(path.join("docs with space")).unwrap();
        std::fs::write(path.join(relative), text).unwrap();
    }
    let mut r = Runtime::default();
    switch_root(&mut r, &a);
    open(&mut r, relative);
    let first = r.active_slot();
    let first_id = r.document.as_ref().unwrap().id.clone();
    let first_identity = r.document.as_ref().unwrap().identity.clone();
    edit(&mut r, first, 1, "alpha saved");
    r.take_outgoing();
    r.begin(Intent::OpenFile(relative.into()), &Wake::default());
    assert_eq!(r.active_slot(), first);
    assert_eq!(r.document.as_ref().unwrap().id, first_id);
    assert!(r.take_outgoing().is_empty());
    switch_root(&mut r, &b);
    open(&mut r, relative);
    let second = r.active_slot();
    let second_id = r.document.as_ref().unwrap().id.clone();
    assert_ne!(first, second);
    assert_ne!(first_id, second_id);
    assert_ne!(first_identity, r.document.as_ref().unwrap().identity);
    edit(&mut r, second, 1, "beta saved");
    r.take_outgoing();
    r.flush_pending_auto_save(&Wake::default());
    let requests = r.take_outgoing();
    assert_eq!(
        requests
            .iter()
            .filter(|(_, m)| matches!(m, HostMessage::Snapshot { .. }))
            .count(),
        2
    );
    for (slot, message) in requests {
        if let HostMessage::Snapshot {
            request,
            freeze: false,
        } = message
        {
            answer(
                &mut r,
                slot,
                request,
                1,
                if slot == first {
                    "alpha saved"
                } else {
                    "beta saved"
                },
            );
        }
    }
    wait(&mut r, |r| {
        [first, second]
            .into_iter()
            .all(|slot| !r.slot(slot).unwrap().saving())
    });
    assert_eq!(
        std::fs::read_to_string(a.join(relative)).unwrap(),
        "alpha saved"
    );
    assert_eq!(
        std::fs::read_to_string(b.join(relative)).unwrap(),
        "beta saved"
    );
    r.close_slot(first, &Wake::default());
    let serial = request(&mut r, first, true);
    answer(&mut r, first, serial, 1, "alpha saved");
    wait(&mut r, |r| r.slot(first).is_none());
    assert_eq!(r.active_slot(), second);
    assert_eq!(r.document.as_ref().unwrap().id, second_id);
    switch_root(&mut r, &a);
    open(&mut r, relative);
    assert_ne!(r.active_slot(), first);
    assert_ne!(r.document.as_ref().unwrap().id, first_id);
    assert_eq!(r.document.as_ref().unwrap().identity, first_identity);
    assert_eq!(r.document.as_ref().unwrap().text, "alpha saved");
    assert_eq!(
        r.slot(second).unwrap().document.as_ref().unwrap().id,
        second_id
    );
    let reopened = r.active_slot();
    edit(&mut r, reopened, 1, "discard alpha");
    edit(&mut r, second, 2, "discard beta");
    r.abandon_unsaved();
    edit(&mut r, reopened, 2, "late alpha");
    edit(&mut r, second, 3, "late beta");
    r.flush_pending_auto_save(&Wake::default());
    r.poll(&Wake::default());
    assert!(r.allow_quit);
    assert!(
        [reopened, second]
            .into_iter()
            .all(|slot| !r.slot(slot).unwrap().saving())
    );
    assert!(r.take_outgoing().is_empty());
    assert_eq!(
        std::fs::read_to_string(a.join(relative)).unwrap(),
        "alpha saved"
    );
    assert_eq!(
        std::fs::read_to_string(b.join(relative)).unwrap(),
        "beta saved"
    );
}

#[test]
fn quit_waits_for_every_retained_document_and_ignores_closed_slots() {
    let root = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md", "closed.md"] {
        std::fs::write(root.path().join(name), name).unwrap();
    }
    let mut r = Runtime::default();
    switch_root(&mut r, root.path());
    open(&mut r, "a.md");
    let a = r.active_slot();
    edit(&mut r, a, 1, "saved a");
    open(&mut r, "b.md");
    let b = r.active_slot();
    edit(&mut r, b, 1, "saved b");
    open(&mut r, "closed.md");
    let closed = r.active_slot();
    r.close_slot(closed, &Wake::default());
    let serial = request(&mut r, closed, true);
    answer(&mut r, closed, serial, 1, "closed.md");
    wait(&mut r, |r| r.slot(closed).is_none());
    r.begin(Intent::Quit, &Wake::default());
    assert!(!r.allow_quit);
    let requests: Vec<_> = r
        .take_outgoing()
        .into_iter()
        .filter_map(|(slot, message)| match message {
            HostMessage::Snapshot {
                request,
                freeze: true,
            } => Some((slot, request)),
            _ => None,
        })
        .collect();
    assert_eq!(
        requests
            .iter()
            .map(|(slot, _)| *slot)
            .collect::<std::collections::BTreeSet<_>>(),
        [a, b].into_iter().collect()
    );
    let serial = requests.iter().find(|(slot, _)| *slot == a).unwrap().1;
    answer(&mut r, a, serial, 1, "saved a");
    wait(&mut r, |r| r.slot(a).unwrap().allow_quit);
    assert!(
        !r.allow_quit,
        "the second retained document has not drained"
    );
    let serial = requests.iter().find(|(slot, _)| *slot == b).unwrap().1;
    answer(&mut r, b, serial, 1, "saved b");
    wait(&mut r, |r| r.allow_quit);
    assert_eq!(
        std::fs::read_to_string(root.path().join("a.md")).unwrap(),
        "saved a"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("b.md")).unwrap(),
        "saved b"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("closed.md")).unwrap(),
        "closed.md"
    );
    r.take_outgoing();
    r.begin(Intent::Quit, &Wake::default());
    r.flush_pending_auto_save(&Wake::default());
    r.poll(&Wake::default());
    assert!(r.take_outgoing().is_empty());
}
