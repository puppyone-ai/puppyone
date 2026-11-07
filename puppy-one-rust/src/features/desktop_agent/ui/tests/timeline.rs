//! `desktop-agent.timeline-layout.test.ts` and
//! `desktop-agent.timeline-viewport.test.ts`.
use crate::agent::contract::display_state::create_empty_agent_display;
use crate::agent::contract::display_types::AgentDisplay;
use crate::agent::domain::agent_session_control::create_agent_session_control;
use crate::agent::domain::transcript::display_control::project_agent_display_control;
use crate::features::desktop_agent::domain::agent_ui_state::AgentTimelineScrollAnchor;
use crate::features::desktop_agent::ui::transcript::transcript_layout::{
    AGENT_TIMELINE_SPACING, MAX_MOUNTED_ROWS, build_agent_timeline_layout,
    visible_agent_timeline_range,
};
use crate::features::desktop_agent::ui::transcript::transcript_rows::{
    TimelineRow, build_agent_timeline,
};
use crate::features::desktop_agent::ui::transcript::transcript_viewport::{
    capture_agent_timeline_scroll_anchor, resolve_agent_timeline_scroll_anchor,
};
use serde_json::{Value, json};
use std::collections::HashMap;

fn row(
    part_id: &str,
    kind: &str,
    turn_id: Option<&str>,
    sequence: i64,
    estimated_height: f64,
) -> TimelineRow {
    TimelineRow {
        id: format!("row:{part_id}"),
        part_id: part_id.into(),
        turn_id: turn_id.map(str::to_string),
        kind: kind.into(),
        sequence,
        updated_sequence: None,
        estimated_height,
    }
}

fn measurements(entries: &[(&str, f64)]) -> HashMap<String, f64> {
    entries
        .iter()
        .map(|(id, height)| (id.to_string(), *height))
        .collect()
}

#[test]
fn uses_one_deterministic_rhythm_for_work_flow_and_turn_handoffs() {
    let rows = [
        row("user:one", "user", Some("turn:one"), 1, 40.),
        row("assistant:one", "assistant", Some("turn:one"), 2, 80.),
        row("turn-summary:one", "turn-summary", Some("turn:one"), 3, 20.),
        row("user:two", "user", Some("turn:two"), 4, 40.),
    ];
    let layout = build_agent_timeline_layout(&rows, &HashMap::new(), AGENT_TIMELINE_SPACING);
    let s = AGENT_TIMELINE_SPACING;
    assert_eq!(
        layout.gaps,
        vec![
            s.turn_handoff,
            s.work_handoff,
            s.turn_handoff,
            s.turn_handoff
        ]
    );
    assert_eq!(layout.offsets, vec![0., 64., 152., 196., 260.]);
}

#[test]
fn recomputes_the_handoff_when_a_user_turn_follows_a_settled_summary() {
    let settled = vec![
        row("assistant:one", "assistant", Some("turn:one"), 1, 40.),
        row("turn-summary:one", "turn-summary", Some("turn:one"), 2, 20.),
    ];
    let measured = measurements(&[("row:assistant:one", 40.), ("row:turn-summary:one", 20.)]);
    let before = build_agent_timeline_layout(&settled, &measured, AGENT_TIMELINE_SPACING);
    let mut appended = settled.clone();
    appended.push(row("user:two", "user", Some("turn:two"), 3, 40.));
    let after = build_agent_timeline_layout(&appended, &measured, AGENT_TIMELINE_SPACING);
    assert_eq!(before.gaps[1], AGENT_TIMELINE_SPACING.work_handoff);
    assert_eq!(after.gaps[1], AGENT_TIMELINE_SPACING.turn_handoff);
    assert_eq!(after.offsets[2], 92.);
}

