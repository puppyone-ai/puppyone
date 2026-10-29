use super::*;
use core::prelude::v1::test;
#[gpui::test]
fn project_return_restores_explorer_state_and_revalidates_loaded_folders(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    std::fs::create_dir(first.path().join("folder")).unwrap();
    std::fs::write(first.path().join("folder/a.md"), "a").unwrap();
    let a = Workspace::open(first.path()).unwrap();
    let b = Workspace::open(second.path()).unwrap();
    let preferences = cx.new(|_| PreferencesStore::memory());
    let explorer = cx.new(|cx| Explorer::new(false, preferences, cx));
    let identity = explorer.update(cx, |e, cx| {
        e.load_workspace(a.clone(), a.list(Path::new("")).unwrap(), cx);
        e.tree
            .attach_children(Path::new("folder"), a.list(Path::new("folder")).unwrap());
        e.tree.select(Path::new("folder/a.md"), false, false);
        e.clipboard = Some(FileClipboard::Copy(vec!["folder/a.md".into()]));
        e.scroll
            .0
            .borrow()
            .base_handle
            .set_offset(point(px(0.), px(-64.)));
        let id = e.tree.id;
        e.load_workspace(b.clone(), b.list(Path::new("")).unwrap(), cx);
        assert_ne!(e.tree.id, id);
        assert!(e.clipboard.is_none());
        id
    });
    std::fs::write(first.path().join("folder/new.md"), "new").unwrap();
    explorer.update(cx, |e, cx| {
        e.load_workspace(a.clone(), a.list(Path::new("")).unwrap(), cx)
    });
    cx.run_until_parked();
    explorer.update(cx, |e, _| {
        assert_eq!(e.tree.id, identity);
        assert!(e.tree.find_mut(Path::new("folder")).unwrap().expanded);
        assert_eq!(e.tree.selected, Path::new("folder/a.md"));
        assert!(e.tree.selection.contains(Path::new("folder/a.md")));
        assert!(matches!(&e.clipboard, Some(FileClipboard::Copy(paths)) if paths == &[PathBuf::from("folder/a.md")]));
        assert_eq!(e.scroll.0.borrow().base_handle.offset().y, px(-64.));
        assert!(e.tree.index_of(Path::new("folder/new.md")).is_some());
    });
}
#[gpui::test]
fn failed_import_or_move_shows_above_the_tree_and_retry_rereads_the_root(cx: &mut TestAppContext) {
    use crate::editor::workbench::resource_operations::Outcome;
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.md"), "a").unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let preferences = cx.new(|_| PreferencesStore::memory());
    let explorer = cx.new(|cx| Explorer::new(false, preferences, cx));
    let owner = explorer.update(cx, |e, cx| {
        e.load_workspace(ws.clone(), ws.list(Path::new("")).unwrap(), cx);
        crate::editor::workbench::catalog::resource_key(&ws.resource_id(Path::new("")).unwrap())
    });
    let events = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let seen = events.clone();
    cx.update(|cx| {
        cx.subscribe(&explorer, move |_, event: &ExplorerEvent, _| {
            seen.borrow_mut().push(format!("{event:?}"))
        })
        .detach()
    });
    // An import (DataWorkspace.importFiles) fails: the error sits above the
    // tree instead of opening the shell's error dialog.
    explorer.update(cx, |e, cx| {
        e.run_op(FileOp::Import(vec!["/tmp/x".into()], PathBuf::new()), cx);
        let outcome = Outcome {
            error: Some("disk full".into()),
            ..Default::default()
        };
        e.finish_op(&owner, outcome, cx);
        assert_eq!(e.operation_error.as_deref(), Some("disk full"));
        assert!(!e.op);
    });
    assert!(!events.borrow().iter().any(|e| e.starts_with("Error")));
    // A new move clears the previous operation error when it starts.
    explorer.update(cx, |e, cx| {
        e.run_op(FileOp::Move(vec!["a.md".into()], "x".into()), cx);
        assert_eq!(e.operation_error, None);
        e.finish_op(&owner, Outcome::default(), cx);
    });
    // Other operations still report through the dialog.
    explorer.update(cx, |e, cx| {
        e.run_op(FileOp::Delete(vec!["a.md".into()]), cx);
        let outcome = Outcome {
            error: Some("denied".into()),
            ..Default::default()
        };
        e.finish_op(&owner, outcome, cx);
        assert_eq!(e.operation_error, None);
    });
    assert!(events.borrow().iter().any(|e| e.starts_with("Error")));
    // Retry (onRetryFolder(null)) dismisses the banner and rereads the root.
    explorer.update(cx, |e, cx| {
        e.operation_error = Some("disk full".into());
        e.retry_root(cx);
        assert_eq!(e.operation_error, None);
    });
    assert!(events.borrow().iter().any(|e| e == "LoadChildren(\"\")"));
    std::fs::write(dir.path().join("b.md"), "b").unwrap();
    explorer.update(cx, |e, cx| {
        e.children_loaded(Path::new(""), ws.list(Path::new("")), cx);
        assert!(e.tree.index_of(Path::new("b.md")).is_some());
        // A failed root reread becomes the banner, not a row.
        e.children_loaded(
            Path::new(""),
            Err(crate::workspace::contracts::Error::new(
                crate::workspace::contracts::ErrorKind::Io,
                "offline",
            )),
            cx,
        );
        assert!(e.operation_error.is_some());
    });
}
#[gpui::test]
fn external_changes_reread_loaded_folders_through_the_directory_subscription(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.md"), "a").unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let preferences = cx.new(|_| PreferencesStore::memory());
    let explorer = cx.new(|cx| Explorer::new(false, preferences, cx));
    explorer.update(cx, |e, cx| {
        e.load_workspace(ws.clone(), ws.list(Path::new("")).unwrap(), cx)
    });
    explorer.read_with(cx, |e, _| assert!(e.watch.is_some()));
    // Give FSEvents a moment to arm before the external write.
    std::thread::sleep(std::time::Duration::from_millis(300));
    std::fs::write(dir.path().join("from-agent.md"), "x").unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        cx.run_until_parked();
        if explorer.read_with(cx, |e, _| {
            e.tree.index_of(Path::new("from-agent.md")).is_some()
        }) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the tree never saw the external file"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}
