//! `tests/unit/agent/events/desktop-agent.projection.test.ts`, through the
//! same Main control/content projection pipeline as production
//! (`tests/support/agent/agentDisplayFixture.ts`).
use super::display_control::project_agent_display_control;
use super::display_projection::ProjectionOptions;
use super::transcript_reducer::{
    apply_agent_event as reduce_content, create_agent_projection, limits,
};
use crate::agent::contract::activity_semantics::is_agent_transcript_activity;
use crate::agent::contract::display_types::AgentDisplay;
use crate::agent::contract::js;
use crate::agent::domain::agent_session_control::{create_agent_session_control, reduce_control};
use core::prelude::v1::test;
use serde_json::{Value, json};

/// `applyAgentEvent` of the display fixture: the display and the control
/// the fixture keeps beside it.
#[derive(Clone)]
struct Fixture {
    display: AgentDisplay,
    control: Value,
}

impl Fixture {
    fn new() -> Self {
        Self {
            display: create_agent_projection(),
            control: create_agent_session_control("fixture-stream", "fixture-epoch", "idle", 0),
        }
    }
    fn apply_with(&self, event: &Value, options: ProjectionOptions) -> Self {
        let control = reduce_control(
            &self.control,
            &json!({ "type": "event.accepted", "event": event }),
        )
        .unwrap();
        let display =
            project_agent_display_control(&reduce_content(&self.display, event, options), &control);
        Self { display, control }
    }
    fn apply(&self, event: &Value) -> Self {
        self.apply_with(event, ProjectionOptions::default())
    }
    fn apply_all(&self, events: &[Value]) -> Self {
        events
            .iter()
            .fold(self.clone(), |fixture, event| fixture.apply(event))
    }
    fn apply_all_with(&self, events: &[Value], options: ProjectionOptions) -> Self {
        events.iter().fold(self.clone(), |fixture, event| {
            fixture.apply_with(event, options)
        })
    }
}

fn event(
    sequence: i64,
    event_type: &str,
    payload: Value,
    turn_id: Option<&str>,
    item_id: Option<&str>,
) -> Value {
    json!({
        "schemaVersion": 1,
        "sequence": sequence,
        "sessionId": "session-1",
        "provider": "codex",
        "providerSessionId": "thread-1",
        "turnId": turn_id,
        "itemId": item_id,
        "emittedAt": js::iso_string(sequence * 1000),
        "type": event_type,
        "payload": payload,
    })
}

fn of<'a>(
    entries: &'a [crate::agent::contract::display_types::Entry],
    kind_key: &str,
    kind: &str,
) -> Vec<&'a Value> {
    entries
        .iter()
        .map(|e| &**e)
        .filter(|e| e[kind_key] == kind)
        .collect()
}

/// The visible kinds of `buildAgentTimeline(projection).rows`.
fn visible_kinds(display: &AgentDisplay) -> Vec<String> {
    display
        .rows
        .iter()
        .filter(|row| {
            display
                .parts
                .iter()
                .find(|part| part["id"] == row["partId"])
                .is_some_and(|part| {
                    is_agent_transcript_activity(part)
                        && !matches!(
                            part["kind"].as_str(),
                            Some("usage" | "permission" | "question")
                        )
                })
        })
        .map(|row| row["kind"].as_str().unwrap_or("").to_string())
        .collect()
}

fn contains(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(a), Value::Object(e)) => e
            .iter()
            .all(|(k, v)| a.get(k).is_some_and(|av| contains(av, v))),
        _ => actual == expected,
    }
}

macro_rules! assert_match {
    ($actual:expr, $expected:expr) => {{
        let actual: &Value = &$actual;
        let expected = $expected;
        assert!(
            contains(actual, &expected),
            "{actual:#} does not match {expected:#}"
        );
    }};
}

