//! TS history-status acceptance through the real virtualized transcript.
use super::*;
use crate::agent::contract::{display_state::create_empty_agent_display, dto::AgentProjection};
use crate::agent::domain::agent_session_actor::{ActorOptions, SessionActor};
use core::prelude::v1::test;
use gpui::*;
use serde_json::json;

fn draw(cx: &mut VisualTestContext) {
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
}

fn show(view: &Entity<TranscriptView>, projection: AgentProjection, cx: &mut VisualTestContext) {
    view.update(cx, |view, cx| {
        view.set_input(
            TranscriptInput {
                projection,
                ..Default::default()
            },
            cx,
        )
    });
    draw(cx);
}

#[gpui::test]
fn local_replay_gaps_do_not_render_a_native_history_warning(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    let mut display = create_empty_agent_display();
    display.set("missingRanges", json!([{ "from": 1, "to": 42 }]));
    show(&view, AgentProjection::project(&display, None).unwrap(), cx);
    assert!(cx.debug_bounds("agent-history-notice").is_none());
}

#[gpui::test]
fn unknown_native_history_is_disclosed_even_without_message_rows_and_clears_on_recovery(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    let actor = SessionActor::new(ActorOptions {
        sequence: 42,
        ..Default::default()
    })
    .unwrap();
    actor.dispatch(json!({ "type": "history.loaded", "coverage": "unknown", "reason": "replay-unverified" })).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    show(
        &view,
        AgentProjection::project(&actor.snapshot().display, None).unwrap(),
        cx,
    );
    assert!(
        cx.debug_bounds("agent-history-summary:Some history messages may not be shown.")
            .is_some()
    );
    assert!(!view.read_with(cx, |view, _| view.history_notice_open));
    let bounds = cx
        .debug_bounds("agent-history-notice")
        .expect("a recoverable native history gap must be visible");
    cx.simulate_click(bounds.center(), Modifiers::none());
    draw(cx);
    assert!(view.read_with(cx, |view, _| view.history_notice_open));
    assert!(cx.debug_bounds("agent-history-reason:This Agent does not confirm whether it has returned every message.").is_some());
    actor
        .dispatch(json!({ "type": "history.loaded", "coverage": "complete" }))
        .unwrap();
    show(
        &view,
        AgentProjection::project(&actor.snapshot().display, None).unwrap(),
        cx,
    );
    assert!(cx.debug_bounds("agent-history-notice").is_none());
}

#[gpui::test]
fn partial_native_history_and_display_truncation_have_distinct_visible_explanations(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    for (coverage, truncated, summary) in [
        (
            "partial",
            false,
            "agent-history-summary:Only part of this conversation is shown.",
        ),
        (
            "complete",
            true,
            "agent-history-summary:Showing recent messages.",
        ),
    ] {
        let mut display = create_empty_agent_display();
        display.set(
            "history",
            json!({"coverage": coverage, "reason": "read-limit"}),
        );
        display.set("displayWindow", json!({"truncated": truncated}));
        show(&view, AgentProjection::project(&display, None).unwrap(), cx);
        assert!(
            cx.debug_bounds(summary).is_some(),
            "{coverage}, truncated={truncated}"
        );
    }
}

#[gpui::test]
fn changing_native_coverage_remeasures_the_existing_first_message_row(cx: &mut TestAppContext) {
    use crate::agent::domain::agent_session_actor::EventInput;
    cx.update(gpui_kit::init);
    let actor = SessionActor::new(ActorOptions::default()).unwrap();
    actor.append_event(EventInput {
        session_id: "saved".into(), runtime_id: "codex".into(), provider_session_id: Some("native".into()),
        event: json!({"type": "assistant.completed", "turnId": "turn", "itemId": "answer", "payload": {"text": "Recovered answer"}}),
    }).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    actor
        .dispatch(json!({"type": "history.loaded", "coverage": "partial", "reason": "read-limit"}))
        .unwrap();
    show(
        &view,
        AgentProjection::project(&actor.snapshot().display, None).unwrap(),
        cx,
    );
    let original = view.read_with(cx, |view, _| view.row_signatures[0].clone());
    actor
        .dispatch(json!({"type": "history.loaded", "coverage": "unknown", "reason": "unverified"}))
        .unwrap();
    show(
        &view,
        AgentProjection::project(&actor.snapshot().display, None).unwrap(),
        cx,
    );
    let current = view.read_with(cx, |view, _| view.row_signatures[0].clone());
    assert_eq!(current.0, original.0, "the message identity remains stable");
    assert_ne!(
        current.1, original.1,
        "changed notice text must invalidate the virtual row's cached measurement"
    );
    assert!(
        cx.debug_bounds("agent-history-summary:Some history messages may not be shown.")
            .is_some()
    );
    assert!(
        cx.debug_bounds("agent-history-summary:Only part of this conversation is shown.")
            .is_none()
    );
}
