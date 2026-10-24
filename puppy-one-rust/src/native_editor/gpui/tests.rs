use super::*;
use crate::native_editor::core::{projection::Projection, selection::Selection};
use crate::ui::input::InputEvent;
use core::prelude::v1::test;
fn setup<'a>(
    cx: &'a mut TestAppContext,
    source: &str,
) -> (Entity<NativeEditor>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        crate::ui::input::bind_keys(cx);
        bind_keys(cx);
    });
    let (view, cx) = cx.add_window_view(|_, cx| NativeEditor::new(cx));
    view.update_in(cx, |s, w, cx| {
        s.receive(
            &serde_json::json!({"kind":"open","id":"document","name":"test.md","text":source}),
            w,
            cx,
        );
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    (view, cx)
}
fn command(view: &Entity<NativeEditor>, cx: &mut VisualTestContext, name: &str) {
    view.update_in(cx, |s, w, cx| s.command(name, w, cx));
    cx.run_until_parked();
}
#[gpui::test]
fn native_input_formatting_source_toggle_and_history_share_one_buffer(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "# Title\n\nHello 中🐶\n");
    let field = view.update_in(cx, |s, w, cx| {
        s.session.as_mut().unwrap().state.selection = Selection {
            anchor: 6,
            cursor: 11,
        };
        s.sync_fields(w, cx);
        s.focus_selected(w, cx);
        s.input.as_ref().unwrap().clone()
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    cx.simulate_keystrokes("cmd-b");
    cx.run_until_parked();
    view.update(cx, |s, _| {
        assert!(s.session.as_ref().unwrap().text().contains("**Hello**"))
    });
    field.update_in(cx, |i, w, cx| i.replace_text_in_range(None, "你好", w, cx));
    cx.run_until_parked();
    let changed = view.update(cx, |s, _| s.session.as_ref().unwrap().text());
    assert!(changed.contains("**你好**"));
    command(&view, cx, "source");
    view.update(cx, |s, _| {
        assert_eq!(s.session.as_ref().unwrap().text(), changed)
    });
    command(&view, cx, "undo");
    view.update(cx, |s, _| {
        assert!(s.session.as_ref().unwrap().text().contains("**Hello**"))
    });
    command(&view, cx, "undo");
    view.update(cx, |s, _| assert!(!s.session.as_ref().unwrap().dirty()));
}

#[gpui::test]
fn round_trip_without_other_provider_edits_retains_native_history(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "# Original\n");
    command(&view, cx, "h2");
    view.update_in(cx,|s,w,cx|{
        let revision=s.session.as_ref().unwrap().revision;
        s.command("source",w,cx);
        assert_eq!(s.session.as_ref().unwrap().revision,revision);
        let source=s.session.as_ref().unwrap().text();
        s.receive(&serde_json::json!({"kind":"open","id":"document","name":"test.md","text":source,"baseline":"# Original\n","revision":revision}),w,cx);
        assert!(s.session.as_ref().unwrap().can_undo());
    });
    command(&view, cx, "undo");
    view.update(cx, |s, _| assert!(!s.session.as_ref().unwrap().dirty()));
}

#[gpui::test]
fn modal_composition_end_does_not_leave_editor_stuck(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "Text\n");
    let field = view.update(cx, |s, _| s.input.as_ref().unwrap().clone());
    field.update_in(cx, |i, w, cx| {
        i.replace_and_mark_text_in_range(None, "你", None, w, cx)
    });
    cx.run_until_parked();
    view.update(cx, |s, cx| s.gate(true, true, cx));
    field.update_in(cx, |i, w, cx| i.unmark_text(w, cx));
    cx.run_until_parked();
    view.update(cx, |s, cx| {
        assert!(s.session.as_ref().unwrap().pending_ime.is_none());
        s.gate(false, true, cx);
    });
    command(&view, cx, "undo");
    view.update(cx, |s, _| {
        assert_eq!(s.session.as_ref().unwrap().text(), "Text\n")
    });
}
#[gpui::test]
fn frozen_and_modal_input_cannot_mutate_snapshot(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "Before\n");
    let field = view.update_in(cx, |s, w, cx| {
        let messages = s.receive(&serde_json::json!({"kind":"snapshot","request":7}), w, cx);
        assert!(
            matches!(&messages[0],ClientMessage::Snapshot{request:7,text,..} if text=="Before\n")
        );
        s.input.as_ref().unwrap().clone()
    });
    field.update_in(cx, |i, w, cx| i.replace_text_in_range(None, "lost", w, cx));
    cx.run_until_parked();
    view.update_in(cx, |s, w, cx| {
        assert_eq!(s.session.as_ref().unwrap().text(), "Before\n");
        s.receive(&serde_json::json!({"kind":"thaw"}), w, cx);
        s.gate(true, true, cx);
    });
    field.update_in(cx, |i, w, cx| {
        i.replace_and_mark_text_in_range(None, "lost", Some(4..4), w, cx)
    });
    cx.run_until_parked();
    assert_eq!(field.read_with(cx, |i, _| i.text().to_owned()), "Before");
}
#[gpui::test]
fn ime_blocks_snapshot_until_commit_and_undo_reverts_whole_composition(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "Text\n");
    let field = view.update(cx, |s, _| s.input.as_ref().unwrap().clone());
    for preedit in ["n", "ni"] {
        field.update_in(cx, |i, w, cx| {
            i.replace_and_mark_text_in_range(None, preedit, None, w, cx)
        });
        cx.run_until_parked();
    }
    view.update_in(cx, |s, w, cx| {
        assert!(matches!(
            s.receive(&serde_json::json!({"kind":"snapshot","request":1}), w, cx)[0],
            ClientMessage::Deferred { .. }
        ));
    });
    field.update_in(cx, |i, w, cx| i.replace_text_in_range(None, "你", w, cx));
    cx.run_until_parked();
    command(&view, cx, "undo");
    view.update(cx, |s, _| {
        assert_eq!(s.session.as_ref().unwrap().text(), "Text\n")
    });
}
#[gpui::test]
fn table_structure_paste_and_task_checkbox_are_undoable(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "| A | B |\n| --- | --- |\n| x | y |\n\n- [ ] task\n");
    let before = view.update(cx, |s, _| s.session.as_ref().unwrap().text());
    command(&view, cx, "add-row");
    command(&view, cx, "add-column");
    view.update_in(cx, |s, w, cx| {
        let field = s.input.as_ref().unwrap().clone();
        s.input_event(field, &InputEvent::PasteTable("中\t🐶\nC\tD".into()), w, cx);
    });
    for _ in 0..3 {
        command(&view, cx, "undo");
    }
    view.update(cx, |s, _| {
        assert_eq!(s.session.as_ref().unwrap().text(), before)
    });
    view.update(cx, |s, _| {
        let session = s.session.as_mut().unwrap();
        let offset = Projection::new(&session.state.document).offset((1, 0));
        session.state.selection = Selection {
            anchor: offset,
            cursor: offset,
        };
    });
    command(&view, cx, "task");
    view.update(cx, |s, _| {
        assert!(s.session.as_ref().unwrap().text().contains("- [x] task"))
    });
}