#[test]
fn concatenates_assistant_deltas_and_lets_completed_content_finalize_authoritatively() {
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "turn.started",
            json!({"prompt": "Fix the test"}),
            Some("turn-1"),
            None,
        ),
        event(
            2,
            "assistant.delta",
            json!({"delta": "I found "}),
            Some("turn-1"),
            Some("message-1"),
        ),
        event(
            3,
            "assistant.delta",
            json!({"delta": "the issue."}),
            Some("turn-1"),
            Some("message-1"),
        ),
        event(
            4,
            "assistant.completed",
            json!({"text": "I found and fixed the issue."}),
            Some("turn-1"),
            Some("message-1"),
        ),
        event(
            5,
            "turn.completed",
            json!({"status": "completed"}),
            Some("turn-1"),
            None,
        ),
    ]);
    let d = &projection.display;
    assert_eq!(d.messages.len(), 2);
    assert_match!(
        d.messages[0],
        json!({"role": "user", "text": "Fix the test"})
    );
    assert_match!(
        d.messages[1],
        json!({"role": "assistant", "text": "I found and fixed the issue.", "streaming": false, "terminalState": "completed"})
    );
    assert_match!(
        d.turns[0],
        json!({"status": "completed", "startedAtMs": 1_000, "userWaitStartedAtMs": null, "userWaitDurationMs": 0, "durationMs": 4_000})
    );
}

#[test]
fn confirms_the_optimistic_prompt_by_native_identity_and_preserves_same_turn_follow_ups() {
    let projection = Fixture::new().apply_all(&[
        event(1, "turn.started", json!({"prompt": "Initial", "userMessageId": "user-initial"}), Some("turn-user"), None),
        event(2, "user.message", json!({"text": "Initial\nProvider-compiled context", "clientUserMessageId": "user-initial"}), Some("turn-user"), Some("user-initial")),
        event(3, "user.message", json!({"text": "Follow up"}), Some("turn-user"), Some("user-followup")),
        event(4, "user.message", json!({"text": "Follow up"}), Some("turn-user"), Some("user-followup")),
    ]);
    let users = of(&projection.display.messages, "role", "user");
    assert_eq!(users.len(), 2);
    assert_match!(
        *users[0],
        json!({"id": "user:user-initial", "itemId": "user-initial", "text": "Initial", "sequence": 1, "updatedSequence": 2})
    );
    assert_match!(
        *users[1],
        json!({"id": "user:user-followup", "itemId": "user-followup", "text": "Follow up", "sequence": 3, "updatedSequence": 4})
    );
    assert_eq!(visible_kinds(&projection.display), ["user", "user"]);
}

#[test]
fn does_not_interpret_a_recoverable_content_diagnostic_as_live_connection_state() {
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "turn.started",
            json!({"prompt": "Hello"}),
            Some("turn-warning"),
            None,
        ),
        event(
            2,
            "provider.warning",
            json!({"message": "Optional content could not be displayed.", "recoverable": true}),
            Some("turn-warning"),
            Some("content-warning"),
        ),
    ]);
    assert!(
        projection
            .display
            .get("connectionStatus")
            .unwrap()
            .is_null()
    );
    assert_eq!(projection.display.activities.len(), 1);
    assert_match!(
        projection.display.activities[0],
        json!({"kind": "warning", "label": "Optional content could not be displayed."})
    );
}

