//! The pane menu drives the workbench controller (`editorPaneActions`): a
//! closed pane leaves its survivor's editor and history untouched, Escape
//! leaves the layout alone, and a read that lands after its pane closed
//! cannot fill a pane.
use super::*;
use crate::editor::{
    host::DocumentEditor,
    workbench::{
        layout::{Direction, Placement},
        pane::Action,
    },
};
use core::prelude::v1::test;
use std::path::Path;

fn settle(view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell, &App) -> bool) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        draw(cx);
        if view.read_with(cx, |s, cx| ready(s, cx)) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Workbench did not settle"
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

fn begin(view: &Entity<Shell>, cx: &mut VisualTestContext, intent: Intent) {
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| d.begin(intent))
    });
}

/// `a.md` in the first pane and `b.md` split off in `direction`; returns
/// the pane ids in layout order and the editor key each shows.
fn two_panes(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    root: &Path,
    direction: Direction,
) -> Vec<(String, String)> {
    begin(view, cx, Intent::OpenFolder(root.into()));
    settle(view, cx, &|s, cx| s.files(cx).state().is_some());
    begin(view, cx, Intent::OpenFile("a.md".into()));
    settle(view, cx, &|s, cx| s.files(cx).opened().is_some());
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.state_mut().unwrap().split(direction))
    });
    begin(view, cx, Intent::OpenFile("b.md".into()));
    settle(view, cx, &|s, cx| s.files(cx).visible_slots().len() == 2);
    panes(view, cx)
}

fn panes(view: &Entity<Shell>, cx: &mut VisualTestContext) -> Vec<(String, String)> {
    view.read_with(cx, |s, cx| {
        s.files(cx)
            .state()
            .unwrap()
            .layout
            .root
            .panes()
            .into_iter()
            .map(|(pane, key)| (pane.to_owned(), key.unwrap_or_default().to_owned()))
            .collect()
    })
}

fn editor_of(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    key: &str,
) -> Entity<DocumentEditor> {
    view.read_with(cx, |s, cx| {
        let slot = s.files(cx).slot_for_key(key).unwrap();
        s.editor.read(cx).hosts[&slot].clone()
    })
}

fn text(editor: &Entity<DocumentEditor>, cx: &mut VisualTestContext) -> String {
    editor.read_with(cx, |e, cx| e.text(cx).unwrap())
}

/// The pane's own menu: open it and choose Close.
fn close_from_menu(editor: &Entity<DocumentEditor>, cx: &mut VisualTestContext) {
    editor.update_in(cx, |e, w, cx| {
        e.lab_state("menu", w, cx);
        e.run_title_action(Action::Close, w, cx);
    });
    draw(cx);
}

