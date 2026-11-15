//! History presentation contracts exercised through actual GPUI frames and input.
use super::*;
use crate::features::desktop_agent::fixtures::typed;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};

#[derive(Default)]
struct Source {
    state: RefCell<ConversationHistoryState>,
    activations: Cell<usize>,
    refreshes: Cell<usize>,
    more: Cell<usize>,
}
impl ConversationHistorySource for Source {
    fn snapshot(&self) -> ConversationHistoryState {
        self.state.borrow().clone()
    }
    fn activate(&self) {
        self.activations.set(self.activations.get() + 1);
    }
    fn refresh(&self) {
        self.refreshes.set(self.refreshes.get() + 1);
    }
    fn load_more(&self) {
        self.more.set(self.more.get() + 1);
    }
    fn watch(&self, _: crate::wake::Wake) -> Box<dyn FnOnce()> {
        Box::new(|| {})
    }
}
type Events = Rc<RefCell<Vec<Value>>>;

fn source() -> Rc<Source> {
    Rc::new(Source {
        state: RefCell::new(ConversationHistoryState {
            loaded: true,
            sources: vec![(
                "codex".into(),
                typed(json!({
                    "runtimeId": "codex", "status": "complete", "coverage": "complete",
                    "indexed": 0, "nextCursor": null, "scanId": null, "warnings": [],
                })),
            )],
            ..Default::default()
        }),
        ..Default::default()
    })
}
fn saved() -> SessionMetadata {
    typed(json!({
        "id": "saved", "runtimeId": "codex", "providerSessionId": "native",
        "title": "Saved design", "workspaceRoot": "/workspace", "terminalState": "idle",
        "createdAt": "2026-09-01T00:00:00Z", "updatedAt": "2026-09-01T00:00:00Z",
    }))
}
fn setup(
    cx: &mut TestAppContext,
    source: Rc<dyn ConversationHistorySource>,
    enabled: bool,
) -> (Entity<HistoryBrowser>, Events, &mut VisualTestContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::form_input::bind_keys(cx);
    });
    let (view, cx) =
        cx.add_window_view(|window, cx| HistoryBrowser::new(source, enabled, window, cx));
    let events: Events = Rc::default();
    let log = events.clone();
    view.update_in(cx, |_, window, cx| {
        cx.subscribe_in(
            &cx.entity(),
            window,
            move |_, _, event: &HistoryBrowserEvent, _, _| {
                log.borrow_mut().push(match event {
                    HistoryBrowserEvent::Allow => json!({"type": "allow"}),
                    HistoryBrowserEvent::Back => json!({"type": "back"}),
                    HistoryBrowserEvent::Open(target) => json!({"type": "open", "id": target.id,
                    "title": target.title, "runtimeId": target.payload.runtime_id,
                    "sessionId": target.payload.session_id}),
                });
            },
        )
        .detach();
    });
    draw(cx);
    (view, events, cx)
}
fn draw(cx: &mut VisualTestContext) {
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
}
fn click(cx: &mut VisualTestContext, selector: &'static str) {
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("missing {selector}"));
    assert!(bounds.size.width > px(0.) && bounds.size.height > px(0.));
    cx.simulate_click(bounds.center(), Modifiers::none());
    draw(cx);
}