#[test]
fn keeps_first_observed_timeline_order_immutable_while_blocks_stream_and_settle() {
    let events = [
        event(
            1,
            "turn.started",
            json!({"prompt": "Inspect it"}),
            Some("turn-order"),
            None,
        ),
        event(
            2,
            "assistant.delta",
            json!({"delta": "I will inspect it."}),
            Some("turn-order"),
            Some("assistant-order"),
        ),
        event(
            3,
            "tool.started",
            json!({"kind": "command", "label": "List", "status": "running"}),
            Some("turn-order"),
            Some("tool-order"),
        ),
        event(
            4,
            "approval.requested",
            json!({"requestId": "approval-order", "kind": "command", "title": "List files"}),
            Some("turn-order"),
            Some("tool-order"),
        ),
        event(
            5,
            "approval.resolved",
            json!({"requestId": "approval-order", "decision": "accept"}),
            Some("turn-order"),
            Some("tool-order"),
        ),
        event(
            6,
            "tool.completed",
            json!({"kind": "command", "label": "List", "status": "completed"}),
            Some("turn-order"),
            Some("tool-order"),
        ),
        event(
            7,
            "assistant.completed",
            json!({"text": "Inspection complete."}),
            Some("turn-order"),
            Some("assistant-order"),
        ),
        event(
            8,
            "turn.completed",
            json!({"status": "completed"}),
            Some("turn-order"),
            None,
        ),
    ];
    let waiting = Fixture::new().apply_all(&events[..4]);
    let live = Fixture::new().apply_all(&events[..7]);
    let settled = live.apply(&events[7]);
    let replayed = Fixture::new().apply_all(&events);
    let kinds = |f: &Fixture| -> Vec<String> {
        visible_kinds(&f.display)
            .into_iter()
            .filter(|k| k != "turn-summary")
            .collect()
    };
    assert_eq!(kinds(&waiting), ["user", "assistant", "command"]);
    assert_eq!(waiting.display.approvals.len(), 1);
    assert_match!(
        waiting.display.approvals[0],
        json!({"requestId": "approval-order"})
    );
    assert_eq!(kinds(&live), ["user", "assistant", "command", "assistant"]);
    assert_eq!(
        kinds(&settled),
        ["user", "assistant", "command", "assistant"]
    );
    assert_eq!(
        kinds(&replayed),
        ["user", "assistant", "command", "assistant"]
    );
    let assistants = of(&live.display.parts, "kind", "assistant");
    assert_eq!(assistants.len(), 2);
    assert_match!(
        *assistants[0],
        json!({"sequence": 2, "updatedSequence": 2, "text": "I will inspect it.", "streaming": false})
    );
    assert_match!(
        *assistants[1],
        json!({"sequence": 7, "updatedSequence": 7, "text": "Inspection complete."})
    );
    assert_match!(
        *of(&live.display.parts, "kind", "command")[0],
        json!({"sequence": 3, "updatedSequence": 6, "status": "completed"})
    );
    assert_match!(
        *of(&live.display.parts, "kind", "permission")[0],
        json!({"sequence": 4, "updatedSequence": 5, "state": "resolved"})
    );
    assert_eq!(
        js::stringify(&replayed.display.to_value()),
        js::stringify(&settled.display.to_value())
    );
    assert_match!(
        settled.display.turns[0],
        json!({"userWaitStartedAtMs": null, "userWaitDurationMs": 1_000})
    );
}

#[test]
fn keeps_a_native_assistant_item_segmented_when_its_authoritative_completion_spans_a_tool() {
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "turn.started",
            json!({"prompt": "Inspect"}),
            Some("turn-segments"),
            None,
        ),
        event(
            2,
            "assistant.delta",
            json!({"delta": "Before tool. "}),
            Some("turn-segments"),
            Some("native-message"),
        ),
        event(
            3,
            "tool.started",
            json!({"kind": "command", "label": "List", "status": "running"}),
            Some("turn-segments"),
            Some("tool"),
        ),
        event(
            4,
            "tool.completed",
            json!({"kind": "command", "label": "List", "status": "completed"}),
            Some("turn-segments"),
            Some("tool"),
        ),
        event(
            5,
            "assistant.delta",
            json!({"delta": "After "}),
            Some("turn-segments"),
            Some("native-message"),
        ),
        event(
            6,
            "assistant.delta",
            json!({"delta": "tool."}),
            Some("turn-segments"),
            Some("native-message"),
        ),
        event(
            7,
            "assistant.completed",
            json!({"text": "Before tool. After tool."}),
            Some("turn-segments"),
            Some("native-message"),
        ),
    ]);
    let texts: Vec<&str> = of(&projection.display.messages, "role", "assistant")
        .iter()
        .map(|m| m["text"].as_str().unwrap())
        .collect();
    assert_eq!(texts, ["Before tool. ", "After tool."]);
    assert_eq!(
        visible_kinds(&projection.display),
        ["user", "assistant", "command", "assistant"]
    );
}

