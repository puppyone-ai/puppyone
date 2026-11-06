use super::*;
use crate::workspace::Workspace;
use core::prelude::v1::test;

/// O-1: a pinned file sits above the tree and opens with a click; the fold
/// hides the tree under the pins; a move carries the pin and a deletion
/// takes it away.
#[gpui::test]
fn pinned_files_sit_above_the_tree_and_follow_their_files(cx: &mut TestAppContext) {
    use crate::editor::workbench::resource_operations::Outcome;
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("docs")).unwrap();
    std::fs::write(dir.path().join("docs/plan.md"), "a").unwrap();
    std::fs::write(dir.path().join("notes.md"), "b").unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let preferences = cx.new(|_| PreferencesStore::memory());
    let session = cx.new(|cx| ExplorerSession::new(false, preferences.clone(), cx));
    let (explorer, vcx) =
        cx.add_window_view(|_, cx| Explorer::new(session.clone(), preferences.clone(), cx));
    let owner = session.update(vcx, |e, cx| {
        e.load_workspace(ws.clone(), ws.list(Path::new("")).unwrap(), cx);
        e.toggle_pin(Path::new("docs/plan.md"), cx);
        e.toggle_pin(Path::new("notes.md"), cx);
        crate::editor::workbench::catalog::resource_key(&ws.resource_id(Path::new("")).unwrap())
    });
    explorer.update(vcx, |e, cx| {
        e.set_host(
            Host {
                frame: Rect::new(0., 0., 260., 600.),
                ..Default::default()
            },
            cx,
        )
    });
    let events = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let seen = events.clone();
    vcx.update(|_, cx| {
        cx.subscribe(&explorer, move |_, event: &ExplorerEvent, _| {
            seen.borrow_mut().push(format!("{event:?}"))
        })
        .detach()
    });
    vcx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let pin = vcx.debug_bounds("explorer-pin:docs/plan.md").unwrap();
    let other = vcx.debug_bounds("explorer-pin:notes.md").unwrap();
    // Two columns of at least 104px share the 248px the pins get.
    assert_eq!(pin.origin.y, other.origin.y);
    vcx.simulate_click(pin.center(), Modifiers::none());
    assert!(
        events
            .borrow()
            .iter()
            .any(|e| e == &format!("{:?}", ExplorerEvent::Open("docs/plan.md".into())))
    );
    // The fold hides the tree, and opens it again.
    let toggle = vcx.debug_bounds("explorer-files-toggle").unwrap();
    vcx.simulate_click(toggle.center(), Modifiers::none());
    session.read_with(vcx, |e, cx| assert!(e.pins(cx).files_collapsed));
    vcx.simulate_click(toggle.center(), Modifiers::none());
    session.read_with(vcx, |e, cx| assert!(!e.pins(cx).files_collapsed));
    // A moved folder carries the pin; a deleted file loses its own.
    session.update(vcx, |e, cx| {
        e.finish_op(
            &owner,
            Outcome {
                moved: vec![("docs".into(), "archive".into())],
                removed: vec!["notes.md".into()],
                ..Default::default()
            },
            cx,
        );
        let pins = e.pins(cx);
        assert_eq!(
            pins.files
                .iter()
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>(),
            vec!["archive/plan.md"]
        );
        // Unpinning the last file forgets the project's pins.
        e.toggle_pin(Path::new("archive/plan.md"), cx);
        assert!(preferences.read(cx).state.explorer_pins.is_empty());
    });
}
