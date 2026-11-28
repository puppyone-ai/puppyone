use super::{
    catalog::{Catalog, Input, Workbench, resource_key},
    layout::{Direction, Layout, Placement},
    runtime::Runtime,
};
use crate::{
    documents::{ClientMessage, HostMessage, Intent},
    editor::text::buffer::Buffer,
    wake::Wake,
};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
#[test]
fn actual_typescript_pane_transition_oracle() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../fixtures/editor/workbench-layout.json"
    ))
    .unwrap();
    let mut layout = Layout::new(Some("a".into()));
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let op = &case["op"];
        let text = |name: &str| op[name].as_str().unwrap();
        let direction = || {
            if text("direction") == "horizontal" {
                Direction::Horizontal
            } else {
                Direction::Vertical
            }
        };
        let placement = || {
            if text("placement") == "first" {
                Placement::First
            } else {
                Placement::Second
            }
        };
        match text("kind") {
            "split" => layout.split(
                text("pane"),
                direction(),
                placement(),
                op["editor"].as_str().map(str::to_owned),
            ),
            "move" => layout.move_pane(text("source"), text("target"), direction(), placement()),
            "focus" => layout.focus(text("pane")),
            "assign" => layout.assign(text("pane"), op["editor"].as_str().map(str::to_owned)),
            "resize" => layout.resize(text("split"), op["ratio"].as_f64().unwrap()),
            "close" => layout.close(text("pane")),
            other => panic!("Unknown oracle operation {other}"),
        }
        assert_eq!(
            serde_json::to_value(&layout).unwrap(),
            case["expected"],
            "TS transition {index}: {op}"
        );
    }
}
fn input(id: &str) -> Input {
    Input {
        id: id.into(),
        label: id.into(),
    }
}
#[test]
fn catalog_insertion_mru_reorder_and_close_are_independent_from_panes() {
    let mut c = Catalog::default();
    c.open(input("a"));
    c.open(input("b"));
    c.activate("a");
    c.open(input("c"));
    assert_eq!(
        c.editors.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
        ["a", "c", "b"]
    );
    // Opening a known resource again reuses it, with its newer label.
    c.open(Input {
        id: "a".into(),
        label: "A".into(),
    });
    assert_eq!(c.editors[0].label, "A");
    assert_eq!(c.editors.len(), 3);
    c.activate("c");
    let mru = c.mru.clone();
    c.move_before("b", "a");
    assert_eq!(c.active.as_deref(), Some("c"));
    assert_eq!(c.mru, mru, "moving changes no focus history");
    let before = c.clone();
    c.move_before("missing", "a");
    assert_eq!(c, before);
    c.close("c");
    assert_eq!(c.active.as_deref(), Some("a"));
    c.close("a");
    assert_eq!(c.active.as_deref(), Some("b"));
    c.close("b");
    assert_eq!(c, Catalog::default());
}
/// `EditorGroupModel`: an editor's identity is its storage plus its path,
/// so the same relative path in two projects is two editors, a doubled
/// separator names the same file, and a `.`/`..` address is refused
/// rather than rewritten.
#[test]
fn editor_identity_is_storage_and_path_and_odd_addresses_never_alias() {
    use crate::workspace::contracts::{RelativePath, ResourceId, StorageId};
    use std::path::Path;
    let id = |root: &str, path: &str| ResourceId {
        storage: StorageId::new(root).unwrap(),
        path: RelativePath::new(Path::new(path)).unwrap(),
    };
    let a = id("file:///folder-a/", "src/App.tsx");
    let b = id("file:///folder-b/", "src/App.tsx");
    assert_ne!(resource_key(&a), resource_key(&b));
    assert_eq!(
        resource_key(&id("file:///folder-a/", "docs//a.md")),
        resource_key(&id("file:///folder-a/", "docs/a.md"))
    );
    assert_eq!(
        resource_key(&id("file:///p/", "Beta 项目/a b.md")),
        "file:///p/Beta%20%E9%A1%B9%E7%9B%AE/a%20b.md"
    );
    for odd in ["./docs/a.md", "docs/../a.md", "/docs/a.md"] {
        assert!(RelativePath::new(Path::new(odd)).is_err(), "{odd}");
    }
}
#[test]
fn splitting_is_empty_reopening_focuses_existing_resource_and_close_pane_keeps_reference() {
    let mut w = Workbench::default();
    w.open(input("a"));
    w.split(Direction::Horizontal);
    w.open(input("b"));
    let pane_b = w.layout.active.clone();
    w.open(input("a"));
    assert_eq!(w.layout.active, "editor-pane-1");
    assert_eq!(w.layout.root.panes().len(), 2);
    w.close_pane(&pane_b);
    assert_eq!(w.catalog.editors.len(), 2);
    w.activate("b");
    assert_eq!(w.layout.active_editor(), Some("b"));
    w.close_pane("editor-pane-1");
    assert_eq!(w.layout.active_editor(), None);
    assert_eq!(w.catalog.editors.len(), 2);
}
#[test]
fn pane_move_preserves_leaf_ids_and_sibling_ratio_but_direction_change_resets_it() {
    let mut l = Layout::new(Some("a".into()));
    l.split(
        "editor-pane-1",
        Direction::Horizontal,
        Placement::Second,
        Some("b".into()),
    );
    l.resize("editor-split-1", 0.7124);
    l.move_pane(
        "editor-pane-2",
        "editor-pane-1",
        Direction::Horizontal,
        Placement::First,
    );
    let value = serde_json::to_value(&l).unwrap();
    assert_eq!(value["root"]["ratio"], 0.712);
    assert_eq!(value["root"]["first"]["id"], "editor-pane-2");
    l.move_pane(
        "editor-pane-2",
        "editor-pane-1",
        Direction::Vertical,
        Placement::Second,
    );
    assert_eq!(serde_json::to_value(&l).unwrap()["root"]["ratio"], 0.5);
    l.split(
        "editor-pane-2",
        Direction::Vertical,
        Placement::Second,
        Some("c".into()),
    );
    l.move_pane(
        "editor-pane-1",
        "editor-pane-3",
        Direction::Horizontal,
        Placement::Second,
    );
    assert_eq!(l.root.panes().len(), 3);
    assert_eq!(l.active, "editor-pane-1");
}
#[test]
fn untrusted_layout_rejects_duplicate_node_ids_and_collapses_duplicate_visible_documents() {
    let mut l = Layout::new(Some("a".into()));
    l.split(
        "editor-pane-1",
        Direction::Horizontal,
        Placement::Second,
        Some("a".into()),
    );
    let valid = ["a".to_owned()].into_iter().collect();
    let mut v = serde_json::to_value(&l).unwrap();
    let restored = Layout::parse(&v, &valid, None);
    assert_eq!(restored.root.panes(), [("editor-pane-2", Some("a"))]);
    v["root"]["second"]["id"] = "editor-pane-1".into();
    assert_eq!(Layout::parse(&v, &valid, None), Layout::default());
    // A stored ratio is kept within 0.15..0.85, and a pane whose document
    // is gone is restored empty.
    let mut l = Layout::new(Some("a".into()));
    l.split(
        "editor-pane-1",
        Direction::Horizontal,
        Placement::Second,
        Some("gone".into()),
    );
    for (stored, ratio) in [(7.0, 0.85), (-1.0, 0.15), (0.42, 0.42)] {
        let mut v = serde_json::to_value(&l).unwrap();
        v["root"]["ratio"] = stored.into();
        let restored = Layout::parse(&v, &valid, None);
        let v = serde_json::to_value(&restored).unwrap();
        assert_eq!(v["root"]["ratio"].as_f64(), Some(ratio), "{stored}");
        assert_eq!(
            restored.root.panes(),
            [("editor-pane-1", Some("a")), ("editor-pane-2", None)]
        );
    }
}
fn wait(runtime: &mut Runtime, wake: &Wake, done: impl Fn(&Runtime) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        runtime.poll(wake);
        if done(runtime) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "runtime failed to settle: {:?}",
            runtime.error
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn workspace(runtime: &mut Runtime, wake: &Wake, path: PathBuf) {
    let path = path.canonicalize().unwrap();
    runtime.begin(Intent::OpenFolder(path.clone()), wake);
    wait(runtime, wake, |r| {
        r.workspace
            .as_ref()
            .is_some_and(|ws| ws.local_root() == Some(path.as_path()))
            && !r.busy()
    });
}
fn open(runtime: &mut Runtime, wake: &Wake, path: &str) -> u64 {
    runtime.begin(Intent::OpenFile(path.into()), wake);
    wait(runtime, wake, |r| {
        r.opened()
            .is_some_and(|(_, p)| p == std::path::Path::new(path))
    });
    runtime.active_slot()
}
#[test]
fn focus_and_workspace_switch_do_not_read_drain_or_revoke_retained_documents() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    std::fs::write(a.path().join("a.md"), "original").unwrap();
    std::fs::write(a.path().join("b.md"), "second").unwrap();
    let wake = Wake::default();
    let mut runtime = Runtime::default();
    workspace(&mut runtime, &wake, a.path().into());
    let first = open(&mut runtime, &wake, "a.md");
    let first_id = runtime.document.as_ref().unwrap().id.clone();
    let grant = runtime.workspace.clone().unwrap();
    let key = resource_key(&grant.resource_id(std::path::Path::new("a.md")).unwrap());
    let second = open(&mut runtime, &wake, "b.md");
    assert_ne!(first, second);
    runtime.take_outgoing();
    runtime.activate(&key);
    assert_eq!(runtime.document.as_ref().unwrap().id, first_id);
    assert!(runtime.take_outgoing().is_empty());
    workspace(&mut runtime, &wake, b.path().into());
    assert!(grant.read(std::path::Path::new("a.md")).is_ok());
    workspace(&mut runtime, &wake, a.path().into());
    assert_eq!(runtime.active_slot(), first);
    assert_eq!(runtime.state().unwrap().catalog.editors.len(), 2);
    assert!(runtime.take_outgoing().is_empty());
}
#[test]
fn background_copy_saves_and_close_waits_for_its_own_snapshot_without_changing_focus() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), "original").unwrap();
    std::fs::write(temp.path().join("b.md"), "second").unwrap();
    let wake = Wake::default();
    let mut r = Runtime::default();
    workspace(&mut r, &wake, temp.path().into());
    let a = open(&mut r, &wake, "a.md");
    let a_id = r.document.as_ref().unwrap().id.clone();
    let b = open(&mut r, &wake, "b.md");
    r.take_outgoing();
    r.client_for(
        a,
        ClientMessage::Dirty {
            id: a_id.clone(),
            revision: 1,
            dirty: true,
        },
        &wake,
    );
    r.poll(&wake);
    assert!(
        r.take_outgoing().is_empty(),
        "typing must wait for the idle period"
    );
    r.flush_pending_auto_save(&wake);
    let request = r
        .take_outgoing()
        .into_iter()
        .find_map(|(slot, m)| match m {
            HostMessage::Snapshot {
                request,
                freeze: false,
            } if slot == a => Some(request),
            _ => None,
        })
        .unwrap();
    r.client_for(
        a,
        ClientMessage::Snapshot {
            request,
            id: a_id.clone(),
            revision: 1,
            text: Buffer::new("background"),
        },
        &wake,
    );
    wait(&mut r, &wake, |r| !r.slot(a).unwrap().saving());
    assert_eq!(r.active_slot(), b);
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "background"
    );
    r.close_slot(a, &wake);
    assert!(r.retained_slots().contains(&a));
    let request = r
        .take_outgoing()
        .into_iter()
        .find_map(|(slot, m)| match m {
            HostMessage::Snapshot {
                request,
                freeze: true,
            } if slot == a => Some(request),
            _ => None,
        })
        .unwrap();
    r.client_for(
        a,
        ClientMessage::Snapshot {
            request,
            id: a_id,
            revision: 1,
            text: Buffer::new("background"),
        },
        &wake,
    );
    wait(&mut r, &wake, |r| !r.retained_slots().contains(&a));
    assert_eq!(r.active_slot(), b);
}
#[test]
fn failed_open_keeps_previous_visible_workspace_and_folder_never_enters_catalog() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), "original").unwrap();
    std::fs::create_dir(temp.path().join("folder.md")).unwrap();
    let wake = Wake::default();
    let mut r = Runtime::default();
    workspace(&mut r, &wake, temp.path().into());
    let a = open(&mut r, &wake, "a.md");
    r.begin(Intent::OpenFolder(temp.path().join("absent")), &wake);
    // A Project that cannot open names itself (`ProjectNavigationFailure`).
    wait(&mut r, &wake, |r| r.root_failure.is_some());
    assert_eq!(
        r.root_failure.take().map(|(path, _)| path),
        Some(temp.path().join("absent"))
    );
    assert!(r.error.is_none());
    assert_eq!(r.active_slot(), a);
    r.begin(Intent::OpenFile("folder.md".into()), &wake);
    wait(&mut r, &wake, |r| r.error.is_some());
    assert_eq!(r.active_slot(), a);
    assert_eq!(r.state().unwrap().catalog.editors.len(), 1);
}

