use super::*;
use core::prelude::v1::test;
use std::cell::Cell;
use std::rc::Rc;

fn setup(
    cx: &mut TestAppContext,
    multiline: bool,
    limit: usize,
) -> (Entity<TextInput>, &mut VisualTestContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        bind_keys(cx);
    });
    let (input, cx) = cx.add_window_view(move |w, cx| {
        let input = TextInput::new("Write…", multiline, limit, w, cx);
        input.focus_handle(cx).focus(w, cx);
        input
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    (input, cx)
}

#[gpui::test]
fn kit_textarea_caps_paste_before_recording_undo(cx: &mut TestAppContext) {
    let (input, cx) = setup(cx, true, 4);
    cx.simulate_input("中");
    cx.update(|_, cx| cx.write_to_clipboard(ClipboardItem::new_string("🐶abc".into())));
    cx.simulate_keystrokes("cmd-v");
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "中🐶ab");
    cx.simulate_keystrokes("cmd-z");
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "中");
    cx.simulate_keystrokes("cmd-shift-z");
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "中🐶ab");
    cx.simulate_keystrokes("enter");
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "中🐶ab");
    // The replacement range is UTF-16, while Kit's document uses UTF-8.
    input.update_in(cx, |i, w, cx| {
        i.replace_text_in_range(Some(1..3), "猫", w, cx)
    });
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "中猫ab");
}

#[gpui::test]
fn kit_ime_commit_undo_and_unmark_share_the_same_state(cx: &mut TestAppContext) {
    let (input, cx) = setup(cx, true, 100);
    input.update_in(cx, |i, w, cx| {
        i.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx);
        assert!(i.composing(w, cx));
        i.replace_and_mark_text_in_range(None, "你", Some(1..1), w, cx);
        i.replace_text_in_range(None, "你好🐶", w, cx);
        assert!(!i.composing(w, cx));
    });
    cx.simulate_keystrokes("cmd-z");
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "");
    cx.simulate_keystrokes("cmd-shift-z");
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "你好🐶");
    input.update_in(cx, |i, w, cx| {
        i.replace_and_mark_text_in_range(None, "文", None, w, cx);
        i.unmark_text(w, cx);
        assert!(
            !i.composing(w, cx),
            "unmark need not emit a Kit Change event"
        );
    });
}

#[gpui::test]
fn kit_composer_submit_does_not_insert_a_newline(cx: &mut TestAppContext) {
    let (input, cx) = setup(cx, true, 100);
    let count = Rc::new(Cell::new(0));
    input.update_in(cx, |_, w, cx| {
        let count = count.clone();
        cx.subscribe_in(&cx.entity(), w, move |_, _, e: &InputEvent, _, _| {
            if matches!(e, InputEvent::Submit) {
                count.set(count.get() + 1);
            }
        })
        .detach();
    });
    cx.simulate_input("prompt");
    cx.simulate_keystrokes("cmd-enter");
    assert_eq!(count.get(), 1);
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "prompt");
    cx.simulate_keystrokes("shift-enter");
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "prompt\n");
    input.update_in(cx, |i, w, cx| {
        i.replace_and_mark_text_in_range(None, "ni", None, w, cx)
    });
    cx.simulate_keystrokes("cmd-enter");
    assert_eq!(count.get(), 1, "preedit must not submit an agent request");
}

#[gpui::test]
fn function_key_text_from_an_input_method_is_not_field_text(cx: &mut TestAppContext) {
    let (input, cx) = setup(cx, false, 100);
    cx.simulate_input("ab");
    // Sogou Pinyin's ← as text: dropped, the key replayed (caret moves).
    input.update_in(cx, |i, w, cx| {
        i.replace_text_in_range(None, "\u{F702}", w, cx)
    });
    cx.run_until_parked();
    cx.simulate_input("x");
    assert_eq!(input.read_with(cx, |i, _| i.text().to_owned()), "axb");
}

#[gpui::test]
fn mentions_insert_at_the_caret_as_atomic_tokens(cx: &mut TestAppContext) {
    let (input, cx) = setup(cx, true, 1000);
    let draw = |cx: &mut VisualTestContext| {
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        })
    };
    // The caret sits after "fix " with text following.
    input.update(cx, |i, cx| {
        i.restore(
            crate::ui::input::InputSnapshot {
                text: "fix please".into(),
                marks: vec![],
                anchor: 4,
                cursor: 4,
            },
            cx,
        )
    });
    draw(cx);
    input.update_in(cx, |i, w, cx| {
        assert!(i.insert_tokens(
            &[
                ("r1".into(), "@a.md".into()),
                ("r2".into(), "@docs/b.md".into())
            ],
            w,
            cx
        ));
    });
    draw(cx);
    input.read_with(cx, |i, cx| {
        // No space before (whitespace precedes), one between, one after.
        assert_eq!(i.text(), "fix @a.md @docs/b.md please");
        assert_eq!(i.token_ids(cx), ["r1", "r2"]);
    });
    // After a word, the mention is separated from it; at the end nothing
    // follows.
    cx.simulate_keystrokes("cmd-down");
    cx.simulate_input("x");
    input.update_in(cx, |i, w, cx| {
        assert!(i.insert_tokens(&[("r3".into(), "@c.md".into())], w, cx));
    });
    draw(cx);
    input.read_with(cx, |i, cx| {
        assert_eq!(i.text(), "fix @a.md @docs/b.md pleasex @c.md");
        assert_eq!(i.token_ids(cx), ["r1", "r2", "r3"]);
    });
    // A mention deletes as one unit.
    cx.simulate_keystrokes("backspace");
    draw(cx);
    input.read_with(cx, |i, cx| {
        assert_eq!(i.text(), "fix @a.md @docs/b.md pleasex ");
        assert_eq!(i.token_ids(cx), ["r1", "r2"]);
    });
    // A restored draft brings its tokens back.
    let content = InputContent::new("see @a.md")
        .with_token(4..9, InlineToken::new("r1", "@a.md"))
        .unwrap();
    input.update(cx, |i, cx| i.restore_content(content, cx));
    draw(cx);
    input.read_with(cx, |i, cx| {
        assert_eq!(i.text(), "see @a.md");
        assert_eq!(i.token_ids(cx), ["r1"]);
    });
}
