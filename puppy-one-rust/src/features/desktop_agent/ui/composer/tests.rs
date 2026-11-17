use super::*;
use core::prelude::v1::test;
use gpui::{TestAppContext, VisualTestContext};
use std::cell::RefCell;
use std::rc::Rc;

type Log = Rc<RefCell<Vec<String>>>;

/// A composer as its container sees it: what it asks for, as text.
fn setup(cx: &mut TestAppContext) -> (Entity<ComposerView>, Log, &mut VisualTestContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::form_input::bind_keys(cx);
    });
    let (composer, cx) = cx.add_window_view(|window, cx| {
        let pickers = cx.new(|cx| SessionPickers::new(window, cx));
        ComposerView::new(pickers, window, cx)
    });
    let log: Log = Rc::default();
    composer.update_in(cx, |c, window, cx| {
        c.input.focus_handle(cx).focus(window, cx);
        let log = log.clone();
        cx.subscribe_in(
            &cx.entity(),
            window,
            move |_, _, event: &ComposerEvent, _, _| log.borrow_mut().push(describe(event)),
        )
        .detach();
    });
    cx.update(|window, cx| {
        window.draw(cx).clear(cx);
    });
    (composer, log, cx)
}

fn describe(event: &ComposerEvent) -> String {
    match event {
        ComposerEvent::DraftChanged {
            text,
            mentions,
            removed,
        } => format!(
            "draft {text:?} mentions {:?} removed {removed:?}",
            mentions.iter().map(|m| &m.reference_id).collect::<Vec<_>>()
        ),
        ComposerEvent::RemoveReference(id) => format!("remove {id}"),
        ComposerEvent::Submit => "submit".into(),
        ComposerEvent::Stop => "stop".into(),
        ComposerEvent::Paste(_) => "paste".into(),
        ComposerEvent::PickFiles => "pick files".into(),
        ComposerEvent::PickWorkspace => "pick workspace".into(),
        ComposerEvent::Command(name) => format!("command {name}"),
    }
}

fn text(composer: &Entity<ComposerView>, cx: &mut VisualTestContext) -> String {
    composer.read_with(cx, |c, cx| c.input.read(cx).text().to_owned())
}

#[gpui::test]
fn the_container_draft_shows_and_typing_reports_it(cx: &mut TestAppContext) {
    let (composer, log, cx) = setup(cx);
    composer.update_in(cx, |c, window, cx| {
        c.set_input(
            ComposerInput {
                draft: "hello".into(),
                ..Default::default()
            },
            window,
            cx,
        )
    });
    assert_eq!(text(&composer, cx), "hello");
    // Showing the container's own draft asks nothing of it.
    assert!(log.borrow().is_empty(), "{:?}", log.borrow());
    cx.simulate_input("!");
    assert_eq!(
        log.borrow().last().map(String::as_str),
        Some("draft \"hello!\" mentions [] removed []")
    );
}

#[gpui::test]
fn a_path_reference_becomes_a_mention_and_leaves_with_it(cx: &mut TestAppContext) {
    let (composer, log, cx) = setup(cx);
    let reference: DraftReference = serde_json::from_value(serde_json::json!({
        "id": "ref-file", "kind": "workspace-entry", "entryType": "file",
        "relativePath": "README.md", "displayName": "README.md", "status": "ready"
    }))
    .unwrap();
    composer.update_in(cx, |c, window, cx| {
        c.set_input(
            ComposerInput {
                references: vec![reference],
                ..Default::default()
            },
            window,
            cx,
        )
    });
    cx.run_until_parked();
    let inserted = log.borrow().last().cloned().unwrap_or_default();
    assert!(
        inserted.contains("mentions [\"ref-file\"]") && inserted.contains("removed []"),
        "{inserted}"
    );
    // Deleting the mention takes its reference with it.
    cx.simulate_keystrokes("cmd-a backspace");
    let removed = log.borrow().last().cloned().unwrap_or_default();
    assert!(removed.contains("removed [\"ref-file\"]"), "{removed}");
}

#[gpui::test]
fn enter_asks_to_send(cx: &mut TestAppContext) {
    let (_, log, cx) = setup(cx);
    cx.simulate_input("go");
    cx.simulate_keystrokes("enter");
    assert_eq!(log.borrow().last().map(String::as_str), Some("submit"));
}