#[test]
fn seals_rather_than_erases_assistant_text_when_a_late_completion_adds_nothing_after_a_tool() {
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "turn.started",
            json!({"prompt": "Inspect"}),
            Some("turn-seal"),
            None,
        ),
        event(
            2,
            "assistant.delta",
            json!({"delta": "I will inspect."}),
            Some("turn-seal"),
            Some("native-message"),
        ),
        event(
            3,
            "tool.started",
            json!({"kind": "command", "label": "List", "status": "running"}),
            Some("turn-seal"),
            Some("tool"),
        ),
        event(
            4,
            "tool.completed",
            json!({"kind": "command", "label": "List", "status": "completed"}),
            Some("turn-seal"),
            Some("tool"),
        ),
        event(
            5,
            "assistant.completed",
            json!({"text": "I will inspect."}),
            Some("turn-seal"),
            Some("native-message"),
        ),
    ]);
    let assistants = of(&projection.display.messages, "role", "assistant");
    assert_eq!(assistants.len(), 1);
    assert_match!(
        *assistants[0],
        json!({"text": "I will inspect.", "streaming": false, "sequence": 2, "updatedSequence": 5})
    );
    assert_eq!(
        visible_kinds(&projection.display),
        ["user", "assistant", "command"]
    );
}

#[test]
fn prefers_the_providers_normalized_turn_duration_over_envelope_timing() {
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "turn.started",
            json!({"prompt": "Measure"}),
            Some("turn-duration"),
            None,
        ),
        event(
            9,
            "turn.completed",
            json!({"status": "completed", "durationMs": 2_450}),
            Some("turn-duration"),
            None,
        ),
    ]);
    assert_eq!(projection.display.turns[0]["durationMs"], 2_450);
}

#[test]
fn projects_degraded_completion_as_a_settled_turn_with_an_actionable_recovery_fact() {
    let projection = Fixture::new().apply_all(&[
        event(1, "turn.started", json!({"prompt": "Finish it", "recoveryOfTurnId": "turn-original"}), Some("turn-degraded"), None),
        event(2, "assistant.completed", json!({"text": "Error: RetriableError: [canceled] http/2 stream closed with error code CANCEL (0x8)"}), Some("turn-degraded"), Some("cursor-error")),
        event(3, "turn.completed", json!({
            "status": "completed",
            "durationMs": 41 * 60 * 1_000 + 5_000,
            "completionQuality": "degraded",
            "failureScope": "upstream-request",
            "failureCode": "CURSOR_HTTP2_STREAM_CANCEL",
            "retryable": true,
            "transportHealth": "healthy",
            "sideEffects": "possible",
            "diagnostic": "Cursor upstream HTTP/2 stream ended with CANCEL (0x8).",
        }), Some("turn-degraded"), None),
    ]);
    let d = &projection.display;
    assert!(d.get("runningTurnId").unwrap().is_null());
    assert_eq!(d.get("terminalState").unwrap(), "completed");
    assert_match!(
        d.turns[0],
        json!({
            "id": "turn-degraded",
            "recoveryOfTurnId": "turn-original",
            "status": "completed",
            "completionQuality": "degraded",
            "recovery": {
                "kind": "degraded-completion",
                "code": "CURSOR_HTTP2_STREAM_CANCEL",
                "failureScope": "upstream-request",
                "retryable": true,
                "transportHealth": "healthy",
                "sideEffects": "possible",
            },
        })
    );
    assert_match!(
        *of(&d.parts, "kind", "turn-summary")[0],
        json!({"status": "completed", "completionQuality": "degraded"})
    );
}

#[test]
fn keeps_usage_metadata_out_of_visible_transcript_rows() {
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "turn.started",
            json!({"prompt": "Measure"}),
            Some("turn-usage"),
            None,
        ),
        event(
            2,
            "usage.updated",
            json!({"inputTokens": 20, "outputTokens": 5}),
            Some("turn-usage"),
            None,
        ),
    ]);
    let d = &projection.display;
    assert_eq!(
        d.get("usage").unwrap(),
        &json!({"inputTokens": 20, "outputTokens": 5})
    );
    assert_match!(
        *of(&d.parts, "kind", "usage")[0],
        json!({"usage": {"inputTokens": 20, "outputTokens": 5}})
    );
    assert!(!d.rows.iter().any(|row| row["kind"] == "usage"));
}

