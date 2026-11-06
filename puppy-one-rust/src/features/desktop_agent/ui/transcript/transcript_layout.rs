//! `ui/transcript/transcript-layout.ts`: owns transcript vertical rhythm
//! independently of mounted view adjacency. Measurements contain row content
//! only; semantic gaps are deterministic.
use super::transcript_rows::TimelineRow;
use std::collections::HashMap;

/// `AgentTimelineSpacing`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AgentTimelineSpacing {
    pub compact: f64,
    pub default: f64,
    pub work_handoff: f64,
    pub turn_handoff: f64,
}

/// `agentTimelineSpacing`.
pub const AGENT_TIMELINE_SPACING: AgentTimelineSpacing = AgentTimelineSpacing {
    compact: 0.,
    default: 2.,
    work_handoff: 8.,
    turn_handoff: 24.,
};

/// `agentTimelineLimits`.
pub const MAX_MOUNTED_ROWS: usize = 120;
pub const OVERSCAN_ROWS: usize = 14;
pub const STREAM_BATCH_MS: u64 = 16;

/// `AgentTimelineLayout`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AgentTimelineLayout {
    pub offsets: Vec<f64>,
    pub gaps: Vec<f64>,
    pub total_height: f64,
}

/// `buildAgentTimelineLayout(rows, measurements, spacing)`.
pub fn build_agent_timeline_layout(
    rows: &[TimelineRow],
    measurements: &HashMap<String, f64>,
    spacing: AgentTimelineSpacing,
) -> AgentTimelineLayout {
    let mut offsets = vec![0.; rows.len() + 1];
    let mut gaps = vec![0.; rows.len()];
    for index in 0..rows.len() {
        let gap = agent_timeline_gap_after(&rows[index], rows.get(index + 1), spacing);
        gaps[index] = gap;
        offsets[index + 1] =
            offsets[index] + measured_or_estimated_height(&rows[index], measurements) + gap;
    }
    let total_height = offsets.last().copied().unwrap_or(0.);
    AgentTimelineLayout {
        offsets,
        gaps,
        total_height,
    }
}

/// `agentTimelineGapAfter(row, next, spacing)`.
pub fn agent_timeline_gap_after(
    row: &TimelineRow,
    next: Option<&TimelineRow>,
    spacing: AgentTimelineSpacing,
) -> f64 {
    if next.is_some_and(|next| is_turn_boundary(row, next)) {
        return spacing.turn_handoff;
    }
    match row.kind.as_str() {
        "user" => spacing.turn_handoff,
        "assistant" | "turn-summary" => spacing.work_handoff,
        "tool" | "command" | "file-change" => spacing.compact,
        _ => spacing.default,
    }
}

/// `visibleAgentTimelineRange(offsets, count, scrollTop, viewportHeight)`.
pub fn visible_agent_timeline_range(
    offsets: &[f64],
    count: usize,
    scroll_top: f64,
    viewport_height: f64,
) -> (usize, usize) {
    let first = lower_bound(offsets, scroll_top.max(0.)).saturating_sub(1 + OVERSCAN_ROWS);
    let last = count.min(lower_bound(offsets, scroll_top + viewport_height) + OVERSCAN_ROWS);
    (first, last.min(first + MAX_MOUNTED_ROWS))
}

fn is_turn_boundary(row: &TimelineRow, next: &TimelineRow) -> bool {
    if next.kind == "user" {
        return true;
    }
    if row.turn_id == next.turn_id {
        return false;
    }
    row.turn_id.is_some() || next.turn_id.is_some()
}

fn measured_or_estimated_height(row: &TimelineRow, measurements: &HashMap<String, f64>) -> f64 {
    match measurements.get(&row.id) {
        Some(measured) if measured.is_finite() && *measured > 0. => *measured,
        _ => row.estimated_height,
    }
}

fn lower_bound(values: &[f64], target: f64) -> usize {
    values.partition_point(|value| *value < target)
}