#[gpui::test]
fn one_input_enters_joins_selects_and_undoes_across_paragraphs(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "# Hello\n\nWorld\n");
    let input = view.update_in(cx, |s, w, cx| {
        s.focus_document(w, cx);
        s.input.as_ref().unwrap().clone()
    });
    cx.simulate_keystrokes("right right right right right enter");
    cx.run_until_parked();
    assert_eq!(
        input.read_with(cx, |i, _| i.text().to_owned()),
        "Hello\n\nWorld"
    );
    cx.simulate_keystrokes("backspace");
    cx.run_until_parked();
    assert_eq!(
        input.read_with(cx, |i, _| i.text().to_owned()),
        "Hello\nWorld"
    );
    cx.simulate_keystrokes("shift-right shift-right shift-right");
    cx.run_until_parked();
    assert_eq!(input.read_with(cx, |i, _| i.snapshot().cursor), 8);
    cx.simulate_keystrokes("backspace");
    cx.run_until_parked();
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "Hellorld");
    cx.simulate_keystrokes("cmd-z");
    cx.run_until_parked();
    assert_eq!(
        input.read_with(cx, |i, _| i.text().to_owned()),
        "Hello\nWorld"
    );
    cx.simulate_keystrokes("cmd-a");
    cx.run_until_parked();
    let snapshot = input.read_with(cx, |i, _| i.snapshot());
    assert_eq!((snapshot.anchor, snapshot.cursor), (0, 11));
    input.update_in(cx, |i, w, cx| {
        i.replace_text_in_range(None, "全新文档🐶", w, cx)
    });
    cx.run_until_parked();
    assert_eq!(
        input.read_with(cx, |i, _| i.text().to_owned()),
        "全新文档🐶"
    );
    cx.simulate_keystrokes("cmd-z");
    cx.run_until_parked();
    assert_eq!(
        input.read_with(cx, |i, _| i.text().to_owned()),
        "Hello\nWorld"
    );
}
#[gpui::test]
fn typing_marks_and_shift_enter_work_without_separate_fields(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "");
    let input = view.update_in(cx, |s, w, cx| {
        s.focus_document(w, cx);
        s.input.as_ref().unwrap().clone()
    });
    cx.simulate_keystrokes("cmd-b");
    cx.run_until_parked();
    input.update_in(cx, |i, w, cx| i.replace_text_in_range(None, "Hello", w, cx));
    cx.run_until_parked();
    assert!(
        view.read_with(cx, |s, _| s.session.as_ref().unwrap().text())
            .contains("**Hello**")
    );
    cx.simulate_keystrokes("shift-enter");
    cx.run_until_parked();
    assert_eq!(
        view.read_with(cx, |s, _| s
            .session
            .as_ref()
            .unwrap()
            .state
            .document
            .blocks
            .len()),
        1
    );
}