#[test]
fn ignores_duplicates_marks_gaps_and_keeps_partial_assistant_text_after_interruption() {
    let projection = Fixture::new()
        .apply(&event(
            1,
            "turn.started",
            json!({"prompt": "Go"}),
            Some("turn-1"),
            None,
        ))
        .apply(&event(
            3,
            "assistant.delta",
            json!({"delta": "Partial"}),
            Some("turn-1"),
            Some("message-1"),
        ))
        .apply(&event(
            3,
            "assistant.delta",
            json!({"delta": " duplicate"}),
            Some("turn-1"),
            Some("message-1"),
        ))
        .apply(&event(
            4,
            "turn.interrupted",
            json!({}),
            Some("turn-1"),
            None,
        ));
    let d = &projection.display;
    assert_eq!(d.get("history").unwrap()["coverage"], "not-requested");
    assert_eq!(d.get("displayWindow").unwrap()["truncated"], false);
    assert_eq!(
        d.get("missingRanges").unwrap(),
        &json!([{"from": 2, "to": 2}])
    );
    assert_match!(
        d.messages[1],
        json!({"text": "Partial", "terminalState": "interrupted"})
    );
}

#[test]
fn tracks_tool_lifecycle_bounded_command_output_and_stale_approval_removal() {
    let large_output = "x".repeat(80 * 1024);
    let projection = Fixture::new().apply_all(&[
        event(1, "tool.started", json!({"kind": "command", "label": "npm test", "status": "running"}), Some("turn-1"), Some("tool-1")),
        event(2, "command.output.delta", json!({"delta": large_output}), Some("turn-1"), Some("tool-1")),
        event(3, "approval.requested", json!({"requestId": "codex:7", "kind": "command", "title": "Run command", "availableDecisions": ["accept", "decline"]}), Some("turn-1"), Some("tool-1")),
        event(4, "tool.completed", json!({"kind": "command", "label": "npm test", "status": "completed"}), Some("turn-1"), Some("tool-1")),
        event(5, "approval.resolved", json!({"requestId": "codex:7", "decision": "decline"}), Some("turn-1"), Some("tool-1")),
    ]);
    let d = &projection.display;
    assert_match!(
        d.activities[0],
        json!({"status": "completed", "label": "npm test"})
    );
    assert_eq!(d.activities[0]["output"].as_str().unwrap().len(), 64 * 1024);
    assert!(d.approvals.is_empty());
}

#[test]
fn keeps_the_first_command_output_delta_even_without_a_preceding_tool_event() {
    let projection = Fixture::new().apply(&event(
        1,
        "command.output.delta",
        json!({"delta": "first output"}),
        Some("turn-1"),
        Some("tool-1"),
    ));
    assert_eq!(projection.display.activities[0]["output"], "first output");
}

#[test]
fn preserves_canonical_tool_identity_and_upgrades_legacy_arguments_to_structured_input() {
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "tool.started",
            json!({
                "kind": "read", "tool": "read", "label": "Read file", "path": "src/App.tsx",
                "arguments": {"file_path": "src/App.tsx"}, "status": "running",
            }),
            Some("turn-tools"),
            Some("read-1"),
        ),
        event(
            2,
            "tool.completed",
            json!({
                "kind": "read", "tool": "read", "label": "Read file", "status": "completed",
                "outputPreview": "export function App() {}",
            }),
            Some("turn-tools"),
            Some("read-1"),
        ),
    ]);
    assert_match!(
        projection.display.activities[0],
        json!({
            "kind": "tool",
            "status": "completed",
            "detail": {
                "tool": "read",
                "path": "src/App.tsx",
                "input": {"file_path": "src/App.tsx"},
                "outputPreview": "export function App() {}",
            },
        })
    );
}

#[test]
fn does_not_project_empty_file_change_placeholders_and_removes_a_cleared_session_diff() {
    let file_changes = |f: &Fixture| {
        (
            of(&f.display.activities, "kind", "file-change").len(),
            of(&f.display.parts, "kind", "file-change").len(),
        )
    };
    let mut projection = Fixture::new().apply_all(&[
        event(
            1,
            "turn.started",
            json!({"prompt": "Inspect"}),
            Some("turn-file"),
            None,
        ),
        event(
            2,
            "file.change.updated",
            json!({"status": "completed", "changes": []}),
            Some("turn-file"),
            Some("session-diff"),
        ),
    ]);
    assert_eq!(file_changes(&projection), (0, 0));
    projection = projection.apply(&event(3, "file.change.updated", json!({
        "status": "completed", "changes": [{"path": "src/app.ts", "additions": 2, "deletions": 1}],
    }), Some("turn-file"), Some("session-diff")));
    assert_eq!(file_changes(&projection).0, 1);
    projection = projection.apply(&event(
        4,
        "file.change.updated",
        json!({"status": "completed", "changes": []}),
        Some("turn-file"),
        Some("session-diff"),
    ));
    assert_eq!(file_changes(&projection), (0, 0));
    assert!(
        !projection
            .display
            .rows
            .iter()
            .any(|row| row["partId"] == "activity:session-diff")
    );
}

