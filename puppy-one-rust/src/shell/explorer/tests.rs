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
