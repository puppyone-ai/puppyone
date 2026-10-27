use super::*;
use crate::platform::editor_state_storage::Storage;
use std::time::{Duration, Instant};
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
    assert_eq!(
        r.take_outgoing()
            .iter()
            .filter(|(_, m)| matches!(m, HostMessage::Thaw))
            .count(),
        3
    );
    assert!(!r.allow_quit);
}
