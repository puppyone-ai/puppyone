//! `ui/transcript/transcript-rows.ts`: arranges Main-authored display data
//! into visible transcript rows. Non-visual state, such as token usage,
//! must not occupy virtual-list geometry.
use crate::agent::contract::activity_semantics::is_agent_transcript_activity;
use crate::agent::contract::display_types::AgentDisplay;
use crate::agent::contract::js;
use crate::features::desktop_agent::domain::agent_activity_presentation::output_for_activity;
use serde_json::{Value, json};
use std::collections::HashMap;

/// `STANDARD_CONTROL_SIZE`.
pub const STANDARD_CONTROL_SIZE: f64 = 32.;

/// `TimelineRow`.
#[derive(Clone, Debug, PartialEq)]
pub struct TimelineRow {
    pub id: String,
    pub part_id: String,
    pub turn_id: Option<String>,
    pub kind: String,
    pub sequence: i64,
    pub updated_sequence: Option<i64>,
    pub estimated_height: f64,
}

impl TimelineRow {
    fn from_value(row: &Value) -> Self {
        Self {
            id: js::string_or_empty(row.get("id")),
            part_id: js::string_or_empty(row.get("partId")),
            turn_id: row["turnId"].as_str().map(str::to_string),
            kind: js::string_or_empty(row.get("kind")),
            sequence: row["sequence"].as_i64().unwrap_or(0),
            updated_sequence: row["updatedSequence"].as_i64(),
            estimated_height: row["estimatedHeight"].as_f64().unwrap_or(0.),
        }
    }
}

/// `AgentTimeline`.
#[derive(Clone, Debug, Default)]
pub struct AgentTimeline {
    pub rows: Vec<TimelineRow>,
    pub parts: HashMap<String, Value>,
}

/// `PendingTranscriptSubmission`.
#[derive(Clone, Debug, PartialEq)]
pub struct PendingTranscriptSubmission {
    pub id: String,
    pub prompt: String,
    pub references: Vec<Value>,
    pub prompt_mentions: Vec<Value>,
}

/// `buildAgentTimeline(projection, compactRowHeight, pending)`.
pub fn build_agent_timeline(
    projection: &AgentDisplay,
    compact_row_height: f64,
    pending: Option<&PendingTranscriptSubmission>,
) -> AgentTimeline {
    let (parts, mut rows): (Vec<Value>, Vec<TimelineRow>) = if !projection.rows.is_empty()
        && !projection.parts.is_empty()
    {
        let parts = projection
            .parts
            .iter()
            .map(|part| (**part).clone())
            .collect();
        let rows = projection
            .rows
            .iter()
            .map(|row| {
                let mut row = TimelineRow::from_value(row);
                if row.kind == "turn-summary" {
                    row.estimated_height = compact_row_height;
                }
                row
            })
            .collect();
        (parts, rows)
    } else {
        // Compatibility for consumers constructing the original projection
        // shape.
        let mut parts: Vec<Value> = projection
            .messages
            .iter()
            .map(|message| {
                let mut part = (**message).clone();
                part["kind"] = message["role"].clone();
                part
            })
            .chain(
                projection
                    .activities
                    .iter()
                    .map(|activity| (**activity).clone()),
            )
            .collect();
        parts.sort_by_key(|part| part["sequence"].as_i64().unwrap_or(0));
        let rows = parts
            .iter()
            .map(|part| {
                let sequence = part["sequence"].as_i64().unwrap_or(0);
                TimelineRow {
                    id: format!("row:{}", part["id"].as_str().unwrap_or_default()),
                    part_id: js::string_or_empty(part.get("id")),
                    turn_id: part["turnId"].as_str().map(str::to_string),
                    kind: js::string_or_empty(part.get("kind")),
                    sequence,
                    updated_sequence: Some(part["updatedSequence"].as_i64().unwrap_or(sequence)),
                    estimated_height: estimate_legacy_part_height(part),
                }
            })
            .collect();
        (parts, rows)
    };
    // Main owns message correlation. The view only uses its opaque submission
    // identity so an admitted row continues the same mounted preview.
    let mut part_map: HashMap<String, Value> = parts
        .into_iter()
        .map(|part| (js::string_or_empty(part.get("id")), part))
        .collect();
    for row in &mut rows {
        if let Some(part) = part_map.get(&row.part_id)
            && part["kind"] == "user"
            && let Some(submission) = part["submissionId"].as_str().filter(|s| !s.is_empty())
        {
            row.id = submission_row_id(submission);
        }
    }
    if let Some(pending) = pending
        && !part_map
            .values()
            .any(|part| part["kind"] == "user" && part["submissionId"] == pending.id.as_str())
    {
        let id = format!("pending:{}", pending.id);
        let part = json!({
            "id": id, "kind": "user", "turnId": null, "itemId": null, "submissionId": pending.id,
            "text": pending.prompt,
            "references": pending.references.iter().map(draft_reference_display).collect::<Vec<_>>(),
            "promptMentions": pending.prompt_mentions,
            "streaming": false, "terminalState": null, "sequence": js::MAX_SAFE_INTEGER,
        });
        part_map.insert(id.clone(), part);
        rows.push(TimelineRow {
            id: submission_row_id(&pending.id),
            part_id: id,
            turn_id: None,
            kind: "user".into(),
            sequence: js::MAX_SAFE_INTEGER,
            updated_sequence: None,
            estimated_height: 64.,
        });
    }
    let rows = rows
        .into_iter()
        .filter(|row| is_visible_agent_timeline_part(part_map.get(&row.part_id)))
        .collect();
    AgentTimeline {
        rows,
        parts: part_map,
    }
}