#[gpui::test]
fn closing_either_pane_from_its_menu_keeps_the_survivor_and_its_history(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // Each case opens its own folder; earlier ones stay open in the
    // background, so their folders must outlive the test.
    let mut folders = Vec::new();
    for direction in [Direction::Horizontal, Direction::Vertical] {
        for (target, initially_active) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
            let case = format!("{direction:?} close {target} while {initially_active} active");
            let temp = tempfile::tempdir().unwrap();
            std::fs::write(temp.path().join("a.md"), "# A\n").unwrap();
            std::fs::write(temp.path().join("b.md"), "# B\n").unwrap();
            let panes = two_panes(&view, cx, temp.path(), direction);
            assert_eq!(panes.len(), 2, "{case}");
            let (survivor_pane, survivor_key) = panes[1 - target].clone();
            let survivor = editor_of(&view, cx, &survivor_key);
            let original = text(&survivor, cx);
            focus_pane(&view, cx, &survivor_pane);
            cx.simulate_input("edited ");
            let edited = text(&survivor, cx);
            assert_ne!(edited, original, "{case}");
            focus_pane(&view, cx, &panes[initially_active].0);

            let target_editor = editor_of(&view, cx, &panes[target].1);
            close_from_menu(&target_editor, cx);
            settle(&view, cx, &|s, cx| s.files(cx).visible_slots().len() == 1);
            assert_eq!(
                panes_after(&view, cx),
                std::slice::from_ref(&survivor_pane),
                "{case}"
            );
            view.read_with(cx, |s, cx| {
                let state = s.files(cx).state().unwrap();
                assert_eq!(state.layout.active, survivor_pane, "{case}");
                assert_eq!(state.layout.active_editor(), Some(survivor_key.as_str()));
            });
            assert!(!target_editor.update_in(cx, |e, w, cx| e.lab_focus(w, cx)).0);
            assert_eq!(
                editor_of(&view, cx, &survivor_key).entity_id(),
                survivor.entity_id(),
                "{case}: the survivor keeps its editor"
            );
            assert_eq!(
                survivor.update_in(cx, |e, w, cx| e.lab_focus(w, cx)),
                (false, true),
                "{case}: focus moves into the survivor"
            );
            assert_eq!(text(&survivor, cx), edited, "{case}");
            command(&view, cx, Command::Undo);
            assert_eq!(text(&survivor, cx), original, "{case}");
            command(&view, cx, Command::Redo);
            assert_eq!(text(&survivor, cx), edited, "{case}");

            close_from_menu(&survivor, cx);
            settle(&view, cx, &|s, cx| s.files(cx).visible_slots().is_empty());
            view.read_with(cx, |s, cx| {
                let layout = &s.files(cx).state().unwrap().layout;
                assert_eq!(layout.root.panes().len(), 1, "{case}");
                assert_eq!(layout.active_editor(), None, "{case}: the pane is empty");
            });
            folders.push(temp);
        }
    }
}

/// A click into the pane: it becomes active and its document takes the
/// keyboard.
fn focus_pane(view: &Entity<Shell>, cx: &mut VisualTestContext, pane: &str) {
    view.update_in(cx, |s, w, cx| {
        s.session.docs.update(cx, |d, _| d.focus(pane));
        s.sync_editor(w, cx);
    });
    draw(cx);
}

fn panes_after(view: &Entity<Shell>, cx: &mut VisualTestContext) -> Vec<String> {
    panes(view, cx).into_iter().map(|(pane, _)| pane).collect()
}

#[gpui::test]
fn escape_dismisses_the_pane_menu_and_leaves_both_panes(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), "# A\n").unwrap();
    std::fs::write(temp.path().join("b.md"), "# B\n").unwrap();
    let (view, cx) = setup(cx);
    for direction in [Direction::Horizontal, Direction::Vertical] {
        let before = two_panes(&view, cx, temp.path(), direction);
        let first = editor_of(&view, cx, &before[0].1);
        first.update_in(cx, |e, w, cx| e.lab_state("menu", w, cx));
        draw(cx);
        assert!(first.update_in(cx, |e, w, cx| e.lab_focus(w, cx)).0);
        cx.simulate_keystrokes("escape");
        draw(cx);
        assert_eq!(
            first.update_in(cx, |e, w, cx| e.lab_focus(w, cx)),
            (false, true),
            "{direction:?}: the menu closes and focus returns to its pane"
        );
        assert_eq!(panes(&view, cx), before, "{direction:?}");
        view.read_with(cx, |s, cx| {
            assert_eq!(s.files(cx).visible_slots().len(), 2, "{direction:?}")
        });
        for (pane, _) in before.iter().rev() {
            view.update(cx, |s, cx| {
                s.session.docs.update(cx, |d, _| d.close_pane(pane))
            });
        }
        settle(&view, cx, &|s, cx| s.files(cx).visible_slots().is_empty());
    }
}

