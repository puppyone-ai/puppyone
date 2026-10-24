//! Markdown in a live `EditorView` (GPUI test platform): typing, reveal,
//! the composing block line, task toggling and history.
use super::{features::task, MarkdownExtension};
use crate::{
    editor::{
        text::selection::Selection,
        view::{EditorView, bind_keys, style},
    },
    typography::Scale,
};
use gpui::{Entity, TestAppContext, VisualTestContext};

fn setup<'a>(cx: &'a mut TestAppContext, text: &str) -> (Entity<EditorView>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let text = text.to_owned();
    let (view, cx) = cx.add_window_view(move |_, cx| EditorView::new(&text, Box::new(MarkdownExtension::new(true, Scale::Medium)), cx));
    view.update_in(cx, |v, w, cx| v.focus(w, cx));
    cx.run_until_parked();
    (view, cx)
}

fn hidden(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<std::ops::Range<usize>> {
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |v, _| v.decorations().hidden.clone())
}

#[gpui::test]
fn markers_hide_and_reveal_with_the_caret(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "# Title\n\nsome **bold** text");
    // Caret before "some": heading marker and both ** hidden.
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(9), cx));
    assert_eq!(hidden(&view, cx), vec![0..2, 14..16, 20..22]);
    // Inside **bold** (14..22): its markers show as source.
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(17), cx));
    let h = hidden(&view, cx);
    assert!(h.contains(&(0..2)) && !h.contains(&(14..16)), "{h:?}");
}

#[gpui::test]
fn typing_a_heading_prefix_keeps_the_line_as_source(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "");
    cx.simulate_input("## Ti");
    // The line being composed keeps its literal `##`.
    assert!(hidden(&view, cx).is_empty());
    view.update(cx, |v, _| assert_eq!(v.text(), "## Ti"));
    cx.simulate_keystrokes("enter");
    cx.simulate_input("x");
    assert!(hidden(&view, cx).contains(&(0..3)));
}

#[gpui::test]
fn lists_continue_and_tasks_toggle_with_history(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "- [ ] one");
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(9), cx));
    cx.simulate_keystrokes("enter");
    cx.simulate_input("two");
    view.update(cx, |v, _| assert_eq!(v.text(), "- [ ] one\n- [ ] two"));
    view.update_in(cx, |v, w, cx| v.run_command(&task::toggle_command(0), w, cx));
    view.update(cx, |v, _| assert_eq!(v.text(), "- [x] one\n- [ ] two"));
    cx.simulate_keystrokes("cmd-z");
    view.update(cx, |v, _| assert_eq!(v.text(), "- [ ] one\n- [ ] two"));
    cx.simulate_keystrokes("cmd-b");
    view.update(cx, |v, _| assert_eq!(v.text(), "- [ ] one\n- [ ] **two**"));
}