/// `isVisibleAgentTimelinePart(part)`: interaction state belongs to the
/// actionable docks, not a second transcript label.
pub fn is_visible_agent_timeline_part(part: Option<&Value>) -> bool {
    let Some(part) = part else {
        return false;
    };
    let kind = part["kind"].as_str().unwrap_or_default();
    if !is_agent_transcript_activity(part) || matches!(kind, "usage" | "permission" | "question") {
        return false;
    }
    if kind != "reasoning" {
        return true;
    }
    let status = part["status"].as_str().unwrap_or_default();
    if [
        "queued",
        "running",
        "pending",
        "in-progress",
        "waiting-for-user",
    ]
    .contains(&status)
    {
        return false;
    }
    let summary = match part["detail"]["delta"].as_str() {
        Some(delta) => delta.to_string(),
        None => output_for_activity(part),
    };
    !js::trim(&summary).is_empty()
}

fn estimate_legacy_part_height(part: &Value) -> f64 {
    match part["kind"].as_str() {
        Some("assistant") => {
            let length = js::len16(part["text"].as_str().unwrap_or_default()) as f64;
            640f64.min(50. + (length / 64.).ceil() * 20.)
        }
        Some("user") => 64.,
        _ => 34.,
    }
}

fn submission_row_id(id: &str) -> String {
    format!("row:submission:{id}")
}

/// `draftReferenceDisplay(reference)`.
fn draft_reference_display(reference: &Value) -> Value {
    let staged = reference["kind"] == "staged-attachment";
    let workspace = reference["kind"] == "workspace-entry";
    let kind = if staged {
        "attachment"
    } else if reference["entryType"] == "directory" {
        "workspace-directory"
    } else {
        "workspace-file"
    };
    let mut display =
        json!({ "id": reference["id"], "kind": kind, "displayName": reference["displayName"] });
    if workspace {
        display["relativePath"] = reference["relativePath"].clone();
        if js::truthy(&reference["workspaceName"]) {
            display["workspaceName"] = reference["workspaceName"].clone();
        }
    }
    if staged {
        display["mime"] = reference["mime"].clone();
        display["size"] = reference["size"].clone();
    }
    display
}