#[gpui::test]
fn empty_history_messages_follow_source_evidence_in_rendered_frames(cx: &mut TestAppContext) {
    let source = source();
    let baseline = source.snapshot();
    let (view, _, cx) = setup(cx, source.clone(), true);
    for (case, expected) in [
        ("complete", "history-message:No chat history"),
        (
            "no-sources",
            "history-message:No restorable chats found in this project yet",
        ),
        (
            "unknown",
            "history-message:No restorable chats found in this project yet",
        ),
        (
            "absent-coverage",
            "history-message:No restorable chats found in this project yet",
        ),
        (
            "unsupported",
            "history-message:No restorable chats found in this project yet",
        ),
        (
            "partial",
            "history-message:No restorable chats found in this project yet",
        ),
        (
            "truncated",
            "history-message:No restorable chats found in this project yet",
        ),
        (
            "more",
            "history-message:No restorable chats found in this project yet",
        ),
        (
            "already-open",
            "history-message:Discovered chats are already open",
        ),
        (
            "already-open-unknown",
            "history-message:Discovered chats are already open",
        ),
        (
            "error",
            "history-message:Some chat history could not be refreshed.",
        ),
        (
            "failed",
            "history-message:Some chat history could not be refreshed.",
        ),
        ("loading", "history-message:Loading chat history"),
    ] {
        let mut state = baseline.clone();
        let mut excluded = vec![];
        match case {
            "no-sources" => state.sources.clear(),
            "unknown" => state.sources[0].1.coverage = Some("unknown".into()),
            "absent-coverage" => state.sources[0].1.coverage = None,
            "unsupported" | "partial" | "failed" => state.sources[0].1.status = case.into(),
            "truncated" => {
                state.catalog_coverage = Some(typed(
                    json!({"truncated": true, "capacity": 500, "retained": 500}),
                ))
            }
            "more" => state.catalog_next_cursor = Some("next".into()),
            "already-open" | "already-open-unknown" => {
                state.sessions.push(saved());
                excluded.push("saved".into());
                if case.ends_with("unknown") {
                    state.sources[0].1.coverage = Some("unknown".into());
                }
            }
            "error" => state.error = Some("timeout".into()),
            "loading" => state.loading = true,
            _ => {}
        }
        *source.state.borrow_mut() = state;
        view.update(cx, |view, cx| {
            view.set_excluded(excluded, cx);
            cx.notify();
        });
        draw(cx);
        assert!(
            cx.debug_bounds(expected).is_some(),
            "wrong rendered empty message for {case}"
        );
        assert!(cx.debug_bounds("history-option:saved").is_none());
    }
}

#[gpui::test]
fn permission_precedes_discovery_and_native_clicks_return_only_an_opaque_target(
    cx: &mut TestAppContext,
) {
    let source = source();
    source.state.borrow_mut().sessions = vec![saved()];
    let (view, events, cx) = setup(cx, source.clone(), false);
    assert_eq!(source.activations.get(), 0);
    assert_eq!(source.refreshes.get(), 0);
    assert_eq!(source.more.get(), 0);
    assert!(cx.debug_bounds("history-option:saved").is_none());
    click(cx, "history-permission-allow");
    assert_eq!(*events.borrow(), vec![json!({"type": "allow"})]);
    assert_eq!(
        source.activations.get(),
        0,
        "permission must be persisted by the owner first"
    );
    view.update(cx, |view, cx| {
        view.enable(cx);
        view.enable(cx);
    });
    draw(cx);
    assert_eq!(source.activations.get(), 1);
    click(cx, "history-option:saved");
    assert_eq!(
        events.borrow().last().unwrap(),
        &json!({
            "type": "open", "id": "saved", "title": "Saved design", "runtimeId": "codex", "sessionId": "saved",
        })
    );
    click(cx, "history-option:saved");
    assert_eq!(
        events.borrow().len(),
        2,
        "opening suppresses a duplicate click"
    );
    click(cx, "history-back");
    assert_eq!(
        events.borrow().last().unwrap(),
        &json!({"type": "back"}),
        "Back remains available while a saved conversation opens"
    );
}

#[gpui::test]
fn search_escape_refresh_and_pagination_use_the_visible_history_owner(cx: &mut TestAppContext) {
    let source = source();
    source.state.borrow_mut().sessions = vec![saved()];
    let (view, events, cx) = setup(cx, source.clone(), true);
    assert!(cx.debug_bounds("history-search").is_none());
    click(cx, "history-search-open");
    assert!(cx.debug_bounds("history-search").is_some());
    assert!(view.read_with(cx, |view, cx| view.search.read(cx).text().is_empty()));
    cx.simulate_input("missing");
    draw(cx);
    assert!(
        cx.debug_bounds("history-message:No matching chats")
            .is_some()
    );
    assert!(cx.debug_bounds("history-option:saved").is_none());
    cx.simulate_keystrokes("escape");
    draw(cx);
    assert!(cx.debug_bounds("history-search").is_none());
    assert!(cx.debug_bounds("history-option:saved").is_some());
    assert!(events.borrow().is_empty());
    source.state.borrow_mut().refreshing = true;
    source.state.borrow_mut().error = Some("source unavailable".into());
    view.update(cx, |_, cx| cx.notify());
    draw(cx);
    click(cx, "history-refresh");
    assert_eq!(source.refreshes.get(), 0);
    assert!(cx.debug_bounds("history-option:saved").is_some());
    source.state.borrow_mut().refreshing = false;
    source.state.borrow_mut().catalog_next_cursor = Some("page-2".into());
    view.update(cx, |_, cx| cx.notify());
    draw(cx);
    click(cx, "history-refresh");
    assert_eq!(source.refreshes.get(), 1);
    click(cx, "history-more");
    assert_eq!(source.more.get(), 1);
    view.update_in(cx, |view, window, cx| view.focus.focus(window, cx));
    cx.simulate_keystrokes("escape");
    assert_eq!(*events.borrow(), vec![json!({"type": "back"})]);
    source.state.borrow_mut().refreshing = true;
    view.update(cx, |_, cx| cx.notify());
    draw(cx);
    click(cx, "history-option:saved");
    assert_eq!(events.borrow().last().unwrap()["type"], "open");
    assert_eq!(events.borrow().last().unwrap()["sessionId"], "saved");
}