#[test]
fn window_blur_flushes_each_retained_project_once_without_activating_it() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    std::fs::write(a.path().join("a.md"), "a").unwrap();
    std::fs::write(b.path().join("b.md"), "b").unwrap();
    let wake = Wake::default();
    let mut r = Runtime::default();
    workspace(&mut r, &wake, a.path().into());
    let first = open(&mut r, &wake, "a.md");
    let first_id = r.document.as_ref().unwrap().id.clone();
    workspace(&mut r, &wake, b.path().into());
    let second = open(&mut r, &wake, "b.md");
    let second_id = r.document.as_ref().unwrap().id.clone();
    r.take_outgoing();
    for (slot, id) in [(first, first_id), (second, second_id)] {
        r.client_for(
            slot,
            ClientMessage::Dirty {
                id,
                revision: 1,
                dirty: true,
            },
            &wake,
        );
    }
    r.flush_pending_auto_save(&wake);
    let messages = r.take_outgoing();
    for slot in [first, second] {
        assert_eq!(
            messages
                .iter()
                .filter(|(id, m)| *id == slot
                    && matches!(m, HostMessage::Snapshot { freeze: false, .. }))
                .count(),
            1
        );
    }
    assert_eq!(r.active_slot(), second);
    r.flush_pending_auto_save(&wake);
    assert!(r.take_outgoing().is_empty());
}
/// `EditorPaneLayoutModel`: splits nest right and down and focus the new
/// pane; closing a pane folds its split and keeps the surviving focus; a
/// dragged editor lands on the side asked for; moving a pane never copies
/// its editor and keeps the split it reorders; dropping a pane back into
/// its own slot changes nothing.
#[test]
fn panes_split_close_and_move_as_the_layout_model_says() {
    let editors = |l: &Layout| {
        l.root
            .panes()
            .into_iter()
            .map(|(_, editor)| editor.map(str::to_owned))
            .collect::<Vec<_>>()
    };
    let some = |s: &str| Some(s.to_owned());
    let mut l = Layout::new(some("a.md"));
    l.split(
        "editor-pane-1",
        Direction::Horizontal,
        Placement::Second,
        some("a.md"),
    );
    let second = l.active.clone();
    l.assign(&second, some("b.md"));
    l.split(
        &second,
        Direction::Vertical,
        Placement::Second,
        some("b.md"),
    );
    assert_eq!(editors(&l), [some("a.md"), some("b.md"), some("b.md")]);
    assert_eq!(l.active, "editor-pane-3");
    let value = serde_json::to_value(&l).unwrap();
    assert_eq!(
        (
            &value["root"]["direction"],
            &value["root"]["second"]["direction"]
        ),
        (&"horizontal".into(), &"vertical".into())
    );
    // Closing a pane folds its split; the surviving focus stays.
    let mut l = Layout::new(some("a.md"));
    l.split(
        "editor-pane-1",
        Direction::Horizontal,
        Placement::Second,
        some("b.md"),
    );
    l.focus("editor-pane-1");
    l.close("editor-pane-2");
    assert_eq!(
        l.root,
        super::layout::Node::Pane {
            id: "editor-pane-1".into(),
            editor: some("a.md")
        }
    );
    assert_eq!(l.active, "editor-pane-1");
    // A dragged editor lands first, and is focused.
    let mut l = Layout::new(some("target.md"));
    l.split(
        "editor-pane-1",
        Direction::Horizontal,
        Placement::First,
        some("dragged.md"),
    );
    assert_eq!(editors(&l), [some("dragged.md"), some("target.md")]);
    assert_eq!(l.active_editor(), Some("dragged.md"));
    // Moving a pane keeps its split and copies nothing.
    let mut l = Layout::new(some("a.md"));
    l.split(
        "editor-pane-1",
        Direction::Horizontal,
        Placement::Second,
        some("b.md"),
    );
    let split = l.root.id().to_owned();
    l.move_pane(
        "editor-pane-1",
        "editor-pane-2",
        Direction::Vertical,
        Placement::Second,
    );
    assert_eq!(l.root.id(), split);
    assert_eq!(
        l.root.panes(),
        [
            ("editor-pane-2", Some("b.md")),
            ("editor-pane-1", Some("a.md"))
        ]
    );
    assert_eq!(l.active, "editor-pane-1");
    // A sibling dropped back where it is changes nothing.
    let mut l = Layout::new(some("a.md"));
    l.split(
        "editor-pane-1",
        Direction::Horizontal,
        Placement::Second,
        some("b.md"),
    );
    let before = l.clone();
    l.move_pane(
        "editor-pane-2",
        "editor-pane-1",
        Direction::Horizontal,
        Placement::Second,
    );
    assert_eq!(l, before);
    // Reordering siblings keeps the split.
    l.move_pane(
        "editor-pane-2",
        "editor-pane-1",
        Direction::Horizontal,
        Placement::First,
    );
    assert_eq!(l.root.id(), before.root.id());
    assert_eq!(
        l.root.panes(),
        [
            ("editor-pane-2", Some("b.md")),
            ("editor-pane-1", Some("a.md"))
        ]
    );
}

