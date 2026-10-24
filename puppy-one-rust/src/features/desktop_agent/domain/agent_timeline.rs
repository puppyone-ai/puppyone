//! Port of `transcript-rows.ts` (`buildAgentTimeline`, visibility),
//! `agent-tool-group-presentation.ts` (`groupAgentToolRows`,
//! `agentToolRailVisibleCount`), the turn summaries of `display-control.mjs`
//! and the vertical rhythm of `transcript-layout.ts`. Pure; no GPUI.
use super::agent_activity_presentation::{PartKind, part_kind};
use crate::agent::domain::agent_session_model::Message;
use crate::features::desktop_agent::application::agent_session_controller::TurnTiming;
use std::collections::HashMap;

/// `agentTimelineSpacing`.
pub const GAP_COMPACT: f32 = 0.;
pub const GAP_DEFAULT: f32 = 2.;
pub const GAP_WORK_HANDOFF: f32 = 8.;
pub const GAP_TURN_HANDOFF: f32 = 24.;
/// `AGENT_TOOL_GROUP_LIMIT` and the rail geometry (`agent-tool-group-presentation.ts`).
pub const TOOL_GROUP_LIMIT: usize = 64;
pub const RAIL_ITEM: f32 = 28.;
pub const RAIL_GAP: f32 = 4.;
pub const RAIL_OVERFLOW: f32 = 36.;
pub const RAIL_GROUP_INSET: f32 = 8.;
const RAIL_FALLBACK_VISIBLE: usize = 12;
const RAIL_MAX_VISIBLE: usize = 24;

#[derive(Clone, Debug, PartialEq)]
pub enum RowKind {
    User,
    Assistant,
    TurnSummary(TurnTiming),
    Reasoning,
    Plan,
    Compaction {
        from_tool: bool,
    },
    /// Adjacent tool parts of one turn (`toolGroup: true`).
    ToolGroup,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    /// Stable identity: the first part's id (prefixed for groups/summaries).
    pub id: String,
    pub kind: RowKind,
    pub turn: usize,
    /// Indices into the snapshot's messages.
    pub parts: Vec<usize>,
    /// `agentTimelineGapAfter`.
    pub gap_after: f32,
}

/// User messages that do not open a turn (steering input to a running turn).
fn continues_turn(message: &Message) -> bool {
    matches!(message.status.as_str(), "steering" | "queued")
}

/// `isVisibleAgentTimelinePart`: live or empty reasoning stays in the live
/// tail; provider status parts have no transcript row.
fn visible(message: &Message, kind: PartKind) -> bool {
    match kind {
        PartKind::System => false,
        PartKind::Reasoning => {
            !matches!(
                message.status.as_str(),
                "queued"
                    | "running"
                    | "pending"
                    | "in-progress"
                    | "in_progress"
                    | "inProgress"
                    | "waiting-for-user"
            ) && !message.text.trim().is_empty()
        }
        _ => true,
    }
}

pub fn build(
    messages: &[Message],
    assistant_roles: &[&str],
    timings: &HashMap<String, TurnTiming>,
) -> Vec<Row> {
    let mut rows: Vec<Row> = Vec::new();
    let mut turn = 0usize;
    let mut turn_opener: HashMap<usize, String> = HashMap::new();
    for (index, message) in messages.iter().enumerate() {
        let kind = part_kind(message, assistant_roles);
        if kind == PartKind::User && !continues_turn(message) {
            turn += 1;
            turn_opener.insert(turn, message.id.clone());
        }
        if !visible(message, kind) {
            continue;
        }
        if kind.groupable()
            && let Some(last) = rows.last_mut()
            && last.kind == RowKind::ToolGroup
            && last.turn == turn
            && last.parts.len() < TOOL_GROUP_LIMIT
        {
            last.parts.push(index);
            continue;
        }
        let (row_kind, id) = match kind {
            PartKind::User => (RowKind::User, format!("row:{}", message.id)),
            PartKind::Assistant => (RowKind::Assistant, format!("row:{}", message.id)),
            PartKind::Reasoning => (RowKind::Reasoning, format!("row:{}", message.id)),
            PartKind::Plan => (RowKind::Plan, format!("row:{}", message.id)),
            PartKind::Compaction { from_tool } => (
                RowKind::Compaction { from_tool },
                format!("row:{}", message.id),
            ),
            PartKind::Tool => (RowKind::ToolGroup, format!("tool-group:row:{}", message.id)),
            PartKind::System => unreachable!(),
        };
        rows.push(Row {
            id,
            kind: row_kind,
            turn,
            parts: vec![index],
            gap_after: 0.,
        });
    }
    // Confirmed turn outcomes follow the last row of their turn.
    for (&turn, opener) in &turn_opener {
        let Some(timing) = timings.get(opener) else {
            continue;
        };
        let Some(last) = rows.iter().rposition(|r| r.turn == turn) else {
            continue;
        };
        rows.insert(
            last + 1,
            Row {
                id: format!("row:turn-summary:{opener}"),
                kind: RowKind::TurnSummary(*timing),
                turn,
                parts: vec![],
                gap_after: 0.,
            },
        );
    }
    for index in 0..rows.len() {
        let gap = gap_after(&rows[index], rows.get(index + 1));
        rows[index].gap_after = gap;
    }
    rows
}