#[gpui::test]
fn a_read_landing_after_its_pane_closed_cannot_fill_a_pane(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let mut folders = Vec::new();
    for direction in [Direction::Horizontal, Direction::Vertical] {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("a.md"), "# A\n").unwrap();
        std::fs::write(temp.path().join("late.md"), "late closed content\n").unwrap();
        begin(&view, cx, Intent::OpenFolder(temp.path().into()));
        settle(&view, cx, &|s, cx| s.files(cx).state().is_some());
        begin(&view, cx, Intent::OpenFile("a.md".into()));
        settle(&view, cx, &|s, cx| s.files(cx).opened().is_some());
        let first = view.read_with(cx, |s, cx| {
            s.files(cx).state().unwrap().layout.active.clone()
        });
        let key = panes(&view, cx)[0].1.clone();
        let editor = editor_of(&view, cx, &key);
        // The new pane starts loading; its read has not been received yet
        // when its pane closes.
        let loading = view.update(cx, |s, cx| {
            s.session.docs.update(cx, |d, _| {
                d.state_mut().unwrap().split(direction);
                let pane = d.state().unwrap().layout.active.clone();
                d.begin(Intent::OpenFile("late.md".into()));
                pane
            })
        });
        assert_ne!(loading, first);
        // The empty pane's close button (`close-empty-{pane}`).
        view.update_in(cx, |s, w, cx| {
            s.session.docs.update(cx, |d, _| d.close_pane(&loading));
            s.sync_editor(w, cx);
        });
        settle(&view, cx, &|s, cx| !s.files(cx).busy());
        view.read_with(cx, |s, cx| {
            let state = s.files(cx).state().unwrap();
            assert_eq!(
                state.layout.root.panes(),
                [(first.as_str(), state.layout.active_editor())],
                "{direction:?}: no pane comes back for the late read"
            );
            assert_eq!(state.layout.active, first, "{direction:?}");
            assert_eq!(
                s.files(cx).opened().map(|(_, path)| path.to_owned()),
                Some(Path::new("a.md").to_owned()),
                "{direction:?}: the surviving pane keeps its document"
            );
            // Closing a pane keeps its document open: it waits as a tab.
            assert_eq!(state.catalog.editors.len(), 2, "{direction:?}");
        });
        assert_eq!(editor_of(&view, cx, &key).entity_id(), editor.entity_id());
        assert!(!text(&editor, cx).contains("late closed content"));
        let pane = panes(&view, cx)[0].0.clone();
        view.update(cx, |s, cx| {
            s.session.docs.update(cx, |d, _| d.close_pane(&pane))
        });
        settle(&view, cx, &|s, cx| s.files(cx).visible_slots().is_empty());
        folders.push(temp);
    }
}

/// `EditorSplitResizeHandle`, `horizontal / vertical editor splitter
/// lifecycle`: dragging a split's edge previews the new ratio, Escape or
/// leaving the window puts back the ratio it had, a release commits the
/// last position, kept within 0.15..0.85, and a move after it changes
/// nothing.
fn drag_an_editor_split(cx: &mut TestAppContext, direction: Direction) {
    let temp = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md"] {
        std::fs::write(temp.path().join(name), name).unwrap();
    }
    let (view, cx) = setup(cx);
    cx.update(|w, _| w.activate_window());
    two_panes(&view, cx, temp.path(), direction);
    draw(cx);
    let ratio = |cx: &mut VisualTestContext| {
        view.read_with(cx, |s, cx| {
            let state = s.files(cx).state().unwrap();
            serde_json::to_value(&state.layout).unwrap()["root"]["ratio"]
                .as_f64()
                .unwrap()
        })
    };
    let edge = |cx: &mut VisualTestContext| {
        cx.debug_bounds("editor-resize-editor-split-1")
            .unwrap()
            .center()
    };
    let at = |edge: Point<Pixels>, by: f32| match direction {
        Direction::Horizontal => point(edge.x + px(by), edge.y),
        Direction::Vertical => point(edge.x, edge.y + px(by)),
    };
    let drag = |cx: &mut VisualTestContext, by: f32| {
        draw(cx);
        let edge = edge(cx);
        cx.simulate_mouse_down(edge, MouseButton::Left, Modifiers::default());
        cx.simulate_mouse_move(at(edge, by), Some(MouseButton::Left), Modifiers::default());
        at(edge, by)
    };
    assert_eq!(ratio(cx), 0.5);
    let end = drag(cx, -60.);
    assert!(ratio(cx) < 0.5, "the drag previews");
    cx.simulate_keystrokes("escape");
    assert_eq!(ratio(cx), 0.5);
    cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
    assert_eq!(ratio(cx), 0.5, "a release after Escape changes nothing");
    for (by, clamped) in [(5_000., 0.85), (-5_000., 0.15)] {
        let end = drag(cx, by);
        cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
        assert_eq!(ratio(cx), clamped);
        cx.simulate_mouse_move(at(end, -by), None, Modifiers::default());
        assert_eq!(ratio(cx), clamped, "a late move after the release");
    }
    drag(cx, 60.);
    let preview = ratio(cx);
    assert!(preview > 0.15);
    cx.update(|w, cx| w.blur(cx));
    assert_eq!(ratio(cx), preview, "losing keyboard focus keeps the drag");
    cx.deactivate_window();
    draw(cx);
    assert_eq!(ratio(cx), 0.15, "leaving the window puts the ratio back");
}
#[gpui::test]
fn a_side_by_side_split_drag_previews_commits_once_and_cancels(cx: &mut TestAppContext) {
    drag_an_editor_split(cx, Direction::Horizontal);
}
#[gpui::test]
fn a_stacked_split_drag_previews_commits_once_and_cancels(cx: &mut TestAppContext) {
    drag_an_editor_split(cx, Direction::Vertical);
}

