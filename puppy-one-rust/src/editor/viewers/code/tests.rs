use super::{
    CodeSurface, CodeView, FindEvent, Language, Scale, SurfaceEvent, SurfaceInput, SurfaceRequest,
    ViewerSurface,
};
use crate::editor::{
    registry::{self, EditorDocument},
    view::style,
};
use gpui::{Entity, EntityInputHandler, Focusable, TestAppContext, VisualTestContext};
use std::{cell::RefCell, rc::Rc};

fn setup<'a>(
    cx: &'a mut TestAppContext,
    name: &str,
    text: &str,
) -> (
    Entity<CodeView>,
    Rc<RefCell<Vec<SurfaceEvent>>>,
    &'a mut VisualTestContext,
) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::ime::init(cx);
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
    });
    let resolved = registry::resolve(&EditorDocument::local(name));
    let (view, cx) = cx.add_window_view(|w, cx| {
        CodeView::new(
            &SurfaceRequest {
                id: "code",
                name,
                input: SurfaceInput::Text(text),
                format: resolved.format,
                resolved_extension: None,
                dark: true,
                scale: Scale::Medium,
            },
            w,
            cx,
        )
    });
    let events: Rc<RefCell<Vec<SurfaceEvent>>> = Rc::default();
    let sink = events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, e: &SurfaceEvent, _| {
            sink.borrow_mut().push(e.clone())
        })
        .detach()
    });
    view.update_in(cx, |v, w, cx| v.field.focus_handle(cx).focus(w, cx));
    draw(cx);
    (view, events, cx)
}
fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}
fn text(view: &Entity<CodeView>, cx: &mut VisualTestContext) -> String {
    view.update(cx, |v, _| v.committed.clone())
}

#[gpui::test]
fn code_ime_is_provisional_until_commit_or_cancel(cx: &mut TestAppContext) {
    let (view, events, cx) = setup(cx, "value.json", "🐶");
    view.update_in(cx, |v, w, cx| {
        v.set_selected_text_range(2..2, w, cx);
        v.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx);
        assert_eq!(v.marked_text_range(w, cx), Some(2..4));
        assert!(v.composing);
        assert_eq!(v.committed, "🐶");
    });
    draw(cx);
    assert!(events.borrow().is_empty());
    view.update_in(cx, |v, w, cx| v.replace_text_in_range(None, "你", w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "🐶你");
    assert_eq!(events.borrow().len(), 1);
    view.update_in(cx, |v, w, cx| {
        v.replace_and_mark_text_in_range(None, "hao", Some(3..3), w, cx)
    });
    draw(cx);
    view.update_in(cx, |v, w, cx| {
        v.replace_and_mark_text_in_range(None, "", Some(0..0), w, cx)
    });
    draw(cx);
    assert_eq!(text(&view, cx), "🐶你");
    assert_eq!(
        events.borrow().len(),
        2,
        "cancel wakes pending snapshot even without a text change"
    );
}

#[gpui::test]
fn code_unmark_preserves_single_undo_transaction(cx: &mut TestAppContext) {
    let (view, events, cx) = setup(cx, "value.json", "");
    view.update_in(cx, |v, w, cx| {
        v.replace_and_mark_text_in_range(None, "n", Some(1..1), w, cx);
        v.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx);
        v.unmark_text(w, cx);
    });
    draw(cx);
    assert_eq!(text(&view, cx), "ni");
    assert_eq!(events.borrow().len(), 1);
    view.update_in(cx, |v, w, cx| v.history(false, w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "");
    view.update_in(cx, |v, w, cx| v.history(true, w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "ni");
}

#[gpui::test]
fn code_external_reload_abandons_preedit_and_readonly_blocks_input(cx: &mut TestAppContext) {
    let (view, events, cx) = setup(cx, "value.json", "");
    view.update_in(cx, |v, w, cx| {
        v.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx);
        v.replace("{\"remote\":true}", w, cx);
    });
    draw(cx);
    assert!(events.borrow().is_empty());
    let surface = CodeSurface { view: view.clone() };
    cx.update(|w, cx| surface.apply(true, false, Scale::Large, w, cx));
    view.update_in(cx, |v, w, cx| {
        assert!(!v.composing);
        v.replace_text_in_range(None, "lost", w, cx);
        v.replace_and_mark_text_in_range(None, "lost", Some(4..4), w, cx);
    });
    draw(cx);
    assert_eq!(text(&view, cx), "{\"remote\":true}");
    assert!(events.borrow().is_empty());
}

