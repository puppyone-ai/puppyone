//! The pane menu drives the workbench controller (`editorPaneActions`): a
//! closed pane leaves its survivor's editor and history untouched, Escape
//! leaves the layout alone, and a read that lands after its pane closed
//! cannot fill a pane.
use super::*;
use crate::editor::{
    host::DocumentEditor,
    workbench::{layout::Direction, pane::Action},
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