fn pane_bounds(view: &Entity<Shell>, cx: &mut VisualTestContext, pane: &str) -> Bounds<Pixels> {
    view.read_with(cx, |s, cx| s.editor.read(cx).pane_bounds.borrow()[pane])
}

fn handle_of(cx: &mut VisualTestContext, name: &str) -> Point<Pixels> {
    let selector: &'static str = Box::leak(format!("pane-handle:{name}").into_boxed_str());
    cx.debug_bounds(selector).unwrap().center()
}

fn click_handle(cx: &mut VisualTestContext, name: &str) {
    let at = handle_of(cx, name);
    cx.simulate_click(at, Modifiers::default());
}

fn drop_preview(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
) -> Option<(String, Direction, Placement)> {
    view.read_with(cx, |s, cx| {
        s.editor
            .read(cx)
            .drop
            .as_ref()
            .map(|d| (d.pane.clone(), d.direction, d.placement))
    })
}

fn dragging(cx: &mut VisualTestContext) -> bool {
    cx.update(|_, cx| cx.has_active_drag())
}

/// `DesktopEditorSplitView: pane chrome`: a pane's handle shows while the
/// pointer is in its top third or its menu is open, a lone pane keeps it,
/// and one pane menu is open at a time without a click starting a drag.
#[gpui::test]
fn the_pane_handle_shows_in_the_top_third_and_one_menu_opens_at_a_time(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md"] {
        std::fs::write(temp.path().join(name), name).unwrap();
    }
    let (view, cx) = setup(cx);
    cx.update(|w, _| w.activate_window());
    begin(&view, cx, Intent::OpenFolder(temp.path().into()));
    settle(&view, cx, &|s, cx| s.files(cx).state().is_some());
    begin(&view, cx, Intent::OpenFile("a.md".into()));
    settle(&view, cx, &|s, cx| s.files(cx).opened().is_some());
    let (pane, key) = panes(&view, cx)[0].clone();
    let a = editor_of(&view, cx, &key);
    let bounds = pane_bounds(&view, cx, &pane);
    let revealed = |cx: &mut VisualTestContext| a.read_with(cx, |e, _| e.lab_handle_revealed());
    let at = |share: f32| {
        point(
            bounds.center().x,
            bounds.origin.y + bounds.size.height * share,
        )
    };
    assert!(!revealed(cx));
    cx.simulate_mouse_move(at(0.2), None, Modifiers::default());
    assert!(revealed(cx), "the top third shows the handle");
    cx.simulate_mouse_move(at(0.6), None, Modifiers::default());
    assert!(!revealed(cx), "below it the handle hides");
    cx.simulate_mouse_move(at(0.2), None, Modifiers::default());
    draw(cx);
    let menu_open = |e: &Entity<DocumentEditor>, cx: &mut VisualTestContext| {
        e.update_in(cx, |e, w, cx| e.lab_focus(w, cx)).0
    };
    click_handle(cx, "a.md");
    draw(cx);
    assert!(menu_open(&a, cx), "a lone pane keeps its menu");
    cx.simulate_mouse_move(at(0.9), None, Modifiers::default());
    assert!(revealed(cx), "an open menu keeps the handle");
    click_handle(cx, "a.md");
    draw(cx);
    assert!(!menu_open(&a, cx));

    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.state_mut().unwrap().split(Direction::Horizontal)
        })
    });
    begin(&view, cx, Intent::OpenFile("b.md".into()));
    settle(&view, cx, &|s, cx| s.files(cx).visible_slots().len() == 2);
    let second = panes(&view, cx)[1].1.clone();
    let b = editor_of(&view, cx, &second);
    draw(cx);
    click_handle(cx, "a.md");
    draw(cx);
    assert_eq!((menu_open(&a, cx), menu_open(&b, cx)), (true, false));
    assert!(!dragging(cx), "a click is not a drag");
    click_handle(cx, "b.md");
    draw(cx);
    assert_eq!((menu_open(&a, cx), menu_open(&b, cx)), (false, true));
    assert!(!dragging(cx));
}