#[test]
fn keeps_semantic_spacing_independent_from_content_remeasurement() {
    let rows = [
        row("assistant:one", "assistant", Some("turn:one"), 1, 40.),
        row("turn-summary:one", "turn-summary", Some("turn:one"), 2, 20.),
        row("user:two", "user", Some("turn:two"), 3, 40.),
    ];
    let compact = build_agent_timeline_layout(
        &rows,
        &measurements(&[("row:turn-summary:one", 20.)]),
        AGENT_TIMELINE_SPACING,
    );
    let wrapped = build_agent_timeline_layout(
        &rows,
        &measurements(&[("row:turn-summary:one", 56.)]),
        AGENT_TIMELINE_SPACING,
    );
    assert_eq!(compact.gaps, wrapped.gaps);
    assert_eq!(wrapped.offsets[2] - compact.offsets[2], 36.);
    assert_eq!(
        wrapped.offsets[2] - wrapped.offsets[1] - 56.,
        AGENT_TIMELINE_SPACING.turn_handoff
    );
}

#[test]
fn removes_non_visual_usage_state_before_it_affects_row_adjacency() {
    let assistant = json!({
        "id": "assistant:one", "turnId": "turn:one", "itemId": "message:one", "kind": "assistant", "text": "Done",
        "streaming": false, "terminalState": "completed", "sequence": 1,
    });
    let usage = json!({ "id": "usage:current", "turnId": "turn:one", "itemId": null, "kind": "usage", "usage": { "outputTokens": 12 }, "sequence": 2 });
    let user = json!({
        "id": "user:two", "turnId": "turn:two", "itemId": null, "kind": "user", "text": "Next request",
        "streaming": false, "terminalState": null, "sequence": 4,
    });
    let parts = vec![assistant.clone(), usage.clone(), user];
    let rows: Vec<Value> = parts
        .iter()
        .map(|part| {
            json!({
                "id": format!("row:{}", part["id"].as_str().unwrap_or_default()), "partId": part["id"],
                "turnId": part["turnId"], "kind": part["kind"], "sequence": part["sequence"],
                "estimatedHeight": if part["kind"] == "assistant" { 40 } else { 36 },
            })
        })
        .collect();
    let mut projection = create_empty_agent_display().to_value();
    projection["parts"] = Value::Array(parts);
    projection["rows"] = Value::Array(rows);
    projection["turns"] = json!([{
        "id": "turn:one", "status": "completed", "startedAtSequence": 1, "startedAtMs": 0, "completedAtSequence": 3,
        "durationMs": 7_000, "partIds": [assistant["id"], usage["id"]],
    }]);
    let display = AgentDisplay::from_value(&projection).expect("display");
    let finalized =
        project_agent_display_control(&display, &create_agent_session_control("", "", "idle", 0));
    let finalized = crate::agent::contract::dto::AgentProjection::project(&finalized, None)
        .expect("typed display");
    let timeline = build_agent_timeline(&finalized, 34., None);
    let layout = build_agent_timeline_layout(
        &timeline.rows,
        &measurements(&[
            ("row:assistant:one", 40.),
            ("row:turn-summary:turn:one", 20.),
            ("row:user:two", 40.),
        ]),
        AGENT_TIMELINE_SPACING,
    );
    let kinds: Vec<&str> = timeline.rows.iter().map(|row| row.kind.as_str()).collect();
    assert_eq!(kinds, vec!["assistant", "turn-summary", "user"]);
    assert_eq!(
        timeline
            .rows
            .iter()
            .find(|row| row.kind == "turn-summary")
            .map(|row| row.estimated_height),
        Some(34.)
    );
    assert!(
        !timeline
            .rows
            .iter()
            .any(|row| row.part_id == "usage:current")
    );
    assert_eq!(layout.gaps[1], AGENT_TIMELINE_SPACING.turn_handoff);
    assert_eq!(
        layout.offsets[2] - layout.offsets[1] - 20.,
        AGENT_TIMELINE_SPACING.turn_handoff
    );
}

#[test]
fn retains_full_timeline_gaps_across_a_virtualization_boundary() {
    let rows: Vec<TimelineRow> = (0..400)
        .map(|index| {
            row(
                &format!("user:{index}"),
                "user",
                Some(&format!("turn:{index}")),
                index + 1,
                40.,
            )
        })
        .collect();
    let layout = build_agent_timeline_layout(&rows, &HashMap::new(), AGENT_TIMELINE_SPACING);
    let (start, end) = visible_agent_timeline_range(&layout.offsets, rows.len(), 6_000., 640.);
    assert!(end - start <= MAX_MOUNTED_ROWS);
    assert!(start > 0);
    assert_eq!(layout.gaps[start - 1], AGENT_TIMELINE_SPACING.turn_handoff);
    assert_eq!(layout.gaps[end - 1], AGENT_TIMELINE_SPACING.turn_handoff);
}

