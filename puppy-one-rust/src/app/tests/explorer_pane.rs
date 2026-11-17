//! The Explorer as the window hosts it: menus, keys, selection, virtual rows, fades, motion.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn explorer_row_menus_light_their_trigger_and_dismiss(cx: &mut TestAppContext) {
    use explorer::{MenuAt, RowTrigger};
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    let (index, path) = session.read_with(cx, |e, _| {
        let index = e.tree().rows.iter().position(|r| !r.folder).unwrap();
        (index, e.tree().rows[index].path.clone())
    });
    // "⋮" leaves the selection alone and lights its own trigger.
    explorer.update(cx, |e, cx| {
        let before = session.read(cx).tree().selected.clone();
        e.open_node_menu(index, MenuAt::Row(path.clone(), RowTrigger::More), cx);
        assert_eq!(session.read(cx).tree().selected, before);
        let menu = e.menu().unwrap();
        assert_eq!(menu.row_trigger(&path), Some(RowTrigger::More));
    });
    draw(cx);
    // GPUI Kit dismisses the popover on a press outside it.
    cx.simulate_click(point(px(900.), px(500.)), Modifiers::none());
    explorer.read_with(cx, |e, _| assert!(e.menu().is_none()));
    // A right click selects the row and pins the menu at the pointer.
    explorer.update(cx, |e, cx| {
        e.open_node_menu(index, MenuAt::Pointer(point(px(100.), px(100.))), cx);
        let tree = session.read(cx).tree();
        assert_eq!(tree.selected, path);
        assert!(tree.selection.contains(&path));
    });
    draw(cx);
    cx.simulate_keystrokes("escape");
    explorer.read_with(cx, |e, _| assert!(e.menu().is_none()));
}
#[gpui::test]
fn explorer_keys_move_the_selection_and_fill_the_clipboard(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    session.update(cx, |e, cx| {
        let first = e.tree().rows[0].path.clone();
        e.select(&first, false, false, cx);
    });
    explorer.update_in(cx, |e, w, cx| e.focus_handle(cx).focus(w, cx));
    draw(cx);
    cx.simulate_keystrokes("down");
    session.read_with(cx, |e, _| {
        assert_eq!(e.tree().selected, e.tree().rows[1].path)
    });
    cx.simulate_keystrokes("end");
    session.read_with(cx, |e, _| {
        assert_eq!(e.tree().selected, e.tree().rows.last().unwrap().path)
    });
    cx.simulate_keystrokes("secondary-x");
    session.read_with(cx, |e, _| {
        let selected = e.tree().selected.clone();
        assert_eq!(
            e.clipboard(),
            Some(&explorer::FileClipboard::Cut(vec![selected]))
        );
    });
}
#[gpui::test]
fn folder_selection_expands_tree_without_resetting_to_editor(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    let (index, path, before) = session.read_with(cx, |e, _| {
        let index = e.tree().rows.iter().position(|r| r.folder).unwrap();
        let row = &e.tree().rows[index];
        (index, row.path.clone(), row.expanded)
    });
    explorer.update(cx, |e, cx| e.open_row(index, cx));
    session.update(cx, |e, _| {
        assert_eq!(e.tree().selected, path);
        assert_eq!(e.tree_mut().find_mut(&path).unwrap().expanded, !before);
    });
    view.update_in(cx, |s, w, cx| s.receive(w, cx));
    session.read_with(cx, |e, _| assert_eq!(e.tree().selected, path));
}
#[gpui::test]
fn large_tree_uses_gpui_virtual_rows(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    session_of(&view, cx).update(cx, |e, cx| {
        e.tree_mut().rows = (0..100_000)
            .map(|i| crate::model::Row {
                path: format!("{i}.txt").into(),
                name: format!("{i}.txt"),
                folder: false,
                expanded: false,
                depth: i % 200,
                display: format!("{i}"),
                extension: None,
                error: None,
                status: false,
            })
            .collect();
        cx.notify();
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    explorer.read_with(cx, |e, _| {
        assert!(e.painted_rows > 0);
        assert!(e.painted_rows < 1000, "painted {}", e.painted_rows);
    });
}
#[test]
fn sidebar_tree_fade_follows_use_scroll_edge_state() {
    use explorer::bottom_fade;
    // Not scrollable (overflow within the 1px threshold): no fade.
    assert_eq!(bottom_fade(0., 0.), 0.);
    assert_eq!(bottom_fade(0., 1.), 0.);
    // Rows remain below: full fade until within 24px of the end.
    assert_eq!(bottom_fade(0., 400.), 1.);
    assert_eq!(bottom_fade(-376., 400.), 1.);
    assert_eq!(bottom_fade(-388., 400.), 0.5);
    assert_eq!(bottom_fade(-400., 400.), 0.);
    // Overscroll is clamped like `scrollTop`.
    assert_eq!(bottom_fade(-480., 400.), 0.);
    assert_eq!(bottom_fade(30., 400.), 1.);
}
#[gpui::test]
fn sidebar_tree_fades_into_the_footer_only_while_rows_remain_below(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = session_of(&view, cx);
    explorer.update(cx, |e, cx| {
        e.tree_mut().rows = (0..500)
            .map(|i| crate::model::Row {
                path: format!("{i}.txt").into(),
                name: format!("{i}.txt"),
                folder: false,
                expanded: false,
                depth: 0,
                display: format!("{i}"),
                extension: None,
                error: None,
                status: false,
            })
            .collect();
        cx.notify();
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let fade = |explorer: &Entity<ExplorerSession>, cx: &mut VisualTestContext| {
        explorer.read_with(cx, |e, _| {
            let state = e.scroll().0.borrow();
            explorer::bottom_fade(
                f32::from(state.base_handle.offset().y),
                f32::from(state.base_handle.max_offset().y),
            )
        })
    };
    assert_eq!(fade(&explorer, cx), 1.);
    explorer.update(cx, |e, cx| {
        e.scroll().scroll_to_bottom();
        cx.notify();
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    assert_eq!(fade(&explorer, cx), 0.);
}
#[gpui::test]
fn opening_a_folder_animates_its_rows_unless_motion_is_reduced(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    // A collapsed fixture folder whose children are already loaded.
    let folder = session.read_with(cx, |e, _| {
        e.tree()
            .rows
            .iter()
            .position(|r| r.folder && !r.expanded)
            .unwrap()
    });
    let started = std::time::Instant::now();
    session.update(cx, |e, cx| {
        let path = e.tree().rows[folder].path.clone();
        assert!(!e.tree_mut().toggle(&path));
        cx.notify();
    });
    draw(cx);
    // Motion runs on the real clock: a stalled machine may be past half way.
    if started.elapsed() < MOTION_EARLY {
        explorer.read_with(cx, |e, _| {
            // The first child starts hidden and the marker starts closed.
            assert!(e.motion().row(folder + 1).reveal.unwrap() < 0.5);
            assert!(e.motion().disclosure(folder).unwrap() < 0.5);
        });
    }
    // With reduced motion the same disclosure lands at once.
    cx.update(|_, cx| cx.set_reduce_motion(true));
    session.update(cx, |e, cx| {
        let path = e.tree().rows[folder].path.clone();
        e.tree_mut().toggle(&path);
        cx.notify();
    });
    draw(cx);
    explorer.read_with(cx, |e, _| {
        assert_eq!(e.motion().disclosure(folder), None);
        assert_eq!(e.motion().row(folder + 1), Default::default());
    });
}