/// `uses the grab handle only to move an existing pane`, `cancels pane
/// movement without swallowing the next menu press`: dragging a pane's
/// handle over another pane previews the edge it lands on, Escape ends
/// the move with the layout untouched and the next press opens the menu,
/// and a release moves the pane there.
#[gpui::test]
fn a_pane_moves_by_its_handle_and_escape_cancels_the_move(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md"] {
        std::fs::write(temp.path().join(name), name).unwrap();
    }
    let (view, cx) = setup(cx);
    cx.update(|w, _| w.activate_window());
    let before = two_panes(&view, cx, temp.path(), Direction::Horizontal);
    draw(cx);
    let target = pane_bounds(&view, cx, &before[1].0);
    let edge = point(target.right() - px(12.), target.center().y);
    let grab = |cx: &mut VisualTestContext| {
        let from = handle_of(cx, "a.md");
        cx.simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
        cx.simulate_mouse_move(
            point(from.x + px(8.), from.y + px(4.)),
            Some(MouseButton::Left),
            Modifiers::default(),
        );
        draw(cx);
        assert!(dragging(cx));
        assert_eq!(drop_preview(&view, cx), None, "never onto its own pane");
        cx.simulate_mouse_move(edge, Some(MouseButton::Left), Modifiers::default());
        draw(cx);
        assert_eq!(
            drop_preview(&view, cx),
            Some((
                before[1].0.clone(),
                Direction::Horizontal,
                Placement::Second
            ))
        );
    };
    grab(cx);
    cx.simulate_keystrokes("escape");
    draw(cx);
    assert!(!dragging(cx));
    assert_eq!(drop_preview(&view, cx), None);
    cx.simulate_mouse_up(edge, MouseButton::Left, Modifiers::default());
    assert_eq!(panes(&view, cx), before, "a cancelled move changes nothing");
    let a = editor_of(&view, cx, &before[0].1);
    click_handle(cx, "a.md");
    draw(cx);
    assert!(a.update_in(cx, |e, w, cx| e.lab_focus(w, cx)).0);
    cx.simulate_keystrokes("escape");
    draw(cx);

    grab(cx);
    cx.simulate_mouse_up(edge, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert!(!dragging(cx));
    assert_eq!(drop_preview(&view, cx), None);
    assert_eq!(panes(&view, cx), [before[1].clone(), before[0].clone()]);
    view.read_with(cx, |s, cx| {
        assert_eq!(s.files(cx).state().unwrap().layout.active, before[0].0)
    });
}