fn gap_after(row: &Row, next: Option<&Row>) -> f32 {
    if let Some(next) = next
        && (next.kind == RowKind::User || next.turn != row.turn)
    {
        return GAP_TURN_HANDOFF;
    }
    match row.kind {
        RowKind::User => GAP_TURN_HANDOFF,
        RowKind::Assistant | RowKind::TurnSummary(_) => GAP_WORK_HANDOFF,
        RowKind::ToolGroup | RowKind::Compaction { from_tool: true } => GAP_COMPACT,
        _ => GAP_DEFAULT,
    }
}

/// `agentToolRailVisibleCount`: one line of 28px items; a +N slot when needed.
pub fn rail_visible_count(total: usize, width: f32) -> usize {
    if total == 0 {
        return 0;
    }
    let width = width - RAIL_GROUP_INSET;
    if !width.is_finite() || width <= 0. {
        return total.min(RAIL_FALLBACK_VISIBLE);
    }
    let full = ((width + RAIL_GAP) / (RAIL_ITEM + RAIL_GAP))
        .floor()
        .max(0.) as usize;
    if total <= full && total <= RAIL_MAX_VISIBLE {
        return total;
    }
    let with_overflow = ((width - RAIL_OVERFLOW) / (RAIL_ITEM + RAIL_GAP))
        .floor()
        .max(0.) as usize;
    (total - 1).min(RAIL_MAX_VISIBLE).min(with_overflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::desktop_agent::application::agent_session_controller::TurnOutcome;
    fn m(id: &str, role: &str, text: &str, status: &str) -> Message {
        Message {
            id: id.into(),
            role: role.into(),
            text: text.into(),
            status: status.into(),
            input: None,
        }
    }
    #[test]
    fn tools_group_per_turn_and_turns_end_with_their_summary() {
        let messages = vec![
            m("u1", "You", "a", ""),
            m("a1", "Codex", "b", "completed"),
            m("u2", "You", "c", ""),
            m("r", "Reasoning", "", "running"),
            m("t1", "grep", "", "completed"),
            m("t2", "Command", "", "completed"),
            m("a2", "Codex", "d", "completed"),
            m("t3", "read", "", "completed"),
        ];
        let timings = HashMap::from([
            (
                "u1".into(),
                TurnTiming {
                    duration_ms: 2_400,
                    outcome: TurnOutcome::Completed,
                },
            ),
            (
                "u2".into(),
                TurnTiming {
                    duration_ms: 31_000,
                    outcome: TurnOutcome::Completed,
                },
            ),
        ]);
        let rows = build(&messages, &["Codex"], &timings);
        let kinds: Vec<_> = rows
            .iter()
            .map(|r| (&r.kind, r.parts.len(), r.gap_after))
            .collect();
        assert!(matches!(kinds[0], (RowKind::User, 1, 24.)));
        assert!(matches!(kinds[1], (RowKind::Assistant, 1, 8.)));
        assert!(matches!(kinds[2], (RowKind::TurnSummary(_), 0, 24.)));
        assert!(matches!(kinds[3], (RowKind::User, 1, 24.)));
        // Running empty reasoning is hidden; two tools share one rail.
        assert!(matches!(kinds[4], (RowKind::ToolGroup, 2, 0.)));
        assert!(matches!(kinds[5], (RowKind::Assistant, 1, 8.)));
        assert!(matches!(kinds[6], (RowKind::ToolGroup, 1, 0.)));
        assert!(matches!(kinds[7], (RowKind::TurnSummary(_), 0, 8.)));
        assert_eq!(rows.len(), 8);
    }
    #[test]
    fn rail_reserves_one_slot_for_overflow() {
        assert_eq!(rail_visible_count(4, 388.), 4);
        // 388 − 8 = 380: 12 full items; 30 tools → (380 − 36) / 32 = 10 + "+20".
        assert_eq!(rail_visible_count(30, 388.), 10);
        assert_eq!(rail_visible_count(5, 0.), 5);
    }
}
