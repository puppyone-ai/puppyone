//! The native pane (GPUI test platform): what each editor contributes to the
//! pane menu, running its entries, and find routing.
use super::DocumentEditor;
use crate::{
    documents::ClientMessage,
    editor::{
        markdown::MarkdownExtension,
        view::style,
        workbench::{
            find::FindEvent,
            pane::{Action, ItemKind},
        },
    },
};
use gpui::{Entity, TestAppContext, VisualTestContext};
use std::{cell::RefCell, rc::Rc};

fn setup<'a>(cx: &'a mut TestAppContext, name: &str, text: &str) -> (Entity<DocumentEditor>, Rc<RefCell<Vec<ClientMessage>>>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        crate::editor::view::bind_keys(cx);
        crate::editor::csv::bind_keys(cx);
        super::bind_keys(cx);
        crate::ui::form_input::bind_keys(cx);
    });
    let (view, cx) = cx.add_window_view(|_, cx| DocumentEditor::new(cx));
    let messages = Rc::new(RefCell::new(Vec::new()));
    let sink = messages.clone();
    cx.update(|_, cx| cx.subscribe(&view, move |_, m: &ClientMessage, _| sink.borrow_mut().push(m.clone())).detach());
    let open = serde_json::json!({"kind": "open", "id": "doc-1", "name": name, "text": text});
    view.update_in(cx, |v, w, cx| {
        v.receive(&open, w, cx);
    });
    cx.run_until_parked();
    (view, messages, cx)
}

#[gpui::test]
fn csv_contributes_view_items_and_find(cx: &mut TestAppContext) {
    let (view, messages, cx) = setup(cx, "data/table.csv", "id,name\n1,anna\n2,bob\n");
    view.update_in(cx, |v, w, cx| {
        let c = v.contribution(cx);
        assert!(c.segmented.is_none() && c.find && c.open_external);
        assert_eq!(c.items.iter().map(|i| i.id).collect::<Vec<_>>(), vec!["csv-header-row", "csv-row-numbers", "csv-fit-columns-to-viewport", "csv-reset-column-widths"]);
        assert_eq!(c.items[1].kind, ItemKind::Toggle(true));
        // A toggle keeps the menu open and flips.
        v.toggle_pane_menu(w, cx);
        v.run_pane_action(Action::Item("csv-row-numbers"), w, cx);
        assert!(v.chrome.open);
        assert_eq!(v.contribution(cx).items[1].kind, ItemKind::Toggle(false));
        // Close is the shell's command and closes the menu.
        v.run_pane_action(Action::Close, w, cx);
        assert!(!v.chrome.open);
        assert_eq!(v.session.as_ref().map(|s| s.name.as_str()), Some("table.csv"));
    });
    assert!(messages.borrow().iter().any(|m| matches!(m, ClientMessage::Action { action } if action == "close-file")));
    // Find routes the query to the table and reports its result.
    view.update_in(cx, |v, w, cx| v.open_find(w, cx));
    let bar = view.update(cx, |v, cx| v.find_bar(cx)).expect("find bar open");
    bar.update(cx, |_, cx| cx.emit(FindEvent::Query("b".into())));
    cx.run_until_parked();
    bar.update(cx, |b, _| assert_eq!((b.current, b.total), (1, 1)));
    bar.update(cx, |_, cx| cx.emit(FindEvent::Close));
    cx.run_until_parked();
    assert!(view.update(cx, |v, cx| v.find_bar(cx)).is_none());
}

#[gpui::test]
fn markdown_contributes_its_mode_segments(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "notes.md", "# Title\n");
    view.update_in(cx, |v, w, cx| {
        let c = v.contribution(cx);
        assert_eq!(c.segmented.as_ref().map(|s| s.value), Some("live"));
        assert!(c.items.is_empty() && c.find);
        v.toggle_pane_menu(w, cx);
        v.run_pane_action(Action::Segment("source"), w, cx);
        // Segments keep the menu open.
        assert!(v.chrome.open);
        assert_eq!(v.contribution(cx).segmented.map(|s| s.value), Some("source"));
        let super::Surface::Text(editor) = v.editor.clone().unwrap() else { panic!() };
        assert!(!editor.read(cx).extension::<MarkdownExtension>().unwrap().live);
    });
}

#[gpui::test]
fn find_marks_and_selects_matches_in_text_editors(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "notes.md", "alpha beta\nAlpha gamma\nalphabet\n");
    view.update_in(cx, |v, w, cx| v.open_find(w, cx));
    let bar = view.update(cx, |v, cx| v.find_bar(cx)).expect("find bar open");
    bar.update(cx, |_, cx| cx.emit(FindEvent::Query("ALPHA".into())));
    cx.run_until_parked();
    bar.update(cx, |b, _| assert_eq!((b.current, b.total), (1, 3)));
    let editor = view.update(cx, |v, _| match v.editor.clone() {
        Some(super::Surface::Text(e)) => e,
        _ => panic!(),
    });
    editor.update(cx, |e, _| {
        assert_eq!(e.find_marks().matches, vec![0..5, 11..16, 23..28]);
        assert_eq!((e.state().selection.from(), e.state().selection.to()), (0, 5));
    });
    bar.update(cx, |_, cx| cx.emit(FindEvent::Move { forward: false }));
    cx.run_until_parked();
    bar.update(cx, |b, _| assert_eq!(b.current, 3));
    editor.update(cx, |e, _| assert_eq!(e.state().selection.from(), 23));
    bar.update(cx, |_, cx| cx.emit(FindEvent::Close));
    cx.run_until_parked();
    editor.update(cx, |e, _| assert!(e.find_marks().matches.is_empty()));
}