/// `opens one Explorer file at the nearest pane edge on drop`, `clears an
/// Explorer split preview when the window loses the drag session`: an
/// Explorer file dragged over a pane previews the nearest edge, leaving
/// the window clears it, and a drop opens the file there.
#[gpui::test]
fn an_explorer_file_drops_at_the_nearest_pane_edge(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md"] {
        std::fs::write(temp.path().join(name), name).unwrap();
    }
    let (view, cx) = setup(cx);
    cx.update(|w, _| w.activate_window());
    begin(&view, cx, Intent::OpenFolder(temp.path().into()));
    settle(&view, cx, &|s, cx| {
        s.files(cx).state().is_some()
            && s.explorer
                .session
                .read(cx)
                .tree()
                .rows
                .iter()
                .any(|r| r.path == std::path::Path::new("b.md"))
    });
    begin(&view, cx, Intent::OpenFile("a.md".into()));
    settle(&view, cx, &|s, cx| s.files(cx).opened().is_some());
    let (pane, _) = panes(&view, cx)[0].clone();
    let bounds = pane_bounds(&view, cx, &pane);
    let edge = point(bounds.right() - px(12.), bounds.center().y);
    let row = cx.debug_bounds("tree-row-name:b.md").unwrap().center();
    cx.simulate_mouse_down(row, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_move(
        point(row.x + px(8.), row.y + px(4.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    let hover = |cx: &mut VisualTestContext| {
        cx.simulate_mouse_move(edge, Some(MouseButton::Left), Modifiers::default());
        draw(cx);
        assert_eq!(
            drop_preview(&view, cx),
            Some((pane.clone(), Direction::Horizontal, Placement::Second))
        );
    };
    hover(cx);
    cx.deactivate_window();
    draw(cx);
    assert_eq!(
        drop_preview(&view, cx),
        None,
        "leaving the window clears it"
    );
    cx.update(|w, _| w.activate_window());
    hover(cx);
    cx.simulate_mouse_up(edge, MouseButton::Left, Modifiers::default());
    settle(&view, cx, &|s, cx| s.files(cx).visible_slots().len() == 2);
    let after = panes(&view, cx);
    assert_eq!(after[0].0, pane);
    assert!(after[1].1.ends_with("b.md"), "{after:?}");
    assert_eq!(drop_preview(&view, cx), None);
}

/// `DesktopEditorSplitView: editor runtimes across panes`: in a nested
/// three-pane split each document keeps its own editor and edits while
/// focus moves between panes and while panes are reordered or moved to
/// another axis; nothing is remounted.
#[gpui::test]
fn three_panes_keep_their_own_editors_across_focus_and_moves(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), "# A\n").unwrap();
    std::fs::write(temp.path().join("b.md"), "# B\n").unwrap();
    std::fs::write(temp.path().join("c.txt"), "C\n").unwrap();
    let (view, cx) = setup(cx);
    cx.update(|w, _| w.activate_window());
    two_panes(&view, cx, temp.path(), Direction::Horizontal);
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.state_mut().unwrap().split(Direction::Vertical))
    });
    begin(&view, cx, Intent::OpenFile("c.txt".into()));
    settle(&view, cx, &|s, cx| s.files(cx).visible_slots().len() == 3);
    let start = panes(&view, cx);
    let editors: Vec<_> = start
        .iter()
        .map(|(_, key)| editor_of(&view, cx, key))
        .collect();
    let mut texts = Vec::new();
    for ((pane, _), (editor, mark)) in start.iter().zip(editors.iter().zip(["1 ", "2 ", "3 "])) {
        focus_pane(&view, cx, pane);
        cx.simulate_input(mark);
        let typed = text(editor, cx);
        assert!(typed.contains(mark.trim()), "{pane}: {typed:?}");
        texts.push(typed);
    }
    let check = |cx: &mut VisualTestContext, case: &str| {
        for ((_, key), (editor, text_was)) in start.iter().zip(editors.iter().zip(&texts)) {
            assert_eq!(
                editor_of(&view, cx, key).entity_id(),
                editor.entity_id(),
                "{case}: {key} keeps its editor"
            );
            assert_eq!(&text(editor, cx), text_was, "{case}: {key} keeps its edit");
        }
    };
    for (pane, _) in start.iter().rev() {
        focus_pane(&view, cx, pane);
    }
    check(cx, "focus");
    let moves = [
        // Siblings swap places.
        (
            start[1].0.clone(),
            start[2].0.clone(),
            Direction::Vertical,
            Placement::Second,
        ),
        // The left pane moves under the bottom one, onto the other axis.
        (
            start[0].0.clone(),
            start[1].0.clone(),
            Direction::Vertical,
            Placement::Second,
        ),
    ];
    for (source, target, direction, placement) in moves {
        view.update_in(cx, |s, w, cx| {
            s.session.docs.update(cx, |d, _| {
                d.state_mut()
                    .unwrap()
                    .layout
                    .move_pane(&source, &target, direction, placement)
            });
            s.sync_editor(w, cx);
        });
        draw(cx);
        assert_ne!(panes(&view, cx), start, "{source} moved");
        check(cx, &format!("move {source}"));
    }
    view.read_with(cx, |s, cx| {
        assert_eq!(s.files(cx).visible_slots().len(), 3);
    });
}