/// `editorPaneSourceSwitching.test.tsx` #0 (gap `viewer-host-read-failure-card`):
/// a file the pane could not read stays in its pane, which says why
/// instead of a window dialog; reading it again (the pane's Retry, or
/// opening it again) loads it in that same pane.
#[test]
fn a_failed_read_stays_in_its_pane_and_reads_again_there() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), "a").unwrap();
    let wake = Wake::default();
    let mut r = Runtime::default();
    workspace(&mut r, &wake, temp.path().into());
    open(&mut r, &wake, "a.md");
    r.begin(Intent::OpenFile("later.md".into()), &wake);
    wait(&mut r, &wake, |r| r.read_failure(r.active_slot()).is_some());
    let failed = r.active_slot();
    let failure = r.read_failure(failed).unwrap();
    assert_eq!(failure.path, PathBuf::from("later.md"));
    assert!(!failure.error.is_empty());
    assert_eq!(
        failure.local,
        Some(temp.path().canonicalize().unwrap().join("later.md"))
    );
    assert!(r.error.is_none(), "no window dialog: {:?}", r.error);
    let catalog = &r.state().unwrap().catalog;
    assert_eq!(catalog.editors.len(), 2);
    assert_eq!(catalog.editors[1].label, "later.md");
    // Retry: the pane loads (no failure while reading), then shows it.
    std::fs::write(temp.path().join("later.md"), "Recovered").unwrap();
    r.client_for(failed, ClientMessage::RetryRead, &wake);
    assert_eq!(r.read_failure(failed), None);
    wait(&mut r, &wake, |r| {
        r.slot(failed)
            .and_then(|f| f.opened())
            .is_some_and(|(_, p)| p == std::path::Path::new("later.md"))
    });
    assert_eq!(r.active_slot(), failed);
    assert_eq!(
        r.slot(failed)
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .text
            .as_str(),
        "Recovered"
    );
    assert_eq!(r.state().unwrap().catalog.editors.len(), 2);
    // Opening a failed file again reads it again, in its pane.
    r.begin(Intent::OpenFile("gone.md".into()), &wake);
    wait(&mut r, &wake, |r| r.read_failure(r.active_slot()).is_some());
    let gone = r.active_slot();
    std::fs::write(temp.path().join("gone.md"), "back").unwrap();
    r.begin(Intent::OpenFile("a.md".into()), &wake);
    r.begin(Intent::OpenFile("gone.md".into()), &wake);
    wait(&mut r, &wake, |r| {
        r.slot(gone).and_then(|f| f.opened()).is_some()
    });
    assert_eq!(r.active_slot(), gone);
    assert!(r.error.is_none());
}