fn anchored(id: &str) -> TimelineRow {
    TimelineRow {
        id: id.into(),
        part_id: id.into(),
        turn_id: Some("turn:one".into()),
        kind: "assistant".into(),
        sequence: 1,
        updated_sequence: None,
        estimated_height: 40.,
    }
}

fn index_of(rows: &[TimelineRow]) -> HashMap<String, usize> {
    rows.iter()
        .enumerate()
        .map(|(index, row)| (row.id.clone(), index))
        .collect()
}

#[test]
fn keeps_the_same_visible_row_coordinate_when_earlier_rows_reflow() {
    let rows = vec![
        anchored("one"),
        anchored("two"),
        anchored("three"),
        anchored("four"),
    ];
    let before = build_agent_timeline_layout(
        &rows,
        &measurements(&[("one", 40.), ("two", 40.), ("three", 40.), ("four", 40.)]),
        AGENT_TIMELINE_SPACING,
    );
    let anchor = capture_agent_timeline_scroll_anchor(&rows, &before, 130., 12.);
    assert_eq!(
        anchor,
        AgentTimelineScrollAnchor::Row {
            row_id: "three".into(),
            offset: 22.
        }
    );
    let after = build_agent_timeline_layout(
        &rows,
        &measurements(&[("one", 68.), ("two", 56.), ("three", 72.), ("four", 40.)]),
        AGENT_TIMELINE_SPACING,
    );
    assert_eq!(
        resolve_agent_timeline_scroll_anchor(&anchor, &after, &index_of(&rows), 12., None),
        Some(174.)
    );
}

#[test]
fn retains_an_absolute_viewport_coordinate_above_the_virtual_canvas() {
    let rows = vec![anchored("one")];
    let layout = build_agent_timeline_layout(
        &rows,
        &measurements(&[("one", 40.)]),
        AGENT_TIMELINE_SPACING,
    );
    let anchor = capture_agent_timeline_scroll_anchor(&rows, &layout, 8., 20.);
    assert_eq!(
        anchor,
        AgentTimelineScrollAnchor::Absolute { scroll_top: 8. }
    );
    assert_eq!(
        resolve_agent_timeline_scroll_anchor(&anchor, &layout, &index_of(&rows), 24., None),
        Some(8.)
    );
}

#[test]
fn preserves_the_nearest_surviving_row_when_the_anchor_is_filtered() {
    let before_rows = vec![anchored("one"), anchored("two"), anchored("three")];
    let before = build_agent_timeline_layout(
        &before_rows,
        &measurements(&[("one", 40.), ("two", 40.), ("three", 40.)]),
        AGENT_TIMELINE_SPACING,
    );
    let anchor = capture_agent_timeline_scroll_anchor(&before_rows, &before, 70., 0.);
    let rows = vec![before_rows[0].clone(), before_rows[2].clone()];
    let after = build_agent_timeline_layout(
        &rows,
        &measurements(&[("one", 40.), ("three", 40.)]),
        AGENT_TIMELINE_SPACING,
    );
    let restored = resolve_agent_timeline_scroll_anchor(
        &anchor,
        &after,
        &index_of(&rows),
        0.,
        Some((&before_rows, &before)),
    );
    assert_eq!(restored, Some(22.));
    assert_eq!(
        after.offsets[1] - restored.unwrap_or_default(),
        before.offsets[2] - 70.
    );
}

#[test]
fn does_not_guess_a_replacement_when_the_anchored_row_disappears() {
    let rows = vec![anchored("one"), anchored("two")];
    let layout = build_agent_timeline_layout(
        &rows,
        &measurements(&[("one", 40.), ("two", 40.)]),
        AGENT_TIMELINE_SPACING,
    );
    let anchor = capture_agent_timeline_scroll_anchor(&rows, &layout, 70., 0.);
    let only_one: HashMap<String, usize> = [("one".to_string(), 0)].into_iter().collect();
    assert_eq!(
        resolve_agent_timeline_scroll_anchor(&anchor, &layout, &only_one, 0., None),
        None
    );
}