/// `paneMovePreview.test.ts` #0–#1 (gap `pane-move-snapshot-preview`): a
/// moved pane shows at once a shell of its shape centred under the pointer
/// (never its live content), asks for a bitmap of its content bounds, shows
/// that bitmap when it comes, follows the pointer and is gone after the drop.
#[gpui::test]
fn a_moved_pane_shows_its_shape_then_its_snapshot_under_the_pointer(cx: &mut TestAppContext) {
    use crate::editor::workbench::pane_preview::{capture_hook as preview, preview_size};
    let temp = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md"] {
        std::fs::write(temp.path().join(name), name).unwrap();
    }
    let mut png = std::io::Cursor::new(Vec::new());
    image::RgbaImage::from_pixel(4, 4, image::Rgba([200, 40, 40, 255]))
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    preview::answer_with(Some(png.into_inner()));
    let (view, cx) = setup(cx);
    cx.update(|w, _| w.activate_window());
    let before = two_panes(&view, cx, temp.path(), Direction::Horizontal);
    draw(cx);
    let pane = pane_bounds(&view, cx, &before[0].0);
    let from = handle_of(cx, "a.md");
    cx.simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
    let at = point(from.x + px(30.), from.y + px(40.));
    cx.simulate_mouse_move(at, Some(MouseButton::Left), Modifiers::default());
    // The first frame: the shell, before any bitmap.
    cx.update(|w, cx| w.draw(cx).clear(cx));
    assert!(dragging(cx));
    let requests = preview::requests();
    assert_eq!(requests.len(), 1, "one bitmap per drag");
    let request = requests[0];
    assert_eq!(
        (request.size.width, request.size.height),
        (f32::from(pane.size.width), f32::from(pane.size.height)),
        "the pane's content bounds"
    );
    let shell = cx.debug_bounds("pane-move-preview").expect("the shell");
    let expected = preview_size(request.size.width, request.size.height);
    assert_eq!(
        (f32::from(shell.size.width), f32::from(shell.size.height)),
        (expected.width, expected.height)
    );
    assert!((f32::from(shell.center().x) - f32::from(at.x)).abs() < 1.);
    assert!((f32::from(shell.origin.y) - f32::from(at.y) - 10.).abs() < 1.);
    assert!(cx.debug_bounds("pane-move-preview-image").is_none());
    // The bitmap arrives; the preview follows the pointer.
    preview::release();
    cx.run_until_parked();
    draw(cx);
    assert!(cx.debug_bounds("pane-move-preview-image").is_some());
    let next = point(at.x + px(60.), at.y + px(20.));
    cx.simulate_mouse_move(next, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    let moved = cx.debug_bounds("pane-move-preview").unwrap();
    assert!((f32::from(moved.center().x) - f32::from(next.x)).abs() < 1.);
    cx.simulate_mouse_up(next, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert!(!dragging(cx));
    assert!(cx.debug_bounds("pane-move-preview").is_none());
    assert_eq!(preview::requests().len(), 1);
}
