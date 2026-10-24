use super::*;
use core::prelude::v1::test;
use gpui::EntityInputHandler;
fn setup(cx: &mut TestAppContext) -> (Entity<Probe>, &mut VisualTestContext) {
    cx.update(|cx| {
        crate::input::bind_keys(cx);
        bind_keys(cx);
    });
    let (view, cx) = cx.add_window_view(Probe::new);
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    (view, cx)
}
fn select(
    view: &Entity<Probe>,
    cx: &mut VisualTestContext,
    node: u64,
    anchor: usize,
    cursor: usize,
) -> Entity<TextInput> {
    view.update_in(cx, |s, w, cx| {
        s.state.selection = Selection {
            node,
            anchor,
            cursor,
        };
        s.sync_fields(w, cx);
        s.focus_selected(w, cx);
        s.fields[&node].clone()
    })
}
fn command(view: &Entity<Probe>, cx: &mut VisualTestContext, name: &str) {
    view.update_in(cx, |s, w, cx| s.command(name, w, cx));
    cx.run_until_parked();
}
#[gpui::test]
fn native_text_events_preserve_marks_and_document_undo(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let before = view.update(cx, |s, _| s.state.document.clone());
    let field = select(&view, cx, 2, 0, 2);
    field.update_in(cx, |i, w, cx| i.replace_text_in_range(None, "中🐶", w, cx));
    cx.run_until_parked();
    view.update(cx, |s, _| {
        let text = &s.state.document.before.content;
        assert!(text.text.starts_with("中🐶"));
        assert_eq!(text.marks.len(), text.text.chars().count());
    });
    command(&view, cx, "undo");
    view.update(cx, |s, _| assert_eq!(s.state.document, before));
    command(&view, cx, "redo");
    view.update(cx, |s, _| {
        assert!(s.state.document.before.content.text.starts_with("中🐶"))
    });
}
#[gpui::test]
fn formatting_selection_changes_styles_not_plain_text(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let text = view.update(cx, |s, _| s.state.document.before.content.text.clone());
    select(&view, cx, 2, 0, 3);
    command(&view, cx, "bold");
    view.update(cx, |s, _| {
        assert_eq!(s.state.document.before.content.text, text);
        assert!(
            s.state.document.before.content.marks[..3]
                .iter()
                .all(|m| m.bold)
        );
    });
}
#[gpui::test]
fn tab_and_enter_move_cells_without_editing_or_undo(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let (first, next, below) = view.update(cx, |s, _| {
        (
            s.state.document.cells[0][0].id,
            s.state.document.cells[0][1].id,
            s.state.document.cells[1][0].id,
        )
    });
    select(&view, cx, first, 0, 0);
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    cx.simulate_keystrokes("tab");
    view.update(cx, |s, _| {
        assert_eq!(s.state.selection.node, next);
        assert!(!s.history.can_undo());
    });
    select(&view, cx, first, 0, 0);
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    cx.simulate_keystrokes("enter");
    view.update(cx, |s, _| assert_eq!(s.state.selection.node, below));
}
#[gpui::test]
fn tsv_paste_is_one_atomic_structural_undo(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let (before, id) = view.update(cx, |s, _| {
        (s.state.document.clone(), s.state.document.cells[3][2].id)
    });
    let field = select(&view, cx, id, 0, 0);
    view.update_in(cx, |s, w, cx| {
        s.input_event(
            id,
            &field,
            &InputEvent::PasteTable("中\t🐶\nA\tB".into()),
            w,
            cx,
        )
    });
    view.update(cx, |s, _| {
        assert_eq!(s.state.document.cells[4][3].content.text, "B")
    });
    command(&view, cx, "undo");
    view.update(cx, |s, _| assert_eq!(s.state.document, before));
}
#[gpui::test]
fn ime_preedit_is_grouped_until_commit(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let before = view.update(cx, |s, _| s.state.document.clone());
    let field = select(&view, cx, 2, 0, 0);
    field.update_in(cx, |i, w, cx| {
        i.replace_and_mark_text_in_range(None, "n", Some(1..1), w, cx)
    });
    cx.run_until_parked();
    field.update_in(cx, |i, w, cx| {
        i.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx)
    });
    cx.run_until_parked();
    view.update(cx, |s, _| {
        assert!(s.pending_ime.is_some());
        assert!(!s.history.can_undo());
    });
    command(&view, cx, "bold");
    field.update_in(cx, |i, w, cx| i.replace_text_in_range(None, "你", w, cx));
    cx.run_until_parked();
    view.update(cx, |s, _| {
        assert!(s.pending_ime.is_none());
        assert!(s.state.document.before.content.text.starts_with('你'));
    });
    command(&view, cx, "undo");
    view.update(cx, |s, _| assert_eq!(s.state.document, before));
}
#[gpui::test]
fn cancelled_preedit_has_no_document_change_or_undo(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let before = view.update(cx, |s, _| s.state.document.clone());
    let field = select(&view, cx, 2, 0, 0);
    field.update_in(cx, |i, w, cx| {
        i.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx)
    });
    cx.run_until_parked();
    field.update_in(cx, |i, w, cx| i.replace_text_in_range(None, "", w, cx));
    cx.run_until_parked();
    view.update(cx, |s, _| {
        assert_eq!(s.state.document, before);
        assert!(s.pending_ime.is_none());
        assert!(!s.history.can_undo());
    });
}
#[gpui::test]
fn dirty_close_requires_discard_and_cancel_retains_buffer(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let field = select(&view, cx, 2, 0, 0);
    field.update_in(cx, |i, w, cx| i.replace_text_in_range(None, "edit ", w, cx));
    cx.run_until_parked();
    command(&view, cx, "quit");
    view.update(cx, |s, _| assert!(s.closing));
    command(&view, cx, "cancel");
    view.update(cx, |s, _| {
        assert!(!s.closing);
        assert!(s.state.document.before.content.text.starts_with("edit "));
    });
}
#[gpui::test]
fn clipboard_copy_is_plain_text_and_does_not_mutate(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let before = view.update(cx, |s, _| s.state.document.clone());
    select(&view, cx, 2, 0, 2);
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    cx.simulate_keystrokes("cmd-c");
    view.update(cx, |s, cx| {
        assert_eq!(s.state.document, before);
        assert_eq!(cx.read_from_clipboard().unwrap().text().unwrap(), "这里");
    });
}
