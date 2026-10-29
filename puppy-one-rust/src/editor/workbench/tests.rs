use super::{
    catalog::{Catalog, Input, Workbench, resource_key},
    layout::{Direction, Layout, Placement},
    runtime::Runtime,
};
use crate::{
    documents::{ClientMessage, HostMessage, Intent},
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
    c.move_before("b", "a");
    assert_eq!(c.active.as_deref(), Some("c"));
    c.close("c");
    assert_eq!(c.active.as_deref(), Some("a"));
    c.close("a");
    assert_eq!(c.active.as_deref(), Some("b"));
    c.close("b");
    assert_eq!(c, Catalog::default());
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
            text: "background".into(),
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
            text: "background".into(),
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