#[gpui::test]
fn code_language_rebind_keeps_entity_selection_and_history(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "main.ts", "");
    let id = view.update(cx, |v, _| v.field.entity_id());
    view.update_in(cx, |v, w, cx| {
        v.replace_text_in_range(None, "const answer = 42;", w, cx);
        v.rebind("main.py", cx);
        assert_eq!(v.field.entity_id(), id);
        assert_eq!(v.language, Language("python"));
        assert_eq!(v.selected_text_range(false, w, cx).unwrap().range, 18..18);
    });
    draw(cx);
    view.update_in(cx, |v, w, cx| v.history(false, w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "");
    view.update_in(cx, |v, w, cx| v.history(true, w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "const answer = 42;");
}

#[gpui::test]
fn code_platform_typing_autocloses_and_indents_json(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "value.json", "");
    cx.simulate_keystrokes("{");
    draw(cx);
    assert_eq!(text(&view, cx), "{}");
    cx.simulate_keystrokes("enter");
    draw(cx);
    assert_eq!(text(&view, cx), "{\n  \n}");
    view.update_in(cx, |v, w, cx| {
        assert_eq!(v.selected_text_range(false, w, cx).unwrap().range, 4..4);
    });
}

#[gpui::test]
fn code_multicursor_edits_are_one_undo_transaction(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "main.ts", "one\ntwo");
    view.update_in(cx, |v, w, cx| {
        v.field.update(cx, |s, cx| {
            s.set_selected_range(3..3, cx);
            s.add_selection(7..7, cx);
        });
        v.replace_text_in_range(None, "!", w, cx);
    });
    draw(cx);
    assert_eq!(text(&view, cx), "one!\ntwo!");
    view.update_in(cx, |v, w, cx| v.history(false, w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "one\ntwo");
}

#[gpui::test]
fn code_find_wraps_without_changing_the_document(cx: &mut TestAppContext) {
    let (view, events, cx) = setup(cx, "main.ts", "alpha beta\nAlpha gamma\nalphabet\n");
    view.update_in(cx, |v, w, cx| {
        assert_eq!(
            v.find(FindEvent::Query("ALPHA".into()), w, cx),
            Some((1, 3))
        );
        assert_eq!(
            v.find(FindEvent::Move { forward: false }, w, cx),
            Some((3, 3))
        );
        assert_eq!(v.field.read(cx).selected_range(), 23..28);
        assert_eq!(
            v.find(FindEvent::Move { forward: true }, w, cx),
            Some((1, 3))
        );
        assert_eq!(v.find(FindEvent::Close, w, cx), None);
        assert!(!v.find.active());
    });
    draw(cx);
    assert!(!events.borrow().contains(&SurfaceEvent::Changed));
}

#[gpui::test]
fn code_find_starts_at_selection_and_updates_after_edits(cx: &mut TestAppContext) {
    let (view, events, cx) = setup(cx, "main.ts", "Café\nCAFE\u{301}\nCafé");
    view.update_in(cx, |v, w, cx| {
        v.set_selected_text_range(5..5, w, cx);
        assert_eq!(v.find(FindEvent::Query("CAFÉ".into()), w, cx), Some((2, 3)));
        assert_eq!(v.field.read(cx).selected_range(), 6..12);
        v.replace_text_in_range(None, "gone", w, cx);
    });
    draw(cx);
    assert!(events.borrow().contains(&SurfaceEvent::FindResult {
        current: 2,
        total: 2
    }));
}

#[gpui::test]
fn conflict_banner_resolves_blocks_as_an_undoable_local_edit(cx: &mut TestAppContext) {
    use super::conflicts;
    let text = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\nb";
    let (view, events, cx) = setup(cx, "notes.txt", text);
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.read_with(cx, |v, _| {
        assert_eq!(conflicts::parse(&v.committed).len(), 1)
    });
    view.update_in(cx, |v, w, cx| {
        let resolved = conflicts::resolve_all(&v.committed, conflicts::Side::Theirs);
        v.resolve_conflicts(resolved, w, cx);
    });
    view.read_with(cx, |v, _| assert_eq!(v.committed, "a\ntheirs\nb"));
    assert!(events.borrow().contains(&SurfaceEvent::Changed));
    // Undo restores the markers.
    view.update_in(cx, |v, w, cx| v.history(false, w, cx));
    view.read_with(cx, |v, _| assert_eq!(v.committed, text));
}