#[test]
fn bounds_streamed_messages_and_reasoning_before_they_reach_renderer_state() {
    let oversized = "x".repeat(limits::MAX_MESSAGE_TEXT * 2);
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "turn.started",
            json!({"prompt": oversized}),
            Some("turn-bound"),
            None,
        ),
        event(
            2,
            "assistant.delta",
            json!({"delta": oversized}),
            Some("turn-bound"),
            Some("message-bound"),
        ),
        event(
            3,
            "assistant.delta",
            json!({"delta": oversized}),
            Some("turn-bound"),
            Some("message-bound"),
        ),
        event(
            4,
            "reasoning.summary.delta",
            json!({"delta": oversized}),
            Some("turn-bound"),
            Some("reasoning-bound"),
        ),
        event(
            5,
            "reasoning.summary.delta",
            json!({"delta": oversized}),
            Some("turn-bound"),
            Some("reasoning-bound"),
        ),
    ]);
    let d = &projection.display;
    assert_eq!(
        d.messages[0]["text"].as_str().unwrap().len(),
        limits::MAX_MESSAGE_TEXT
    );
    assert_eq!(
        d.messages[1]["text"].as_str().unwrap().len(),
        limits::MAX_MESSAGE_TEXT
    );
    assert_eq!(
        d.activities[0]["detail"]["delta"].as_str().unwrap().len(),
        limits::MAX_ACTIVITY_TEXT
    );
}

#[test]
fn renders_legacy_nested_provider_errors_as_readable_text() {
    let message = js::stringify(&json!({
        "type": "error",
        "error": {"message": "Invalid value: 'max'. Use 'xhigh'.", "param": "reasoning.effort"},
        "status": 400,
    }));
    let projection = Fixture::new().apply(&event(
        1,
        "provider.error",
        json!({"message": message}),
        Some("turn-1"),
        None,
    ));
    assert_eq!(
        projection.display.activities[0]["label"],
        "Invalid value: 'max'. Use 'xhigh'."
    );
}

#[test]
fn drops_legacy_lifecycle_only_system_error_notices_and_keeps_the_actionable_diagnostic() {
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "provider.error",
            json!({"message": "Codex thread entered a system error state."}),
            Some("turn-1"),
            None,
        ),
        event(
            2,
            "provider.error",
            json!({"message": "Invalid value: 'max'. Supported value is 'xhigh'."}),
            Some("turn-1"),
            None,
        ),
    ]);
    let labels: Vec<&Value> = projection
        .display
        .activities
        .iter()
        .map(|a| &a["label"])
        .collect();
    assert_eq!(
        labels,
        [&json!("Invalid value: 'max'. Supported value is 'xhigh'.")]
    );
    assert_eq!(of(&projection.display.parts, "kind", "error").len(), 1);
}

#[test]
fn normalizes_unrecognized_provider_activity_status_to_a_neutral_unknown_state() {
    let projection = Fixture::new().apply(&event(
        1,
        "provider.activity",
        json!({"label": "Future provider activity", "status": "teleporting"}),
        Some("turn-1"),
        Some("activity-1"),
    ));
    assert_match!(
        projection.display.activities[0],
        json!({"status": "unknown"})
    );
    assert_match!(
        *of(&projection.display.parts, "kind", "system")[0],
        json!({"status": "unknown"})
    );
}

