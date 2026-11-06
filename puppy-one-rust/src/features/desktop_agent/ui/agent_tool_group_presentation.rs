//! `ui/agent-tool-group-presentation.ts`: groups adjacent tools only at the
//! Renderer boundary. The durable event ledger, provider ordering, and
//! individual tool identities remain untouched.
use super::activity::agent_tool_steps::agent_tool_step_segments;
use super::transcript::transcript_rows::TimelineRow;
use crate::agent::contract::activity_semantics::is_agent_tool_activity;
use crate::features::desktop_agent::domain::agent_activity_presentation::is_context_compaction_activity;
use serde_json::Value;
use std::collections::HashMap;

/// `AgentTranscriptRow`.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentTranscriptRow {
    pub row: TimelineRow,
    pub part_ids: Vec<String>,
    pub tool_group: bool,
}

pub const AGENT_TOOL_GROUP_LIMIT: usize = 64;

/// `groupAgentToolRows(rows, parts, compactRowHeight)`.
pub fn group_agent_tool_rows(
    rows: &[TimelineRow],
    parts: &HashMap<String, Value>,
    compact_row_height: f64,
) -> Vec<AgentTranscriptRow> {
    let mut grouped = Vec::new();
    let mut index = 0;
    while index < rows.len() {
        let row = &rows[index];
        if !is_groupable_tool_row(row, parts) {
            grouped.push(AgentTranscriptRow {
                row: row.clone(),
                part_ids: vec![row.part_id.clone()],
                tool_group: false,
            });
            index += 1;
            continue;
        }
        let mut tool_rows = vec![row];
        let mut cursor = index + 1;
        while cursor < rows.len()
            && tool_rows.len() < AGENT_TOOL_GROUP_LIMIT
            && rows[cursor].turn_id == row.turn_id
            && is_groupable_tool_row(&rows[cursor], parts)
        {
            tool_rows.push(&rows[cursor]);
            cursor += 1;
        }
        let group_parts: Vec<Value> = tool_rows
            .iter()
            .filter_map(|entry| parts.get(&entry.part_id).cloned())
            .collect();
        let mut group = row.clone();
        group.id = format!("tool-group:{}", row.id);
        group.updated_sequence = tool_rows
            .iter()
            .map(|entry| entry.updated_sequence.unwrap_or(entry.sequence))
            .max();
        // One line per visible step until the real row is measured.
        group.estimated_height =
            compact_row_height * agent_tool_step_segments(&group_parts).len().max(1) as f64;
        grouped.push(AgentTranscriptRow {
            row: group,
            part_ids: tool_rows
                .iter()
                .map(|entry| entry.part_id.clone())
                .collect(),
            tool_group: true,
        });
        index = cursor;
    }
    grouped
}

fn is_groupable_tool_row(row: &TimelineRow, parts: &HashMap<String, Value>) -> bool {
    if !matches!(row.kind.as_str(), "tool" | "command" | "file-change") {
        return false;
    }
    parts
        .get(&row.part_id)
        .is_some_and(|part| is_agent_tool_activity(part) && !is_context_compaction_activity(part))
}
