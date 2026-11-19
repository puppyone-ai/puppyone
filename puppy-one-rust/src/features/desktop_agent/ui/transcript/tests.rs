//! TS history-status acceptance through the real virtualized transcript.
use super::*;
use crate::agent::contract::{display_state::create_empty_agent_display, dto::AgentProjection};
use crate::agent::domain::agent_session_actor::{ActorOptions, SessionActor};
use core::prelude::v1::test;
use gpui::*;
use serde_json::json;

fn draw(cx: &mut VisualTestContext) {
    cx.update(|window, cx| {
        window.draw(cx).clear(cx);
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

// `run-status.test.ts` and `reasoning.test.ts`: the live tail's one status.

fn projected(events: Vec<serde_json::Value>) -> AgentProjection {
    use crate::agent::agent_events::{EnvelopeInput, create_agent_event_envelope};
    use crate::agent::domain::transcript::display_projection::ProjectionOptions;
    use crate::agent::domain::transcript::transcript_reducer::{
        apply_agent_events, create_agent_projection,
    };
    let envelopes: Vec<_> = events
        .into_iter()
        .enumerate()
        .map(|(index, event)| {
            create_agent_event_envelope(EnvelopeInput {
                sequence: index as i64 + 1,
                session_id: "session".into(),
                runtime_id: "agent".into(),
                event_type: event["type"].as_str().unwrap().into(),
                payload: event["payload"].clone(),
                item_id: event["itemId"].as_str().map(str::to_owned),
                turn_id: event["turnId"].as_str().map(str::to_owned),
                emitted_at: event["at"].as_i64().map(|ms| {
                    chrono::DateTime::from_timestamp_millis(ms)
                        .unwrap()
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                }),
                ..Default::default()
            })
            .unwrap()
        })
        .collect();
    let display = apply_agent_events(
        &create_agent_projection(),
        &envelopes,
        ProjectionOptions::default(),
    );
    AgentProjection::project(&display, None).unwrap()
}

fn tail(projection: AgentProjection, working: bool) -> super::live_tail::LiveTail {
    super::live_tail::live_tail(&TranscriptInput {
        projection,
        working,
        runtime_label: "Codex".into(),
        ..Default::default()
    })
}

fn label(tail: &super::live_tail::LiveTail) -> Option<String> {
    tail.working
        .as_ref()
        .map(|(label, _)| label.replace(['\u{2068}', '\u{2069}'], ""))
}

/// `distinguishes native session preparation from genuine Thinking and then
/// yields to streaming text`.
#[test]
fn the_live_tail_says_preparing_then_thinking_and_yields_to_streaming_text() {
    use super::live_tail::{RunStatus, agent_run_status_code, agent_submission_status_label};
    use crate::features::desktop_agent::application::agent_controller_state::AgentSubmissionStage;
    crate::localization::set_current("en");
    let idle = projected(vec![]);
    assert_eq!(agent_run_status_code(&idle, true), None);
    let preparing =
        agent_submission_status_label(Some(AgentSubmissionStage::PreparingSession), "Codex")
            .unwrap()
            .replace(['\u{2068}', '\u{2069}'], "");
    assert_eq!(preparing, "Preparing Codex");
    assert_eq!(
        agent_submission_status_label(Some(AgentSubmissionStage::StartingTurn), "Codex").as_deref(),
        Some("Starting turn")
    );
    let running = projected(vec![
        json!({"type": "turn.started", "turnId": "turn-live", "payload": {"prompt": "Hi"}}),
    ]);
    assert_eq!(
        agent_run_status_code(&running, true),
        Some(RunStatus::Thinking)
    );
    assert_eq!(agent_run_status_code(&running, false), None);
    let streaming = projected(vec![
        json!({"type": "turn.started", "turnId": "turn-live", "payload": {"prompt": "Hi"}}),
        json!({"type": "assistant.delta", "turnId": "turn-live", "itemId": "message-live", "payload": {"delta": "Streaming now"}}),
    ]);
    assert_eq!(agent_run_status_code(&streaming, true), None);
    assert_eq!(label(&tail(streaming, true)), None);
}

/// `uses one quiet live-tail indicator and reveals elapsed work after five
/// seconds`, `excludes approval wait from the active run duration`.
#[test]
fn elapsed_work_shows_after_five_seconds_without_approval_waits() {
    use super::live_tail::agent_run_active_elapsed_ms;
    crate::localization::set_current("en");
    let now = crate::clock::now_ms();
    let started = |at: i64| {
        projected(vec![
            json!({"type": "turn.started", "turnId": "turn-live", "at": at, "payload": {"prompt": "Hi"}}),
        ])
    };
    assert_eq!(
        label(&tail(started(now), true)).as_deref(),
        Some("Thinking")
    );
    let long = label(&tail(started(now - 6_500), true)).unwrap();
    assert!(
        long.starts_with("Thinking · ") && long.ends_with('s'),
        "{long}"
    );
    let waited = projected(vec![
        json!({"type": "turn.started", "turnId": "turn-wait", "at": 1_000, "payload": {"prompt": "Inspect"}}),
        json!({"type": "approval.requested", "turnId": "turn-wait", "itemId": "approval-wait", "at": 4_000, "payload": {"requestId": "approval-wait", "kind": "command", "title": "Run"}}),
        json!({"type": "approval.resolved", "turnId": "turn-wait", "itemId": "approval-wait", "at": 9_000, "payload": {"requestId": "approval-wait", "decision": "accept"}}),
    ]);
    let turn = waited.turns[0].clone();
    assert_eq!(turn.user_wait_started_at_ms, None);
    assert_eq!(turn.user_wait_duration_ms, Some(5_000.));
    assert_eq!(
        agent_run_active_elapsed_ms(Some(&turn), 12_000),
        Some(6_000)
    );
}

/// `keeps an official non-transcript working pulse visible around native
/// tool activity`, `renders only the current connection state`, `keeps a
/// streaming reasoning summary behind the single live-tail status`.
#[test]
fn tools_keep_the_working_pulse_reasoning_stays_behind_it_and_a_connection_state_replaces_it() {
    use super::live_tail::{RunStatus, agent_run_status_code};
    crate::localization::set_current("en");
    let tool = projected(vec![
        json!({"type": "turn.started", "turnId": "turn-working", "payload": {"prompt": "List files"}}),
        json!({"type": "tool.started", "turnId": "turn-working", "itemId": "tool-list", "payload": {"kind": "command", "tool": "list", "label": "List", "status": "running"}}),
    ]);
    assert_eq!(agent_run_status_code(&tool, true), Some(RunStatus::Working));
    assert_eq!(label(&tail(tool, true)).as_deref(), Some("Working"));
    let reasoning = projected(vec![
        json!({"type": "turn.started", "turnId": "turn-reasoning", "payload": {"prompt": "Inspect"}}),
        json!({"type": "reasoning.summary.delta", "turnId": "turn-reasoning", "itemId": "reasoning-summary", "payload": {"delta": "Inspecting the project structure."}}),
    ]);
    let live = tail(reasoning, true);
    let (status, summary) = live.working.clone().unwrap();
    assert_eq!(status, "Thinking");
    assert_eq!(
        summary.map(|(_, text)| text).as_deref(),
        Some("Inspecting the project structure.")
    );
    let mut reconnecting = projected(vec![
        json!({"type": "turn.started", "turnId": "turn-live", "payload": {"prompt": "Hi"}}),
    ]);
    reconnecting.connection_status = serde_json::from_value(json!({
        "state": "reconnecting", "message": "Reconnecting… 4/5", "attempt": 4, "maxAttempts": 5,
        "turnId": "turn-live", "sequence": 4
    }))
    .ok();
    let live = tail(reconnecting, true);
    assert_eq!(
        live.connection.as_ref().map(|c| c.message.as_str()),
        Some("Reconnecting… 4/5")
    );
    assert!(
        live.working.is_none(),
        "the connection state replaces the pulse"
    );
    assert!(tail(projected(vec![]), false).connection.is_none());
}

// `messages.test.ts` and `run-status.test.ts`: what the transcript draws.

fn admitted(actor: &SessionActor, status: &str) {
    actor
        .dispatch(json!({"type": "command.received", "command": {
            "commandId": "one", "operationId": "operation", "kind": "start", "status": status,
            "userMessageId": "client", "intentFingerprint": "fingerprint",
            "intent": {"prompt": "Hello once", "promptMentions": [], "referenceDisplays": [], "model": null, "effort": null, "mode": null}}}))
        .unwrap();
}

fn user_part_ids(actor: &SessionActor) -> Vec<String> {
    actor
        .snapshot()
        .display
        .parts
        .iter()
        .filter(|p| p["kind"] == "user")
        .map(|p| p["id"].as_str().unwrap().to_owned())
        .collect()
}

fn present(view: &Entity<TranscriptView>, actor: &SessionActor, cx: &mut VisualTestContext) {
    show(
        view,
        AgentProjection::project(&actor.snapshot().display, None).unwrap(),
        cx,
    );
}

/// `keeps queued / outcome-unknown / rejected / cancelled delivery
/// information readable`; `renders the same Main user part through
/// admission, echo and completion without a duplicate bubble`.
#[gpui::test]
fn a_prompt_shows_once_with_its_delivery_state_until_the_native_turn_takes_it(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    let selector = |text: String| -> &'static str { Box::leak(text.into_boxed_str()) };
    for (status, then, label) in [
        ("queued", None, "agent.status.queued"),
        (
            "dispatching",
            Some("command.outcome-unknown"),
            "agent.status.deliveryUnknown",
        ),
        (
            "dispatching",
            Some("command.rejected"),
            "agent.status.notSent",
        ),
        (
            "dispatching",
            Some("command.cancelled"),
            "agent.status.notSent",
        ),
    ] {
        let actor = SessionActor::new(ActorOptions::default()).unwrap();
        admitted(&actor, status);
        if let Some(event) = then {
            actor
                .dispatch(json!({"type": event, "commandId": "one"}))
                .unwrap();
        }
        present(&view, &actor, cx);
        let ids = user_part_ids(&actor);
        assert_eq!(ids.len(), 1, "{status} {then:?}");
        assert!(
            cx.debug_bounds(selector(format!("agent-user-message:{}", ids[0])))
                .is_some()
        );
        let label = crate::localization::t(label);
        assert!(
            cx.debug_bounds(selector(format!("agent-delivery:{label}")))
                .is_some(),
            "{status} {then:?}: {label}"
        );
    }
    // Admission, the native echo and completion: one prompt, no state line.
    let actor = SessionActor::new(ActorOptions::default()).unwrap();
    admitted(&actor, "dispatching");
    present(&view, &actor, cx);
    let id = user_part_ids(&actor)[0].clone();
    for event in [
        json!({"type": "turn.started", "turnId": "turn", "payload": {"userMessageId": "client", "submissionId": "one"}}),
        json!({"type": "user.message", "turnId": "turn", "itemId": "native", "payload": {"clientUserMessageId": "client", "text": "Native compiled input"}}),
        json!({"type": "turn.completed", "turnId": "turn", "payload": {}}),
    ] {
        actor
            .append_event(crate::agent::domain::agent_session_actor::EventInput {
                session_id: "session".into(),
                runtime_id: "agent".into(),
                provider_session_id: None,
                event,
            })
            .unwrap();
        present(&view, &actor, cx);
        assert_eq!(
            user_part_ids(&actor),
            std::slice::from_ref(&id),
            "no second bubble"
        );
        assert!(
            cx.debug_bounds(selector(format!("agent-user-message:{id}")))
                .is_some()
        );
        for label in [
            "agent.status.queued",
            "agent.status.deliveryUnknown",
            "agent.status.notSent",
        ] {
            let label = crate::localization::t(label);
            assert!(
                cx.debug_bounds(selector(format!("agent-delivery:{label}")))
                    .is_none()
            );
        }
    }
}

/// `discloses partial reply content without pretending the native turn
/// failed`; `renders one muted duration summary after a terminal Agent
/// turn`.
#[gpui::test]
fn a_partial_reply_is_disclosed_and_a_finished_turn_says_how_long_it_worked(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    let actor = SessionActor::new(ActorOptions::default()).unwrap();
    let event = |event: serde_json::Value| {
        actor
            .append_event(crate::agent::domain::agent_session_actor::EventInput {
                session_id: "session".into(),
                runtime_id: "agent".into(),
                provider_session_id: None,
                event,
            })
            .unwrap();
    };
    event(
        json!({"type": "assistant.completed", "turnId": "turn", "itemId": "answer", "payload": {"text": "Visible prefix", "truncated": true}}),
    );
    present(&view, &actor, cx);
    assert!(cx.debug_bounds("agent-reply-partial").is_some());
    let failed = crate::localization::t("agent.turn.status.failed");
    let failed: &'static str = Box::leak(format!("agent-reply-state:{failed}").into_boxed_str());
    assert!(cx.debug_bounds(failed).is_none());
    event(json!({"type": "turn.started", "turnId": "timed", "payload": {"restored": true}}));
    event(
        json!({"type": "turn.completed", "turnId": "timed", "payload": {"restored": true, "durationMs": 62_000}}),
    );
    present(&view, &actor, cx);
    assert!(
        cx.debug_bounds("agent-turn-summary:Worked for 1m 2s")
            .is_some()
    );
}

/// `renders a quiet document flow without role labels or a generic response
/// toolbar`: a prompt's media sit above its text, a workspace file reference
/// stays inline as its mention, and the answer follows in the document.
#[gpui::test]
fn a_prompt_shows_its_media_above_and_its_mentions_inline(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    let actor = SessionActor::new(ActorOptions::default()).unwrap();
    actor
        .dispatch(json!({"type": "command.received", "command": {
            "commandId": "one", "operationId": "operation", "kind": "start", "status": "dispatching",
            "userMessageId": "client", "intentFingerprint": "fingerprint",
            "intent": {"prompt": "Review @docs/README.md architecture",
                "promptMentions": [{"referenceId": "file-1", "start": 7, "end": 22}],
                "referenceDisplays": [
                    {"id": "image-1", "kind": "attachment", "displayName": "capture.png", "mime": "image/png", "size": 128},
                    {"id": "file-1", "kind": "workspace-file", "displayName": "README.md", "relativePath": "docs/README.md"}
                ],
                "model": null, "effort": null, "mode": null}}}))
        .unwrap();
    present(&view, &actor, cx);
    let media = cx
        .debug_bounds("agent-media:capture.png")
        .expect("the image above");
    assert!(
        cx.debug_bounds("agent-media:README.md").is_none(),
        "a file is no media"
    );
    let mention = cx
        .debug_bounds("agent-mention:@docs/README.md")
        .expect("the file inline");
    assert!(media.origin.y < mention.origin.y, "media above the prompt");
}

/// `Transcript scrolling intent`: a scroll toward the start releases
/// following (past the list's 1px bottom tolerance: 2, 10 or 79 px), so new
/// rows no longer pull the view down; it follows again only at the bottom
/// or on Jump to latest.
#[gpui::test]
fn a_small_upward_scroll_releases_following_until_the_bottom_or_jump_to_latest(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    for up in [2., 10., 79.] {
        let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
        let actor = SessionActor::new(ActorOptions::default()).unwrap();
        let answer = |index: usize| {
            actor
                .append_event(crate::agent::domain::agent_session_actor::EventInput {
                    session_id: "session".into(),
                    runtime_id: "agent".into(),
                    provider_session_id: None,
                    event: json!({"type": "assistant.completed", "turnId": format!("turn-{index}"), "itemId": format!("answer-{index}"),
                        "payload": {"text": format!("Answer {index}\n\nwith a second paragraph")}}),
                })
                .unwrap();
        };
        for index in 0..40 {
            answer(index);
        }
        present(&view, &actor, cx);
        draw(cx);
        let following = |cx: &mut VisualTestContext| view.read_with(cx, |v, _| v.following());
        assert!(following(cx), "{up}: a new transcript follows");
        let middle = view.read_with(cx, |v, _| v.list.viewport_bounds()).center();
        cx.simulate_event(ScrollWheelEvent {
            position: middle,
            delta: ScrollDelta::Pixels(point(px(0.), px(up))),
            ..Default::default()
        });
        draw(cx);
        assert!(!following(cx), "{up}: scrolling up releases following");
        let top = |cx: &mut VisualTestContext| {
            let top = view.read_with(cx, |v, _| v.list.logical_scroll_top());
            (top.item_ix, top.offset_in_item)
        };
        let before = top(cx);
        answer(40);
        present(&view, &actor, cx);
        draw(cx);
        assert!(!following(cx));
        assert_eq!(top(cx), before, "{up}: the view stays");
        let jump = cx
            .debug_bounds("agent-jump-latest")
            .expect("Jump to latest");
        cx.simulate_click(jump.center(), Modifiers::none());
        draw(cx);
        assert!(following(cx), "{up}: Jump to latest follows again");
        assert!(cx.debug_bounds("agent-jump-latest").is_none());
        // Up, then back down to the bottom: following resumes.
        cx.simulate_event(ScrollWheelEvent {
            position: middle,
            delta: ScrollDelta::Pixels(point(px(0.), px(up))),
            ..Default::default()
        });
        draw(cx);
        assert!(!following(cx));
        cx.simulate_event(ScrollWheelEvent {
            position: middle,
            delta: ScrollDelta::Pixels(point(px(0.), px(-(up + 200.)))),
            ..Default::default()
        });
        draw(cx);
        draw(cx);
        assert!(following(cx), "{up}: the bottom follows again");
    }
}

/// `desktop-agent.tool-group`: `renders one line per step and opens one
/// inline detail at a time`; `shows a long exploration run as one Explored
/// line that opens into its steps`.
#[gpui::test]
fn a_tool_group_opens_one_step_at_a_time_and_unfolds_its_exploration(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    let actor = SessionActor::new(ActorOptions::default()).unwrap();
    let event = |event: serde_json::Value| {
        actor
            .append_event(crate::agent::domain::agent_session_actor::EventInput {
                session_id: "session".into(),
                runtime_id: "agent".into(),
                provider_session_id: None,
                event,
            })
            .unwrap();
    };
    event(json!({"type": "turn.started", "turnId": "turn", "payload": {"prompt": "Look"}}));
    let tool = |item: &str, tool: &str, path: &str, output: &str| {
        event(
            json!({"type": "tool.started", "turnId": "turn", "itemId": item,
            "payload": {"kind": "tool", "tool": tool, "label": tool, "status": "running",
                "input": {"path": path}}}),
        );
        event(
            json!({"type": "command.output.delta", "turnId": "turn", "itemId": item,
            "payload": {"delta": output}}),
        );
        event(
            json!({"type": "tool.completed", "turnId": "turn", "itemId": item,
            "payload": {"kind": "tool", "tool": tool, "label": tool, "status": "completed",
                "input": {"path": path}}}),
        );
    };
    tool("bash", "bash", "", "passed");
    tool("read", "read", "package.json", "contents");
    present(&view, &actor, cx);
    let ids: Vec<String> = actor
        .snapshot()
        .display
        .parts
        .iter()
        .filter(|p| p["kind"] != "user")
        .map(|p| p["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids.len(), 2, "two steps");
    let leak = |text: String| -> &'static str { Box::leak(text.into_boxed_str()) };
    let open = |cx: &mut VisualTestContext, id: &str| {
        let line = cx.debug_bounds(leak(format!("agent-step:{id}"))).unwrap();
        cx.simulate_click(line.center(), Modifiers::none());
        draw(cx);
    };
    let shown = |cx: &mut VisualTestContext, id: &str| {
        cx.debug_bounds(leak(format!("agent-step-detail:{id}")))
            .is_some()
    };
    open(cx, &ids[0]);
    assert!(shown(cx, &ids[0]) && !shown(cx, &ids[1]));
    open(cx, &ids[1]);
    assert!(
        !shown(cx, &ids[0]) && shown(cx, &ids[1]),
        "one detail at a time"
    );
    open(cx, &ids[1]);
    assert!(!shown(cx, &ids[1]));
    // Four more settled reads: the run folds into one Explored line.
    for index in 0..4 {
        tool(
            &format!("more-{index}"),
            "read",
            &format!("src/{index}.ts"),
            "text",
        );
    }
    present(&view, &actor, cx);
    let projection = AgentProjection::project(&actor.snapshot().display, None).unwrap();
    let tools: Vec<_> = projection
        .parts
        .iter()
        .filter(|p| p.kind != "user")
        .cloned()
        .collect();
    let segments = super::super::activity::agent_tool_steps::agent_tool_step_segments(&tools);
    let super::super::activity::agent_tool_steps::AgentToolStepSegment::Explored {
        id, parts, ..
    } = &segments[segments.len() - 1]
    else {
        panic!("an Explored line: {segments:?}")
    };
    let fold = cx
        .debug_bounds(leak(format!("agent-fold:{id}")))
        .expect("one Explored line");
    let folded: Vec<String> = parts.iter().map(|p| p.id.clone()).collect();
    assert!(
        cx.debug_bounds(leak(format!("agent-step:{}", folded[0])))
            .is_none()
    );
    cx.simulate_click(fold.center(), Modifiers::none());
    draw(cx);
    for id in &folded {
        assert!(
            cx.debug_bounds(leak(format!("agent-step:{id}"))).is_some(),
            "{id}"
        );
    }
}

// `desktop-agent.virtual-timeline.test.ts`: the transcript's own bounds.

fn answers(texts: impl IntoIterator<Item = String>) -> AgentProjection {
    projected(
        texts
            .into_iter()
            .enumerate()
            .map(|(i, text)| {
                json!({"type": "assistant.completed", "turnId": format!("turn-{}", i / 4),
                    "itemId": format!("item-{i}"), "payload": {"text": text}})
            })
            .collect(),
    )
}

fn leak(text: String) -> &'static str {
    Box::leak(text.into_boxed_str())
}

/// `keeps a 2,000-row fixture below the 120 mounted-row budget`: only the
/// rows in view are drawn, and a followed transcript shows its end.
#[gpui::test]
fn a_long_conversation_draws_only_the_rows_in_view(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    show(&view, answers((0..2_000).map(|i| format!("Row {i}"))), cx);
    draw(cx);
    let ids: Vec<String> =
        view.read_with(cx, |v, _| v.rows.iter().map(|r| r.row.id.clone()).collect());
    assert_eq!(ids.len(), 2_000);
    let drawn: Vec<&String> = ids
        .iter()
        .filter(|id| cx.debug_bounds(leak(format!("agent-row:{id}"))).is_some())
        .collect();
    assert!(!drawn.is_empty() && drawn.len() <= 120, "{}", drawn.len());
    assert!(drawn.contains(&ids.last().unwrap()), "followed to the end");
}

/// `renders fenced output with a visible language and an icon-only copy
/// action`.
#[gpui::test]
fn a_fence_names_its_language_and_copies_its_source(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    show(&view, answers(["```text\n项目备注\n```".to_owned()]), cx);
    draw(cx);
    assert!(cx.debug_bounds("agent-code-language:text").is_some());
    let copy = cx.debug_bounds("agent-code-copy").unwrap();
    cx.simulate_click(copy.center(), Modifiers::default());
    assert_eq!(
        cx.read_from_clipboard().and_then(|c| c.text()).as_deref(),
        Some("项目备注")
    );
}

/// `progressively discloses long Markdown without mounting an unbounded
/// initial document`.
#[gpui::test]
fn a_long_answer_shows_its_first_window_until_opened_in_full(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (view, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    let blocks = crate::features::desktop_agent::ui::agent_markdown_policy::INITIAL_BLOCK_LIMIT;
    show(&view, answers(["Paragraph\n\n".repeat(blocks + 20)]), cx);
    draw(cx);
    let show_full = leak(format!(
        "agent-md-disclosure:{}",
        crate::localization::t("agent.markdown.showFull")
    ));
    let collapse = leak(format!(
        "agent-md-disclosure:{}",
        crate::localization::t("agent.markdown.collapse")
    ));
    let disclosure = cx.debug_bounds(show_full).expect("a first window");
    let row = view.read_with(cx, |v, _| v.rows[0].row.id.clone());
    let row = leak(format!("agent-row:{row}"));
    let first = cx.debug_bounds(row).unwrap().size.height;
    cx.simulate_click(disclosure.center(), Modifiers::default());
    draw(cx);
    draw(cx);
    assert!(cx.debug_bounds(collapse).is_some());
    let opened = cx.debug_bounds(row).map(|b| b.size.height);
    assert!(
        opened.is_none_or(|h| h > first),
        "the full answer is longer"
    );
}