#[test]
fn keeps_connection_recovery_as_one_replaceable_live_state_outside_transcript_history() {
    let recovering = Fixture::new().apply_all(&[
        event(1, "turn.started", json!({"prompt": "Hello"}), Some("turn-1"), None),
        event(2, "provider.connection.updated", json!({"state": "reconnecting", "message": "Reconnecting… 2/5", "attempt": 2, "maxAttempts": 5}), Some("turn-1"), None),
        event(3, "provider.connection.updated", json!({"state": "reconnecting", "message": "Reconnecting… 3/5", "attempt": 3, "maxAttempts": 5}), Some("turn-1"), None),
        event(4, "provider.connection.updated", json!({"state": "fallback", "message": "Switching connection transport."}), Some("turn-1"), None),
    ]);
    let d = &recovering.display;
    assert_match!(
        *d.get("connectionStatus").unwrap(),
        json!({"state": "fallback", "message": "Switching connection transport.", "turnId": "turn-1", "sequence": 4})
    );
    assert!(d.activities.is_empty());
    assert!(of(&d.parts, "kind", "warning").is_empty());
    assert!(of(&d.rows, "kind", "warning").is_empty());
    let progressed = recovering.apply(&event(
        5,
        "assistant.delta",
        json!({"delta": "Recovered"}),
        Some("turn-1"),
        Some("assistant-1"),
    ));
    assert_eq!(
        progressed.display.get("connectionStatus").unwrap()["state"],
        "fallback"
    );
    assert!(
        progressed
            .apply(&event(6, "turn.completed", json!({}), Some("turn-1"), None))
            .display
            .get("connectionStatus")
            .unwrap()
            .is_null()
    );
    assert_eq!(
        of(&progressed.display.messages, "role", "assistant")[0]["text"],
        "Recovered"
    );
}

#[test]
fn migrates_legacy_retry_and_transport_fallback_warnings_without_retaining_historical_cards() {
    let projection = Fixture::new().apply_all_with(&[
        event(1, "turn.started", json!({"prompt": "Hello"}), Some("turn-1"), None),
        event(2, "provider.warning", json!({"message": "Reconnecting… 2/5", "recoverable": true}), Some("turn-1"), Some("retry-2")),
        event(3, "provider.warning", json!({"message": "Reconnecting… 3/5", "recoverable": true}), Some("turn-1"), Some("retry-3")),
        event(4, "provider.warning", json!({"message": "Falling back from WebSockets to HTTPS transport. request timed out"}), Some("turn-1"), Some("fallback")),
    ], ProjectionOptions { legacy_provider_connection_warnings: true });
    let d = &projection.display;
    assert!(d.get("connectionStatus").unwrap().is_null());
    assert!(d.activities.is_empty());
    assert!(of(&d.parts, "kind", "warning").is_empty());
    assert!(of(&d.rows, "kind", "warning").is_empty());
}

#[test]
fn clears_live_connection_state_on_every_terminal_event() {
    for kind in ["turn.completed", "turn.failed", "turn.interrupted"] {
        let recovering = Fixture::new().apply(&event(
            1,
            "provider.connection.updated",
            json!({"state": "reconnecting", "message": "Reconnecting… 5/5"}),
            Some("turn-1"),
            None,
        ));
        let settled = recovering.apply(&event(
            2,
            kind,
            json!({"status": &kind[5..]}),
            Some("turn-1"),
            None,
        ));
        assert!(
            settled.display.get("connectionStatus").unwrap().is_null(),
            "{kind}"
        );
    }
}

#[test]
fn settles_orphaned_live_activity_and_blocking_state_on_every_terminal_event() {
    for (kind, status) in [
        ("turn.completed", "completed"),
        ("turn.failed", "failed"),
        ("turn.interrupted", "interrupted"),
    ] {
        let running = Fixture::new().apply_all(&[
            event(
                1,
                "turn.started",
                json!({"prompt": "Run it"}),
                Some("turn-1"),
                None,
            ),
            event(
                2,
                "tool.started",
                json!({"kind": "command", "label": "Long command", "status": "running"}),
                Some("turn-1"),
                Some("tool-1"),
            ),
            event(
                3,
                "approval.requested",
                json!({"requestId": "approval-1", "kind": "command"}),
                Some("turn-1"),
                Some("tool-1"),
            ),
            event(
                4,
                "question.requested",
                json!({"requestId": "question-1", "questions": []}),
                Some("turn-1"),
                Some("question-1"),
            ),
        ]);
        let settled = running.apply(&event(
            5,
            kind,
            json!({"status": status}),
            Some("turn-1"),
            None,
        ));
        let d = &settled.display;
        assert_eq!(d.activities[0]["status"], "unknown");
        assert_match!(
            *of(&d.parts, "kind", "command")[0],
            json!({"status": "unknown"})
        );
        assert_match!(
            *of(&d.parts, "kind", "permission")[0],
            json!({"state": "resolved"})
        );
        assert_match!(
            *of(&d.parts, "kind", "question")[0],
            json!({"state": "resolved"})
        );
        assert!(d.approvals.is_empty() && d.questions.is_empty());
    }
}

