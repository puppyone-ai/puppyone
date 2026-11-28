//! `ui/transcript/transcript-viewport.ts`: one stable viewport coordinate
//! captured before a width-driven reflow. The transcript is virtualized, so
//! the virtual layout owns the anchor explicitly.
use super::transcript_layout::AgentTimelineLayout;
use super::transcript_rows::TimelineRow;
use crate::features::desktop_agent::domain::agent_ui_state::AgentTimelineScrollAnchor;
use std::collections::HashMap;

/// `captureAgentTimelineScrollAnchor(rows, layout, scrollTop, timelineTop)`.
pub fn capture_agent_timeline_scroll_anchor(
    rows: &[TimelineRow],
    layout: &AgentTimelineLayout,
    scroll_top: f64,
    timeline_top: f64,
) -> AgentTimelineScrollAnchor {
    let local = scroll_top - timeline_top;
    if rows.is_empty() || local < 0. {
        return AgentTimelineScrollAnchor::Absolute { scroll_top };
    }
    let index = (rows.len() - 1).min(upper_bound(&layout.offsets, local).saturating_sub(1));
    AgentTimelineScrollAnchor::Row {
        row_id: rows[index].id.clone(),
        offset: local - layout.offsets[index],
    }
}

/// `resolveAgentTimelineScrollAnchor(anchor, layout, rowIndexById, …)`.
pub fn resolve_agent_timeline_scroll_anchor(
    anchor: &AgentTimelineScrollAnchor,
    layout: &AgentTimelineLayout,
    row_index_by_id: &HashMap<String, usize>,
    timeline_top: f64,
    previous: Option<(&[TimelineRow], &AgentTimelineLayout)>,
) -> Option<f64> {
    let (row_id, offset) = match anchor {
        AgentTimelineScrollAnchor::Absolute { scroll_top } => return Some(*scroll_top),
        AgentTimelineScrollAnchor::Row { row_id, offset } => (row_id, *offset),
    };
    if let Some(index) = row_index_by_id.get(row_id) {
        return Some((timeline_top + layout.offsets[*index] + offset).max(0.));
    }
    let (previous_rows, previous_layout) = previous?;
    let old_index = previous_rows.iter().position(|row| row.id == *row_id)?;
    for distance in 1..previous_rows.len() {
        for candidate in [
            old_index.checked_add(distance),
            old_index.checked_sub(distance),
        ] {
            let Some(candidate) = candidate else {
                continue;
            };
            let Some(replacement) = previous_rows
                .get(candidate)
                .and_then(|row| row_index_by_id.get(&row.id))
            else {
                continue;
            };
            let shifted =
                offset + previous_layout.offsets[old_index] - previous_layout.offsets[candidate];
            return Some((timeline_top + layout.offsets[*replacement] + shifted).max(0.));
        }
    }
    None
}

fn upper_bound(values: &[f64], target: f64) -> usize {
    values.partition_point(|value| *value <= target)
}