#[gpui::test]
fn capability_limits_expand_as_neutral_details_and_clear_after_recovery(cx: &mut TestAppContext) {
    let source = source();
    source.state.borrow_mut().sources[0].1.coverage = Some("unknown".into());
    let (view, _, cx) = setup(cx, source.clone(), true);
    const NOTE: &str =
        "history-source-note:codex: This Agent cannot confirm that its history list is complete.";
    assert!(
        cx.debug_bounds("history-summary:History lookup is limited")
            .is_some()
    );
    assert!(cx.debug_bounds(NOTE).is_none());
    assert!(!view.read_with(cx, |view, _| view.details_open));
    assert!(cx.debug_bounds("history-warning").is_none());
    click(cx, "history-source-summary");
    assert!(cx.debug_bounds(NOTE).is_some());
    assert!(cx.debug_bounds("history-warning").is_none());
    click(cx, "history-source-summary");
    assert!(cx.debug_bounds(NOTE).is_none());
    source.state.borrow_mut().sources[0].1.coverage = Some("complete".into());
    view.update(cx, |_, cx| cx.notify());
    draw(cx);
    assert!(cx.debug_bounds("history-source-summary").is_none());
    assert!(cx.debug_bounds("history-message:No chat history").is_some());
}

struct HistoryPair {
    first: Entity<HistoryBrowser>,
    second: Entity<HistoryBrowser>,
}
impl Render for HistoryPair {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .child(div().flex_1().h_full().child(self.first.clone()))
            .child(div().flex_1().h_full().child(self.second.clone()))
    }
}

#[gpui::test]
fn escape_only_reaches_the_history_browser_containing_keyboard_focus(cx: &mut TestAppContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::form_input::bind_keys(cx);
    });
    let (pair, cx) = cx.add_window_view(|window, cx| HistoryPair {
        first: cx.new(|cx| HistoryBrowser::new(source(), true, window, cx)),
        second: cx.new(|cx| HistoryBrowser::new(source(), true, window, cx)),
    });
    let (first, second) = pair.read_with(cx, |pair, _| (pair.first.clone(), pair.second.clone()));
    let backs = Rc::new(RefCell::new([0_usize; 2]));
    for (index, browser) in [first.clone(), second.clone()].iter().enumerate() {
        let backs = backs.clone();
        pair.update_in(cx, |_, window, cx| {
            cx.subscribe_in(browser, window, move |_, _, event, _, _| {
                if matches!(event, HistoryBrowserEvent::Back) {
                    backs.borrow_mut()[index] += 1;
                }
            })
            .detach();
        });
        browser.update_in(cx, |view, window, cx| {
            view.search_open = true;
            view.search.read(cx).focus_handle(cx).focus(window, cx);
            cx.notify();
        });
    }
    draw(cx);
    cx.simulate_input("second query");
    cx.simulate_keystrokes("escape");
    draw(cx);
    assert!(first.read_with(cx, |view, _| view.search_open));
    assert!(!second.read_with(cx, |view, _| view.search_open));
    assert!(second.read_with(cx, |view, cx| view.search.read(cx).text().is_empty()));
    assert_eq!(*backs.borrow(), [0, 0]);
    cx.simulate_keystrokes("escape");
    assert_eq!(*backs.borrow(), [0, 1]);
    first.update_in(cx, |view, window, cx| {
        view.search.read(cx).focus_handle(cx).focus(window, cx)
    });
    cx.simulate_keystrokes("escape");
    draw(cx);
    assert!(!first.read_with(cx, |view, _| view.search_open));
    assert_eq!(*backs.borrow(), [0, 1]);
    cx.simulate_keystrokes("escape");
    assert_eq!(*backs.borrow(), [1, 1]);
}

mod integration;