#[test]
fn collapses_duplicate_provider_terminal_errors_for_the_same_turn() {
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "turn.started",
            json!({"prompt": "Hello"}),
            Some("turn-1"),
            None,
        ),
        event(
            2,
            "provider.warning",
            json!({"message": "API key not valid. Please pass a valid API key."}),
            Some("turn-1"),
            Some("retry-1"),
        ),
        event(
            3,
            "provider.error",
            json!({"message": "API key not valid. Please pass a valid API key."}),
            Some("turn-1"),
            Some("assistant-1"),
        ),
        event(
            4,
            "turn.failed",
            json!({"status": "failed", "message": "API key not valid."}),
            Some("turn-1"),
            None,
        ),
        event(
            5,
            "provider.error",
            json!({"message": "API key not valid. Please pass a valid API key."}),
            None,
            Some("assistant-2"),
        ),
    ]);
    let d = &projection.display;
    assert_eq!(of(&d.activities, "kind", "error").len(), 1);
    assert!(of(&d.activities, "kind", "warning").is_empty());
    assert_eq!(of(&d.parts, "kind", "error").len(), 1);
    assert_eq!(
        of(&d.activities, "kind", "error")[0]["label"],
        "API key not valid. Please pass a valid API key."
    );
}

#[test]
fn does_not_merge_the_same_provider_failure_across_separate_turns() {
    let projection = Fixture::new().apply_all(&[
        event(
            1,
            "turn.started",
            json!({"prompt": "First"}),
            Some("turn-1"),
            None,
        ),
        event(
            2,
            "provider.error",
            json!({"message": "API key not valid."}),
            Some("turn-1"),
            Some("assistant-1"),
        ),
        event(
            3,
            "turn.failed",
            json!({"status": "failed"}),
            Some("turn-1"),
            None,
        ),
        event(
            4,
            "turn.started",
            json!({"prompt": "Second"}),
            Some("turn-2"),
            None,
        ),
        event(
            5,
            "provider.error",
            json!({"message": "API key not valid."}),
            Some("turn-2"),
            Some("assistant-2"),
        ),
    ]);
    let errors = of(&projection.display.activities, "kind", "error");
    assert_eq!(errors.len(), 2);
    let turns: std::collections::HashSet<&str> = projection
        .display
        .activities
        .iter()
        .filter_map(|a| a["turnId"].as_str())
        .collect();
    assert_eq!(turns, ["turn-1", "turn-2"].into_iter().collect());
}

#[test]
fn keeps_sanitized_reference_display_identity_stable_across_committed_projection_and_replay() {
    let started = event(
        1,
        "turn.started",
        json!({
            "prompt": "Review these",
            "referenceDisplays": [
                {"id": "workspace-a", "kind": "workspace-file", "displayName": "a.md", "relativePath": "docs/a.md"},
                {"id": "attachment-b", "kind": "attachment", "displayName": "capture.png", "mime": "image/png", "size": 128},
            ],
        }),
        Some("turn-reference"),
        None,
    );
    let committed = Fixture::new().apply(&started);
    let replayed = Fixture::new().apply_all(std::slice::from_ref(&started));
    let message = &committed.display.messages[0];
    assert_match!(**message, json!({"role": "user"}));
    assert_match!(
        message["references"][0],
        json!({"id": "workspace-a", "relativePath": "docs/a.md"})
    );
    assert_match!(
        message["references"][1],
        json!({"id": "attachment-b", "displayName": "capture.png", "size": 128})
    );
    assert_eq!(
        of(&committed.display.parts, "kind", "user")[0]["references"],
        message["references"]
    );
    assert_eq!(
        replayed.display.messages[0]["references"],
        message["references"]
    );
    let serialized = js::stringify(&committed.display.to_value());
    assert!(
        !regex::Regex::new(r"token|snapshotUrl|data:image|/private/")
            .unwrap()
            .is_match(&serialized)
    );
}
