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

/// `uses Shift+Enter for a newline and plain Enter for one submission`.
#[gpui::test]
fn shift_enter_breaks_the_line_and_enter_sends_once(cx: &mut TestAppContext) {
    let (composer, log, cx) = setup(cx);
    cx.simulate_input("first");
    cx.simulate_keystrokes("shift-enter");
    cx.simulate_input("second");
    assert_eq!(text(&composer, cx), "first\nsecond");
    assert!(!log.borrow().iter().any(|l| l == "submit"));
    cx.simulate_keystrokes("enter");
    assert_eq!(log.borrow().iter().filter(|l| *l == "submit").count(), 1);
}

/// `keeps a useful placeholder when the caller supplies blank copy`;
/// `morphs the single send action into stop while a turn is running`.
#[gpui::test]
fn a_blank_placeholder_keeps_the_default_and_a_running_turn_offers_stop(cx: &mut TestAppContext) {
    crate::localization::set_current("en");
    let (composer, log, cx) = setup(cx);
    let show =
        |composer: &Entity<ComposerView>, cx: &mut VisualTestContext, input: ComposerInput| {
            composer.update_in(cx, |c, window, cx| c.set_input(input, window, cx));
            cx.update(|window, cx| window.draw(cx).clear(cx));
        };
    show(
        &composer,
        cx,
        ComposerInput {
            placeholder: "   ".into(),
            ..Default::default()
        },
    );
    let placeholder = composer.read_with(cx, |c, cx| c.input.read(cx).placeholder().to_owned());
    assert_eq!(
        placeholder,
        crate::localization::t("agent.composer.placeholder.default")
    );
    let action = cx
        .debug_bounds("agent-composer-action")
        .expect("one action");
    cx.simulate_click(action.center(), Modifiers::default());
    assert!(log.borrow().is_empty(), "nothing to send");
    show(
        &composer,
        cx,
        ComposerInput {
            draft: "Follow up".into(),
            running: true,
            ..Default::default()
        },
    );
    let action = cx
        .debug_bounds("agent-composer-action")
        .expect("one action");
    cx.simulate_click(action.center(), Modifiers::default());
    assert_eq!(log.borrow().last().map(String::as_str), Some("stop"));
}

/// `hides the configured Model in Minimal Mode without removing the
/// composer`; `keeps the session-level Agent in the header and only Model in
/// the composer`; `shows Agent in the header and withholds Model until a
/// connected runtime is selected`: the composer's only configuration is the
/// session's controls — a Model when the session has one, nothing (and still
/// the input and its action) when it has none.
#[gpui::test]
fn the_composer_offers_only_the_sessions_model_and_works_without_one(cx: &mut TestAppContext) {
    use crate::features::desktop_agent::domain::agent_session_controls::{
        AgentSessionControl, AgentSessionControlId, AgentSessionControlOption,
    };
    crate::localization::set_current("en");
    let (composer, log, cx) = setup(cx);
    let model = AgentSessionControl {
        id: AgentSessionControlId::Model,
        value: Some("gpt-5".into()),
        options: vec![AgentSessionControlOption {
            value: "gpt-5".into(),
            label: "GPT-5".into(),
            description: None,
            keywords: None,
        }],
    };
    composer.update_in(cx, |c, window, cx| {
        c.set_input(
            ComposerInput {
                draft: "Continue".into(),
                session_controls: vec![model],
                ..Default::default()
            },
            window,
            cx,
        )
    });
    cx.update(|window, cx| window.draw(cx).clear(cx));
    assert!(cx.debug_bounds("agent-picker-Model:GPT-5").is_some());
    assert!(cx.debug_bounds("agent-picker-Effort").is_none());
    assert!(cx.debug_bounds("agent-picker-Mode").is_none());

    composer.update_in(cx, |c, window, cx| {
        c.set_input(
            ComposerInput {
                draft: "Hello".into(),
                composer_disabled: true,
                ..Default::default()
            },
            window,
            cx,
        )
    });
    cx.update(|window, cx| window.draw(cx).clear(cx));
    assert!(cx.debug_bounds("agent-picker-Model").is_none());
    let action = cx
        .debug_bounds("agent-composer-action")
        .expect("the action stays");
    cx.simulate_click(action.center(), Modifiers::default());
    assert!(!log.borrow().iter().any(|l| l == "submit"), "blocked");
}
